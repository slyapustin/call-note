const {test} = require('node:test');
const assert = require('node:assert/strict');
const {CallDetection, applicationFor} = require('./call-detection.cjs');

const zoom = {pid:100, bundleId:'us.zoom.xos', inputActive:true};
const chrome = {pid:101, bundleId:'com.google.Chrome', inputActive:true};

function fixture(options = {}) {
  let now = 100000, busy = false;
  const candidates = [];
  const detector = new CallDetection({now:() => now, getBusy:() => busy, onCandidate:candidate => candidates.push(candidate), ...options});
  const poll = (processes = [zoom], elapsed = 1000) => { now += elapsed; return detector.update({available:true, observedAt:now, processes}); };
  const repeat = (seconds, processes = [zoom]) => { for (let i = 0; i < seconds; i++) poll(processes); };
  return {detector, candidates, poll, repeat, setBusy:value => busy = value, advance:ms => now += ms, now:() => now};
}

test('default asks once after sustained activity and labels browser microphone activity honestly', () => {
  const f = fixture();
  f.poll([chrome]); f.repeat(4, [chrome]);
  assert.equal(f.candidates.length, 0);
  f.poll([chrome]);
  assert.equal(f.candidates.length, 1);
  assert.deepEqual({...f.candidates[0]}, {id:1, mode:'ask', reason:'microphone-activity', appName:'Google Chrome', kind:'browser', bundleId:'com.google.Chrome', pids:[101]});
  f.repeat(100, [chrome]);
  assert.equal(f.candidates.length, 1);
});

test('only recognized application identities and genuine active input records count', () => {
  for (const id of ['local.calldesk.preview', 'com.callnote.app', 'com.apple.WebKit.GPU', 'com.apple.WebKit.WebContent', 'com.github.Electron', 'com.google.ChromeFake', 'com.google.Chrome.evil', 'com.microsoft.edgemac-unrelated', 'us.zoom.xos.malicious', 'com.apple.SafariTechnologyPreview']) {
    assert.equal(applicationFor(id), null, id);
  }
  assert.equal(applicationFor('com.google.Chrome.helper.renderer').name, 'Google Chrome');
  assert.equal(applicationFor('com.microsoft.edgemac.helper').name, 'Microsoft Edge');
  for (const id of ['us.zoom.xos', 'com.microsoft.teams2', 'com.microsoft.teams', 'org.mozilla.firefox', 'com.apple.Safari']) assert.ok(applicationFor(id));
  const f = fixture();
  f.repeat(20, [null, {...zoom, inputActive:'true'}, {...zoom, inputActive:false}, {...zoom, pid:0}, {...zoom, pid:1.5}, {pid:100, bundleId:'com.apple.WebKit.GPU', inputActive:true}]);
  assert.equal(f.candidates.length, 0);
  assert.equal(f.detector.snapshot().active, false);
});

test('brief inactivity resets stabilization and helper processes produce only one candidate', () => {
  const f = fixture();
  f.repeat(4); f.poll([]); f.repeat(5);
  assert.equal(f.candidates.length, 0);
  f.poll();
  assert.equal(f.candidates.length, 1);
  f.repeat(10, [zoom, {...zoom, pid:102}, chrome]);
  assert.equal(f.candidates.length, 1);
});

test('switching applications cannot inherit another application stabilization time', () => {
  const f = fixture(); f.repeat(5); f.repeat(5, [chrome]);
  assert.equal(f.candidates.length, 0);
  f.poll([chrome]);
  assert.equal(f.candidates[0].appName, 'Google Chrome');
});

test('dismissal and manual stop consume the entire episode until 60 seconds of observed inactivity', () => {
  const f = fixture(); f.repeat(6);
  assert.equal(f.candidates.length, 1);
  f.detector.suppress(); f.repeat(10); f.repeat(60, []); f.repeat(6);
  assert.equal(f.candidates.length, 1, '59 seconds between inactive observations is insufficient');
  f.repeat(61, []); f.repeat(6);
  assert.equal(f.candidates.length, 2);
});

test('recording, preparing or other busy states consume activity and never restart after becoming idle', () => {
  const f = fixture({mode:'auto'}); f.setBusy(true); f.repeat(6);
  assert.equal(f.candidates.length, 0);
  f.setBusy(false); f.repeat(30);
  assert.equal(f.candidates.length, 0);
  f.repeat(61, []); f.repeat(6);
  assert.equal(f.candidates[0].mode, 'auto');
});

test('off is silent, auto requires explicit mode selection, and invalid modes cannot enable recording', () => {
  const f = fixture({mode:'off'}); f.repeat(6);
  assert.equal(f.candidates.length, 0);
  assert.equal(f.detector.snapshot().state, 'off');
  assert.throws(() => f.detector.setMode('automatic'), /Invalid/);
  assert.equal(f.detector.snapshot().mode, 'off');
  f.detector.setMode('auto'); f.repeat(6);
  assert.equal(f.candidates.length, 0, 'enabling auto does not replay an already consumed episode');
  f.repeat(61, []); f.repeat(6);
  assert.equal(f.candidates[0].mode, 'auto');
});

test('unavailable, stale, repeated, malformed and future snapshots cannot establish sustained activity', () => {
  for (const invalid of [f => ({available:false}), f => ({available:true, observedAt:f.now() - 4000, processes:[zoom]}), f => ({available:true, observedAt:f.now(), processes:[zoom]}), f => ({available:true, observedAt:f.now() + 1, processes:[zoom]}), f => ({available:true, observedAt:f.now() + 1, processes:'invalid'})]) {
    const f = fixture(); f.repeat(4);
    assert.equal(f.detector.update(invalid(f)).available, false);
    f.repeat(5); assert.equal(f.candidates.length, 0);
    f.poll(); assert.equal(f.candidates.length, 1);
  }
  const f = fixture(); f.repeat(4); f.advance(10000); f.repeat(5);
  assert.equal(f.candidates.length, 0);
  f.poll(); assert.equal(f.candidates.length, 1);
});

test('probe outages do not count as inactive cooldown or re-arm an already handled episode', () => {
  const f = fixture(); f.repeat(6);
  f.detector.update({available:false}); f.advance(120000); f.repeat(10);
  assert.equal(f.candidates.length, 1);
  f.repeat(30, []); f.detector.update({available:false}); f.advance(40000); f.repeat(31, []); f.repeat(6);
  assert.equal(f.candidates.length, 1);
});

test('notification candidates are valid only while current, fresh, active, enabled and idle', () => {
  const f = fixture(); f.repeat(6); const candidate = f.candidates[0];
  assert.equal(f.detector.isCurrent(candidate), true);
  f.setBusy(true); assert.equal(f.detector.isCurrent(candidate), false);
  f.setBusy(false); f.advance(3001); assert.equal(f.detector.isCurrent(candidate), false);
  assert.equal(f.detector.snapshot().available, false);
  f.poll(); assert.equal(f.detector.isCurrent(candidate), false, 'a stale gap permanently invalidates the old notification');
  const g = fixture(); g.repeat(6); const other = g.candidates[0];
  g.poll([]); assert.equal(g.detector.isCurrent(other), false);
  g.repeat(2); assert.equal(g.detector.isCurrent(other), false);
  const h = fixture(); h.repeat(6); const last = h.candidates[0];
  h.detector.setMode('auto'); assert.equal(h.detector.isCurrent(last), false);
});

test('a different active app or replacement process cannot validate an old notification', () => {
  const f = fixture(); f.repeat(6); const candidate = f.candidates[0];
  f.poll([chrome]);
  assert.equal(f.detector.isCurrent(candidate), false);
  f.poll([{...zoom, pid:999}]);
  assert.equal(f.detector.isCurrent(candidate), false);
});

test('callback failures consume the episode without repeated prompts or unhandled rejections', async () => {
  for (const onCandidate of [() => {throw Error('failed');}, () => Promise.reject(Error('failed'))]) {
    let attempts = 0;
    const f = fixture({onCandidate:candidate => {attempts++; return onCandidate(candidate);}});
    f.repeat(6); await Promise.resolve(); await Promise.resolve();
    f.repeat(30);
    assert.equal(attempts, 1);
    assert.equal(f.detector.isCurrent({id:1, mode:'ask'}), false);
  }
});

test('a late rejection from a previous episode cannot invalidate the current candidate', async () => {
  let rejectFirst;
  const candidates = [];
  const f = fixture({onCandidate:candidate => {
    candidates.push(candidate);
    if (candidates.length === 1) return new Promise((resolve, reject) => {rejectFirst = reject;});
  }});
  f.repeat(6); f.repeat(61, []); f.repeat(6);
  rejectFirst(Error('old notification failed'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.detector.isCurrent(candidates[1]), true);
});

test('activity ending only invalidates a suggestion; it never invokes recording stop actions', () => {
  const f = fixture({mode:'auto'}); f.repeat(6);
  const candidate = f.candidates[0];
  f.repeat(90, []);
  assert.equal(f.candidates.length, 1);
  assert.equal(f.detector.isCurrent(candidate), false);
  assert.equal(f.detector.snapshot().state, 'idle');
});
