const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('callDesk', {
  calendarStatus:()=>ipcRenderer.invoke('calendar:status'),
  calendarConnect:()=>ipcRenderer.invoke('calendar:connect'),
  calendarEvents:()=>ipcRenderer.invoke('calendar:events'),
  calendarDisconnect:()=>ipcRenderer.invoke('calendar:disconnect'),
  connectAssistants:()=>ipcRenderer.invoke('connect-assistants'),
  updates:()=>ipcRenderer.invoke('updates'),
  session:()=>ipcRenderer.invoke('session'),
  microphone:()=>ipcRenderer.invoke('microphone'),
  recording:value=>ipcRenderer.send('recording', !!value)
});
