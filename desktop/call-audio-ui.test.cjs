const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(){
 const elements=new Map(),requests=[];let resolve;
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{hidden:true,pause(){},load(){},removeAttribute(key){delete this[key];}});return elements.get(id);}};
 const context=vm.createContext({document});
 vm.runInContext(fs.readFileSync(__dirname+'/ui/call-audio.js','utf8').replace('export function','function'),context);
 const controller=context.setupCallAudio({api:(url,options)=>{requests.push({url,options});return new Promise(r=>resolve=r);},onError:error=>{throw error;}});
 return {controller,requests,get:id=>document.getElementById(id),resolve:()=>resolve()};
}
test('saved recordings use local streamed playback and download after authentication',async()=>{
 const f=fixture();const ready=f.controller.render({id:'one',audio:{seconds:10}});
 assert.equal(f.get('saved-audio').hidden,true);f.resolve();await ready;
 assert.equal(f.get('call-audio').src,'/api/calls/one/audio');
 assert.equal(f.get('export-audio').href,'/api/calls/one/audio?download=true');
 assert.equal(f.get('saved-audio').hidden,false);
 await f.controller.render({id:'one',audio:{seconds:10}});assert.equal(f.requests.length,1);
 await f.controller.render({id:'two',audio:null});assert.equal(f.get('saved-audio').hidden,true);
 assert.equal(f.get('call-audio').src,undefined);
});
test('switching calls during media authentication cannot reveal stale audio',async()=>{
 const f=fixture();const pending=f.controller.render({id:'one',audio:{}});f.controller.clear();f.resolve();await pending;
 assert.equal(f.get('saved-audio').hidden,true);assert.equal(f.get('call-audio').src,undefined);
});
