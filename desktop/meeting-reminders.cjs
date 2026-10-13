const fs = require('node:fs');
const path = require('node:path');
function meetingKey(event) { return JSON.stringify([event.calendar_id||'primary',event.id,event.start]); }
function joinURL(value) {
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;} catch {return null;}
}
function timing(event,now) {
  const seconds=Math.ceil((Date.parse(event.start)-now)/1000);
  return seconds<=0?'Started':seconds<=60?`In ${seconds}s`:`In ${Math.ceil(seconds/60)} min`;
}
class MeetingReminders {
  constructor({loadEvents,notify,onChange,openExternal,show,settingsFile,now=Date.now}) {
    Object.assign(this,{loadEvents,notify,onChange,openExternal,show,settingsFile,now});
    this.events=[];this.connected=false;this.unavailable=false;this.generation=0;this.leadSeconds=60;
    this.notified={};this.notifications=new Map();
    try {const saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));if([0,30,60].includes(saved.leadSeconds))this.leadSeconds=saved.leadSeconds;
      if(saved.notified&&typeof saved.notified==='object'&&!Array.isArray(saved.notified))this.notified=saved.notified;} catch {}
  }
  save() {
    if(!this.settingsFile)return;
    this.notified=Object.fromEntries(Object.entries(this.notified).filter(([,time])=>Number.isFinite(time)&&time>this.now()-86400000).slice(-200));
    fs.mkdirSync(path.dirname(this.settingsFile),{recursive:true,mode:0o700});
    const temp=this.settingsFile+'.tmp';fs.writeFileSync(temp,JSON.stringify({leadSeconds:this.leadSeconds,notified:this.notified}),{mode:0o600});fs.renameSync(temp,this.settingsFile);
  }
  setLead(seconds) {
    if(![0,30,60].includes(seconds))return;
    const previous=this.leadSeconds;this.leadSeconds=seconds;
    try {this.save();} catch(error) {this.leadSeconds=previous;throw error;}
    this.closeNotifications();this.tick();
  }
  closeNotifications() {for(const close of this.notifications.values())close?.();this.notifications.clear();}
  reset() {this.generation++;this.events=[];this.connected=false;this.unavailable=false;this.closeNotifications();this.tick();}
  refresh() {
    if(this.pending)return this.pending;
    const generation=this.generation;
    this.pending=(async()=>{
      try {
        const state=await this.loadEvents();
        if(generation!==this.generation)return {connected:false,events:[],suggested:null};
        this.connected=!!state.connected;this.unavailable=false;
        this.events=this.connected?(state.events||[]).filter(e=>e.id&&Number.isFinite(Date.parse(e.start))&&Date.parse(e.end)>this.now()):[];
        this.tick();return state;
      } catch(error) {
        if(generation===this.generation){this.events=[];this.unavailable=true;this.closeNotifications();this.tick();}
        throw error;
      } finally {this.pending=null;}
    })();
    return this.pending;
  }
  snapshot() {
    const now=this.now();
    const events=this.events.filter(e=>Date.parse(e.end)>now).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    const next=events.find(e=>Date.parse(e.start)>=now&&Date.parse(e.start)-now<=15*60000)||events.find(e=>Date.parse(e.start)<=now&&Date.parse(e.start)>now-5*60000);
    const title=next&&Date.parse(next.start)-now<=15*60000?(Date.parse(next.start)>now?`Call ${timing(next,now).toLowerCase()}`:'Call now'):'';
    return {connected:this.connected,unavailable:this.unavailable,leadSeconds:this.leadSeconds,title,
      events:events.slice(0,5).map(event=>({...event,key:meetingKey(event),timing:timing(event,now),canJoin:!!joinURL(event.meeting_url)}))};
  }
  tick() {
    const now=this.now();
    const live=new Set(this.events.filter(e=>Date.parse(e.end)>now).map(meetingKey));
    for(const [key,close] of this.notifications)if(!live.has(key)){close?.();this.notifications.delete(key);}
    if(this.leadSeconds)for(const event of this.events) {
      const start=Date.parse(event.start),key=meetingKey(event);
      if(start-now>this.leadSeconds*1000||now-start>60000||Date.parse(event.end)<=now||this.notified[key])continue;
      this.notified[key]=now;
      try {this.save();} catch {}
      const close=this.notify({event,body:`${timing(event,now)} · ${joinURL(event.meeting_url)?'Join call':'Open Call Note'}`,canJoin:!!joinURL(event.meeting_url),activate:()=>this.join(key)});
      this.notifications.set(key,close);
    }
    this.onChange(this.snapshot());
  }
  async join(key) {
    const event=this.events.find(e=>meetingKey(e)===key&&Date.parse(e.end)>this.now());
    const url=event&&joinURL(event.meeting_url);
    if(url)await this.openExternal(url);else this.show();
  }
  start() {
    this.poll=()=>this.refresh().catch(()=>{});
    this.poll();this.refreshTimer=setInterval(this.poll,60000);this.tickTimer=setInterval(()=>this.tick(),1000);
    this.refreshTimer.unref?.();this.tickTimer.unref?.();
  }
  stop() {clearInterval(this.refreshTimer);clearInterval(this.tickTimer);this.reset();}
}
module.exports={MeetingReminders,meetingKey,joinURL};
