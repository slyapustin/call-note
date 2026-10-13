const {app, BrowserWindow, session, desktopCapturer, ipcMain, dialog, systemPreferences, safeStorage, shell, Menu} = require('electron');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
app.setName('Call Note');
app.setPath('userData', path.join(app.getPath('appData'), 'CallDesk'));
let calendar;
let window, service, quitting = false, recording = false;
const token = randomBytes(32).toString('hex');
let origin;
const bundled = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'service'));
const root = bundled ? path.join(process.resourcesPath, 'service') : path.resolve(__dirname, '..');
const python = bundled ? path.join(process.resourcesPath, 'python/bin/python3.13') : path.join(root, '.venv/bin/python');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { window?.show(); window?.focus(); });
function trusted(event) { return event.sender === window?.webContents && event.senderFrame?.url.startsWith(origin + '/'); }
app.whenReady().then(async () => {
  const updatesURL='https://github.com/slyapustin/call-note/releases/latest';
  const openUpdates=()=>shell.openExternal(updatesURL);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'Call Note',submenu:[{role:'about'},{label:'Check for Updates…',click:openUpdates},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
    {role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'},{role:'help',submenu:[{label:'Downloads & Release Notes',click:openUpdates}]}
  ]));
  ipcMain.handle('updates',event=>{if(!trusted(event))throw Error('Untrusted window');return openUpdates();});
  const port = await new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
  origin = `http://127.0.0.1:${port}`;
  const data = app.getPath('userData');
  const {GoogleCalendar} = require('./calendar.cjs');
  calendar = new GoogleCalendar({directory:data,safeStorage,dialog,shell,getWindow:()=>window});
  for (const action of ['status','connect','events','disconnect']) ipcMain.handle('calendar:'+action, event=>{if(!trusted(event))throw Error('Untrusted window');return calendar[action]();});
  fs.mkdirSync(data, {recursive:true, mode:0o700});
  const log = fs.openSync(path.join(data, 'service.log'), 'a', 0o600);
  const environment = {...process.env, CALL_DESK_TOKEN:token, CALL_DESK_DATA:data, PYTHONNOUSERSITE:'1', PYTHONDONTWRITEBYTECODE:'1', HF_HOME:path.join(data,'cache/huggingface'), FERMION_CACHE_DIR:path.join(data,'cache/fermion')};
  delete environment.PYTHONPATH; delete environment.PYTHONHOME;
  if (bundled) {environment.CALL_NOTE_MODEL=path.join(root,'models/model_phonon2_c4c_int6'); environment.HF_HUB_OFFLINE='1';}
  service = spawn(python, ['-m', 'uvicorn', 'call_app:app', '--host', '127.0.0.1', '--port', String(port), '--ws-max-size', '65536'], {
    cwd:root, env:environment, stdio:['ignore', log, log]
  });
  service.on('error', error => dialog.showErrorBox('Call Note service failed', error.message));
  service.on('exit', code => { if (!quitting) dialog.showErrorBox('Call Note service stopped', `Exit ${code}. See ${path.join(data, 'service.log')}`); });
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
  ipcMain.handle('connect-assistants', async event => {
    if (!trusted(event)) throw Error('Untrusted window');
    return new Promise((resolve,reject)=>{
      const child=spawn(python,[path.join(root,'connect_mcp.py')],{cwd:root,env:{...environment,CALL_NOTE_PYTHON:python}});
      let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
      child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error(output)));
    });
  });
  ipcMain.handle('session', event => { if (!trusted(event)) throw Error('Untrusted window'); return {token, platform:process.platform, version:app.getVersion()}; });
  ipcMain.handle('microphone', async event => {
    if (!trusted(event)) throw Error('Untrusted window');
    return process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true;
  });
  ipcMain.on('recording', (event, value) => { if (trusted(event)) { recording = !!value; window.setTitle(recording ? '● Recording · Call Note' : 'Call Note'); } });
  window = new BrowserWindow({width:1240,height:850,minWidth:940,minHeight:650,backgroundColor:'#f6f5f1',title:'Call Note',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) event.preventDefault(); });
  window.on('close', event => {
    if (recording && !quitting) {
      const result = dialog.showMessageBoxSync(window, {type:'question',buttons:['Keep recording','Close and end call'],defaultId:0,cancelId:0,message:'A call is being transcribed.',detail:'Closing saves finalized text. The call will be marked interrupted.'});
      if (result === 0) event.preventDefault(); else recording=false;
    }
  });
  let ready = false;
  for (let attempt=0;attempt<300;attempt++) {
    try { if ((await fetch(origin)).ok) {ready=true;break;} } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if (!ready) { dialog.showErrorBox('Call Note could not start', `Check ${path.join(data,'service.log')}`); app.quit(); return; }
  await window.loadURL(origin);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if(recording&&!quitting){
    const choice=dialog.showMessageBoxSync(window,{type:'question',buttons:['Keep recording','Quit and end call'],defaultId:0,cancelId:0,message:'A call is being transcribed.',detail:'Quitting saves finalized text and marks the call interrupted.'});
    if(choice===0){event.preventDefault();return;}
  }
  quitting=true;service?.kill('SIGTERM');
});
