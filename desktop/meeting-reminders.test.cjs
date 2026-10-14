const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MeetingReminders,meetingKey,joinURL}=require('./meeting-reminders.cjs');
function fixture(t) {
  let now=Date.parse('2026-10-13T12:00:00Z'),events=[],notices=[],opened=[],shown=0,closed=0;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'call-note-reminders-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const options={now:()=>now,settingsFile:path.join(directory,'reminders.json'),loadEvents:async()=>({connected:true,events}),onChange:()=>{},
    notify:value=>{notices.push(value);return ()=>closed++;},openExternal:async url=>opened.push(url),show:()=>shown++};
  const reminders=new MeetingReminders(options);
  return {reminders,options,notices,opened,shown:()=>shown,closed:()=>closed,time:value=>{now+=value*1000;},events:value=>{events=value;},event:(offset=60,extra={})=>({id:'one',title:'Team call',start:new Date(now+offset*1000).toISOString(),end:new Date(now+(offset+1800)*1000).toISOString(),meeting_url:'https://meet.google.com/abc-defg-hij',...extra})};
}
test('reminds at one minute, persists deduplication, and joins only after activation',async t=>{
  const f=fixture(t);f.events([f.event(61)]);await f.reminders.refresh();assert.equal(f.notices.length,0);
  f.time(1);f.reminders.tick();assert.equal(f.notices.length,1);assert.equal(f.opened.length,0);
  f.reminders.tick();await f.reminders.refresh();assert.equal(f.notices.length,1);
  await f.notices[0].activate();assert.deepEqual(f.opened,['https://meet.google.com/abc-defg-hij']);
  const restarted=new MeetingReminders(f.options);await restarted.refresh();assert.equal(f.notices.length,1);
});
test('30 second preference and Off persist; rescheduled meetings can remind again',async t=>{
  const f=fixture(t);f.reminders.setLead(30);const event=f.event(60);f.events([event]);await f.reminders.refresh();assert.equal(f.notices.length,0);
  f.time(30);f.reminders.tick();assert.equal(f.notices.length,1);
  f.reminders.setLead(0);assert.equal(new MeetingReminders(f.options).leadSeconds,0);
  f.events([f.event(20)]);await f.reminders.refresh();assert.equal(f.notices.length,1);
  f.reminders.setLead(30);assert.equal(f.notices.length,2);
});
test('cancellation closes a reminder and stale actions never open its link',async t=>{
  const f=fixture(t);f.events([f.event()]);await f.reminders.refresh();const reminder=f.notices[0];
  f.events([]);await f.reminders.refresh();assert.equal(f.closed(),1);
  await reminder.activate();assert.equal(f.opened.length,0);assert.equal(f.shown(),1);
});
test('expired events, unsafe links, and stale refresh results are not actionable',async t=>{
  const f=fixture(t);f.events([f.event(-120),f.event(30,{id:'two',meeting_url:'file:///etc/passwd'}),f.event(-1801,{id:'ended'})]);
  await f.reminders.refresh();assert.equal(f.notices.length,1);assert.equal(f.notices[0].canJoin,false);
  await f.notices[0].activate();assert.equal(f.shown(),1);assert.equal(f.opened.length,0);
  for(const url of ['javascript:alert(1)','file:///tmp/a','zoommtg://join','https://user:pass@example.com'])assert.equal(joinURL(url),null);
  let resolve;f.reminders.loadEvents=()=>new Promise(r=>resolve=r);
  const pending=f.reminders.refresh();f.reminders.reset();resolve({connected:true,events:[f.event()]});await pending;
  assert.equal(f.reminders.snapshot().events.length,0);assert.equal(f.reminders.snapshot().connected,false);
});
test('overlapping meetings each notify once; failed refresh clears stale meetings',async t=>{
  const f=fixture(t);f.events([f.event(30),f.event(20,{id:'two'})]);await f.reminders.refresh();assert.equal(f.notices.length,2);
  f.reminders.tick();assert.equal(f.notices.length,2);
  f.reminders.loadEvents=async()=>{throw Error('offline');};await assert.rejects(f.reminders.refresh());
  assert.equal(f.reminders.snapshot().events.length,0);assert.equal(f.reminders.snapshot().unavailable,true);
});
test('Google account routing preserves meeting parameters and never sends identity to other hosts',()=>{
  const url=new URL(joinURL('https://meet.google.com/abc-defg-hij?authuser=0&authuser=1&hs=122#details','work+calls@example.com'));
  assert.deepEqual(url.searchParams.getAll('authuser'),['work+calls@example.com']);
  assert.equal(url.searchParams.get('hs'),'122');assert.equal(url.hash,'#details');
  for(const target of ['https://zoom.us/j/123?pwd=secret','https://teams.microsoft.com/l/meetup-join/123','https://meet.google.com.evil.example/abc','https://meet.google.com:444/abc','https://other.example/?next=https://meet.google.com/abc'])assert.equal(joinURL(target,'work@example.com'),target);
  for(const target of ['http://meet.google.com/abc','https://user:password@meet.google.com/abc','javascript:alert(1)'])assert.equal(joinURL(target,'work@example.com'),null);
  for(const identity of ['1','not an email','bad\n@example.com',null,{}])assert.equal(joinURL('https://meet.google.com/abc',identity),'https://meet.google.com/abc');
});
test('both notification and tray joins retain the connected account hint',async t=>{
  const f=fixture(t),event=f.event(30,{meeting_url:joinURL('https://meet.google.com/abc-defg-hij?authuser=0','work@example.com')});
  f.events([event]);await f.reminders.refresh();
  await f.notices[0].activate();await f.reminders.join(meetingKey(event));
  assert.equal(f.opened.length,2);
  for(const opened of f.opened)assert.equal(new URL(opened).searchParams.get('authuser'),'work@example.com');
});
