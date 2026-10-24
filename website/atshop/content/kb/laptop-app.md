---
summary: Install the AT SUITE app on a Windows tech laptop, enrol it once, roll it out silently, and keep it up to date.
audience: admins and IT
keywords: laptop app, windows app, install, enrol, enrolment code, admin sign-in, connect to a different server, change server, move laptop, node.json, silent install, smartscreen, AT-SUITE Node, desktop app, exe
---
# The laptop app

Each tech laptop runs the AT SUITE app for Windows 10 or 11. It's the tech's workspace: the room timer, chat, captions, help and screens. The timer and captions run on the laptop itself, so they keep going if the network drops.

![Laptops & screens, Add laptops tab: the enrolment code at the top, then the Windows tech app tab with install steps, the silent install file and Publish a new version](/static/kb/laptops-add.jpg)

## Install and enrol a laptop

1. In the AT SUITE console, open **Laptops & screens → Add laptops → Windows tech app**.
2. The first time only: upload the installer files from the [latest release](https://github.com/adam1991tom/AT-SUITE-releases/releases/latest) (the `.exe`, `.blockmap` and `latest.yml`). After that, every laptop updates itself from your server, never mid-show. With managed hosting we do this for you.
3. On each laptop, download and run the installer from that page.
4. Enter the server address (like `http://10.0.0.10:8080`, or `https://yourvenue.atsuite.tech` with managed hosting), and a name for the laptop (like `MAIN-HALL-1`). Then either type the enrolment code shown at the top of that page, or press **Admin sign-in** and let an admin sign in with their AT SUITE username and password. The app only uses the admin's sign-in to add the laptop: nobody stays signed in.

That's a one-off: the laptop stays enrolled. The installer isn't code-signed yet, so Windows SmartScreen asks once: **More info → Run anyway**.

### Silent install for IT

Put `node.json` (shown on the same page) in `C:\ProgramData\AT-SUITE\node.json`:

```json
{ "server": "http://10.0.0.10:8080", "enrol_code": "6C90-6FE0-D856" }
```

Then run the installer with `/S`. The app enrols itself under the PC's name on first start.

If the app can't find `node.json` there it just shows the set-up window, so you can enrol it by hand. (The older folder name `C:\ProgramData\AT-SUIT\node.json` works too.)

### Move a laptop to a different server

When your venue moves to a new server (a new address, or [managed hosting](/docs/managed-hosting)), move each laptop without reinstalling:

1. Open **Connect to a different server**. It's in the tray menu (right-click the AT SUITE icon by the clock), under the sign-in and start screens of the workspace, and on the **Can't reach the AT-SUITE server** page.
2. Enter the new server's address and the laptop's name.
3. An **admin of the new server** signs in with their username and password, then presses **Connect to this server**. If that server has more than one site, pick the laptop's site and press it again.

The app restarts on the new server. Until the new server accepts it, the laptop stays on the old one, and **Cancel, stay on this server** leaves everything as it was. A tech can't move a laptop by accident: it always needs an admin's password for the new server.

### The enrolment code

The code at the top of **Add laptops** lets new laptops and screens join this venue. **New code** stops the old one working for new devices; laptops already enrolled carry on. Only admins see it.

## Each show day

The tech opens the app, signs in, picks the room and says whether this is the **Main PC** or the **Backup PC**. The main PC never shows pop-ups; the backup gets silent ones on top. See [Start the day on a tech laptop](/docs/start-the-day).

## What the app does that a browser can't

- Makes **captions** from the laptop's microphone, on the laptop. See [Caption a room](/docs/captions-quick-start).
- Keeps the **timer** working when the network drops, and opens the workspace even when the server can't be reached. See [When the network drops](/docs/when-the-network-drops).
- **Pops out** windows onto a second monitor that can stay on top of everything.
- Shows the **AT Overlay** timer over the laptop's screen. See [Overlays](/docs/overlays).
- Reports its CPU, memory, disk, network and screens to **Laptops & screens**. See [Watching laptops and screens](/docs/laptops-page).

Any computer can still use the workspace at `http://SERVER:8080/node` in a browser.

## Updates

The app updates from your server, never from the internet and never mid-show. See [Updates](/docs/updates).

Print the tech quick-start card (`/guide/tech` on your server) and leave one by each laptop.

## Laptop limits

Your plan sets how many laptops can be enrolled at once. Remove old laptops in **Laptops & screens** to free a place, or [change plan](/account/plan).
