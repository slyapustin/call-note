# Mac bundle size audit

Measured on 2026-10-14 against the published 0.2.8 Mac app. These changes are in source for the next release; the existing 0.2.8 downloads are unchanged.

| Artifact | Released 0.2.8 | Cleaned candidate | Reduction |
| --- | ---: | ---: | ---: |
| App file contents | 1,699,665,247 bytes | 1,091,833,900 bytes | 36% |
| Bundled Python file contents | 1,152,312,793 bytes | 550,350,522 bytes | 52% |
| Update ZIP | 676,395,376 bytes | 518,744,149 bytes | 23% |
| DMG | 897,247,218 bytes | 583,870,116 bytes | 35% |

App totals count file contents once per regular file and exclude symlinks; filesystem allocation reported by Finder or `du` can differ. The candidate app is Developer ID signed and passed strict/deep signature verification, but it has not been notarized or published. Its comparison DMG contains the signed app and an Applications shortcut; it is not a notarized release installer. Final release sizes can differ slightly.

On the same pre-signing candidate, LZFSE produced a 574,112,721-byte image versus 644,518,802 bytes with zlib (`UDZO`). Both used the same source folder. This isolates the compression improvement from dependency pruning.

## What changed

The Apple Silicon build uses MLX for Phonon-2 and ONNX for speaker detection. It does not need PyTorch for these paths. Fermion's package also supports CPU and language-model workloads, so its broad installation dependencies brought PyTorch into the development environment. Copying that whole environment into the app shipped unused libraries.

Mac packaging now removes torch, torchgen, functorch, sympy, networkx, mpmath, pip, pytest, pluggy, and iniconfig from the copied runtime. The original development environment is unchanged. Windows CPU inference still requires PyTorch, so shared requirements and Windows packaging retain it.

Python's `python` and `python3` commands are relative aliases to `python3.13`, instead of two extra executable copies. Electron's resource-copy step rewrites these aliases, so packaging restores their relative destinations before testing the finished bundle. Signing rejects links that point outside the app.

The installer uses LZFSE (`ULFO`) compression. The update ZIP remains a normal ZIP supported by the existing updater. No model weights, quantization, license notices for retained components, or user data are changed.

## Why some large libraries remain

- **MLX:** the inference engine used on Apple Silicon.
- **Transformers/tokenizers:** MLX-audio imports other speech-model modules eagerly, including one that imports Transformers. Removing this dependency safely requires an upstream change or maintaining a patch. It is retained for now.
- **SciPy:** used for audio processing and resampling.
- **ONNX runtime and speaker models:** needed for speaker detection.
- **Electron:** supplies the current desktop UI, capture integration, tray, permissions, and update integration.

This is a deliberately scoped Mac speech runtime, not a general-purpose Fermion installation. Do not use it for Fermion's CPU or language-model commands. Re-run the real-model checks when upgrading dependencies rather than assuming this exclusion list remains valid.

## Verification

Mac packaging runs offline sample transcription, streaming with hotwords, speaker detection, and MCP checks with the copied Python in isolated mode, then repeats them against the packaged runtime. The `macos-mlx` manifest profile also checks that excluded inference libraries are absent and that MLX was selected.

An isolated HTTP-service test exercises authentication, lazy loading, sample transcription, idle shutdown, reload, and saved-library persistence. It uses temporary call data. This does not validate live microphone capture or the full interactive app.

All 65 Python tests passed. The signed candidate repeated the speech, streaming/hotword, speaker, and MCP checks successfully. Packaging retains the original model files and Windows requirements.

## Other architectures

[Next.js](https://nextjs.org/docs/app/guides/static-exports) can generate a static web UI, but replacing this app's small HTML/JS UI with it would not remove Electron or the inference libraries.

[Tauri](https://tauri.app/concept/process-model/) uses the operating system's webview rather than bundling Chromium. It could reduce the desktop shell's size, but Call Note would need replacements for its Electron audio capture, IPC, permissions, tray, notifications, and update integration. It would still need the speech runtime and models. Dependency cleanup is independent of that larger migration.

Downloading a separately versioned speech runtime/model on first use could reduce future installer and update downloads, but shifts the download to setup and requires integrity checks, compatibility management, rollback, and offline-install handling. It does not remove the model's installed size.
