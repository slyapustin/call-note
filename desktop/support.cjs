const fs = require('node:fs/promises');
const path = require('node:path');

function registerSupport({ipcMain, clipboard, trusted, diagnostics}) {
  ipcMain.handle('clipboard:write', (event, text) => {
    if (!trusted(event)) throw Error('Untrusted window');
    if (typeof text !== 'string' || text.length > 100000) throw Error('Invalid clipboard text');
    try { clipboard.writeText(text); }
    catch (error) { diagnostics.record('clipboard', error); throw Error('Could not copy the text. Try again.'); }
  });
  ipcMain.on('diagnostics:error', (event, error) => {
    if (trusted(event)) diagnostics.record('renderer', error);
  });
}

function createDiagnosticsExporter({dialog, shell, getWindow, diagnostics, getState, downloads, filesystem=fs}) {
  let exporting = false;
  return async () => {
    if (exporting) return;
    exporting = true;
    try {
      const window = getWindow();
      const result = await dialog.showSaveDialog(window, {
        title:'Export Call Note diagnostics',
        defaultPath:path.join(downloads, `Call-Note-diagnostics-${new Date().toISOString().slice(0,10)}.txt`),
        filters:[{name:'Text report',extensions:['txt']}],
        message:'Includes app versions and error categories. Excludes transcripts, notes, Calendar details and credentials. Nothing is sent automatically.'
      });
      if (result.canceled || !result.filePath) return;
      await filesystem.writeFile(result.filePath, diagnostics.exportReport(getState()), {encoding:'utf8',mode:0o600});
      const choice = await dialog.showMessageBox(window, {
        type:'info',message:'Diagnostics saved',
        detail:'Review the text file, then attach it to your support conversation or GitHub issue. Include what you were doing and when the problem happened.',
        buttons:['Show in Finder','Done'],defaultId:0,cancelId:1
      });
      if (choice.response === 0) shell.showItemInFolder(result.filePath);
    } catch (error) {
      diagnostics.record('app', error);
      dialog.showErrorBox('Could not export diagnostics','Choose a writable location and try again.');
    } finally { exporting = false; }
  };
}

module.exports = {registerSupport, createDiagnosticsExporter};
