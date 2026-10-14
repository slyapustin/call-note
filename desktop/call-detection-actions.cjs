const {CallDetectionMonitor}=require('./call-detection-monitor.cjs');

function createCallDetection({helper,settingsFile,Notification,dialog,ipcMain,trusted,getBusy,canStart,hasPermissions,start,show,onChange=()=>{},createMonitor=options=>new CallDetectionMonitor(options)}) {
  let notification,promptCandidate,pending,timeout;
  const close=()=>{try {notification?.close();} catch {} notification=null;promptCandidate=null;};
  const inform=(title,body)=>{
    close();
    try {
      if(!Notification.isSupported())return;
      notification=new Notification({title,body});
      notification.on('click',show);notification.on('failed',()=>{});notification.show();
    } catch {close();}
  };
  const begin=(candidate,automatic)=>{
    if(pending||!monitor.isCurrent(candidate))return;
    if(!canStart()){close();show();return;}
    close();pending={id:candidate.id,automatic};
    monitor.suppress();
    timeout=setTimeout(()=>{inform('Transcription is still starting','Open Call Note to check audio access. It may still be waiting for a response.');},60000);
    timeout.unref?.();
    const request=pending;
    const failed=()=>{
      if(pending!==request)return;
      pending=null;clearTimeout(timeout);
      inform('Transcription did not start','Open Call Note to check the message and start transcription.');
    };
    try {
      const result=start({id:candidate.id,automatic});
      if(result&&typeof result.then==='function')Promise.resolve(result).catch(failed);
    } catch {failed();}
  };
  const prompt=candidate=>{
    close();promptCandidate=candidate;
    let fallbackShown=false;
    const body=`${candidate.appName} is using your microphone. Start transcribing? This can also be a microphone test or pre-join screen.`;
    const fallback=async()=>{
      if(fallbackShown||!monitor.isCurrent(candidate))return;
      fallbackShown=true;
      const result=await dialog.showMessageBox({type:'question',message:'Start transcription?',detail:body,buttons:['Start transcription','Not now'],defaultId:0,cancelId:1});
      if(result.response===0)begin(candidate,false);
      else if(monitor.isCurrent(candidate)){monitor.suppress();close();}
    };
    try {
      if(!Notification.isSupported()){void fallback().catch(()=>{});return;}
      notification=new Notification({title:'Possible call detected',body,actions:[{type:'button',text:'Start transcription'}]});
      const activate=()=>begin(candidate,false);
      notification.on('click',activate);notification.on('action',activate);
      notification.on('failed',()=>{void fallback().catch(()=>{});});notification.show();
    } catch {void fallback().catch(()=>{});}
  };
  const monitor=createMonitor({helper,settingsFile,getBusy,
    onCandidate:candidate=>{
      if(candidate.mode==='auto'&&canStart()&&hasPermissions())begin(candidate,true);
      else prompt(candidate);
    },onChange:state=>{if(promptCandidate&&!monitor.isCurrent(promptCandidate))close();onChange(state);}});
  ipcMain.on('detection:result',(event,result)=>{
    if(!trusted(event)||!pending||result?.id!==pending.id||typeof result.started!=='boolean')return;
    const automatic=pending.automatic;pending=null;clearTimeout(timeout);
    if(result.started&&automatic)inform('Transcription started','Call Note is transcribing locally. Use Stop & save in the menu bar when your call ends.');
    if(!result.started)inform('Transcription did not start','Open Call Note to check the message and start transcription.');
  });
  return {
    start:()=>monitor.start(),
    stop:()=>{close();clearTimeout(timeout);pending=null;monitor.stop();},
    suppress:()=>monitor.suppress(),
    status:()=>monitor.status(),
    setMode:mode=>{const state=monitor.setMode(mode);close();return state;}
  };
}
module.exports={createCallDetection};
