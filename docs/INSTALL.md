<img src="../branding/logo/atsuit-wordmark.png" alt="AT-SUITE" width="200">

# Installing AT-SUITE

## Requirements

- A Linux server with Docker Engine and Docker Compose v2.
- 2 GB RAM plus about 300 MB per room being captioned at the same time, and
  roughly one CPU core per captioned room.
- 2 GB disk for the image and speech model, plus whatever chat uploads need.
- The first start downloads the speech model (about 500 MB, once). For a site
  without internet, copy a `models` folder from another install into the
  `atsuit-data` volume (see "Offline sites").

## Install

The quickest way, on a fresh server (installs Docker too if it's missing):

```bash
curl -fsSL https://github.com/adam1991tom/AT-SUITE-releases/releases/latest/download/get.sh | sudo bash
# options for install.sh go after -s --, e.g.  | sudo bash -s -- --port 8180 --tls
```

It puts AT-SUITE in `/opt/at-suit` and runs `install.sh` with the published image
of the newest release (the release carries only the install files, no source).
Set `ATSUIT_REF=v1.0.4` to install a particular release. Or build from a clone
of the source (development; the source repository needs access):

```bash
git clone https://github.com/adam1991tom/AT-SUITE.git /opt/atsuit
cd /opt/atsuit
sudo ./install.sh --port 8180 --tls
```

`install.sh` writes `.env` from `.env.example`, refuses a port that is already
taken, builds the image, starts it, waits for it to be healthy, and prints the
address. Open it in a browser and complete the setup wizard.

Options: `--port N`, `--tls` (adds https), `--tls-host ADDRESS` (the address
laptops use, defaults to the server's first IP), `--no-asr` (no captions,
smaller image).

## https and microphones

Browsers only let a web page use the microphone over https (or on the same
machine). A tech laptop sending captions from `/node` therefore needs the https
address. `--tls` starts Caddy with its own certificate authority on port 8443.
Each laptop must trust that authority once:

```bash
docker compose cp tls:/data/caddy/pki/authorities/local/root.crt ./atsuit-root.crt
```

Install `atsuit-root.crt` on the laptops as a trusted root certificate (on
Windows: double-click, Install Certificate, Local Machine, Trusted Root
Certification Authorities; Action1 or Group Policy can push it to every
laptop). If you'd rather not, run the node agent for captions instead; it
doesn't need https.

## Running next to the old apps (trial)

AT-SUITE uses one port and one Docker volume (`atsuit_atsuit-data`) and
touches nothing else, so it can run beside RoomComms, Device Suite, Ontime
and Companion. On ATSERVER1, ports 4001-4020, 5050, 5070, 8000, 16622 and
45876 are taken; 8180 and 8443 are free.

```bash
sudo ./install.sh --port 8180 --tls --tls-host 10.100.70.101
```

## Moving to a new server

Back up the old server (**Backups → Download a backup**), install AT SUITE on the
new one, set it up, then on its **Backups** page choose the file under **Restore**
and type RESTORE. The new server checks the file, keeps a backup of what it had,
restarts and comes back as the old one: rooms, people, chat, timers, laptops and
screens, settings and the licence. Speech models download again by themselves,
and the Windows app comes with the next release (or upload it in Laptops &
screens). Point the laptops and screens at the new address if it changed.

AT SUITE no longer imports from RoomComms, Device Suite or Homarr (removed in
1.21.0). To bring data from those, use 1.20.x, then back up and restore.

## Pointing kiosks at AT-SUITE

Kiosks running the Device Suite agent can report to AT-SUITE without being
reinstalled: change the server address in their agent config to
`http://SERVER:8180`. They appear in Laptops & screens as "old agent". To reboot or
update them from AT-SUITE, upload the fleet SSH key in Laptops & screens → Add laptops.

## Backups and updates

```bash
./backup.sh                           # saves backups/atsuit-DATE.tgz
./restore.sh backups/atsuit-DATE.tgz  # puts one back (asks first)
./update.sh                           # safe update: see below
./update.sh --check                   # which version is running
```

`update.sh` saves a backup, keeps the running version as the `atsuit:rollback`
image, then fetches the new version (`git pull`, the newest release for a
`get.sh` install, or the published image) and starts it. It waits until the
server answers healthy five times in a row. If it doesn't, it prints the
server's log, restores the backup and starts the previous version again, so
the venue is never left without a working server. Fix the cause, then run
`./update.sh` again.

### Automatic updates from GitHub

The server checks the newest GitHub release every half hour. **Settings →
Updates** decides what happens: **Install by itself** (the default), **Tell me
only** (an admin presses **Install now**) or **Off**. Nothing ever installs
while a show is on, meaning a timer that is running or paused in any room.

The install itself runs on the host, not in the container: `install.sh` sets
up a systemd timer, `atsuit-update.timer`, that runs `./update.sh --auto`
every 10 minutes, and `atsuit-update.path`, which runs it at once when an
admin presses Install now (or Install by itself finds a new version): the
server drops an `update-now` file in its data volume and systemd starts the
update as soon as it appears. That asks the server whether to install and, when it says
yes, does the same safe update as above with the release's tag. It then tells
the server how it went, so Settings → Updates shows the result. A version that
failed and was rolled back isn't tried again by itself; Install now tries
again. For an install from before 1.0.2, run `sudo ./install.sh --updater`
once, or let the next `sudo ./update.sh` set it up. Updaters set up before
1.8.0 add the Install now part by themselves on their next run. `journalctl -u
atsuit-update` shows what it did.

Once the server runs a new version, it also fetches that release's Windows app
(`.exe`, `.blockmap`, `latest.yml`) and publishes it for the laptops. Laptops
keep updating from the server, so they need no internet. A laptop only goes to
GitHub itself when the server has no app published.

The repository is private, so the server needs a **GitHub token** (Settings
→ Updates) to read its releases: a fine-grained token with *Contents: read* on
the repository, plus *read:packages* for an install that uses the published
image. The token stays on the server and is never sent to laptops. A laptop's
own GitHub fallback only works with public releases.

### The server's own backups

Every night (02:00 venue time unless an admin changes it on the **Backups**
page) the server backs itself up into `backups/` in its data volume and keeps
the newest 14. A backup is one zip of the whole server: the database, the
encryption key, chat files, presenters' files, timer views, kept show reports,
the agents and the fleet SSH key. Speech models, caption transcripts and the
Windows app are left out. If the server is off at that time it backs up when it
comes back, up to six hours later.

On the Backups page an admin can back up now, download any backup, delete it,
or restore it. A restore can also be a file downloaded from this or another
AT SUITE server. Restoring checks the file, saves a backup of what is there now,
then restarts the server (Docker starts it again) and puts the backup in place
before the database opens. A backup from a newer version is refused.

The server's backups sit on the same disk as the server, so they don't help if
the disk dies: download one now and then, or use `./backup.sh` and copy it
elsewhere. A backup contains the encryption key and can read every message, so
store it somewhere safe. `backup.sh` leaves the server's own backups out of its
file, and `restore.sh` leaves them in place.

## Offline sites

On a machine with internet, run AT-SUITE once so it downloads the model, then
copy it:

```bash
docker run --rm -v atsuit_atsuit-data:/data -v $PWD:/out alpine tar czf /out/models.tgz -C /data models
# on the offline server, after ./install.sh:
docker run --rm -v atsuit_atsuit-data:/data -v $PWD:/in alpine sh -c "tar xzf /in/models.tgz -C /data && chown -R 999:999 /data/models"
docker compose restart atsuit
```

## Uninstall

```bash
docker compose --profile tls down       # stops it, keeps data
docker compose --profile tls down -v    # also deletes all data
```
