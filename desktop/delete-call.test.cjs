const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function fixture(){
  const elements=new Map(),removed=[],deleted=[],errors=[];let current={id:'one',title:'Team call',status:'complete'},recording=false;
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{open:false,focus(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){}});return elements.get(id);}};
  const context=vm.createContext({document});vm.runInContext(fs.readFileSync(path.join(__dirname,'ui/delete-call.js'),'utf8').replace('export function','function'),context);
  const controller=context.setupDeleteCall({getCurrent:()=>current,isRecording:()=>recording,remove:async id=>removed.push(id),onDeleted:async id=>deleted.push(id),onError:error=>errors.push(error)});
  return {get:id=>document.getElementById('delete-'+id),removed,deleted,errors,controller,setCall:value=>{current=value;},record:value=>{recording=value;}};
}
test('canceling deletion never calls the API',async()=>{
  const f=fixture();f.get('call').onclick();assert.equal(f.get('dialog').open,true);assert.match(f.get('title').textContent,/Team call/);
  f.get('cancel').onclick();await f.get('confirm').onclick();assert.deepEqual(f.removed,[]);assert.equal(f.get('dialog').open,false);
});
test('confirmed saved call deletion refreshes the library once',async()=>{
  const f=fixture();f.get('call').onclick();const first=f.get('confirm').onclick();await f.get('confirm').onclick();await first;
  assert.deepEqual(f.removed,['one']);assert.deepEqual(f.deleted,['one']);assert.equal(f.get('dialog').open,false);
});
test('active recording or changed selection prevents deletion even after confirmation opened',async()=>{
  for(const change of [f=>f.record(true),f=>f.setCall({id:'one',status:'recording'}),f=>f.setCall({id:'two',status:'complete'})]){
    const f=fixture();f.get('call').onclick();change(f);await f.get('confirm').onclick();assert.deepEqual(f.removed,[]);
  }
  const f=fixture();f.record(true);f.controller.render();assert.equal(f.get('call').disabled,true);f.get('call').onclick();assert.equal(f.get('dialog').open,false);
});
