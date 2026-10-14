const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CallTray,presentation}=require('./tray.cjs');
const idle={phase:'idle',engine:'ready',busy:false,seconds:0};
test('call detection menu reflects the saved mode and changes it only on selection',()=>{
  const choices=[];
  class Tray {on(){} setTitle(){} setToolTip(){}}
  const tray=new CallTray({Tray,Menu:{buildFromTemplate:items=>items},nativeImage:{createFromPath:()=>({setTemplateImage(){}})},setDetection:mode=>choices.push(mode)});
  tray.setDetection({mode:'auto',available:true});
  const items=tray.menu().find(item=>item.label==='Call detection').submenu;
  assert.deepEqual(choices,[]);
  assert.equal(items.find(item=>item.label==='Start transcription automatically').checked,true);
  items.find(item=>item.label==='Off').click();assert.deepEqual(choices,['off']);
  tray.setDetection({mode:'ask',available:false});
  assert(tray.detectionMenu().submenu.some(item=>item.label==='Detection unavailable'));
});
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
test('menu shows meeting countdown, join action and selectable reminder timing without replacing recording time',()=>{
  let title,joined,lead;
  class Tray {on(){} setTitle(value){title=value;} setToolTip(){}}
  const tray=new CallTray({Tray,Menu:{buildFromTemplate:items=>items},nativeImage:{createFromPath:()=>({setTemplateImage(){}})},show(){},start(){},stop(){},quit(){},join:key=>{joined=key;},setReminder:value=>{lead=value;},version:'0.2.3'});
  tray.update(idle);tray.setMeetings({title:'Call in 30s',connected:true,leadSeconds:60,events:[{key:'one',title:'Team call',timing:'In 30s',start:'2026-10-13T12:00:00Z',canJoin:true}]});
  assert.equal(title,'Call in 30s');
  tray.menu().find(item=>item.label==='In 30s · Team call').submenu.find(item=>item.label==='Join call').click();assert.equal(joined,'one');
  tray.menu().find(item=>item.label==='Meeting reminder').submenu.find(item=>item.label==='30 seconds before').click();assert.equal(lead,30);
  tray.update({phase:'recording',seconds:61});assert.equal(title,'● 01:01');
});
