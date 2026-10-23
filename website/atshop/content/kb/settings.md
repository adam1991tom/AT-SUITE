---
summary: Every tab of Settings: branding and modules, privacy, passwords, help call escalation, the look, chat, API keys, updates and About.
audience: admins
keywords: settings, general, branding, product name, accent colour, modules, privacy, chat retention, escalation, theme, look, dark, light, weather, api keys, about, diagnostics
---
# Settings

**Settings** in the console is for admins. It has seven tabs: General, Look, Chat, AI helper, API keys, Updates and About.

## General

![Settings, General tab: Branding on the left (product name, organisation, accent colour) and Modules, Other and Passwords on the right](/static/kb/settings-general.jpg)

- **Branding**: the product name (shown in the top bars), the organisation and the **accent colour**. If you pick your own colour, AT SUITE works out a darker shade for text so it stays readable.
- **Modules**: switch whole parts of AT SUITE on or off: Chat & help requests, Timers, Laptops & screens, Captions, Overlays, Dashboard & links, Presenters. A module that's off disappears from every page.
- **Delete chat messages older than (days)**: 0 keeps them.
- **Send a help call out again when nobody answers it in (minutes)**: 2 by default. A call nobody has answered with **On my way** goes to every laptop and console page on the site, up to three times. 0 turns it off. See [Call for help](/docs/help-calls).
- **Passwords**: whether techs sign in with their own account, and whether **Forgot password** resets a tech's password straight away. See [People, roles and passwords](/docs/people-and-passwords).
- **Privacy**:
    - **Delete caption transcripts this many hours after they end** (1 to 168, 12 by default).
    - **Laptops make captions themselves** (on by default): the app turns speech into text on the laptop, so the server does far less.
    - **Caption text stays on the laptops** (off by default): the server never hears the audio or sees the captions. See [Transcripts and caption privacy](/docs/transcripts).
    - **Managers can see snapshots of laptop screens** (off by default). See [Watching laptops and screens](/docs/laptops-page).
- **Venue weather**: pick the venue's town and the techs' top bar shows the temperature and sky, with today's forecast when clicked. Only the town's position goes to the forecast service (Open-Meteo), and nothing until you pick a town.

## Look

![Settings, Look tab: five themes (Dark, Light, Match the laptop, Modern, Futuristic), then spacing, corners, font and animation, and a preview](/static/kb/settings-look.jpg)

One look for the whole site: every console, tech workspace, setup and presenter page. Pick a **theme** (Dark, Light, Match the laptop, Modern or Futuristic), then **spacing**, **corners**, **font** and **animation**. *Off (no flashing or animation)* suits anyone sensitive to motion. Press **Save for everyone**. Stage, caption and backstage screens keep their own look. Windows, menus and pop-ups are always solid, so nothing behind them shows through, even with Futuristic.

## Chat

Lists every direct-message chat between two people: who, and how much, never what was said. Deleting one removes its messages, files and reactions for both people.

## AI helper

Venue notes, the private AI model, the tech guide and what the helper has learned. See [Set up the AI helper](/docs/ai-helper-setup).

## API keys

Keys for Bitfocus Companion and other automation. See [Companion and the API](/docs/companion).

## Updates

How the server updates itself, and the newest release. See [Updates](/docs/updates).

## About

![Settings, About tab: Download diagnostics, Report a bug, then panels for this app, the server, nodes, apps and agents, venue, modules, captions and storage](/static/kb/settings-about.jpg)

Everything about this install in one place: the version, build and commit, the server, laptops and screens online, apps published, rooms and accounts, modules, the captions engine, storage and the last backup.

- **Download diagnostics** saves it as a file for a support ticket; **Copy for a support ticket** copies it. Neither includes passwords, keys or tokens.
- **Report a bug** opens the bug form. See [Report a bug](/docs/bug-reports).
