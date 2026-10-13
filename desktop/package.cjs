const {packager} = require('@electron/packager');
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(__dirname,'runtime.json'), JSON.stringify({root:path.resolve(__dirname,'..')}));
packager({dir:__dirname,out:path.join(__dirname,'dist'),name:'Call Note',platform:'darwin',arch:process.arch,overwrite:true,appBundleId:'local.calldesk.preview',appVersion:'0.1.0',ignore:[/^\/dist/,/^\/node_modules/,/^\/ui/],extendInfo:{NSMicrophoneUsageDescription:'Call Note transcribes your microphone locally when you start a call.',NSAudioCaptureUsageDescription:'Call Note transcribes the other side of your calls using system audio.',NSScreenCaptureUsageDescription:'Call Note uses system capture to hear call audio. Video is never stored.'}}).then(paths=>console.log(paths.join('\n'))).catch(error=>{console.error(error);process.exitCode=1;});
