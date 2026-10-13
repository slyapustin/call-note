const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('callDesk', {
  calendarStatus:()=>ipcRenderer.invoke('calendar:status'),
  calendarConnect:()=>ipcRenderer.invoke('calendar:connect'),
  calendarEvents:()=>ipcRenderer.invoke('calendar:events'),
  calendarDisconnect:()=>ipcRenderer.invoke('calendar:disconnect'),
  connectAssistants:()=>ipcRenderer.invoke('connect-assistants'),
  updateStatus:()=>ipcRenderer.invoke('updates:status'),
  updateCheck:()=>ipcRenderer.invoke('updates:check'),
  updateInstall:()=>ipcRenderer.invoke('updates:install'),
  onUpdateState:callback=>ipcRenderer.on('updates:state',(_event,state)=>callback(state)),
  onUpdateOpen:callback=>ipcRenderer.on('updates:open',()=>callback()),
  menuState:state=>ipcRenderer.send('tray:state',state),
  onMenuStart:callback=>ipcRenderer.on('tray:start',()=>callback()),
  onMenuStop:callback=>ipcRenderer.on('tray:stop',()=>callback()),
  session:()=>ipcRenderer.invoke('session'),
  microphone:()=>ipcRenderer.invoke('microphone'),
  recording:value=>ipcRenderer.send('recording', !!value)
});
