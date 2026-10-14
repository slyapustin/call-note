# Windows preview development

The Windows port targets **Windows 11 x64 with an AVX2-capable CPU**. The preview also requires the [Microsoft Visual C++ x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) for the native CPU libraries; it is not installed automatically yet. It uses the same Phonon-2 model through Fermion's CPU runtime; an NVIDIA GPU is not required. Windows ARM64 and outgoing noise cancellation through a virtual microphone are outside this first preview.

This is an **unsigned development preview**, not a production release. The Apple Developer certificate cannot sign Windows apps. Windows code signing, actual microphone/system-audio capture in meeting apps, and a complete update cycle still need validation before a public Windows release. Automatic updates are disabled for this unsigned preview. No Windows release is published by this workflow.

## Build on Windows

Install Node.js 24, Python 3.13.16, and Git. In PowerShell from the repository root:

```powershell
python -m pip install uv==0.13.0
npm ci --prefix desktop
npm run package:windows --prefix desktop
```

The build downloads a portable Python 3.13.16 runtime and installs the pinned Windows CPU dependencies. It obtains only the speech model, speaker models, and sample recordings from the SHA256-verified 0.2.7 release archive; no macOS binary is reused. The first build needs internet access and several GB of free space. Subsequent builds reuse the downloaded asset archive in `.build/downloads`.

Before packaging, the bundled Python runs an offline transcription, speaker-detection, and MCP smoke test. Failure prevents packaging. The resulting NSIS installer is:

```
.build/windows-dist/Call-Note-0.2.7-Windows-x64.exe
```

The installer supports a per-user installation and installation-directory selection. Uninstalling preserves the call library. Python and the models are bundled, so end users do not need Python, `uv`, or model downloads. The resource layout is `.build/bundle/python/python.exe` plus `.build/bundle/service`, copied into the installed application's `resources` directory.

Google OAuth credentials are deliberately excluded from the Windows build. Calendar testing currently requires importing a Desktop OAuth client JSON through the app. No local Google credentials, tokens, or transcripts are uploaded to Actions artifacts.

## CI evidence

[Windows preview workflow](../.github/workflows/windows-preview.yml) runs on the Windows port branch, relevant pull requests, or manual dispatch after the workflow is available on the default branch. It:

1. Runs the desktop unit tests on a native x64 Windows runner.
2. Prepares the portable CPU runtime and runs real-model offline smoke checks.
3. Creates the NSIS installer without publishing a release.
4. Installs it silently, checks the actual installed service over authenticated loopback HTTP, and runs the uninstaller.
5. Uploads the installer, update metadata, runtime manifest, and SHA256 checksums as a 14-day Actions artifact.

The hosted runner uses Windows Server 2022 and already has the Microsoft Visual C++ runtime. A passing run does not prove installation on a clean machine without that prerequisite. These checks do not prove Windows 11 microphone permissions, system audio with Zoom/Meet/Teams, device switching, tray notifications, Google sign-in, or real-world transcription latency. Those require a Windows 11 computer and real audio devices.

## Before stable distribution

Obtain a Windows Authenticode signing identity and configure certificate-backed signing securely in CI. Keep Electron's update-signature verification enabled and configure the expected publisher consistently with the updater policy. Sign and verify both app and installer, test an installed upgrade with a signed predecessor, and then publish the installer, blockmap, and `latest.yml` together. The preview's generated metadata is not a claim that its update path is production-ready.

The macOS packaging and notarization pipeline remains separate. Windows builds use [`electron-builder.windows.cjs`](../desktop/electron-builder.windows.cjs); the existing Mac packager is unchanged.

References: [Fermion CPU support](https://www.fermionresearch.com/docs/speech/), [Electron Windows loopback audio](https://www.electronjs.org/docs/latest/api/session), [NSIS installer options](https://www.electron.build/nsis/), [Electron updater](https://www.electron.build/docs/features/auto-update/).
