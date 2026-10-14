const path = require('node:path');

module.exports = {
  appId: 'local.calldesk.preview',
  productName: 'Call Note',
  directories: {output: '../.build/windows-dist'},
  files: [
    '*.cjs', '!*.test.cjs', '!package.cjs', '!package-windows.cjs',
    '!electron-builder.windows.cjs', 'package.json', 'assets/*.png',
  ],
  extraResources: [
    {from: '../.build/bundle/python', to: 'python', filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc']},
    {from: '../.build/bundle/service', to: 'service', filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc']},
  ],
  extraMetadata: {callNoteWindowsPreview: true},
  asar: true,
  win: {
    target: [{target: 'nsis', arch: ['x64']}],
    icon: path.join(__dirname, 'assets/call-note.png'),
    artifactName: 'Call-Note-${version}-Windows-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
  publish: [{provider: 'github', owner: 'slyapustin', repo: 'call-note'}],
};
