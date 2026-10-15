export function setupPrivacy({bridge,beforeOpen=()=>{}}) {
  const get=id=>document.getElementById('privacy-'+id);
  const dialog=get('dialog');
  let state, resolvePending, returnFocus;
  function render(next) {
    state=next;
    get('documents').textContent=next.documents.terms+'\n\n'+next.documents.notice;
    get('choice').checked=next.analytics===true;
    get('choice').disabled=!next.available||next.pendingDeletion;
    get('accepted').checked=next.accepted===true;
    get('accepted').disabled=!next.available||next.pendingDeletion;
    get('save').disabled=!next.available||next.pendingDeletion;
    get('delete').disabled=!next.accepted&&!next.pendingDeletion;
    get('status').textContent=next.pendingDeletion?'Deletion is pending. Usage collection is off; the request will retry when online.':!next.available?(next.documents.available?'Privacy settings are unavailable. New transcription requires saved terms acceptance. No usage data is sent.':'Usage statistics are unavailable in this build. No usage data is sent.'):next.accepted?'Terms accepted. Optional analytics is '+(next.analytics?'on.':'off.'):'Review the terms and privacy notice. Optional analytics is off unless you choose it.';
  }
  async function open() {
    render(await bridge.privacyStatus());beforeOpen();returnFocus=document.activeElement;
    if(!dialog.open)dialog.showModal();
  }
  async function ensure() {
    const next=await bridge.privacyStatus();
    if(!next.documents.available||next.accepted)return true;
    if(resolvePending)return false;
    await open();
    return new Promise(resolve=>{resolvePending=resolve;});
  }
  get('save').onclick=async()=>{
    if(!get('accepted').checked){get('status').textContent='Accept the terms to continue, or choose Later.';return;}
    get('save').disabled=true;
    try {
      const choice=get('choice').checked;
      if(!state.accepted)await bridge.privacyAccept();
      render(await bridge.privacyAnalytics(choice));
      const resolve=resolvePending;resolvePending=null;dialog.close();resolve?.(true);
    } catch {get('status').textContent='Could not save your choice. Please try again.';get('save').disabled=false;}
  };
  get('delete').onclick=()=>{get('delete-confirm').hidden=false;};
  get('delete-cancel').onclick=()=>{get('delete-confirm').hidden=true;};
  get('delete-confirm-button').onclick=async()=>{
    get('delete-confirm-button').disabled=true;
    try {render(await bridge.privacyDelete());get('delete-confirm').hidden=true;}
    catch {get('status').textContent='Could not request deletion. Try again; saved calls are unchanged.';}
    finally {get('delete-confirm-button').disabled=false;}
  };
  get('close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{const resolve=resolvePending;resolvePending=null;resolve?.(false);get('delete-confirm').hidden=true;if(returnFocus?.isConnected)returnFocus.focus();});
  return {open,ensure};
}
