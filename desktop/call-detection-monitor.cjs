const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {execFile} = require('node:child_process');
const {CallDetection} = require('./call-detection.cjs');

class CallDetectionMonitor {
  constructor({helper,settingsFile,onCandidate,onChange=()=>{},getBusy,now=Date.now,execute=execFile,filesystem=fs}) {
    Object.assign(this,{helper,settingsFile,onChange,now,execute,fs:filesystem});
    let mode='ask';
    try {const saved=JSON.parse(this.fs.readFileSync(settingsFile,'utf8'));if(saved.schema===1&&['off','ask','auto'].includes(saved.mode))mode=saved.mode;} catch {}
    this.policy=new CallDetection({mode,now,getBusy,onCandidate});
    this.running=false;this.generation=0;this.lifecycle=0;this.pending=null;
  }
  status() {return this.policy.snapshot();}
  setMode(mode) {
    if(!['off','ask','auto'].includes(mode))throw Error('Invalid call detection setting');
    const temp=`${this.settingsFile}.${randomUUID()}.tmp`;
    this.fs.mkdirSync(path.dirname(this.settingsFile),{recursive:true,mode:0o700});
    try {
      this.fs.writeFileSync(temp,JSON.stringify({schema:1,mode}),{flag:'wx',mode:0o600});
      this.fs.renameSync(temp,this.settingsFile);
    } finally {try {this.fs.unlinkSync(temp);} catch(error) {if(error.code!=='ENOENT')throw error;}}
    this.generation++;
    this.policy.setMode(mode);
    this.onChange(this.status());
    return this.status();
  }
  suppress() {this.policy.suppress();this.onChange(this.status());}
  isCurrent(candidate) {return this.running&&this.policy.isCurrent(candidate);}
  async poll() {
    if(this.pending)return this.pending;
    if(!this.running||this.status().mode==='off')return;
    const generation=this.generation,observedAt=this.now();
    this.pending=(async()=>{
      let snapshot;
      try {
        const output=await new Promise((resolve,reject)=>this.execute(this.helper,['--once'],{timeout:1800,maxBuffer:512*1024,encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout)));
        snapshot=JSON.parse(output);
        if(snapshot.available!==true||!Array.isArray(snapshot.processes))throw Error('Unavailable audio activity');
      } catch {snapshot={available:false,processes:[]};}
      if(!this.running||generation!==this.generation)return;
      this.policy.update({...snapshot,observedAt});
      this.onChange(this.status());
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  start() {
    if(this.running)return;
    this.running=true;
    const lifecycle=++this.lifecycle;
    const tick=async()=>{
      if(!this.running||lifecycle!==this.lifecycle)return;
      await this.poll();
      if(this.running&&lifecycle===this.lifecycle){this.timer=setTimeout(tick,2000);this.timer.unref?.();}
    };
    void tick();
  }
  stop() {
    this.running=false;this.generation++;this.lifecycle++;clearTimeout(this.timer);
    this.policy.update({available:false});this.onChange(this.status());
  }
}
module.exports={CallDetectionMonitor};
