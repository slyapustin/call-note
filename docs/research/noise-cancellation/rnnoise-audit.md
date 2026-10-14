# Outgoing microphone research — 2026-10-14

No product source changed, no system driver installed, and no real remote call or virtual-microphone route was tested in this research.

## Recommendation

Treat routing and suppression as separate components. A real outgoing feature requires physical microphone → denoiser → virtual output → meeting application selecting that virtual input. The existing Call Note checkbox only changes its recording/transcription microphone track: `pcm-recorder` outputs silence and does not alter the microphone selected by Zoom/Meet/Teams.

Chromium/WebRTC suppression is an already-shipped baseline worth benchmarking before adding another model. It is not a promise of Krisp-level quality. RNNoise and DeepFilterNet remain comparison candidates; do not claim separate pretrained model redistribution permission from code licenses alone. Both contemporary RNNoise model variants have an explicit unanswered license clarification upstream.

## Engine evidence and exact tested revisions

- Electron 44.7.0 pins Chromium 152.0.7977.130: https://github.com/electron/electron/blob/v44.7.0/DEPS . Chromium maps the microphone noise-suppression setting to WebRTC APM `enabled`, at `kHigh`: https://github.com/chromium/chromium/blob/152.0.7977.130/media/webrtc/helpers.cc#L157 . Browser constraints expose a boolean rather than tuning the full algorithm. Check actual track settings; a true setting is configuration evidence, not quality evidence.
- RNNoise current source: `70f1d256acd4b34a572f999a05c87bf00b67730d`. Official model archive SHA256 `0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37`, downloaded from Xiph and verified. Source built natively with clang -O3, no tuned architecture flags. Source: https://github.com/xiph/rnnoise/tree/70f1d256acd4b34a572f999a05c87bf00b67730d . The model archive contains generated C/H and PTH files, no license file; generated C has no license header.
- Jitsi RNNoise wrapper commit `cb529a59a8478fe604e57986fc96afdaecfa6fb7`, package metadata version0.2.1. Tested exact `dist/rnnoise-sync.js` prebuilt artifact (1,933,102 bytes). Jitsi explicitly states its async build remains RNNoise0.1 for detection, while the sync build uses0.2 for actual Jitsi Meet suppression in an AudioWorklet: https://github.com/jitsi/rnnoise-wasm/tree/cb529a59a8478fe604e57986fc96afdaecfa6fb7 . Do not benchmark/use the default async entry and call it the current suppression model. The wrapper's RNNoise submodule is `372f7b4b76cde4ca1ec4605353dd17898a99de38`, whose model_version is `0b50c45`. Jitsi build uses Emscripten, synchronous WASM and embedded binary; wrapper is Apache2, RNNoise code BSD3.

## Measurements

These are deterministic offline measurements on this Mac, not a real-time AudioWorklet or meeting benchmark. Fixtures are 34 seconds, mono48k PCM16, with 2 seconds noise, 30 seconds synthetic speech resampled from16k, 2 seconds noise. Synthetic fan/hum and impulse keyboard approximations at labels0/5/10dB. Labels reflect active speech RMS and differ from whole scoring-window SI-SDR. No perceptual listening judgement was made by this subagent.

| Engine | 34s processing | Pure inference | Frame p99 | 5dB-label SI-SDR | Clean-input SI-SDR |
|---|---:|---:|---:|---:|---:|
| Native RNNoise current | 2.76–2.78s | 2.13s | .66–.67ms | 8.55dB | 16.39dB |
| Jitsi sync RNNoise0.2 WASM in Node | 1.20–1.21s | included | .38–.40ms | 8.35dB | 16.53dB |
| Bypass | n/a | n/a | n/a | 2.87dB | identical |

Native wall-time includes Python marshaling; models differ, so this does not show WASM faster than equivalent native code. WASM init4–5ms. Pure compute leaves useful headroom, but app load, scheduling, worklet allocation, battery use, streaming buffers and hardware delay remain unmeasured. Parent's separate DeepFilterNet3 result was stronger SI-SDR on this fixture; one narrow synthetic fixture is insufficient to select a winner.

Raw results: `rnnoise-benchmark.json`, `rnnoise-clean-benchmark.json`, `rnnoise-clean-metrics.json`, shared `metrics.json`. WAVs: `fixtures/noisy-{0,5,10}db-rnnoise-{native,wasm}.wav`, `fixtures/clean-rnnoise-{native,wasm}.wav`; convenience copies `rn-out/` and `rn-wasm-out/`. Reproduction: `bench-rnnoise.py`, `bench-rnnoise-clean.py`, `bench-rnnoise-wasm.mjs`.

## Latency and worklet integration

Both tested current/0.2 variants have about20ms algorithmic delay, not the historical paper's10ms. Source analysis uses an overlap window and then synthesizes `delayed_X` before storing the current spectrum: https://github.com/xiph/rnnoise/blob/70f1d256acd4b34a572f999a05c87bf00b67730d/src/denoise.c#L496 . Our first pass copied upstream demo's one-frame compensation and retained479samples correlation lag. Final WAVs omit960samples and flush2frames; residual correlation lag is -1sample. This compensation is only for offline comparison; a live pipeline still pays delay plus buffers/hardware. Upstream issue also discusses the current/previous-frame change: https://github.com/xiph/rnnoise/issues/273 .

Use a dedicated48k AudioContext and mono480sample RNNoise frames. AudioWorklet render quantum is commonly128samples, so bridge it with preallocated FIFO buffers and process enough complete480sample frames. RNNoise expects PCM16 amplitude in floats, so multiply browser floats by32768 and scale outputs back. Avoid allocations, promise work, IPC perframe, and dynamically growing WASM memory in `process()`. Handle `processorerror` and stop routing visibly. Disable browser noiseSuppression when evaluating RNNoise to avoid double suppression. AGC and AEC should be separate controlled variables, with headphone-first tests. The app CSP currently lacks `wasm-unsafe-eval`; a chosen WASM approach needs a narrow explicit CSP change, not broad unsafe-eval.

## License findings — distinguish source from model

RNNoise code's BSD3 terms are explicit: https://github.com/xiph/rnnoise/blob/70f1d256acd4b34a572f999a05c87bf00b67730d/COPYING . Jitsi wrapper Apache2 is explicit: https://github.com/jitsi/rnnoise-wasm/blob/cb529a59a8478fe604e57986fc96afdaecfa6fb7/LICENSE . Those notices must accompany distribution if used.

However https://github.com/xiph/rnnoise/issues/284 explicitly asks for the license of the exact current external model archive we tested. Its first comment asks separately about `0b50c45`, the model in Jitsi's0.2 source pin. Read through GitHub API on2026-10-14: issue open,2comments, all authors non-maintainers, no maintainer answer. This is not evidence of a ban; it is unresolved evidence for the requested explicit pretrained-weights grant. Do not present downstream distro assumptions or publicly available training datasets as an upstream grant. Keep both modern models benchmark-only until clarified for shipping.

Historical v0.1 andv0.1.1 embed `src/rnn_data.c` directly in the BSD repository, but these files also begin only with an autogenerated comment and have no explicit perfile weights license. This is stronger package context than a separately downloaded archive, but does not supply the requested explicit model license statement; do not downgrade purely to evade uncertainty. https://github.com/xiph/rnnoise/blob/v0.1.1/src/rnn_data.c .

## Critical self-capture interaction

Current `getDisplayMedia({audio:true,...})` does not exclude Call Note's own future cleaned microphone output. `restrictOwnAudio` defaultsfalse. Electron44.7.0 rewrites `loopback` to `kLoopbackWithoutChromeId` when the request sets restrict_own_audio: https://github.com/electron/electron/blob/v44.7.0/shell/browser/electron_browser_context.cc#L866 . Chromium152 CoreAudioTap then excludes its audio-service process; ScreenCaptureKit also sets excludesCurrentProcessAudio for that special ID: https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/mac/catap_audio_input_stream.mm#L757 and https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/mac/audio_loopback_input_mac_impl.mm#L343 .

Proposed capture constraint is audio:{restrictOwnAudio:true}, followed by getSettings().restrictOwnAudio===true validation. Chrome141 documents the feature: https://developer.chrome.com/blog/chrome-141-beta#support_restrictownaudio . Test a marked mic signal while the meeting side is silent and ensure the system track contains no duplicate. Device routing is not sufficient evidence of exclusion. If unsupported, disable the combined clean-mic+system-transcription mode with an actionable message until an explicit native exclusion path exists. On macOS14.2+ Electron39+ normally uses CoreAudioTap, not ScreenCaptureKit; do not rely solely on SCStreamConfiguration defaults. https://github.com/electron/electron/blob/main/docs/api/desktop-capturer.md .

## Routing and installation scope

AudioContext.setSinkId has shipped since Chrome110: https://developer.chrome.com/blog/audiocontext-setsinkid . Electron's trusted-local permission handlers need speaker-selection in both request/check handlers: https://www.electronjs.org/docs/latest/api/session . Feature-detect; set/verify exact virtual sink before connecting/resuming audio. Never silently fall back to default speakers.

BlackHole2ch can provide a POC route. It is not installed in /Library/Audio/Plug-Ins/HAL here; existing unrelated drivers were untouched. BlackHole says its integration requires GPL3 or a commercial license: https://github.com/ExistentialAudio/BlackHole . Do not bundle/rebrand it under Call Note's current licensing. An independently installed device can be selected for an external-device POC; vendor clarification is still appropriate before an integrated commercial distribution. Use official signed/notarized installer and normal admin authentication; do not relax macOS security or restart audio services during calls. https://github.com/ExistentialAudio/BlackHole/wiki/Installation .

Select an explicit physical microphone, rejecting default/communications aliases and the destination/known virtual devices. Browser labels cannot prove physical hardware identity for every driver; a native CoreAudio UID/type inventory is stronger. Browser device IDs are origin-bound, and Call Note's randomized localhost port changes origin across launches, so persistence needs re-resolution or nativeUIDs. Keep meeting speakers/headphones on their usual output, never system output into the virtual microphone. Stop safely on device removal, sink change, track end, context suspension and in-flight cancellation. Protect active clean-mic sessions from auto-update/quit interruptions even when no transcript is recording.

## Required validation before calling it outgoing noise cancellation

1. Benchmark the already-shipped WebRTC path on the same exact WAVs with --use-fake-device-for-media-stream and --use-file-for-fake-audio-capture=<path>%noloop. Chromium explicitly feeds the file through microphone processing: https://github.com/chromium/chromium/blob/152.0.7977.130/media/base/media_switches.cc#L212 . Record processed PCM via worklet with NSfalse/true, AGCfalse, AECfalse first. This validates algorithm configuration, not real routing.
2. Add multiple real speakers/microphones, typing, fan, cafe/babble, music, breath, quiet speech and clean-input samples. Listen blind A/B and score intelligibility and speech damage, not just silence suppression. Noise-only attenuation can reward muting the microphone and is not a sufficient metric.
3. With an authorized external virtual driver, capture its INPUT from a separate process/app and compare the incoming waveform with raw/processed reference. Then a real remote meeting participant records what arrives. This is the necessary outgoing evidence.
4. Simultaneously transcribe both call sides: no cleaned mic duplicate on system track, remote audio remains intact, no runaway feedback. Test device unplug, default-output change, source switch, stop during permission/start, screen sleep/wake, app background, recording stop/start and update scheduling.
5. Measure added end-to-end delay, CPU/battery and dropouts on the oldest supported Mac during transcription load. Offline real-time-factor is not proof of glitch-free real-time operation.

## Native benchmark build

In the pinned RNNoise checkout at `.build/noise-research/rnnoise`, download the official archive named by `model_version`, verify its SHA256 against the recorded value, and extract its generated source files. The local test build used:

```sh
clang -O3 -dynamiclib -Iinclude -Isrc -o librnnoise-bench.dylib \
  src/denoise.c src/rnn.c src/pitch.c src/kiss_fft.c src/celt_lpc.c \
  src/nnet.c src/nnet_default.c src/parse_lpcnet_weights.c \
  src/rnnoise_data.c src/rnnoise_tables.c -lm
```

For WASM, obtain the exact Jitsi commit's `dist/rnnoise-sync.js`, store it as `.build/noise-research/rnnoise-sync.mjs`, and retain the upstream notice with the local research copy. From the Call Note repository root, run:

```sh
.venv/bin/python scripts/research/noise/bench-rnnoise.py
.venv/bin/python scripts/research/noise/bench-rnnoise-clean.py
.venv/bin/python scripts/research/noise/measure.py
```

These scripts do not download dependencies or install drivers. They require the separately prepared pinned research artifacts. Generated WAVs, models and binaries stay in the ignored build directory.
