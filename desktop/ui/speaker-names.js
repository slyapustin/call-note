export const speakerLabel = row => row.display_name || (row.speaker ? `Speaker ${row.speaker}` : row.source === 'microphone' ? 'You' : row.source === 'system' ? 'Speaker uncertain' : 'Sample');

export function setupSpeakerNames({getCurrent,api,onSaved}) {
  const get=id=>document.getElementById('speaker-'+id);
  let selected, busy=false, trigger;
  function close(){get('dialog').close();(document.getElementById(trigger?.id)||trigger)?.focus();}
  get('cancel').onclick=()=>{if(!busy)close();};
  get('dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  get('form').onsubmit=async event=>{
    event.preventDefault();
    if(busy||!selected)return;
    busy=true;get('save').disabled=get('cancel').disabled=true;
    try {
      const call=await api(`/calls/${selected.callId}/segments/${selected.row.id}/speaker`,{method:'PATCH',body:JSON.stringify({name:get('name').value,scope:get('scope').value})});
      if(getCurrent()?.id===call.id)onSaved(call);
      close();
    } catch(error){get('error').textContent=error.message||'Could not save speaker name.';get('error').hidden=false;}
    finally{busy=false;get('save').disabled=get('cancel').disabled=false;}
  };
  return {open(row,button){
    const call=getCurrent();if(!call||call.status==='recording')return;
    selected={callId:call.id,row};trigger=button;
    const grouped=!!row.speaker||row.source==='microphone';
    get('scope').replaceChildren();
    for(const [value,text] of [...(grouped?[['speaker','This speaker throughout this call']]:[]),['segment','Only this line']]){
      const option=document.createElement('option');option.value=value;option.textContent=text;get('scope').append(option);
    }
    get('scope').value=row.speaker_name||!grouped?'segment':'speaker';
    const names=call.speaker_names||[];
    const groupName=names.find(item=>item.source===row.source&&item.speaker===(row.speaker||0))?.name||'';
    const fill=()=>{get('name').value=get('scope').value==='segment'?(row.speaker_name||row.display_name||''):groupName;};
    get('scope').onchange=fill;fill();
    get('suggestions').replaceChildren(...[...new Set([...names.map(item=>item.name),...call.segments.map(item=>item.display_name)].filter(Boolean))].map(name=>{const option=document.createElement('option');option.value=name;return option;}));
    get('error').hidden=true;get('dialog').showModal();get('name').focus();
  }};
}
