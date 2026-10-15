const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture() {
  const elements=new Map(),requests=[];
  const element=()=>({value:'',children:[],listeners:{},focus(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(k,fn){this.listeners[k]=fn;},replaceChildren(...items){this.children=items;},append(item){this.children.push(item);}});
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
  const ctx=vm.createContext({document});
  vm.runInContext(fs.readFileSync(__dirname+'/ui/speaker-names.js','utf8').replace(/export /g,''),ctx);
  let call={id:'one',status:'complete',segments:[],speaker_names:[]},saved,failure=false;
  const ui=ctx.setupSpeakerNames({getCurrent:()=>call,api:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});if(failure)throw Error('Try again');return call;},onSaved:value=>{saved=value;}});
  return {ui,call,requests,get:id=>document.getElementById('speaker-'+id),submit:()=>document.getElementById('speaker-form').onsubmit({preventDefault(){}}),saved:()=>saved,fail:()=>{failure=true;}};
}
test('known speaker naming defaults to the whole call and saves the selected scope',async()=>{
  const f=fixture();f.ui.open({id:4,source:'system',speaker:2},{focus(){}});
  assert.equal(f.get('scope').value,'speaker');
  f.get('name').value='Alice';await f.submit();
  assert.deepEqual(f.requests,[{path:'/calls/one/segments/4/speaker',body:{name:'Alice',scope:'speaker'}}]);
  assert.equal(f.saved(),f.call);assert.equal(f.get('dialog').open,false);
});
test('uncertain lines can only be named individually and failed saves retain the editor',async()=>{
  const f=fixture();f.ui.open({id:5,source:'system',speaker:null},{focus(){}});
  assert.equal(f.get('scope').value,'segment');assert.equal(f.get('scope').children.length,1);
  f.get('name').value='Bob';f.fail();await f.submit();
  assert.equal(f.get('dialog').open,true);assert.equal(f.get('error').textContent,'Try again');
  assert.equal(f.get('name').value,'Bob');assert.equal(f.get('save').disabled,false);
});
test('recording calls cannot open the name editor',()=>{
  const f=fixture();f.call.status='recording';f.ui.open({id:1,source:'microphone'},{});
  assert.ok(!f.get('dialog').open);
});
