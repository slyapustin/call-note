# Outgoing noise cancellation research

Research date: **2026-10-14**. This is a design and benchmark record, not a shipped Call Note feature. Call Note 0.2.5's microphone suppression only affects its transcription input.

## Decision

Build the next prototype around a **native microphone helper and a dedicated Call Note Microphone virtual input**. Use Apple's voice-processing API as the first macOS baseline, with WebRTC APM as the alternative if Apple's routing, ducking or accessory behavior is unsuitable. Keep the processing interface replaceable. Compare RNNoise and DeepFilterNet against this baseline, but resolve their exact pretrained-model redistribution terms before bundling them.

This decision is based on integration and distribution evidence, not proof that Apple's denoiser sounds best. Apple/WebRTC have not yet been measured in this experiment. DeepFilterNet3 produced the best aligned signal scores among the engines measured here; one synthetic fixture is not a general quality ranking.

```text
Physical microphone → native processing helper → Call Note Microphone → Zoom / Meet / Teams
                                └──────────────→ Call Note transcription
```

Electron remains the UI. Python 3.13 remains responsible for transcription and speaker analysis. Outgoing speech should continue independently of Python model loading, inference and diarization. The native helper must avoid a UI-thread or Python dependency in its audio callback.

The user selects Call Note Microphone in the meeting app. A suppression checkbox inside Call Note cannot change a stream that another application captures directly from the physical microphone.

## Options compared

| Tool | Evidence and tradeoff | Decision |
|---|---|---|
| [Apple voice processing](https://developer.apple.com/videos/play/wwdc2023/10235/) | Native NS/AEC/AGC through AVAudioEngine or AUVoiceProcessingIO; no third-party model to distribute. Voice Isolation is a user mic mode, not an app-controlled promise. Other-app playback ducking and echo-reference routing need tests. | First macOS prototype baseline; quality unmeasured here. |
| [WebRTC APM](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/g3doc/audio_processing_module.md) | Standalone processing with BSD-style code license; broader native integration than RNNoise. Chromium already supplies capture suppression in the app, but it currently sends no audio to a virtual microphone. | Alternative baseline and future cross-platform abstraction; no Windows work now. |
| [RNNoise](https://github.com/xiph/rnnoise) | C, 48 kHz mono, BSD-3-Clause code. Native current model and Jitsi's sync WASM both run well below the 10 ms frame budget in this test. Exact modern model redistribution terms have an [unanswered upstream question](https://github.com/xiph/rnnoise/issues/284). | Benchmark candidate; model provenance needs clarification before bundling. |
| [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) | Native Rust/C API, no Python/Torch needed for inference; best measured scores here. MIT/Apache code, but exact pretrained weights have [unanswered redistribution questions](https://github.com/Rikorose/DeepFilterNet/issues/712). | Quality comparison; benchmark-only until terms are clarified. |
| [Krisp SDK](https://sdk-docs.krisp.ai/docs/licensing-information) | Commercial integration agreement required. | Later commercial comparison; no license purchased or vendor contacted. |
| [Picovoice Koala](https://github.com/Picovoice/koala/blob/main/README.md) | Local audio processing, but AccessKey, network license validation and account usage limits. | Not the default for an independently usable offline feature. |

Unanswered licensing questions do **not** establish that redistribution is prohibited. They mean this audit cannot confidently label the exact model artifacts as cleared for commercial bundling. The code license and model provenance must be recorded separately.

## Virtual microphone

Investigate a pinned [libASPL](https://github.com/gavv/libASPL) AudioServerPlugIn for a branded, fixed-48-kHz input. MIT and Apple sample notices must be retained. Real published projects use it, but maintenance is concentrated and an outstanding sample-rate timestamp issue needs review. The pinned v3.1.2 library and both official driver examples compiled locally in Release and Debug; all 47 official tests passed with AddressSanitizer. No driver was installed or loaded. The timestamp observation alone did not establish audible drift or broken audio. See [native audit](native-audit.md) for exact commits, releases, build commands and evidence.

Keep DSP outside HAL callbacks, with bounded buffering, observable underruns and a clear stopped/error state. Never silently route processed microphone audio to speakers or reopen the virtual input as its own physical source. A helper failure should produce silence plus an error, not silently switch to an unprocessed physical microphone.

[BlackHole](https://github.com/ExistentialAudio/BlackHole#developer-guides) is useful for a separately installed experiment. Its integration terms require GPLv3 compatibility or a commercial license; silently bundling/rebranding it is not the default choice.

The virtual device requires a one-time audio-plugin installation. A signed/notarized package uses **Developer ID Installer**, separate from the existing Developer ID Application identity. Plan administrator authentication, possible reboot, clean uninstall and driver-version updates. Electron's app updater does not replace files in `/Library/Audio/Plug-Ins/HAL`. No driver was installed during this research.

## Measured on this Mac

Host: Apple M1 Pro, arm64. Each fixture is 34 seconds at 48 kHz mono: 30 seconds of the project's synthetic solo speech plus two seconds of noise-only audio at each end. The source speech was 16 kHz and resampled; this is **not** a full-band speech-quality test. Deterministic low-pass noise, 120 Hz hum and impulse bursts approximate fan/keyboard noise. They are not real recordings of those environments.

The SNR labels 0/5/10 dB use active-speech RMS, so they differ from whole-window signal-to-noise scores. SI-SDR is measured after bounded delay alignment on the speech region; larger is better. It does not replace listening or intelligibility evaluation.

| Engine | SI-SDR, 0 dB fixture | 5 dB fixture | 10 dB fixture |
|---|---:|---:|---:|
| Unprocessed | -2.12 dB | 2.87 dB | 7.87 dB |
| Current native RNNoise | 4.35 dB | 8.55 dB | 11.63 dB |
| Jitsi RNNoise sync WASM | 4.01 dB | 8.35 dB | 11.56 dB |
| DeepFilterNet3 v0.5.6 native | **8.43 dB** | **12.53 dB** | **15.93 dB** |

On clean input, aligned SI-SDR was 30.38 dB for DFN3, 16.39 dB for current RNNoise and 16.53 dB for Jitsi WASM. These capture waveform changes, not a human listening rating.

At the middle noise level, projected speech gain was -1.22 dB for current RNNoise, -1.04 dB for Jitsi WASM and -1.00 dB for DFN3. Noise-only attenuation is also saved in [metrics.json](metrics.json), but it must not be used alone to rank quality: muting everything would score well on that measure.

Timing observations from the exploratory runs:

- DFN3: 34 seconds processed in **1.48–1.51 seconds**, real-time factor approximately **0.044**.
- Current native RNNoise: approximately **2.8 seconds including Python test-harness marshalling**; pure frame inference approximately 2.2 seconds. These harness costs are not a proposed product architecture.
- Jitsi sync WASM: approximately **1.2 seconds**, with sub-millisecond p99 processing of 10 ms frames in Node. This is not an Electron AudioWorklet scheduling test.

These are individual offline runs, not a controlled CPU or battery comparison. Native and WASM RNNoise use different model revisions. Background packaging/upload work was active. Processing faster than real time does not measure live microphone delay or guarantee no glitches while transcription runs.

RNNoise's current delayed-spectrum path adds delay beyond its 10 ms frame size. The listening outputs compensate 960 samples, about 20 ms, offline; a live pipeline cannot remove that delay. DFN3's CLI compensates 30 ms for its exact model configuration; the paper's 40 ms includes frame acquisition. Neither is total device-to-call latency.

## Recording integration risk

If a future browser-based output path is used, system recording can capture the app's own cleaned microphone output and label the speaker twice. Electron 44.7.0 maps `restrictOwnAudio: true` to Chromium's own-process-excluding capture mode; the present `audio: true` request does not request it. See the [Electron mapping](https://github.com/electron/electron/blob/v44.7.0/shell/browser/electron_browser_context.cc#L866) and [Chromium CoreAudio implementation](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/mac/catap_audio_input_stream.mm#L757).

A separate native helper has different process ownership: do not assume excluding Electron also excludes the helper. Verify routing with an independent capture client and avoid feeding the microphone into system output at all in the native design. These source findings have not been validated in a simultaneous live-call test.

An isolated Electron 44.7.0 fake-audio harness was also attempted. The root process launched, but Chromium could not read the synthetic WAV under its audio sandbox. The run is not a valid WebRTC quality measurement; no sandbox-disabling flag or real microphone fallback was used.

## Before release

1. Compare Apple/WebRTC, bypass and neural candidates on real fan, keyboard, street and transient noises, multiple voices and quiet syllables. Listen and measure intelligibility; test clean speech too.
2. Verify another application actually receives the cleaned virtual microphone. Test Zoom, Meet and Teams with their own suppression enabled and disabled.
3. Measure end-to-end delay, p95/p99 frame times, CPU, underruns and a long session while Phonon and speaker analysis run.
4. Test built-in, USB and Bluetooth microphones; device changes, sleep/wake, helper crashes and quit/update while the virtual microphone is in use.
5. Verify permission flows and driver installation, reboot discovery, notarization, update, rollback and uninstall on a second Mac.

No live-call audio, microphone recording or system driver installation was performed in this research. Outgoing cancellation is not complete yet.

## Reproduction artifacts

Run from the repository root with its Python 3.13 environment:

```sh
.venv/bin/python scripts/research/noise/make_fixtures.py
.venv/bin/python scripts/research/noise/measure.py
```

Fixtures and generated audio live under ignored `.build/noise-research/`. The measurement script reads any available candidate output and writes `metrics.json` there; generating fixtures alone does not run a denoiser. [Native audit](native-audit.md) records the DFN3 binary/model hashes. [RNNoise audit](rnnoise-audit.md) records exact revisions, build commands, model hashes, timing and the remaining license question. Third-party models and binaries are not committed or included in Call Note 0.2.5. A local `listen.html` in the ignored research folder provides five audio players for the clean reference, noisy input and three denoised outputs.
