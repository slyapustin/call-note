const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createCallDetection}=require('./call-detection-actions.cjs');

function fixture(t,{mode='ask',supported=true,permissions=true,canStart=true,startFailure,notificationFailure}={}) {
  const timers=new Map(),notifications=[],dialogs=[],starts=[],handlers={};
  let monitor,options,visible=0;
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const timer={unref(){}};timers.set(timer,{callback,delay});return timer;});
  t.mock.method(globalThis,'clearTimeout',timer=>timers.delete(timer));
  class Notification extends EventEmitter {
    static isSupported(){return supported;}
    constructor(value){super();if(notificationFailure==='constructor')throw Error('notifications unavailable');this.options=value;notifications.push(this);}
    show(){if(notificationFailure==='show')throw Error('cannot show notification');this.shown=true;}
    close(){this.closed=true;}
  }
  const actions=createCallDetection({helper:'helper',settingsFile:'unused',Notification,
    dialog:{showMessageBox:value=>new Promise(resolve=>dialogs.push({options:value,resolve}))},
    ipcMain:{on:(event,callback)=>handlers[event]=callback},trusted:event=>event.trusted===true,
    getBusy:()=>false,canStart:()=>canStart,hasPermissions:()=>permissions,
    start:request=>{starts.push(request);if(startFailure==='sync')throw Error('renderer destroyed');if(startFailure==='async')return Promise.reject(Error('send failed'));},
    show:()=>visible++,createMonitor:value=>{
      options=value;
      monitor={running:false,current:null,mode,start(){this.running=true;},stop(){this.running=false;this.current=null;},
        isCurrent(candidate){return this.running&&this.current===candidate&&candidate.mode===this.mode;},
        suppress(){this.current=null;options.onChange(this.status());},status(){return {mode:this.mode};},
        setMode(mode){this.mode=mode;this.current=null;options.onChange(this.status());return this.status();}};
      return monitor;
    }});
  actions.start();t.after(()=>actions.stop());
  const candidate={id:1,mode,appName:'Google Chrome',kind:'browser',bundleId:'com.google.Chrome',pids:[10]};
  const detect=()=>{monitor.current=candidate;options.onCandidate(candidate);};
  return {actions,monitor,notifications,dialogs,starts,handlers,timers,candidate,detect,
    get visible(){return visible;},setCanStart:value=>canStart=value,
    result:(value,trusted=true)=>handlers['detection:result']({trusted},value),
    change:()=>options.onChange(monitor.status())};
}

test('Ask prompts without recording and duplicate click/action events send only one start',t=>{
  const f=fixture(t);f.detect();
  assert.equal(f.starts.length,0);
  const notice=f.notifications[0];
  assert.match(notice.options.body,/Google Chrome is using your microphone/);
  assert.match(notice.options.body,/microphone test or pre-join/);
  notice.emit('click');notice.emit('action');
  assert.deepEqual(f.starts,[{id:1,automatic:false}]);
  assert.equal(f.timers.size,1);
});

test('automatic start requires Auto and granted permissions; missing permission falls back to explicit action',t=>{
  const automatic=fixture(t,{mode:'auto'});automatic.detect();
  assert.deepEqual(automatic.starts,[{id:1,automatic:true}]);
  const missing=fixture(t,{mode:'auto',permissions:false});missing.detect();
  assert.equal(missing.starts.length,0);
  assert.equal(missing.notifications[0].options.title,'Possible call detected');
  missing.notifications[0].emit('click');
  assert.deepEqual(missing.starts,[{id:1,automatic:false}]);
});

test('stale notification clicks and delayed dialog answers cannot start recording',async t=>{
  const f=fixture(t);f.detect();const notification=f.notifications[0];
  f.monitor.current=null;f.change();notification.emit('click');
  assert.equal(notification.closed,true);assert.equal(f.starts.length,0);
  const g=fixture(t,{supported:false});g.detect();
  g.monitor.current=null;g.dialogs[0].resolve({response:0});await Promise.resolve();
  assert.equal(g.starts.length,0);
});

test('a valid prompt opens Call Note instead of silently doing nothing when the engine is no longer ready',t=>{
  const f=fixture(t);f.detect();f.setCanStart(false);f.notifications[0].emit('click');
  assert.equal(f.starts.length,0);assert.equal(f.visible,1);
});

test('unsupported or failed notifications show at most one fallback dialog per candidate',async t=>{
  const f=fixture(t);f.detect();f.notifications[0].emit('failed');f.notifications[0].emit('failed');
  assert.equal(f.dialogs.length,1);
  f.dialogs[0].resolve({response:1});await Promise.resolve();f.notifications[0].emit('failed');
  assert.equal(f.dialogs.length,1);assert.equal(f.starts.length,0);
  f.notifications[0].emit('click');assert.equal(f.starts.length,0, 'Not now also invalidates the original notification');
  const g=fixture(t,{supported:false});g.detect();assert.equal(g.dialogs.length,1);
  g.dialogs[0].resolve({response:0});await Promise.resolve();
  assert.deepEqual(g.starts,[{id:1,automatic:false}]);
});

test('notification constructor and show exceptions use the same permission-safe fallback',async t=>{
  for(const failure of ['constructor','show']) {
    const f=fixture(t,{notificationFailure:failure});
    assert.doesNotThrow(f.detect);assert.equal(f.dialogs.length,1);
    f.dialogs[0].resolve({response:0});await Promise.resolve();
    assert.deepEqual(f.starts,[{id:1,automatic:false}]);
  }
});

test('only matching results from the trusted renderer acknowledge pending starts',t=>{
  const f=fixture(t,{mode:'auto'});f.detect();
  f.result({id:1,started:true},false);f.result({id:999,started:true});f.result({id:1,started:'yes'});
  assert.equal(f.timers.size,1);assert.equal(f.notifications.length,0);
  f.result({id:1,started:true});
  assert.equal(f.timers.size,0);
  assert.equal(f.notifications[0].options.title,'Transcription started');
  f.notifications[0].emit('click');assert.equal(f.visible,1);
  f.result({id:1,started:true});assert.equal(f.notifications.length,1);
});

test('renderer failure acknowledgement informs the user without retrying the same candidate',t=>{
  const f=fixture(t,{mode:'auto'});f.detect();f.result({id:1,started:false});
  assert.equal(f.notifications[0].options.title,'Transcription did not start');
  assert.equal(f.starts.length,1);assert.equal(f.timers.size,0);
});

test('synchronous and asynchronous dispatch failures clear pending timers and remain contained',async t=>{
  for(const startFailure of ['sync','async']) {
    const f=fixture(t,{mode:'auto',startFailure});
    assert.doesNotThrow(f.detect);await Promise.resolve();await Promise.resolve();
    assert.equal(f.starts.length,1);assert.equal(f.timers.size,0);
    assert.equal(f.notifications[0].options.title,'Transcription did not start');
  }
  const f=fixture(t,{startFailure:'sync'});f.detect();const prompt=f.notifications[0];
  prompt.emit('click');prompt.emit('action');
  assert.equal(f.starts.length,1,'a failed dispatch cannot replay through a queued second activation');
});

test('a slow permission response remains pending and a late success is acknowledged accurately',t=>{
  const f=fixture(t,{mode:'auto'});f.detect();
  const [timer,task]=[...f.timers][0];assert.equal(task.delay,60000);
  f.timers.delete(timer);task.callback();
  assert.equal(f.notifications[0].options.title,'Transcription is still starting');
  f.result({id:1,started:true});
  assert.equal(f.notifications.at(-1).options.title,'Transcription started');
  assert.equal(f.starts.length,1);
});

test('manual suppression invalidates prompts, while stopping monitoring clears pending starts and notices',t=>{
  const f=fixture(t);f.detect();const prompt=f.notifications[0];f.actions.suppress();prompt.emit('click');
  assert.equal(f.starts.length,0);assert.equal(prompt.closed,true);
  const g=fixture(t,{mode:'auto'});g.detect();g.actions.stop();
  assert.equal(g.timers.size,0);g.result({id:1,started:true});
  assert.equal(g.notifications.length,0);assert.equal(g.monitor.running,false);
});

test('changing modes invalidates an existing notification and does not dispatch a stale start',t=>{
  const f=fixture(t);f.detect();const prompt=f.notifications[0];
  assert.equal(f.actions.setMode('off').mode,'off');prompt.emit('click');
  assert.equal(f.starts.length,0);assert.equal(prompt.closed,true);
});
