const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createDisplayMediaHandler}=require('./capture-source.cjs');
const load=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'ui/capture-source.js')).toString('base64'));
function stream(audio=true) {
  const a={readyState:'live',stopped:0,stop(){this.stopped++;}},v={stopped:0,stop(){this.stopped++;}};
  const tracks=audio?[a,v]:[v];
  return {a,v,getTracks:()=>tracks,getAudioTracks:()=>audio?[a]:[],getVideoTracks:()=>tracks.includes(v)?[v]:[],removeTrack:track=>tracks.splice(tracks.indexOf(track),1)};
}
test('Mac selects only the trusted own main frame without enumerating screens',async()=>{
  const frame={url:'http://127.0.0.1:123/ui/'},calls=[];
  const handler=createDisplayMediaHandler({platform:'darwin',getContents:()=>({mainFrame:frame}),getOrigin:()=> 'http://127.0.0.1:123',desktopCapturer:{getSources(){throw Error('must not enumerate');}},reportError(){}});
  await handler({frame},value=>calls.push(value));
  assert.deepEqual(calls,[{video:frame,audio:'loopback'}]);
  await handler({frame:{url:frame.url}},value=>calls.push(value));
  assert.deepEqual(calls[1],{});
  frame.url='https://untrusted.invalid/';await handler({frame},value=>calls.push(value));assert.deepEqual(calls[2],{});
});
test('Windows keeps screen selection and records enumeration failure stage',async()=>{
  const frame={url:'http://local/'},errors=[],source={id:'screen:0'};let fail=false;
  const handler=createDisplayMediaHandler({platform:'win32',getContents:()=>({mainFrame:frame}),getOrigin:()=> 'http://local',desktopCapturer:{async getSources(){if(fail)throw Object.assign(Error('private detail'),{name:'NotReadableError'});return [source];}},reportError:error=>errors.push(error)});
  await handler({frame},value=>assert.deepEqual(value,{video:source,audio:'loopback'}));fail=true;
  await handler({frame},value=>assert.deepEqual(value,{}));assert.deepEqual(errors,[{name:'NotReadableError',code:'CAPTURE_SOURCE',message:'Display source selection failed'}]);
});
test('Mac drops and stops only placeholder video while preserving live system audio',async()=>{
  const {captureSystemAudio}=await load(),s=stream();
  const result=await captureSystemAudio({platform:'darwin',mediaDevices:{getDisplayMedia:async constraints=>{assert.equal(constraints.audio,true);assert.equal(constraints.video.frameRate,1);return s;}}});
  assert.equal(result,s);assert.equal(s.a.stopped,0);assert.equal(s.v.stopped,1);assert.deepEqual(s.getVideoTracks(),[]);
});
test('Windows keeps its existing video track',async()=>{
  const {captureSystemAudio}=await load(),s=stream();await captureSystemAudio({platform:'win32',mediaDevices:{getDisplayMedia:async()=>s}});assert.equal(s.v.stopped,0);
});
test('missing or ended audio releases all tracks and is not called permission denial',async()=>{
  const {captureSystemAudio}=await load();
  for(const s of [stream(false),stream()]){s.a.readyState='ended';await assert.rejects(captureSystemAudio({platform:'darwin',mediaDevices:{getDisplayMedia:async()=>s}}),error=>error.name==='NotReadableError'&&error.code==='CAPTURE_TRACK'&&!error.message.includes('denied'));assert.equal(s.v.stopped,1);if(s.getAudioTracks().length)assert.equal(s.a.stopped,1);}
});
test('capture errors preserve original name and stage without retrying screen access',async()=>{
  const {captureSystemAudio}=await load();let calls=0;
  for(const name of ['NotAllowedError','NotReadableError'])await assert.rejects(captureSystemAudio({platform:'darwin',mediaDevices:{getDisplayMedia:async()=>{calls++;throw Object.assign(Error('private detail'),{name});}}}),error=>error.name===name&&error.code==='CAPTURE_OPEN'&&error.message.includes('denied')===(name==='NotAllowedError')&&!error.message.includes('private detail'));
  assert.equal(calls,2);
});
