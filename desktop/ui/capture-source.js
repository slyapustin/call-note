export async function captureSystemAudio({mediaDevices,platform}) {
  let stream,stage='CAPTURE_OPEN';
  try {
    stream=await mediaDevices.getDisplayMedia({audio:true,video:{width:320,height:180,frameRate:1}});
    stage='CAPTURE_TRACK';
    if (!stream.getAudioTracks().some(track=>track.readyState==='live')) throw Object.assign(Error('No live audio track'),{name:'NotReadableError'});
    if (platform==='darwin') for(const track of stream.getVideoTracks()) {track.stop();stream.removeTrack(track);}
    return stream;
  } catch(cause) {
    if(stream)for(const track of stream.getTracks())track.stop();
    const denied=cause?.name==='NotAllowedError'||cause?.name==='SecurityError';
    const message=platform==='darwin'
      ? denied?'System-audio access was denied. Enable Call Note in System Settings → Privacy & Security → System Audio Recording Only, then quit and reopen Call Note. You can also start with microphone only.':'System audio could not start. Check your sound output device, then quit and reopen Call Note. If it still fails, export diagnostics from Help. You can also start with microphone only.'
      : denied?'System-audio access was denied. Check your Windows privacy settings and try again. You can also start with microphone only.':'System audio could not start. Check your Windows sound output device and reopen Call Note. If it still fails, export diagnostics from Help.';
    throw Object.assign(new Error(message,{cause}),{name:cause?.name||'Error',code:stage});
  }
}
