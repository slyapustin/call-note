const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {Updates} = require('./updates.cjs');

function fixture(t) {
  const updater=new EventEmitter(), nativeUpdater=new EventEmitter();
  let checks=0, installs=0, recording=false;
  updater.setFeedURL=value=>{updater.feed=value;};
  updater.checkForUpdates=async()=>{checks++;updater.emit('update-not-available');};
  updater.quitAndInstall=()=>{installs++;};
  const updates=new Updates({updater,nativeUpdater,enabled:true,notify:()=>{},isRecording:()=>recording});
  return {updates,updater,nativeUpdater,checks:()=>checks,installs:()=>installs,record:value=>{recording=value;}};
}
test('public releases require no credentials and refuse downgrades',t=>{
  const f=fixture(t);
  assert.deepEqual(f.updater.feed,{provider:'github',owner:'slyapustin',repo:'call-note'});
  assert.equal(f.updater.allowDowngrade,false);
  assert.equal(f.updater.allowPrerelease,false);
  assert.equal(f.updater.autoDownload,true);
  assert.equal(f.updater.autoInstallOnAppQuit,true);
});
test('simultaneous checks do not start duplicate downloads',async t=>{
  const f=fixture(t);let resolve,checks=0;
  f.updater.checkForUpdates=()=>{checks++;return new Promise(r=>{resolve=r;});};
  const pending=f.updates.check();await f.updates.check();assert.equal(checks,1);
  resolve();await pending;
});
test('restart requires native signature verification and refuses active calls',t=>{
  const f=fixture(t);
  f.updater.emit('update-downloaded',{version:'0.3.0'});
  assert.throws(()=>f.updates.install(),/No downloaded/);
  f.nativeUpdater.emit('update-downloaded');f.record(true);
  assert.throws(()=>f.updates.install(),/Stop and save/);assert.equal(f.installs(),0);
  f.record(false);f.updates.install();assert.equal(f.installs(),1);
});
test('network failure does not expose tokens and can be retried',async t=>{
  const f=fixture(t);
  f.updater.checkForUpdates=async()=>{throw Error('authorization: secret');};
  await f.updates.check();assert.equal(f.updates.status().phase,'error');
  assert(!JSON.stringify(f.updates.status()).includes('secret'));
  assert.equal(f.updates.busy,false);
});
test('a missing stable update package offers manual downloads without claiming a network failure',async t=>{
  const f=fixture(t);
  f.updater.checkForUpdates=async()=>{throw Object.assign(Error('404 latest-mac.yml'),{code:'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'});};
  await f.updates.check();
  assert.equal(f.updates.status().phase,'unavailable');
  assert.match(f.updates.status().message,/View downloads/);
  assert.equal(f.updates.busy,false);
  f.updater.checkForUpdates=async()=>f.updater.emit('update-not-available');
  await f.updates.check();
  assert.equal(f.updates.status().phase,'current');
});

test('development builds do not check or download updates',async t=>{
  const f=fixture(t);f.updates.enabled=false;
  await f.updates.check();assert.equal(f.checks(),0);
});
