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

test('Windows NSIS download completes without waiting for the macOS native event',()=>{
  const updater=new EventEmitter(), nativeUpdater=new EventEmitter();let installs=0,recording=true;
  updater.setFeedURL=()=>{};updater.quitAndInstall=()=>{installs++;};
  const updates=new Updates({updater,nativeUpdater,platform:'win32',enabled:true,notify:()=>{},isRecording:()=>recording});
  updater.emit('update-downloaded',{version:'0.3.0'});
  assert.equal(updates.status().phase,'ready');
  assert.equal(nativeUpdater.listenerCount('update-downloaded'),0);
  assert.throws(()=>updates.install(),/Stop and save/);
  recording=false;updates.install();assert.equal(installs,1);
});

test('Windows previews and missing signing configuration cannot enable updates',async()=>{
  const {updateAvailability}=require('./updates.cjs');
  const base={platform:'win32',packaged:true,preview:false};
  const blocked=await updateAvailability({...base,preview:true,readConfig:()=>{throw Error('Must not read');}});
  assert.equal(blocked.enabled,false);assert.match(blocked.disabledReason,/Windows preview/);
  for(const publisherName of [undefined,'',[],[''],[null],true])assert.equal((await updateAvailability({...base,readConfig:async()=>({publisherName})})).enabled,false);
  assert.equal((await updateAvailability({...base,readConfig:async()=>{throw Error('missing');}})).enabled,false);
  assert.equal((await updateAvailability({...base,readConfig:async()=>({publisherName:'Example Publisher'})})).enabled,true);
  assert.equal((await updateAvailability({...base,platform:'darwin',readConfig:()=>{throw Error('Must not read');}})).enabled,true);
});

test('disabled preview updates do not download, install or run background timers',async()=>{
  const updater=new EventEmitter();updater.setFeedURL=()=>{};
  updater.checkForUpdates=()=>{throw Error('Must not check');};
  const updates=new Updates({updater,nativeUpdater:new EventEmitter(),platform:'win32',enabled:false,disabledReason:'Preview downloads only',notify:()=>{},isRecording:()=>false});
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);
  assert.equal(updates.status().message,'Preview downloads only');
  updates.start();assert.equal(updates.interval,undefined);
  await updates.check();assert.throws(()=>updates.install(),/Preview downloads only/);
});
