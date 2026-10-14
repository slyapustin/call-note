# Call Note benchmarks

Measured on 14 October 2026 using Call Note, Phonon-2, Fermion 0.2.11, and Python 3.13.16. These are individual smoke-test measurements, not averages or promises for every device.

## Batch transcription

Both systems decoded the same 107.9-second clean synthetic English briefing bundled with the app. The model was already loaded. Timing covers transcription, not model startup, audio capture, rendering, or speaker detection.

| System | Build | Audio duration | Decode time | Faster than playback |
| --- | --- | ---: | ---: | ---: |
| Apple M1 Pro, 16 GB RAM, MLX | Packaged Mac 0.2.8, two checks | 107.9 s | 1.05–1.09 s | 99–103× |
| GitHub Windows x64 runners, CPU backend | Windows 0.2.8 preview, two builds | 107.9 s | 3.43–8.20 s | 13–31× |

The Windows runners use Windows Server 2022. Their exact CPU models were not recorded, and hosted-runner performance varied; these results do not establish Windows 11 laptop performance. [First Windows run](https://github.com/slyapustin/call-note/actions/runs/38589462145), [published preview run](https://github.com/slyapustin/call-note/actions/runs/38591115963). The Mac checks were before and after code signing. The reproducible offline check is `scripts/bundle_smoke.py`, run using the bundled Python and service directory.

## Live drafts on the M1 Pro

An isolated `/api/record` test sent a 10.42-second synthetic clip followed by one second of silence, in 50 ms packets paced at real time. Microphone and system streams were tested separately, with a warm model, using the 0.2.6 service. Browser/OS capture and UI rendering were not measured. These are first-draft timings relative to the first audio packet, not per-word latency or final transcript latency.

| Stream | First nonempty draft | Median draft interval | Stop to completion |
| --- | ---: | ---: | ---: |
| Microphone | 356 ms | 503 ms | 6 ms |
| System audio with speaker detection | 365 ms | 1,001 ms | 332 ms |

The first finalized segments arrived at 10.80 s and 11.76 s respectively. Partial text is provisional; finalization waits for a phrase boundary and speaker analysis. Simultaneous two-stream latency still needs measurement.

## Idle memory in 0.2.8

Measured the isolated Mac speech-service process with `ps` RSS, excluding Electron, renderer processes, and shared GPU accounting. macOS compression and native allocators make active RSS fluctuate, so these are snapshots rather than peak-memory requirements.

| Stage | Speech-service RSS |
| --- | ---: |
| Initial idle | 54.03 MiB |
| After model load | 2,103.95 MiB |
| After the three-person sample | 527.72 MiB |
| After graceful idle recycling | 54.20 MiB |

Simply unloading the model left hundreds of MiB in imported libraries and native allocator arenas. Version 0.2.8 instead loads on demand and gracefully recycles the idle service after two minutes. This test shortened that timeout to five seconds. All ten saved sample segments remained available after restart. Initial load took 9.96 s; reloading took 9.50 s. The app window and Calendar remain running, so whole-app idle memory is higher than 54 MiB.

Real calls, overlapping speakers, noisy microphones, Bluetooth devices, slower CPUs, and other apps competing for memory can change these results. These tests do not measure transcription accuracy or noise-cancellation quality.
