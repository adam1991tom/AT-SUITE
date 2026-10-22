---
summary: Where AT SUITE keeps your data, what (if anything) leaves your network, and how long captions, chat and transcripts are kept.
audience: admins and clients
keywords: privacy, gdpr, nda, data, where is data, encryption, transcripts deleted, what leaves, internet, outside connections, data protection
---
# Privacy and data

AT SUITE runs on your own server (or one sealed server per venue with [managed hosting](/docs/managed-hosting)). The laptops, stage screens and caption sources talk to that server and nothing else. Nothing about a show, a room or a person is sent to the AT SUITE team.

## What leaves your network

You can block all of these without breaking a show:

| What | Where to | What is sent | When |
|---|---|---|---|
| Updates | github.com | Only the request for the latest version | Every 30 minutes, or never with updates off |
| Licence check-in | The AT SUITE website | The licence key | Once a day (never with an offline key) |
| Speech model | github.com | Only the download request | Once, when captions are first set up |
| Venue weather | open-meteo.com | The position of the town an admin picked | Every 15 minutes, once a town is set |
| AI helper model (optional) | The Ollama server you set up, on your network | The conversation and the matching notes | When a tech messages the AI helper |
| AI helper web search (off by default) | api.duckduckgo.com | The question only | When the venue's notes don't cover it |
| Bug reports to GitHub (off by default) | The repository an admin set up | The report, version and system. No names, rooms or screenshot | When an admin sends one |

## Captions

- Speech becomes text **on the tech's laptop** in the AT SUITE app. Only the text goes to your server; the audio never leaves the laptop. Browsers and older apps send the audio to your server instead, which does the same work there.
- Audio is never stored. Only finished caption lines are kept, and only while a transcript is recording.
- Transcripts are **stored encrypted** and **deleted 12 hours after they end** (1 to 168 hours in **Settings → General**).
- With **Caption text stays on the laptops** on, the server never hears the audio or sees the captions at all. See [Transcripts and caption privacy](/docs/transcripts).

## Chat, notes and help calls

- Chat is kept until an admin's **Delete chat messages older than** setting removes it, or for good if that's 0.
- Handover notes are stored encrypted; done notes are deleted after 30 days.
- Show reports keep the crew's chat messages only if whoever made the report ticked **Include the crew's chat messages**.

## People and passwords

Passwords are stored as salted hashes, never as text. Nothing signs in through a web address, and the server's logs never show a password, key or code.

## Laptop screen snapshots

Off by default. When an admin turns them on, a laptop only sends them while a manager has its details open, the tech sees a note the whole time, and they're never saved.

## For your clients

The full statement, with every outside connection, is `docs/PRIVACY.md` in the install files. With managed hosting, see our [Data Processing Agreement](/legal/dpa).
