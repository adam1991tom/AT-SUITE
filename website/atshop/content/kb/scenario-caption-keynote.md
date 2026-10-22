---
summary: Caption a keynote properly: the sound check, vocabulary, the screens and the stream, running it live, and the transcript for the client.
audience: techs
keywords: caption keynote, live captions, accessibility, deaf, hard of hearing, sound check, vocabulary, transcript, stream captions, obs, subtitle, captioning a session
---
# Scenario: caption a keynote

**The job:** captions on the side screens and the live stream for a 30-minute keynote, and a transcript for the client afterwards.

## The day before

1. Ask the client for the speakers' names, the company and product names, and any jargon or acronyms.
2. In Main Hall's **Caption settings → Vocabulary**, add them one per line, spelled as written. **Save & apply**. See [Caption settings](/docs/caption-settings).
3. Check the caption screens' look in **Appearance**: big enough for the back row (64 px or more on a big screen), light text on a dark band.

## The sound check

1. Get a clean feed from the desk: a post-fader aux or a matrix send of the speech mics only, no music or playback, into the laptop's USB interface.
2. **Captions** window: pick that input and press **Send my mic**.
3. Have someone talk on the actual lectern mic. In **Audio & EQ**, set the gain so the meter sits in the middle. Pull out the low rumble under 100 Hz.
4. Read the live preview. Click any misheard names and type them correctly: they go into the vocabulary.
5. Tick **Show music and filler noises as [MUSIC]** if walk-in music will go through the same feed.

## The screens and the stream

- **Side screens**: paired screens set to **Captions** (see [Caption screens](/docs/caption-screens)).
- **Stream**: the **Overlay** link as a browser source in OBS or vMix, above the camera.
- **Send a test line**, check both, then **Clear the screens**.

## Showtime

1. Two minutes before: **Send my mic**, check the meter moves, and in **Transcripts** press **Start recording** (or tick **Record automatically whenever the mic starts**).
2. Keep the Captions window where you can see it. Fix misheard names as they come by clicking them.
3. If the mic drops, the workspace tells you (**Captions stopped in Main Hall**) and so does the pre-show check. Press **Send my mic** again.
4. At the end: **Stop recording**, **Stop my mic**, **Clear the screens**.

## The transcript for the client

**Transcripts** tab: download **Text** for the client to read, or **SRT**/**VTT** to put on the session's video. Do it straight away: transcripts are deleted after 12 hours. See [Transcripts and caption privacy](/docs/transcripts).

> **Note:** For an NDA session, ask your admin about **Caption text stays on the laptops**: the server never hears the audio or sees the captions, and you save the transcript on the laptop.
