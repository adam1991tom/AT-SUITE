---
summary: Move AT SUITE to a new server, or bring it back after the old one died, with everything as it was: rooms, people, chat, timers, presenters' files and the licence.
audience: admins
keywords: new server, move server, migrate, replace server, hardware failure, disaster recovery, restore, rebuild, server died, upgrade hardware, change ip address
---
# Scenario: move to a new server

**Why:** the old server is being replaced, or it died. **Time:** about 30 minutes, best done on a day with no show.

## 1. Get a backup

- **The old server still works**: **Console → Backups → Back up now**, then download it. Do it last thing, so it has the latest chat and changes.
- **It died**: use the latest backup you downloaded and kept elsewhere. (This is why you keep one off the server; see [Backups](/docs/backups).)

The backup is one zip with everything: rooms, people and passwords, chat and its files, timers and views, presenters' files, show reports, laptops and screens, settings, the licence and the encryption key. Keep it safe: it can read every message.

## 2. Install the new server

Follow [Install on your own server](/docs/self-hosted-install). Run the setup wizard with anything: the restore replaces it all.

> **Tip:** Give the new server the **same address** as the old one (move the DHCP reservation, or set the same fixed address). Then every laptop and screen finds it by itself, with nothing to change on them.

## 3. Restore

On the new server: **Backups → Restore**, choose the backup file, type **RESTORE** when asked. It checks the file, restarts and comes back as the old server was.

## 4. Check

1. Sign in with your old admin account.
2. **Licence**: your key is there. If the old server is gone for good, nothing else to do. If both will run, only one may use the key.
3. **Laptops & screens**: laptops and screens reconnect by themselves within a minute or two if the address is the same.
4. **Captions**: the speech model downloads again by itself the first time. Transcripts aren't in backups (they're short-lived by design).
5. **Settings → Updates**: check the update mode is as you want it.

## If the address changed

Each laptop app has to be moved to the new address: on each laptop, **Connect to a different server** in the tray menu, then an admin of the new server signs in (see [Move a laptop to a different server](/docs/laptop-app#move-a-laptop-to-a-different-server)). Keeping the same address saves doing that on every laptop. Screens need their pairing page opened at the new address. The [Linux screen agent](/docs/linux-screens) has its own setting.

## Managed hosting

With managed hosting there's nothing to move: we run the server. See [Managed hosting](/docs/managed-hosting).
