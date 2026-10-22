---
summary: Add accounts for techs, managers and admins, set or reset passwords, and choose how techs sign in.
audience: admins and managers
keywords: people, accounts, users, add tech, password, reset password, changeme, forgot password, sign in, username, role, deactivate
---
# People, roles and passwords

Everyone who signs in to AT SUITE has an account. Open **People** in the console (admins and managers).

![The People page: a row per account with username, name, role, site, an Active tick box and a New password field, and an empty row at the bottom to add someone](/static/kb/console-people.jpg)

## Add someone

1. In the empty row at the bottom, type a **username** (what they sign in with, like `amy`) and their **name** (what others see in chat, like *Amy Clarke*).
2. Pick their **role**: tech, manager, admin or viewer. See [Who can do what](/docs/roles-and-permissions). Managers can add techs and viewers; only admins can add managers and admins.
3. Pick a **site** if they should only see one venue, or leave *All sites*.
4. Type a first password, or leave it blank for `ChangeMe`.
5. Press **Add**.

They sign in with that password and have to choose their own straight away. `ChangeMe`, their username and the old password aren't accepted.

## Change someone

Edit their row and press **Save**. Untick **Active** to stop someone signing in without deleting their history; tick it again to let them back.

## Reset a password

Press **Reset password** on their row. Their password goes back to `ChangeMe`, they're signed out everywhere, and they choose a new one at their next sign-in.

## When someone presses "Forgot password?"

Every sign-in screen has **Forgot password?**. When someone uses it:

- Admins and managers get a pop-up in the console and a count on **People**. One press of **Reset password** sorts it.
- The screen gives the same answer for any username, so it can't be used to find out who has an account.
- An admin can make **Forgot** reset a tech's password to `ChangeMe` straight away: **Settings → General → Passwords**. An admin's or manager's password always waits for an admin.

## How techs sign in

New servers have **Techs sign in to their laptop with their own account and password** on (**Settings → General → Passwords**). Each tech signs in on the laptop's start screen with their username and password.

Servers set up before 1.0.10 may still have it off. Then techs just type their name on an enrolled laptop: quicker, but anyone at the laptop can type any name. Add everyone under **People** before you turn passwords on.

> **Tip:** A new tech starting tomorrow? Follow [A new tech starts tomorrow](/docs/scenario-new-tech).
