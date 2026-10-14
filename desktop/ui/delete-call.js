export function setupDeleteCall({getCurrent,isRecording,remove,onDeleted,onError}) {
  const get=id=>document.getElementById('delete-'+id);
  let selected, busy=false;
  const allowed=()=>{const call=getCurrent();return call&&!isRecording()&&call.status!=='recording';};
  function render(){get('call').disabled=busy||!allowed();}
  function close(){get('dialog').close();selected=null;render();get('call').focus();}
  get('call').onclick=()=>{
    if(!allowed()||busy)return;
    get('error').hidden=true;get('error').textContent='';selected=getCurrent().id;get('title').textContent=`Delete “${getCurrent().title}”?`;
    get('dialog').showModal();get('cancel').focus();
  };
  get('cancel').onclick=()=>{if(!busy)close();};
  get('dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else selected=null;});
  get('confirm').onclick=async()=>{
    if(busy)return;
    if(!selected||!allowed()||getCurrent().id!==selected){close();return;}
    const id=selected;busy=true;get('confirm').disabled=get('cancel').disabled=true;render();
    try {await remove(id);close();await onDeleted(id);}
    catch(error){get('error').textContent=error.message||'Could not delete this call. Try again.';get('error').hidden=false;onError(error);}
    finally {busy=false;get('confirm').disabled=get('cancel').disabled=false;render();}
  };
  render();return {render};
}
