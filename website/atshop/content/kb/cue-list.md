---
summary: Build the room's running order as cues with lengths, start times and end actions, reorder them, and bring one in from Ontime or the presenters schedule.
audience: techs
keywords: cue list, cues, running order, rundown, schedule, add cue, edit cue, end action, overtime, load next, play next, ontime import, count up, skip
---
# Build the running order (cue list)

The cue list is the room's running order: one **cue** for each session, with its title and length. Run it with **GO**: each press starts the next cue.

![The Cue list window: six cues from Doors and walk-in to Lunch, each with its length, end action and Load, Edit, up, down and delete buttons; cue 3 is on the timer now](/static/kb/workspace-main.jpg)

## Add a cue

At the bottom of the **Cue list** window:

1. **Cue**: a number or code, like `3` or `K1`.
2. **Title**: what the screens show, like *Keynote: The Next Ten Years*.
3. **mm:ss**: the length, like `30:00` (or `1:00:00` for an hour).
4. **Start hh:mm** (optional): when it's planned to start.
5. **At zero**, the end action (below).
6. **Timer type**: Count down (the usual), Count up, Clock, or No timer.
7. **Note** (optional), a **colour** for the cue's edge, and **Skip** to leave it in the list without playing it.
8. Press **Add cue**.

## End actions: what happens at zero

| End action | At zero |
|---|---|
| **Keep going (overtime)** | Counts on into overtime, in the overtime colour, until you press GO or Stop |
| **Stop at zero** | Stops at 0:00 |
| **Load next** | Loads the next cue without starting it |
| **Play next** | Starts the next cue straight away |

## Change the list

- **Load**: puts a cue on the timer without starting it.
- **Edit**: opens the cue in the form; change it and press **Save cue** (or **Cancel**).
- **↑ ↓**: move it up or down.
- **✕**: delete it (it asks first).

![Editing cue 3: its number, title, 30:00, Keep going (overtime), Count down, a note, a colour, Skip, and Save cue and Cancel](/static/kb/workspace-cue-edit.jpg)

## Bring in a running order

- **From Ontime**: under **Bring in an Ontime running order**, choose the Ontime project file (`db.json`).
- **From the presenters schedule**: in the **Sessions** window, **Send this day to the timer** replaces the cue list with one cue per session. See [Presenter links and files](/docs/presenter-links).

## Where the running order shows

The **Backstage** view shows the running order with the cue that's on now; the stage views show the cue's title and what's next. See [Timer views](/docs/timer-views).

Running a full day? Follow [Run a conference day in one room](/docs/scenario-conference-day).
