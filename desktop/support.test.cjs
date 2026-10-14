const {test} = require('node:test');
const assert = require('node:assert/strict');
const {registerSupport, createDiagnosticsExporter} = require('./support.cjs');

test('clipboard writes through Electron only for the trusted renderer and bounded strings', () => {
  const handlers={}, writes=[], events=[];
  registerSupport({ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>handlers[name]=fn},
    clipboard:{writeText:text=>writes.push(text)},trusted:event=>event.allowed,
    diagnostics:{record:(...args)=>events.push(args)}});
  assert.throws(()=>handlers['clipboard:write']({allowed:false},'secret'),/Untrusted/);
  for (const value of [null,{},'x'.repeat(100001)]) assert.throws(()=>handlers['clipboard:write']({allowed:true},value),/Invalid/);
  handlers['clipboard:write']({allowed:true},'Call Note analysis prompt');
  assert.deepEqual(writes,['Call Note analysis prompt']);
  handlers['diagnostics:error']({allowed:false},{message:'untrusted'});
  assert.equal(events.length,0);
});

test('clipboard failures record the error without passing copied content to diagnostics', () => {
  const handlers={},events=[];const error=new Error('Native clipboard unavailable');
  registerSupport({ipcMain:{handle:(n,f)=>handlers[n]=f,on:()=>{}},trusted:()=>true,
    clipboard:{writeText:()=>{throw error;}},diagnostics:{record:(...args)=>events.push(args)}});
  assert.throws(()=>handlers['clipboard:write']({},'private call title'),/Could not copy/);
  assert.deepEqual(events,[['clipboard',error]]);
});

test('diagnostics export cancellation writes nothing; successful export saves report without sending it', async () => {
  let canceled=true;const writes=[],reveals=[];
  const exportReport=createDiagnosticsExporter({dialog:{showSaveDialog:async()=>({canceled,filePath:'/tmp/report.txt'}),
    showMessageBox:async()=>({response:0}),showErrorBox:()=>assert.fail('Unexpected error')},shell:{showItemInFolder:p=>reveals.push(p)},
    getWindow:()=>({}),downloads:'/tmp',getState:()=>({recording:false}),
    diagnostics:{exportReport:state=>JSON.stringify(state),record:()=>{}},filesystem:{writeFile:async(...args)=>writes.push(args)}});
  await exportReport();assert.equal(writes.length,0);
  canceled=false;await exportReport();
  assert.deepEqual(writes,[['/tmp/report.txt','{"recording":false}',{encoding:'utf8',mode:0o600}]]);
  assert.deepEqual(reveals,['/tmp/report.txt']);
});

test('failed diagnostics save reports failure and does not reveal a nonexistent report', async () => {
  let errors=0;
  const exportReport=createDiagnosticsExporter({dialog:{showSaveDialog:async()=>({filePath:'/tmp/report.txt'}),
    showErrorBox:()=>errors++},shell:{showItemInFolder:()=>assert.fail('No file saved')},getWindow:()=>({}),downloads:'/tmp',getState:()=>({}),
    diagnostics:{exportReport:()=>'',record:()=>{}},filesystem:{writeFile:async()=>{throw Error('disk full');}}});
  await exportReport();assert.equal(errors,1);
});
