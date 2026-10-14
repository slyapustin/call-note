const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerSettings}=require('./settings.cjs');

function fixture() {
  const handlers={},notifications=[],links=[],changes=[];
  let exports=0;
  const theme={source:'system',set(source){changes.push(source);this.source=source;return {persisted:true};}};
  const reminders={leadSeconds:60,setLead(value){changes.push(value);this.leadSeconds=value;}};
  const setup={clients:[{id:'codex',docsUrl:'https://learn.chatgpt.com/docs/extend/mcp?surface=cli'},{id:'claude',docsUrl:'https://modelcontextprotocol.io/docs/develop/connect-local-servers'}]};
  const api=registerSettings({ipcMain:{handle:(channel,handler)=>handlers[channel]=handler},trusted:event=>event.allowed,
    theme,getReminders:()=>reminders,notify:state=>notifications.push(state),getMcpSetup:()=>setup,
    openExternal:url=>links.push(url),exportDiagnostics:()=>exports++});
  return {api,handlers,notifications,links,changes,theme,reminders,setup,exports:()=>exports};
}

test('settings, setup instructions, help links and diagnostics reject untrusted senders',()=>{
  const f=fixture();
  for(const handler of Object.values(f.handlers))assert.throws(()=>handler({allowed:false},'dark'),/Untrusted/);
  assert.deepEqual(f.changes,[]);assert.deepEqual(f.links,[]);assert.equal(f.exports(),0);
});

test('reading settings and MCP instructions performs no preference or export action',()=>{
  const f=fixture(),event={allowed:true};
  assert.deepEqual(f.handlers['settings:status'](event),{appearance:'system',leadSeconds:60,detection:{mode:'ask',available:false}});
  assert.equal(f.handlers['mcp:setup'](event),f.setup);
  assert.deepEqual(f.changes,[]);assert.deepEqual(f.links,[]);assert.equal(f.exports(),0);
  assert.equal(f.handlers['connect-assistants'],undefined);
});

test('preferences validate values and share current state with the renderer',()=>{
  const f=fixture(),event={allowed:true};
  for(const value of [null,{},'auto',false])assert.throws(()=>f.handlers['settings:appearance'](event,value),/Invalid/);
  for(const value of [null,'30',-1,1,undefined])assert.throws(()=>f.handlers['settings:reminder'](event,value),/Invalid/);
  f.handlers['settings:appearance'](event,'dark');
  assert.deepEqual(f.handlers['settings:reminder'](event,30),{appearance:'dark',leadSeconds:30,detection:{mode:'ask',available:false}});
  assert.deepEqual(f.changes,['dark',30]);assert.equal(f.notifications.length,2);
});

test('an appearance save failure reports the actual session appearance',()=>{
  const f=fixture();
  f.theme.set=source=>{f.theme.source=source;return {persisted:false};};
  assert.throws(()=>f.api.setAppearance('light'),/changed for this session/);
  assert.equal(f.notifications[0].appearance,'light');
});

test('help opens only fixed documentation destinations and export requires an explicit request',()=>{
  const f=fixture(),event={allowed:true};
  for(const value of ['https://example.com','file:///etc/passwd','codex/other',{},null])assert.throws(()=>f.handlers['mcp:docs'](event,value),/Unknown/);
  f.handlers['mcp:docs'](event,'claude');assert.deepEqual(f.links,[f.setup.clients[1].docsUrl]);
  f.handlers['settings:export-diagnostics'](event);assert.equal(f.exports(),1);
});
