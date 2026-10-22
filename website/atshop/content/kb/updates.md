---
summary: How the server updates itself from new releases (never during a show), and how tech laptops and screens update from the server.
audience: admins
keywords: update, upgrade, new version, release, install now, automatic updates, tell me only, rollback, laptop app update, screen agent, github token
---
# Updates

AT SUITE keeps itself up to date. The server installs new releases by itself, never while a show is on, and the laptops and screens update from the server, so they never need the internet.

## The server

The server checks for a new release every half hour. **Settings → Updates** decides what happens:

- **Install by itself** (the default): when a new version is out and no show is on, the server updates itself: backup first, then a health check, and back to the old version and data if it isn't healthy.
- **Tell me only**: shows here when a new version is out. Press **Install now** to update.
- **Off**: doesn't check by itself. **Check now** still asks.

"No show on" means no timer running or paused in any room. The **Show on** line says what's holding an update back.

![Settings, Updates tab: the running version, newest release and status on the left; the three choices and the GitHub token on the right](/static/kb/settings-updates.jpg)

**Check now** says what it found next to the button: up to date, a new version is out, or why it couldn't check.

With [managed hosting](/docs/managed-hosting) this page says "Updates are looked after by your AT SUITE provider": we update your server outside show times.

### By hand

On the server: `sudo /opt/at-suit/update.sh`. It does the same safe update: backup, health check, roll back if it isn't healthy.

## Tech laptops

When the server updates, it also fetches that release's Windows app and publishes it for the laptops. Each laptop checks the server as its app starts and every few hours:

- **When the app starts** and finds a newer version, it installs it and restarts once, before the day's work. The tech can turn this off in **This laptop**.
- **A version found later** downloads in the background and installs when the app closes, or when the tech presses **Update now** in **This laptop** or the tray menu. Never by itself during a show.

The app's version shows in the workspace top bar, in **This laptop** and in the tray menu. If the server has no app published (a server with no internet), upload the installer files in **Laptops & screens → Add laptops → Windows tech app → Publish a new version**: the `.exe`, `.blockmap` and `latest.yml` from the [release](https://github.com/adam1991tom/AT-SUITE-releases/releases/latest).

## Screens

Linux screens update their agent from the server on their next check-in after the server updates. **Timers → Screens** shows each screen's agent version; **Update** makes one check now.

## What's in a release

See [What's new](/docs/whats-new) for the latest changes.
