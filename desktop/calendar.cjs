const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {randomBytes,createHash} = require('node:crypto');
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
function normalizeEvent(event) {
  if(event.status==='cancelled'||!event.start?.dateTime||event.attendees?.some(a=>a.self&&a.responseStatus==='declined'))return null;
  const start=event.start.dateTime,end=event.end?.dateTime;
  if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end)))return null;
  const meetingUrl=event.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri || event.hangoutLink || '';
  return {id:event.id,title:event.summary||'Untitled meeting',start,end,meeting_url:meetingUrl,attendees:(event.attendees||[]).map(a=>({name:a.displayName||'',email:a.email||'',response:a.responseStatus||''})),organizer:event.organizer?.email||'',calendar_id:'primary'};
}
function nearestEvent(events, now=Date.now()) {
  return events.filter(e=>Date.parse(e.start)<=now+15*60000&&Date.parse(e.end)>now)
    .sort((a,b)=>Math.abs(Date.parse(a.start)-now)-Math.abs(Date.parse(b.start)-now))[0]||null;
}
class GoogleCalendar {
  constructor({directory,safeStorage,dialog,shell,getWindow}) {Object.assign(this,{safeStorage,dialog,shell,getWindow});this.file=path.join(directory,'google-calendar.enc');this.connecting=false;}
  read() {return fs.existsSync(this.file)?JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file))):{};}
  write(data) {
    if(!this.safeStorage.isEncryptionAvailable()||this.safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure OS credential storage is unavailable.');
    const temp=this.file+'.tmp';fs.writeFileSync(temp,this.safeStorage.encryptString(JSON.stringify(data)),{mode:0o600});fs.renameSync(temp,this.file);
  }
  status() {try{return {connected:!!this.read().tokens?.refresh_token,connecting:this.connecting};}catch{return {connected:false,error:'Calendar credentials could not be unlocked.'};}}
  async tokenRequest(params) {
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});
    const tokens=await response.json();if(!response.ok)throw Error('Google authorization failed. Reconnect Calendar and check your OAuth client settings.');return {...tokens,expires_at:Date.now()+tokens.expires_in*1000};
  }
  async connect() {
    if(this.connecting)throw Error('Calendar sign-in is already open.');this.connecting=true;
    try {
      let stored=this.read();
      if(!stored.client) {
        const choice=await this.dialog.showMessageBox(this.getWindow(),{type:'info',buttons:['Choose OAuth JSON','Cancel'],defaultId:0,cancelId:1,message:'Connect Google Calendar',detail:'This developer preview needs a Google Cloud OAuth client of type Desktop app, with Calendar API enabled. Select its downloaded JSON file, then sign in with Google. Call Note requests read-only event access.'});
        if(choice.response!==0)return {connected:false};
        const selection=await this.dialog.showOpenDialog(this.getWindow(),{title:'Select Google Desktop OAuth client JSON',properties:['openFile'],filters:[{name:'Google OAuth client',extensions:['json']}]});
        if(selection.canceled)return {connected:false};
        const file=selection.filePaths[0];if(fs.statSync(file).size>65536)throw Error('OAuth JSON is too large.');
        const client=JSON.parse(fs.readFileSync(file,'utf8')).installed;
        if(!client||typeof client.client_id!=='string'||!client.client_id.endsWith('.apps.googleusercontent.com'))throw Error('Select a Google OAuth Desktop app JSON file.');
        stored={client:{client_id:client.client_id,client_secret:client.client_secret||''}};
      }
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
    let stored=this.read();if(!stored.tokens?.refresh_token)return {connected:false,events:[],suggested:null};
    if(stored.tokens.expires_at<Date.now()+60000) {
      const tokens=await this.tokenRequest({...stored.client,refresh_token:stored.tokens.refresh_token,grant_type:'refresh_token'});
      stored.tokens={...stored.tokens,...tokens};this.write(stored);
    }
    const url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.search=new URLSearchParams({timeMin:new Date(Date.now()-2*3600000).toISOString(),timeMax:new Date(Date.now()+24*3600000).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'100',fields:'items(id,status,summary,start,end,attendees(displayName,email,responseStatus,self),organizer(email),hangoutLink,conferenceData(entryPoints))'}).toString();
    const response=await fetch(url,{headers:{Authorization:`Bearer ${stored.tokens.access_token}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`Calendar could not be read (${response.status}). Check that Calendar API is enabled, or reconnect.`);
    const events=(await response.json()).items?.map(normalizeEvent).filter(Boolean)||[];
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
