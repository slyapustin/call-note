# Call detection

Call Note's Settings and menu-bar menu offer Call detection → Off, Ask me to start (default), or Start transcription automatically. The setting stays on this Mac. Ask shows a Start transcription notification after about five seconds of sustained microphone activity. Auto uses the same signal and starts only when capture permissions are already granted; otherwise it asks before starting. It never stops a recording just because the microphone becomes inactive. Use Stop & save at the end of the call.

Detection is available on macOS 14.2 or later. The resolver targets Zoom, Microsoft Teams, Google Chrome, Edge, Firefox, and Safari process identities; Safari attribution has not been verified in an actual call. Browser activity identifies the browser, not a particular tab. Pre-join screens, microphone tests, and other browser recordings can trigger detection. Muted or listening-only calls can be missed. This is a likely-call signal, not proof that a meeting has started. Calendar matching continues to use the existing recording flow; a Calendar event alone does not start recording.

## Implementation

A small Objective-C executable reads Apple's public CoreAudio process list, PID, bundle ID and input activity properties. It reads no audio, window titles, tab contents or device names, and requests no recording permissions. Parent-process/application attribution canonicalizes audio helpers. Electron invokes it every two seconds with a timeout and bounded output. Unknown state is unavailable, never evidence that a call ended. Only recognized application identities trigger the policy, so Call Note's own input cannot trigger a loop.

The policy waits five seconds per application, consumes a detection once, and re-arms only after 60 seconds of continuously observed inactivity. Recording, processing, dismissal and failed starts do not repeatedly trigger. Notification activation requires fresh activity from the original application and process. Probe failures, sleep and stale asynchronous results cannot authorize a start. Automatic starts preserve unsaved notes by declining to start until those notes are saved. Source selections and existing microphone/system capture permissions remain in force.

The helper is built into `.build/audio-activity`, included as an Electron extra resource, and covered by the existing recursive Mach-O signing pipeline. It requires macOS 14.2 or later and Apple Silicon, matching the current app distribution.

```sh
.venv/bin/python scripts/build_audio_activity.py
.build/audio-activity --once
node --test desktop/*.test.cjs
```

For development, build the helper once before launching Electron. Packaged builds compile it automatically.

## Validation and remaining checks

The native probe compiled with warnings treated as errors and returned ten valid snapshots on this Mac, correctly attributing Chrome helpers. All processes were inactive. No real call was opened, recorded or ended for that test. Pure policy and monitor tests cover stability, deduplication, application changes, stale notifications, explicit Auto selection, errors, cooldown, preference persistence and lifecycle races.

Live checks still to perform: validate actual Meet, Zoom and Teams pre-join, join, mute/unmute and leave transitions. Confirm notification permissions/fallback, background auto-start with previously granted capture access, denied capture permissions, manual stop, sleep/resume and unchanged saved calls. The packaged helper is signed and notarized with the app. Do not describe those checks as complete based on unit tests.

## API references

- [Apple input activity property](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertyisrunninginput)
- [Apple audio process list](https://developer.apple.com/documentation/coreaudio/kaudiohardwarepropertyprocessobjectlist)
- [Apple process bundle identity](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertybundleid)
- [Electron display capture request handler](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts)
