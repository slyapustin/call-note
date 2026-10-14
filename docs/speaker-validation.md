# Speaker matching validation (0.2.12)

The previous live matcher could create a new persistent identity from only one second of speech. Every unmatched embedding became a new speaker, and references never adapted. The new matcher requires at least 2.5 seconds of speech to create an identity, leaves ambiguous or close competing matches uncertain, and gradually updates references only from strong matches. These thresholds are conservative application policy, not a measured error-rate guarantee.

The bundled recordings were checked with the real ONNX models on 2026-10-14:

| Check | Before | Revised matcher |
| --- | --- | --- |
| Solo recording in independent 3-second chunks | 1 identity | 1 identity, 36 labeled turns |
| Three-person recording in independent 3-second chunks | 4 identities, 1 uncertain turn | 3 identities, 2 uncertain turns |
| Whole three-person recording | Expected sequence | All 10 speaker turns retained |
| Full rolling streaming decode | — | Expected 10-turn speaker sequence; 11 finalized text segments; no warnings |

These are bundled sample checks, not accuracy measurements on real meetings. The reported one-person call was not available as audio and has not been reproduced. Live meeting devices, compression, noise, similar voices, and overlapping speech remain unverified.

Overlapping diarization intervals are partitioned so each audio interval is transcribed once. Conflicting labels become uncertain only within the overlap. Strong labels outside it are preserved. Speaker events are published atomically: a later turn failure cannot leave an earlier speaker row next to a duplicate whole-phrase fallback. Tests preserve legitimate repeated phrases at different times.

Run `python scripts/verify_speakers.py --chunks --stream` in the configured environment. Unit tests cover short-phrase identity creation, adaptive references, competing matches, overlap boundaries, and atomic fallback. No original call audio or voiceprints are stored; existing saved labels cannot be automatically corrected from their text alone.
