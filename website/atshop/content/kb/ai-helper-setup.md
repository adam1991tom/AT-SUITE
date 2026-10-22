---
summary: Admins: turn the AI helper on, write venue notes, choose what it answers from (tech guide, AT SUITE manual, past fixes, web search) and connect a private AI model.
audience: admins
keywords: ai helper settings, venue notes, ollama, private ai, model, llama, tech guide, manual, learned, forget, web search, duckduckgo, set up ai, knowledge
---
# Set up the AI helper

**Console → Settings → AI helper** (admins).

![The AI helper settings: Turn on the AI helper, a Venue notes box, tick boxes for learning from help calls, the built-in tech guide and the AT SUITE manual, the private AI model address and model, web quick search, and the Learned from techs list](/static/kb/settings-ai.jpg "Settings → AI helper.")

## 1. Turn it on

Tick **Turn on the AI helper** and **Save**. Techs then see it in their **Help** menu, and it picks up each help call while the crew is on the way.

## 2. Write your venue notes

This is what makes the helper yours. In **Venue notes**, write one topic per paragraph, with its first line as a heading:

```
Hall A projector
Use input HDMI 2. The remote is on the lectern shelf. If it says no signal, press Source twice.

Lectern mic
Shure ULXD on channel 3 of the desk. Spare batteries in the green box in the control room.

Wi-Fi for presenters
Network RiversideGuest, password on the card at the lectern.
```

Your notes always come first. Write them like you'd brief a new tech.

> **Note:** Venue notes are only shown to signed-in techs. Don't put passwords you wouldn't tell a new tech.

## 3. Choose what it answers from

- **Learn from how help calls were fixed**: when a help call is resolved with a note on how, the helper offers that fix next time. The number so far shows at the top.
- **Use the built-in tech guide**: fault finding for sound, video, lighting, staging and rigging, networks, presenters' laptops, hybrid events, safety and running the show. Works offline.
- **Use the AT SUITE manual**: these help pages, built into the server, so techs can ask "how do I..." about AT SUITE itself. They match the version you're running.

## 4. A private AI model (optional)

Without a model, the helper still chats: it picks the best matching note, fix, guide entry or manual page, and asks the guide's questions to narrow the fault down.

With a model on your own network, it writes natural replies from the same knowledge and the whole conversation:

1. Install [Ollama](https://ollama.com) on a machine on the venue network (a PC with a decent graphics card is ideal).
2. Run `ollama pull llama3.1:8b` on it.
3. Enter the **Ollama address** (like `http://192.168.1.50:11434`) and the **Model** (`llama3.1:8b`). Leave the address empty to use the one set for the schedule AI in Presenters.
4. **Save**. Techs see "Private AI on your network" at the top of the helper.

Nothing leaves your network: the model runs on your machine.

## 5. Web quick search (off by default)

**Look up questions on the web when the venue's notes don't cover them**. Only the question is sent (to DuckDuckGo), never your notes, chat, names or rooms. Leave it off for NDA work.

## Learned from techs

Answers techs marked **This fixed it**, with who and when. **Forget** any that are wrong or out of date.

## The tech guide

Under the settings is the **Tech guide**: every topic the helper knows, how many entries and questions each has, and where it came from (**Built in**, **Changed here**, **Added here**).

- **Read or change** a topic. Your copy is used instead of the built-in one; **Reset** brings the built-in one back.
- **Add a topic** for your own kit. Open **How to write a topic** for the format: a `## ` heading per fault, a `Keywords:` line, then the steps.
- Anyone can read the guide at `/guide/help`, so keep venue details (rooms, inputs, where kit lives) in your venue notes, not the guide.

The AT SUITE manual comes with each release and isn't edited here. Techs can read it at `/guide/manual` on your server, even without internet.
