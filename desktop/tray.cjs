const path = require('node:path');
function elapsed(seconds) {
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
function presentation(state) {
  const duration=elapsed(state.seconds);
  const status=state.phase==='recording'?`Transcribing · ${duration}`:state.phase==='preparing'?'Preparing audio…':state.phase==='saving'?'Saving transcript…':state.engine==='ready'?(state.busy?'Processing audio…':'Ready for a call'):state.engine==='idle'?'Speech model resting · ready to start':state.engine==='error'?'Transcription unavailable':'Loading speech model…';
  return {status, title:state.phase==='recording'?`● ${duration}`:state.phase==='saving'?'Saving…':'',
    canStart:state.phase==='idle'&&['idle','ready'].includes(state.engine)&&!state.busy, canStop:state.phase==='recording'};
}
class CallTray {
  constructor({Tray, Menu, nativeImage, show, start, stop, quit, join, setReminder, setDetection, version, platform=process.platform}) {
    this.platform=platform;this.Menu=Menu;this.actions={show,start,stop,quit,join,setReminder,setDetection};this.version=version;
    this.detection={mode:'ask',available:false};
    this.meetings={events:[],leadSeconds:60};
    this.state={phase:'idle',engine:'loading',busy:false,seconds:0,microphone:false,system:false};
    let icon=nativeImage.createFromPath(path.join(__dirname,platform==='darwin'?'assets/callNoteTemplate.png':'assets/call-note.png'));
    if(platform==='darwin')icon.setTemplateImage(true);
    else icon=icon.resize({width:32,height:32});
    this.tray=new Tray(icon);
    this.tray.on('click',()=>this.tray.popUpContextMenu(this.menu()));
    this.tray.on('right-click',()=>this.tray.popUpContextMenu(this.menu()));
    this.update({});
  }
  update(value) {
    if (!value || typeof value!=='object') return;
    for (const key of ['busy','microphone','system']) if (typeof value[key]==='boolean') this.state[key]=value[key];
    if (['idle','preparing','recording','saving'].includes(value.phase)) this.state.phase=value.phase;
    if (['idle','loading','ready','error'].includes(value.engine)) this.state.engine=value.engine;
    if (Number.isFinite(value.seconds)) this.state.seconds=Math.max(0,Math.floor(value.seconds));
    const view=presentation(this.state);
    if(this.platform==='darwin')this.tray.setTitle(view.title||(this.state.phase==='idle'?this.meetings.title||'':''),{fontType:'monospacedDigit'});
    const next=this.meetings.events[0];
    this.tray.setToolTip(`Call Note — ${view.status}${next?`\n${next.title} · ${next.timing}`:''}`);
  }
  setMeetings(value) {this.meetings=value;this.update({});}
  setDetection(value) {this.detection=value;}
  detectionMenu() {
    if(this.platform!=='darwin')return null;
    return {label:'Call detection',submenu:[
      ...[['off','Off'],['ask','Ask me to start'],['auto','Start transcription automatically']].map(([mode,label])=>({label,type:'radio',checked:this.detection.mode===mode,click:()=>this.actions.setDetection?.(mode)})),
      {type:'separator'},
      {label:this.detection.mode==='off'?'Detection is off':this.detection.available?'Watching for microphone activity':'Detection unavailable',enabled:false},
      {label:'May detect pre-join screens and microphone tests',enabled:false},
      {label:'Muted or listening-only calls can be missed',enabled:false}
    ]};
  }
  meetingMenu() {
    return [
      {label:'Calendar',enabled:false},
      ...this.meetings.events.map(event=>({label:`${event.timing} · ${event.title.replace(/[\r\n]/g,' ').slice(0,80)}`,submenu:[
        {label:new Date(event.start).toLocaleString(),enabled:false},
        {label:event.canJoin?'Join call':'No video link in this event',enabled:event.canJoin,click:()=>this.actions.join?.(event.key)},
        {label:'Open Call Note',click:this.actions.show}
      ]})),
      ...(!this.meetings.events.length?[{label:this.meetings.unavailable?'Calendar unavailable — open Call Note':this.meetings.connected?'No upcoming meetings':'Connect Google Calendar in Call Note',enabled:false}]:[]),
      {label:'Meeting reminder',submenu:[{label:'1 minute before',value:60},{label:'30 seconds before',value:30},{label:'Off',value:0}].map(option=>({label:option.label,type:'radio',checked:this.meetings.leadSeconds===option.value,click:()=>this.actions.setReminder?.(option.value)}))},
      {type:'separator'}
    ];
  }
  menu() {
    const view=presentation(this.state);
    const sources=[this.state.microphone?'Microphone':null,this.state.system?'System audio':null].filter(Boolean).join(' + ');
    return this.Menu.buildFromTemplate([
      {label:'Call Note',enabled:false},{label:view.status,enabled:false},
      ...(this.state.phase==='recording'?[{label:sources||'Capturing audio',enabled:false}]:[]),
      {type:'separator'},
      ...this.meetingMenu(),
      ...(this.detectionMenu()?[this.detectionMenu()]:[]),
      {label:'Open Call Note',click:this.actions.show},
      {label:'Start new call',enabled:view.canStart,click:()=>{if(!presentation(this.state).canStart)return;this.update({phase:'preparing'});this.actions.start();}},
      {label:'Stop & save call',enabled:view.canStop,click:()=>{if(!presentation(this.state).canStop)return;this.update({phase:'saving'});this.actions.stop();}},
      {type:'separator'},{label:'Transcription stays on this device',enabled:false},
      {label:`Version ${this.version}`,enabled:false},{label:'Quit Call Note',click:this.actions.quit}
    ]);
  }
}
module.exports={CallTray,presentation};
