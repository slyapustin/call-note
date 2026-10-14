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
  const tray=new CallTray({platform:'darwin',Tray,Menu:{buildFromTemplate:items=>items},nativeImage:{createFromPath:()=>({setTemplateImage(){}})},show(){},start(){starts++;},stop(){stops++;},quit(){},version:'0.2.1'});
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
  const tray=new CallTray({platform:'darwin',Tray,Menu:{buildFromTemplate:items=>items},nativeImage:{createFromPath:()=>({setTemplateImage(){}})},show(){},start(){},stop(){},quit(){},join:key=>{joined=key;},setReminder:value=>{lead=value;},version:'0.2.3'});
  tray.update(idle);tray.setMeetings({title:'Call in 30s',connected:true,leadSeconds:60,events:[{key:'one',title:'Team call',timing:'In 30s',start:'2026-10-13T12:00:00Z',canJoin:true}]});
  assert.equal(title,'Call in 30s');
  tray.menu().find(item=>item.label==='In 30s · Team call').submenu.find(item=>item.label==='Join call').click();assert.equal(joined,'one');
  tray.menu().find(item=>item.label==='Meeting reminder').submenu.find(item=>item.label==='30 seconds before').click();assert.equal(lead,30);
  tray.update({phase:'recording',seconds:61});assert.equal(title,'● 01:01');
});

test('Windows tray uses a visible color icon and tooltip without macOS title APIs',()=>{
  let file,size,tip;
  class Tray {on(){} setToolTip(value){tip=value;}}
  const tray=new CallTray({platform:'win32',Tray,Menu:{buildFromTemplate:items=>items},nativeImage:{createFromPath:value=>{file=value;return {resize:value=>{size=value;return {};}};}},version:'0.3.0'});
  tray.update({...idle,phase:'recording',seconds:61});
  assert.match(file,/call-note\.png$/);assert.deepEqual(size,{width:32,height:32});assert.match(tip,/Transcribing · 01:01/);
});

test('a resting speech model permits starting a call without claiming it is loaded',()=>{
  const resting=presentation({...idle,engine:'idle'});
  assert.equal(resting.canStart,true);assert.match(resting.status,/resting/);
  assert.equal(presentation({...idle,engine:'idle',busy:true}).canStart,false);
});
