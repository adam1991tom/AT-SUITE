---
summary: Set up an event, build its running order by hand or from a spreadsheet, add presenters and show files, review slides, and send a day's sessions to the room timer.
audience: managers and admins
keywords: presenters, event, conference, running order, schedule, sessions, speakers, import, spreadsheet, csv, excel, pdf, slides, review, approve, reject, show files, walk-in video, schedule csv, send to timer
---
# Events and the running order

The **Presenters** page (console sidebar) is where a conference's running order lives: the event, its sessions in each room, the presenters, and their slides. Techs see their own room's sessions in the workspace, and the timer can be built from them in one press.

![The Presenters page for Future of Events Summit: tabs for Running order, File review, Import and Settings, and sessions grouped by day, each with its time, room, title and readiness pills](/static/kb/console-presenters.jpg "Presenters → Running order.")

## 1. Make the event

Admins and managers: **Presenters → New event**.

- **Name** and **Client**, and a **Colour** that marks the event's sessions.
- **First day** and **Last day**.
- **Status**: planning, live or finished. With more than one site, pick the **Site**.

Press **Create event**. Later, **Edit event** changes it. **Archive** hides an event and switches off all its presenter links. **Delete event and its files** removes everything, uploads included.

With more than one event, pick which you're working on from the list at the top right.

## 2. Add the sessions

Either by hand, or from the client's spreadsheet.

**By hand:** **Add session**, then the title, **Room**, **Starts**, **Ends** and **Notes for the room** (anything the tech needs: "lapel mic for Dr Patel", "video with sound at 12:10").

**From a spreadsheet:** the **Import** tab. Choose the file and press **Read it**.

- Excel (`.xlsx`) and CSV files with column headings are read straight away. AT SUITE looks for **Room**, **Date** or **Day**, **Start** and **End** (or **Time** like `09:00 - 09:45`), **Session** or **Title**, **Speaker** or **Presenter**, **Email** and **Phone**.
- PDF and Word running orders need the schedule AI (see Settings below).
- Check the rows it found. Fix anything in the boxes, remove a row with ✕, and separate several presenters with `;`. Rooms in amber aren't set up at this site: those sessions come in without a room.
- Press **Add these sessions**, or **Discard**. Nothing is saved until you press Add.

Sessions are grouped by day. Click a session to open it.

## 3. Presenters

In an open session, **Add presenter**: name, and email and phone if you have them. Each presenter gets their own private link to upload slides and check in, with no account. See [Presenter links, uploads and check-in](/docs/presenter-links).

## 4. Show files

The show's own files for a session, in running order: the walk-in video, stings, a sponsor loop, the final merged deck. Choose the kind (presentation, video, picture, audio, other) and **Add show file**. Put them in order with ↑ and ↓, and **Rename** them so the tech sees "Walk-in loop" and not `final_v3_FINAL.mp4`.

## 5. Readiness at a glance

Each session's line shows pills so you can see what's missing without opening it:

- **2/3 here**: how many presenters have checked in (green when everyone has).
- **files approved**, **1 to review**, **1 rejected** or **1 file missing**.
- **3 show files**.

## 6. Review the slides

The **File review** tab lists every upload, newest first, with the room, session and presenter. Open the file to check it, then **Approve** or **Reject**. When you reject, write what to change ("Please send 16:9", "The video doesn't play"): the presenter sees it on their page. Tick **Show older versions too** to see earlier uploads.

Only **approved** files go to the room's presentation laptop. Techs can approve and reject in the workspace too.

## 7. On the day: the tech's Sessions window

In the workspace, **Sessions** shows the room's sessions for the day: who's here, each presenter's file and its review state, with **Approve**, **Reject** and **Check in** buttons. The session on now is highlighted, and the top bar and the Sessions card show **Now** and **Next**. A new upload pops up as **New slides from ...** in the bell.

**Send this day to the timer** replaces the room's cue list with the day's sessions: one cue each, timed from its start and end, with the presenters' names in the note. See [Build the running order](/docs/cue-list).

![The workspace Sessions window: today's sessions with presenters, check-in pills and their files](/static/kb/workspace-sessions.jpg "The Sessions window in the tech workspace.")

## Settings (admins)

**Presenters → Settings**:

- **Largest file a presenter can upload (MB)**.
- **Note on every presenter's page**: "Please upload by 6pm the day before. 16:9 slides."
- Where the files are stored (set `ATSUIT_PRESENTER_FILES` to keep them on a NAS).
- **Schedule AI**: an Ollama address and model on your network, to read PDF and Word running orders. Nothing leaves your network.
- **Room sync** codes: see [Room sync](/docs/room-sync).

**Schedule CSV** (top right) downloads the whole running order as a spreadsheet, for the client or the crew sheet.
