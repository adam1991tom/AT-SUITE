---
summary: Nightly backups of the whole server, backing up now, downloading, restoring, and moving to another server.
audience: admins
keywords: backup, restore, nightly backup, download backup, move server, new server, disaster, recovery, zip, RESTORE
---
# Backups, restore and moving server

AT SUITE backs up the whole server every night. A backup is one zip with everything: rooms, people, chat and its files, timers and views, presenters' files, kept show reports, laptops and screens, settings, the licence and the encryption key. Speech models, caption transcripts and the Windows app are left out; they come back by themselves.

Open **Backups** in the console (admins only).

![The Backups & restore page: Back up now and Download a backup; the nightly backup at 02:00 keeping the newest 14; the backups on this server; and Restore with a file picker](/static/kb/console-backups.jpg)

## Every night

The server backs itself up at **02:00** venue time and keeps the newest **14**. Change the time or how many to keep under **Every night**, or untick it to turn nightly backups off, and press **Save**. If the server is off at 02:00 it backs up when it's back, up to six hours later.

## Back up now, download, delete

- **Back up now** makes one straight away (do it before a big change).
- **Download a backup** makes one and saves it to your computer.
- **On this server** lists the backups the server keeps: download, delete or restore each one.

> **Important:** The server's backups sit on the server's own disk, so they won't help if that disk dies. Download one now and then and keep it somewhere else. A backup holds the encryption key and can read every message, so store it safely.

## Restore

Restore puts the whole server back as it was in the backup.

1. Pick a backup from **On this server**, or under **Restore** choose a backup file (from this server or another AT SUITE server).
2. Type **RESTORE** when asked, to go ahead.
3. The server checks the file, saves a backup of what's there now, restarts by itself and comes back as it was in the backup. Laptops and screens reconnect on their own.

A backup from a newer version of AT SUITE is refused: update this server first.

## Move to a new server

Download a backup from the old server, install AT SUITE on the new one, run the setup wizard, then restore the file on the new server's **Backups** page. See the scenario [Move to a new server](/docs/scenario-new-server).

## From the command line

On the server, in `/opt/at-suit`: `sudo ./backup.sh` saves a backup to `backups/`, and `sudo ./restore.sh <file>` puts one back. With [managed hosting](/docs/managed-hosting) we also keep our own encrypted nightly backups.

Every backup, download and restore is in the [audit log](/docs/audit-log).
