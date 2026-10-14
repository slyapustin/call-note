const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function fixture(prepare) {
  const calls=[];
  const source=fs.readFileSync(path.join(__dirname,'ui/app.js'),'utf8');
  const capture=source.slice(source.indexOf('class Capture {'),source.indexOf('\nasync function finish('));
  const context=vm.createContext({
    $:id=>({checked:id==='mic'}),session:{platform:'win32'},
    api:async(route,options)=>{calls.push([route,options.method]);return prepare();},
    window:{callDesk:{microphone:async()=>{calls.push('microphone');return false;}}},
  });
  vm.runInContext(capture+'\nthis.Capture=Capture;',context);
  return {calls,capture:new context.Capture()};
}
test('preparing a resting model completes before opening microphone capture',async()=>{
  let prepared;const f=fixture(()=>new Promise(resolve=>{prepared=resolve;}));
  const pending=f.capture.start();
  assert.deepEqual(f.calls,[['/engine/prepare','POST']]);
  prepared();await assert.rejects(pending,/Windows Settings/);
  assert.deepEqual(f.calls,[['/engine/prepare','POST'],'microphone']);
});
test('failed model preparation never opens audio devices',async()=>{
  const f=fixture(async()=>{throw Error('Model unavailable');});
  await assert.rejects(f.capture.start(),/Model unavailable/);
  assert.deepEqual(f.calls,[['/engine/prepare','POST']]);
});
