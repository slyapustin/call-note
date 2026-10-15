const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {registerPrivacy,policy}=require('./privacy.cjs');
const {POLICY_VERSION}=require('./analytics.cjs');
const config={enabled:true,publisher:'Fixture Publisher',contact:'privacy@example.com',endpoint:'https://example.com',policyVersion:POLICY_VERSION};
function fixture(t,overrides={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'privacy-test-'));
  const handlers={},events={},requests=[];
  const args={directory,version:'0.2.14',platform:'darwin',config,trusted:event=>event.allowed,
    ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>events[name]=fn},
    fetch:async(url,options)=>{requests.push({url,data:JSON.parse(options.body)});return {ok:true};},...overrides};
  const api=registerPrivacy(args);
  t.after(()=>{api.manager.stop();fs.rmSync(directory,{recursive:true,force:true});});
  return {api,handlers,events,requests,args};
}
test('every privacy IPC rejects untrusted senders; event IPC ignores them',async t=>{
  const f=fixture(t);
  for(const handler of Object.values(f.handlers))assert.throws(()=>handler({allowed:false},true),/Untrusted/);
  await f.api.manager.acceptTerms();await f.api.manager.setAnalytics(true);
  f.events['privacy:event']({allowed:false},'app_open');
  assert.equal(f.api.manager.state.events.length,0);
  assert.equal(f.requests.length,0);
});
test('explicit terms acceptance is separate from optional analytics',async t=>{
  const f=fixture(t),event={allowed:true};
  await assert.rejects(f.handlers['privacy:analytics'](event,true));
  const status=await f.handlers['privacy:accept'](event);
  assert.equal(status.accepted,true);assert.equal(status.analytics,false);
  await f.api.manager.flush();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].data.analytics,false);
  assert.match(status.documents.notice,/minimal record is sent even if optional analytics is off/);
  assert.equal('secret' in status,false);
});
test('disabled publisher configuration prevents all network even with persisted optin',async t=>{
  const f=fixture(t);
  await f.api.manager.acceptTerms();await f.api.manager.setAnalytics(true);f.api.manager.track('app_open');
  const disabled=registerPrivacy({...f.args,config:{...config,enabled:false}});
  disabled.manager.start();await disabled.manager.flush();disabled.manager.stop();
  assert.equal(disabled.status().available,false);assert.equal(disabled.manager.track('app_open'),false);
  assert.equal(f.requests.length,0);
  await assert.rejects(f.handlers['privacy:analytics']({allowed:true},'yes'),/Invalid/);
});
test('off action clears pending events immediately',async t=>{
  const f=fixture(t),event={allowed:true};
  await f.handlers['privacy:accept'](event);await f.handlers['privacy:analytics'](event,true);
  f.events['privacy:event'](event,'feature_used',{feature:'calendar',title:'private meeting'});
  assert.equal(f.api.manager.state.events.length,1);
  await f.handlers['privacy:analytics'](event,false);
  assert.equal(f.api.manager.state.events.length,0);assert.equal(f.api.status().analytics,false);
});
test('production policy remains unavailable without complete publisher details',()=>{
  assert.equal(policy(require('./privacy-config.json')).available,false);
  for(const changes of [{publisher:''},{contact:''},{policyVersion:'old'},{enabled:false}])assert.equal(policy({...config,...changes}).available,false);
});
