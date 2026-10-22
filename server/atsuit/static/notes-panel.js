// Handover notes in the tech workspace: what one tech leaves for the next in this room ("clicker 2
// needs batteries"). A note stays until someone ticks it off, so it carries over between shifts and
// days; pinned notes are standing info and stay at the top. Notes this tech hasn't read yet are counted
// (a badge on the window, in the top bar and under the bell), never popped up.
// Each note is a card like a post: who left it and when, the note, then Pin, Edit and Done.
const ATNotes = (() => {
  const { esc, api, post, put, del, guard, when } = AT;
  const lines = (s) => esc(s).replace(/\n/g, "<br>");
  const face = (name) => (typeof Chat !== "undefined" ? Chat.avatar(name, "av-lg") : "");
  const ago = (iso) => (typeof Chat !== "undefined" ? Chat.since(iso) : when(iso));

  function mount(el, { roomId, me, onCount, onNew }) {
    // What this tech has read, per room: a new tech on the same laptop starts with everything unread.
    const KEY = `atsuit_notes_seen_${roomId}_${me}`;
    let seenId = 0;
    try { seenId = +localStorage.getItem(KEY) || 0; } catch (_) {}
    let data = { open: [], done: [] }, editing = null, known = null;

    el.innerHTML = `<form class="hn-add composer" method="post" autocomplete="off">${face(me)}
        <div class="grow"><textarea rows="2" maxlength="2000" aria-label="New handover note" placeholder="Anything the next tech in this room should know, ${esc(String(me).split(" ")[0])}?"></textarea>
        <div class="composer-foot"><label class="small hn-pin" title="Pinned notes stay at the top: standing info for the room, like which channel the lectern mic is on"><input type="checkbox"> 📌 Pin to the top</label>
          <span class="grow"></span><button class="primary small">Post note</button></div></div></form>
      <div class="hn-list"></div>
      <details class="hn-done hidden"><summary class="small muted"></summary><div></div></details>`;
    const form = el.querySelector(".hn-add"), text = form.querySelector("textarea"), pin = form.querySelector("input");
    const list = el.querySelector(".hn-list"), done = el.querySelector(".hn-done");

    const unseen = () => data.open.filter((n) => n.id > seenId && n.author !== me).length;
    const count = () => onCount && onCount(unseen(), data.open.length);

    function head(n, extra = "") {
      const stamp = new Date(n.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      return `<div class="post-head">${face(n.author)}<div class="post-who"><b>${esc(n.author)}</b>
          <span class="small" title="${esc(stamp)}">${esc(ago(n.created_at))}${n.edited_at ? " · edited" : ""}</span></div>
          ${n.pinned ? '<span class="tag pin">📌 Pinned</span>' : ""}${n.id > seenId && n.author !== me && !n.done_at ? '<span class="tag new">New</span>' : ""}${extra}</div>`;
    }
    function render() {
      if (editing) return; // don't redraw under someone typing; catch up when they finish
      list.innerHTML = data.open.map((n) => `<article class="post hn ${n.pinned ? "pin" : ""} ${n.id > seenId && n.author !== me ? "new" : ""}" data-n="${n.id}">
          ${head(n)}
          <div class="post-body">${lines(n.body)}</div>
          <div class="post-acts hn-foot">
            <button type="button" data-pin title="${n.pinned ? "Stop keeping it at the top" : "Keep it at the top for the room"}">📌 ${n.pinned ? "Unpin" : "Pin"}</button>
            <button type="button" data-edit>✏️ Edit</button>
            <button type="button" class="go" data-done title="Sorted: take it off the list">✅ Done</button></div></article>`).join("")
        || '<p class="muted small" style="margin-top:.8rem">No notes for this room. Anything the next tech should know goes here, and stays until someone ticks it off.</p>';
      done.classList.toggle("hidden", !data.done.length);
      done.querySelector("summary").textContent = `Ticked off this week (${data.done.length})`;
      done.querySelector("div").innerHTML = data.done.map((n) => `<article class="post hn off" data-n="${n.id}">
          ${head(n)}
          <div class="post-body">${lines(n.body)}</div>
          <div class="muted small">Done by ${esc(n.done_by || "")} ${esc(when(n.done_at))}</div>
          <div class="post-acts hn-foot"><button type="button" data-undo>↩ Put back</button><button type="button" class="bad" data-del title="Delete it for good">🗑 Delete</button></div></article>`).join("");
      el.querySelectorAll("[data-n]").forEach((row) => {
        const id = +row.dataset.n, n = [...data.open, ...data.done].find((x) => x.id === id);
        const act = (b, fn) => { const x = row.querySelector(b); if (x) x.onclick = fn; };
        act("[data-done]", () => guard(() => put(`/api/notes/${id}`, { done: true })).then(load, () => {}));
        act("[data-undo]", () => guard(() => put(`/api/notes/${id}`, { done: false })).then(load, () => {}));
        act("[data-pin]", () => guard(() => put(`/api/notes/${id}`, { pinned: !n.pinned })).then(load, () => {}));
        act("[data-del]", () => guard(() => del(`/api/notes/${id}`)).then(load, () => {}));
        act("[data-edit]", () => edit(row, n));
      });
      count();
    }
    // Edit in place: the note becomes a text box with Save and Cancel.
    function edit(row, n) {
      editing = n.id;
      row.querySelector(".post-body").innerHTML = `<textarea rows="3" maxlength="2000" aria-label="Edit the note"></textarea>`;
      const box = row.querySelector("textarea");
      box.value = n.body; box.focus();
      row.querySelector(".hn-foot").innerHTML = '<button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-save>Save</button>';
      const finish = () => { editing = null; render(); };
      row.querySelector("[data-cancel]").onclick = finish;
      row.querySelector("[data-save]").onclick = () => {
        if (!box.value.trim()) return AT.toast("The note can't be empty. Use Done to take it off the list.", "bad");
        guard(() => put(`/api/notes/${n.id}`, { body: box.value })).then((x) => { Object.assign(n, x); finish(); load(); }, () => {});
      };
    }
    async function load() {
      try { data = await api(`/api/rooms/${roomId}/notes`); } catch (_) { return; }
      // Someone else's new note (or, the first time, one this tech hasn't read yet) goes under the bell.
      const ids = new Set(data.open.map((n) => n.id));
      data.open.filter((n) => n.author !== me && (known ? !known.has(n.id) : n.id > seenId)).reverse().forEach((n) => onNew && onNew(n));
      known = new Set([...(known || []), ...ids]);
      render();
    }

    let adding = false;
    form.onsubmit = (e) => {
      e.preventDefault();
      if (adding || !text.value.trim()) return;
      adding = true;
      guard(() => post(`/api/rooms/${roomId}/notes`, { body: text.value, pinned: pin.checked }))
        .then(() => { text.value = ""; pin.checked = false; load(); }, () => {})
        .finally(() => { adding = false; });
    };
    text.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } };

    let soon = null;
    load();
    setInterval(() => { if (!editing && data.open.length) render(); }, 60000); // keeps "5 minutes ago" true
    return {
      onEvent(evt) {
        if (evt.type === "notes.changed" && evt.topic === `room:${roomId}`) { clearTimeout(soon); soon = setTimeout(load, 250); }
      },
      // The window is in front of the tech: everything in it now counts as read.
      seen() {
        const top = Math.max(0, ...data.open.map((n) => n.id));
        if (top <= seenId) return;
        seenId = top;
        try { localStorage.setItem(KEY, String(seenId)); } catch (_) {}
        count();
        // the highlight on new notes stays until the next redraw, so the tech can still spot them
      },
    };
  }

  return { mount };
})();
