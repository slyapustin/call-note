const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'ui/app.js'),'utf8');

function fixture() {
  const healthEvents=[],errors=[],finishes=[];
  const declarations=source.slice(source.indexOf('const captureStages'),source.indexOf("window.addEventListener('error'"));
  const capture=source.slice(source.indexOf('class Capture {'),source.indexOf('\nasync function finish('));
  const context=vm.createContext({
    usage(){},
    $:()=>({replaceChildren(){},setAttribute(){},dataset:{}}),
    WebSocket:{OPEN:1},
    window:{callDesk:{reportHealth:value=>healthEvents.push(value),reportError:value=>errors.push(value),recording(){}}},
    clearInterval(){},timer:null,
    notice(){},finish:graceful=>finishes.push(graceful),
    labels:{microphone:'You',system:'Others'},
  });
  vm.runInContext(`let capture;${declarations}${capture}\nthis.Capture=Capture;this.setCapture=value=>capture=value;this.getHealth=()=>({...health});`,context);
  return {context,healthEvents,errors,finishes,capture:new context.Capture()};
}

test('startup failure reports once with its original capture stage',()=>{
  const f=fixture(),error=new Error('private failure detail');
  f.capture.setStage('connect');f.capture.errorStage=f.capture.stage;f.context.setCapture(f.capture);
  f.context.reportError(error,f.capture.errorStage);f.capture.setStage('error');f.context.reportError(error);
  assert.equal(f.errors.length,1);
  assert.equal(f.errors[0].stage,'connect');
  assert.equal(f.errors[0].message,'private failure detail');
});

test('capture health counts sent frames, backpressure, heard audio and unexpected track ends',()=>{
  const f=fixture(),sent=[];
  f.capture.setStage('recording');
  f.capture.socket={readyState:1,bufferedAmount:0,send:value=>sent.push(value)};
  f.capture.meters.microphone={lastSignal:0,heard:false};
  const meter={value:0},audio=new Float32Array([.25,.25]).buffer;
  f.capture.sendAudioFrame('microphone',audio,meter);
  f.capture.socket.bufferedAmount=2*1024*1024;
  f.capture.sendAudioFrame('microphone',audio,meter);
  f.capture.trackEnded('microphone');
  const health=f.context.getHealth();
  assert.equal(health.framesSent,1);assert.equal(health.backpressureStops,1);assert.equal(health.trackEnds,1);
  assert.equal(health.microphoneHeard,true);assert.equal(health.systemHeard,false);
  assert.equal(sent.length,1);assert.equal(sent[0][0],0);
  assert.deepEqual(f.errors.map(error=>error.code),['CAPTURE_BACKPRESSURE','CAPTURE_ENDED']);
  assert.deepEqual(f.finishes,[false,true]);
  assert.deepEqual(Object.keys(health).sort(),['backpressureStops','framesSent','microphone','microphoneHeard','segmentsReceived','stage','system','systemHeard','trackEnds'].sort());
});

test('track endings caused by release do not count as unexpected capture failures',()=>{
  const f=fixture();f.capture.stopping=true;f.capture.trackEnded('system');
  assert.equal(f.context.getHealth().trackEnds,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.finishes,[]);
});

test('stopping an interrupted call retains its explanation while refreshing saved text',async()=>{
  const notices=[],elements=new Map();
  const context=vm.createContext({
    capture:{stopping:false,started:Date.now(),stop:async()=>{}},
    current:{id:'example'},deletion:{render(){}},
    window:{callDesk:{menuState(){}}},
    $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},
    notice:message=>notices.push(message),library:async()=>{},status:async()=>{},
    api:async()=>({id:'example'}),show(){},usage(){},reportError(){},
  });
  vm.runInContext(source.slice(source.indexOf('async function finish('),source.indexOf('\nasync function startCapture(')),context);
  await context.finish(false,'Recording timed out. Saved text is retained.');
  assert.deepEqual(notices,['Recording timed out. Saved text is retained.']);
  assert.equal(context.capture,null);
});


test('microphone mute silences queued frames without dropping time or system audio',()=>{
  const f=fixture(),sent=[],track={enabled:true};
  f.capture.active=true;
  f.capture.renderPartials=()=>{};
  f.capture.streams=[{name:'microphone',stream:{getAudioTracks:()=>[track]}}];
  f.capture.socket={readyState:1,bufferedAmount:0,send:value=>sent.push(value)};
  f.capture.meters={microphone:{},system:{}};
  const audio=new Float32Array([.25,.5]).buffer,meter={value:0};
  f.capture.toggleMicrophone();assert.equal(track.enabled,false);
  f.capture.sendAudioFrame('microphone',audio,meter);
  assert.equal(meter.value,0);
  assert.deepEqual(Array.from(new Float32Array(sent[0].slice(1).buffer)),[0,0]);
  f.capture.sendAudioFrame('system',audio,meter);
  assert.deepEqual(Array.from(new Float32Array(sent[1].slice(1).buffer)),[.25,.5]);
  f.capture.toggleMicrophone();assert.equal(track.enabled,true);
  f.capture.sendAudioFrame('microphone',audio,meter);
  assert.deepEqual(Array.from(new Float32Array(sent[2].slice(1).buffer)),[.25,.5]);
  assert.equal(f.context.getHealth().framesSent,3);
  f.capture.stopping=true;f.capture.toggleMicrophone();assert.equal(track.enabled,true);
});
