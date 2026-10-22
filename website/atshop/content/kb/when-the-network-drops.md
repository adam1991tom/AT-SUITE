---
summary: What keeps working on a tech laptop when the network or the server drops, and what happens when it comes back.
audience: techs
keywords: network down, offline, server down, can't reach server, no connection, wifi, dropped, connection lost, timer offline, reconnect
---
# When the network drops

The AT SUITE app is built to keep the show going when the laptop can't reach the server.

## The timer keeps working

If the laptop can't reach the server, the timer buttons still work: quick timers, start and pause, more or less time, GO, next and previous cue, stop, messages, blink, clock, blackout and the second line. The workspace and the AT Overlay on that laptop show the result at once, and a bar at the bottom says **the timer is running on this laptop**.

When the server is back, everything you pressed goes to every screen, each press as of when it was made: a timer started offline five minutes ago shows five minutes gone.

If someone changed the room's timer at the server during the drop, the latest change wins: your presses from before it are left out, and you're told.

## Captions keep listening

The laptop keeps turning speech into text. What's said while the network is down is sent as soon as the server is back, so the transcript has no gap.

## The workspace opens anyway

The app keeps a copy of the workspace on the laptop. If the server can't be reached when the app starts (it's restarting, or the laptop is off the venue network), the workspace opens from that copy with the room's timer where it should be. Only the workspace is kept, never chat, help calls or captions.

## Screens that keep going

In the **Captions controls** window, **Feed this room's screens from this laptop** lets the room's caption and timer screens show this laptop's captions and timer straight from the laptop, over the venue network. Those screens keep working when the server can't be reached. It shows the addresses to point the screens at. The first time, Windows may ask to allow the app on the network.

## What waits

Chat, help calls and handover notes wait for the server. The **live** label in the top bar turns to *connecting* until it's back.

See the scenario [The network drops mid-show](/docs/scenario-network-drop).
