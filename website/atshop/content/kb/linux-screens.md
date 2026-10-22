---
summary: Turn a Linux laptop or all-in-one into a stage screen with one command, with the HDMI rule and remote restart, update and reboot.
audience: admins and IT
keywords: linux screen, screen agent, kiosk, chromium, install screen, hdmi, display, reboot screen, all-in-one, autostart
---
# Linux screens

A screen is a Linux laptop or all-in-one that only shows things: a room's timer, the backstage running order, captions, a custom view or a web page. The screen agent starts it full screen at every login and lets the console restart, update and reboot it.

## Install

Once, as the user logged in to the desktop (an X11 session with automatic login on):

```sh
curl -fsSL http://SERVER:8080/screen-agent/install.sh | bash -s -- \
     --server http://SERVER:8080 --name HD-STAGE-1 --allow-power
```

It installs Chromium and starts the screen full screen at every login. Leave out `--allow-power` if the console shouldn't be able to reboot it. The command is also on **Laptops & screens → Add laptops → Linux screens**, with the server's address filled in.

The screen then shows a pairing code: [add it from a tech laptop](/docs/pair-a-screen). To add it straight away instead, put `--code ENROLMENT-CODE` in the command (the code is at the top of **Add laptops**).

## The HDMI rule

When an HDMI (or DisplayPort, DVI or VGA) display is plugged in, the picture goes only to that display and the built-in screen goes dark. Unplug it and the built-in screen comes back. So a laptop can sit closed under the stage with the display plugged in.

## Control it from the console

**Timers → Screens** shows each screen's address, which display it's using, its agent version (and whether it needs an update) and when it was last seen, with:

- **Identify**: flashes its name on it.
- **Restart**: restarts the browser.
- **Update**: updates the screen agent now.
- **Reboot**: restarts the machine (only with `--allow-power`).

## Updates

Screens update their agent from the server by themselves after the server updates. See [Updates](/docs/updates).
