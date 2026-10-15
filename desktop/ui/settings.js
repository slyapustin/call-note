const sections = ['general', 'calendar', 'assistants', 'privacy', 'support'];

export function setupSettings({bridge, version, refreshCalendar, openUpdates, openPrivacy=async()=>{}, beforeOpen = () => {}, onError = () => {}}) {
  const get = id => document.getElementById(`settings-${id}`);
  const dialog = get('dialog');
  let section = 'general', returnFocus, preferences, clients = [], calendarBusy = false, calendarState;
  let setupLoaded = false, setupRequest, statusRequest, preferenceRevision = 0;

  function message(text = '', error = false) {
    get('message').textContent = text;
    get('message').hidden = !text;
    get('message').dataset.error = String(error);
  }
  function action(button, fn) {
    return async () => {
      button.disabled = true; message();
      try {await fn();}
      catch (error) {onError(error); message(error.message || 'This action could not be completed. Try again.', true);}
      finally {button.disabled = false;}
    };
  }
  function renderPreferences(state) {
    preferenceRevision += 1;
    preferences = state;
    get('appearance').value = state.appearance;
    get('reminder').value = String(state.leadSeconds);
    get('detection').value = state.detection?.mode || 'ask';
    get('detection').disabled = state.detection?.supported === false;
  }
  function renderCalendar(state) {
    calendarState = state;
    get('calendar-status').textContent = state.connected ? 'Connected · Primary calendar · Read-only' : state.available === false ? 'Google sign-in is unavailable in this build.' : 'Not connected';
    get('calendar-connect').hidden = !!state.connected;
    get('calendar-connect').disabled = calendarBusy || state.available === false;
    get('calendar-connected').hidden = !state.connected;
    get('calendar-refresh').disabled = calendarBusy;
    get('calendar-disconnect').disabled = calendarBusy;
  }
  function renderUpdate(state) {get('update-status').textContent = state.message || 'Updates check automatically.';}
  function renderClient() {
    const client = clients.find(item => item.id === get('client').value);
    get('mcp-steps').replaceChildren(...(client?.steps || []).map(text => {
      const item = document.createElement('li'); item.textContent = text; return item;
    }));
    get('mcp-config').value = client?.snippet || '';
    get('mcp-path').textContent = client?.configPath || '';
    get('mcp-copy').disabled = !client;
    get('mcp-docs').disabled = !client;
  }
  async function loadSetup() {
    if (setupLoaded) return;
    if (!setupRequest) setupRequest = bridge.mcpSetup().then(data => {
      clients = data.clients;
      get('client').replaceChildren(...clients.map(client => new Option(client.label, client.id)));
      get('client').disabled = !clients.length;
      setupLoaded = true; renderClient();
    }).finally(() => {setupRequest = null;});
    await setupRequest;
  }
  async function loadPreferences() {
    if (!statusRequest) {
      const revision = preferenceRevision;
      statusRequest = bridge.settingsStatus().then(state => {
        if (revision === preferenceRevision) renderPreferences(state);
        get('appearance').disabled = false; get('reminder').disabled = false;
      }).finally(() => {statusRequest = null;});
    }
    await statusRequest;
  }
  async function select(next, focus = true) {
    section = sections.includes(next) ? next : 'general';
    const requested = section;
    get('content').scrollTop = 0;
    message();
    for (const name of sections) {
      const selected = name === section;
      get(`tab-${name}`).setAttribute('aria-selected', String(selected));
      get(`tab-${name}`).tabIndex = selected ? 0 : -1;
      get(name).hidden = !selected;
    }
    if (focus) get(`tab-${section}`).focus();
    try {
      if (section === 'assistants') await loadSetup();
      if (section === 'support') renderUpdate(await bridge.updateStatus());
    } catch (error) {onError(error); if (section === requested) message(error.message || 'Settings could not load. Reopen this section to retry.', true);}
  }
  function close() {if (dialog.open) dialog.close();}
  async function open(next = section) {
    if (!dialog.open) {returnFocus = document.activeElement; beforeOpen(); dialog.showModal();}
    select(next);
    try {await loadPreferences();}
    catch (error) {onError(error); message('Preferences could not load. Close Settings and try again.', true);}
    try {renderCalendar(await bridge.calendarStatus());}
    catch (error) {onError(error); if (section === 'calendar') message('Calendar could not refresh. Try again from Calendar settings.', true);}
  }

  for (const name of sections) {
    const tab = get(`tab-${name}`);
    tab.onclick = () => select(name);
    tab.onkeydown = event => {
      let index = sections.indexOf(name);
      if (event.key === 'ArrowDown') index = (index + 1) % sections.length;
      else if (event.key === 'ArrowUp') index = (index + sections.length - 1) % sections.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = sections.length - 1;
      else return;
      event.preventDefault(); select(sections[index]);
    };
  }
  get('close').onclick = close;
  dialog.addEventListener('close', () => {if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus();});
  get('open').onclick = () => open();
  document.getElementById('calendar-manage').onclick = () => open('calendar');
  get('appearance').onchange = action(get('appearance'), async () => {
    try {renderPreferences(await bridge.setAppearance(get('appearance').value));}
    catch (error) {if (preferences) renderPreferences(preferences); throw error;}
  });
  get('reminder').onchange = action(get('reminder'), async () => {
    try {renderPreferences(await bridge.setReminder(Number(get('reminder').value)));}
    catch (error) {if (preferences) renderPreferences(preferences); throw error;}
  });
  get('detection').onchange = action(get('detection'), async () => {
    try {renderPreferences(await bridge.setDetection(get('detection').value));}
    catch (error) {if (preferences) renderPreferences(preferences); throw error;}
  });
  function calendarAction(fn, success) {
    return async () => {
      calendarBusy = true; if (calendarState) renderCalendar(calendarState); message();
      try {await fn(); renderCalendar(await refreshCalendar()); if (success) message(success);}
      catch (error) {onError(error); message(error.message || 'Calendar could not connect. Please try again.', true);}
      finally {calendarBusy = false; if (calendarState) renderCalendar(calendarState);}
    };
  }
  get('calendar-connect').onclick = calendarAction(() => bridge.calendarConnect(), 'Calendar connected. Upcoming meetings are available from the Call Note tray menu.');
  get('calendar-refresh').onclick = calendarAction(async () => {}, 'Meetings refreshed.');
  get('calendar-disconnect').onclick = calendarAction(() => bridge.calendarDisconnect(), 'Calendar disconnected. Saved calls are unchanged.');
  get('client').onchange = () => {message(); renderClient();};
  get('mcp-copy').onclick = action(get('mcp-copy'), async () => {
    await bridge.copyText(get('mcp-config').value);
    bridge.usageEvent?.('feature_used',{feature:'mcp_setup'});
    message('Configuration copied. Follow the setup steps in your assistant; its settings have not been changed.');
  });
  get('mcp-docs').onclick = action(get('mcp-docs'), () => bridge.mcpDocs(get('client').value));
  get('privacy-manage').onclick = action(get('privacy-manage'),async()=>{close();await openPrivacy();});
  get('diagnostics').onclick = action(get('diagnostics'), () => bridge.exportDiagnostics());
  get('releases').onclick = action(get('releases'), () => bridge.updateDownloads());
  get('updates').onclick = action(get('updates'), async () => {close(); await openUpdates();});
  get('version').textContent = `v${version}`;
  bridge.onSettingsOpen(next => {open(next);});
  bridge.onSettingsChanged(renderPreferences);
  bridge.onUpdateState(renderUpdate);
  return {open, close, renderCalendar};
}
