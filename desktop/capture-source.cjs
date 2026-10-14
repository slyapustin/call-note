function createDisplayMediaHandler({platform, getContents, getOrigin, desktopCapturer, reportError}) {
  return async (request, callback) => {
    const contents=getContents();
    if (!contents || request.frame !== contents.mainFrame || !request.frame?.url.startsWith(getOrigin()+'/')) return callback({});
    try {
      if (platform==='darwin') return callback({video:request.frame,audio:'loopback'});
      if (platform!=='win32') return callback({});
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
      if (!sources.length) throw Object.assign(Error('No display source'),{name:'NotFoundError'});
      callback({video:sources[0],audio:'loopback'});
    } catch(error) {
      reportError({name:error.name,code:'CAPTURE_SOURCE',message:'Display source selection failed'});
      callback({});
    }
  };
}
module.exports={createDisplayMediaHandler};
