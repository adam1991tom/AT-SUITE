---
summary: Keep the room's presentation laptop's folder in step with every approved slide deck and show file, with the room sync tool and a room code.
audience: techs and admins
keywords: room sync, sync tool, presentation laptop, playback, folder, approved files, show files, sync code, room code, download slides, python, offline copy
---
# Room sync: slides on the presentation laptop

The laptop that plays the slides in a room needs every approved deck and show file for its sessions, in a folder, before the session starts. Room sync does that by itself.

## What ends up in the folder

```
files/
  2026-10-12 0930 Keynote/
    Keynote final.pptx         (the presenter's approved file)
    show/01 Walk-in.mp4        (show files, in running order)
```

One folder per session, named by date, time and title, so they sort in running order. Only **approved** files come down. A newer approved version replaces the old one, and anything no longer wanted is removed.

## Set it up

1. An admin opens **Presenters → Settings → Room sync** and presses **Make code** for the room. The code looks like `ABCD-2345`.
2. On the presentation laptop, download **the room sync tool** from the link on that page. It needs Python 3.8 or newer and nothing else.
3. Run it once with the server's address and the code (below).
4. It saves those settings next to itself, so after that `python atsuit_room_sync.py` is enough. It checks every 20 seconds.

```
python atsuit_room_sync.py --server https://10.0.0.10:8443 --code ABCD-2345
```

Useful extras: `--dir D:\Show` for another folder, `--every 10` to check more often, `--once` to sync once and stop, and `--cafile server.pem` when the server uses its own certificate.

> **Tip:** Run it the evening before, then leave it running. A late change to the slides lands in the folder within a minute of being approved.

## A new code

**New code** on the Settings page makes a fresh code and stops the old one. The laptop stops syncing until you give it the new code: use it if a code got out, or the laptop moved to another room.

## Without the tool

Techs can always download a session's files from the **Sessions** window in the workspace, or from **Presenters → Running order**: every file name is a link.

See also: [Late slides from a presenter](/docs/scenario-late-slides).
