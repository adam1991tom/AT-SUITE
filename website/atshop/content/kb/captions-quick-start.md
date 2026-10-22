---
summary: Caption a room in five minutes: plug in a mic, press Send my mic, check the audience screen and send a test line.
audience: techs
keywords: captions, live captions, subtitles, speech to text, transcribe, mic, microphone, send my mic, start captions, caption engine, accessibility, deaf, hard of hearing
---
# Live captions: quick start

AT SUITE turns what the speaker says into captions as they speak, and shows them on the room's caption screens, on the video stream and in the tech workspace. Everything happens on your own laptop and server: no audio or text goes to the internet.

![The Captions controls window: two caption lines at the top, a microphone list, the Send my mic button, Send a test line, Clear the screens, and links to the caption screen and overlay](/static/kb/workspace-captions.jpg "The Captions controls window, with the small Captions card bottom right.")

## Before you start

- An admin has turned captions on for the room (**Console → Captions**, **Captions on for this room**). If the Captions window says **Caption engine is off**, ask them.
- You need a clean audio feed: a spare output from the sound desk into the laptop (a USB audio interface is best), or a mic near the PA. Turn off any "enhancements" on the laptop's sound card.
- Use the **AT SUITE app** on the laptop. It makes the captions on the laptop itself, keeps going if the network drops, and is the only way the mic works on a plain `http://` address. A browser can send the mic only over `https://`.

> **Tip:** The first time a laptop captions, the app fetches the speech model from your server (a big download, once). Until it has it, the server does the listening, so you can start straight away.

## Five steps

1. In the workspace, open **Captions** (the small Captions card, then **Open captions**, or **Layout → Captions**).
2. Pick the input from the list. It's the one the desk feed is plugged into, not the laptop's built-in mic.
3. Press **Send my mic**. The button turns red (**Stop my mic**), the meter moves when someone talks, and the Captions card shows **live**.
4. Open **Caption screen** to see what the audience sees. Put that on the caption screen in the room (see [Caption screens and the overlay](/docs/caption-screens)).
5. Type nothing and press **Send a test line**. "Test caption: can everyone read this?" shows on every caption screen in the room. Ask someone at the back of the room if they can read it.

When the session ends, press **Stop my mic**, then **Clear the screens** so the last line doesn't sit on screen during the break.

## What you see while it runs

- The grey line at the bottom is what the speaker is saying now. It firms up into a finished line when they pause.
- The top bar's live strip shows a captions dot for the room, so you can see at a glance it's still live.
- If the mic stops (unplugged, the laptop slept, the app closed), you get a **Captions stopped in Main Hall** alert.
- Only one laptop can send the mic for a room. If someone else presses **Send my mic** in the same room, yours stops and you're told who took over.

## Make it more accurate

Names, brands and jargon are where captions go wrong. Before the session, put them in the room's **Vocabulary** (Caption settings → Vocabulary): one per line, spelled the way they're written. Then fix anything it still gets wrong by clicking the word. See [Caption settings](/docs/caption-settings).

## Caption source only laptops

A laptop that only sends a mic, with nobody working on it (in a booth, say), can be marked **Caption source only** the first time it's started, or by an admin on the **Laptops** page, so everyone can see what it's for. Start its mic the same way: **Captions**, pick the input, **Send my mic**.

## Next

- [Caption settings: audio, vocabulary, look, corrections](/docs/caption-settings)
- [Caption screens and the overlay](/docs/caption-screens)
- [Transcripts and caption privacy](/docs/transcripts)
- Step by step for a big session: [Caption a keynote](/docs/scenario-caption-keynote)
