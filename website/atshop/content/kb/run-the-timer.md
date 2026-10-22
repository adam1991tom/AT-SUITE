---
summary: Start, pause and stop the room timer, add or take off time, use quick timers, and read the warning, danger and overtime colours.
audience: techs
keywords: timer, countdown, go, start, pause, stop, add time, plus one minute, minus, quick timer, overtime, warning, danger, colours, room timer, stage timer
---
# Run the room timer

Every room has one timer. Whatever you do to it shows on the room's stage screens, the backstage screen, the AT Overlay, the top bar and the console, all at once.

![The Room timer window: 18:30 counting down for cue 3, Keynote: The Next Ten Years, with GO, Pause, Stop, Prev, Next, −1m, +1m, Blink, Blackout and a message box](/static/kb/workspace-main.jpg "The room timer (left), quick timers (middle) and the cue list (bottom).")

## The buttons

| Button | What it does |
|---|---|
| **GO ▶** (green) | Starts what's loaded, or loads the next cue and starts it. With nothing loaded it plays the first cue |
| **Start** / **Pause** (amber) | Starts the timer, or pauses it while it runs. The label says what a press will do |
| **Stop** (red) | Stops and clears the timer, and its blink, so nothing is left flashing on stage |
| **◀ Prev** / **Next ▶** | Loads the previous or next cue without starting it |
| **−1m** / **+1m** | Takes off or adds a minute, running or paused |
| **Blink** | Flashes the timer once time is up, or a stage message while it shows |
| **Blackout** | Blanks the stage screens until you press it again |
| **Timer views ↗** | Opens any timer view in a new window, to see what the screens show |

A button lights up the moment you press it and stays pressed until the server has it, so a press is never lost or sent twice. If the network drops, the buttons keep working: see [When the network drops](/docs/when-the-network-drops).

## Quick timers

For a countdown without a cue: open **Quick timers** and tap a length, from 3 to 60 minutes.

- With **Start on tap** ticked, it starts straight away. Otherwise it loads (outlined in the brand colour); tap it again to start.
- A running quick timer fills and gently pulses. Tapping it again leaves it running and says so, instead of starting over.
- **Clock** shows the time of day on the stage screens instead of the timer. Tap it again for the timer.

## Colours

The timer changes colour as time runs down, on every screen:

- **Normal** until the warning time (5 minutes left by default),
- **Warning** (amber) from then,
- **Danger** (red) from the last minute,
- **Overtime** once it passes zero: it counts up with a minus sign, like `-0:42`.

Each cue can have its own warning and danger times. The numbers flash only once time is up, or in the danger time when **Blink** or **Flash the timer at danger** is on.

## Flash the timer at danger

Tick **Flash the timer at danger** under the timer and the stage timer blinks when a cue reaches its danger time. It stops with Stop, or when the next cue starts.

## Next

- Build the running order: [Build the running order (cue list)](/docs/cue-list).
- Talk to the speaker: [Stage messages, blink, clock and blackout](/docs/stage-messages).
- Choose what the screens show: [Timer views](/docs/timer-views).
