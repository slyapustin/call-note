const {app, BrowserWindow, session, desktopCapturer, ipcMain, dialog, systemPreferences, safeStorage, shell, Menu, nativeTheme, clipboard} = require('electron');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
app.setName('Call Note');
app.setPath('userData', path.join(app.getPath('appData'), 'CallDesk'));
let calendar, updates, callTray, reminders, introduction;
let window, service, quitting = false, recording = false;
const token = randomBytes(32).toString('hex');
let origin;
const bundled = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'service'));
const root = bundled ? path.join(process.resourcesPath, 'service') : path.resolve(__dirname, '..');
const serviceRoot = bundled ? root : path.join(root, 'service');
const python = bundled ? path.join(process.resourcesPath, 'python/bin/python3.13') : path.join(root, '.venv/bin/python');
if (!app.requestSingleInstanceLock()) app.quit();
function showWindow(){window?.show();window?.focus();}
app.on('second-instance', showWindow);
app.on('activate', showWindow);
function trusted(event) { return event.sender === window?.webContents && event.senderFrame?.url.startsWith(origin + '/'); }
app.whenReady().then(async () => {
  const data = app.getPath('userData');
  const {Diagnostics} = require('./diagnostics.cjs');
  const diagnostics = new Diagnostics({directory:data,version:app.getVersion(),versions:process.versions,platform:process.platform,arch:process.arch,osRelease:require('node:os').release()});
  const {registerSupport,createDiagnosticsExporter} = require('./support.cjs');
  registerSupport({ipcMain,clipboard,trusted,diagnostics});
  const exportDiagnostics = createDiagnosticsExporter({dialog,shell,getWindow:()=>window,diagnostics,downloads:app.getPath('downloads'),getState:()=>({recording,updatePhase:updates?.status().phase})});
  const {ThemePreference} = require('./theme.cjs');
  const theme = new ThemePreference({directory:data, nativeTheme});
  const {registerSettings}=require('./settings.cjs');
  const {buildMcpSetup}=require('./mcp-setup.cjs');
  const settings=registerSettings({ipcMain,trusted,theme,getReminders:()=>reminders,exportDiagnostics,
    getMcpSetup:()=>buildMcpSetup({python,server:path.join(serviceRoot,'call_mcp.py'),home:app.getPath('home')}),
    openExternal:url=>shell.openExternal(url),notify:state=>{
      for(const source of ['system','light','dark']){const item=Menu.getApplicationMenu()?.getMenuItemById('appearance-'+source);if(item)item.checked=state.appearance===source;}
      if(window&&!window.isDestroyed())window.webContents.send('settings:changed',state);
    }});
  const windowBackground=()=>nativeTheme.shouldUseDarkColors?'#151c18':'#f6f5f1';
  nativeTheme.on('updated',()=>{if(window&&!window.isDestroyed())window.setBackgroundColor(windowBackground());});
  const {Introduction} = require('./introduction.cjs');
  introduction = new Introduction({directory:data, version:app.getVersion()});
  ipcMain.handle('introduction:status', event=>{if(!trusted(event))throw Error('Untrusted window');return introduction.status();});
  ipcMain.handle('introduction:dismiss', (event, kind)=>{if(!trusted(event))throw Error('Untrusted window');return introduction.dismiss(kind);});
  const openIntroduction=kind=>{showWindow();window?.webContents.send('introduction:open',kind);};
  const updatesURL='https://github.com/slyapustin/call-note/releases';
  const openReleases=()=>shell.openExternal(updatesURL);
  ipcMain.handle('updates:downloads', event=>{if(!trusted(event))throw Error('Untrusted window');return openReleases();});
  const openUpdates=()=>{window?.show();window?.webContents.send('updates:open');};
  const openSettings=()=>{showWindow();window?.webContents.send('settings:open','general');};
  const appearanceItems=[['system','System'],['light','Light'],['dark','Dark']].map(([source,label])=>({
    id:'appearance-'+source,label,type:'radio',checked:theme.source===source,click:()=>{
      try{settings.setAppearance(source);}catch(error){dialog.showErrorBox('Appearance setting',error.message);}
    }
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'Call Note',submenu:[{role:'about'},{label:'Settings…',accelerator:'CmdOrCtrl+,',click:openSettings},{label:'Check for Updates…',click:openUpdates},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {role:'editMenu'},{label:'View',submenu:[{role:'reload'},{role:'forceReload'},{role:'toggleDevTools'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'},{type:'separator'},{label:'Appearance',submenu:appearanceItems}]},{role:'windowMenu'},{role:'help',submenu:[{label:'Quick Tour',click:()=>openIntroduction('tour')},{label:"What's New",click:()=>openIntroduction('news')},{type:'separator'},{label:'Export Diagnostics…',click:exportDiagnostics},{label:'Downloads & Release Notes',click:openReleases}]}
  ]));

  const port = await new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
  origin = `http://127.0.0.1:${port}`;
  const {GoogleCalendar} = require('./calendar.cjs');
  calendar = new GoogleCalendar({directory:data,safeStorage,shell,clientFile:path.join(app.isPackaged?process.resourcesPath:__dirname,'google-oauth.json')});
  for (const action of ['status','connect','events','disconnect']) ipcMain.handle('calendar:'+action, async event=>{
    if(!trusted(event))throw Error('Untrusted window');
    if(action==='events')return reminders.refresh();
    if(action==='disconnect'){
      reminders.stop();await reminders.pending?.catch(()=>{});
      try {await calendar.disconnect();return {connected:false};} finally {reminders.reset();reminders.start();}
    }
    const result=await calendar[action]();
    if(action==='connect')await reminders.refresh();
    return result;
  });
  fs.mkdirSync(data, {recursive:true, mode:0o700});
  const {MacUpdater} = require('electron-updater');
  const {Updates} = require('./updates.cjs');
  updates = new Updates({updater:new MacUpdater(), nativeUpdater:require('electron').autoUpdater, enabled:app.isPackaged && process.platform==='darwin', isRecording:()=>recording,
    onError:error=>diagnostics.record('updater',error),
    notify:state=>window?.webContents.send('updates:state',state)});
  for (const action of ['status','check','install']) ipcMain.handle('updates:'+action, (event, value)=>{if(!trusted(event))throw Error('Untrusted window');return updates[action](value);});
  const log = fs.openSync(path.join(data, 'service.log'), 'a', 0o600);
  const environment = {...process.env, CALL_DESK_TOKEN:token, CALL_DESK_DATA:data, PYTHONNOUSERSITE:'1', PYTHONDONTWRITEBYTECODE:'1', HF_HOME:path.join(data,'cache/huggingface'), FERMION_CACHE_DIR:path.join(data,'cache/fermion')};
  delete environment.PYTHONPATH; delete environment.PYTHONHOME;
  if (bundled) {environment.CALL_NOTE_MODEL=path.join(root,'models/model_phonon2_c4c_int6'); environment.HF_HUB_OFFLINE='1';}
  service = spawn(python, ['-m', 'uvicorn', 'call_app:app', '--host', '127.0.0.1', '--port', String(port), '--ws-max-size', '65536'], {
    cwd:serviceRoot, env:environment, stdio:['ignore', log, log]
  });
  service.on('error', error => {diagnostics.record('service',error);dialog.showErrorBox('Call Note service failed', error.message);});
  service.on('exit', code => { if (!quitting) {diagnostics.record('service',{name:'Error',message:'Service exited'});dialog.showErrorBox('Call Note service stopped', `Exit ${code}. See ${path.join(data, 'service.log')}`);} });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => contents === window?.webContents && requestingOrigin === origin && ['media', 'display-capture'].includes(permission));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window?.webContents && contents.getURL().startsWith(origin + '/') && ['media', 'display-capture'].includes(permission)));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!request.frame?.url.startsWith(origin + '/')) return callback({});
      const sources = await desktopCapturer.getSources({types:['screen'], thumbnailSize:{width:0,height:0}});
      if (!sources.length) return callback({});
      callback({video:sources[0], audio:'loopback'});
    } catch { callback({}); }
  });
  ipcMain.handle('session', event => { if (!trusted(event)) throw Error('Untrusted window'); return {token, platform:process.platform, version:app.getVersion()}; });
  ipcMain.handle('microphone', async event => {
    if (!trusted(event)) throw Error('Untrusted window');
    return process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true;
  });
  ipcMain.on('recording', (event, value) => { if (trusted(event)) { if(value&&!recording)callTray?.update({phase:'preparing',seconds:0});
    if(!value)callTray?.update({phase:'idle',seconds:0});
    recording = !!value; window.setTitle(recording ? '● Recording · Call Note' : 'Call Note'); } });
  window = new BrowserWindow({width:1240,height:850,minWidth:940,minHeight:650,backgroundColor:windowBackground(),title:'Call Note',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) event.preventDefault(); });
  window.on('close', event => {
    if (!quitting) {event.preventDefault();window.hide();}
  });
  const {CallTray}=require('./tray.cjs');
  const {Tray,nativeImage,Notification,powerMonitor}=require('electron');
  const reminderAction=action=>Promise.resolve().then(action).catch(()=>dialog.showErrorBox('Call Note Calendar','Could not complete this action. Open Call Note and try again.'));
  callTray=new CallTray({Tray,Menu,nativeImage,version:app.getVersion(),show:showWindow,
    join:key=>reminderAction(()=>reminders.join(key)),setReminder:seconds=>reminderAction(()=>settings.setReminder(seconds)),
    start:()=>{showWindow();window.webContents.send('tray:start');},
    stop:()=>window.webContents.send('tray:stop'),quit:()=>app.quit()});
  const {MeetingReminders}=require('./meeting-reminders.cjs');
  reminders=new MeetingReminders({loadEvents:()=>calendar.events(),onChange:value=>callTray.setMeetings(value),openExternal:url=>shell.openExternal(url),show:showWindow,
    settingsFile:path.join(data,'meeting-reminders.json'),
    notify:({event,body,canJoin,activate})=>{
      if(!Notification.isSupported())return;
      const notification=new Notification({title:event.title,body,actions:[{type:'button',text:canJoin?'Join call':'Open Call Note'}]});
      let activated=false;const open=()=>{if(activated)return;activated=true;reminderAction(activate);};
      notification.on('click',open);notification.on('action',open);notification.on('failed',()=>{});notification.show();
      return ()=>notification.close();
    }});
  powerMonitor.on('suspend',()=>reminders.reset());
  powerMonitor.on('resume',async()=>{await reminders.pending?.catch(()=>{});reminders.refresh().catch(()=>{});});
  ipcMain.on('tray:state',(event,value)=>{if(trusted(event))callTray.update(value);});
  window.webContents.on('render-process-gone',()=>{diagnostics.record('renderer',{name:'Error',code:'RENDERER_GONE'});recording=false;callTray.update({phase:'idle',engine:'error'});});
  let ready = false;
  for (let attempt=0;attempt<300;attempt++) {
    try { if ((await fetch(origin)).ok) {ready=true;break;} } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if (!ready) { dialog.showErrorBox('Call Note could not start', `Check ${path.join(data,'service.log')}`); app.quit(); return; }
  await window.loadURL(origin);
  updates.start();
  reminders.start();
});
require('electron').autoUpdater.on('before-quit-for-update',()=>{quitting=true;service?.kill('SIGTERM');});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if(recording&&!quitting){
    const choice=dialog.showMessageBoxSync(window,{type:'question',buttons:['Keep recording','Quit and end call'],defaultId:0,cancelId:0,message:'A call is being transcribed.',detail:'Quitting saves finalized text and marks the call interrupted.'});
    if(choice===0){event.preventDefault();return;}
  }
  quitting=true;reminders?.stop();service?.kill('SIGTERM');
});
