// Console: the live pages (dashboard, chat, help, timers, captions), the venue (rooms, laptops,
// people, links) and the site (settings, licence, backups, audit log).
(async () => {
  const { esc, api, post, put, del, upload, guard, toast, when } = AT;
  const main = document.getElementById("main");
  let boot, sock, chat = null, view = null, helpOpen = 0, unreadTimer = null;

  await AT.branding();
  try { boot = await api("/api/bootstrap"); } catch (e) { return showLogin(); }
  // On a tech laptop the Admin button opens /?shared=1: an admin signs in over the tech's day.
  if (boot.me.kind === "node") { if (new URLSearchParams(location.search).has("shared")) return showLogin(); location.replace("/node"); return; }
  // The console is for admins and managers: everyone else works in the room workspace.
  const isAdminRole = boot.me.role === "admin", isManager = isAdminRole || boot.me.role === "manager";
  if (!isManager) { location.replace("/node"); return; }
  // Not licensed: admins get only the Licence page; everyone else sees the "not licensed" page.
  const locked = !!boot.licence_locked;
  if (locked && !isAdminRole) { location.replace("/node"); return; }
  if (locked && !location.hash.startsWith("#/licence")) location.replace("#/licence");
  // Admins open on the room workspace too, with the timer first. A #/page link (or the Console button there) opens the console.
  if (!locked && !location.hash && boot.rooms.length) { location.replace("/node"); return; }
  // The console's sections. A section with more than one tab shows them under its heading.
  // role: "manager" (managers and admins) or "admin" (admins only); mod: the module it needs.
  const SECTIONS = {
    reports: { title: "Show reports", role: "manager", tabs: { reports: ["Show reports", showReports] } },
    rooms: { title: "Rooms", role: "manager", tabs: { rooms: ["Rooms", admSites] } },
    laptops: { title: "Laptops & screens", mod: "fleet", tabs: { list: ["All laptops & screens", fleet], setup: ["Add laptops", admFleet, "admin"], overlays: ["Overlay laptops", admOverlays, "admin"] } },
    people: { title: "People", role: "manager", tabs: { people: ["People", admAccounts] } },
    links: { title: "Links", role: "manager", mod: "dashboard", tabs: { links: ["Links", admLinks] } },
    settings: { title: "Settings", role: "admin", tabs: { general: ["General", admGeneral], appearance: ["Look", admAppearance], chat: ["Chat", admChat], ai: ["AI helper", admAi], keys: ["API keys", admKeys], updates: ["Updates", admUpdates], info: ["About", admInfo] } },
    bugs: { title: "Bug reports", role: "admin", tabs: { bugs: ["Bug reports", admBugs] } },
    licence: { title: "Licence", role: "admin", tabs: { licence: ["Licence", admLicence] } },
    backups: { title: "Backups & restore", role: "admin", tabs: { backups: ["Backups", admData] } },
    audit: { title: "Audit log", role: "manager", tabs: { audit: ["Audit log", admAudit] } },
  };
  // Links into the old Admin page (#/admin/<tab>) and #/fleet still land in the right place.
  const OLD = { general: "settings/general", appearance: "settings/appearance", chat: "settings/chat", keys: "settings/keys", info: "settings/info",
    licence: "licence", sites: "rooms", accounts: "people", links: "links", fleet: "laptops/setup", overlays: "laptops/overlays",
    data: "backups", import: "backups", audit: "audit" };
  const MODNAMES = { comms: "Chat & help requests", timers: "Timers", fleet: "Laptops & screens", captions: "Captions", overlays: "Overlays", dashboard: "Dashboard & links", presenter: "Presenters" };
  const MODS = { dashboard: "dashboard", chat: "comms", help: "comms", timers: "timers", presenter: "presenter", captions: "captions" };
  const allowed = (role) => !role || (role === "admin" ? isAdminRole : isManager);
  function pageOn(name) {
    if (locked) return name === "licence";
    const s = SECTIONS[name];
    if (s) return allowed(s.role) && (!s.mod || boot.modules[s.mod] !== false);
    return !!MODS[name] && boot.modules[MODS[name]] !== false;
  }

  start();
  if (!locked) updateBadge();

  function showLogin() {
    document.getElementById("login").classList.remove("hidden");
    // Opened from a tech laptop: a short admin session that ends with the browser.
    const shared = new URLSearchParams(location.search).has("shared");
    if (shared) document.getElementById("loginErr").insertAdjacentHTML("beforebegin", '<p class="muted small">Admins only. On this laptop you are signed out after 30 minutes, or when the browser closes.</p>');
    const f = document.getElementById("loginForm"), pw = AT.passwordForm(f, document.getElementById("loginErr"));
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await post("/api/auth/login", { username: f.username.value, password: f.password.value, shared, ...pw.extra() });
        const me = await api("/api/auth/me").catch(() => null);
        if (me && !["admin", "manager"].includes(me.role)) { await post("/api/auth/logout"); throw new Error("The console is for admins and managers. Techs use the workspace on their laptop."); }
        location.reload();
      } catch (ex) { if (!pw.handle(ex)) document.getElementById("loginErr").textContent = ex.message; }
    };
  }

  function topics() {
    return [...boot.sites.map((s) => `site:${s.id}`), ...boot.rooms.map((r) => `room:${r.id}`), `dm:${boot.me.id}`, "fleet",
      ...boot.rooms.map((r) => `timer:${r.id}`), ...boot.rooms.map((r) => `captions:${r.id}`), ...(boot.modules.presenter ? ["presenter"] : []), ...(isManager ? ["managers"] : []), ...(isAdminRole ? ["admins"] : [])];
  }

  function start() {
    document.getElementById("shell").classList.remove("hidden");
    document.getElementById("meName").textContent = boot.me.name;
    if (boot.branding.logo_url) { const l = document.getElementById("logo"); l.src = boot.branding.logo_url; l.classList.remove("hidden"); }
    // Each side bar link shows when its page is open to this person; a group heading shows when any of its links do.
    document.querySelectorAll("#nav a[href^='#/']").forEach((a) => a.classList.toggle("hidden", !pageOn(a.getAttribute("href").slice(2))));
    document.querySelectorAll("#nav .navh").forEach((h) => {
      let n = h.nextElementSibling, any = false;
      for (; n && n.tagName === "A"; n = n.nextElementSibling) any ||= !n.classList.contains("hidden");
      h.classList.toggle("hidden", !any);
    });
    document.getElementById("logout").onclick = async (e) => { e.preventDefault(); await post("/api/auth/logout"); location.reload(); };
    window.addEventListener("hashchange", route);
    if (!locked) {
      sock = AT.socket(topics(), onEvent);
      if (boot.modules.comms) { refreshHelpCount(); refreshUnread(); }
      if (isManager) setResets(boot.reset_asks || []);
      if (isAdminRole) refreshBugs();
    }
    route();
  }

  // People in the side bar shows how many are waiting for a password reset.
  function setResets(asks) { const u = document.getElementById("resetCount"); u.textContent = asks.length; u.classList.toggle("hidden", !asks.length); }
  function refreshResets() { if (isManager) api("/api/bootstrap").then((b) => { boot.reset_asks = b.reset_asks; setResets(b.reset_asks || []); }).catch(() => {}); }

  // Bug reports in the side bar shows how many are still open (admins only).
  function refreshBugs() {
    api("/api/admin/bugs?status=open").then((d) => { const u = document.getElementById("bugCount"); u.textContent = d.open; u.classList.toggle("hidden", !d.open); }).catch(() => {});
  }

  // The Chat badge in the side bar, on every page (the Chat page keeps it up to date while it's open).
  function setUnread(n) { const u = document.getElementById("unreadAll"); u.textContent = n > 99 ? "99+" : n; u.classList.toggle("hidden", !n); }
  function refreshUnread() {
    clearTimeout(unreadTimer);
    unreadTimer = setTimeout(() => api("/api/comms/channels").then((cs) => { if (!chat) setUnread(cs.reduce((a, c) => a + (c.unread || 0), 0)); }).catch(() => {}), 300);
  }

  function onEvent(evt) {
    if (chat) chat.onEvent(evt);
    else if (evt.type === "message.new" || evt.type === "message.deleted") refreshUnread();
    if (evt.type === "help.new") { toast(`Help needed in ${evt.data.room_name}: ${evt.data.description || evt.data.category}`, "bad"); refreshHelpCount(); }
    if (evt.type === "help.escalated") { toast(`Still no answer: help in ${evt.data.room_name} (${Math.max(1, Math.round((evt.data.waited_s || 0) / 60))} min). ${evt.data.description || evt.data.category}`, "bad"); refreshHelpCount(); }
    if (evt.type === "help.updated") refreshHelpCount();
    if (evt.type === "bug.new") { if (evt.data.reporter !== boot.me.name) toast(`Bug report from ${evt.data.reporter}${evt.data.room_name ? ` in ${evt.data.room_name}` : ""}: ${evt.data.title}`); refreshBugs(); }
    if (evt.type === "bug.updated") refreshBugs();
    if (evt.type === "rooms.changed") api("/api/bootstrap").then((b) => { boot = b; });
    if (evt.type === "account.reset") {
      const d = evt.data;
      if (!d.done) toast(`${d.name} forgot their password. Reset it under People.`, "bad");
      else if (d.by !== boot.me.name) toast(d.by ? `${d.by} reset ${d.name}'s password to ChangeMe` : `${d.name}'s password was reset to ChangeMe (they asked)`);
      refreshResets();
    }
    view && view.onEvent && view.onEvent(evt);
  }

  // Admins see on the Settings link when a new version is out and waits for them (Tell me only).
  async function updateBadge() {
    const link = document.querySelector('.side a[href="#/settings"]');
    if (!isAdminRole || !link) return;
    const u = await api("/api/admin/updates").catch(() => null);
    link.querySelector(".upd-pill")?.remove();
    if (u && u.available && !u.requested && u.mode !== "auto") {
      link.insertAdjacentHTML("beforeend", ` <span class="unread upd-pill" title="AT-SUITE ${esc(u.latest.version)} is out">update</span>`);
      link.href = "#/settings/updates";
    }
  }

  async function refreshHelpCount() {
    const open = (await api("/api/comms/help?status=open")).length;
    helpOpen = open;
    const el = document.getElementById("helpCount");
    el.textContent = open; el.classList.toggle("hidden", !open);
    el.parentElement.classList.toggle("help-alarm", !!open);
  }

  function section(name, el, sub) {
    const s = SECTIONS[name];
    const tabs = Object.entries(s.tabs).filter(([, t]) => allowed(t[2]));
    const [key, [, fn]] = tabs.find(([k]) => k === sub) || tabs[0];
    el.innerHTML = `<h1>${esc(s.title)}</h1>` + (tabs.length > 1 ? `<div class="tabs sect">${tabs.map(([k, [label]]) => `<a class="btn${k === key ? " on" : ""}" href="#/${name}/${k}">${esc(label)}</a>`).join("")}</div>` : "") + '<div id="adm"></div>';
    return fn(el.querySelector("#adm"));
  }

  function route() {
    const [, name = "dashboard", sub] = location.hash.split("/");
    if (name === "admin") return location.replace(`#/${OLD[sub] || (isAdminRole ? "settings" : "rooms")}`);
    if (name === "fleet") return location.replace("#/laptops");
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#/${name}`));
    chat = null; view = null;
    if (boot.modules.comms && !locked) refreshUnread();
    const n = boot.licence_notice;
    const banner = locked ? '<div class="banner bad">AT-SUITE isn\'t licensed, so everything but this page is stopped. Paste the licence key below; nothing has been deleted.</div>'
      : n ? `<div class="banner${n.level === "bad" ? " bad" : ""}">${esc(n.text)}${n.admin && name !== "licence" ? ' <a href="#/licence">Open Licence</a>' : ""}</div>` : "";
    main.innerHTML = banner + '<div id="view"></div>';
    const el = document.getElementById("view");
    const presenter = (el, sub) => { view = PresenterPage.mount(el, sub, boot); };
    const views = { dashboard, chat: chatView, help, timers, presenter, captions };
    // A page that is turned off or not open to this person opens the first one that is, never a blank page.
    const pages = [...Object.keys(views), ...Object.keys(SECTIONS)];
    const page = pages.includes(name) && pageOn(name) ? name : pages.find(pageOn);
    Promise.resolve().then(() => views[page] ? views[page](el, sub) : section(page, el, sub)).catch((e) => {
      el.innerHTML = `<div class="panel"><h2>This page didn't load</h2><p class="muted">${esc(e.message || e)}</p><button class="primary" onclick="location.reload()">Try again</button></div>`;
    });
  }

  const linkHost = (u) => { try { return new URL(u, location.href).host; } catch (_) { return u; } };
  const roomName = (id) => boot.rooms.find((r) => r.id === id)?.name || "";
  const roomOptions = (sel, blank = "No room") => `<option value="">${blank}</option>` + boot.rooms.map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.name)}</option>`).join("");

  // ------------------------------------------------------ pre-show check --
  // Every tech laptop, screen and caption mic, room by room: green when it's ready, amber when
  // something wants a look, red when it isn't working. Refreshes every few seconds.
  function preshow(box) {
    const KIND = { laptop: "Laptop", screen: "Screen", source: "Caption source", mic: "Captions" };
    const label = (i) => i.kind === "laptop" ? ({ main: "Main PC", backup: "Backup PC" }[i.mode] || "Laptop") : KIND[i.kind];
    const item = (i) => `<div class="pre ${esc(i.state)}"><span class="dot"></span><span class="grow"><b>${esc(i.name)}</b> <span class="muted small">${esc(label(i))}</span><div class="small what">${esc(i.detail)}</div></span></div>`;
    const draw = async () => {
      if (!box.isConnected) return clearInterval(tick);
      const d = await api("/api/preshow").catch(() => null);
      if (!d) return;
      const n = d.counts, cards = d.rooms.map((r) => `<div class="pre-room"><h3>${esc(r.name)}</h3>${r.items.map(item).join("") || '<p class="muted small">Nothing in this room yet.</p>'}</div>`);
      if (d.unplaced.length) cards.push(`<div class="pre-room"><h3>Not in a room</h3>${d.unplaced.map(item).join("")}</div>`);
      const all = n.good + n.warn + n.bad;
      box.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">Pre-show check</h2>
        <span class="pre-sum">${all ? `<span class="pill good">${n.good} ready</span>${n.warn ? `<span class="pill warn">${n.warn} to check</span>` : ""}${n.bad ? `<span class="pill bad">${n.bad} not working</span>` : ""}` : ""}<span class="muted small">checked ${new Date(d.checked_at * 1000).toLocaleTimeString()}</span></span></div>
        ${all || d.unplaced.length ? `<div class="grid" style="margin-top:.6rem">${cards.join("")}</div>` : '<p class="muted small">No laptops, screens or caption mics yet. Add them in Laptops &amp; screens.</p>'}`;
    };
    const tick = setInterval(draw, 5000);
    draw();
  }

  // -------------------------------------------------------- show reports --
  // After a show: each room's timer runs, help calls, stage messages and caption transcript as a
  // PDF for the client, or the full venue's in one. Each morning the day before is kept for every
  // room that had a show, and for the venue.
  async function showReports(a) {
    const list = await api("/api/reports");
    const site = boot.sites[0]?.id, today = list.today[site] || new Date().toISOString().slice(0, 10);
    const siteName = Object.fromEntries(boot.sites.map((x) => [x.id, x.name]));
    const many = boot.sites.length > 1;
    const venueLabel = (id) => many ? `Full venue: ${siteName[id] || "venue"}` : "Full venue";
    a.innerHTML = `<div class="panel"><h2>Make a report</h2>
        <p class="small muted" style="margin-top:0">A show day runs from 05:00 to 05:00 the next morning. Today's report shows what has happened so far. Reports download as PDF.</p>
        <div class="row" style="flex-wrap:wrap;align-items:flex-end">
          <span><label for="rRoom">Report for</label><select id="rRoom">
            <optgroup label="The whole venue">${boot.sites.map((x) => `<option value="venue:${x.id}">${esc(venueLabel(x.id))}</option>`).join("")}</optgroup>
            <optgroup label="One room">${boot.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</optgroup></select></span>
          <span><label for="rDay">Day</label><input id="rDay" type="date" value="${esc(today)}" max="${esc(today)}"></span>
          <label style="margin-bottom:.5rem"><input type="checkbox" id="rChat" style="width:auto"> Include the crew's chat messages</label>
        </div>
        <div id="rSum" class="small" role="status" style="margin:.6rem 0"></div>
        <div class="row"><button class="primary" id="rOpen">Download PDF</button><button id="rKeep">Keep a copy</button></div></div>
      <div class="panel" style="margin-top:1rem"><h2>Kept reports</h2>
        <p class="small muted" style="margin-top:0">Made by themselves each morning for the venue and every room that had a show the day before (the timer ran, a help call, a stage message or captions).</p>
        ${list.reports.length ? `<table><tr><th>Day</th><th>Report</th><th>Made</th><th><span class="sr-only">Actions</span></th></tr>${list.reports.map((r) => `<tr><td>${esc(r.day)}</td><td>${r.venue ? `<b>${esc(venueLabel(r.site_id))}</b>` : esc(r.room_name)}</td><td class="small muted">${when(r.created_at)}</td>
          <td class="row"><a class="btn small" href="/api/reports/saved/${r.id}.pdf" download>Download PDF</a><button class="small danger" data-rm="${r.id}">Delete</button></td></tr>`).join("")}</table>` : '<p class="muted">None yet.</p>'}</div>`;
    const q = () => `day=${encodeURIComponent(a.querySelector("#rDay").value)}`, pick = () => a.querySelector("#rRoom").value;
    // Where a report's figures, PDF and Keep live: a room's, or the venue's.
    const base = () => pick().startsWith("venue:") ? `/api/reports/venue/${pick().slice(6)}` : `/api/reports/${pick()}`;
    const summary = async () => {
      const box = a.querySelector("#rSum");
      if (!pick()) { box.textContent = "Add a room first."; return; }
      try {
        const d = await api(`${base()}?${q()}`), s = d.summary;
        const mins = (ms) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
        box.innerHTML = [d.rooms ? `<b>${s.rooms_with_show}</b> of ${s.rooms} room${s.rooms === 1 ? "" : "s"} had a show` : "",
          `<b>${s.runs}</b> timer run${s.runs === 1 ? "" : "s"}`, s.over ? `<span style="color:var(--bad-ink)"><b>${s.over}</b> ran over (${mins(s.over_ms)} in all)</span>` : "nothing ran over",
          `<b>${s.help}</b> help call${s.help === 1 ? "" : "s"}${s.escalated ? ` (${s.escalated} with no answer at first)` : ""}`, `<b>${s.stage_messages}</b> stage message${s.stage_messages === 1 ? "" : "s"}`,
          `<b>${s.crew_messages}</b> chat message${s.crew_messages === 1 ? "" : "s"}`, s.captions_s ? `captions live ${Math.round(s.captions_s / 60)} min, ${s.transcript_lines} transcript lines` : "no captions"]
          .filter(Boolean).join(" · ");
      } catch (e) { box.textContent = e.message; }
    };
    a.querySelector("#rRoom").onchange = summary; a.querySelector("#rDay").onchange = summary;
    a.querySelector("#rOpen").onclick = () => {
      if (!pick()) return;
      const link = document.createElement("a");
      link.href = `${base()}/pdf?${q()}${a.querySelector("#rChat").checked ? "&chat=1" : ""}`;
      link.download = "";
      document.body.append(link); link.click(); link.remove();
    };
    a.querySelector("#rKeep").onclick = () => pick() && guard(() => post(`${base()}/save?${q()}`)).then((r) => { if (r) { toast("Kept. It's in the list below.", "good"); showReports(a); } });
    a.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => confirm("Delete this kept report? You can make it again while the day's records are still on the server.") && guard(() => del(`/api/reports/saved/${b.dataset.rm}`)).then(() => showReports(a)));
    summary();
  }

  // ---------------------------------------------------------- dashboard --
  async function dashboard(el) {
    const links = await api("/api/dashboard/links");
    const groups = {};
    for (const l of links) {
      const key = l.board === "admin" ? "Admin" : l.room ? l.room : ({ device: "Devices", tool: "Tools", buttons: "Buttons", timer: "Timers" }[l.kind] || "Links");
      (groups[key] ||= []).push(l);
    }
    // The rooms first: every room's timer, live. The tech workspace has the controls, captions and chat dock.
    const live = {};
    const rooms = boot.modules.timers ? boot.rooms : [];
    for (const r of rooms) live[r.id] = await api(`/api/timers/${r.id}`).catch(() => null);
    const strip = rooms.length ? `<div class="row" style="justify-content:space-between"><h1>Dashboard</h1><span class="row"><a class="btn primary" href="/node">Open the workspace</a>${boot.me.role === "admin" ? '<a class="btn" href="#/links">Edit links</a>' : ""}</span></div>
      <div class="grid" id="dashRooms" style="margin-top:.6rem">${rooms.map((r) => `<div class="panel" data-room="${r.id}"><div class="row" style="justify-content:space-between"><h2>${esc(r.name)}</h2><span class="small"><a href="/timer/${r.id}" target="_blank">Standard ↗</a></span></div>
        <div class="clock" style="font-size:2.6rem">--:--</div><div class="small now" style="font-weight:600"></div><div class="muted small next"></div></div>`).join("")}</div>` : "";
    const pre = '<div class="panel" id="preshow" style="margin-top:.6rem"><p class="muted small">Checking every laptop, screen and caption mic…</p></div>';
    el.innerHTML = (strip ? strip.replace('<div class="grid" id="dashRooms"', pre + '<div class="grid" id="dashRooms"') : `<div class="row" style="justify-content:space-between"><h1>Dashboard</h1>${boot.me.role === "admin" ? '<a class="btn" href="#/links">Edit links</a>' : ""}</div>` + pre) + (strip ? '<h2 style="margin-top:1.4rem">Links</h2>' : "") +
      (links.length ? Object.entries(groups).map(([g, ls]) => `<h3 class="lk-head">${esc(g)}</h3><div class="lk-grid">` +
        ls.map((l) => `<a class="lk" href="${esc(l.url)}" target="_blank" rel="noopener">${Chat.avatar(l.label)}<span class="lk-txt"><b>${esc(l.label)}</b><span>${esc(linkHost(l.url))}</span></span><span class="dot" data-ping="${l.id}"></span></a>`).join("") + "</div>").join("")
        : '<p class="muted">No links yet. Admins add them in Links.</p>');
    const dash = el.querySelector("#dashRooms");
    if (dash) {
      const tick = setInterval(() => {
        if (!document.body.contains(dash)) return clearInterval(tick);
        for (const [id, st] of Object.entries(live)) {
          const card = dash.querySelector(`[data-room="${id}"]`); if (!card || !st) continue;
          const d = AT.timerDisplay(st), c = card.querySelector(".clock");
          c.textContent = d.text; c.className = "clock " + d.cls + (d.blink ? " blink" : "");
          card.querySelector(".now").textContent = (st.cue?.cue ? st.cue.cue + " · " : "") + (st.title || "") + (st.playback === "pause" ? " (paused)" : "");
          card.querySelector(".next").textContent = (st.next ? `Next: ${st.next.title}` : "") + (st.message_visible ? `  ·  On stage: ${st.message}` : "");
        }
      }, 250);
      view = { onEvent: (e) => { if (e.type === "timer" && e.data?.room_id in live) live[e.data.room_id] = e.data; } };
    }
    preshow(el.querySelector("#preshow"));
    try {
      const ping = await api("/api/dashboard/ping");
      el.querySelectorAll("[data-ping]").forEach((d) => d.classList.add(ping[d.dataset.ping] ? "on" : "off"));
    } catch (_) {}
  }

  // --------------------------------------------------------------- chat --
  function chatView(el) {
    chat = Chat.mount(el, { me: boot.me, onUnread: setUnread });
  }

  // --------------------------------------------------------------- help --
  // Help calls on the left as cards, and the chat of the room the picked one came from on the right,
  // so an admin answers the tech straight from here ("Swap to the spare mic, on my way").
  async function help(el) {
    let rows = [], pick = null, filter = "live", roomChat = null, chans = null;
    el.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Help requests</h1></div>
      <div class="helpdesk"><div class="hd-left"><div class="hd-filter" role="tablist">
        <button type="button" class="chip" data-f="live">Open</button><button type="button" class="chip" data-f="all">All</button></div>
        <div class="hc-list"></div></div>
        <div class="hd-chat"><div class="chat-mount"></div></div></div>`;
    const listEl = el.querySelector(".hc-list"), chatEl = el.querySelector(".chat-mount");
    const draw = () => {
      el.querySelectorAll("[data-f]").forEach((b) => { b.classList.toggle("on", b.dataset.f === filter); b.setAttribute("aria-selected", String(b.dataset.f === filter)); });
      const shown = rows.filter((h) => filter === "all" || h.status !== "resolved");
      listEl.innerHTML = shown.map((h) => HelpCards.card(h, { active: h.id === pick?.id })).join("") ||
        `<p class="muted">${filter === "all" ? "No help calls yet." : "No open help calls. 🎉"}</p>`;
      HelpCards.wire(listEl, rows, { onReply: (h) => openChat(h), onPick: (h) => openChat(h) });
    };
    async function openChat(h) {
      pick = h; draw();
      chans ||= await api("/api/comms/channels");
      const ch = chans.find((c) => c.kind === "room" && c.room_id === h.room_id);
      if (!ch) { chatEl.innerHTML = '<p class="muted" style="padding:1rem">This room has no chat.</p>'; roomChat = null; return; }
      roomChat = Chat.mount(chatEl, { me: boot.me, channel: ch.id, quiet: true });
      setTimeout(() => chatEl.querySelector("textarea")?.focus(), 50);
    }
    el.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
    const load = async () => {
      rows = await api("/api/comms/help");
      if (pick) pick = rows.find((h) => h.id === pick.id) || pick;
      draw();
    };
    view = { onEvent: (e) => { if (e.type.startsWith("help.")) load(); roomChat && roomChat.onEvent(e); } };
    await load();
    const first = rows.find((h) => h.status === "open") || rows.find((h) => h.status !== "resolved") || rows[0];
    if (first) openChat(first);
    else chatEl.innerHTML = '<div class="chat-empty" style="padding:2rem"><p class="muted">Pick a help call to answer the tech in their room\'s chat.</p></div>';
  }

  // ------------------------------------------------------------- timers --
  // The quick messages: one per line, saved on the server for every room until changed again.
  async function quickMessages(box) {
    const r = await api("/api/timers-quick-messages").catch(() => null);
    if (!r) { box.innerHTML = '<p class="muted small">Couldn\'t load the quick messages.</p>'; return; }
    box.innerHTML = `<label>Quick messages, one per line</label><textarea data-qm rows="10" style="min-height:12rem">${esc(r.messages.join("\n"))}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:.5rem"><button data-qmreset>Back to the defaults</button><button class="primary" data-qmsave>Save messages</button></div>`;
    const save = box.querySelector("[data-qmsave]");
    save.onclick = () => AT.busy(save, guard(() => put("/api/timers-quick-messages", { messages: box.querySelector("[data-qm]").value.split("\n") })))
      .then((x) => { if (x) { box.querySelector("[data-qm]").value = x.messages.join("\n"); toast(`${x.messages.length} quick messages saved`, "good"); } }, () => {});
    box.querySelector("[data-qmreset]").onclick = async () => {
      if (!(await AT.ask("Put the quick messages back to the defaults? The ones saved now are replaced.", { yes: "Back to the defaults" }))) return;
      guard(() => del("/api/timers-quick-messages")).then((x) => { box.querySelector("[data-qm]").value = x.messages.join("\n"); toast("Quick messages are back to the defaults", "good"); }, () => {});
    };
  }

  // Live: every room's timer. Screens: what each remote screen shows. Quick messages: the ready-made
  // stage messages. Views: every timer view, with a preview. Layout designer: make your own views (layoutdesigner.js).
  let timersEdit = null; // the designed view to open in the layout designer
  async function timers(el, sub) {
    const TABS = { live: "Live", screens: "Screens", messages: "Quick messages", views: "Views", designer: "Layout designer" };
    if (boot.modules.fleet === false) delete TABS.screens;
    const tab = TABS[sub] ? sub : "live";
    el.innerHTML = `<h1>Timers</h1><div class="tabs sect">${Object.entries(TABS).map(([k, l]) => `<a class="btn${k === tab ? " on" : ""}" href="#/timers/${k}">${esc(l)}</a>`).join("")}</div><div id="tpage"></div>`;
    const page = el.querySelector("#tpage"), isAdmin = boot.me.role === "admin";
    const views = await api("/api/timers-views?screens=1");
    const urlFor = (roomId, v) => v.startsWith("view:") ? `/room/${roomId}/external/${encodeURIComponent(v.slice(5))}/` : `/timer/${roomId}?view=${encodeURIComponent(v)}`;
    const states = {};
    let pending = null;
    view = { onEvent: (e) => {
      if (e.type === "timer") states[e.data.room_id] = e.data;
      if (tab === "screens" && e.topic === "fleet" && !pending) pending = setTimeout(() => { pending = null; renderScreens(); }, 1500);
    } };

    if (tab === "live") {
      // Preview only: techs run timers and cue lists from their workspace.
      page.innerHTML = `<p class="muted">Live preview of every room. Techs run the timer and cue list from their workspace; Companion can drive them with an API key.</p><div class="grid" id="tg"></div>`;
      const grid = page.querySelector("#tg");
      for (const r of boot.rooms) {
        states[r.id] = await api(`/api/timers/${r.id}`);
        grid.insertAdjacentHTML("beforeend", `<div class="panel" data-room="${r.id}">
          <div class="row" style="justify-content:space-between"><h2>${esc(r.name)}</h2><select class="tviews" data-room-views="${r.id}" aria-label="Open a timer view for ${esc(r.name)} in a new window" style="width:auto;padding:.15rem .3rem;font-size:.85rem"><option value="">Timer views ↗</option></select></div>
          <div class="clock" style="font-size:2.6rem">--:--</div><div class="small now" style="font-weight:600"></div><div class="muted small next"></div></div>`);
      }
      if (!boot.rooms.length) grid.innerHTML = '<p class="muted">No rooms yet. Add them under Rooms.</p>';
      grid.querySelectorAll("[data-room-views]").forEach((sel) => {
        const rid = sel.dataset.roomViews;
        sel.insertAdjacentHTML("beforeend", views.filter((v) => !v.test).map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join(""));
        sel.onchange = () => { const v = sel.value; sel.value = ""; if (v) open(urlFor(rid, v), "_blank"); };
      });
      const tick = setInterval(() => {
        if (!document.body.contains(grid)) return clearInterval(tick);
        for (const [id, s] of Object.entries(states)) {
          const card = grid.querySelector(`[data-room="${id}"]`); if (!card) continue;
          const d = AT.timerDisplay(s), c = card.querySelector(".clock");
          c.textContent = d.text; c.className = "clock " + d.cls + (d.blink ? " blink" : "");
          card.querySelector(".now").textContent = (s.cue?.cue ? s.cue.cue + " · " : "") + (s.title || "") + (s.playback === "pause" ? " (paused)" : "");
          card.querySelector(".next").textContent = (s.next ? `Next: ${s.next.title}` : "") + (s.message_visible ? `  ·  On stage: ${s.message}` : "");
        }
      }, 200);
      return;
    }

    if (tab === "designer") {
      page.innerHTML = '<div id="designer"></div>';
      const slug = timersEdit; timersEdit = null;
      const d = LayoutDesigner.mount(page.querySelector("#designer"), { boot, slug, onSaved: () => {} });
      view.leaving = () => d.isDirty();
      return;
    }

    if (tab === "messages") {
      page.innerHTML = `<p class="muted small">The ready-made messages techs tap to put on stage, in every room's workspace.</p><div class="panel" id="qmsgs"></div>`;
      return quickMessages(page.querySelector("#qmsgs"));
    }

    if (tab === "screens") {
      page.innerHTML = `<p class="muted small">Pick what each remote screen shows. A screen can also choose for itself: tap its top-left corner 5 times. Views made in the Layout designer show here as soon as they're saved.</p><div class="panel" id="screens"></div>`;
      return renderScreens();
    }

    // ---- Views: every view a screen can show, with a preview
    const viewOpts = (sel) => [...views, { id: "captions", name: "Captions" }].map((v) => `<option value="${esc(v.id)}" ${v.id === sel ? "selected" : ""}>${esc(v.name)}</option>`).join("");
    return renderViews();

    async function renderScreens() {
      const box = page.querySelector("#screens");
      if (!box) return;
      const viewOpts = (sel) => [...views, { id: "captions", name: "Captions" }].map((v) => `<option value="${esc(v.id)}" ${v.id === sel ? "selected" : ""}>${esc(v.name)}</option>`).join("");
      const [all, rel] = await Promise.all([api("/api/fleet/nodes"), api("/api/fleet/screen-agent").catch(() => ({}))]);
      const screens = all.filter((n) => n.kind === "kiosk");
      const agentVer = (n) => n.info?.agent || "";
      const status = (n) => {
        const v = agentVer(n);
        if (!v) return `<span class="muted">${n.legacy ? esc(n.version) || "old agent" : "browser only"}</span>`;
        return rel.version && v !== rel.version ? `${esc(v)} <span class="pill warn">update to ${esc(rel.version)}</span>` : `${esc(v)} <span class="pill good">up to date</span>`;
      };
      const output = (n) => (n.info?.showing_on || []).map((o) => /^(eDP|LVDS|DSI)/i.test(o) ? "built-in screen" : esc(o)).join(", ");
      box.innerHTML = `<table><tr><th></th><th>Screen</th><th>Address</th><th>Room</th><th>Shows</th><th>Agent</th><th>Last seen</th><th></th></tr>
        ${screens.map((n) => `<tr data-n="${n.id}"><td><span class="dot ${n.online ? "on" : "off"}"></span></td><td><b>${esc(n.name)}</b>${n.legacy ? ' <span class="pill">old agent</span>' : ""}<div class="muted small" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(n.current_url)}">${esc(n.current_url)}</div>${output(n) ? `<div class="muted small">On ${output(n)}</div>` : ""}</td>
          <td class="small">${esc(n.ip)}</td>
          <td><select data-room style="width:auto">${roomOptions(n.room_id, "Choose…")}</select></td>
          <td>${n.legacy ? '<span class="muted small">use Set screen in Nodes</span>' : `<select data-view style="width:auto"><option value="">Choose…</option>${viewOpts(n.screen_view)}<option value="__url" ${(n.screen_view || "").startsWith("url:") ? "selected" : ""}>Web page…</option></select>`}</td>
          <td class="small">${status(n)}</td>
          <td class="small">${n.last_seen ? when(new Date(n.last_seen * 1000).toISOString()) : "never"}</td>
          <td class="row" style="flex-wrap:nowrap"><button class="small" data-ident>Identify</button>${agentVer(n) ? `<button class="small" data-cmd="restart_browser" title="Restart the browser on this screen">Restart</button>${isAdmin ? '<button class="small" data-cmd="update" title="Update the screen agent now">Update</button>' : ""}` : `<button class="small" data-cmd="reload">Reload</button>`}${isAdmin ? '<button class="small" data-cmd="reboot">Reboot</button>' : ""}</td></tr>`).join("") || '<tr><td colspan="8" class="muted">No screens yet. Install the screen agent on a Linux laptop or all-in-one (Laptops & screens → Add laptops).</td></tr>'}</table>`;
      box.querySelectorAll("[data-n]").forEach((row) => {
        const id = +row.dataset.n, n = screens.find((x) => x.id === id);
        const save = () => {
          const room = row.querySelector("[data-room]").value, v = row.querySelector("[data-view]");
          if (!v) return guard(() => put(`/api/fleet/nodes/${id}`, { room_id: room ? +room : null }));
          let view = v.value;
          if (view === "__url") {
            const url = prompt(`Web page for ${n.name} (http:// or https://)`, (n.screen_view || "").startsWith("url:") ? n.screen_view.slice(4) : "https://");
            if (!url || !/^https?:\/\//.test(url.trim())) return renderScreens();
            view = "url:" + url.trim();
          }
          if (!view || (!room && !view.startsWith("url:"))) { toast(view ? "Pick the room this screen is in" : "Pick what this screen shows", "bad"); return; }
          guard(() => put(`/api/fleet/nodes/${id}/screen`, { room_id: room ? +room : null, view })).then(() => toast("Screen updated", "good"), () => renderScreens());
        };
        row.querySelector("[data-room]").onchange = save;
        row.querySelector("[data-view]") && (row.querySelector("[data-view]").onchange = save);
        row.querySelectorAll("[data-cmd]").forEach((b) => b.onclick = () => (b.dataset.cmd !== "reboot" || confirm(`Reboot ${n.name}?`)) && guard(() => post(`/api/fleet/nodes/${id}/command`, { kind: b.dataset.cmd })).then(() => toast("Sent", "good")));
        row.querySelector("[data-ident]").onclick = () => guard(() => post(`/api/fleet/nodes/${id}/command`, { kind: "identify" })).then(() => toast("The screen shows its name for 10 seconds", "good"));
      });
    }

    async function renderViews() {
      const builtins = views.filter((v) => v.builtin && !v.test), custom = views.filter((v) => !v.builtin && !v.design);
      const [designs, hcc] = await Promise.all([api("/api/timers-designs"), api("/api/timers-views/look/hcc")]);
      const looks = Object.fromEntries(await Promise.all([...builtins, ...custom].map((v) => api(`/api/timers-views/look/${encodeURIComponent(v.id)}`).then((l) => [v.id, l]).catch(() => [v.id, null]))));
      const ABOUT = { hcc: "Logo top left, a big timer, the second line, the status bar and the progress bar. The view for the stage screens across the site.",
        minimal: "Just the numbers.", clock: "The time of day.", backstage: "A studio clock with the running order.",
        preview: "For the speaker's own screen: the clock and help calls.", overlay: "See-through, for a small window on a laptop or a bar across a screen." };
      const sbar = (id) => `<label class="row small" style="margin:0;gap:.3rem;font-weight:400"><input type="checkbox" data-sbar="${esc(id)}" style="width:auto" ${looks[id]?.options?.status_bar ? "checked" : ""} ${isAdmin ? "" : "disabled"}>Status bar</label>`;
      const pv = (id) => `<button class="small" data-pv="${esc(id)}">Preview</button>`;
      // Standard shows the site's logo (Settings → General), or nothing when there isn't one.
      const siteLogo = hcc.logos.top || hcc.site_logo;
      const extra = { hcc: siteLogo ? `<div class="row small" style="gap:.4rem"><span style="min-width:6.5rem">Logo</span><img src="${esc(siteLogo)}" alt="" style="height:28px;max-width:140px;object-fit:contain;background:#555;border-radius:4px"></div>` : "" };
      page.innerHTML = `
        <div class="panel" style="margin-bottom:1rem"><div class="row"><h2 style="margin:0">Preview</h2>
            <select data-pvview aria-label="View to preview" style="width:auto">${views.filter((v) => !v.test).map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")}</select>
            <select data-pvroom aria-label="Room to preview" style="width:auto">${boot.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select>
            <span class="grow"></span><a class="btn small" data-pvopen target="_blank" rel="noopener">Open full screen ↗</a></div>
          ${boot.rooms.length ? '<div class="tv-preview" style="margin-top:.6rem"><iframe title="Preview of the timer view" tabindex="-1"></iframe></div>' : '<p class="muted small">Add a room to preview the views.</p>'}</div>
        <h2>Built in</h2>
        <div class="panel"><table>${builtins.map((v) => `<tr><td style="width:15rem"><b>${esc(v.name)}</b><div class="small muted">${esc(ABOUT[v.id] || "")}</div></td>
          <td>${extra[v.id] || ""}</td><td style="width:7rem">${v.id === "clock" || v.id === "overlay" ? "" : sbar(v.id)}</td><td style="width:6rem">${pv(v.id)}</td></tr>`).join("")}</table>
          <p class="small muted" style="margin:.6rem 0 0">They all turn red at danger, flash with Blink, show the stage message over the timer and go black with Blackout. Add <code>?status=0</code> or <code>?status=1</code> to a screen's address to turn its status bar off or on there.</p></div>
        <div class="row" style="justify-content:space-between;margin-top:1.4rem"><h2 style="margin:0">Your layouts</h2>${isAdmin ? '<a class="btn small primary" href="#/timers/designer" data-newlayout>New layout</a>' : ""}</div>
        <div class="panel" style="margin-top:.6rem"><table>${designs.map((d) => `<tr><td><b>${esc(d.name)}</b>${d.design.layout ? "" : ' <span class="pill">older view</span>'}</td>
          <td style="width:16rem;text-align:right">${pv(d.id)} ${isAdmin ? `<button class="small" data-edit="${esc(d.slug)}">Edit</button> <button class="small danger" data-deldesign="${esc(d.slug)}">Remove</button>` : ""}</td></tr>`).join("") ||
          '<tr><td class="muted small">None yet. Make one in the Layout designer: place the timer, title, clock, logo and more wherever you want them.</td></tr>'}</table></div>
        <h2 style="margin-top:1.4rem">Uploaded views</h2>
        <div class="panel"><p class="small muted" style="margin-top:0">Custom views made for Ontime work as they are: upload the view's folder as a .zip (with index.html), or a single .html file. They get the room's live timer through Ontime's own websocket and data addresses. Status bar: an AT-SUITE strip over the view's bottom edge, off unless ticked.</p>
          <table>${custom.map((v) => `<tr><td><b>${esc(v.name)}</b></td><td style="width:7rem">${sbar(v.id)}</td>
            <td style="width:12rem;text-align:right">${pv(v.id)} ${isAdmin ? `<button class="small danger" data-delview="${esc(v.slug)}">Remove</button>` : ""}</td></tr>`).join("") || '<tr><td class="muted small">No uploaded views yet.</td></tr>'}</table>
          ${isAdmin ? `<form class="row" id="upView" style="margin-top:.6rem"><input name="name" placeholder="View name, e.g. Lower third timer" aria-label="View name" required class="grow"><input type="file" name="file" aria-label="View file" accept=".zip,.html,.htm" required style="width:auto"><button class="primary">Upload view</button></form>` : ""}</div>`;

      // the preview: one view on one room, scaled down from a 1920 x 1080 screen
      const frame = page.querySelector(".tv-preview iframe"), vs = page.querySelector("[data-pvview]"), rs = page.querySelector("[data-pvroom]"), op = page.querySelector("[data-pvopen]");
      const showPreview = () => {
        if (!boot.rooms.length) { op.classList.add("hidden"); return; }
        const url = urlFor(rs.value, vs.value);
        op.href = url;
        if (frame.getAttribute("src") !== url) frame.src = url;
      };
      if (frame) new ResizeObserver(() => { frame.style.transform = `scale(${frame.parentElement.clientWidth / 1920})`; }).observe(frame.parentElement);
      vs.onchange = rs.onchange = showPreview;
      showPreview();
      page.querySelectorAll("[data-pv]").forEach((b) => b.onclick = () => { vs.value = b.dataset.pv; showPreview(); page.querySelector(".panel").scrollIntoView({ behavior: "smooth", block: "start" }); });

      const reload = () => timers(el, "views");
      page.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { timersEdit = b.dataset.edit; location.hash = "#/timers/designer"; });
      page.querySelectorAll("[data-deldesign]").forEach((b) => b.onclick = () => confirm("Remove this view? Screens showing it go back to the Standard view.") && guard(() => del(`/api/timers-designs/${b.dataset.deldesign}`)).then(reload));
      page.querySelectorAll("[data-delview]").forEach((b) => b.onclick = () => guard(() => del(`/api/timers-views/${b.dataset.delview}`)).then(reload));
      const f = page.querySelector("#upView");
      if (f) f.onsubmit = (e) => { e.preventDefault(); guard(() => upload(`/api/timers-views?name=${encodeURIComponent(f.name.value)}`, f.file.files[0])).then(() => { toast("View added", "good"); reload(); }); };
      page.querySelectorAll("[data-sbar]").forEach((i) => i.onchange = () => guard(() => put(`/api/timers-views/look/${encodeURIComponent(i.dataset.sbar)}`, { status_bar: i.checked })).then((r) => r && toast("Saved", "good")));
    }
  }

  // ----------------------------------------------------------- captions --
  async function captions(el) {
    const render = async () => {
      const s = await api("/api/captions/status");
      const e = s.engine;
      el.innerHTML = `<h1>Captions</h1>
        <div class="panel" style="margin-bottom:1rem"><div class="row"><b>Speech engine</b><span class="pill ${e.state === "ready" ? "good" : e.state === "error" ? "bad" : "warn"}">${esc(e.state)}</span>
          <span class="muted small">${esc(e.detail)} ${e.state === "downloading" ? Math.round(e.progress) + "%" : ""}</span><span class="grow"></span>
          <span class="muted small">${e.active_rooms} of ${e.max_rooms} rooms live</span>${boot.me.role === "admin" ? '<button class="small" id="reload">Reload engine</button>' : ""}</div>
          ${e.skipped_vocabulary?.length ? `<p class="muted small">These vocabulary words couldn't be used: ${esc(e.skipped_vocabulary.join(", "))}</p>` : ""}</div>
        <p class="muted">A tech's laptop sends its microphone from the tech workspace. Audience screen: <code>/captions/&lt;room&gt;</code>. Transparent overlay for OBS or vMix: <code>/captions/&lt;room&gt;/overlay</code>.</p>
        <div class="grid">${s.rooms.map((r) => `<div class="panel" data-room="${r.id}">
          <div class="row" style="justify-content:space-between"><h2>${esc(r.name)}</h2><span class="pill ${r.live ? "good" : ""}">${r.live ? "Live from " + esc(r.source) : "Not live"}</span></div>
          <div class="row small"><a href="/captions/${r.id}" target="_blank">Audience ↗</a><a href="/captions/${r.id}/overlay" target="_blank">Overlay ↗</a></div>
          ${boot.me.role === "admin" ? `<label><input type="checkbox" data-f="enabled" ${r.enabled ? "checked" : ""} style="width:auto"> Captions on for this room</label>
          <label><input type="checkbox" data-f="record" ${r.record ? "checked" : ""} style="width:auto"> Save transcripts</label>
          <label>Vocabulary (names, jargon; one per line)</label><textarea data-f="vocabulary" rows="3">${esc(r.vocabulary)}</textarea>
          <div class="row" style="margin-top:.4rem"><button class="small" data-save>Save</button></div>` : ""}
          <div class="row" style="margin-top:.4rem"><input class="grow" placeholder="Test text for the screens" data-test><button class="small" data-send>Send</button><button class="small" data-clear>Clear</button></div></div>`).join("")}</div>
        <h2 style="margin-top:1.5rem">Transcripts</h2><div class="panel" id="tx"></div>`;
      el.querySelector("#reload") && (el.querySelector("#reload").onclick = () => guard(() => post("/api/captions/engine/reload")).then(() => setTimeout(render, 800)));
      el.querySelectorAll("[data-room]").forEach((card) => {
        const id = card.dataset.room;
        card.querySelector("[data-save]") && (card.querySelector("[data-save]").onclick = () => guard(() => put(`/api/captions/rooms/${id}`, {
          enabled: card.querySelector('[data-f=enabled]').checked, record: card.querySelector('[data-f=record]').checked, vocabulary: card.querySelector('[data-f=vocabulary]').value,
        })).then(() => toast("Saved", "good")));
        card.querySelector("[data-send]").onclick = () => guard(() => post(`/api/captions/${id}/test`, { text: card.querySelector("[data-test]").value || "Caption test" }));
        card.querySelector("[data-clear]").onclick = () => guard(() => post(`/api/captions/${id}/clear`));
      });
      const tx = await api("/api/captions/transcripts");
      el.querySelector("#tx").innerHTML = tx.length ? `<table><tr><th>Room</th><th>Started</th><th>Ended</th><th>Deleted</th><th></th></tr>${tx.map((t) => `<tr><td>${esc(t.room)}</td><td>${when(t.started_at)}</td><td>${when(t.ended_at)}</td><td class="small muted">${when(t.delete_at)}</td><td><a href="/api/captions/transcripts/${t.id}">Text</a> · <a href="/api/captions/transcripts/${t.id}/export.srt">SRT</a> · <a href="/api/captions/transcripts/${t.id}/export.vtt">VTT</a></td></tr>`).join("")}</table>` : '<p class="muted">None saved yet.</p>';
    };
    view = { onEvent: (e) => { if (e.type === "status" || e.type === "captions.engine") render(); } };
    render();
  }

  // -------------------------------------------------------------- fleet --
  async function fleet(page) {
    let nodes = [];
    page.innerHTML = '<div data-list></div><div data-health></div>';
    const el = page.querySelector("[data-list]"), healthBox = page.querySelector("[data-health]");
    const load = (sys) => {
      if (!sys) return '<span class="muted small">–</span>';
      const mem = sys.mem_total ? Math.round(100 * (sys.mem_total - sys.mem_free) / sys.mem_total) : null;
      return `<div class="small" style="white-space:nowrap">${meter(sys.cpu, "CPU")} ${meter(mem, "Mem")}</div>`;
    };
    const render = async () => {
      nodes = await api("/api/fleet/nodes");
      const isAdmin = isAdminRole;
      el.innerHTML = `<div class="panel"><table><tr><th></th><th>Name</th><th>Kind</th><th>Room</th><th>Address</th><th>Version</th><th>Load</th><th>Showing</th><th>Last seen</th><th></th></tr>
        ${nodes.map((n) => `<tr data-n="${n.id}"><td><span class="dot ${n.online ? "on" : "off"}"></span></td><td><b>${esc(n.name)}</b>${n.legacy ? ' <span class="pill">old agent</span>' : ""}${n.kind === "tech" && n.operator && n.room_id ? `<div class="small muted">${esc(n.operator)}${n.mode ? ` · <span class="pill ${n.mode === "backup" ? "warn" : ""}">${n.mode === "backup" ? "Backup" : "Main"}</span>` : ""}</div>` : ""}</td>
          <td>${isAdmin ? `<select data-kind style="width:auto">${["tech", "kiosk", "caption"].map((k) => `<option ${k === n.kind ? "selected" : ""}>${k}</option>`).join("")}</select>` : esc(n.kind)}</td>
          <td>${isManager ? `<select data-room style="width:auto">${roomOptions(n.room_id)}</select>` : esc(n.room_name || "")}</td>
          <td class="small">${esc(n.ip)}</td><td class="small">${esc(n.version)}</td><td>${n.online ? load(n.info?.system) : '<span class="muted small">–</span>'}</td><td class="small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.current_url)}</td>
          <td class="small">${n.last_seen ? when(new Date(n.last_seen * 1000).toISOString()) : "never"}</td>
          <td class="row">${isManager && n.info?.system ? '<button class="small" data-health>Details</button>' : ""}<button class="small" data-url>Set screen</button><button class="small" data-cmd="identify">Identify</button>
          ${isAdmin ? '<button class="small" data-cmd="reboot">Reboot</button><button class="small danger" data-delnode>Remove</button>' : ""}</td></tr>`).join("") || '<tr><td colspan="10" class="muted">No nodes yet.</td></tr>'}</table></div>`;
      el.querySelectorAll("[data-n]").forEach((row) => {
        const id = +row.dataset.n, n = nodes.find((x) => x.id === id);
        const save = () => guard(() => put(`/api/fleet/nodes/${id}`, { room_id: row.querySelector("[data-room]").value ? +row.querySelector("[data-room]").value : null, kind: row.querySelector("[data-kind]")?.value || null }));
        row.querySelector("[data-room]") && (row.querySelector("[data-room]").onchange = save);
        row.querySelector("[data-kind]") && (row.querySelector("[data-kind]").onchange = save);
        row.querySelector("[data-url]").onclick = async () => {
          const links = n.room_id ? (await api(`/api/dashboard/links?room_id=${n.room_id}`)).filter((l) => l.room_id) : [];
          const hint = links.map((l, i) => `${i + 1}. ${l.label}`).join("\n");
          const ans = prompt(`Screen for ${n.name}: paste a URL${links.length ? " or pick a number\n" + hint : ""}`, n.current_url || "");
          if (!ans) return;
          const url = /^\d+$/.test(ans.trim()) && links[+ans - 1] ? links[+ans - 1].url : ans.trim();
          guard(() => post(`/api/fleet/nodes/${id}/command`, { kind: "set_url", payload: { url } })).then(() => toast("Queued", "good"));
        };
        row.querySelectorAll("[data-cmd]").forEach((b) => b.onclick = () => (b.dataset.cmd !== "reboot" || confirm(`Reboot ${n.name}?`)) && guard(() => post(`/api/fleet/nodes/${id}/command`, { kind: b.dataset.cmd })).then(() => toast("Sent", "good")));
        row.querySelector("[data-delnode]") && (row.querySelector("[data-delnode]").onclick = () => confirm(`Remove ${n.name}? It can enrol again later.`) && guard(() => del(`/api/fleet/nodes/${id}`)).then(render));
        row.querySelector("[data-health]") && (row.querySelector("[data-health]").onclick = () => showHealth(id));
      });
    };
    // A laptop's task manager, refreshed every 5 seconds while it's open.
    let healthId = null, healthTimer = null;
    const closeHealth = () => { healthId = null; clearTimeout(healthTimer); healthBox.innerHTML = ""; };
    const showHealth = (id) => { healthId = id; clearTimeout(healthTimer); drawHealth(); healthBox.scrollIntoView({ behavior: "smooth", block: "start" }); };
    const drawHealth = async () => {
      if (healthId == null || !page.isConnected) return;
      const id = healthId;
      let h;
      try { h = await api(`/api/fleet/nodes/${id}/health`); } catch (e) { healthBox.innerHTML = `<div class="panel"><p class="bad">${esc(e.message)}</p></div>`; return; }
      if (id !== healthId) return;
      const s = h.system || {}, n = h.node;
      const mem = s.mem_total ? Math.round(100 * (s.mem_total - s.mem_free) / s.mem_total) : null;
      const diskUsed = s.disk?.total ? Math.round(100 * (s.disk.total - s.disk.free) / s.disk.total) : null;
      const shots = !h.snapshots ? '<p class="small muted">Screen snapshots are off. An admin can turn them on in Settings → General → Privacy.</p>'
        : h.snapshot ? `<div class="row" style="flex-wrap:wrap;gap:.6rem">${h.snapshot.shots.map((x) => `<figure style="margin:0"><img src="${esc(x.image)}" alt="${esc(x.name)}" style="width:320px;max-width:100%;border:1px solid var(--line);border-radius:var(--radius)"><figcaption class="small muted">${esc(x.name)} · ${h.snapshot.age}s ago</figcaption></figure>`).join("")}</div>`
        : `<p class="small muted">${n.online ? "Asking the laptop for its screens. They appear within 10 seconds, and the tech sees a note while you look." : "This laptop is offline."}</p>`;
      healthBox.innerHTML = `<div class="panel" style="margin-top:1rem"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(n.name)} <span class="dot ${n.online ? "on" : "off"}"></span></h2><button class="small" data-close>Close</button></div>
        <div class="grid" style="margin-top:.6rem">
          <div><h3>CPU ${s.cpu ?? "–"}%</h3>${spark(h.history, "cpu")}<p class="small muted">${esc(s.cpu_model || "")}${s.cores ? ` · ${s.cores} cores` : ""}</p></div>
          <div><h3>Memory ${mem ?? "–"}%</h3>${spark(h.history, "mem")}<p class="small muted">${bytes(s.mem_total - s.mem_free)} of ${bytes(s.mem_total)} · AT-SUITE uses ${bytes(s.app_mem)}</p></div>
          <div>${kv([["Disk", s.disk ? `${meter(diskUsed, s.disk.drive)} ${bytes(s.disk.free)} free of ${bytes(s.disk.total)}` : "–"],
            ["Network", s.online === false ? '<span class="bad">offline</span>' : (s.net || []).map((x) => `${esc(x.ip)} <span class="muted small">${esc(x.name)}</span>`).join("<br>") || "–"],
            ["Screens", (s.displays || []).map((d) => `${d.w}×${d.h}${d.primary ? " (main)" : ""}`).join(", ") || "–"],
            ["Power", s.power === "battery" ? '<span class="warn">on battery</span>' : s.power ? "plugged in" : "–"],
            ["Windows", `${s.windows ?? 0} popped out${s.overlay ? ", overlay on" : ""}`],
            ["System", `${esc(s.os || "")} · up ${ago(s.uptime)}`], ["App", `${esc(s.app_version || n.version || "")} · open ${ago(s.app_uptime)}`]])}</div>
        </div><h3>Screens</h3>${shots}</div>`;
      healthBox.querySelector("[data-close]").onclick = closeHealth;
      healthTimer = setTimeout(drawHealth, 5000);
    };
    let pending = null;
    view = { onEvent: (e) => { if (e.topic === "fleet" && !pending) pending = setTimeout(() => { pending = null; render(); }, 1500); } };
    render();
  }

  // ------------------------------------------------------- the sections --
  const copyText = async (text, what = "Copied") => {
    try { await navigator.clipboard.writeText(text); }
    catch (_) { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
    toast(what, "good");
  };
  const bytes = (n) => n == null ? "–" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`;
  const ago = (s) => s == null ? "–" : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min` : `${Math.floor(s / 86400)} days ${Math.floor(s % 86400 / 3600)} h`;
  const date = (t) => t ? new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  // A small bar for a percentage, and a line of the last 15 minutes.
  const meter = (pct, label) => pct == null ? `${esc(label)} –` : `<span title="${esc(label)} ${pct}%" style="display:inline-flex;align-items:center;gap:.25rem">${esc(label)}<span style="display:inline-block;width:48px;height:6px;border-radius:3px;background:var(--line);overflow:hidden"><span style="display:block;height:100%;width:${Math.min(100, Math.max(0, pct))}%;background:var(${pct >= 90 ? "--bad" : pct >= 75 ? "--warn" : "--accent"})"></span></span>${pct}%</span>`;
  const spark = (hist, key) => {
    const pts = (hist || []).filter((x) => x[key] != null);
    if (pts.length < 2) return '<p class="small muted">Collecting…</p>';
    const W = 300, H = 60;
    const line = pts.map((x, i) => `${(i / (pts.length - 1) * W).toFixed(1)},${(H - x[key] / 100 * H).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:60px;background:var(--panel2);border-radius:var(--radius)"><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  };
  const kv = (rows) => `<table class="kv">${rows.filter(Boolean).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>`;

  async function admGeneral(a) {
    const s = await api("/api/admin/settings");
    const b = s.branding;
    a.innerHTML = `<div class="grid"><form class="panel" id="brand"><h2>Branding</h2>
      <label>Product name</label><input name="product_name" value="${esc(b.product_name)}">
      <label>Organisation</label><input name="organisation" value="${esc(b.organisation)}">
      <label>Accent colour</label><input name="accent" type="color" value="${esc(b.accent)}" style="height:2.4rem">
      <p class="small muted">Version, build and server details are in <a href="#/settings/info">About</a>.</p>
      <div class="row" style="margin-top:.8rem"><button class="primary">Save</button></div></form>
      <form class="panel" id="mods"><h2>Modules</h2>${Object.entries(s.modules).map(([m, on]) => `<label><input type="checkbox" name="${m}" ${on ? "checked" : ""} style="width:auto"> ${esc(MODNAMES[m] || m)}${s.licence.modules.includes(m) ? "" : ' <span class="pill warn">not in licence</span>'}</label>`).join("")}
      <h2 style="margin-top:1rem">Other</h2>
      <label><input type="checkbox" name="legacy" ${s.legacy_fleet_api ? "checked" : ""} style="width:auto"> Accept old kiosk agents (Device Suite API, no sign-in)</label>
      <label>Delete chat messages older than (days, 0 = keep)</label><input name="retention" type="number" min="0" value="${s.message_retention_days}">
      <label>Send a help call out again when nobody answers it in (minutes, 0 = never)</label><input name="escalate" type="number" min="0" max="60" step="0.5" value="${s.help_escalate_minutes}">
      <p class="small muted" style="margin-top:.2rem">It goes again to every laptop and console page on the site (never a Main PC), up to three times, until someone presses On my way.</p>
      <h2 style="margin-top:1rem">Passwords</h2>
      <label><input type="checkbox" name="techpw" ${s.tech_passwords ? "checked" : ""} style="width:auto"> Techs sign in to their laptop with their own account and password</label>
      <p class="small muted" style="margin:.1rem 0 .4rem">Off: they just type their name. Add everyone under People before you turn this on.</p>
      <label><input type="checkbox" name="forgotnow" ${s.forgot_resets_at_once ? "checked" : ""} style="width:auto"> Forgot password resets a tech's password to ChangeMe straight away</label>
      <p class="small muted" style="margin:.1rem 0 .4rem">Off (safer): an admin or manager resets it with one press under People. Admin and manager passwords always wait for an admin.</p>
      <h2 style="margin-top:1rem">Privacy</h2>
      <label>Delete caption transcripts this many hours after they end (1 to 168)</label><input name="keephours" type="number" min="1" max="168" value="${s.transcript_keep_hours}">
      <p class="small muted" style="margin:.1rem 0 .4rem">12 hours by default. Captions never leave your network; transcripts are stored encrypted.</p>
      <label><input type="checkbox" name="laptopcaps" ${s.captions_on_laptops ? "checked" : ""} style="width:auto"> Laptops make captions themselves</label>
      <p class="small muted" style="margin:.1rem 0 .4rem">On by default. The desktop app turns speech into text on the laptop and only sends the text here, so this server does far less. The app gets the speech model from this server once. Browsers and older apps still use this server.</p>
      <label><input type="checkbox" name="capprivate" ${s.captions_private ? "checked" : ""} style="width:auto"> Caption text stays on the laptops</label>
      <p class="small muted" style="margin:.1rem 0 .4rem">Off by default. When on, this server never hears the audio or sees the captions: the AT-SUITE app makes them on the laptop, the room's caption screens are fed from that laptop, and the transcript is kept on that laptop. Browsers can't send a mic, and nothing falls back to this server.</p>
      <label><input type="checkbox" name="snaps" ${s.laptop_snapshots ? "checked" : ""} style="width:auto"> Managers can see snapshots of laptop screens</label>
      <p class="small muted" style="margin:.1rem 0 .4rem">Off by default. Laptops only send them while a manager has that laptop's details open, the tech sees a note while it happens, and they are never saved.</p>
      <div class="row" style="margin-top:.8rem"><button class="primary">Save</button></div></form></div>`;
    const bf = a.querySelector("#brand");
    bf.onsubmit = (e) => { e.preventDefault(); guard(() => put("/api/admin/settings", { branding: Object.fromEntries(new FormData(bf)) })).then(() => location.reload()); };
    // The weather in the tech workspace's top bar: each site picks its town.
    const wxPanel = document.createElement("div");
    wxPanel.className = "panel"; wxPanel.style.marginTop = "1rem";
    a.append(wxPanel);
    const drawWx = async () => {
      const list = await api("/api/admin/weather");
      wxPanel.innerHTML = `<h2>Venue weather</h2><p class="small muted" style="margin-top:0">Shows in the techs' top bar. Only the town's position is sent to the forecast service (Open-Meteo), and only once you pick a town.</p>` +
        list.map((w) => `<div data-wsite="${w.site_id}" style="margin-bottom:.8rem"><b>${esc(w.site)}</b>: ${w.place ? esc(w.place.name) + ' <button class="small" data-woff>Turn off</button>' : '<span class="muted">off</span>'}
          <div class="row" style="margin-top:.3rem"><input data-wq placeholder="Town or city, e.g. Harrogate" style="flex:1;width:auto"><button class="small" data-wfind>Find</button></div><div class="row" data-wres style="margin-top:.3rem;flex-wrap:wrap"></div></div>`).join("");
      wxPanel.querySelectorAll("[data-wsite]").forEach((row) => {
        const sid = row.dataset.wsite, res = row.querySelector("[data-wres]");
        row.querySelector("[data-woff]")?.addEventListener("click", () => guard(() => del(`/api/admin/weather/${sid}`)).then(drawWx));
        const find = () => guard(() => api(`/api/admin/weather/find?q=${encodeURIComponent(row.querySelector("[data-wq]").value)}`)).then((found) => {
          if (!found) return;
          res.innerHTML = found.length ? found.map((f, i) => `<button class="small" data-wi="${i}">${esc(f.name)}</button>`).join("") : '<span class="muted small">No places found.</span>';
          res.querySelectorAll("[data-wi]").forEach((b) => b.onclick = () => guard(() => put(`/api/admin/weather/${sid}`, found[+b.dataset.wi])).then(() => { toast("Weather set", "good"); drawWx(); }));
        });
        row.querySelector("[data-wfind]").onclick = find;
        row.querySelector("[data-wq]").onkeydown = (e) => { if (e.key === "Enter") find(); };
      });
    };
    drawWx();
    const mf = a.querySelector("#mods");
    mf.onsubmit = (e) => {
      e.preventDefault();
      const modules = Object.fromEntries(Object.keys(s.modules).map((m) => [m, mf[m].checked]));
      guard(() => put("/api/admin/settings", { modules, legacy_fleet_api: mf.legacy.checked, message_retention_days: +mf.retention.value, help_escalate_minutes: +mf.escalate.value, tech_passwords: mf.techpw.checked, forgot_resets_at_once: mf.forgotnow.checked, transcript_keep_hours: +mf.keephours.value || 12, laptop_snapshots: mf.snaps.checked, captions_on_laptops: mf.laptopcaps.checked, captions_private: mf.capprivate.checked })).then(() => location.reload());
    };
  }

  // One look for every staff page on the site: the console, the tech workspaces, setup and the presenter page.
  // Changes show on this page straight away; Save sends them to everyone.
  async function admAppearance(a) {
    const s = await api("/api/admin/settings"), saved = { ...s.branding.appearance };
    let cur = { ...saved };
    const THEMES = [
      ["dark", "Dark", "The AT-SUITE look: dark and calm for the control room.", ["#0d1117", "#151b23", "#3d444d", "#f0f6fc"]],
      ["light", "Light", "Bright and clear for the office or a sunny foyer.", ["#f6f8fa", "#ffffff", "#d1d9e0", "#1f2328"]],
      ["auto", "Match the laptop", "Light or dark, as each laptop's Windows or Mac is set.", ["#0d1117", "#ffffff", "#3d444d", "#59636e"]],
      ["modern", "Modern", "Soft, rounded and roomy, with gentle shadows.", ["#0f1115", "#181b22", "#20242d", "#eef0f5"]],
      ["futuristic", "Futuristic", "Glass panels, glowing edges and a mono font for the numbers.", ["#04070e", "#0a1222", "#16314f", "#dbeafe"]],
    ];
    const OPTS = {
      density: [["compact", "Compact"], ["normal", "Normal"], ["roomy", "Roomy"]],
      corners: [["square", "Square"], ["rounded", "Rounded"], ["round", "Round"]],
      font: [["system", "System"], ["brand", "AT-SUITE (Saira)"], ["rounded", "Rounded"], ["mono", "Mono"]],
      motion: [["on", "On"], ["off", "Off (no flashing or animation)"]],
    };
    const accent = s.branding.accent || "#FF7A1A";
    const card = ([k, name, about, [bg, panel, line, text]]) => `<button type="button" class="theme-card${cur.theme === k ? " on" : ""}" data-theme-pick="${k}">
        <span class="theme-sw" style="background:${bg};border-color:${line}"><i style="background:${panel};border-color:${line}"><b style="background:${accent}"></b><u style="background:${text}"></u><u style="background:${line}"></u></i><i style="background:${panel};border-color:${line}"><u style="background:${text}"></u></i></span>
        <b>${name}</b><span class="muted small">${about}</span></button>`;
    const seg = (key) => `<div class="seg">${OPTS[key].map(([v, t]) => `<button type="button" data-opt="${key}" data-v="${v}" class="${cur[key] === v ? "on" : ""}">${t}</button>`).join("")}</div>`;
    const draw = () => {
      a.innerHTML = `<div class="panel"><h2>Theme</h2><p class="muted small" style="margin-top:0">One look for the whole site: every console, tech workspace, setup and presenter page. Stage, caption and backstage screens keep their own look. The accent colour is in <a href="#/settings/general">General</a>.</p>
        <div class="theme-grid">${THEMES.map(card).join("")}</div></div>
        <div class="grid" style="margin-top:var(--gap)">
          <div class="panel"><h2>Spacing</h2>${seg("density")}</div>
          <div class="panel"><h2>Corners</h2>${seg("corners")}</div>
          <div class="panel"><h2>Font</h2>${seg("font")}</div>
          <div class="panel"><h2>Animation</h2>${seg("motion")}</div>
        </div>
        <div class="panel" style="margin-top:var(--gap)"><h2>Preview</h2><div class="row"><button class="primary">Primary</button><button>Button</button><button class="danger">Danger</button>
          <span class="pill good">online</span><span class="pill warn">paused</span><span class="pill bad">help</span><input placeholder="A text box" style="max-width:14rem"></div>
          <div class="clock bigclock" style="margin-top:.6rem">12:34</div></div>
        <div class="row" style="margin-top:var(--gap)"><button class="primary" id="apSave">Save for everyone</button><button id="apUndo">Undo changes</button>
          <span class="muted small">${JSON.stringify(cur) === JSON.stringify(saved) ? "This is the look everyone has now." : "Only you can see these changes until you save."}</span></div>`;
      a.querySelectorAll("[data-theme-pick]").forEach((b) => (b.onclick = () => set({ theme: b.dataset.themePick })));
      a.querySelectorAll("[data-opt]").forEach((b) => (b.onclick = () => set({ [b.dataset.opt]: b.dataset.v })));
      a.querySelector("#apSave").onclick = () => guard(() => put("/api/admin/settings", { appearance: cur })).then(() => { Object.assign(saved, cur); ATTheme.remember(cur); toast("Saved. Every page picks it up when it next loads.", "good"); draw(); });
      a.querySelector("#apUndo").onclick = () => set({ ...saved });
    };
    const set = (change) => { cur = { ...cur, ...change }; ATTheme.apply(cur); draw(); };
    draw();
    // leaving the tab without saving puts the site's look back
    addEventListener("hashchange", function back() { removeEventListener("hashchange", back); ATTheme.apply(saved); });
  }

  // Updates from GitHub releases: the server checks, the host's updater installs (update.sh --auto).
  async function admUpdates(a) {
    const u = await api("/api/admin/updates"), L = u.latest || {};
    if (u.hosted) {  // a hosted venue: the provider updates it
      a.innerHTML = `<div class="panel" style="max-width:640px"><h2>Version</h2>${kv([["Running", `<b>${esc(u.current)}</b>`],
        ["Windows tech app", u.app ? esc(u.app) : '<span class="muted">not published yet</span>']])}<p class="small muted">${esc(u.detail)}</p></div>`;
      return;
    }
    const MODES =[["auto", "Install by itself", "When a new version is out and no show is on, the server updates itself: backup first, health check, rolled back if it isn't healthy."],
      ["notify", "Tell me only", "Shows here when a new version is out. Press Install now to update."],
      ["off", "Off", "Doesn't check. Update with sudo ./update.sh on the server."]];
    const state = u.error ? `<span class="pill bad">Couldn't check</span> ${esc(u.error)}${L.version ? `<div class="small muted">The newest release it saw before was ${esc(L.version)}.</div>` : ""}`
      : !u.latest ? '<span class="muted">Not checked yet.</span>'
      : u.available ? `<span class="pill warn">${esc(L.version)} is out</span> ${L.published_at ? `<span class="muted small">released ${when(L.published_at)}</span>` : ""}`
      : u.ahead ? `<span class="pill">Ahead of GitHub</span><div class="small muted">This server runs ${esc(u.current)}, newer than the newest release on GitHub (${esc(L.version)}). It updates again once a release newer than ${esc(u.current)} is published. Press Check now if one just came out.</div>`
      : `<span class="pill good">Up to date</span>`;
    const res = u.last_result;
    a.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="panel"><h2>Version</h2>${kv([["Running", `<b>${esc(u.current)}</b>`], ["Newest release", L.version ? `<a href="${esc(L.url)}" target="_blank">${esc(L.version)}</a>` : "–"], ["Status", state],
        ["Last checked", u.checked_at ? when(u.checked_at) : "never"], ["Windows tech app", u.app ? esc(u.app) : '<span class="muted">not published</span>'],
        u.app_error && ["App download", `<span class="pill warn">problem</span> ${esc(u.app_error)}`],
        res && ["Last update", `${res.result === "ok" ? '<span class="pill good">installed</span>' : '<span class="pill bad">failed</span>'} ${esc(res.version)} ${when(res.at)}${res.detail ? `<div class="small muted">${esc(res.detail)}</div>` : ""}`],
        u.live.length && ["Show on", `<span class="pill warn">waiting</span> A timer is running or paused in ${esc(u.live.join(", "))}. Nothing installs until it's stopped.`],
        u.requested && ["Install now", `<span class="pill warn">asked</span> ${esc(u.requested)} is installing now${u.live.length ? `, once the show in ${esc(u.live.join(", "))} is over` : ""}. The server restarts by itself in a minute or two. <button class="small" id="updCancel">Cancel</button>`]])}
        ${u.progress && u.progress.step ? `<div class="panel" style="margin-top:.8rem"><h2>Installation progress</h2>
          <div style="margin-bottom:.4rem"><b>${esc(u.progress.step)}</b>: ${esc(u.progress.message)}</div>
          <div style="width:100%;background:var(--line);height:8px;border-radius:4px;overflow:hidden"><div style="width:${u.progress.percent}%;background:var(--accent);height:100%"></div></div>
          <div class="small muted">${u.progress.percent}% complete</div></div>` : ""}
        <div class="row" style="margin-top:.8rem"><button id="updCheck">Check now</button>${u.available && !u.requested ? `<button class="primary" id="updInstall">Install ${esc(L.version)} now</button>` : ""}</div>
        <p class="small" id="updSaid" role="status" style="margin:.4rem 0 0"></p>
        ${u.host_updater ? "" : `<p class="small" style="color:var(--warn)">This server's automatic updater hasn't been in touch${u.host_seen_at ? ` since ${when(new Date(u.host_seen_at * 1000).toISOString())}` : ""}. Install now and Install by itself need it: on the server, run <code>sudo ./install.sh --updater</code> in the AT-SUITE folder once.</p>`}
        ${L.notes && u.available ? `<details style="margin-top:.6rem"><summary>What's new in ${esc(L.version)}</summary><pre class="small" style="white-space:pre-wrap">${esc(L.notes)}</pre></details>` : ""}</div>
      <form class="panel" id="updForm"><h2>When to update</h2>
        ${MODES.map(([v, t, d]) => `<label class="opt" style="display:block;margin:.3rem 0"><input type="radio" name="mode" value="${v}" ${u.mode === v ? "checked" : ""} style="width:auto"> <b>${t}</b><div class="small muted" style="margin-left:1.6rem">${d}</div></label>`).join("")}
        <p class="small muted">Laptops update from this server: after the server updates, it fetches the same version's Windows app, so laptops need no internet.</p>
        <label>GitHub token ${u.has_token ? '<span class="pill good">saved</span>' : ""}</label><input name="token" type="password" autocomplete="off" placeholder="${u.has_token ? "Leave empty to keep it" : "Only for a private repository"}">
        <p class="small muted">A read-only token (Contents: read; for the published image also read:packages). It stays on this server.${u.has_token ? ' <a href="#" id="updForget">Remove it</a>' : ""}</p>
        <div class="row" style="margin-top:.8rem"><button class="primary">Save</button></div></form></div>`;
    const again = () => admUpdates(a);
  let progressInterval = null;
  // Auto-refresh when installation is in progress
  if (u.progress && u.progress.step && u.progress.step !== "complete" && u.progress.step !== "failed") {
    progressInterval = setInterval(() => {
      guard(() => api("/api/admin/updates")).then((s) => {
        if (s.progress && (s.progress.step === "complete" || s.progress.step === "failed")) {
          clearInterval(progressInterval);
        }
        again();
      }, () => {});
    }, 2000);  // Refresh every 2 seconds during installation
  }
  // Clean up interval when leaving the tab
  const originalAgain = again;
  const cleanup = () => {
    if (progressInterval) clearInterval(progressInterval);
    removeEventListener("hashchange", cleanup);
  };
  addEventListener("hashchange", cleanup);
  // Check now always says what it found, so a check that changes nothing on the page doesn't look like it did nothing.
    const said = (s) => s.error ? [`Couldn't check: ${s.error}`, "bad"]
      : s.available ? [`${s.latest.version} is out.`, "good"]
      : s.ahead ? [`This server runs ${s.current}, newer than the newest release (${s.latest.version}).`, ""]
      : s.latest ? [`Up to date: ${s.current} is the newest release.`, "good"] : ["Checked, but GitHub has no release yet.", ""];
    a.querySelector("#updCheck").onclick = (e) => {
      e.target.disabled = true; e.target.textContent = "Checking…";
      a.querySelector("#updSaid").textContent = "Asking GitHub for the newest release…";
      guard(() => post("/api/admin/updates/check")).then(async (s) => {
        const [msg, kind] = said(s);
        await again();
        const out = a.querySelector("#updSaid");
        if (out) { out.textContent = `${msg} Checked at ${new Date().toLocaleTimeString()}.`; out.style.color = kind ? `var(--${kind}-ink)` : ""; }
      }, () => { e.target.disabled = false; e.target.textContent = "Check now"; a.querySelector("#updSaid").textContent = "Couldn't reach this server. Try again."; });
    };
    a.querySelector("#updInstall")?.addEventListener("click", () => confirm(`Install ${L.version} now? The server restarts for about a minute, and only when no timer is running.`) && guard(() => post("/api/admin/updates/install")).then(again));
    a.querySelector("#updCancel")?.addEventListener("click", () => guard(() => del("/api/admin/updates/install")).then(again));
    a.querySelector("#updForget")?.addEventListener("click", (e) => { e.preventDefault(); guard(() => put("/api/admin/updates", { token: "" })).then(again); });
    a.querySelector("#updForm").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target), body = { mode: f.get("mode") };
      if (f.get("token")) body.token = f.get("token");
      guard(() => put("/api/admin/updates", body)).then(() => { toast("Saved", "good"); again(); });
    };
  }

  // The AI helper in the techs' Help menu: what it knows, where its answers come from, and what it has learned.
  async function admAi(a) {
    const d = await api("/api/admin/ai"), s = d.settings;
    a.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr))"><form class="panel" id="aif"><h2>AI helper</h2>
      <p class="small muted" style="margin-top:0">Techs chat with it from the Help menu, and it picks up each help call while the crew is on the way. It answers from your venue notes, from how past help calls were fixed (${d.help_fixes} so far), and from answers techs marked "This fixed it".</p>
      <label><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""} style="width:auto"> Turn on the AI helper</label>
      <label>Venue notes</label><textarea name="venue_notes" rows="10" placeholder="One topic per paragraph, its first line a heading. E.g.&#10;Hall A projector&#10;Use input HDMI 2. The remote is on the lectern shelf.">${esc(s.venue_notes)}</textarea>
      <label><input type="checkbox" name="learn_help" ${s.learn_help ? "checked" : ""} style="width:auto"> Learn from how help calls were fixed</label>
      <label><input type="checkbox" name="builtin_guide" ${s.builtin_guide !== false ? "checked" : ""} style="width:auto"> Use the built-in tech guide</label>
      <p class="small muted" style="margin:.1rem 0 .4rem">Fault finding for sound, video, lighting, staging and rigging, networks, presenters' laptops, hybrid events, safety and running the show, built into AT-SUITE. It works offline. Your own notes and fixes always come first. You can read and change it under Tech guide.</p>
      <label><input type="checkbox" name="manual" ${s.manual !== false ? "checked" : ""} style="width:auto"> Use the AT SUITE manual</label>
      <p class="small muted" style="margin:.1rem 0 .4rem">How to use AT SUITE itself, step by step, for questions like "how do I add a stage screen?". It comes with each update, matches the version you're running, and techs can read it at <a href="/guide/manual" target="_blank" rel="noopener">/guide/manual</a>.</p>
      <h2 style="margin-top:1rem">Private AI model (optional)</h2>
      <p class="small muted" style="margin-top:0">With a model on your own network (<a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>), it writes its replies from those notes and the whole conversation. Without one it still chats: it offers the best match and asks the guide's questions to narrow the fault down. Leave the address empty to use the one set in Presenters${d.presenter_ai_url ? ` (${esc(d.presenter_ai_url)})` : ""}.</p>
      <label>Ollama address</label><input name="ai_url" placeholder="http://192.168.1.50:11434" value="${esc(s.ai_url)}">
      <label>Model</label><input name="ai_model" value="${esc(s.ai_model)}">
      <h2 style="margin-top:1rem">Web quick search</h2>
      <label><input type="checkbox" name="web_search" ${s.web_search ? "checked" : ""} style="width:auto"> Look up questions on the web when the venue's notes don't cover them</label>
      <p class="small muted" style="margin:.1rem 0 .4rem">Off by default. When on, only the question is sent (to DuckDuckGo), never your notes, chat, names or rooms. Leave it off for NDA work.</p>
      <div class="row" style="margin-top:.8rem"><button class="primary">Save</button></div></form>
      <div class="panel"><h2>Learned from techs</h2>${d.learned.length ? `<table><tr><th>Question</th><th>Answer</th><th>By</th><th></th></tr>${d.learned.map((k) => `<tr><td>${esc(k.question)}</td><td class="small" style="white-space:pre-wrap">${esc(k.answer)}</td><td class="small muted">${esc(k.added_by)}<br>${when(k.created_at)}</td><td><button class="small danger" data-forget="${k.id}">Forget</button></td></tr>`).join("")}</table>` : '<p class="muted">Nothing yet. When an answer fixes something, techs press "This fixed it".</p>'}</div>
      <div class="panel" id="aiGuide" style="grid-column:1/-1"></div></div>`;
    admGuide(a.querySelector("#aiGuide"));
    const f = a.querySelector("#aif");
    f.onsubmit = (e) => {
      e.preventDefault();
      guard(() => put("/api/admin/ai", { enabled: f.enabled.checked, venue_notes: f.venue_notes.value, learn_help: f.learn_help.checked, builtin_guide: f.builtin_guide.checked, manual: f.manual.checked, ai_url: f.ai_url.value.trim(), ai_model: f.ai_model.value.trim() || "llama3.1:8b", web_search: f.web_search.checked }))
        .then((ok) => ok && toast("Saved", "good"));
    };
    a.querySelectorAll("[data-forget]").forEach((b) => b.onclick = () => confirm("Forget this answer?") && guard(() => del(`/api/admin/ai/learned/${b.dataset.forget}`)).then(() => admAi(a)));
  }

  // The tech guide the AI helper answers from: AT-SUITE's topics, which admins can change (their copy
  // replaces the built-in one until they reset it) or add to.
  const GUIDE_SOURCE = { "built-in": ["Built in", ""], provider: ["From your provider", ""], edited: ["Changed here", "warn"], added: ["Added here", "good"] };
  async function admGuide(box, open = "") {
    const { topics } = await api("/api/admin/ai/guide");
    box.innerHTML = `<h2>Tech guide</h2>
      <p class="small muted" style="margin-top:0">What the AI helper knows about fault finding, one topic per file. Change a topic and your copy is used instead of the built-in one; Reset brings the built-in one back. Your venue notes still come first. Anyone can read the guide at <a href="/guide/help" target="_blank" rel="noopener">/guide/help</a>, so keep venue details (rooms, inputs, where kit is) in Venue notes.</p>
      <table><tr><th>Topic</th><th>Entries</th><th>Questions</th><th>Where from</th><th></th></tr>${topics.map((t) => {
        const [label, cls] = GUIDE_SOURCE[t.source] || [t.source, ""];
        return `<tr><td><b>${esc(t.title)}</b> <span class="muted small">${esc(t.name)}</span></td><td>${t.entries}</td><td>${t.questions}</td><td><span class="pill ${cls}">${esc(label)}</span></td>
          <td class="row" style="gap:.3rem"><button class="small" data-gedit="${esc(t.name)}">${t.source === "added" || t.source === "edited" ? "Edit" : "Read or change"}</button>${t.source === "edited" ? `<button class="small" data-greset="${esc(t.name)}">Reset</button>` : ""}${t.source === "added" ? `<button class="small danger" data-greset="${esc(t.name)}">Delete</button>` : ""}</td></tr>`;
      }).join("")}</table>
      <div class="row" style="margin-top:.6rem"><button class="small" id="gAdd">Add a topic</button></div>
      <div id="gEdit"></div>
      <details style="margin-top:.8rem"><summary>How to write a topic</summary><pre class="small" style="white-space:pre-wrap"># Venue kit

## Lectern mic not working
Keywords: lectern, gooseneck, mic dead
1. The lectern mic is a condenser: it needs phantom power on its channel.
2. Spare goosenecks are in the blue case under the tech desk.

### Ask meter: Does the lectern channel's meter move when someone speaks?
- Yes: The sound reaches the desk: check the fader and the main mix. → main
- No: Turn on phantom power, then swap the gooseneck.

### Ask main: Does the master meter move too?
- Yes: Check the amps are on.
- No: Check the channel is routed to the main mix.</pre>
      <p class="small muted">Each "## " heading is one entry: steps first, then optional questions. A question is "### Ask &lt;id&gt;: question", each answer a line "- Answer: what to do", and "→ id" goes on to another question. The helper shows the answers as buttons.</p></details>`;
    const edit = async (name, fresh = false) => {
      const t = fresh ? { name: "", markdown: "# New topic\n\n## First entry\nKeywords: \n1. \n", problems: [] } : await api(`/api/admin/ai/guide/${encodeURIComponent(name)}`);
      const ed = box.querySelector("#gEdit");
      ed.innerHTML = `<form method="post" class="panel" style="margin-top:.8rem" id="gForm"><h3 style="margin-top:0">${fresh ? "New topic" : esc(name)}${t.edited === false && t.built_in ? ' <span class="pill">built in: saving makes your own copy</span>' : ""}</h3>
        ${fresh ? '<label for="gName">Name (lower case, numbers and dashes, e.g. venue-kit)</label><input id="gName" name="name" pattern="[a-z0-9][a-z0-9-]{0,39}" required>' : ""}
        <label for="gText">Topic</label><textarea id="gText" name="markdown" rows="22" style="font-family:ui-monospace,monospace;font-size:.85rem">${esc(t.markdown)}</textarea>
        <div id="gProblems">${probs(t.problems)}</div>
        <div class="row" style="margin-top:.5rem"><button class="primary">Save</button><button type="button" class="small" id="gCancel">Close</button></div></form>`;
      const f = ed.querySelector("#gForm");
      ed.querySelector("#gCancel").onclick = () => { ed.innerHTML = ""; };
      f.onsubmit = (e) => {
        e.preventDefault();
        const n = fresh ? f.name.value.trim() : name;
        guard(() => put(`/api/admin/ai/guide/${encodeURIComponent(n)}`, { markdown: f.markdown.value })).then((r) => {
          toast(r.problems.length ? "Saved, but some questions need a look" : "Saved", r.problems.length ? "warn" : "good");
          admGuide(box, r.problems.length ? n : "");
        }, () => {});
      };
      ed.scrollIntoView({ block: "nearest" });
    };
    const probs = (p) => p?.length ? `<div class="small" role="alert" style="margin-top:.4rem"><b>Check these:</b><ul>${p.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
    box.querySelectorAll("[data-gedit]").forEach((b) => b.onclick = () => edit(b.dataset.gedit));
    box.querySelectorAll("[data-greset]").forEach((b) => b.onclick = () => confirm(b.textContent === "Delete" ? "Delete this topic?" : "Go back to the built-in topic? Your changes are lost.") &&
      guard(() => del(`/api/admin/ai/guide/${encodeURIComponent(b.dataset.greset)}`)).then(() => admGuide(box)));
    box.querySelector("#gAdd").onclick = () => edit("", true);
    if (open) edit(open);
  }

  // Where to email when something is urgent or the bug report can't be saved.
  const BUG_EMAIL = "support@atsuite.tech";


  async function admInfo(a) {
    const i = await api("/api/admin/info"), sv = i.server, st = i.storage, n = i.nodes, c = i.counts;
    const kinds = { tech: "Tech laptops", screen: "Linux screens", caption: "Caption sources", kiosk: "Old kiosk agents" };
    const on = (b) => b ? `<span class="pill good">${b.online} online</span> of ${b.total}` : '<span class="muted">none</span>';
    const pill = (ok, yes, no) => `<span class="pill ${ok ? "good" : "warn"}">${ok ? yes : no}</span>`;
    a.innerHTML = `<div class="row" style="margin-bottom:1rem"><a class="btn primary" href="/api/admin/info?download=1">Download diagnostics</a><button id="copyInfo">Copy for a support ticket</button><button id="refresh">Refresh</button>
        <span class="muted small">No passwords, keys or tokens are included.</span></div>
      <div class="panel row" style="margin-bottom:1rem"><span class="grow"><b>Report a bug</b><br><span class="small muted">Say what went wrong, with a screenshot if you like. It's saved in <a href="#/bugs">Bug reports</a> with this version and server filled in. Nothing is emailed: for anything urgent, email <a href="mailto:${BUG_EMAIL}">${BUG_EMAIL}</a>.</span></span>
        <button class="primary" id="bugOpen">Report a bug</button></div>
      <div class="grid">
      <div class="panel"><h2>This app</h2>${kv([["Product", esc(i.product)], ["Organisation", esc(i.organisation) || '<span class="muted">not set</span>'], ["Version", `<b>${esc(i.version)}</b>`],
        ["Build", esc(i.build.number)], ["Commit", `<code>${esc(i.build.commit)}</code>`], i.build.date && ["Built", esc(new Date(i.build.date).toLocaleString())], ["Database schema", i.schema],
        ["Licence", `${pill(i.licence.valid, "Licensed", "Not licensed")} ${esc(i.licence.licensee)} · <a href="#/licence">details</a>`]])}</div>
      <div class="panel"><h2>Server</h2>${kv([["Hostname", `<b>${esc(sv.hostname)}</b>`], ["Addresses", sv.ips.map(esc).join(", ") || "–"],
        ["Opened as", `<code>${esc(location.origin)}</code>`], sv.public_url && ["Public address", esc(sv.public_url)], ["Running in", sv.in_docker ? "Docker" : "Python (no container)"],
        ["Up for", ago(sv.uptime_seconds)], sv.system_uptime_seconds != null && ["Machine up for", ago(sv.system_uptime_seconds)], ["Server time", `${esc(new Date(sv.time).toLocaleString())} (${esc(sv.timezone)})`],
        ["Site time zones", Object.entries(sv.site_timezones).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join("<br>")]])}</div>
      <div class="panel"><h2>Nodes</h2>${kv([["All nodes", on(n)], ...Object.entries(kinds).map(([k, v]) => [v, on(n.by_kind[k])]), ["Main PCs", n.tech_main], ["Backup PCs", n.tech_backup],
        ["Live connections", `${i.websockets} <span class="muted small">(browsers, laptops and screens)</span>`]])}</div>
      <div class="panel"><h2>Apps and agents</h2>${kv([["Windows tech app", i.apps.windows_app ? esc(i.apps.windows_app) : '<span class="muted">not published</span>'], ["Screen agent", esc(i.apps.screen_agent || "–")],
        ["Node agent", esc(i.apps.node_agent || "–")], ["Old kiosk agent", esc(i.apps.kiosk_agent || "not published")]])}<p class="small"><a href="#/laptops/setup">Node setup and downloads</a></p></div>
      <div class="panel"><h2>Venue</h2>${kv([["Sites", c.sites], ["Rooms", c.rooms], ["Accounts", `${c.accounts} <span class="muted small">(${Object.entries(c.accounts_by_role).map(([k, v]) => `${v} ${esc(k)}`).join(", ")})</span>`],
        ["Links", c.links], ["API keys", c.api_keys], ["Chat messages", c.messages], ["Help requests", `${c.help_requests} (${c.open_help_requests} open)`]])}</div>
      <div class="panel"><h2>Modules</h2>${kv(Object.entries(i.modules).map(([k, v]) => [MODNAMES[k] || k, pill(v, "on", "off")]))}</div>
      <div class="panel"><h2>Captions</h2>${kv([["Engine", `${pill(i.captions.state === "ready", esc(i.captions.state), esc(i.captions.state))}`], i.captions.detail && ["Detail", esc(i.captions.detail)], ["Model", `<span class="small">${esc(i.captions.model)}</span>`],
        ["Rooms captioning", `${i.captions.active_rooms} of ${i.captions.max_rooms} max`]])}</div>
      <div class="panel"><h2>Storage</h2>${kv([["Data folder", `<code>${esc(st.data_dir)}</code>`], ["Database", bytes(st.db_bytes)], ["Uploads", bytes(st.uploads_bytes)], ["Transcripts", bytes(st.transcripts_bytes)],
        ["Presenter files", `${bytes(st.presenter_bytes)} <div class="small muted">${esc(st.presenter_dir)}</div>`], st.disk.total && ["Disk free", `${bytes(st.disk.free)} of ${bytes(st.disk.total)}`],
        ["Last backup", i.last_backup ? `${when(i.last_backup.at)} by ${esc(i.last_backup.actor)}` : '<span class="pill warn">never</span>']])}</div>
      <div class="panel"><h2>Software</h2>${kv([["Python", esc(sv.python)], ["FastAPI", esc(sv.fastapi)], ["Uvicorn", esc(sv.uvicorn)], ["SQLite", esc(sv.sqlite)], ["CPUs", sv.cpus], ["OS", `<span class="small">${esc(sv.os)}</span>`],
        ["Your browser", `<span class="small">${esc(navigator.userAgent)}</span>`]])}</div>
      </div>`;
    a.querySelector("#refresh").onclick = () => admInfo(a);
    a.querySelector("#bugOpen").onclick = () => AT.reportBug();
    a.querySelector("#copyInfo").onclick = () => copyText(`${i.product} ${i.version} (build ${i.build.number}, ${i.build.commit}) on ${sv.hostname}\nOpened as ${location.origin}\n\n${JSON.stringify(i, null, 2)}`, "Copied, paste it into the ticket");
  }

  // Bug reports: what people sent with Report a bug (About, or the Help menu on a tech laptop).
  // Admins read them, tick them off, and can open a GitHub issue for one.
  let bugPick = null, bugAll = false;
  async function admBugs(a) {
    const d = await api(`/api/admin/bugs${bugAll ? "" : "?status=open"}`), s = d.settings;
    if (bugPick && !d.reports.some((r) => r.id === bugPick)) bugPick = null;
    bugPick ??= d.reports[0]?.id ?? null;
    const who = (r) => `${esc(r.reporter)}${r.room_name ? ` · ${esc(r.room_name)}` : ""} <span class="muted">(${r.reporter_kind === "node" ? "tech laptop" : "console"})</span>`;
    a.innerHTML = `<div class="row" style="margin-bottom:1rem"><div class="seg" role="group" aria-label="Show"><button type="button" data-all="0" class="${bugAll ? "" : "on"}" aria-pressed="${!bugAll}">Open (${d.open})</button><button type="button" data-all="1" class="${bugAll ? "on" : ""}" aria-pressed="${bugAll}">All</button></div>
        <span class="grow"></span><button id="bugNew">Report a bug</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))">
      <div class="panel">${d.reports.length ? `<table><tr><th>Report</th><th>From</th><th>When</th></tr>${d.reports.map((r) => `<tr class="bugrow${r.id === bugPick ? " on" : ""}" data-bug="${r.id}">
          <td><button type="button" class="bugpick">${esc(r.title)}</button>${r.status === "resolved" ? ' <span class="pill good">resolved</span>' : ""}${r.github_url ? ' <span class="pill">on GitHub</span>' : ""}${r.has_screenshot ? ' <span class="muted small">· screenshot</span>' : ""}
          <div class="small muted">${esc(r.description.slice(0, 120))}</div></td><td class="small">${who(r)}</td><td class="small muted">${when(r.created_at)}</td></tr>`).join("")}</table>`
        : `<p class="muted">${bugAll ? "No bug reports yet." : "No open bug reports."} People send them with Report a bug in Settings → About, or in the Help menu on a tech laptop.</p>`}</div>
      <div class="panel" id="bugOne"><p class="muted">Pick a report to read it.</p></div></div>
      <form class="panel" id="bugGh" style="margin-top:1rem"><h2>Send to GitHub (optional)</h2>
        <p class="small muted" style="margin-top:0">Off until you add a repository and token: reports stay on this server. With them, a report can open an issue in your GitHub repository. The issue gets the title, what happened, and the version and system. Never names, the organisation, rooms, addresses or the screenshot, as repositories can be public.</p>
        <label>Repository (owner/name)</label><input name="repo" placeholder="my-company/at-suite-bugs" value="${esc(s.github_repo)}" autocomplete="off">
        <label>GitHub token</label><input name="token" type="password" autocomplete="off" placeholder="${s.has_token ? "Saved. Type a new one to replace it" : "A fine-grained token with Issues: read and write"}">
        ${s.has_token ? '<label><input type="checkbox" name="rmtoken" style="width:auto"> Remove the saved token</label>' : ""}
        <label><input type="checkbox" name="auto" ${s.auto_github ? "checked" : ""} style="width:auto"> Open an issue for every new report by itself</label>
        <div class="row" style="margin-top:.8rem"><button class="primary">Save</button>${s.github_ready ? '<span class="pill good">Ready</span>' : '<span class="pill">Off</span>'}</div></form>`;
    a.querySelectorAll("[data-all]").forEach((b) => b.onclick = () => { bugAll = b.dataset.all === "1"; admBugs(a); });
    a.querySelector("#bugNew").onclick = () => AT.reportBug();
    a.querySelectorAll("[data-bug]").forEach((tr) => tr.onclick = () => { bugPick = +tr.dataset.bug; a.querySelectorAll(".bugrow").forEach((x) => x.classList.toggle("on", x === tr)); one(); });
    const g = a.querySelector("#bugGh");
    g.onsubmit = (e) => {
      e.preventDefault();
      const token = g.rmtoken?.checked ? "" : (g.token.value.trim() || null);
      guard(() => put("/api/admin/bugs/settings", { github_repo: g.repo.value.trim(), token, auto_github: g.auto.checked })).then(() => { toast("Saved", "good"); admBugs(a); });
    };
    async function one() {
      const box = a.querySelector("#bugOne");
      if (!bugPick) return;
      const r = await api(`/api/admin/bugs/${bugPick}`), sy = r.system || {};
      box.innerHTML = `<h2>${esc(r.title)}</h2><p class="small muted" style="margin-top:0">From ${who(r)}, ${when(r.created_at)}${r.status === "resolved" ? `. Resolved by ${esc(r.resolved_by || "")} ${when(r.resolved_at)}` : ""}</p>
        <div style="white-space:pre-wrap">${esc(r.description) || '<span class="muted">No details given.</span>'}</div>
        ${r.has_screenshot ? `<p><a href="/api/admin/bugs/${r.id}/screenshot" target="_blank" rel="noopener"><img class="bugshot" src="/api/admin/bugs/${r.id}/screenshot" alt="Screenshot sent with the report"></a></p>` : ""}
        ${kv([["Version", `${esc(sy.version || "?")} <span class="muted small">build ${esc(sy.build || "?")}, ${esc(sy.commit || "?")}, schema ${esc(sy.schema ?? "?")}</span>`], ["Server", `<span class="small">${esc(sy.running_in || "")} on ${esc(sy.os || "?")}</span>`],
          r.app_version && ["Laptop app", esc(r.app_version)], r.page && ["Page", `<code>${esc(r.page)}</code>`], r.user_agent && ["Browser", `<span class="small">${esc(r.user_agent)}</span>`],
          r.github_url && ["GitHub", `<a href="${esc(r.github_url)}" target="_blank" rel="noopener">${esc(r.github_url.replace("https://github.com/", ""))}</a>`],
          !r.github_url && r.github_error && ["GitHub", `<span class="pill bad">not sent</span> <span class="small">${esc(r.github_error)}</span>`]])}
        <div class="row" style="margin-top:.8rem">${r.status === "open" ? '<button class="primary" data-st="resolved">Mark resolved</button>' : '<button data-st="open">Open again</button>'}
          ${s.github_ready && !r.github_url ? '<button id="bugGhSend">Send to GitHub</button>' : ""}<span class="grow"></span><button class="danger" id="bugDel">Delete</button></div>`;
      box.querySelector("[data-st]").onclick = (e) => guard(() => put(`/api/admin/bugs/${r.id}`, { status: e.target.dataset.st })).then(() => admBugs(a));
      box.querySelector("#bugGhSend")?.addEventListener("click", (e) => { e.target.disabled = true; guard(() => post(`/api/admin/bugs/${r.id}/github`)).then(() => { toast("Issue opened on GitHub", "good"); admBugs(a); }, () => { e.target.disabled = false; one(); }); });
      // Two presses to delete, so nothing goes by accident (no browser pop-ups: they don't work in the laptop app).
      const del_ = box.querySelector("#bugDel");
      del_.onclick = () => {
        if (!del_.dataset.sure) { del_.dataset.sure = "1"; del_.textContent = "Press again to delete"; setTimeout(() => { if (del_.isConnected) { delete del_.dataset.sure; del_.textContent = "Delete"; } }, 4000); return; }
        guard(() => del(`/api/admin/bugs/${r.id}`)).then(() => { bugPick = null; admBugs(a); });
      };
    }
    one();
    // New reports show as they come in, but not while the GitHub settings are being typed.
    view = { onEvent: (e) => e.type.startsWith("bug.") && !g.contains(document.activeElement) && admBugs(a) };
  }

  async function admLicence(a) {
    const l = await api("/api/admin/licence");
    const lim = (k) => { const used = l.usage[k], max = l.limits[k]; return `${used} used of ${max || "unlimited"}${max && used >= max ? ' <span class="pill warn">full</span>' : ""}`; };
    const STATES = { active: ["good", "Licensed"], expiring: ["warn", "Ending soon"], grace: ["bad", "In grace period"], lapsed: ["bad", "Expired"], invalid: ["bad", "Not valid"], none: ["bad", "Not licensed"], revoked: ["bad", "Cancelled"], unchecked: ["bad", "Not checked in"] };
    const [tone, label] = STATES[l.state] || STATES.none;
    const state = `<span class="pill ${tone}">${label}</span>${l.locked ? ' <span class="pill bad">Locked</span>' : ""}`;
    const extra = Object.entries(l.payload).filter(([k]) => !["licensee", "edition", "expires", "issued", "max_nodes", "max_sites", "modules", "serial", "id", "checkin"].includes(k));
    // Keys from the website check in with it every day; offline keys don't.
    const ci = l.checkin;
    const ciRows = !l.installed ? [] : !ci ? [["Daily check", '<span class="muted small">Offline key: never checks in</span>']] : [
      ["Daily check", `${ci.revoked ? '<span class="pill bad">cancelled</span>' : ci.error ? '<span class="pill warn">failing</span>' : ci.last_ok ? '<span class="pill good">ok</span>' : '<span class="pill">not yet</span>'} <span class="muted small">${esc(ci.url)}</span>`],
      ["Last reached", ci.last_ok ? date(ci.last_ok) : "Not yet"],
      ci.error && ["Last try", `${date(ci.last_try)} <span class="small">${esc(ci.error)}</span>`],
      ["Must reach it by", `${date(ci.deadline)} <span class="muted small">then it locks, never during a show</span>`]];
    a.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"><div class="panel"><h2>Licence</h2><p>${state} ${l.reason ? `<span class="muted">${esc(l.reason)}</span>` : ""}</p>
      ${kv([["Licensed to", `<b>${esc(l.licensee)}</b>`], ["Edition", esc(l.edition)], ["Serial", l.serial ? `<code>${esc(l.serial)}</code>` : "–"], ["Issued", date(l.issued) || "–"],
        ["Expires", l.expires ? `${date(l.expires)} <span class="pill ${l.days_left < 30 ? "warn" : ""}">${l.days_left} days left</span>` : l.installed ? "Never" : "–"],
        l.grace_until && ["Grace until", `${date(l.grace_until)} <span class="muted small">then it locks, never during a show</span>`],
        ["Modules", l.modules.map((m) => `<span class="pill">${esc(m)}</span>`).join(" ")], ...ciRows, ...extra.map(([k, v]) => [k, esc(typeof v === "object" ? JSON.stringify(v) : String(v))])])}
      ${ci ? '<div class="row" style="margin-top:.6rem"><button class="small" id="checkNow">Check now</button><span class="muted small">Fetches a renewed key, if there is one</span></div>' : ""}</div>
      <div class="panel"><h2>Limits</h2>${kv([["Sites", lim("sites")], ["Nodes", lim("nodes")], ["Rooms", `${l.usage.rooms} (no limit)`]])}
      <h2 style="margin-top:1rem">Check</h2>${kv([["Signature", l.installed ? (l.signature_valid ? '<span class="pill good">valid</span>' : '<span class="pill bad">not valid</span>') : "no key installed"],
        ["Vendor key", `<code>${esc(l.vendor_key_id || "none")}</code> <span class="muted small">${esc(l.vendor_key_source)}</span>`], ["Stored in", `<span class="small">${esc(l.stored_in)}</span>`]])}</div></div>
      <div class="panel" style="margin-top:1rem"><h2>Licence key</h2>${l.raw ? `<textarea rows="3" readonly id="raw" aria-label="Licence key">${esc(l.raw)}</textarea><div class="row" style="margin-top:.4rem"><button class="small" id="copyKey">Copy key</button><button class="small danger" id="rmKey">Remove licence</button></div>` : '<p class="muted small">No key installed. AT-SUITE needs a licence key to work.</p>'}
      <label style="margin-top:1rem">Install a new key</label><textarea id="key" rows="3" placeholder="Paste the key from your supplier"></textarea><div class="row" style="margin-top:.6rem"><button class="primary" id="save">Install licence</button></div></div>`;
    a.querySelector("#copyKey") && (a.querySelector("#copyKey").onclick = () => copyText(l.raw, "Key copied"));
    a.querySelector("#checkNow")?.addEventListener("click", (e) => {
      e.target.disabled = true;
      guard(() => post("/api/admin/licence/checkin")).then((r) => { toast(r.error ? r.error : "Checked in", r.error ? "bad" : "good"); admLicence(a); }, () => { e.target.disabled = false; });
    });
    a.querySelector("#save").onclick = () => {
      if (!a.querySelector("#key").value.trim()) return toast("Paste the licence key first", "bad");
      guard(() => put("/api/admin/licence", { key: a.querySelector("#key").value })).then(() => location.reload());
    };
    a.querySelector("#rmKey") && (a.querySelector("#rmKey").onclick = () => confirm("Remove this licence? AT-SUITE stops working (at the next quiet moment) until a key is added again.") &&
      guard(() => put("/api/admin/licence", { key: "", remove: true })).then(() => location.reload()));
  }

  async function admSites(a) {
    const sites = await api("/api/admin/sites");
    boot = await api("/api/bootstrap");
    a.innerHTML = sites.map((s) => `<div class="panel" style="margin-bottom:1rem" data-site="${s.id}">
      ${isAdminRole ? `<div class="row"><input data-sn aria-label="Site name" value="${esc(s.name)}" class="grow"><input data-tz aria-label="Time zone" value="${esc(s.timezone)}" list="zones" style="width:12rem"><button class="small" data-save>Save</button>${sites.length > 1 ? '<button class="small danger" data-delsite>Delete site</button>' : ""}</div>` : `<h2>${esc(s.name)}</h2>`}
      <table style="margin-top:.6rem"><tr><th>Order</th><th>Room</th><th>Short name</th><th>On</th><th></th></tr>
      ${boot.rooms.filter((r) => r.site_id === s.id).map((r) => `<tr data-r="${r.id}"><td><input data-sort type="number" value="${r.sort}" style="width:4.5rem"></td><td><input data-name value="${esc(r.name)}"></td><td><input data-short value="${esc(r.short_name)}" style="width:7rem"></td>
        <td><input type="checkbox" data-en ${r.enabled ? "checked" : ""} style="width:auto"></td><td class="row"><button class="small" data-rsave>Save</button><button class="small danger" data-rdel>Delete</button></td></tr>`).join("")}
      <tr><td></td><td><input data-newroom placeholder="New room name"></td><td></td><td></td><td><button class="small primary" data-add>Add room</button></td></tr></table></div>`).join("") +
      `<datalist id="zones">${(Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).map((z) => `<option value="${z}">`).join("")}</datalist>` +
      (isAdminRole ? `<form class="panel row" id="ns"><input name="name" class="grow" placeholder="New site (venue) name" required><button class="primary">Add site</button></form>` : "");
    a.querySelectorAll("[data-site]").forEach((p) => {
      const sid = +p.dataset.site;
      p.querySelector("[data-save]") && (p.querySelector("[data-save]").onclick = () => guard(() => put(`/api/admin/sites/${sid}`, { name: p.querySelector("[data-sn]").value, timezone: p.querySelector("[data-tz]").value })).then(() => toast("Saved", "good")));
      p.querySelector("[data-delsite]") && (p.querySelector("[data-delsite]").onclick = () => confirm("Delete this site and all its rooms, chat and links?") && guard(() => del(`/api/admin/sites/${sid}`)).then(() => admSites(a)));
      p.querySelector("[data-add]").onclick = () => guard(() => post("/api/admin/rooms", { site_id: sid, name: p.querySelector("[data-newroom]").value })).then(() => admSites(a));
      p.querySelectorAll("[data-r]").forEach((row) => {
        const rid = +row.dataset.r;
        row.querySelector("[data-rsave]").onclick = () => guard(() => put(`/api/admin/rooms/${rid}`, { site_id: sid, name: row.querySelector("[data-name]").value, short_name: row.querySelector("[data-short]").value, sort: +row.querySelector("[data-sort]").value, enabled: row.querySelector("[data-en]").checked })).then(() => toast("Saved", "good"));
        row.querySelector("[data-rdel]").onclick = () => confirm("Delete this room, its chat and its timer?") && guard(() => del(`/api/admin/rooms/${rid}`)).then(() => admSites(a));
      });
    });
    const f = a.querySelector("#ns");
    if (f) f.onsubmit = (e) => { e.preventDefault(); guard(() => post("/api/admin/sites", { name: f.name.value })).then(() => admSites(a)); };
  }

  async function admAccounts(a) {
    const [accts, sites] = await Promise.all([api("/api/admin/accounts"), api("/api/admin/sites")]);
    view = { onEvent: (e) => e.type === "account.reset" && admAccounts(a) };
    const mine = boot.me.site_id; // someone kept to one site can only add people to it
    const siteOpts = (sel) => (mine == null ? `<option value="">All sites</option>` : "") + sites.map((s) => `<option value="${s.id}" ${s.id === (sel ?? mine) ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    // A manager looks after techs and viewers; admin and manager accounts are shown but only an admin changes them.
    const roles = isAdminRole ? ["admin", "manager", "tech", "viewer"] : ["tech", "viewer"];
    const canEdit = (u) => isAdminRole || u.id === boot.me.id || roles.includes(u.role);
    const roleOpts = (sel) => (roles.includes(sel) ? roles : [sel]).map((r) => `<option ${r === sel ? "selected" : ""}>${r}</option>`).join("");
    // Forgot password: one press puts it back to ChangeMe, which they change at their next sign-in.
    const asking = accts.filter((u) => u.reset_asked_at && canEdit(u) && u.id !== boot.me.id);
    const resetBtn = (u, label) => `<button class="small" data-reset="${u.id}" data-name="${esc(u.display_name)}">${label}</button>`;
    a.innerHTML = (asking.length ? `<div class="panel" style="border-color:var(--warn)"><h2>Forgot their password</h2>
      ${asking.map((u) => `<div class="row" style="justify-content:space-between"><span><b>${esc(u.display_name)}</b> <span class="muted small">(${esc(u.username)}) asked ${esc(AT.when(u.reset_asked_at))}</span></span>${resetBtn(u, "Reset to ChangeMe")}</div>`).join("")}
      <p class="muted small" style="margin-bottom:0">Check it's really them first. They sign in with ChangeMe and choose a new password straight away.</p></div>` : "") +
      `<div class="panel"><p class="muted small">New people sign in with the password you give them (or ChangeMe if you leave it blank) and choose their own at their first sign-in. A password you set for someone has to be changed the same way.</p><p class="muted small">Admins configure everything. Managers set up rooms, add techs, move laptops between rooms and read the audit log, but can't change site settings, the licence, branding or views, or add laptops. Techs chat, run timers, send captions and control nodes. Viewers can read.</p><table><tr><th>Username</th><th>Name</th><th>Role</th><th>Site</th><th>Active</th><th>New password</th><th></th></tr>
      ${accts.filter((u) => !canEdit(u)).map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.display_name)}</td><td>${esc(u.role)}</td><td class="muted small" colspan="4">Only an admin can change this account.</td></tr>`).join("")}
      ${accts.filter(canEdit).map((u) => `<tr data-u="${u.id}"><td><input data-un value="${esc(u.username)}"></td><td><input data-dn value="${esc(u.display_name)}"></td><td><select data-role ${u.id === boot.me.id ? 'disabled title="You can\'t change your own role"' : ""}>${roleOpts(u.role)}</select></td>
        <td><select data-site>${siteOpts(u.site_id)}</select></td><td><input type="checkbox" data-act ${u.active ? "checked" : ""} ${u.id === boot.me.id ? "disabled" : ""} style="width:auto"></td><td><input data-pw type="password" placeholder="unchanged">${u.must_change ? '<div class="muted small">Chooses a new one at next sign-in</div>' : ""}</td>
        <td class="row"><button class="small" data-save>Save</button>${u.id === boot.me.id ? "" : resetBtn(u, "Reset password") + '<button class="small danger" data-del>Delete</button>'}</td></tr>`).join("")}
      <tr id="new"><td><input data-un placeholder="username"></td><td><input data-dn placeholder="Display name"></td><td><select data-role>${roleOpts("tech")}</select></td><td><select data-site>${siteOpts(null)}</select></td><td></td><td><input data-pw type="password" placeholder="blank = ChangeMe"></td><td><button class="small primary" data-add>Add</button></td></tr></table></div>`;
    const read = (row) => ({ username: row.querySelector("[data-un]").value, display_name: row.querySelector("[data-dn]").value, role: row.querySelector("[data-role]").value,
      site_id: row.querySelector("[data-site]").value ? +row.querySelector("[data-site]").value : null, active: row.querySelector("[data-act]") ? row.querySelector("[data-act]").checked : true, password: row.querySelector("[data-pw]").value || null });
    a.querySelectorAll("[data-u]").forEach((row) => {
      row.querySelector("[data-save]").onclick = () => guard(() => put(`/api/admin/accounts/${row.dataset.u}`, read(row))).then(() => toast("Saved", "good"));
      row.querySelector("[data-del]") && (row.querySelector("[data-del]").onclick = () => confirm("Delete this account?") && guard(() => del(`/api/admin/accounts/${row.dataset.u}`)).then(() => admAccounts(a)));
    });
    a.querySelector("[data-add]").onclick = () => guard(() => post("/api/admin/accounts", read(a.querySelector("#new")))).then(() => admAccounts(a));
    a.querySelectorAll("[data-reset]").forEach((b) => b.onclick = () =>
      confirm(`Reset ${b.dataset.name}'s password to ChangeMe? They're signed out, and choose a new one when they sign in.`) &&
      guard(() => post(`/api/admin/accounts/${b.dataset.reset}/reset`)).then((r) => { if (r) { toast(`${b.dataset.name} can sign in with ChangeMe now`, "good"); refreshResets(); admAccounts(a); } }));
  }

  async function admLinks(a) {
    const links = await api("/api/dashboard/links");
    const kinds = ["link", "timer", "buttons", "kiosk", "device", "tool"];
    const row = (l = {}) => `<tr data-l="${l.id || ""}"><td><input data-label value="${esc(l.label || "")}" placeholder="Label"></td><td><input data-url value="${esc(l.url || "")}" placeholder="http://"></td>
      <td><select data-room>${roomOptions(l.room_id, "Whole site")}</select></td><td><select data-board>${(isAdminRole ? ["public", "admin"] : ["public"]).map((b) => `<option ${b === l.board ? "selected" : ""}>${b}</option>`).join("")}</select></td>
      <td><select data-kind>${kinds.map((k) => `<option ${k === l.kind ? "selected" : ""}>${k}</option>`).join("")}</select></td>
      <td class="row">${l.id ? '<button class="small" data-save>Save</button><button class="small danger" data-del>Delete</button>' : '<button class="small primary" data-save>Add</button>'}</td></tr>`;
    a.innerHTML = `<div class="panel"><p class="small" style="margin-top:0"><b>What these are:</b> shortcuts to other web pages (a Companion button page, a room's camera control, a tool). Pick <b>Whole site</b> to show a link to everyone on the Dashboard, or pick a <b>room</b> so it appears only in that room's tech workspace, under <b>Links</b>. <b>Admin</b> links are only shown to admins. The <b>kind</b> only decides the heading it is grouped under. You don't have to add any: the workspace works without them.</p>
      <table><tr><th>Label</th><th>URL</th><th>Room</th><th>Board</th><th>Kind</th><th></th></tr>${row()}${links.map(row).join("")}</table></div>`;
    a.querySelectorAll("[data-l]").forEach((tr) => {
      const body = () => ({ label: tr.querySelector("[data-label]").value, url: tr.querySelector("[data-url]").value, board: tr.querySelector("[data-board]").value, kind: tr.querySelector("[data-kind]").value,
        room_id: tr.querySelector("[data-room]").value ? +tr.querySelector("[data-room]").value : null, site_id: boot.me.site_id ?? null }); // a room's link goes to the room's site (the server sets it)
      const id = tr.dataset.l;
      tr.querySelector("[data-save]").onclick = () => guard(() => id ? put(`/api/dashboard/links/${id}`, body()) : post("/api/dashboard/links", body())).then(() => id ? toast("Saved", "good") : admLinks(a));
      tr.querySelector("[data-del]") && (tr.querySelector("[data-del]").onclick = () => confirm("Delete this link?") && guard(() => del(`/api/dashboard/links/${id}`)).then(() => admLinks(a)));
    });
  }

  async function admFleet(a, part = "windows") {
    const origin = location.origin;
    let sites;
    try { sites = await api("/api/fleet/enrolment"); }
    catch (_) { a.innerHTML = '<div class="panel card"><p class="muted">The fleet module is turned off. Turn it on in <a href="#/settings/general">General</a> to add laptops and screens.</p></div>'; return; }
    const [winApp, info] = await Promise.all([api("/api/nodes/app").catch(() => ({})), api("/api/admin/info")]);
    const code = sites[0]?.enrol_code || "CODE";
    const parts = { windows: "Windows tech app", screens: "Linux screens", ...(boot.modules.presenter ? { sync: "Room sync (presentation laptops)" } : {}), older: "Older agents" };
    if (!parts[part]) part = "windows";
    const cmd = (text) => `<div class="cmd"><code>${esc(text)}</code><button class="small" data-copy="${esc(text)}">Copy</button></div>`;
    const dl = (href, label, primary) => `<a class="btn${primary ? " primary" : ""}" href="${esc(href)}" download>${label}</a>`;
    const nodeJson = JSON.stringify({ server: origin, enrol_code: code }, null, 2);
    const sections = {
      windows: `<h2>AT-SUITE Node for Windows</h2><p class="small muted">The tech workspace app for the laptops in each room: timer, cue list, chat, help calls and pop-ups.</p>
        <div class="row" style="margin:.6rem 0">${winApp.ready ? dl(`/api/nodes/app/${encodeURIComponent(winApp.file)}`, `Download AT-SUITE Node ${esc(winApp.version)} (.exe)`, true) : '<span class="pill warn">No Windows app published yet</span> <span class="small muted">Upload one below.</span>'}</div>
        <h3>Install</h3><ol class="small"><li>Download and run the installer on the laptop. It isn't code-signed yet, so Windows asks once: <b>More info → Run anyway</b>.</li>
          <li>Enter this server's address <code>${esc(origin)}</code>, the enrolment code above (or press <b>Admin sign-in</b> and sign in as an admin) and a laptop name. This is a one-off; the laptop stays enrolled.</li>
          <li>Each day a tech types their name, picks the room and chooses <b>Main PC</b> or <b>Backup PC</b>. It resets every morning.</li>
          <li>Pop-ups only show on the backup PC. They're silent and sit on top of everything.</li>
          <li>Moving a laptop from another AT-SUITE server: on the laptop, <b>Connect to a different server</b> in the tray menu, then an admin of this server signs in.</li></ol>
        <h3>Silent install (IT)</h3><p class="small muted">Put this in <code>C:\\ProgramData\\AT-SUITE\\node.json</code>, then run the installer with <code>/S</code>. The app enrols under the PC's name on first start.</p>
        <pre class="small">${esc(nodeJson)}</pre><div class="row"><button class="small" id="dlJson">Download node.json</button><button class="small" data-copy="${esc(nodeJson)}">Copy</button></div>
        <h3>Publish a new version</h3><p class="small muted">The .exe, .blockmap and latest.yml from the GitHub release. Laptops update as their app starts, when the tech presses Update now, or when the app closes; never by themselves during a show.</p>
        <div class="row"><input type="file" id="appFiles" class="grow" multiple accept=".exe,.blockmap,.yml"><button class="small" id="upApp">Publish app</button></div>
        <p class="small muted">A browser at <code>${esc(origin)}/node</code> works too, without installing anything.</p>`,
      screens: `<h2>Linux screens</h2><p class="small muted">Laptops and all-in-ones that only show a timer, captions or a view. Agent ${esc(info.apps.screen_agent || "–")}. Screens update themselves.</p>
        <h3>Install</h3><p class="small">Run this once on the screen, as the user logged in to the desktop (X11, automatic login on). Change the name for each screen.</p>
        ${cmd(`curl -fsSL ${origin}/screen-agent/install.sh | bash -s -- --server ${origin} --code ${code} --name HD-STAGE-1 --allow-power`)}
        <p class="small muted">Leave out <code>--allow-power</code> if the console shouldn't be able to reboot it. With HDMI plugged in, it shows only on HDMI. Then pick what it shows in <a href="#/timers">Timers → Screens</a>.</p>
        <h3>Downloads</h3><div class="row">${dl("/screen-agent/install.sh", "install.sh")}${dl("/screen-agent/atsuit_screen.py", "Screen agent (atsuit_screen.py)")}</div>
        <p class="small muted">No agent? Any browser can be a screen: open <code>${esc(origin)}/screen</code> and enter a name and the enrolment code.</p>`,
      sync: `<h2>Room sync for presentation laptops</h2><p class="small muted">Keeps a folder on the room's presentation laptop with every session's approved slides and show files. Needs Python 3.8 or later, nothing else.</p>
        <div class="row" style="margin:.6rem 0">${dl("/api/presenter/room-sync/atsuit_room_sync.py", "Download atsuit_room_sync.py", true)}</div>
        <h3>Set up</h3><ol class="small"><li>Make the room's sync code in <a href="#/presenter">Presenters → Settings</a>. It's not the enrolment code.</li><li>On the laptop run:</li></ol>
        ${cmd(`python atsuit_room_sync.py --server ${origin} --code ROOM-CODE`)}
        <p class="small muted">The first run saves the settings, so after that <code>python atsuit_room_sync.py</code> is enough. Put it in the laptop's startup.</p>`,
      older: `<h2>Node agent (Python)</h2><p class="small muted">Sends captions from a laptop without a browser, or runs a kiosk. Version ${esc(info.apps.node_agent || "–")}. Agents update themselves on their next check-in.</p>
        <div class="row" style="margin:.6rem 0">${dl("/api/admin/downloads/atsuit_node.py", "Download atsuit_node.py")}</div>
        ${cmd(`python atsuit_node.py --server ${origin} --code ${code} --name ATLAP3 --room CC --mic`)}
        <label>Publish a newer agent</label><div class="row"><input type="file" id="agentFile" class="grow" accept=".py"><button class="small" id="upAgent">Publish agent</button></div>
        <h2 style="margin-top:1.4rem">Device Suite kiosk agent</h2><p class="small muted">Kiosks running the old Device Suite agent report here without reinstalling: point their server address at <code>${esc(origin)}</code>. ${info.settings.legacy_fleet_api ? "" : '<span class="pill warn">Turned off in General</span>'} Reboot, shut down and update go over SSH, so upload the fleet key.</p>
        <div class="row" style="margin:.6rem 0">${info.apps.kiosk_agent ? dl("/api/admin/downloads/kiosk-agent", `Download kiosk agent ${esc(info.apps.kiosk_agent)}`) : '<span class="muted small">No kiosk agent release published.</span>'}</div>
        <label>Publish a kiosk agent release (script)</label><div class="row"><input type="file" id="rel" class="grow"><input id="ver" placeholder="version, e.g. 2.0.4" style="width:9rem"><button class="small" id="upRel">Publish</button></div>
        <label>Fleet SSH private key</label><div class="row"><input type="file" id="key" class="grow"><button class="small" id="upKey">Upload key</button></div>`,
    };
    a.innerHTML = `<div class="panel" style="margin-bottom:1rem"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 style="margin:0">Enrolment</h2><span class="small muted">Server address <code>${esc(origin)}</code> <button class="small" data-copy="${esc(origin)}">Copy</button></span></div>
        <p class="small muted">Laptops and screens join with the site's code. A new code stops the old one working for new devices; ones already enrolled carry on. Print the <a href="/guide/tech" target="_blank">tech quick-start card</a> to leave by each laptop.</p>
        ${sites.map((s) => `<div class="row enrol"><b class="grow">${esc(s.name)}</b><code class="code">${esc(s.enrol_code)}</code><button class="small" data-copy="${esc(s.enrol_code)}">Copy</button><button class="small" data-new="${s.id}">New code</button></div>`).join("")}</div>
      <div class="tabs sub">${Object.entries(parts).map(([k, v]) => `<button class="${k === part ? "on" : ""}" data-part="${k}">${v}</button>`).join("")}</div>
      <div class="panel" id="part">${sections[part]}</div>`;
    a.querySelectorAll("[data-part]").forEach((b) => b.onclick = () => admFleet(a, b.dataset.part));
    a.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => copyText(b.dataset.copy));
    a.querySelectorAll("[data-new]").forEach((b) => b.onclick = () => confirm("Make a new code? The old one stops working for new laptops and screens.") && guard(() => post(`/api/admin/sites/${b.dataset.new}/enrol-code`)).then(() => admFleet(a, part)));
    const on = (id, fn) => { const e = a.querySelector(id); e && (e.onclick = fn); };
    on("#dlJson", () => { const u = URL.createObjectURL(new Blob([nodeJson], { type: "application/json" })), l = document.createElement("a"); l.href = u; l.download = "node.json"; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); });
    on("#upApp", () => {
      const files = [...a.querySelector("#appFiles").files];
      if (!files.length) return toast("Choose the release files first (Setup .exe and latest.yml)", "bad");
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      guard(() => api("/api/fleet/app", { method: "POST", form: fd })).then((r) => { toast(`AT-SUITE Node ${r.version} published`, "good"); admFleet(a, part); });
    });
    on("#upAgent", () => { const f = a.querySelector("#agentFile").files[0]; if (!f) return toast("Choose the agent file first", "bad"); guard(() => upload("/api/fleet/agent", f)).then((r) => { toast(`Agent ${r.version} published`, "good"); admFleet(a, part); }); });
    on("#upKey", () => { const f = a.querySelector("#key").files[0]; if (!f) return toast("Choose the key file first", "bad"); guard(() => upload("/api/fleet/ssh-key", f)).then(() => toast("Key saved", "good")); });
    on("#upRel", () => { const f = a.querySelector("#rel").files[0], v = a.querySelector("#ver").value.trim(); if (!f || !v) return toast(!f ? "Choose the release file first" : "Type the version number first", "bad"); guard(() => upload(`/api/fleet/client-release?version=${encodeURIComponent(v)}`, f)).then(() => { toast("Published", "good"); admFleet(a, part); }); });
  }

  async function admOverlays(a) {
    // Setup only: techs control a room's overlays from their workspace.
    const targets = await api("/api/overlays/targets");
    a.innerHTML = `<div class="panel card" style="max-width:900px"><h2>Overlay laptops</h2>
      <p class="small muted">Each laptop running AT LiveOverlay shows its address and API token under Remote Control in its tray menu. Give it a room and the techs in that room get its controls in their workspace.</p>
      <table>${targets.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td class="small">${esc(t.base_url)}</td><td>${esc(t.room || "No room")}</td><td><button class="small danger" data-del="${t.id}">Remove</button></td></tr>`).join("") || '<tr><td class="muted">None yet.</td></tr>'}</table>
      <form class="row" id="addT" style="margin-top:.6rem;flex-wrap:wrap"><input name="name" placeholder="Name, e.g. CC Lectern" required style="width:12rem">
        <input name="base_url" placeholder="http://10.100.70.88:8765" required class="grow"><input name="token" placeholder="API token" style="width:14rem">
        <select name="room_id" aria-label="Room" style="width:10rem">${roomOptions(null)}</select><button class="primary">Add</button></form></div>`;
    const f = a.querySelector("#addT");
    f.onsubmit = (e) => { e.preventDefault(); const b = Object.fromEntries(new FormData(f)); b.room_id = b.room_id ? +b.room_id : null; guard(() => post("/api/overlays/targets", b)).then(() => admOverlays(a)); };
    a.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirm("Remove this overlay laptop?") && guard(() => del(`/api/overlays/targets/${b.dataset.del}`)).then(() => admOverlays(a)));
  }

  async function admKeys(a) {
    const keys = await api("/api/admin/api-keys");
    a.innerHTML = `<div class="panel card"><h2>API keys</h2><p class="small muted">For Bitfocus Companion and other automation. Send the key in an <code>X-API-Key</code> header, e.g. <code>POST /api/timers/&lt;room&gt;/toggle</code>. <b><a href="/guide/companion" target="_blank">Companion guide</a></b>: set-up steps, ready-made buttons for presets, blink, messages and overlays, and every endpoint a key can call. Full API reference: <a href="/api/docs" target="_blank">/api/docs</a>.</p>
      <table>${keys.map((k) => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td>${when(k.created_at)}</td><td><button class="small danger" data-del="${k.id}">Revoke</button></td></tr>`).join("")}</table>
      <form class="row" id="nk" style="margin-top:.6rem"><input name="name" class="grow" placeholder="Key name, e.g. Companion" required><button class="primary">Create</button></form><p id="newkey"></p></div>`;
    a.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirm("Revoke this key?") && guard(() => del(`/api/admin/api-keys/${b.dataset.del}`)).then(() => admKeys(a)));
    const f = a.querySelector("#nk");
    f.onsubmit = async (e) => { e.preventDefault(); const r = await guard(() => post("/api/admin/api-keys", { name: f.name.value })); await admKeys(a); a.querySelector("#newkey").innerHTML = `Copy this key now, it won't be shown again:<br><code>${esc(r.key)}</code>`; };
  }

  // Direct-message chats: who and how much, never what was said. Deleting removes the chat, its files and reactions for both people.
  async function admChat(a) {
    const dms = boot.modules.comms ? await api("/api/admin/comms/dms") : [];
    a.innerHTML = `<div class="panel card"><h2>Direct messages</h2><p class="small muted">Every direct-message chat between two people. You see who and how much, not what was said. Deleting a chat removes its messages, files and reactions for both people, straight away. Older messages in every chat can also go automatically: <i>General → Delete chat messages older than</i>.</p>
      ${dms.length ? `<table><tr><th>Between</th><th>Messages</th><th>Files</th><th>Last message</th><th></th></tr>${dms.map((d) => `<tr><td>${d.members.map(esc).join(" &amp; ")}</td><td>${d.messages}</td><td>${d.files}</td><td>${d.last_at ? when(d.last_at) : '<span class="muted">none</span>'}</td><td><button class="small danger" data-del="${d.id}">Delete chat</button></td></tr>`).join("")}</table>
        ${dms.length > 1 ? `<div class="row" style="margin-top:.6rem"><button class="danger" data-all>Delete all ${dms.length} direct-message chats</button></div>` : ""}`
        : `<p class="muted">${boot.modules.comms ? "No direct-message chats yet." : "Chat is switched off for this site."}</p>`}</div>`;
    a.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirm("Delete this chat for both people? This can't be undone.") && guard(() => del(`/api/admin/comms/dms/${b.dataset.del}`)).then(() => admChat(a)));
    a.querySelector("[data-all]")?.addEventListener("click", async () => {
      if (!confirm(`Delete all ${dms.length} direct-message chats? This can't be undone.`)) return;
      for (const d of dms) await guard(() => del(`/api/admin/comms/dms/${d.id}`)).catch(() => {});
      admChat(a);
    });
  }

  async function admAudit(a) {
    const log = await api("/api/admin/audit");
    a.innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 style="margin:0">Audit log</h2>
        <div class="row"><input id="flt" placeholder="Filter" aria-label="Filter the audit log" style="width:14rem"><a class="btn" id="pdf" href="/api/admin/audit/pdf" download>Download as PDF</a></div></div>
      <p class="small muted" id="pdfNote" style="margin:.4rem 0 0">The PDF has every entry, newest first.</p>
      <table style="margin-top:.6rem"><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr><tbody id="log"></tbody></table></div>`;
    const draw = (q = "") => { a.querySelector("#log").innerHTML = log.filter((l) => !q || `${l.actor} ${l.action} ${l.detail}`.toLowerCase().includes(q)).map((l) => `<tr><td class="small">${when(l.at)}</td><td>${esc(l.actor)}</td><td>${esc(l.action)}</td><td class="small muted">${esc(l.detail)}</td></tr>`).join(""); };
    draw();
    a.querySelector("#flt").oninput = (e) => {
      const q = e.target.value.trim();
      draw(q.toLowerCase());
      // The PDF takes the same filter, over the whole log rather than the newest 200 shown here.
      a.querySelector("#pdf").href = "/api/admin/audit/pdf" + (q ? `?q=${encodeURIComponent(q)}` : "");
      a.querySelector("#pdfNote").textContent = q ? `The PDF has every entry matching “${q}”, newest first.` : "The PDF has every entry, newest first.";
    };
  }

  // Backups of the whole server: every night by itself, or now; kept on the server, downloaded or restored.
  async function admData(a) {
    const d = await api("/api/admin/backups");
    const KIND = { nightly: "Nightly", manual: "Made by hand", "before-restore": "Before a restore", upload: "Uploaded" };
    const s = d.settings;
    a.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))">
      <div class="panel"><h2>Back up</h2>
        <p class="small muted" style="margin-top:0">A backup is the whole server in one zip: rooms, people, chat and its files, timers and views, presenters' files, kept show reports, laptops and screens, settings, the licence and the encryption key. Speech models, caption transcripts and the Windows app aren't in it; they come back by themselves. A backup can read every message, so keep a downloaded one somewhere safe.</p>
        <div class="row" style="flex-wrap:wrap"><button class="primary" id="bkNow">Back up now</button><a class="btn" href="/api/admin/backup" id="bkDl" download>Download a backup</a></div>
        <p class="small" id="bkSaid" role="status" style="margin:.4rem 0 0"></p>
        ${d.error ? `<p class="small" style="color:var(--bad-ink)"><b>Last night's backup didn't work:</b> ${esc(d.error)}</p>` : ""}
        ${d.disk_free != null ? `<p class="small muted">${bytes(d.disk_free)} free on the server's disk.</p>` : ""}</div>
      <form class="panel" id="bkSet"><h2>Every night</h2>
        <label><input type="checkbox" name="nightly" ${s.nightly ? "checked" : ""} style="width:auto"> Back up every night</label>
        <div class="row" style="flex-wrap:wrap;align-items:flex-end;margin-top:.4rem">
          <span><label for="bkTime">At</label><input id="bkTime" name="time" type="time" value="${esc(s.time)}" required style="width:9.5rem"></span>
          <span><label for="bkKeep">Keep the newest</label><input id="bkKeep" name="keep" type="number" min="1" max="365" value="${s.keep}" required style="width:6rem"></span>
        </div>
        <p class="small muted">Venue time (${esc(d.zone)}). If the server is off then, it backs up when it's back, up to six hours later. Older nightly backups are deleted by themselves; ones made by hand or before a restore stay until you delete them.${d.hosted ? " Your hosting provider also keeps its own nightly backup of this server." : ""}</p>
        <div class="row"><button class="primary">Save</button></div></form></div>
      <div class="panel" style="margin-top:1rem"><h2>On this server</h2>
        ${d.backups.length ? `<table><tr><th>Made</th><th>Kind</th><th>Size</th><th><span class="sr-only">Actions</span></th></tr>${d.backups.map((b) => `<tr>
          <td>${when(b.made_at)}</td><td>${KIND[b.kind] || esc(b.kind)}</td><td>${bytes(b.size)}</td>
          <td class="row"><a class="btn small" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>Download</a><button class="small" data-restore="${esc(b.name)}">Restore</button><button class="small danger" data-rm="${esc(b.name)}">Delete</button></td></tr>`).join("")}</table>`
          : '<p class="muted">None yet. The first nightly backup is made tonight.</p>'}</div>
      <div class="panel" style="margin-top:1rem"><h2>Restore</h2>
        <p class="small muted" style="margin-top:0">Restoring puts the whole server back as it was in the backup, from this server or another AT SUITE server. Everything here now is replaced, so a backup of it is made first. The server then restarts by itself, which takes a minute; laptops and screens reconnect on their own.</p>
        <label for="bkFile">A backup file (.zip)</label><input id="bkFile" type="file" accept=".zip,application/zip">
        <div class="row" style="margin-top:.5rem"><button class="danger" id="bkUp">Restore this file</button></div>
        <div id="bkAsk" class="hidden" role="alertdialog" aria-labelledby="bkAskQ" style="margin-top:.8rem;padding:.8rem;border:1px solid var(--bad);border-radius:8px">
          <p id="bkAskQ" style="margin-top:0"></p>
          <label for="bkType">Type RESTORE to go ahead</label><input id="bkType" autocomplete="off" style="width:10rem">
          <div class="row" style="margin-top:.5rem"><button class="danger" id="bkGo">Restore</button><button type="button" id="bkNo">Cancel</button></div>
        </div>
        <p class="small" id="bkRes" role="status"></p></div>
      <p class="small muted" style="margin-top:1rem">Every backup, download and restore is listed in the <a href="#/audit">Audit log</a>.</p>`;
    const said = (el, text, kind = "") => { const p = a.querySelector(el); p.textContent = text; p.style.color = kind === "bad" ? "var(--bad-ink)" : ""; };
    a.querySelector("#bkNow").onclick = (e) => {
      e.target.disabled = true; said("#bkSaid", "Backing up…");
      guard(() => post("/api/admin/backups")).then((b) => { if (b) { toast("Backed up", "good"); admData(a); } else { e.target.disabled = false; said("#bkSaid", ""); } });
    };
    a.querySelector("#bkSet").onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      guard(() => put("/api/admin/backups/settings", { nightly: f.nightly.checked, time: f.time.value, keep: Number(f.keep.value) })).then((r) => r && toast("Saved", "good"));
    };
    a.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => confirm("Delete this backup from the server? This can't be undone.") &&
      guard(() => del(`/api/admin/backups/${encodeURIComponent(b.dataset.rm)}`)).then(() => admData(a)));
    // Restoring replaces everything, so it asks to have RESTORE typed rather than one click.
    let todo = null;
    const ask = (question, run) => {
      todo = run;
      a.querySelector("#bkAskQ").textContent = question;
      a.querySelector("#bkType").value = "";
      a.querySelector("#bkAsk").classList.remove("hidden");
      a.querySelector("#bkType").focus();
    };
    a.querySelector("#bkNo").onclick = () => { todo = null; a.querySelector("#bkAsk").classList.add("hidden"); };
    a.querySelector("#bkGo").onclick = async () => {
      if (a.querySelector("#bkType").value.trim().toUpperCase() !== "RESTORE") return said("#bkRes", "Type RESTORE first.", "bad");
      const run = todo; todo = null;
      a.querySelector("#bkAsk").classList.add("hidden");
      said("#bkRes", "Checking the backup and saving one of what's here now…");
      const r = await guard(run);
      if (!r) return said("#bkRes", "");
      said("#bkRes", `Restoring. The server is restarting with the backup${r.backup.made_at ? ` made ${when(r.backup.made_at)}` : ""}. This page signs you in again when it's back.`);
      waitForRestart();
    };
    a.querySelectorAll("[data-restore]").forEach((b) => b.onclick = () => ask(
      `Restore the backup made ${b.closest("tr").cells[0].textContent}? Everything on the server now is replaced by it.`,
      () => post(`/api/admin/backups/${encodeURIComponent(b.dataset.restore)}/restore`)));
    a.querySelector("#bkUp").onclick = () => {
      const f = a.querySelector("#bkFile").files[0];
      if (!f) return said("#bkRes", "Choose a backup file first.", "bad");
      ask(`Restore ${f.name}? Everything on the server now is replaced by it.`, () => upload("/api/admin/restore", f));
    };
    // The server stops and Docker starts it again; reload once it answers.
    const waitForRestart = () => {
      let down = false;
      const tick = setInterval(async () => {
        try {
          const r = await fetch("/api/health", { cache: "no-store" });
          if (r.ok && down) { clearInterval(tick); location.reload(); }
          if (!r.ok) down = true;
        } catch (_) { down = true; }
      }, 2000);
    };
  }

})();
