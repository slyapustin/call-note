class CallDetectionLifecycle {
  constructor({supported, start, stop}) {
    Object.assign(this,{supported,start,stop});
    this.running=false;
  }
  observeEngine(engine) {
    if(!this.supported)return;
    if(engine==='idle'||engine==='ready') {
      if(!this.running){this.running=true;this.start();}
    } else if(engine==='error') this.stopMonitoring();
  }
  stopMonitoring() {
    if(!this.running)return;
    this.running=false;this.stop();
  }
}
module.exports={CallDetectionLifecycle};
