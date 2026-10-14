Windows x64 preview with local Phonon-2 transcription and Python 3.13 included. Download the `.exe` installer below.

Requires Windows 11 x64 with AVX2 support. If the speech runtime reports missing Microsoft runtime DLLs, install the [Microsoft Visual C++ x64 Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe).

This preview is **unsigned** and may show an unknown-publisher/SmartScreen warning. Automatic updates are disabled; install a newer preview manually. Google Calendar requires a Desktop OAuth client JSON in this preview. The existing macOS release remains unchanged.

Includes on-demand speech model loading, memory release after two idle minutes, and Delete call with confirmation for saved transcripts, notes, and analyses. Deletion does not remove existing exports or backups.

Native Windows CI passed desktop tests, offline speech/speaker/MCP checks, NSIS installation, installed-service transcription, graceful idle recycling, library persistence, reload, and uninstallation. Real Windows 11 microphone/loopback capture in Zoom, Meet, or Teams and the interactive UI have not yet been verified. Outgoing noise cancellation through a virtual microphone is not included.

[Source and remaining validation](https://github.com/slyapustin/call-note/pull/2)
