---
summary: The built-in timer views (Standard, Minimal, Clock, Backstage, Speaker preview, Overlay), previews, status bar, logos and uploading your own views.
audience: techs and admins
keywords: timer views, views, standard, minimal, clock, backstage, speaker preview, overlay, status bar, logo, custom view, ontime view, upload view, zip, preview
---
# Timer views: what the screens show

A **timer view** is how a screen shows the room's timer. Pick one for each screen when you [add it](/docs/pair-a-screen), or later in the workspace's **Screens** window or **Timers → Screens**.

## The built-in views

| View | What it shows |
|---|---|
| **Standard** | Logo top left, a big timer, the second line, the status bar and the progress bar. The view for the stage screens |
| **Minimal timer** | Just the numbers |
| **Clock** | The time of day |
| **Backstage (studio clock)** | A studio clock with the stage timer, now and next, the running order and help calls. For the stage manager |
| **Speaker preview** | The clock, every help call on the site and important crew messages, without the stage timer. For the speaker's own screen or a command desk |
| **Overlay window** | See-through, for a small window on a laptop or a bar across a screen |

Plus any view your venue made in the [layout designer](/docs/layout-designer) or uploaded.

![The Standard view on a 16:9 screen: 18:33 in large numbers with a status bar along the bottom showing the time now, Running, the cue, started, elapsed and expected end](/static/kb/screen-standard.jpg "Standard, with the status bar on.")

![The Backstage view: a studio clock on the left; on the right the timer on the stage screen, now and next, the running order and help calls](/static/kb/screen-backstage.jpg "Backstage, for the stage manager.")

![The Speaker preview view: the studio clock, a help call from Studio 1, and an important crew notification](/static/kb/screen-preview.jpg "Speaker preview: the clock, help calls and crew messages.")

![The Clock view: the time of day in large numbers, labelled Current time](/static/kb/screen-clock.jpg "Clock.")

## The Views tab

**Timers → Views** in the console lists every view, with a **Preview** that shows it live for the room you pick, and **Open full screen**.

![Timers, Views tab: a large preview of the Standard view for the Main Hall, then the built-in views with Status bar tick boxes and Preview buttons](/static/kb/timers-views.jpg)

Admins can change a view here:

- **Status bar**: tick it on or off for each view (the bar with the time now, elapsed and expected end).
- **Logo**: the Standard view shows the site's logo (or nothing if there isn't one). Change it in **Settings → General**. A view you make in the [layout designer](/docs/layout-designer) can have its own logo.

Screens showing a view change as soon as it's saved.

## Your own views

- **Make one** in the [layout designer](/docs/layout-designer): drag the timer, title, clock, message and logo onto a screen. No code.
- **Upload one** made for Ontime: on **Timers → Views**, upload the view's folder as a .zip with `index.html` at the top (or a single .html file). It shows at `/external/<view>/?room=<room id>` with the room's live timer, and appears in every screen's view list.

## Opening a view directly

Any browser can show a view without signing in: `http://SERVER:8080/timer/<room number>` (Standard), with `?view=minimal`, `clock`, `backstage`, `preview` or `overlay`. The room number is in **Timers → Views** and in the stage screen's address. In OBS or vMix, add it as a browser source.
