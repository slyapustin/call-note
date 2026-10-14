const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build the Windows x64 installer on Windows x64. The Python runtime must be tested natively.');
}
execFileSync(process.env.CALL_NOTE_BUILD_PYTHON || 'python', [path.join(root, 'scripts/prepare_bundle_windows.py')], {cwd: root, stdio: 'inherit'});
for (const relative of ['python/python.exe', 'service/call_app.py', 'service/bundle.json']) {
  if (!fs.existsSync(path.join(root, '.build/bundle', relative))) throw new Error(`Missing prepared Windows resource: ${relative}`);
}
execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.windows.cjs', '--win', 'nsis', '--x64', '--publish', 'never'], {cwd: __dirname, stdio: 'inherit'});
