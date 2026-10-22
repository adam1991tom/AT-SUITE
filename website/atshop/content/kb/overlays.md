---
summary: Put the room timer over a laptop's screen with AT Overlay, and control AT LiveOverlay graphics laptops from the workspace.
audience: techs and admins
keywords: overlay, at overlay, liveoverlay, timer on laptop screen, confidence, click through, on top, lower third, graphics
---
# Overlays

AT SUITE has two kinds of overlay:

- **AT Overlay**: the room timer in a see-through window over a tech laptop's screen, so the presenter's laptop or the confidence monitor shows the time on top of the slides. Clicks go through it to whatever is underneath. It's built into the AT SUITE app.
- **AT LiveOverlay**: a separate Windows app for graphics overlays. AT SUITE turns its overlays on and off from the workspace.

## AT Overlay on a tech laptop

Open the **Overlays** window from the **Layout** menu. It lists every tech laptop in your room running the app:

1. Pick the **position**: top centre, a corner, or a bar along the top or bottom.
2. Pick the **size**: small, medium or large. On a laptop with more than one screen, pick the **display**.
3. Press **Turn on**. **Turn off** hides it.
4. To show something else (any web page), paste its address in the box and press **Apply**.

You can turn it on for the other laptop in the room too: from the backup PC onto the main PC's screen, for example. If a laptop is offline or doesn't have the app, it's saved and shows as soon as the app runs there.

## AT LiveOverlay laptops

An admin adds each laptop running AT LiveOverlay once, in **Laptops & screens → Overlay laptops**: a name, its address (`http://IP:8765`), the API token from its tray menu → **Remote Control**, and its room.

![Laptops & screens, Overlay laptops tab: a name, address and API token, a room and Add](/static/kb/laptops-overlays.jpg)

Techs in that room then show, hide and switch its overlays from the **Overlays** window in their workspace.

## From Companion

Both kinds can be driven from Bitfocus Companion buttons. See [Companion and the API](/docs/companion).
