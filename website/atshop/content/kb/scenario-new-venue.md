---
summary: From nothing to a working venue: install the server, run the wizard, add people, laptops and stage screens, and test a room end to end.
audience: admins
keywords: new venue, first time, set up from scratch, getting started, install, onboarding, day one, first install, checklist, commissioning
---
# Scenario: set up a new venue

**You have:** a Linux server or small PC on the venue network, Windows laptops for the techs, a screen or two for the stage, and your licence key. **Time:** about an hour.

## 1. Install the server (15 minutes)

Follow [Install on your own server](/docs/self-hosted-install): one command, then open `http://SERVER:8080` in a browser. Give the server a fixed address first (a DHCP reservation is fine), because every laptop and screen will point at it.

## 2. Run the setup wizard (5 minutes)

The first visit opens the [setup wizard](/docs/setup-wizard):

1. Your organisation (*Grand Hall Events*), the venue (*Riverside Centre*) and its **time zone**.
2. Your rooms: *Main Hall*, *Studio 1*, *Studio 2*, *Boardroom*.
3. Your own admin account. Use a long password.
4. Paste your licence key.

## 3. Add your people (10 minutes)

**Console → People**. Add each tech with a username and name, role **tech**, and leave the password blank: they sign in with `ChangeMe` and choose their own. Add your duty managers as **manager**. See [People, roles and passwords](/docs/people-and-passwords).

## 4. Put the venue's knowledge in (10 minutes)

- **Links**: the desk's web page, the projector's control page, the venue's run sheet. See [Links](/docs/links).
- **Settings → AI helper**: turn it on and write a few venue notes: where the spare batteries are, which input the projectors use. See [Set up the AI helper](/docs/ai-helper-setup).
- **Settings → Look**: your logo and brand colour.

## 5. Set up the laptops (5 minutes each)

**Laptops & screens → Add laptops → Windows tech app**. Upload the installer once, then on each laptop install the app and enrol it with the server address, the enrolment code and a name like `MAIN-HALL-1`. See [The laptop app](/docs/laptop-app).

> **Tip:** Name laptops after their room and position: `MAIN-HALL-1`, `MAIN-HALL-2`, `STUDIO-1`. You'll thank yourself on show day.

## 6. Add the stage screens (5 minutes each)

On each screen, open `http://SERVER:8080/screen` full screen (or install the [Linux screen agent](/docs/linux-screens)). It shows a code. On the room's laptop, **Add a screen**, type the code, choose **Standard** for the stage or **Backstage** for the green room. See [Add a stage screen](/docs/pair-a-screen).

## 7. Test one room end to end (10 minutes)

On `MAIN-HALL-1`, sign in as a tech and start the day in Main Hall as **Main PC**. Then:

1. **Timer**: add three cues, press **GO**, check the stage screen counts down and goes amber and red. See [Run the room timer](/docs/run-the-timer).
2. **Stage message**: send "Test", check it shows, then **Hide**.
3. **Captions**: plug in a mic, **Send my mic**, check the caption screen. See [Live captions: quick start](/docs/captions-quick-start).
4. **Help**: send a test help call, answer it from the console with **On my way** and **Resolved**.
5. **Pre-show check**: on the console Dashboard, everything for Main Hall is green.

## 8. Keep it safe

- **Backups** runs every night by itself. Download one now and keep it somewhere else. See [Backups](/docs/backups).
- **Settings → Updates**: choose whether updates install by themselves. See [Updates](/docs/updates).

You're ready for a show. Next: [Bring a new tech on board](/docs/scenario-new-tech).
