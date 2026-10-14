const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {randomBytes,createHash} = require('node:crypto');
const {joinURL,accountEmail} = require('./meeting-reminders.cjs');
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
function primaryAccountEmail(events) {
  const emails=new Set(events.flatMap(event=>[...(event.attendees||[]),event.organizer].filter(person=>person?.self===true).map(person=>accountEmail(person.email)).filter(Boolean)));
  return emails.size===1?[...emails][0]:'';
}
function normalizeEvent(event,googleAccount='') {
  if(event.status==='cancelled'||!event.start?.dateTime||event.attendees?.some(a=>a.self&&a.responseStatus==='declined'))return null;
  const start=event.start.dateTime,end=event.end?.dateTime;
  if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end)))return null;
  const rawMeetingUrl=event.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri || event.hangoutLink || '';
  const meetingUrl=joinURL(rawMeetingUrl,primaryAccountEmail([event])||googleAccount)||'';
  return {id:event.id,title:event.summary||'Untitled meeting',start,end,meeting_url:meetingUrl,attendees:(event.attendees||[]).map(a=>({name:a.displayName||'',email:a.email||'',response:a.responseStatus||''})),organizer:event.organizer?.email||'',calendar_id:'primary'};
}
function nearestEvent(events, now=Date.now()) {
  return events.filter(e=>Date.parse(e.start)<=now+15*60000&&Date.parse(e.end)>now)
    .sort((a,b)=>Math.abs(Date.parse(a.start)-now)-Math.abs(Date.parse(b.start)-now))[0]||null;
}
class GoogleCalendar {
  constructor({directory,safeStorage,shell,clientFile}) {Object.assign(this,{safeStorage,shell,clientFile});this.file=path.join(directory,'google-calendar.enc');this.connecting=false;}
  bundledClient() {
    if(!this.clientFile||!fs.existsSync(this.clientFile))return null;
    const config=JSON.parse(fs.readFileSync(this.clientFile,'utf8'));
    const client=config.installed||config;
    if(typeof client.client_id!=='string'||!client.client_id.endsWith('.apps.googleusercontent.com')||typeof client.client_secret!=='string')throw Error('Google Calendar sign-in is not configured correctly in this build.');
    return {client_id:client.client_id,client_secret:client.client_secret};
  }
  read() {return fs.existsSync(this.file)?JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file))):{};}
  write(data) {
    if(!this.safeStorage.isEncryptionAvailable()||this.safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure OS credential storage is unavailable.');
    const temp=this.file+'.tmp';fs.writeFileSync(temp,this.safeStorage.encryptString(JSON.stringify(data)),{mode:0o600});fs.renameSync(temp,this.file);
  }
  status() {try{const stored=this.read();return {connected:!!stored.tokens?.refresh_token,available:!!(stored.client||this.bundledClient()),connecting:this.connecting};}catch{return {connected:false,error:'Calendar sign-in is unavailable. Try reopening Call Note.'};}}
  async tokenRequest(params) {
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});
    const tokens=await response.json();if(!response.ok)throw Error('Google authorization failed. Reconnect Calendar and check your OAuth client settings.');return {...tokens,expires_at:Date.now()+tokens.expires_in*1000};
  }
  async connect() {
    if(this.connecting)throw Error('Calendar sign-in is already open.');this.connecting=true;
    try {
      let stored=this.read();
      if(!stored.client)stored={...stored,client:this.bundledClient()};
      if(!stored.client)throw Error('Google Calendar sign-in is not available in this build yet. Your calls still work without Calendar.');
      if(!this.safeStorage.isEncryptionAvailable())throw Error('Secure OS credential storage is unavailable.');
      const verifier=randomBytes(48).toString('base64url'),state=randomBytes(32).toString('hex');
      const server=http.createServer();
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      const redirect=`http://127.0.0.1:${server.address().port}`;
      try {
        const code=await new Promise((resolve,reject)=> {
          const timeout=setTimeout(()=>reject(Error('Google sign-in timed out. Try connecting again.')),180000);
          server.on('request',(request,response)=> {
            const url=new URL(request.url,redirect);
            if(url.pathname!=='/'||url.searchParams.get('state')!==state){response.writeHead(400);response.end('Invalid sign-in response.');return;}
            clearTimeout(timeout);response.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});response.end('You can return to Call Note.');
            if(url.searchParams.get('error'))reject(Error('Calendar access was not granted.'));
            else if(url.searchParams.get('code'))resolve(url.searchParams.get('code'));
            else reject(Error('Google did not return an authorization code.'));
          });
          const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
          url.search=new URLSearchParams({client_id:stored.client.client_id,redirect_uri:redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
          this.shell.openExternal(url.toString()).catch(error=>{clearTimeout(timeout);reject(error);});
        });
        const tokens=await this.tokenRequest({...stored.client,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'});
        if(tokens.scope&&!tokens.scope.split(' ').includes(SCOPE))throw Error('Read-only event access was not granted.');
        if(!tokens.refresh_token)throw Error('Google did not return offline access. Reconnect Calendar.');
        this.write({...stored,tokens});return this.status();
      } finally {server.close();}
    } finally {this.connecting=false;}
  }
  async events() {
    let stored=this.read();if(!stored.tokens?.refresh_token)return {...this.status(),events:[],suggested:null};
    if(stored.tokens.expires_at<Date.now()+60000) {
      const tokens=await this.tokenRequest({...stored.client,refresh_token:stored.tokens.refresh_token,grant_type:'refresh_token'});
      stored.tokens={...stored.tokens,...tokens};this.write(stored);
    }
    const url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.search=new URLSearchParams({timeMin:new Date(Date.now()-2*3600000).toISOString(),timeMax:new Date(Date.now()+24*3600000).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'100',fields:'items(id,status,summary,start,end,attendees(displayName,email,responseStatus,self),organizer(email,self),hangoutLink,conferenceData(entryPoints))'}).toString();
    const response=await fetch(url,{headers:{Authorization:`Bearer ${stored.tokens.access_token}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`Calendar could not be read (${response.status}). Check that Calendar API is enabled, or reconnect.`);
    const items=(await response.json()).items||[];
    const googleAccount=primaryAccountEmail(items);
    const events=items.map(event=>normalizeEvent(event,googleAccount)).filter(Boolean);
    return {connected:true,events,suggested:nearestEvent(events)?.id||null};
  }
  async disconnect() {
    const token=this.read().tokens?.refresh_token;
    if(token) {
      const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token}),signal:AbortSignal.timeout(20000)});
      if(!response.ok&&response.status!==400)throw Error('Google could not revoke access. Try again when online.');
    }
    if(fs.existsSync(this.file))fs.unlinkSync(this.file);
    return {connected:false};
  }
}
module.exports={GoogleCalendar,normalizeEvent,nearestEvent};
