---
summary: Drive timers, messages, overlays, captions and screens from Bitfocus Companion or other automation with an API key.
audience: admins
keywords: companion, bitfocus, stream deck, api, api key, automation, http, buttons, x-api-key, rest, endpoint
---
# Companion and the API

Bitfocus Companion (and anything else that can send a web request) can drive AT SUITE: timer presets, start and pause, more time, blink, stage messages, the clock, overlays, captions and screens.

## 1. Make an API key

1. In the console, open **Settings → API keys** (admins).
2. Type a name, like *Companion*, and press **Create**.
3. Copy the key. It's shown once.

![Settings, API keys tab: a box for the key name and Create](/static/kb/settings-keys.jpg)

## 2. Set up Companion

Your server has a full guide with a ready list of buttons: open `http://SERVER:8080/guide/companion`. In short, use Companion's **Generic HTTP** module with your server's address, and send the header `X-API-Key: <your key>` on every request.

## 3. The buttons

Every button is a POST. The room number is in the stage screen's address (`/timer/3` is room 3).

| Button | POST | Body |
|---|---|---|
| 5 minutes, started | `/api/timers/3/preset/5` | |
| Start / pause | `/api/timers/3/toggle` | |
| Add a minute | `/api/timers/3/add` | `{"delta_ms":60000}` |
| Blink | `/api/timers/3/blink/toggle` | |
| Stage message | `/api/timers/3/message/show` | `{"text":"Wrap up"}` |
| Clock | `/api/timers/3/clock/toggle` | |

The guide on your server lists every endpoint a key can call (timers, captions, overlays, screens, chat, help, notes, links and presenters), and how to read values like the time left back into Companion. The full API reference is at `http://SERVER:8080/api/docs`.

## Keep keys safe

A key can drive your show. Make one per Companion, delete keys you no longer use, and never put a key in a web address.
