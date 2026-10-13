const path = require('node:path');
function elapsed(seconds) {
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
function presentation(state) {
  const duration=elapsed(state.seconds);
  const status=state.phase==='recording'?`Transcribing · ${duration}`:state.phase==='preparing'?'Preparing audio…':state.phase==='saving'?'Saving transcript…':state.engine==='ready'?(state.busy?'Processing audio…':'Ready for a call'):state.engine==='error'?'Transcription unavailable':'Loading speech model…';
  return {status, title:state.phase==='recording'?`● ${duration}`:state.phase==='saving'?'Saving…':'',
    canStart:state.phase==='idle'&&state.engine==='ready'&&!state.busy, canStop:state.phase==='recording'};
}
class CallTray {
  constructor({Tray, Menu, nativeImage, show, start, stop, quit, version}) {
    this.Menu=Menu;this.actions={show,start,stop,quit};this.version=version;
    this.state={phase:'idle',engine:'loading',busy:false,seconds:0,microphone:false,system:false};
    const icon=nativeImage.createFromPath(path.join(__dirname,'assets/callNoteTemplate.png'));
    icon.setTemplateImage(true);
    this.tray=new Tray(icon);
    this.tray.on('click',()=>this.tray.popUpContextMenu(this.menu()));
    this.tray.on('right-click',()=>this.tray.popUpContextMenu(this.menu()));
    this.update({});
  }
  update(value) {
    if (!value || typeof value!=='object') return;
    for (const key of ['busy','microphone','system']) if (typeof value[key]==='boolean') this.state[key]=value[key];
    if (['idle','preparing','recording','saving'].includes(value.phase)) this.state.phase=value.phase;
    if (['loading','ready','error'].includes(value.engine)) this.state.engine=value.engine;
    if (Number.isFinite(value.seconds)) this.state.seconds=Math.max(0,Math.floor(value.seconds));
    const view=presentation(this.state);
    this.tray.setTitle(view.title,{fontType:'monospacedDigit'});
    this.tray.setToolTip(`Call Note — ${view.status}`);
  }
  menu() {
    const view=presentation(this.state);
    const sources=[this.state.microphone?'Microphone':null,this.state.system?'System audio':null].filter(Boolean).join(' + ');
    return this.Menu.buildFromTemplate([
      {label:'Call Note',enabled:false},{label:view.status,enabled:false},
      ...(this.state.phase==='recording'?[{label:sources||'Capturing audio',enabled:false}]:[]),
      {type:'separator'},
      {label:'Open Call Note',click:this.actions.show},
      {label:'Start new call',enabled:view.canStart,click:()=>{if(!presentation(this.state).canStart)return;this.update({phase:'preparing'});this.actions.start();}},
      {label:'Stop & save call',enabled:view.canStop,click:()=>{if(!presentation(this.state).canStop)return;this.update({phase:'saving'});this.actions.stop();}},
      {type:'separator'},{label:'Transcription stays on this Mac',enabled:false},
      {label:`Version ${this.version}`,enabled:false},{label:'Quit Call Note',click:this.actions.quit}
    ]);
  }
}
module.exports={CallTray,presentation};
