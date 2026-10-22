// The tech workspace's notification centre: the bell list, in-window toasts
// and the app's silent pop-ups. (The windows themselves are static/ui/desk.js.)
const Desk = (() => {
  const { esc, toast } = AT;
  const ICON = { chat: "💬", urgent: "🚨", help: "🆘", error: "⚠️", good: "✅", note: "📝", timer: "⏱️", info: "ℹ️" };
  const ago = (iso) => Chat.since(iso);

  // Notifications: chat, help calls, handover notes and anything that has gone wrong, listed under
  // the bell like Facebook's, with a red count of the new ones. The timer's warning and danger times
  // pop up but stay out of the list and the count: they come too often to be worth keeping.
  // `quiet` (the main PC) shows nothing at all.
  function notifier({ button, box, count, quiet, popup }) {
    const list = [];
    let tab = "all", ticker = null;
    if (quiet) { button.classList.add("hidden"); return { add() {}, read() {}, quiet: true }; }
    const isOpen = () => !box.classList.contains("hidden");
    const badge = () => {
      const n = list.filter((x) => !x.noticed).length;
      count.textContent = n > 99 ? "99+" : n; count.classList.toggle("hidden", !n);
      button.setAttribute("aria-label", n ? `Notifications, ${n} new` : "Notifications");
    };
    const item = (n, i) => `<button type="button" class="nf k-${n.kind} ${n.read ? "" : "unseen"}" data-i="${i}">
        <span class="nf-ic">${n.who && typeof Chat !== "undefined" ? Chat.avatar(n.who) + `<i aria-hidden="true">${ICON[n.kind] || "🔔"}</i>` : `<span aria-hidden="true">${ICON[n.kind] || "🔔"}</span>`}</span>
        <span class="nf-txt"><b>${esc(n.title)}</b>${n.body ? `<span class="nf-body">${esc(n.body)}</span>` : ""}<span class="nf-when">${esc(ago(n.at))}</span></span>
        <span class="nf-dot" aria-label="${n.read ? "" : "unread"}"></span></button>`;
    const render = () => {
      badge();
      if (!isOpen()) return;
      const shown = list.map((n, i) => [n, i]).filter(([n]) => tab === "all" || !n.read);
      const hour = Date.now() - 3600000;
      const fresh = shown.filter(([n]) => new Date(n.at).getTime() >= hour), older = shown.filter(([n]) => new Date(n.at).getTime() < hour);
      box.innerHTML = `<div class="nf-head"><h2>Notifications</h2>${list.some((n) => !n.read) ? '<button type="button" data-all>Mark all as read</button>' : list.length ? '<button type="button" data-clear>Clear</button>' : ""}</div>
        <div class="nf-tabs" role="tablist"><button type="button" role="tab" data-tab="all" aria-selected="${tab === "all"}" class="${tab === "all" ? "on" : ""}">All</button><button type="button" role="tab" data-tab="unread" aria-selected="${tab === "unread"}" class="${tab === "unread" ? "on" : ""}">Unread</button></div>` +
        (fresh.length ? `<div class="nf-sec">New</div>${fresh.map(([n, i]) => item(n, i)).join("")}` : "") +
        (older.length ? `<div class="nf-sec">Earlier</div>${older.map(([n, i]) => item(n, i)).join("")}` : "") +
        (shown.length ? "" : `<div class="nf-empty">${tab === "unread" ? "You're all caught up." : "Nothing yet. Chat, help calls, handover notes and problems show here."}</div>`);
      box.querySelector("[data-all]")?.addEventListener("click", (e) => { e.stopPropagation(); list.forEach((n) => { n.read = n.noticed = true; }); render(); });
      box.querySelector("[data-clear]")?.addEventListener("click", (e) => { e.stopPropagation(); list.length = 0; render(); });
      box.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); tab = b.dataset.tab; render(); }));
      box.querySelectorAll("[data-i]").forEach((d) => (d.onclick = () => {
        const n = list[+d.dataset.i]; n.read = n.noticed = true;
        box.classList.add("hidden"); button.classList.remove("open"); button.setAttribute("aria-expanded", "false");
        badge(); n.action && n.action();
      }));
    };
    button.onclick = (e) => {
      e.stopPropagation();
      const opening = !isOpen();
      document.querySelectorAll(".dropdown").forEach((d) => d.classList.add("hidden"));
      box.classList.toggle("hidden", !opening);
      button.classList.toggle("open", opening); button.setAttribute("aria-expanded", String(opening));
      clearInterval(ticker);
      // Opening the list clears the red count; each one stays marked unread until it's clicked.
      if (opening) { list.forEach((n) => { n.noticed = true; }); render(); ticker = setInterval(() => (isOpen() ? render() : clearInterval(ticker)), 30000); }
    };
    document.addEventListener("click", () => { if (!isOpen()) { button.classList.remove("open"); button.setAttribute("aria-expanded", "false"); } });
    badge();
    return {
      // kind: chat | urgent | help | note | info | error | good | timer
      // opts.who: the person it's from (their face in the list); opts.silent: into the list only, no toast or pop-up
      add(kind, title, body = "", action = null, opts = {}) {
        const text = String(body || "").slice(0, 300);
        if (!opts.silent) {
          toast(text ? `${title}: ${text}` : title, kind === "good" ? "good" : ["chat", "note", "info"].includes(kind) ? "" : "bad");
          popup && popup(title, text, kind === "error" || kind === "help" ? "urgent" : ["timer", "note", "info"].includes(kind) ? "info" : kind);
        }
        if (kind === "timer") return; // pops up, but never fills the list or the count
        list.unshift({ kind, title, body: text, action, who: opts.who || "", at: new Date().toISOString(), read: false, noticed: isOpen() });
        list.length = Math.min(list.length, 60);
        render();
      },
      // The thing itself has been looked at (the chat window is open, the notes were read): its notifications are read too.
      read(kind) {
        let changed = false;
        list.forEach((n) => { if (n.kind === kind && !n.read) { n.read = n.noticed = true; changed = true; } });
        if (changed) render();
      },
    };
  }

  // Close drop-downs when clicking elsewhere.
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".drop")) document.querySelectorAll(".dropdown").forEach((d) => d.classList.add("hidden"));
  });

  return { notifier, ago };
})();
