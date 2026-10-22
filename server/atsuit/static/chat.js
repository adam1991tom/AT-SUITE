// Chat component shared by the console and the node workspace, laid out like a messenger app:
// your messages on the right in the accent colour, everyone else's on the left with their initials,
// grouped by sender, with the time, reactions and "Seen by" under your latest message.
// mount(el, {me, prefer: channelId|null, compact, quiet, onUnread, channel}) returns {onEvent(evt), reload(), open(id)}.
// channel: show only that channel (no list), e.g. a room's chat next to its help call in the console.
const Chat = (() => {
  const { esc, api, post, upload, guard, when } = AT;
  // A short, useful set: faces, hands, and the signs a crew uses on show day.
  const EMOJI = ["👍", "👎", "👌", "👏", "🙏", "🙌", "👋", "✌️", "🤞", "💪", "👀", "🫡",
    "😀", "😂", "🙂", "😉", "😊", "😍", "🤔", "😅", "😬", "😮", "😢", "😡", "🥳", "😴", "🤯", "🤦",
    "✅", "❌", "⚠️", "❗", "❓", "🆘", "⛔", "🔥", "🎉", "❤️", "⭐", "💯",
    "🎤", "🎧", "🔊", "🔇", "📢", "🎬", "📷", "💡", "🖥️", "💻", "📱", "🔌", "🔋", "🕒", "⏱️", "☕", "🍕"];
  const QUICK = ["👍", "✅", "👀", "❤️", "😂", "🙏"];
  const GROUP_MS = 5 * 60 * 1000; // messages from one person this close together share one block
  const kb = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  // Initials in a coloured circle, the colour fixed per name (dark enough for white text on every theme).
  function initials(name) {
    const w = String(name || "?").replace(/[#@]/g, "").trim().split(/\s+/).filter(Boolean);
    return ((w[0]?.[0] || "?") + (w.length > 1 ? w[w.length - 1][0] : w[0]?.[1] || "")).toUpperCase();
  }
  function hue(name) { let h = 0; for (const ch of String(name || "")) h = (h * 31 + ch.codePointAt(0)) % 360; return h; }
  function avatar(name, cls = "", label = "") {
    return `<span class="av ${cls}" style="--av-h:${hue(name)}" ${label ? `title="${esc(label)}"` : 'aria-hidden="true"'}>${esc(initials(name))}</span>`;
  }
  // "Today", "Yesterday" or the date, for the line between days.
  function dayLabel(iso) {
    const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 86400000);
    if (d.toDateString() === t.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }
  // "now", "5m", "3h", "2d": how long ago, for the chat list
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  }
  // "Just now", "5 minutes ago", "2 hours ago", then the date: for cards and notifications
  function since(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return "Just now";
    if (s < 3600) { const m = Math.round(s / 60); return `${m} minute${m === 1 ? "" : "s"} ago`; }
    if (s < 86400) { const h = Math.floor(s / 3600); return `${h} hour${h === 1 ? "" : "s"} ago`; }
    return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  }
  const FLAGS = { urgent: "🚨 Urgent", important: "❗ Important" };

  // One emoji picker for the page, opened next to whatever asked for it.
  let picker = null, pickDone = null;
  function pickEmoji(anchor, done) {
    if (!picker) {
      picker = document.createElement("div");
      picker.className = "emoji-pick hidden";
      picker.innerHTML = EMOJI.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join("");
      picker.onclick = (e) => { const b = e.target.closest("[data-e]"); if (b) { picker.classList.add("hidden"); pickDone?.(b.dataset.e); } };
      document.addEventListener("pointerdown", (e) => { if (!picker.contains(e.target) && !e.target.closest("[data-emoji],[data-react],.rx-quick")) picker.classList.add("hidden"); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") picker.classList.add("hidden"); });
      document.body.appendChild(picker);
    }
    if (!picker.classList.contains("hidden") && pickDone === done) { picker.classList.add("hidden"); return; }
    pickDone = done;
    picker.classList.remove("hidden");
    const r = anchor.getBoundingClientRect(), pw = picker.offsetWidth, ph = picker.offsetHeight;
    picker.style.left = Math.max(8, Math.min(r.right - pw, innerWidth - pw - 8)) + "px";
    picker.style.top = (r.top - ph - 6 > 8 ? r.top - ph - 6 : r.bottom + 6) + "px";
  }

  function mount(el, opts) {
    const me = opts.me, locked = opts.channel || null;
    let channels = [], current = null, unread = {}, people = [], msgs = [];
    const fresh = new Set(); // someone else's messages that just arrived: they light up for a moment
    // Messages for the channel being opened that arrive while its history is still loading;
    // they're played back once it's drawn, so a message sent at that moment isn't lost.
    let opening = null, early = [];
    el.innerHTML = `
      <div class="chat fbchat ${opts.compact ? "compact" : ""} ${locked ? "solo" : ""}">
        ${opts.compact || locked ? "" : `<aside class="chans panel"><div class="chans-head"><h2>Chats</h2></div><div class="chan-list" role="list"></div></aside>`}
        <section class="msgs ${opts.compact ? "" : "panel"}">
          ${opts.compact && !locked ? '<div class="chans chips" role="tablist" aria-label="Chats"></div>' : ""}
          <header class="chat-head"><span class="chat-av"></span><div class="grow"><b class="title"></b><div class="muted small sub"></div></div><span class="muted small typing"></span></header>
          <div class="list" role="log" aria-live="polite" aria-relevant="additions"></div>
          <div class="pending-files"></div>
          <form class="compose" method="post" autocomplete="off">
            <label class="ico" title="Attach files (or paste or drop them here)" aria-label="Attach files">📎<input type="file" name="file" class="hidden" multiple></label>
            <button type="button" class="ico" data-emoji title="Emoji" aria-label="Emoji">😊</button>
            <textarea name="body" rows="1" class="grow" placeholder="Aa" aria-label="Message" maxlength="8000"></textarea>
            <select name="priority" aria-label="Priority" title="How urgent is it?"><option value="normal">Normal</option><option value="important">❗ Important</option><option value="urgent">🚨 Urgent</option></select>
            <button class="send primary" aria-label="Send" title="Send (Enter). Shift+Enter for a new line">➤</button>
          </form>
        </section>
      </div>`;
    const root = el.querySelector(".fbchat");
    const listEl = el.querySelector(".list"), titleEl = el.querySelector(".title"), subEl = el.querySelector(".sub"), avEl = el.querySelector(".chat-av"), form = el.querySelector("form");
    const chansEl = el.querySelector(".chan-list") || el.querySelector(".chans.chips");
    const pendEl = el.querySelector(".pending-files"), myKey = me.kind === "account" ? `a:${me.id}` : `n:${me.name}`;
    const isMine = (m) => (me.kind === "account" ? m.sender_id === me.id : !m.sender_id && m.sender_name === me.name);
    const senderKey = (m) => m.sender_id ? `a:${m.sender_id}` : `n:${m.sender_name}`;

    // Admins can delete a direct-message chat for both people (also in Settings → Chat).
    const delChat = document.createElement("button");
    delChat.type = "button"; delChat.className = "small danger hidden"; delChat.textContent = "Delete chat";
    delChat.title = "Delete this direct-message chat for both people";
    el.querySelector(".chat-head").appendChild(delChat);
    // Asked in the page (the laptop app has no confirm boxes: they can make a sound).
    delChat.onclick = () => {
      if (!current) return;
      if (delChat.dataset.sure !== "1") { delChat.dataset.sure = "1"; delChat.textContent = "Delete for both? Click again"; setTimeout(() => { delChat.dataset.sure = ""; delChat.textContent = "Delete chat"; }, 4000); return; }
      delChat.dataset.sure = ""; delChat.textContent = "Delete chat";
      guard(() => AT.del(`/api/admin/comms/dms/${current.id}`)).then(() => load(null), () => {});
    };

    // files waiting to go with the next message: picked, pasted or dropped
    let files = [];
    function drawFiles() {
      pendEl.innerHTML = files.map((f, i) => `<span class="pf">${f.type.startsWith("image/") ? "🖼️" : "📄"} ${esc(f.name)} <span class="muted">${kb(f.size)}</span><button type="button" class="small" data-rm="${i}" title="Remove" aria-label="Remove ${esc(f.name)}">✕</button></span>`).join("");
      pendEl.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { files.splice(+b.dataset.rm, 1); drawFiles(); });
    }
    const addFiles = (list) => { files.push(...[...list].filter((f) => f.size)); drawFiles(); form.body.focus(); };
    form.file.onchange = () => { addFiles(form.file.files); form.file.value = ""; };
    form.body.addEventListener("paste", (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f); } });
    el.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); el.classList.add("chat-drop"); } });
    el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("chat-drop"); });
    el.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); el.classList.remove("chat-drop"); addFiles(e.dataTransfer.files); } });
    form.querySelector("[data-emoji]").onclick = (e) => pickEmoji(e.currentTarget, (emo) => {
      const i = form.body.selectionStart ?? form.body.value.length, v = form.body.value;
      form.body.value = v.slice(0, i) + emo + v.slice(form.body.selectionEnd ?? i);
      form.body.focus(); form.body.selectionStart = form.body.selectionEnd = i + emo.length; grow();
    });
    // The message box grows with what's typed (up to a few lines); Enter sends, Shift+Enter is a new line.
    const grow = () => { form.body.style.height = "auto"; form.body.style.height = Math.min(form.body.scrollHeight, 140) + "px"; };
    form.body.addEventListener("input", grow);
    form.body.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    // An urgent message is marked on the box too, so nobody sends one by mistake.
    form.priority.onchange = () => { root.dataset.prio = form.priority.value; };

    function chanLabel(c) { return c.kind === "site" ? `# ${c.name}` : c.kind === "room" ? c.name : c.name; }
    function chanAvatar(c, cls = "") {
      if (c.kind === "site") return `<span class="av av-chan ${cls}" style="--av-h:${hue(c.name)}" aria-hidden="true">#</span>`;
      return avatar(c.name, (c.kind === "room" ? "av-room " : "") + cls);
    }
    function preview(c) {
      const l = c.last;
      if (!l) return '<span class="muted">No messages yet</span>';
      const who = isMine(l) ? "You" : (l.sender_name || "").split(" ")[0];
      return `${l.priority === "urgent" ? "🚨 " : ""}${esc(who)}: ${esc(l.body || "")}`;
    }

    function renderChans() {
      if (!chansEl) { reportUnread(); return; }
      if (opts.compact) {
        chansEl.innerHTML = channels.map((c) => `<button type="button" role="tab" data-id="${c.id}" aria-selected="${c.id === current?.id}" class="chip ${c.id === current?.id ? "on" : ""}">${esc(chanLabel(c))}${unread[c.id] ? ` <span class="unread" aria-label="${unread[c.id]} unread">${unread[c.id]}</span>` : ""}</button>`).join("");
      } else {
        chansEl.innerHTML = channels.map((c) => `<a href="#" role="listitem" data-id="${c.id}" class="chan ${c.id === current?.id ? "active" : ""} ${unread[c.id] ? "has-unread" : ""}">
            ${chanAvatar(c)}<span class="chan-txt"><span class="chan-name">${esc(chanLabel(c))}</span><span class="chan-last">${preview(c)}</span></span>
            <span class="chan-meta">${c.last ? `<span class="muted small">${esc(ago(c.last.created_at))}</span>` : ""}${unread[c.id] ? `<span class="unread" aria-label="${unread[c.id]} unread">${unread[c.id]}</span>` : ""}</span></a>`).join("") +
          (me.kind === "node" ? "" : '<a href="#" data-dm="1" class="chan chan-new"><span class="av av-new" aria-hidden="true">+</span><span class="chan-txt"><span class="chan-name">New message</span><span class="chan-last">Message someone directly</span></span></a>');
        chansEl.querySelector("[data-dm]")?.addEventListener("click", (e) => { e.preventDefault(); pickDm(); });
      }
      chansEl.querySelectorAll("[data-id]").forEach((a) => a.onclick = (e) => { e.preventDefault(); open(+a.dataset.id); });
      reportUnread();
    }
    function reportUnread() {
      const total = Object.values(unread).reduce((a, b) => a + b, 0);
      opts.onUnread && opts.onUnread(total);
    }

    function attHtml(m) {
      return (m.attachments || []).map((a) => {
        const url = `/api/comms/attachments/${a.id}`;
        return /^image\/(png|jpe?g|gif|webp|bmp)$/.test(a.mime)
          ? `<a class="att att-img" href="${url}" target="_blank" title="${esc(a.original_name)}"><img src="${url}" alt="${esc(a.original_name)}" loading="lazy"></a>`
          : `<a class="att att-file" href="${url}" target="_blank"><span aria-hidden="true">📄</span> <span class="grow">${esc(a.original_name)}</span> <span class="small">${kb(a.size)}</span></a>`;
      }).join("");
    }

    // One message: the bubble, with its tools on hover and reactions on its corner.
    function msgHtml(m, pos) {
      const mine = isMine(m), dm = current?.kind === "dm";
      const del = (mine || me.role === "admin") && !m.deleted ? `<button type="button" class="small" data-del="${m.id}" title="Delete this message" aria-label="Delete this message">🗑</button>` : "";
      const react = !m.deleted && me.role !== "viewer" ? `<button type="button" class="small" data-react="${m.id}" title="React" aria-label="React">☺︎</button>` : "";
      const reactions = (m.reactions || []).map((r) => `<button type="button" class="rx ${r.who.includes(myKey) ? "mine" : ""}" data-rx="${m.id}" data-e="${esc(r.emoji)}" title="${esc(r.names.join(", "))}" aria-label="${esc(r.emoji)} ${r.count}: ${esc(r.names.join(", "))}">${esc(r.emoji)}${r.count > 1 ? ` ${r.count}` : ""}</button>`).join("");
      const flag = !m.deleted && FLAGS[m.priority] ? `<div class="flag">${FLAGS[m.priority]}</div>` : "";
      const body = m.deleted ? '<i>Message deleted</i>' : m.body ? `<div class="text">${esc(m.body).replace(/\n/g, "<br>")}</div>` : "";
      const atts = m.deleted ? "" : attHtml(m);
      // only pictures and files, no text: no bubble behind them
      const bare = !body && !flag && atts;
      const stamp = new Date(m.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      return `<div class="mrow ${mine ? "mine" : "theirs"} ${pos.first ? "first" : ""} ${pos.last ? "last" : ""} p-${esc(m.priority)} ${m.deleted ? "deleted" : ""} ${fresh.has(m.id) ? "fresh" : ""}" data-mid="${m.id}">
        ${mine ? "" : pos.last ? avatar(m.sender_name, "av-msg") : '<span class="av-gap"></span>'}
        <div class="mcol">
          ${!mine && pos.first && !dm ? `<div class="mname">${esc(m.sender_name)}</div>` : ""}
          <div class="bwrap"><div class="bubble ${bare ? "bare" : ""}" title="${esc(stamp)}">${flag}${body}${atts ? `<div class="atts">${atts}</div>` : ""}</div>
            <span class="msg-tools">${react}${del}</span></div>
          ${reactions ? `<div class="rxs">${reactions}</div>` : ""}
          ${pos.last ? `<div class="mtime">${esc(when(m.created_at))}</div>` : ""}
        </div></div>`;
    }

    // Under your latest message: who has seen it, as small faces, or "Sent" until somebody has.
    function seenHtml(m) {
      const who = (m.seen_by || []);
      if (!who.length) return `<div class="seen" data-seen="${m.id}"><span class="muted small">✓ Sent</span></div>`;
      const shown = who.slice(0, 5).map((n) => avatar(n, "av-seen", n)).join("");
      const words = current?.kind === "dm" ? "Seen" : `Seen by ${who.slice(0, 3).join(", ")}${who.length > 3 ? ` and ${who.length - 3} more` : ""}`;
      return `<div class="seen" data-seen="${m.id}"><span class="faces">${shown}</span><span class="muted small">${esc(words)}</span></div>`;
    }

    function renderList() {
      const stick = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
      let html = "", day = "";
      const myLast = [...msgs].reverse().find((m) => isMine(m) && !m.deleted);
      msgs.forEach((m, i) => {
        const prev = msgs[i - 1], next = msgs[i + 1];
        const d = new Date(m.created_at).toDateString();
        if (d !== day) { day = d; html += `<div class="day-sep" role="separator"><span>${esc(dayLabel(m.created_at))}</span></div>`; }
        const joins = (a, b) => a && b && senderKey(a) === senderKey(b) && new Date(a.created_at).toDateString() === new Date(b.created_at).toDateString()
          && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < GROUP_MS && a.priority === "normal" && b.priority === "normal";
        html += msgHtml(m, { first: !joins(prev, m), last: !joins(m, next) });
        if (myLast && m.id === myLast.id) html += seenHtml(m);
      });
      listEl.innerHTML = html || `<div class="chat-empty">${current ? chanAvatar(current, "av-big") : ""}<p class="muted">No messages yet. Say hello 👋</p></div>`;
      wire();
      if (stick) listEl.scrollTop = listEl.scrollHeight;
      // pictures change the height as they load: stay at the bottom if we were there
      listEl.querySelectorAll("img").forEach((img) => img.complete || img.addEventListener("load", () => { if (stick) listEl.scrollTop = listEl.scrollHeight; }, { once: true }));
    }

    const toggle = (id, emoji) => guard(() => post(`/api/comms/messages/${id}/reactions`, { emoji })).then((m) => upsert(m), () => {});
    function upsert(m) {
      const i = msgs.findIndex((x) => x.id === m.id);
      if (i >= 0) msgs[i] = { ...msgs[i], ...m }; else msgs.push(m);
      renderList();
    }
    function wire() {
      listEl.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
        // asked in the bubble: a second click deletes
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Delete?"; b.classList.add("danger"); setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = "🗑"; b.classList.remove("danger"); } }, 4000); return; }
        guard(() => AT.del(`/api/comms/messages/${b.dataset.del}`));
      });
      listEl.querySelectorAll("[data-rx]").forEach((b) => b.onclick = () => toggle(+b.dataset.rx, b.dataset.e));
      listEl.querySelectorAll("[data-react]").forEach((b) => b.onclick = () => {
        // the six most used straight away, everything else from the picker
        const id = +b.dataset.react, row = b.closest(".mrow");
        listEl.querySelectorAll(".rx-quick").forEach((q) => q.remove());
        const q = document.createElement("div");
        q.className = "rx-quick";
        q.innerHTML = QUICK.map((e) => `<button type="button" data-q="${e}" aria-label="React ${e}">${e}</button>`).join("") + '<button type="button" data-more title="More emoji" aria-label="More emoji">＋</button>';
        q.onclick = (e) => {
          const t = e.target.closest("button"); if (!t) return;
          if (t.dataset.q) { q.remove(); toggle(id, t.dataset.q); }
          else pickEmoji(t, (emo) => { q.remove(); toggle(id, emo); });
        };
        row.querySelector(".mcol").appendChild(q);
      });
    }

    function drawHead() {
      if (!current) return;
      titleEl.textContent = chanLabel(current);
      avEl.innerHTML = chanAvatar(current);
      subEl.textContent = current.kind === "dm" ? "Direct message" : current.kind === "site" ? "Everyone on the site" : "Room chat";
      delChat.classList.toggle("hidden", !(current.kind === "dm" && me.role === "admin"));
      root.classList.toggle("is-dm", current.kind === "dm");
    }

    async function open(id) {
      current = channels.find((c) => c.id === id) || channels[0];
      if (!current) { listEl.innerHTML = '<p class="muted">No chats yet.</p>'; return; }
      unread[current.id] = 0;
      renderChans();
      drawHead();
      const cid = current.id;
      opening = cid; early = [];
      let got;
      try { got = await api(`/api/comms/channels/${cid}/messages`); }
      finally { if (opening === cid) opening = null; }
      if (current?.id !== cid) return; // another channel was opened meanwhile
      msgs = got; fresh.clear();
      listEl.scrollTop = 0;
      renderList();
      listEl.scrollTop = listEl.scrollHeight;
      if (msgs.length) post(`/api/comms/channels/${cid}/read`, { up_to: msgs[msgs.length - 1].id }).catch(() => {});
      const late = early; early = [];
      late.forEach(onEvent);
    }

    async function pickDm() {
      people = await api("/api/comms/people");
      if (!people.length) { AT.toast("There's nobody else to message yet."); return; }
      // An in-page picker, not prompt(): native dialogs can play a system sound.
      const pick = document.createElement("div");
      pick.className = "row dm-pick";
      pick.innerHTML = `<select class="grow" aria-label="Message who?"><option value="">Message who?</option>${people.map((x) => `<option value="${x.id}">${esc(x.display_name)}</option>`).join("")}</select><button type="button" class="primary">Open</button><button type="button">Cancel</button>`;
      el.querySelector(".dm-pick")?.remove();
      chansEl.before(pick);
      const choice = await new Promise((done) => {
        const [sel, ok, cancel] = pick.children;
        ok.onclick = () => done(sel.value);
        cancel.onclick = () => done("");
      });
      pick.remove();
      const p = choice && people.find((x) => String(x.id) === choice);
      if (!p) return;
      const { id } = await guard(() => post("/api/comms/dm", { account_id: p.id }));
      await load(id);
    }

    let sending = false;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = form.body.value.trim(), send = files;
      if ((!body && !send.length) || !current || sending) return;
      sending = true;
      try {
        const m = await guard(() => post(`/api/comms/channels/${current.id}/messages`, { body, priority: form.priority.value }));
        form.body.value = ""; form.priority.value = "normal"; root.dataset.prio = "normal"; files = []; drawFiles(); grow();
        for (const f of send) await guard(() => upload(`/api/comms/messages/${m.id}/attachments`, f)).catch(() => {});
      } catch (_) {} finally { sending = false; form.body.focus(); }
    };

    async function load(preferId) {
      channels = await api("/api/comms/channels");
      if (locked) channels = channels.filter((c) => c.id === locked);
      channels.forEach((c) => { unread[c.id] = c.unread || 0; }); // kept on the server, so a reload doesn't lose them
      renderChans();
      await open(locked ?? preferId ?? opts.prefer ?? (channels.some((c) => c.id === current?.id) ? current.id : channels[0]?.id));
    }

    function onEvent(evt) {
      if (evt.type === "channel.deleted") { if (!locked) load(current?.id === evt.data.channel_id ? null : current?.id); return; }
      if (!evt.type || !evt.type.startsWith("message.")) return;
      const m = evt.data, cid = m.channel_id;
      if (!channels.find((c) => c.id === cid)) { if (!locked) load(current?.id); return; }
      if (opening === cid) { early.push(evt); return; }
      const ch = channels.find((c) => c.id === cid);
      if (evt.type === "message.read") {
        // someone read up to here: their face moves onto your latest message
        if (current && cid === current.id) {
          let changed = false;
          msgs.forEach((x) => { if (x.id <= m.up_to && x.sender_name !== m.name && !(x.seen_by || []).includes(m.name)) { x.seen_by = [...(x.seen_by || []), m.name]; changed = true; } });
          if (changed) renderList();
        }
        return;
      }
      if (evt.type === "message.new" && ch) { ch.last = { sender_id: m.sender_id, sender_name: m.sender_name, body: m.body || (m.attachments?.length ? "Sent a file" : ""), created_at: m.created_at, priority: m.priority }; }
      if (current && cid === current.id) {
        if (evt.type === "message.deleted") {
          const x = msgs.find((y) => y.id === m.id);
          if (x) { x.deleted = true; x.body = ""; x.attachments = []; renderList(); }
        } else {
          const isNew = !msgs.some((y) => y.id === m.id);
          // someone else's new message lights up for a few seconds so it catches the eye
          if (evt.type === "message.new" && isNew && !isMine(m)) { fresh.add(m.id); setTimeout(() => fresh.delete(m.id), 8000); }
          if (isNew) listEl.scrollTop = listEl.scrollHeight + 1000; // a new message scrolls into view
          upsert(m);
          if (isNew) { listEl.scrollTop = listEl.scrollHeight; post(`/api/comms/channels/${cid}/read`, { up_to: m.id }).catch(() => {}); }
        }
        renderChans();
      } else if (evt.type === "message.new") {
        unread[cid] = (unread[cid] || 0) + 1;
        renderChans();
      } else renderChans();
      if (!opts.quiet && evt.type === "message.new" && m.priority === "urgent" && !isMine(m)) {
        AT.toast(`Urgent from ${m.sender_name}: ${m.body}`, "bad");
      }
    }

    load();
    return { onEvent, reload: () => load(current?.id), open };
  }

  return { mount, avatar, initials, ago, since };
})();

// Help calls (the crew's emergencies) as cards: who needs help, in which room and how long ago, what's
// wrong, then On my way, Reply (the room's chat) and Resolved. Used by the workspace's Help menu and
// the console's Help requests page. Asks in the card, never with a browser box (the laptop app has none).
const HelpCards = (() => {
  const { esc, guard, put } = AT;
  const STATUS = { open: ["bad", "Waiting"], acknowledged: ["warn", "On the way"], resolved: ["good", "Resolved"] };
  function card(h, { reply = true, active = false } = {}) {
    const [cls, label] = STATUS[h.status] || ["", h.status];
    const ago = Chat.since(h.created_at);
    return `<article class="post hc st-${esc(h.status)} ${active ? "active" : ""}" data-hc="${h.id}">
      <div class="post-head">${Chat.avatar(h.requested_by, "av-lg")}<div class="post-who"><span><b>${esc(h.requested_by)}</b> needs help in <b>${esc(h.room_name)}</b></span>
        <span class="small" title="${esc(new Date(h.created_at).toLocaleString())}">${esc(ago)}</span></div>
        <span class="tag ${cls}">${esc(label)}</span>${h.status === "open" && h.escalations ? ' <span class="tag bad" title="Nobody answered in time, so it went out again to every laptop and page">No answer</span>' : ""}</div>
      <div class="post-body">🆘 <b>${esc(h.category)}</b>${h.description ? `: ${esc(h.description)}` : ""}</div>
      ${h.assigned_to && h.status !== "open" ? `<div class="small muted">${h.status === "resolved" ? "Resolved by" : "On the way:"} ${esc(h.assigned_to)}${h.resolution ? ` · ${esc(h.resolution)}` : ""}</div>` : ""}
      <div class="post-acts">${h.status === "open" ? '<button type="button" class="primary" data-s="acknowledged">🏃 On my way</button>' : ""}
        ${reply ? '<button type="button" data-reply>💬 Reply</button>' : ""}
        ${h.status !== "resolved" ? '<button type="button" class="go" data-s="resolved">✅ Resolved</button>' : ""}</div>
      <form class="hc-fix hidden" method="post"><input class="grow" maxlength="2000" aria-label="How was it fixed? (optional)" placeholder="How was it fixed? (optional, the AI helper learns from it)"><button class="small primary">Resolve</button></form>
    </article>`;
  }
  // askFix: offer "How was it fixed?" before resolving (when the AI helper is on); onReply(h): open the room's chat
  function wire(box, rows, { askFix = false, onReply = null, onPick = null } = {}) {
    box.querySelectorAll("[data-hc]").forEach((c) => {
      const h = rows.find((x) => x.id === +c.dataset.hc); if (!h) return;
      const set = (status, resolution) => guard(() => put(`/api/comms/help/${h.id}`, { status, ...(resolution ? { resolution } : {}) }));
      c.querySelector('[data-s="acknowledged"]')?.addEventListener("click", (e) => { e.stopPropagation(); set("acknowledged"); });
      c.querySelector('[data-s="resolved"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!askFix) return set("resolved");
        const f = c.querySelector(".hc-fix"); f.classList.remove("hidden"); f.querySelector("input").focus();
      });
      c.querySelector(".hc-fix").onsubmit = (e) => { e.preventDefault(); set("resolved", c.querySelector(".hc-fix input").value.trim()); };
      c.querySelector(".hc-fix").onclick = (e) => e.stopPropagation();
      c.querySelector("[data-reply]")?.addEventListener("click", (e) => { e.stopPropagation(); onReply && onReply(h); });
      if (onPick) c.onclick = () => onPick(h);
    });
  }
  return { card, wire };
})();
