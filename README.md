<img src="desktop/ui/icon.png" width="64" alt="Call Note icon">

# Call Note

**Stay in the conversation. Keep the transcript.**

Call Note transcribes both sides of your calls on your Mac. Find past conversations, add notes, and ask Codex or Claude to pull out decisions and next steps.

![Call Note showing a sample transcript, searchable call library, and notes](docs/screenshots/sample-transcript.png)

*A saved sample conversation. Transcription and your call library stay on your Mac.*

### [Download v0.2.4 for Mac →](https://github.com/slyapustin/call-note/releases/download/v0.2.4/Call-Note-0.2.4-macOS-arm64.dmg)

Newest downloadable build · [Release notes](https://github.com/slyapustin/call-note/releases/tag/v0.2.4)

**Apple Silicon (M1 or newer) · macOS 14.2+ · English speech**

> [!NOTE]
> **Signed and notarized.** Call Note v0.2.4 and its Mac installer are signed with Apple Developer ID, notarized by Apple, and verified with macOS Gatekeeper.

## Get started

1. Download Call Note using the link above.
2. Open the DMG, then drag **Call Note** into **Applications**. Quit any older copy before replacing it.
3. Open the app and allow microphone and screen/system-audio recording when asked.
4. Choose **New call → Start call**. When finished, choose **Stop & save**.

## What you can do

![Call Note setup with Calendar linking, microphone and system audio, and playable samples](docs/screenshots/call-setup.png)

- **Read as you talk.** Live transcription of your microphone and the other side of a call.
- **Follow each speaker.** Automatic Speaker 1, Speaker 2, and Speaker 3 labels for voices in system audio. Your microphone stays labeled You.
- **Find what mattered.** Search saved calls, add notes, or export the transcript.
- **Ask your assistant.** Choose **Connect your assistant** to connect Codex or Claude.
- **Try it first.** Choose **New call → Team discussion · 3 voices → Try sample**, then play the audio above the labeled transcript.
- **Join on time.** See upcoming Calendar meetings in the menu bar, with a reminder one minute or 30 seconds before the call and a Join action.
- **Stay out of the way.** Start and stop calls from the menu bar. Closing the window keeps the app running.

## Before you try it

Transcription runs locally. Call Note saves text, not call recordings. Connecting an assistant lets it access your call library; transcript text it reads is subject to that assistant’s data policies.

Recording starts manually. Speaker labels are estimates, especially with short replies, similar voices, or overlapping speech. Earlier saved calls cannot be relabeled because their audio was not retained; run the sample again to try speaker detection. Use headphones to reduce duplicate audio. Google Calendar sign-in is available to approved test accounts. Windows is not available yet.

Install v0.2.4 manually if your older version cannot update. Call Note checks for updates automatically and installs downloaded updates when you quit.

[Changelog](CHANGELOG.md) · [Report a problem](https://github.com/slyapustin/call-note/issues) · [Developer setup](docs/development.md) · [Release instructions](docs/releases.md)
