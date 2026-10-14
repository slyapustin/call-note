const tour = [
  {
    title: 'Your calls, written down.',
    description: 'Start a call to transcribe your microphone and the voices you hear. Everything is processed on your device.',
    detail: 'Recording starts when you choose Start call or enable automatic starting in Settings. Use headphones for clearer results. Call Note saves the transcript, not the recording.',
    preview: 'voices',
  },
  {
    title: 'Be ready for the next call.',
    description: 'Connect Google Calendar in Settings to match meeting details automatically. Your next meeting and a Join call action appear in the Call Note tray menu.',
    detail: 'Choose a reminder one minute or 30 seconds before a meeting. Joining opens the meeting link; transcription starts manually unless you enable automatic call detection. Google sign-in currently requires an approved test account.',
    preview: 'calendar',
  },
  {
    title: 'Keep the useful parts.',
    description: 'Search past calls, add your notes, and export a transcript. Connect Codex or Claude to find decisions and next steps.',
    detail: 'Open Settings → Assistants for setup instructions. A connected assistant can read your entire call library. Text it reads is subject to that assistant’s data policies. You can explore a playable sample before your first call.',
    preview: 'notes',
  },
];

export function setupIntroduction({bridge, version, canOpen, onError}) {
  const dialog = document.getElementById('introduction');
  const get = id => document.getElementById(`intro-${id}`);
  let kind = 'tour', step = 0, pending, dismissing = false, returnFocus, manualRequest = false;

  function render() {
    const isTour = kind === 'tour';
    get('eyebrow').textContent = isTour ? `A quick tour · ${step + 1} of ${tour.length}` : `What’s new in Call Note ${version}`;
    get('title').textContent = isTour ? tour[step].title : 'More consistent speaker labels.';
    get('description').textContent = isTour ? tour[step].description : 'Short or uncertain phrases no longer create a new speaker as easily. Strong voice matches improve the reference during the call.';
    get('detail').textContent = isTour ? tour[step].detail : 'This screen appears once after each app update. Reopen it anytime from Help → What’s New.';
    for (const preview of dialog.querySelectorAll('[data-preview]')) preview.hidden = preview.dataset.preview !== (isTour ? tour[step].preview : 'news');
    get('back').hidden = !isTour || step === 0;
    get('tour').hidden = isTour;
    get('skip').textContent = isTour ? 'Skip tour' : 'Close';
    get('next').textContent = isTour ? (step < tour.length - 1 ? 'Next' : 'Start exploring') : 'Got it';
    get('progress').hidden = !isTour;
    [...get('progress').children].forEach((dot, index) => dot.dataset.current = String(index === step));
  }

  function open(nextKind) {
    if (!['tour', 'news'].includes(nextKind)) return;
    if (dialog.open && !dismissing && canOpen()) {
      pending = null;
      if (kind !== nextKind) {kind = nextKind; step = 0; render(); get('next').focus();}
      return;
    }
    pending = {kind:nextKind, step:0};
    maybeOpen();
  }

  function maybeOpen() {
    if (!pending || dismissing || dialog.open || !canOpen() || document.querySelector('dialog[open]')) return;
    ({kind, step} = pending); pending = null;
    returnFocus = document.activeElement;
    render(); dialog.showModal(); get('next').focus();
  }

  function suspend() {
    if (!dialog.open) return;
    if (!dismissing) pending ??= {kind, step};
    dialog.close();
  }

  async function dismiss() {
    if (dismissing) return;
    dismissing = true;
    try { await bridge.introductionDismiss(kind); }
    catch { onError('Could not save your tour preference. It may appear again next time.'); }
    finally {
      dialog.close(); dismissing = false;
      if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus();
    }
  }

  function move(delta) {
    if (dismissing) return;
    step += delta; render(); get('next').focus();
  }
  get('next').onclick = () => kind === 'tour' && step < tour.length - 1 ? move(1) : dismiss();
  get('back').onclick = () => move(-1);
  get('skip').onclick = dismiss;
  get('tour').onclick = () => {if (dismissing) return; kind = 'tour'; step = 0; render(); get('next').focus();};
  dialog.addEventListener('cancel', event => {event.preventDefault(); dismiss();});
  bridge.onIntroductionOpen(nextKind => {
    if (!['tour', 'news'].includes(nextKind)) return;
    manualRequest = true;
    open(nextKind);
  });
  // Check again when a recording, sample, or another dialog finishes.
  const interval = setInterval(maybeOpen, 1000);
  window.addEventListener('pagehide', () => clearInterval(interval), {once:true});
  bridge.introductionStatus().then(state => {if (!manualRequest && state.kind) open(state.kind);}).catch(() => {});
  return {suspend};
}
