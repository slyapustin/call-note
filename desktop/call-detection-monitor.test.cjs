const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {CallDetectionMonitor}=require('./call-detection-monitor.cjs');

const active=()=>JSON.stringify({available:true,processes:[{pid:101,bundleId:'us.zoom.xos',inputActive:true}]});
function fixture(t,{saved,filesystem=fs,execute}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'call-note-detection-monitor-'));
  const settingsFile=path.join(directory,'detection.json');
  if(saved!==undefined)fs.writeFileSync(settingsFile,typeof saved==='string'?saved:JSON.stringify(saved));
  let now=10000;
  const calls=[],changes=[],candidates=[];
  const monitor=new CallDetectionMonitor({helper:'/application/audio-activity',settingsFile,filesystem,now:()=>now,getBusy:()=>false,
    onCandidate:value=>candidates.push(value),onChange:value=>changes.push(value),
    execute:execute||((...args)=>{calls.push({file:args[0],args:args[1],options:args[2],done:args[3]});})});
  t.after(()=>{monitor.stop();fs.rmSync(directory,{recursive:true,force:true});});
  return {monitor,directory,settingsFile,calls,changes,candidates,advance:(ms=2000)=>{now+=ms;}};
}

test('poll invokes only the helper with bounded execution options and publishes valid activity',async t=>{
  const f=fixture(t);f.monitor.running=true;
  const pending=f.monitor.poll();
  assert.deepEqual(f.calls[0],{file:'/application/audio-activity',args:['--once'],options:{timeout:1800,maxBuffer:512*1024,encoding:'utf8'},done:f.calls[0].done});
  f.calls[0].done(null,active());await pending;
  assert.equal(f.monitor.status().available,true);
  assert.equal(f.monitor.status().active,true);
  assert.equal(f.changes.length,1);
});

test('timeouts, process errors, and invalid output become unavailable rather than idle',async t=>{
  const f=fixture(t);f.monitor.running=true;
  const failures=[
    {error:Object.assign(Error('timed out'),{code:'ETIMEDOUT',killed:true})},
    {error:Object.assign(Error('buffer full'),{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'})},
    {error:Object.assign(Error('helper missing'),{code:'ENOENT'})},
    {stdout:'not json'},
    {stdout:'null'},
    {stdout:'{"available":false,"processes":[]}'},
    {stdout:'{"available":true,"processes":{}}'},
  ];
  for(const failure of failures) {
    f.advance();const valid=f.monitor.poll();f.calls.at(-1).done(null,active());await valid;
    assert.equal(f.monitor.status().active,true);
    f.advance();const pending=f.monitor.poll();f.calls.at(-1).done(failure.error||null,failure.stdout);await pending;
    assert.equal(f.monitor.status().state,'unavailable');
    assert.equal(f.monitor.status().available,false);
    assert.equal(f.monitor.status().active,false);
  }
});

test('a synchronous helper launch failure is handled as unavailable',async t=>{
  const f=fixture(t,{execute:()=>{throw Error('cannot spawn');}});f.monitor.running=true;
  await f.monitor.poll();
  assert.equal(f.monitor.status().state,'unavailable');
  assert.equal(f.monitor.pending,null);
});

test('concurrent polls share one helper execution until its result settles',async t=>{
  const f=fixture(t);f.monitor.running=true;
  const pending=[f.monitor.poll(),f.monitor.poll(),f.monitor.poll()];
  assert.equal(f.calls.length,1);
  f.calls[0].done(null,active());await Promise.all(pending);
  assert.equal(f.changes.length,1);
  f.advance();const next=f.monitor.poll();assert.equal(f.calls.length,2);
  f.calls[1].done(null,active());await next;
});

test('Off neither launches helpers nor accepts an older in-flight result',async t=>{
  const f=fixture(t);f.monitor.running=true;
  const pending=f.monitor.poll();
  f.monitor.setMode('off');const changes=f.changes.length;
  f.calls[0].done(null,active());await pending;
  await f.monitor.poll();
  assert.equal(f.calls.length,1);
  assert.equal(f.changes.length,changes);
  assert.equal(f.monitor.status().state,'off');
  assert.equal(f.monitor.status().active,false);
  assert.equal(f.candidates.length,0);
  const alreadyOff=fixture(t,{saved:{schema:1,mode:'off'}});alreadyOff.monitor.running=true;
  await alreadyOff.monitor.poll();assert.equal(alreadyOff.calls.length,0);
});

test('Stop discards in-flight activity and blocks subsequent polls and candidate actions',async t=>{
  const f=fixture(t);f.monitor.running=true;
  const pending=f.monitor.poll();f.monitor.stop();const changes=f.changes.length;
  f.calls[0].done(null,active());await pending;await f.monitor.poll();
  assert.equal(f.changes.length,changes);
  assert.equal(f.calls.length,1);
  assert.equal(f.monitor.status().state,'unavailable');
  assert.equal(f.monitor.isCurrent({id:1,mode:'ask'}),false);
});

test('successful mode changes persist atomically and are restored on restart',t=>{
  const f=fixture(t);assert.equal(f.monitor.status().mode,'ask');
  assert.equal(f.monitor.setMode('auto').mode,'auto');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.settingsFile,'utf8')),{schema:1,mode:'auto'});
  assert.equal(fs.statSync(f.settingsFile).mode&0o777,0o600);
  assert.deepEqual(fs.readdirSync(f.directory),['detection.json']);
  const restored=new CallDetectionMonitor({helper:'unused',settingsFile:f.settingsFile});
  assert.equal(restored.status().mode,'auto');
  assert.throws(()=>f.monitor.setMode('sometimes'),/Invalid/);
  assert.equal(f.monitor.status().mode,'auto');
});

test('failed preference writes or renames preserve the previous mode and clean temporary files',t=>{
  for(const operation of ['writeFileSync','renameSync']) {
    const filesystem={...fs,[operation]:()=>{throw Object.assign(Error('disk unavailable'),{code:'EACCES'});}};
    const f=fixture(t,{saved:{schema:1,mode:'ask'},filesystem});
    assert.throws(()=>f.monitor.setMode('auto'),/disk unavailable/);
    assert.equal(f.monitor.status().mode,'ask');
    assert.deepEqual(JSON.parse(fs.readFileSync(f.settingsFile,'utf8')),{schema:1,mode:'ask'});
    assert.deepEqual(fs.readdirSync(f.directory),['detection.json']);
    assert.equal(f.changes.length,0);
  }
});

test('unrecognized or corrupt saved preferences fall back to Ask',t=>{
  for(const saved of ['broken json',{schema:2,mode:'auto'},{schema:1,mode:'unknown'}]) {
    assert.equal(fixture(t,{saved}).monitor.status().mode,'ask');
  }
});

test('stop and restart during a pending poll cannot create duplicate polling loops',async t=>{
  const timers=new Map();
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const token={unref(){}};timers.set(token,{callback,delay});return token;});
  t.mock.method(globalThis,'clearTimeout',token=>timers.delete(token));
  const f=fixture(t);
  f.monitor.start();assert.equal(f.calls.length,1);
  f.monitor.stop();f.monitor.start();assert.equal(f.calls.length,1);
  f.calls[0].done(null,active());
  await new Promise(setImmediate);
  assert.equal(timers.size,1);
  const [token,next]=[...timers][0];assert.equal(next.delay,2000);
  timers.delete(token);f.advance();const tick=next.callback();
  assert.equal(f.calls.length,2);
  f.monitor.stop();f.calls[1].done(null,active());await tick;
  assert.equal(timers.size,0);
  assert.equal(f.monitor.status().available,false);
});
