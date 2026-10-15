const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, randomBytes} = require('node:crypto');
const POLICY_VERSION = '2026-10-15';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAMES = new Set(['app_open', 'call_started', 'call_completed', 'feature_used', 'error']);
const FEATURES = new Set(['calendar', 'sample', 'export', 'mcp_setup']);
const ERRORS = new Set(['capture_connection', 'capture_backpressure', 'capture_ended', 'renderer_gone', 'other']);
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\.\d{1,4})?$/;
const WEEK = 7 * 86400000;
const blank = () => ({schemaVersion: 1, termsVersion: null, privacyVersion: null, analytics: false, revision: 0, installationId: null, secret: null, pendingDeletion: false, events: []});
function endpointURL(value) {
  try {
    const url = new URL(value);
    if(url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}
class AnalyticsManager {
  constructor({directory, endpoint, version, platform, fetch: request = global.fetch, filesystem = fs, now = Date.now}) {
    this.fs = filesystem;
    this.file = path.join(directory, 'analytics.json');
    this.endpoint = endpointURL(endpoint);
    this.version = typeof version === 'string' && VERSION.test(version) ? version : '0.0.0';
    this.platform = ['darwin', 'win32'].includes(platform) ? platform : null;
    this.request = request;
    this.now = now;
    this.state = blank();
    this.syncedRevision = -1;
    this.blocked = false;
    this.started = false;
    this.backoff = 1000;
    try {
      if(this.fs.statSync(this.file).size > 128 * 1024) throw Error('Privacy state is too large');
      const raw = this.fs.readFileSync(this.file, 'utf8');
      if(Buffer.byteLength(raw, 'utf8') > 128 * 1024) throw Error('Privacy state is too large');
      const saved = JSON.parse(raw);
      if(![1, '2026-10-15'].includes(saved.schemaVersion) || !Number.isSafeInteger(saved.revision) || saved.revision < 0 ||
        typeof saved.analytics !== 'boolean' || typeof saved.pendingDeletion !== 'boolean' ||
        !((UUID.test(saved.installationId) && /^[0-9a-f]{64}$/.test(saved.secret)) ||
          (saved.installationId === null && saved.secret === null && saved.termsVersion === null && saved.privacyVersion === null && !saved.analytics && !saved.pendingDeletion))) throw Error('Invalid state');
      this.state = {...blank(), installationId: saved.installationId, secret: saved.secret,
        termsVersion: saved.termsVersion, privacyVersion: saved.privacyVersion, revision: saved.revision,
        analytics: saved.analytics, pendingDeletion: saved.pendingDeletion,
        events: Array.isArray(saved.events) ? saved.events.filter(event => this.validEvent(event)).slice(-100) : []};
      if(!this.accepted() || this.state.pendingDeletion) {this.state.analytics = false; this.state.events = [];}
      this.prune();
    } catch(error) {
      if(error.code !== 'ENOENT') this.blocked = true;
    }
  }
  accepted() { return this.state.termsVersion === POLICY_VERSION && this.state.privacyVersion === POLICY_VERSION; }
  status() {
    return {available: Boolean(this.endpoint && this.platform && this.request && !this.blocked),
      accepted: this.accepted(), analytics: this.state.analytics && !this.blocked && !this.state.pendingDeletion,
      pendingDeletion: this.state.pendingDeletion, termsVersion: this.state.termsVersion,
      privacyVersion: this.state.privacyVersion};
  }
  save(state = this.state) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      this.fs.mkdirSync(path.dirname(this.file), {recursive: true});
      this.fs.writeFileSync(temporary, JSON.stringify(state), {mode: 0o600, flag: 'wx'});
      this.fs.renameSync(temporary, this.file);
    } catch(error) {
      try {this.fs.unlinkSync(temporary);} catch {}
      this.blocked = true;
      this.controller?.abort();
      throw Error('Privacy settings could not be saved. Analytics is disabled.');
    }
  }
  async acceptTerms() {
    if(this.state.pendingDeletion) throw Error('Deletion must finish before accepting again.');
    if(this.blocked) throw Error('Privacy storage is unavailable.');
    const next = {...this.state, termsVersion: POLICY_VERSION, privacyVersion: POLICY_VERSION,
      installationId: this.state.installationId || randomUUID(), secret: this.state.secret || randomBytes(32).toString('hex'),
      analytics: this.accepted() && this.state.analytics, revision: this.state.revision + 1};
    this.save(next); this.state = next; this.schedule(0);
    return this.status();
  }
  async setAnalytics(enabled) {
    if(typeof enabled !== 'boolean') throw Error('Analytics preference must be a boolean.');
    if(enabled && (!this.accepted() || !this.status().available || this.state.pendingDeletion)) throw Error('Analytics consent is unavailable.');
    if(!this.state.installationId) return this.status();
    const next = {...this.state, analytics: enabled, revision: this.state.revision + 1,
      events: enabled ? this.state.events : []};
    if(!enabled) {this.state = next; this.controller?.abort();}
    this.save(next); this.state = next; this.schedule(0);
    return this.status();
  }
  validEvent(event) {
    if(!event || !UUID.test(event.id) || !NAMES.has(event.name) || !/^\d{4}-\d{2}-\d{2}$/.test(event.day) ||
      typeof event.version !== 'string' || !VERSION.test(event.version) || !['darwin', 'win32'].includes(event.platform)) return false;
    if(Object.keys(event).some(key => !['id','name','day','version','platform','feature','errorCode','durationMinutes'].includes(key))) return false;
    if(Number.isNaN(Date.parse(event.day)) || new Date(event.day).toISOString().slice(0,10) !== event.day) return false;
    return ((event.name === 'feature_used') === Object.hasOwn(event, 'feature')) &&
      (!Object.hasOwn(event, 'feature') || FEATURES.has(event.feature)) &&
      ((event.name === 'error') === Object.hasOwn(event, 'errorCode')) &&
      (!Object.hasOwn(event, 'errorCode') || ERRORS.has(event.errorCode)) &&
      (!Object.hasOwn(event, 'durationMinutes') || (event.name === 'call_completed' && Number.isInteger(event.durationMinutes) && event.durationMinutes >= 0 && event.durationMinutes <= 1440));
  }
  prune() {
    const cutoff = this.now() - WEEK;
    this.state.events = this.state.events.filter(event => Date.parse(`${event.day}T00:00:00Z`) >= cutoff && Date.parse(`${event.day}T00:00:00Z`) <= this.now()).slice(-100);
  }
  track(name, props = {}) {
    try {
      if(!this.status().analytics || !this.status().available || !this.accepted() || !NAMES.has(name)) return false;
      const event = {id: randomUUID(), name, day: new Date(this.now()).toISOString().slice(0,10), version: this.version, platform: this.platform};
      if(name === 'feature_used' && FEATURES.has(props.feature)) event.feature = props.feature;
      if(name === 'error' && ERRORS.has(props.errorCode)) event.errorCode = props.errorCode;
      if(name === 'call_completed' && Number.isFinite(props.durationMinutes)) event.durationMinutes = Math.max(0, Math.min(1440, Math.floor(props.durationMinutes)));
      if(!this.validEvent(event)) return false;
      this.prune(); this.state.events.push(event); this.state.events = this.state.events.slice(-100);
      this.save(); this.schedule(1000); return true;
    } catch {return false;}
  }
  async send(route, method, data) {
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.request(`${this.endpoint}/v1/${route}`, {method, redirect: 'error',
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data), signal: controller.signal});
      if(!response.ok) throw Error('Analytics service unavailable');
    } finally {clearTimeout(timer); if(this.controller === controller) this.controller = null;}
  }
  flush() {
    if(this.inflight) return this.inflight;
    this.inflight = this.flushOnce().catch(() => false).then(success => {
      this.backoff = success ? 1000 : Math.min(this.backoff * 2, 300000);
      this.inflight = null;
      this.schedule(success ? 60000 : this.backoff);
      return success;
    });
    return this.inflight;
  }
  async flushOnce() {
    if(!this.status().available || !this.state.installationId) return true;
    const identity = {installationId: this.state.installationId, secret: this.state.secret};
    if(this.state.pendingDeletion) {
      await this.send('installation', 'DELETE', identity);
      const next = blank(); this.save(next); this.state = next; this.syncedRevision = -1;
      return true;
    }
    if(!this.accepted()) return true;
    const revision = this.state.revision;
    if(this.syncedRevision !== revision) {
      await this.send('consent', 'POST', {...identity, termsVersion: POLICY_VERSION, privacyVersion: POLICY_VERSION, analytics: this.state.analytics, revision});
      if(this.blocked || this.state.revision !== revision || this.state.pendingDeletion) return false;
      this.syncedRevision = revision;
    }
    if(!this.status().analytics) return true;
    this.prune();
    const events = this.state.events.slice(0,20);
    if(events.length) {
      await this.send('events', 'POST', {...identity, events});
      if(this.blocked || this.state.revision !== revision || this.state.pendingDeletion) return false;
      const ids = new Set(events.map(event => event.id));
      this.state.events = this.state.events.filter(event => !ids.has(event.id)); this.save();
    }
    return true;
  }
  async deleteData() {
    this.controller?.abort();
    if(!this.state.installationId) return this.status();
    this.state = {...this.state, analytics: false, pendingDeletion: true, events: [], revision: this.state.revision + 1};
    this.save();
    if(this.inflight) await this.inflight;
    await this.flush();
    return this.status();
  }
  schedule(delay) {
    if(!this.started) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {void this.flush();}, delay); this.timer.unref?.();
  }
  start() {this.started = true; this.schedule(0); return this.status();}
  stop() {this.started = false; clearTimeout(this.timer); this.controller?.abort();}
}
module.exports = {AnalyticsManager, POLICY_VERSION};
