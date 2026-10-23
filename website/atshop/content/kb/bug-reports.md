---
summary: Report a bug from the console or a tech laptop, and how admins read, resolve and optionally send reports to GitHub.
audience: everyone
keywords: bug, report a bug, problem, fault, issue, broken, screenshot, support, github issue, feedback, something went wrong
---
# Report a bug

Something not working as it should? Report it from where you are. Reports go to your own admins on the **Bug reports** page. Nothing is emailed.

To tell the AT SUITE team, or for anything urgent, email [support@atsuite.tech](mailto:support@atsuite.tech) with the version from **Settings → About**. **Settings → About** shows the address too.

![The Report a bug form: What went wrong, What were you doing and what did you expect, an optional screenshot, What else is sent, Cancel and Send report](/static/kb/workspace-bug-report.jpg "The Report a bug form.")

## Send a report

- **On a tech laptop**: **Help → Report a bug**.
- **In the console**: **Settings → About → Report a bug**, or **Bug reports → Report a bug**.

Then:

1. **What went wrong?** One line: "The stage timer froze in Hall A".
2. **What were you doing, and what did you expect?** The steps, the room and the time.
3. **Screenshot** (optional): choose a picture, or press Print Screen and then **Ctrl+V** in the form. Up to 8 MB.
4. Open **What else is sent** to see exactly what goes with it: the version, the system, the page you were on and the browser.
5. **Send report**.

## For admins

**Console → Bug reports** lists open reports; the number in the sidebar is how many. Switch between **Open** and **All**.

Click a report to read it: what happened, the screenshot, the AT SUITE version and build, the server's system, the laptop app's version, the page and the browser. **Mark resolved** when it's fixed, or **Open again**.

### Send them to GitHub (optional)

Off until you set it up: reports stay on your server. To have reports open issues in a GitHub repository of yours:

1. Add the **Repository** (`owner/name`) and a fine-grained **GitHub token** with Issues: read and write.
2. Tick **Open an issue for every new report by itself**, or leave it off and press **Send to GitHub** on the reports you choose.
3. **Save**. It shows **Ready**.

The issue gets the title, what happened, and the version and system. Never names, your organisation, rooms, addresses or the screenshot, because repositories can be public.

> **Tip:** When you contact AT SUITE support about a bug, include the version from **Settings → About**.
