const MODES = new Set(['off', 'ask', 'auto']);
const APPLICATIONS = [
  {bundleId:'us.zoom.xos', name:'Zoom', kind:'meeting'},
  {bundleId:'com.microsoft.teams2', name:'Microsoft Teams', kind:'meeting'},
  {bundleId:'com.microsoft.teams', name:'Microsoft Teams', kind:'meeting'},
  {bundleId:'com.google.Chrome', name:'Google Chrome', kind:'browser', chromium:true},
  {bundleId:'com.microsoft.edgemac', name:'Microsoft Edge', kind:'browser', chromium:true},
  {bundleId:'org.mozilla.firefox', name:'Firefox', kind:'browser'},
  {bundleId:'com.apple.Safari', name:'Safari', kind:'browser'},
];

function applicationFor(bundleId) {
  if (typeof bundleId !== 'string' || bundleId.length > 200) return null;
  for (const app of APPLICATIONS) {
    if (bundleId === app.bundleId || (app.chromium &&
        bundleId.startsWith(app.bundleId + '.') &&
        /^helper(?:\.(?:renderer|gpu|plugin))?$/.test(bundleId.slice(app.bundleId.length + 1)))) {
      return {bundleId:app.bundleId, name:app.name, kind:app.kind};
    }
  }
  return null;
}

function activeApplications(processes) {
  const found = new Map();
  for (const process of processes) {
    if (!process || process.inputActive !== true || !Number.isSafeInteger(process.pid) || process.pid <= 0) continue;
    const app = applicationFor(process.bundleId);
    if (!app) continue;
    if (!found.has(app.bundleId)) found.set(app.bundleId, {...app, pids:[]});
    const pids = found.get(app.bundleId).pids;
    if (!pids.includes(process.pid)) pids.push(process.pid);
  }
  return [...found.values()].sort((a, b) => (a.kind === 'browser') - (b.kind === 'browser') || a.bundleId.localeCompare(b.bundleId));
}

class CallDetection {
  constructor({mode = 'ask', now = Date.now, onCandidate = () => {}, getBusy = () => false,
    stableMs = 5000, inactiveMs = 60000, staleMs = 3000} = {}) {
    if (!MODES.has(mode)) throw Error('Invalid call detection mode');
    if (![stableMs, inactiveMs, staleMs].every(value => Number.isFinite(value) && value > 0)) throw Error('Invalid call detection timing');
    Object.assign(this, {mode, now, onCandidate, getBusy, stableMs, inactiveMs, staleMs});
    this.available = false;
    this.observedAt = null;
    this.applications = [];
    this.activeSince = new Map();
    this.inactiveSince = null;
    this.consumed = false;
    this.candidate = null;
    this.sequence = 0;
  }

  setMode(mode) {
    if (!MODES.has(mode)) throw Error('Invalid call detection mode');
    if (mode !== this.mode) {
      this.candidate = null;
      this.activeSince.clear();
      if (mode === 'off' && this.applications.length) this.consumed = true;
      this.mode = mode;
    }
    return this.snapshot();
  }

  suppress() {
    this.consumed = true;
    this.candidate = null;
    return this.snapshot();
  }

  invalidate() {
    this.available = false;
    this.applications = [];
    this.activeSince.clear();
    this.inactiveSince = null;
    this.candidate = null;
  }

  fresh() {
    const age = this.now() - this.observedAt;
    return this.available && this.observedAt !== null && age >= 0 && age <= this.staleMs;
  }

  busy() {
    try { return this.getBusy() !== false; } catch { return true; }
  }

  isCurrent(candidate) {
    return !!candidate && !!this.candidate && candidate.id === this.candidate.id &&
      this.mode !== 'off' && candidate.mode === this.mode && this.fresh() &&
      this.applications.some(app => app.bundleId === this.candidate.bundleId &&
        app.pids.some(pid => this.candidate.pids.includes(pid))) && !this.busy();
  }

  update(snapshot) {
    const now = this.now();
    const observedAt = snapshot?.observedAt;
    if (snapshot?.available !== true || !Array.isArray(snapshot.processes) || snapshot.processes.length > 256 ||
        !Number.isFinite(observedAt) || observedAt > now || now - observedAt > this.staleMs ||
        (this.observedAt !== null && observedAt <= this.observedAt)) {
      this.invalidate();
      return this.snapshot();
    }
    if (this.observedAt !== null && observedAt - this.observedAt > this.staleMs) this.invalidate();
    this.observedAt = observedAt;
    this.available = true;
    this.applications = activeApplications(snapshot.processes);
    if (!this.applications.length) {
      this.activeSince.clear();
      this.candidate = null;
      this.inactiveSince ??= observedAt;
      if (observedAt - this.inactiveSince >= this.inactiveMs) this.consumed = false;
      return this.snapshot();
    }
    this.inactiveSince = null;
    const active = new Set(this.applications.map(app => app.bundleId));
    for (const bundleId of this.activeSince.keys()) if (!active.has(bundleId)) this.activeSince.delete(bundleId);
    for (const bundleId of active) if (!this.activeSince.has(bundleId)) this.activeSince.set(bundleId, observedAt);
    if (this.mode === 'off' || this.busy()) {
      this.suppress();
      return this.snapshot();
    }
    if (this.consumed) return this.snapshot();
    const app = this.applications.find(app => observedAt - this.activeSince.get(app.bundleId) >= this.stableMs);
    if (!app) return this.snapshot();
    this.candidate = Object.freeze({
      id:++this.sequence, mode:this.mode, reason:'microphone-activity',
      appName:app.name, kind:app.kind, bundleId:app.bundleId,
      pids:Object.freeze([...app.pids]),
    });
    this.consumed = true;
    const candidate = this.candidate;
    try {
      const result = this.onCandidate(candidate);
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => { if (this.candidate === candidate) this.candidate = null; });
    } catch { if (this.candidate === candidate) this.candidate = null; }
    return this.snapshot();
  }

  snapshot() {
    const fresh = this.fresh();
    return {
      mode:this.mode, available:fresh, active:fresh && this.applications.length > 0,
      state:this.mode === 'off' ? 'off' : !fresh ? 'unavailable' : !this.applications.length ? 'idle' : this.consumed ? 'handled' : 'pending',
      applications:fresh ? this.applications.map(app => ({...app, pids:[...app.pids]})) : [],
    };
  }
}

module.exports = {CallDetection, applicationFor};
