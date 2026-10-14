const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeEvent,nearestEvent}=require('./calendar.cjs');
const {GoogleCalendar}=require('./calendar.cjs');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createHash}=require('node:crypto');
function calendarFixture(t,configured=true) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'call-note-calendar-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const clientFile=path.join(directory,'client.json');
  if(configured)fs.writeFileSync(clientFile,JSON.stringify({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'test-only',untrusted_field:'ignored'}}));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
  return new GoogleCalendar({directory,clientFile,safeStorage,shell:{openExternal:async()=>{throw Error('Unexpected browser open');}}});
}
test('missing bundled client disables sign-in without opening a file picker',async t=>{
  const calendar=calendarFixture(t,false);
  assert.equal(calendar.status().available,false);
  await assert.rejects(calendar.connect(),/not available in this build/);
  assert.equal(calendar.connecting,false);
});
test('bundled client validates desktop configuration and keeps only OAuth fields',t=>{
  const calendar=calendarFixture(t);
  assert.deepEqual(calendar.bundledClient(),{client_id:'test.apps.googleusercontent.com',client_secret:'test-only'});
  fs.writeFileSync(calendar.clientFile,JSON.stringify({web:{client_id:'test.apps.googleusercontent.com',client_secret:'test-only'}}));
  assert.throws(()=>calendar.bundledClient(),/not configured correctly/);
});
test('bundled sign-in uses PKCE, validates state and persists offline access',async t=>{
  const calendar=calendarFixture(t);let auth;
  calendar.shell.openExternal=async value=>{
    auth=new URL(value);
    const callback=new URL(auth.searchParams.get('redirect_uri'));
    callback.search=new URLSearchParams({state:'wrong',code:'ignored'}).toString();
    assert.equal((await fetch(callback)).status,400);
    callback.search=new URLSearchParams({state:auth.searchParams.get('state'),code:'test-code'}).toString();
    assert.equal((await fetch(callback)).status,200);
  };
  calendar.tokenRequest=async params=>{
    assert.equal(auth.origin,'https://accounts.google.com');
    assert.equal(auth.searchParams.get('scope'),'https://www.googleapis.com/auth/calendar.events.readonly');
    assert.equal(auth.searchParams.get('code_challenge'),createHash('sha256').update(params.code_verifier).digest('base64url'));
    assert.equal(params.code,'test-code');
    return {refresh_token:'test-refresh',access_token:'test-access',expires_at:Date.now()+3600000};
  };
  await calendar.connect();
  assert.equal(calendar.status().connected,true);
  assert.equal(calendar.connecting,false);
  fs.unlinkSync(calendar.clientFile);
  assert.equal(calendar.status().available,true);
  assert.equal(calendar.read().tokens.refresh_token,'test-refresh');
});
const event={id:'one',summary:'Team call',start:{dateTime:'2026-10-13T12:00:00Z'},end:{dateTime:'2026-10-13T13:00:00Z'},attendees:[{email:'a@example.com',displayName:'A'}],conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/test'}]}};
test('meeting details and canceled/all-day/declined filtering',()=>{assert.equal(normalizeEvent(event).meeting_url,'https://meet.google.com/test');assert.equal(normalizeEvent({...event,status:'cancelled'}),null);assert.equal(normalizeEvent({...event,start:{date:'2026-10-13'}}),null);assert.equal(normalizeEvent({...event,attendees:[{self:true,responseStatus:'declined'}]}),null);});
test('automatic matching selects active or soon-starting event only',()=>{const normalized=normalizeEvent(event);assert.equal(nearestEvent([normalized],Date.parse('2026-10-13T12:30:00Z')).id,'one');assert.equal(nearestEvent([normalized],Date.parse('2026-10-13T11:50:00Z')).id,'one');assert.equal(nearestEvent([normalized],Date.parse('2026-10-13T11:00:00Z')),null);assert.equal(nearestEvent([normalized],Date.parse('2026-10-13T13:00:00Z')),null);});
test('Meet joins use the primary calendar attendee, not the organizer or browser account index',()=>{
  const invite={...event,organizer:{email:'host@example.com'},attendees:[{email:'personal@example.com'},{email:'Work@Example.com',self:true}],conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij?authuser=0&hs=122#details'}]}};
  const url=new URL(normalizeEvent(invite).meeting_url);
  assert.equal(url.searchParams.get('authuser'),'work@example.com');
  assert.equal(url.searchParams.get('hs'),'122');assert.equal(url.hash,'#details');
  assert.equal(new URL(normalizeEvent({...invite,attendees:[{email:'other@example.com',self:true}]}).meeting_url).searchParams.get('authuser'),'other@example.com');
});
test('owned Meet events use self organizer; unknown identity never guesses from an unrelated person',()=>{
  assert.equal(new URL(normalizeEvent({...event,organizer:{email:'work@example.com',self:true}}).meeting_url).searchParams.get('authuser'),'work@example.com');
  assert.equal(normalizeEvent({...event,organizer:{email:'host@example.com'}}).meeting_url,event.conferenceData.entryPoints[0].uri);
  assert.equal(normalizeEvent({...event,conferenceData:{entryPoints:[{entryPointType:'video',uri:'javascript:alert(1)'}]}}).meeting_url,'');
});
test('event refresh shares a unique primary identity without extra OAuth requests or stale account caching',async t=>{
  const calendar=calendarFixture(t);
  calendar.write({client:calendar.bundledClient(),tokens:{refresh_token:'test-refresh',access_token:'test-access',expires_at:Date.now()+3600000}});
  let items=[{...event,attendees:[{email:'work@example.com',self:true}]},{...event,id:'without-guests',attendees:[]}],requests=0;
  t.mock.method(globalThis,'fetch',async value=>{
    const url=new URL(value);requests++;
    assert.equal(url.origin,'https://www.googleapis.com');
    assert.equal(url.pathname,'/calendar/v3/calendars/primary/events');
    assert.match(url.searchParams.get('fields'),/organizer\(email,self\)/);
    return {ok:true,json:async()=>({items})};
  });
  const first=await calendar.events();
  assert.equal(first.events.length,2);
  for(const item of first.events)assert.equal(new URL(item.meeting_url).searchParams.get('authuser'),'work@example.com');
  items=[{...event,attendees:[{email:'new@example.com',self:true}]}];
  assert.equal(new URL((await calendar.events()).events[0].meeting_url).searchParams.get('authuser'),'new@example.com');
  items=[{...event,attendees:[]}];
  assert.equal(new URL((await calendar.events()).events[0].meeting_url).searchParams.has('authuser'),false);
  assert.equal(requests,3);
});
test('conflicting primary identity evidence does not pick an account for an event without identity',async t=>{
  const calendar=calendarFixture(t);
  calendar.write({tokens:{refresh_token:'test-refresh',access_token:'test-access',expires_at:Date.now()+3600000}});
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({items:[{...event,attendees:[{self:true,email:'one@example.com'}]},{...event,id:'two',attendees:[{self:true,email:'two@example.com'}]},{...event,id:'unknown',attendees:[]}]})}));
  const result=await calendar.events();
  assert.equal(new URL(result.events.find(item=>item.id==='unknown').meeting_url).searchParams.has('authuser'),false);
});
