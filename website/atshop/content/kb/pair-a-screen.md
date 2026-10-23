---
summary: Add a stage screen by typing the six-digit code it shows into Add a screen in the workspace, and pick what it shows.
audience: techs
keywords: pair screen, add a screen, code, six digit, stage screen, monitor, display, confidence monitor, pairing, screen code
---
# Add a stage screen

Any screen can show the room's timer, captions or a test pattern. A screen that isn't added yet shows a big six-digit code; a tech types that code into their workspace. No admin or enrolment code is needed.

![A screen waiting to be added: "Add this screen" with the code 827 764 in large orange numbers](/static/kb/screen-pairing.jpg "A new screen shows a code. Codes last 15 minutes, and the screen shows a fresh one by itself.")

## Pair it

1. On the screen: open `http://SERVER:8080/screen` in a full-screen browser, or install the [Linux screen agent](/docs/linux-screens), which does it for you. The screen shows a code.
2. On your tech laptop, find the **Add a screen** window, next to the timer. (If it's closed, open it from the **Layout** menu.)
3. Type the code from the screen.
4. Pick **What it shows**:
    - any timer view: Standard, Minimal, Clock, Backstage, Speaker preview, or one your venue made in the [layout designer](/docs/layout-designer);
    - captions: the audience screen, a transparent overlay or a subtitle bar;
    - a test pattern;
    - *A web page…* for any address.
5. Optionally give it a **name**, like `HD-STAGE-LEFT`. Otherwise it's named after the computer, or `SCREEN-<code>`.
6. Press **Add screen**.

![The Add a screen window in the workspace: six boxes for the code, What it shows set to Standard, an optional name and the Add screen button](/static/kb/workspace-add-screen.jpg)

The screen joins your room and switches to what you picked within a couple of seconds.

## Change what a screen shows

- **In the workspace**: open the **Screens** window (from the **Layout** menu). It lists your room's screens; pick a new view for each, or put a web page on it.
- **In the console**: **Timers → Screens** lists every screen with its room and what it shows. Change either, or press **Identify**, **Reload** or **Reboot**.
- **On the screen itself**: tap the top-left corner 5 times (or press <kbd>P</kbd>) and pick the room and view.

![Timers, Screens tab in the console: each screen's name, address, room, what it shows, agent version and when it was last seen, with Identify, Reload and Reboot](/static/kb/timers-screens.jpg)

## Good to know

- Pairing a screen again (re-imaged, or removed from the console) reuses its name and gives it a new key.
- A screen deleted in the console goes back to showing a code.
- IT can add screens without pairing: put the enrolment code in the Linux install command, or use *Use an enrolment code instead* at the bottom of the pairing page.
- The **SCREENS** count in the workspace top bar shows how many of the room's screens are connected.

Screen blank or showing the wrong thing? See [The stage screen is blank](/docs/scenario-blank-screen).
