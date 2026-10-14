const path=require('node:path');
function runtimePython({platform,bundled,resources,root}) {
  const paths=platform==='win32'?path.win32:path.posix;
  if(bundled)return paths.join(resources,...(platform==='win32'?['python','python.exe']:['python','bin','python3.13']));
  return paths.join(root,'.venv',...(platform==='win32'?['Scripts','python.exe']:['bin','python']));
}
module.exports={runtimePython};
