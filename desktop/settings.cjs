function registerSettings({ipcMain,trusted,theme,getReminders,getDetection=()=>({mode:'ask',available:false}),setDetection=()=>{},notify=()=>{},getMcpSetup,openExternal,exportDiagnostics}) {
  const status=()=>({appearance:theme.source,leadSeconds:getReminders()?.leadSeconds??60,detection:getDetection()});
  const publish=()=>{const state=status();notify(state);return state;};
  const setAppearance=source=>{
    if(!['system','light','dark'].includes(source))throw Error('Invalid appearance');
    const result=theme.set(source);
    const state=publish();
    if(!result.persisted)throw Error('Appearance changed for this session, but could not be saved. Check that your user Library is writable.');
    return state;
  };
  const setReminder=seconds=>{
    if(![0,30,60].includes(seconds))throw Error('Invalid reminder timing');
    const reminders=getReminders();
    if(!reminders)throw Error('Calendar settings are still loading. Try again shortly.');
    reminders.setLead(seconds);return publish();
  };
  const changeDetection=mode=>{setDetection(mode);return publish();};
  const handlers={
    'settings:status':status,
    'settings:appearance':setAppearance,
    'settings:reminder':setReminder,
    'settings:detection':changeDetection,
    'settings:export-diagnostics':exportDiagnostics,
    'mcp:setup':getMcpSetup,
    'mcp:docs':id=>{
      if(!['codex','claude'].includes(id))throw Error('Unknown assistant');
      return openExternal(getMcpSetup().clients.find(client=>client.id===id).docsUrl);
    }
  };
  for(const [channel,handler] of Object.entries(handlers))ipcMain.handle(channel,(event,value)=>{
    if(!trusted(event))throw Error('Untrusted window');
    return handler(value);
  });
  return {status,publish,setAppearance,setReminder,changeDetection};
}
module.exports={registerSettings};
