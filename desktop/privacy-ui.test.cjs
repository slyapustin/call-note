const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const elements=new Map(),calls=[];
  let state={available:true,accepted:false,analytics:false,pendingDeletion:false,documents:{available:true,terms:'Terms',notice:'Notice'}};
  const document={activeElement:null,getElementById(id){
    if(!elements.has(id))elements.set(id,{checked:false,disabled:false,hidden:true,open:false,isConnected:true,listeners:{},
      addEventListener(name,fn){this.listeners[name]=fn;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},focus(){document.activeElement=this;}});
    return elements.get(id);
  }};
  const bridge={privacyStatus:async()=>state,
    privacyAccept:async()=>{calls.push('accept');state={...state,accepted:true};return state;},
    privacyAnalytics:async value=>{calls.push(['analytics',value]);state={...state,analytics:value};return state;},
    privacyDelete:async()=>{calls.push('delete');state={...state,analytics:false,pendingDeletion:true};return state;}};
  const context=vm.createContext({document});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'ui/privacy.js'),'utf8').replace('export function setupPrivacy','function setupPrivacy'),context);
  return {controller:context.setupPrivacy({bridge}),calls,get:id=>document.getElementById('privacy-'+id),context,setState:value=>{state={...state,...value};}};
}
test('terms and analytics begin unchecked; explicit terms alone continue with analytics off',async()=>{
  const f=fixture(),pending=f.controller.ensure();await settle();
  assert.equal(f.get('accepted').checked,false);assert.equal(f.get('choice').checked,false);
  await f.get('save').onclick();assert.deepEqual(f.calls,[]);assert.equal(f.get('dialog').open,true);
  f.get('accepted').checked=true;await f.get('save').onclick();
  assert.equal(await pending,true);assert.deepEqual(f.calls,['accept',['analytics',false]]);
});
test('Later and native dialog cancellation resolve the capture gate false',async()=>{
  for(const native of [false,true]) {
    const f=fixture(),pending=f.controller.ensure();await settle();
    if(native)f.get('dialog').close();else f.get('close').onclick();
    assert.equal(await pending,false);assert.deepEqual(f.calls,[]);
  }
});
test('canceled capture gate opens no audio device and makes no recording request',async()=>{
  const f=fixture(),calls=[];
  Object.assign(f.context,{privacy:f.controller,capture:null,ready:true,sampleRunning:false,
    Capture:class{constructor(){calls.push('capture');}},notice:()=>calls.push('notice'),window:{callDesk:{recording:()=>calls.push('recording')}}});
  const app=fs.readFileSync(path.join(__dirname,'ui/app.js'),'utf8');
  vm.runInContext(app.slice(app.indexOf('async function startCapture()'),app.indexOf("$('start').onclick")),f.context);
  const pending=f.context.startCapture();await settle();f.get('close').onclick();
  assert.equal(await pending,false);assert.deepEqual(calls,[]);
});
test('corrupt privacy storage in an enabled build cannot bypass terms acceptance',async()=>{
  const {registerPrivacy}=require('./privacy.cjs');
  const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'call-note-privacy-ui-'));
  try {
    fs.writeFileSync(path.join(directory,'analytics.json'),'{broken');
    const privacy=registerPrivacy({ipcMain:{handle(){},on(){}},trusted:()=>true,directory,
      version:'0.2.14',platform:'darwin',config:{enabled:true,publisher:'Test publisher',contact:'privacy@example.com',policyVersion:'2026-10-15',endpoint:'https://example.com'}});
    const state=privacy.status();
    assert.equal(state.documents.available,true);assert.equal(state.available,false);assert.equal(state.accepted,false);
    const f=fixture();f.setState(state);
    let resolved=false;
    const pending=f.controller.ensure().then(value=>{resolved=true;return value;});await settle();
    assert.equal(resolved,false);assert.equal(f.get('dialog').open,true);
    assert.equal(f.get('save').disabled,true);assert.match(f.get('status').textContent,/Privacy settings are unavailable/);
    f.get('close').onclick();assert.equal(await pending,false);assert.deepEqual(f.calls,[]);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
test('disabled builds and already accepted terms allow transcription without a consent prompt',async()=>{
  for(const state of [{available:false,documents:{available:false,terms:'',notice:''}},{available:false,accepted:true}]) {
    const f=fixture();f.setState(state);
    assert.equal(await f.controller.ensure(),true);assert.equal(f.get('dialog').open,false);assert.deepEqual(f.calls,[]);
  }
});
test('explicit optout calls analytics false without repeating acceptance',async()=>{
  const f=fixture();f.setState({accepted:true,analytics:true});await f.controller.open();
  f.get('choice').checked=false;await f.get('save').onclick();assert.deepEqual(f.calls,[['analytics',false]]);
});
test('pending deletion displays pending state and disables consent controls',async()=>{
  const f=fixture();f.setState({accepted:true,analytics:true});await f.controller.open();
  f.get('delete').onclick();assert.equal(f.get('delete-confirm').hidden,false);
  await f.get('delete-confirm-button').onclick();
  assert.equal(f.get('choice').checked,false);assert.equal(f.get('choice').disabled,true);assert.equal(f.get('save').disabled,true);
  assert.match(f.get('status').textContent,/pending/);
});
