const {app, BrowserWindow, session, desktopCapturer, ipcMain, dialog, systemPreferences, safeStorage, shell} = require('electron');
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
const root = app.isPackaged ? JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime.json'))).root : path.resolve(__dirname, '..');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { window?.show(); window?.focus(); });
function trusted(event) { return event.sender === window?.webContents && event.senderFrame?.url.startsWith(origin + '/'); }
app.whenReady().then(async () => {
  const port = await new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
  origin = `http://127.0.0.1:${port}`;
  const data = app.getPath('userData');
  const {GoogleCalendar} = require('./calendar.cjs');
  calendar = new GoogleCalendar({directory:data,safeStorage,dialog,shell,getWindow:()=>window});
  for (const action of ['status','connect','events','disconnect']) ipcMain.handle('calendar:'+action, event=>{if(!trusted(event))throw Error('Untrusted window');return calendar[action]();});
  fs.mkdirSync(data, {recursive:true, mode:0o700});
  const log = fs.openSync(path.join(data, 'service.log'), 'a', 0o600);
  service = spawn(path.join(root, '.venv/bin/python'), ['-m', 'uvicorn', 'call_app:app', '--host', '127.0.0.1', '--port', String(port), '--ws-max-size', '65536'], {
    cwd:root, env:{...process.env, PATH:`/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`, CALL_DESK_TOKEN:token, CALL_DESK_DATA:data}, stdio:['ignore', log, log]
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
  ipcMain.handle('session', event => { if (!trusted(event)) throw Error('Untrusted window'); return {token, platform:process.platform}; });
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
      if (result === 0) event.preventDefault();
    }
  });
  let ready = false;
  for (let attempt=0;attempt<100;attempt++) {
    try { if ((await fetch(origin)).ok) {ready=true;break;} } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if (!ready) { dialog.showErrorBox('Call Note could not start', `Check ${path.join(data,'service.log')}`); app.quit(); return; }
  await window.loadURL(origin);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {quitting=true;service?.kill('SIGTERM');});
