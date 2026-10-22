---
summary: Install AT SUITE on a Linux server at your venue with one command, add https for microphones, and run it with no internet.
audience: admins and IT
keywords: install, server, linux, docker, ubuntu, get.sh, port, https, tls, certificate, microphone, offline, requirements, hardware
---
# Install on your own server

Run AT SUITE on a server at your venue. It needs to reach the internet once a day for its licence check-in; everything else works on the venue network alone. For a venue with no internet at all, [ask us](/contact) for an offline key.

Prefer us to run it? See [Managed hosting](/docs/managed-hosting).

## What you need

- **A server**: any 64-bit Linux machine (Ubuntu 22.04 or newer is easiest) with 4 CPU cores, 8 GB of memory and 20 GB of disk. A small PC or a virtual machine is fine. The laptops make the captions, so the server does little work.
- **A fixed address** on the venue network, for example `10.0.0.10`. A DHCP reservation is fine.
- **Windows 10 or 11 laptops** for the techs. Any other computer, tablet or phone can use the workspace in a browser.
- **Your licence key**, from [your account](/account).

## Install

On the server, as root:

```sh
curl -fsSL https://github.com/adam1991tom/AT-SUITE-releases/releases/latest/download/get.sh | sudo bash
```

It installs Docker if it's missing, puts AT SUITE in `/opt/at-suit` and starts it on port 8080. When it finishes it prints the address to open.

Options go after `-s --`:

| Option | What it does |
|---|---|
| `--port 8180` | Use another port, for example next to other apps on the same server |
| `--tls` | Also serve https on port 8443 (see below) |
| `--tls-host 10.0.0.10` | The address laptops use for https, if it isn't the server's first address |
| `--no-asr` | Leave out the server's own speech engine (smaller; laptops still make captions) |

```sh
curl -fsSL https://github.com/adam1991tom/AT-SUITE-releases/releases/latest/download/get.sh | sudo bash -s -- --port 8180 --tls
```

## First visit

Open `http://SERVER:8080/` in a browser and follow the [setup wizard](/docs/setup-wizard). Paste your licence key at the end. You can finish setup without one and paste it later in **Licence**, but until you do, only the Licence page works.

## https and microphones

Browsers only let a web page use the microphone over https. The AT SUITE app on Windows doesn't need it, so most venues can skip this. If techs will send captions from a browser, install with `--tls`, then trust AT SUITE's certificate on each laptop once:

1. On the server, in `/opt/at-suit`: `docker compose cp tls:/data/caddy/pki/authorities/local/root.crt ./atsuit-root.crt`
2. Copy `atsuit-root.crt` to each laptop. On Windows, double-click it, then **Install Certificate → Local Machine → Trusted Root Certification Authorities**. IT can push it to every laptop with Group Policy.
3. Use the https address, `https://SERVER:8443/`.

## A venue with no internet

The server only needs the internet for updates, the licence check-in and the first download of the speech model. For a site with none:

- Ask us for an **offline key**, which never checks in and runs to a fixed date.
- Install from a machine with internet, or copy the `/opt/at-suit` folder and the Docker image across.
- Copy the speech model from another AT SUITE server into the new one's data volume (see `docs/INSTALL.md` in the install files, "Offline sites").
- Upload the Windows app to **Laptops & screens → Add laptops** by hand, and update the server with `sudo /opt/at-suit/update.sh` when you have a new release.

## Updates and backups

The server checks for new releases and installs them by itself, never while a show is on. See [Updates](/docs/updates). It backs itself up every night at 02:00 and keeps the newest 14. See [Backups, restore and moving server](/docs/backups).

## Uninstall

In `/opt/at-suit`: `docker compose --profile tls down` stops it and keeps the data. Add `-v` to delete the data too.

Next: [install the laptop app](/docs/laptop-app).
