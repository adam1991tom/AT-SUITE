---
summary: See every laptop and screen, who's on each, their health (CPU, memory, disk), and identify, move, reboot or remove them.
audience: admins and managers
keywords: laptops, screens, fleet, nodes, health, cpu, memory, task manager, details, identify, reboot, remove, offline, snapshots, move laptop room
---
# Watching laptops and screens

**Laptops & screens → All laptops & screens** in the console lists every tech laptop and screen at the venue (admins and managers).

![All laptops & screens: a row per laptop or screen with its kind, room, address, version, CPU and memory bars, when it was last seen, and buttons](/static/kb/laptops-list.jpg)

Each row shows:

- The **name**, and for a tech laptop who's signed in today and whether it's the Main or Backup PC.
- **Kind**: *tech* (a tech laptop) or *kiosk* (a screen).
- **Room**: change it here to move a laptop or screen to another room. Its chat, timer, captions and overlay follow it. Every move is in the audit log.
- **Address** and **version** of the app or screen agent.
- **Load**: CPU and memory bars for laptops running the app, amber at 75% and red at 90%.
- **Last seen**, and a dot: filled when it's online, a hollow ring when it's offline.

## Buttons

- **Details**: the laptop's task manager (below).
- **Set screen**: send a web page to it.
- **Identify**: flashes its name on its screen, to find which one it is.
- **Reboot**: restarts it (if its agent allows).
- **Remove**: takes it off the venue. It needs the enrolment code to come back. Removing old laptops frees places on your licence.

## Details: a laptop's task manager

![A laptop's details: CPU and memory with graphs, disk space, network address, screens, mains or battery power and popped-out windows](/static/kb/laptop-details.jpg)

**Details** shows the last 15 minutes of CPU and memory as graphs (refreshed every 5 seconds), how much memory AT SUITE itself uses, disk space, network addresses, screens, mains or battery, popped-out windows and the overlay. The numbers are kept in the server's memory only.

### Screen snapshots

If an admin has turned on **Managers can see snapshots of laptop screens** (**Settings → General → Privacy**), Details also shows a small picture of each of the laptop's screens. The laptop only takes them while someone has its Details open, stops within 30 seconds of it closing, and the tech sees a note at the bottom of their workspace the whole time. Snapshots are never saved.

## Adding laptops and screens

- Tech laptops: [The laptop app](/docs/laptop-app).
- Stage screens: [Add a stage screen](/docs/pair-a-screen) and [Linux screens](/docs/linux-screens).
- Overlay laptops: [Overlays](/docs/overlays).

To see which laptops and screens are ready before doors, use the dashboard's [pre-show check](/docs/preshow-check).
