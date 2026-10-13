const {packager} = require('@electron/packager');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const metadata = require('./package.json');
const root = path.resolve(__dirname, '..');
execFileSync(path.join(root, '.venv/bin/python'), [path.join(root,'scripts/prepare_bundle.py')], {stdio:'inherit'});
packager({
  dir:__dirname,out:process.env.CALL_NOTE_PACKAGE_OUT || path.join(__dirname,'dist'),name:'Call Note',platform:'darwin',arch:'arm64',overwrite:true,
  appBundleId:'local.calldesk.preview',appVersion:metadata.version,buildVersion:metadata.version,
  ignore:[/^\/dist/,/^\/node_modules/,/^\/ui/,/^\/runtime\.json/,/\.test\.cjs$/],
  extraResource:[path.join(root,'.build/bundle/python'),path.join(root,'.build/bundle/service')],
  extendInfo:{LSMinimumSystemVersion:'14.2',NSMicrophoneUsageDescription:'Call Note transcribes your microphone locally when you start a call.',NSAudioCaptureUsageDescription:'Call Note transcribes the other side of your calls using system audio.',NSScreenCaptureUsageDescription:'Call Note uses system capture to hear call audio. Video is never stored.'}
}).then(paths=>console.log(paths.join('\n'))).catch(error=>{console.error(error);process.exitCode=1;});
