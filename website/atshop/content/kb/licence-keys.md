---
summary: Where to find your licence key, how to put it in, how renewals and the daily check-in work, and what happens when a key ends.
audience: admins
keywords: licence, license, key, renew, renewal, expiry, expired, grace, locked, check-in, offline key, plan, serial, not licensed
---
# Licence keys

AT SUITE needs a licence key to run. The key holds who it's licensed to, the plan, how many laptops can connect, and the date it ends. Once a day your server checks in with this website: that's how renewals arrive by themselves. Venues whose server has no internet can ask us for an offline key.

## Where to find your key

In [your account](/account), under **Licence key**: press **Copy key** or **Download .txt**. Each key is also emailed to you when it's made.

## Putting a key in

1. On your AT SUITE server, sign in as an admin.
2. Open **Licence**.
3. Paste the key into **Install a new key** and press **Install licence**.

![The Licence page: licensed to Grand Hall Events on the Venue plan, with its serial, dates and modules; limits on the right; the key itself below with Copy key and Remove licence; and a box to install a new key](/static/kb/console-licence.jpg)

The page shows who it's licensed to, the plan, serial, issue and end dates with days left, the modules, sites and laptops used against the limits, the daily check, and whether the signature checks out. Techs never see licence details, only a warning line while it runs out.

Nothing else changes: settings, rooms and data are kept. On a new install, paste it on the last page of the setup wizard. With managed hosting we put keys in for you.

## Renewals

When your subscription renews, your server fetches the new key by itself at its next daily check-in. It also appears in your account and arrives by email, in case you want to paste it in yourself. Each key runs 7 days past the paid period, so a renewal that's a little late never causes a problem.

## The daily check-in

Your server sends its key to this website once a day. Nothing else is sent: no names, chat, captions or audio. If it can't get through, everything keeps working; admins see a note after 2 days, and everyone in the last week. After 14 days without a check-in AT SUITE locks (never during a show) until it gets through again. **Licence → Check now** tries straight away.

If your venue's server can never reach the internet (strict NDA), [contact us](/contact) for an offline key. Offline keys don't check in, so they don't renew themselves: they run to a fixed date, usually a year.

## When a key ends

| When | What happens |
|---|---|
| 30 days before | Admins see a reminder (7 days before for keys that renew themselves) |
| 7 days before | Everyone sees a small reminder line |
| After it ends | 14 days of grace, with everything still working |
| After the grace | AT SUITE locks until a new key is pasted in. Only **Licence** works. Nothing is deleted |

It **never locks during a show**. The lock waits for a restart, or for 02:00 to 05:00 site time with no timer running and no captions live.

## Changing plan

A new plan gives you a new key with the new laptop limit. Paste it in the same way.
