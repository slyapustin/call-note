const {spawn} = require('node:child_process');

class ServiceSupervisor {
  constructor({command, args, options, onError, onRecycle=()=>{}, spawnProcess=spawn,
    setTimer=setTimeout, clearTimer=clearTimeout, now=Date.now,
    restartDelay=250, rapidWindow=30000, maxRapidRestarts=3}) {
    Object.assign(this,{command,args,options,onError,onRecycle,spawnProcess,setTimer,clearTimer,now,restartDelay,rapidWindow,maxRapidRestarts});
    this.stopped=true;
    this.child=null;
    this.timer=null;
    this.rapidRestarts=0;
  }
  start() {
    if(!this.stopped)return;
    this.stopped=false;
    this.rapidRestarts=0;
    this.launch();
  }
  launch() {
    if(this.stopped)return;
    const started=this.now();
    let child;
    try {child=this.spawnProcess(this.command,this.args,this.options);} catch(error) {this.fail(error);return;}
    this.child=child;
    let failed=false;
    child.once('error',error=>{
      failed=true;
      if(this.child===child)this.child=null;
      if(!this.stopped)this.fail(error);
    });
    child.once('exit',(code,signal)=>{
      if(this.child===child)this.child=null;
      if(this.stopped||failed)return;
      if(code!==75||signal){this.fail(new Error(`Service exited ${signal||code}.`));return;}
      this.rapidRestarts=this.now()-started<this.rapidWindow?this.rapidRestarts+1:0;
      if(this.rapidRestarts>this.maxRapidRestarts){this.fail(new Error('Service stopped after repeated rapid idle restarts.'));return;}
      this.onRecycle();
      this.timer=this.setTimer(()=>{this.timer=null;this.launch();},this.restartDelay);
    });
  }
  fail(error) {
    this.stopped=true;
    this.onError(error);
  }
  stop() {
    this.stopped=true;
    if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
    const child=this.child;
    this.child=null;
    child?.kill('SIGTERM');
  }
}
module.exports={ServiceSupervisor};
