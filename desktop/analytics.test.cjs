const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {AnalyticsManager, POLICY_VERSION} = require('./analytics.cjs');
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'call-note-analytics-'));
  const requests = [];
  const config = {directory, endpoint: 'https://telemetry.example', version: '0.2.13', platform: 'darwin',
    fetch: async (url, init) => {requests.push({url, ...init, data: JSON.parse(init.body)}); return {ok: true};}, ...options};
  const manager = new AnalyticsManager(config);
  t.after(() => {manager.stop(); fs.rmSync(directory, {recursive: true, force: true});});
  return {manager, requests, directory, config};
}
test('no identity, network, or events before explicit terms acceptance', async t => {
  const {manager, requests, directory} = fixture(t);
  manager.start(); assert.equal(manager.track('app_open'), false); await manager.flush();
  assert.equal(requests.length, 0); assert.equal(fs.existsSync(path.join(directory, 'analytics.json')), false);
  await manager.acceptTerms(); await manager.flush();
  assert.equal(requests.length, 1); assert.equal(requests[0].data.analytics, false);
  assert.equal(manager.status().analytics, false);
  assert.equal('secret' in manager.status(), false); assert.equal('installationId' in manager.status(), false);
  assert.equal(fs.statSync(path.join(directory, 'analytics.json')).mode & 0o777, 0o600);
});
test('only explicit optin queues bounded whitelisted events and sends consent first', async t => {
  const {manager, requests} = fixture(t);
  await manager.acceptTerms(); await manager.setAnalytics(true);
  for(let i = 0; i < 120; i++) manager.track('call_completed', {durationMinutes: 99999, transcript: 'private', path: '/private', deviceName: 'private'});
  assert.equal(manager.state.events.length, 100);
  assert.equal(manager.state.events[0].durationMinutes, 1440);
  assert.equal(manager.track('transcript'), false);
  await manager.flush();
  assert.ok(requests[0].url.endsWith('/consent')); assert.ok(requests[1].url.endsWith('/events'));
  assert.equal(requests[1].data.events.length, 20); assert.equal(JSON.stringify(requests).includes('private'), false);
});
test('withdrawal during consent request clears queue and blocks event upload', async t => {
  let release;
  const calls = [];
  const {manager} = fixture(t, {fetch: async (url, init) => {
    calls.push({url, data: JSON.parse(init.body)});
    if(calls.length === 1) await new Promise(resolve => {release = resolve;});
    return {ok: true};
  }});
  await manager.acceptTerms(); await manager.setAnalytics(true); manager.track('app_open');
  const flushing = manager.flush(); await manager.setAnalytics(false); release(); await flushing; await manager.flush();
  assert.equal(manager.state.events.length, 0); assert.equal(manager.track('app_open'), false);
  assert.equal(calls.length, 2); assert.equal(calls[1].data.analytics, false);
  assert.ok(calls[1].data.revision > calls[0].data.revision);
});
test('older terms require reacceptance and do not upload', async t => {
  const {manager, config, requests, directory} = fixture(t);
  await manager.acceptTerms(); await manager.setAnalytics(true);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'analytics.json'))); saved.termsVersion = '2025-01-01';
  fs.writeFileSync(path.join(directory, 'analytics.json'), JSON.stringify(saved));
  const restored = new AnalyticsManager(config);
  assert.equal(restored.status().accepted, false); assert.equal(restored.status().analytics, false);
  await restored.flush(); assert.equal(requests.length, 0);
  await restored.acceptTerms(); assert.equal(restored.status().accepted, true); assert.equal(restored.status().analytics, false);
});
test('invalid endpoints never upload', async t => {
  for(const endpoint of [undefined, 'http://example.com', 'https://user:password@example.com', 'https://example.com/?secret=x']) {
    const {manager, requests} = fixture(t, {endpoint});
    await manager.acceptTerms(); await assert.rejects(manager.setAnalytics(true)); await manager.flush();
    assert.equal(manager.status().available, false); assert.equal(requests.length, 0);
  }
});
test('offline deletion retains credentials across restart and prevents new consent', async t => {
  const {manager, config, directory} = fixture(t, {fetch: async () => {throw Error('offline');}});
  await manager.acceptTerms(); await manager.setAnalytics(true);
  const id = manager.state.installationId;
  await manager.deleteData(); assert.equal(manager.status().pendingDeletion, true);
  assert.equal(manager.track('app_open'), false); await assert.rejects(manager.acceptTerms());
  const requests = [];
  const restored = new AnalyticsManager({...config, fetch: async (url, init) => {requests.push({url, data: JSON.parse(init.body)}); return {ok: true};}});
  await restored.flush(); assert.equal(requests[0].data.installationId, id);
  assert.equal(restored.status().accepted, false); assert.equal(restored.state.installationId, null);
  assert.equal(new AnalyticsManager(config).status().available, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'analytics.json'))).secret, null);
});
test('failed consent persistence fails closed', async t => {
  const {manager, requests} = fixture(t);
  await manager.acceptTerms();
  manager.fs = {...fs, writeFileSync() {throw Error('disk full');}};
  await assert.rejects(manager.setAnalytics(true)); assert.equal(manager.status().analytics, false);
  assert.equal(manager.track('app_open'), false); await manager.flush(); assert.equal(requests.length, 0);
});
test('expired events are discarded', async t => {
  let time = Date.UTC(2026, 9, 15, 12);
  const {manager, requests} = fixture(t, {now: () => time});
  await manager.acceptTerms(); await manager.setAnalytics(true); manager.track('app_open');
  time += 8 * 86400000; await manager.flush();
  assert.equal(manager.state.events.length, 0); assert.equal(requests.length, 1);
});
test('withdrawal aborts an event request already in flight', async t => {
  let eventSignal;
  let entered;
  const pending = new Promise(resolve => {entered = resolve;});
  const {manager} = fixture(t, {fetch: async (url, init) => {
    if(url.endsWith('/events')) {
      eventSignal = init.signal; entered();
      await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted')), {once: true}));
    }
    return {ok: true};
  }});
  await manager.acceptTerms(); await manager.setAnalytics(true); manager.track('app_open');
  const flushing = manager.flush(); await pending; await manager.setAnalytics(false); await flushing;
  assert.equal(eventSignal.aborted, true); assert.equal(manager.state.events.length, 0);
});
test('corrupt schema fails closed without replacing existing identity', async t => {
  const {manager, config, directory, requests} = fixture(t);
  await manager.acceptTerms();
  const filename = path.join(directory, 'analytics.json');
  const saved = JSON.parse(fs.readFileSync(filename)); saved.schemaVersion = 'unknown'; fs.writeFileSync(filename, JSON.stringify(saved));
  const restored = new AnalyticsManager(config);
  assert.equal(restored.status().available, false); await assert.rejects(restored.acceptTerms());
  await restored.flush(); assert.equal(requests.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(filename)).installationId, saved.installationId);
});
test('legacy policy-date schema migrates identity while changed policies require reacceptance', async t => {
  const {manager, config, directory, requests} = fixture(t);
  await manager.acceptTerms(); await manager.setAnalytics(true); manager.track('app_open');
  const filename = path.join(directory, 'analytics.json');
  const saved = JSON.parse(fs.readFileSync(filename));
  saved.schemaVersion = '2026-10-15'; saved.termsVersion = '2026-01-01'; saved.privacyVersion = '2026-01-01';
  fs.writeFileSync(filename, JSON.stringify(saved));
  const restored = new AnalyticsManager(config);
  assert.equal(restored.status().available, true); assert.equal(restored.status().accepted, false);
  assert.equal(restored.state.installationId, saved.installationId); assert.equal(restored.state.events.length, 0);
  await restored.flush(); assert.equal(requests.length, 0);
  await restored.acceptTerms();
  const migrated = JSON.parse(fs.readFileSync(filename));
  assert.equal(migrated.schemaVersion, 1); assert.equal(migrated.installationId, saved.installationId);
  assert.equal(migrated.analytics, false);
});
test('oversized local state is rejected before reading its contents', async t => {
  const {manager, config, directory} = fixture(t);
  await manager.acceptTerms();
  fs.writeFileSync(path.join(directory, 'analytics.json'), ' '.repeat(128 * 1024 + 1));
  let read = false;
  const restored = new AnalyticsManager({...config, filesystem: {...fs, readFileSync() {read = true; throw Error('must not read');}}});
  assert.equal(read, false); assert.equal(restored.status().available, false);
});
test('deletion waits for aborted event request to settle before deleting identity', async t => {
  let entered, settleRequest;
  const eventEntered = new Promise(resolve => {entered = resolve;});
  const calls = [];
  const {manager} = fixture(t, {fetch: async (url, options) => {
    calls.push(url);
    if(url.endsWith('/events')) {entered(); await new Promise(resolve => {settleRequest = resolve;});}
    return {ok: true};
  }});
  await manager.acceptTerms(); await manager.setAnalytics(true); manager.track('app_open');
  const flushing = manager.flush(); await eventEntered;
  const deleting = manager.deleteData();
  assert.equal(manager.status().pendingDeletion, true); assert.equal(calls.length, 2);
  await assert.rejects(manager.acceptTerms());
  settleRequest(); await flushing; await deleting;
  assert.ok(calls[2].endsWith('/installation')); assert.equal(manager.state.secret, null);
});
test('invalid required properties cannot poison a valid upload batch', async t => {
  const {manager, requests} = fixture(t);
  await manager.acceptTerms(); await manager.setAnalytics(true);
  for(const props of [{}, {feature: 'bad'}, {feature: 1}, {feature: null}]) assert.equal(manager.track('feature_used', props), false);
  for(const props of [{}, {errorCode: 'raw private error'}, {errorCode: 1}, {errorCode: null}]) assert.equal(manager.track('error', props), false);
  assert.equal(manager.track('feature_used', {feature: 'calendar', extra: 'private', errorCode: 'other'}), true);
  assert.equal(manager.track('error', {errorCode: 'other', feature: 'calendar', message: 'private'}), true);
  assert.equal(manager.track('call_completed', {durationMinutes: 'private'}), true);
  await manager.flush();
  const events = requests[1].data.events;
  assert.equal(events.length, 3);
  assert.equal(events[0].feature, 'calendar'); assert.equal(Object.hasOwn(events[0], 'errorCode'), false);
  assert.equal(events[1].errorCode, 'other'); assert.equal(Object.hasOwn(events[1], 'feature'), false);
  assert.equal(Object.hasOwn(events[2], 'durationMinutes'), false);
  assert.equal(JSON.stringify(events).includes('private'), false);
});
test('restored queue filters missing and invalid conditional properties and versions', async t => {
  const {manager, config, directory, requests} = fixture(t);
  await manager.acceptTerms(); await manager.setAnalytics(true); manager.track('app_open');
  const filename = path.join(directory, 'analytics.json');
  const saved = JSON.parse(fs.readFileSync(filename));
  const event = saved.events[0];
  saved.events.push(...[
    {name: 'feature_used'}, {name: 'feature_used', feature: 'bad'},
    {name: 'error'}, {name: 'error', errorCode: 4},
    {name: 'app_open', feature: 'calendar'}, {name: 'app_open', errorCode: 'other'},
    {name: 'call_completed', durationMinutes: '4'}, {name: 'call_completed', durationMinutes: 1441},
    {version: '10000.2.3'}, {day: '2026-02-30'},
  ].map(properties => ({...event, ...properties})));
  fs.writeFileSync(filename, JSON.stringify(saved));
  const restored = new AnalyticsManager(config);
  assert.equal(restored.state.events.length, 1);
  await restored.flush(); assert.equal(requests[1].data.events.length, 1);
});
test('versions match server limits of three or four numeric components up to four digits', async t => {
  for(const version of ['1.2.3', '9999.9999.9999', '1.2.3.4', '10000.2.3', '1.2.3-private']) {
    const {manager, requests} = fixture(t, {version});
    await manager.acceptTerms(); await manager.setAnalytics(true); manager.track('app_open'); await manager.flush();
    assert.equal(requests[1].data.events[0].version, ['10000.2.3', '1.2.3-private'].includes(version) ? '0.0.0' : version);
  }
});
