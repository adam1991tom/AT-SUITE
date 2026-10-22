---
summary: Record a transcript of a session's captions, export it as text, SRT or VTT for the client, and how long it's kept. Plus the privacy switches for captions.
audience: techs and admins
keywords: transcript, record, recording, export, download, srt, vtt, subtitles file, text file, deleted, 12 hours, keep, retention, privacy, gdpr, nda, private captions, captions stay on laptop, encrypted
---
# Transcripts and caption privacy

A transcript is the finished caption lines of a session, with the time each was said. Audio is never recorded.

![Caption settings on the Transcripts tab: a red dot saying Recording, a Stop recording button, the privacy note and a table of transcripts with Text, SRT, VTT and Delete links](/static/kb/workspace-caption-transcripts.jpg "Caption settings, Transcripts tab.")

## Record a transcript

1. In the workspace, open **Captions → Caption settings ▾ → Transcripts**.
2. Press **Start recording**. The dot turns red and says **Recording**. Each start begins a new transcript.
3. Press **Stop recording** at the end of the session.

Or tick **Record automatically whenever the mic starts**: every time someone presses **Send my mic** in the room, a new transcript starts, and it stops with the mic. Admins can turn the same thing on per room with **Save transcripts** on **Console → Captions**.

## Export it

Each transcript in the table has:

- **Text**: plain text with times, to read or paste into a report.
- **SRT** and **VTT**: subtitle files for the session's video, with each line timed. Most editors and video players take either. VTT is the one for web players.
- **Delete**: removes it now (only once it has ended).

The **Deleted** column shows when it will be deleted by itself. The **Transcripts** list on **Console → Captions** shows every room's.

> **Important:** Transcripts are deleted automatically, **12 hours after they end** unless your admin changed it. Export what the client needs before then.

## How long they're kept

An admin sets it in **Settings → General → Privacy**: **Delete caption transcripts this many hours after they end**, from 1 to 168 hours (a week). A transcript left open by a crash counts from when it started. The audit log records each clear-out.

## Where the captions are made

Also in **Settings → General → Privacy**:

- **Laptops make captions themselves** (on by default). The AT SUITE app turns speech into text on the tech's laptop and only sends the text to the server. Browsers and older apps send the audio to the server, which does the same work there. The audio never leaves your network either way.
- **Caption text stays on the laptops** (off by default). For NDA and sensitive sessions: the server never hears the audio or sees the captions. The app makes them on the laptop, the room's caption screens are fed from that laptop (see [Caption screens](/docs/caption-screens)), and the transcript is kept on the laptop. Press **Save the transcript** in the Captions window to save it as a file. Browsers can't send a mic in this mode, and nothing falls back to the server.

> **Note:** Transcripts on the server are stored encrypted. Nothing about captions goes to the internet: the speech engine runs on your own machines. See [Privacy and data](/docs/privacy).

## For the client

A simple line for a client's privacy team: "Captions are made on the venue's own equipment. No audio is recorded or sent anywhere. Text transcripts are encrypted and deleted after 12 hours unless you ask for a copy."
