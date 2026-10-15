export function setupCallAudio({api,onError}) {
  const player=document.getElementById('call-audio');
  const section=document.getElementById('saved-audio');
  const download=document.getElementById('export-audio');
  let selected=null, generation=0;
  function clear(){generation++;selected=null;player.pause();player.removeAttribute('src');player.load();section.hidden=true;download.removeAttribute('href');}
  async function render(call){
    if(!call?.audio){clear();return;}
    if(selected===call.id)return;
    clear();selected=call.id;const ticket=generation;
    try {
      await api('/recordings/session',{method:'POST'});
      if(ticket!==generation)return;
      player.src=`/api/calls/${call.id}/audio`;
      download.href=`/api/calls/${call.id}/audio?download=true`;
      download.download=`call-${call.id}.wav`;
      section.hidden=false;
    } catch(error){if(ticket===generation){selected=null;onError(error);}}
  }
  return {render,clear};
}
