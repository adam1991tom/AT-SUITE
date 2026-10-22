---
summary: Read the pre-show check before doors, find what's red or amber, and fix each kind of problem.
audience: managers and admins
keywords: pre-show check, health check, preshow, ready, not working, red, amber, green, offline, laptop offline, screen showing nothing, caption mic not live, quiet mic, before doors, checklist
---
# The pre-show check

The pre-show check looks at every tech laptop, stage screen and caption mic, room by room, and colours each one. It's on the console **Dashboard** and in the **manager view**, and refreshes every 5 seconds.

![The pre-show check: a summary saying 7 ready and 1 not working, then cards for Main Hall, Studio 1 and Studio 2 listing each laptop, screen and caption mic with a coloured dot and a line saying what it's doing](/static/kb/console-dashboard.jpg "The pre-show check at the top of the console dashboard.")

## The colours

- **Green (ready)**: working as it should.
- **Amber (to check)**: on, but something wants a look.
- **Red (not working)**: needs fixing.
- **Grey (off)**: not in use today, like a room with captions turned off. Never counted as a problem.

The summary at the top counts them: **7 ready**, **1 to check**, **1 not working**, and when it last checked.

## What each line means and what to do

| It says | What it means | Fix |
|---|---|---|
| Laptop: **Amy Clarke · v1.24.0** (green) | Started today in this room, by Amy, on that app version | Nothing |
| Laptop: **On, but not started today** (amber) | The laptop is on but nobody has signed in to the room today | The tech signs in and picks their room (see [Start the day](/docs/start-the-day)) |
| Laptop or screen: **Offline** (red) | It hasn't been heard from for a while | Check it's on, awake and on the venue network. Restart the app |
| Screen: **Standard** (green) | Showing that view | Nothing |
| Screen: **On, showing nothing yet** (amber) | Paired but no view chosen | Pick a view on **Timers → Screens** or in the workspace's **Screens** window |
| Caption mic: **Live from MAIN-HALL-1, level −24 dB** (green) | Captions are live from that laptop | Nothing |
| Caption mic: **very quiet** (amber) | Live, but the level is very low | Check the input, the desk send and the gain (see [Caption settings](/docs/caption-settings)) |
| Caption mic: **Not live** (red) | Captions are on for the room but no mic is sending | Start the mic in the room's workspace: **Captions → Send my mic** |
| Caption mic: **The caption engine isn't ready** (red) | The speech engine is still starting, downloading or stopped | Wait for it, or check **Console → Captions** |
| **Not in a room** | A laptop or screen not given a room. Offline ones here count as off | Give it a room on **Laptops & screens**, or leave it |

Laptops are listed Main PC first, then Backup, then the rest.

## Before doors

1. An hour before, open the Dashboard and get everything green or grey.
2. Fix red first, then amber.
3. Send a test line on the captions and a test stage message in each room (see [Stage messages](/docs/stage-messages)).
4. Check again ten minutes before doors.

See also: [Run a conference day](/docs/scenario-conference-day).
