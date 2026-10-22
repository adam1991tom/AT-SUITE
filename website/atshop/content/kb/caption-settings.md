---
summary: Every caption setting for a room, tab by tab: the live preview, mic gain and EQ, vocabulary, how the screens look, corrections and transcripts.
audience: techs and admins
keywords: caption settings, vocabulary, hotwords, boost, names, jargon, gain, eq, equaliser, rta, spectrum, font, size, colour, lines, position, hold, fade, disclaimer, corrections, misheard, wrong word, acronyms, sentence case, music
---
# Caption settings

Each room has its own caption settings. Any tech in the room can change them, from **Captions → Caption settings ▾** in the workspace. Admins also have the room cards on **Console → Captions**. Changes reach the caption screens straight away.

![Caption settings open on the Audio & EQ tab: a gain slider, an EQ curve with orange dots over the live spectrum, a level meter and three tick boxes](/static/kb/workspace-caption-settings.jpg "Caption settings, Audio & EQ tab.")

## Live

- The preview shows the last lines. Words the engine wasn't sure of are shaded **amber** (not sure) or **red** (a guess). Only you see the shading: the caption screens always show plain text.
- Click any word to correct it (see Corrections below).
- **Send test line** puts a finished line on the screens. **Send as live line** sends it as the grey "still speaking" line, to check how that looks.
- **Clear the screens** empties every caption screen in the room.
- The links open the room's **audience** screen, **overlay** and **subtitle bar**.

## Audio & EQ

What the speech engine hears matters more than anything else.

- **Gain**: −20 to +20 dB. Aim for the meter in the middle when the speaker talks normally. Too quiet loses words; too loud distorts them.
- **EQ**: drag the dots up or down to shape the sound. Behind them is the live spectrum of the input. Typical fixes: pull down the low end (under 100 Hz) for rumble and handling noise, and lift 2 to 4 kHz a little for a muffled lapel mic. Double-click a dot to put it back to 0. **Reset** flattens everything.
- **Show music and filler noises as [MUSIC]**: walk-in music shows as [MUSIC] instead of nonsense words.
- **Join spelled-out acronyms**: "U K" becomes "UK".
- **Sentence case instead of capitals**: for speakers the engine writes in capitals. Vocabulary words keep their own spelling.

> **Tip:** Set the gain and EQ in the sound check, with the speaker's actual mic, not on the day's first session.

## Vocabulary

Put in the names, brands, places and jargon for the event, one per line, spelled the way they're written: `Lovelace`, `Riverside Centre`, `NHS`.

- Press **Save & apply**. Rooms already captioning pick it up at the next pause.
- **Boost strength** (0.5 to 6) is how hard the engine leans towards your words. It's one setting for the whole server, since every room shares the engine. Start at the default and only raise it if names are still missed; too high and it hears your words where they weren't said.
- Words the engine can't use (usually ones it can't spell out from sounds) are listed under **Couldn't use**. Try writing them closer to how they sound.
- **Captions on for this room** turns the room's captions on or off.

## Appearance

Choose a surface at the top: **Audience screen**, **Overlay** or **Subtitle bar**. Each has its own look:

| Setting | What it does |
|---|---|
| Font, Size, Weight | Size is in pixels on a 1080p screen. Bigger is better for the back row: 64 px or more on a big screen |
| Alignment, Line height | Left, centre or right, and the gap between lines |
| Text colour, Line background, Background opacity | The text, and the band behind each line |
| Screen colour | The whole screen behind the captions (the overlay is always transparent) |
| Lines | How many lines show at once |
| Position | Bottom, centre or top of the screen |
| Hold, Fade | How long a line stays after the speaker stops, and how long it takes to fade |
| AI disclaimer | A small line saying the captions are automatic |

**Save** changes every screen of that kind in the room at once. **Defaults** puts that surface back how it started. **Open this screen** shows it in a new window.

> **Important:** Keep strong contrast: light text on a dark band, or dark on light. Don't go below about 4.5 to 1. The defaults pass.

## Corrections

The list shows the session's lines. Click a misheard word and type what it should have been. That doesn't retrain the engine: it adds the right word to the room's vocabulary so it's boosted from the next pause on. **Corrections made** lists every fix and who made it. **Clear list** only clears the history on screen.

## Transcripts

Start and stop a transcript, record automatically, and download the text, SRT or VTT. See [Transcripts and caption privacy](/docs/transcripts).

## Admin: the speech engine

**Console → Captions** shows the engine's state (**ready**, **downloading** with a percentage, **error**), how many rooms are live out of how many the server can caption at once, and **Reload engine**. The server can caption about one room per CPU core; laptops making their own captions don't count.
