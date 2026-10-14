const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(overrides = {}) {
  const elements = new Map(), errors = [], copied = [], requests = [];
  let menuOpen, changed, status = {appearance:'system',leadSeconds:60,detection:{mode:'ask',available:false}}, calendar={connected:false,available:true,events:[]};
  const document = {
    activeElement:null,
    createElement:tag=>({tag,textContent:''}),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        open:false, hidden:false, disabled:false, isConnected:true, value:'', textContent:'', children:[], dataset:{}, listeners:{}, attributes:{},
        focus() {document.activeElement = this;},
        showModal() {this.open = true;},
        close() {this.open = false; this.listeners.close?.();},
        setAttribute(key,value) {this.attributes[key] = value;},
        replaceChildren(...children) {this.children=children;if(children[0]?.value!==undefined)this.value=children[0].value;},
        addEventListener(name, callback) {this.listeners[name] = callback;},
      });
      return elements.get(id);
    },
  };
  const clients = [
    {id:'codex',label:'Codex',configPath:'~/.codex/config.toml',steps:['Add the entry without replacing other settings.'],snippet:'[mcp_servers.call-note]\ncommand = "python"'},
    {id:'claude',label:'Claude Desktop',configPath:'~/Library/Application Support/Claude/claude_desktop_config.json',steps:['Merge call-note into mcpServers.'],snippet:'{"mcpServers":{"call-note":{"command":"python"}}}'},
  ];
  const bridge = {
    settingsStatus:async()=>status,
    setAppearance:async value=>(status={...status,appearance:value}),
    setReminder:async value=>(status={...status,leadSeconds:value}),
    setDetection:async value=>(status={...status,detection:{...status.detection,mode:value}}),
    onSettingsOpen:callback=>{menuOpen=callback;},
    onSettingsChanged:callback=>{changed=callback;},
    onUpdateState() {}, updateStatus:async()=>({message:'Up to date'}),
    updateDownloads:async()=>requests.push('releases'),
    mcpSetup:async()=>{requests.push('mcpSetup');return {clients};},
    mcpDocs:async id=>requests.push(['docs',id]),
    copyText:async text=>copied.push(text),
    exportDiagnostics:async()=>{requests.push('diagnostics');},
    calendarStatus:async()=>calendar,
    calendarConnect:async()=>requests.push('connect'),
    calendarDisconnect:async()=>requests.push('disconnect'),
    ...overrides,
  };
  const context = vm.createContext({document,Option:function(text,value){return {text,value};}});
  const source = fs.readFileSync(path.join(__dirname,'ui/settings.js'),'utf8').replace('export function setupSettings','function setupSettings');
  vm.runInContext(source,context);
  const controller=context.setupSettings({bridge,version:'0.2.7',refreshCalendar:async()=>{requests.push('refreshCalendar');return calendar;},openUpdates:async()=>requests.push('updates'),onError:error=>errors.push(error)});
  return {controller,bridge,errors,copied,requests,document,clients,get:id=>document.getElementById('settings-'+id),
    menu:section=>menuOpen(section),change:state=>changed(state),calendar:state=>{calendar=state;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('opening assistant instructions is read-only; copying selects only the chosen client configuration',async()=>{
  const f=fixture();
  await f.controller.open('assistants');await settle();
  assert.deepEqual(f.requests,['mcpSetup']);assert.deepEqual(f.copied,[]);
  assert.equal(f.get('mcp-config').value,f.clients[0].snippet);
  f.get('client').value='claude';f.get('client').onchange();
  await f.get('mcp-copy').onclick();
  assert.deepEqual(f.copied,[f.clients[1].snippet]);
  assert.match(f.get('message').textContent,/settings have not been changed/);
  await f.get('mcp-docs').onclick();
  assert.deepEqual(f.requests.at(-1),['docs','claude']);
});

test('clipboard rejection reports failure without a copied success message and restores the button',async()=>{
  const f=fixture({copyText:async()=>{throw Error('Clipboard unavailable');}});
  await f.controller.open('assistants');await settle();
  await f.get('mcp-copy').onclick();
  assert.equal(f.get('message').textContent,'Clipboard unavailable');
  assert.equal(f.get('message').dataset.error,'true');
  assert.equal(f.get('mcp-copy').disabled,false);
});

test('keyboard section navigation and close restore useful focus without trapping the selection',async()=>{
  const f=fixture();f.get('open').focus();await f.controller.open('general');
  let prevented=false;
  f.get('tab-general').onkeydown({key:'ArrowDown',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(f.get('calendar').hidden,false);
  assert.equal(f.get('tab-calendar').attributes['aria-selected'],'true');
  assert.equal(f.document.activeElement,f.get('tab-calendar'));
  assert.equal(f.get('tab-general').tabIndex,-1);
  f.controller.close();assert.equal(f.document.activeElement,f.get('open'));
});

test('failed preference persistence restores prior choice and native-menu changes remain synchronized',async()=>{
  const f=fixture({setAppearance:async()=>{throw Error('Could not save appearance');}});
  await f.controller.open();f.get('appearance').value='dark';await f.get('appearance').onchange();
  assert.equal(f.get('appearance').value,'system');
  assert.equal(f.get('appearance').disabled,false);
  f.change({appearance:'light',leadSeconds:30});
  assert.equal(f.get('appearance').value,'light');assert.equal(f.get('reminder').value,'30');
  f.get('reminder').value='0';await f.get('reminder').onchange();assert.equal(f.get('reminder').value,'0');
  f.get('detection').value='auto';await f.get('detection').onchange();assert.equal(f.get('detection').value,'auto');
});

test('diagnostics cancellation does not claim a file was saved and updates close Settings first',async()=>{
  const f=fixture();await f.controller.open('support');await settle();
  await f.get('diagnostics').onclick();
  assert.equal(f.get('message').hidden,true);
  assert.equal(f.get('diagnostics').disabled,false);
  await f.get('updates').onclick();assert.equal(f.get('dialog').open,false);
  assert.deepEqual(f.requests,['diagnostics','updates']);
});

test('Calendar connection controls follow availability and refresh failure keeps actions usable',async()=>{
  const f=fixture({calendarConnect:async()=>{throw Error('Sign-in cancelled');}});
  f.calendar({connected:false,available:false,events:[]});await f.controller.open('calendar');
  assert.equal(f.get('calendar-connect').disabled,true);
  f.controller.renderCalendar({connected:false,available:true});
  await f.get('calendar-connect').onclick();assert.equal(f.get('calendar-connect').disabled,false);
  assert.match(f.get('message').textContent,/cancelled/);
  f.controller.renderCalendar({connected:true,available:true});
  assert.equal(f.get('calendar-connect').hidden,true);
  assert.equal(f.get('calendar-connected').hidden,false);
});

test('failed assistant loading can be retried without requiring an app restart',async()=>{
  let attempts=0;
  const f=fixture({mcpSetup:async()=>{if(++attempts===1)throw Error('Setup unavailable');return {clients:[]};}});
  await f.controller.open('assistants');await settle();
  assert.match(f.get('message').textContent,/unavailable/);
  await f.get('tab-assistants').onclick();
  assert.equal(attempts,2);assert.equal(f.get('message').hidden,true);
});

test('opening any Settings section reads connection status without refreshing or altering the call draft',async()=>{
  const f=fixture();
  for(const section of ['general','calendar','assistants','support'])await f.controller.open(section);
  assert.equal(f.requests.includes('refreshCalendar'),false);
  await f.get('calendar-refresh').onclick();
  assert.equal(f.requests.filter(item=>item==='refreshCalendar').length,1);
});

test('a slow preferences snapshot cannot overwrite a newer native menu change',async()=>{
  let resolve;
  const f=fixture({settingsStatus:()=>new Promise(done=>{resolve=done;})});
  const opening=f.controller.open();
  f.change({appearance:'dark',leadSeconds:30});
  resolve({appearance:'system',leadSeconds:60});await opening;
  assert.equal(f.get('appearance').value,'dark');
  assert.equal(f.get('reminder').value,'30');
  assert.equal(f.get('appearance').disabled,false);
});

test('Settings and update dialog controls work while initial library loading is still pending',async()=>{
  const elements=new Map();let requested=false,updateOpen;
  const document={activeElement:null,getElementById(id){
    if(!elements.has(id))elements.set(id,{
      open:false,disabled:false,isConnected:true,value:'',dataset:{},listeners:{},children:[],
      focus(){document.activeElement=this;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},
      setAttribute(){},replaceChildren(...children){this.children=children;},addEventListener(name,callback){this.listeners[name]=callback;},
    });
    return elements.get(id);
  }};
  const bridge={
    session:async()=>({token:'fixture',version:'0.2.7'}),
    settingsStatus:async()=>({appearance:'system',leadSeconds:60}),calendarStatus:async()=>({connected:false,available:true}),
    onSettingsOpen(){},onSettingsChanged(){},onUpdateState(){},onMenuStart(){},onMenuStop(){},onDetectedStart(){},
    onUpdateOpen:callback=>{updateOpen=callback;},updateStatus:async()=>({message:'Up to date',phase:'current',enabled:true}),updateCheck:async()=>{},
  };
  const context=vm.createContext({document,window:{callDesk:bridge,addEventListener(){}},fetch:()=>{requested=true;return new Promise(()=>{});}});
  const settings=fs.readFileSync(path.join(__dirname,'ui/settings.js'),'utf8').replace('export function setupSettings','function setupSettings');
  vm.runInContext(settings,context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'ui/delete-call.js'),'utf8').replace('export function setupDeleteCall','function setupDeleteCall'),context);
  const app=fs.readFileSync(path.join(__dirname,'ui/app.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(`(async()=>{${app}\n})()`,context);
  await settle();assert.equal(requested,true);
  await document.getElementById('settings-open').onclick();
  assert.equal(document.getElementById('settings-dialog').open,true);
  document.getElementById('settings-close').onclick();
  assert.equal(document.getElementById('settings-dialog').open,false);
  await updateOpen();
  assert.equal(document.getElementById('update-dialog').open,true);
  document.getElementById('update-close').onclick();
  assert.equal(document.getElementById('update-dialog').open,false);
});
