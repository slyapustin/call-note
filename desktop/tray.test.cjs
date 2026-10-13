const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CallTray,presentation}=require('./tray.cjs');
const idle={phase:'idle',engine:'ready',busy:false,seconds:0};
test('call actions follow engine and recording state',()=>{
  assert.equal(presentation(idle).canStart,true);
  for(const state of [{...idle,engine:'loading'},{...idle,engine:'error'},{...idle,busy:true},{...idle,phase:'preparing'},{...idle,phase:'saving'}]) {
    assert.equal(presentation(state).canStart,false);assert.equal(presentation(state).canStop,false);
  }
  const active=presentation({...idle,phase:'recording',seconds:125});
  assert.equal(active.title,'● 02:05');assert.equal(active.canStart,false);assert.equal(active.canStop,true);
});
test('tray actions cannot start twice and menu includes active sources',()=>{
  let starts=0,stops=0;
  class Tray {on(){} setTitle(){} setToolTip(){}}
  const tray=new CallTray({Tray,Menu:{buildFromTemplate:items=>items},nativeImage:{createFromPath:()=>({setTemplateImage(){}})},show(){},start(){starts++;},stop(){stops++;},quit(){},version:'0.2.1'});
  tray.update(idle);
  const start=tray.menu().find(item=>item.label==='Start new call');start.click();start.click();assert.equal(starts,1);
  tray.update({phase:'recording',microphone:true,system:true,seconds:61});
  assert(tray.menu().some(item=>item.label==='Microphone + System audio'));
  const stop=tray.menu().find(item=>item.label==='Stop & save call');stop.click();stop.click();assert.equal(stops,1);
  assert.equal(tray.state.phase,'saving');
});
