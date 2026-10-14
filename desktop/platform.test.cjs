const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtimePython}=require('./platform.cjs');
test('runtime paths select Windows embedded and development Python executables',()=>{
  assert.equal(runtimePython({platform:'win32',bundled:true,resources:String.raw`C:\Program Files\Call Note\resources`}),String.raw`C:\Program Files\Call Note\resources\python\python.exe`);
  assert.equal(runtimePython({platform:'win32',bundled:false,root:String.raw`C:\src\call-note`}),String.raw`C:\src\call-note\.venv\Scripts\python.exe`);
});
test('macOS runtime paths remain unchanged',()=>{
  assert.equal(runtimePython({platform:'darwin',bundled:true,resources:'/Applications/Call Note.app/Contents/Resources'}),'/Applications/Call Note.app/Contents/Resources/python/bin/python3.13');
  assert.equal(runtimePython({platform:'darwin',bundled:false,root:'/src/call-note'}),'/src/call-note/.venv/bin/python');
});
