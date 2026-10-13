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
