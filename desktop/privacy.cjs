const {AnalyticsManager, POLICY_VERSION}=require('./analytics.cjs');

function policy(config) {
  const available=config.enabled===true&&typeof config.publisher==='string'&&config.publisher.trim()&&typeof config.contact==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.contact)&&config.policyVersion===POLICY_VERSION;
  return {
    available:!!available,
    version:POLICY_VERSION,
    terms:available?`Call Note terms of use · ${POLICY_VERSION}\n\nPublished by ${config.publisher}. Contact: ${config.contact}.\n\nCall Note transcribes audio locally and saves text on your device. Transcription and speaker labels can be wrong; review important details before relying on them. You control when transcription starts, including automatic-start settings. Ensure you have permission to capture and use the conversations you transcribe.\n\nYou control your saved calls and exports. Connecting an assistant can give that assistant access to your call library under its own data policies. Calendar connections and meeting links use third-party services.\n\nUsage analytics is optional and is not required to transcribe calls. Accepting these terms sends a minimal acceptance record as explained in the Privacy Notice. Declining leaves your existing library accessible.\n\nThis application is under active development. Features and availability may change. These terms do not limit rights that cannot be excluded under applicable law.`:'Terms are not yet available in this build.',
    notice:available?`Privacy notice · ${POLICY_VERSION}\n\n${config.publisher} is responsible for Call Note usage data. Questions or requests: ${config.contact}.\n\nAudio is processed locally. Saved transcripts and notes are not included in usage analytics. Exports and assistant connections are separate actions you control.\n\nTerms acceptance: when you accept, Call Note creates a random installation identifier and sends it with the document versions, acceptance time recorded by the server, and your analytics choice. This minimal record is sent even if optional analytics is off. A secret stored on your device authenticates updates and deletion.\n\nOptional usage statistics: only after you opt in, Call Note sends app version, operating-system family, UTC day, app openings, call starts/completions, approximate transcription minutes, use of named features and fixed error categories. These records are pseudonymous, not anonymous. They contain no audio, transcript text, notes, names, email addresses, meeting details, voice profiles, device names or raw errors.\n\nStorage and access: Cloudflare Workers and D1 process these records. Network requests necessarily expose your IP address to Cloudflare; Call Note does not put IP addresses or user-agent strings in the analytics database. A short-lived hash of the IP address is used by Cloudflare’s rate limiter to prevent abuse. Authorized administrators can view aggregate reports. Optional events are retained for up to 90 days, with daily cleanup. Acceptance records remain until you request deletion.\n\nYour choices: analytics starts off. Turn it off at any time in Settings → Privacy; this stops collection and clears unsent events immediately. The preference syncs when online. Previously sent events remain until expiry or deletion. Delete usage data removes the installation's events and acceptance record when the request reaches the service. Offline requests remain pending and retry; the app will tell you if deletion is pending. It does not delete saved calls. A hash of the deleted installation identifier is retained for up to 90 days to prevent delayed requests from restoring deleted records.\n\nNo conversation content is sent for these purposes. Optional statistics describe consenting installations only and are not an exact count of all people using Call Note.`:'The Privacy Notice is not yet available in this build.'
  };
}

function registerPrivacy({ipcMain,trusted,directory,version,platform,config,fetch,filesystem}) {
  const documents=policy(config);
  const manager=new AnalyticsManager({directory,version,platform,endpoint:documents.available?config.endpoint:'',...(fetch?{fetch}:{}),...(filesystem?{filesystem}:{})});
  const status=()=>({...manager.status(),available:documents.available&&manager.status().available,documents});
  const handlers={
    'privacy:status':status,
    'privacy:accept':async()=>{if(!documents.available)throw Error('Terms are not available yet.');await manager.acceptTerms();return status();},
    'privacy:analytics':async value=>{if(typeof value!=='boolean')throw Error('Invalid analytics choice');await manager.setAnalytics(value);return status();},
    'privacy:delete':async()=>{await manager.deleteData();return status();},
  };
  for(const [name,handler] of Object.entries(handlers))ipcMain.handle(name,(event,value)=>{if(!trusted(event))throw Error('Untrusted window');return handler(value);});
  ipcMain.on('privacy:event',(event,name,properties)=>{if(trusted(event))manager.track(name,properties);});
  return {manager,status};
}
module.exports={policy,registerPrivacy};
