const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {ServiceSupervisor}=require('./service-supervisor.cjs');
function fixture(){
  const children=[],errors=[],timers=new Map();let clock=0,id=0,recycles=0;
  const supervisor=new ServiceSupervisor({command:'python',args:['run_service.py'],options:{env:{TOKEN:'same'}},
    spawnProcess:(command,args,options)=>{const child=new EventEmitter();child.killed=false;child.kill=()=>{child.killed=true;};children.push({child,command,args,options});return child;},
    onError:error=>errors.push(error),onRecycle:()=>recycles++,now:()=>clock,
    setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:id=>timers.delete(id)});
  return {supervisor,children,errors,timers,advance:ms=>clock+=ms,recycles:()=>recycles,
    tick:()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
}
test('only intentional idle exit recycles with the same launch configuration',()=>{
  const f=fixture();f.supervisor.start();f.advance(120000);
  f.children[0].child.emit('exit',75,null);
  assert.equal(f.children.length,1);assert.equal(f.recycles(),1);assert.equal(f.errors.length,0);
  f.tick();assert.equal(f.children.length,2);assert.deepEqual(f.children[1].args,['run_service.py']);
  assert.equal(f.children[1].options.env.TOKEN,'same');
});
test('stop cancels pending recycle and kills a running child without errors',()=>{
  const f=fixture();f.supervisor.start();f.children[0].child.emit('exit',75,null);f.supervisor.stop();f.tick();
  assert.equal(f.children.length,1);assert.equal(f.timers.size,0);
  f.supervisor.start();f.supervisor.stop();assert.equal(f.children[1].child.killed,true);
  f.children[1].child.emit('exit',null,'SIGTERM');assert.equal(f.errors.length,0);
});
test('natural failure or unexpected clean exit never silently restarts',()=>{
  for(const code of [0,1,null]){const f=fixture();f.supervisor.start();f.children[0].child.emit('exit',code,code===null?'SIGKILL':null);f.tick();assert.equal(f.children.length,1);assert.equal(f.errors.length,1);}
});
test('spawn failure is reported once with no restart',()=>{
  const f=fixture();f.supervisor.start();f.children[0].child.emit('error',new Error('spawn failed'));f.children[0].child.emit('exit',1,null);f.tick();assert.equal(f.errors.length,1);assert.equal(f.children.length,1);
});
test('rapid exit75 loop stops after a bounded number of attempts',()=>{
  const f=fixture();f.supervisor.start();
  for(let i=0;i<4;i++){f.children[i].child.emit('exit',75,null);f.tick();}
  assert.equal(f.children.length,4);assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/rapid idle restarts/);assert.equal(f.timers.size,0);
});
