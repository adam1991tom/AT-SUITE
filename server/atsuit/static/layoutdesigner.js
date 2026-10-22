// The layout designer (console → Timers → Layout designer): build a timer view by
// placing its parts on a 16:9 screen, like stagetimer.io's customiser. Drag a part to
// move it, drag its handles to resize it, or use the arrow keys (Shift for bigger steps,
// Alt to resize). Saved layouts are kept on the server and every screen, workspace and
// laptop app showing the view redraws as soon as it is saved.
const LayoutDesigner = (() => {
  const { esc, api, post, put, del, upload, guard, toast } = AT;
  const TL = TimerLayout;
  const r1 = (n) => Math.round(n * 10) / 10;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const LAYOUT = { elements: [], font: "arial", warn: "#ffcc00", danger: "#ff1744", over: "#ff0000", flash_over: true, transparent: false, bg_fit: "cover" };

  // What the canvas shows while designing: a made-up show in each state the timer can be in.
  const base = {
    title: "Keynote: The future of live events", next: "Panel discussion", clock: "14:05:32", room: "Main Hall",
    message: { on: false, text: "", blink: false }, secondary: { on: true, text: "Q&A in 5:00", over: false },
    progress: { off: false, over: false, danger: 8, warn: 17, done: 38 }, alert: false,
    status: { over: false, items: { tod: "14:05:32", state: "Running", cue: "1 · Keynote: The future of live events", start: "13:45", elapsed: "7:26", end: "14:18" } },
  };
  const SAMPLES = {
    running: ["Running", { timer: { text: "12:34", phase: "" } }],
    warn: ["Warning", { timer: { text: "4:59", phase: "warn" }, progress: { ...base.progress, done: 80 } }],
    danger: ["Danger", { timer: { text: "0:45", phase: "danger" }, progress: { ...base.progress, done: 96 } }],
    over: ["Overtime", { timer: { text: "-1:12", phase: "over" }, progress: { ...base.progress, over: true }, alert: true,
      status: { over: true, items: { ...base.status.items, state: "Overtime", end: "14:04" } } }],
    message: ["Stage message", { timer: { text: "2:10", phase: "" }, message: { on: true, text: "Please wrap up", blink: false } }],
    clock: ["Clock", { timer: { text: "14:05:32", phase: "" }, progress: { ...base.progress, off: true } }],
  };
  const frame = (k) => ({ ...base, ...SAMPLES[k][1] });

  // A view saved before the layout designer: lay its parts out the way timer.html drew them.
  function fromLegacy(d) {
    const E = (type, x, y, w, h, extra) => ({ ...TL.element(type, type), x, y, w, h, ...(extra || {}) });
    const els = [];
    const bottom = (d.show_status ? 8 : 0) + (d.show_progress ? 2 : 0);
    if (d.show_logo) els.push(E("logo", 3.5, 3.5, 16, 10, { align: "left" }));
    if (d.show_clock) els.push(E("clock", 70, 3, 27, 9, { align: "right" }));
    if (d.show_title) els.push(E("title", 10, 8, 80, clamp(d.title_size * 2, 4, 16)));
    const th = clamp(d.timer_size * 1.9, 15, 62);
    els.push(E("timer", 4, (100 - bottom - th) / 2, 92, th, { size: 92 }));
    if (d.show_secondary) els.push(E("secondary", 10, (100 - bottom + th) / 2, 80, 10));
    if (d.show_next) els.push(E("next", 10, 100 - bottom - 10, 80, 7));
    if (d.show_status) els.push(E("status", 0, 100 - bottom, 100, 8));
    if (d.show_progress) els.push(E("progress", 0, 98, 100, 2));
    if (d.show_message) els.push(E("message", 5, 20, 90, 60));
    return { ...LAYOUT, elements: els };
  }

  function mount(el, { boot, slug = null, onSaved = () => {} }) {
    const isAdmin = boot.me.role === "admin";
    let doc, saved, editing = slug, logos = {}, sel = null, sample = "running", past = [], future = [], lay = null;

    el.innerHTML = `<div class="ld">
      <div class="ld-bar row">
        <select data-pick aria-label="Open a layout" style="width:auto"></select>
        <select data-tpl aria-label="Start from a ready-made layout" style="width:auto"><option value="">Start from…</option>
          ${Object.entries(TL.TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("")}</select>
        <span class="ld-sep"></span>
        <button class="small" data-undo title="Undo (Ctrl+Z)" aria-label="Undo">↶ Undo</button><button class="small" data-redo title="Redo (Ctrl+Y)" aria-label="Redo">↷ Redo</button>
        <span class="ld-sep"></span>
        <span class="small muted">Show it as</span>
        <div class="ld-seg" role="radiogroup" aria-label="Show the layout as">${Object.entries(SAMPLES).map(([k, [l]]) => `<button class="small" role="radio" data-sample="${k}">${l}</button>`).join("")}</div>
        <span class="grow"></span>
        <span class="small muted" data-dirty></span>
        <a class="btn small hidden" data-open target="_blank" rel="noopener">Open on a room ↗</a>
        ${isAdmin ? '<button class="small" data-saveas>Save as new</button><button class="primary" data-save>Save</button>' : ""}
      </div>
      <div class="ld-main">
        <aside class="ld-left panel">
          <h3>Add a part</h3>
          <div class="ld-add">${Object.entries(TL.TYPES).map(([k, t]) => `<button class="small" data-add="${k}">${esc(t.label)}</button>`).join("")}</div>
          <h3 style="margin-top:1rem">Parts</h3>
          <p class="small muted" style="margin:0 0 .4rem">Top of the list is drawn on top.</p>
          <ol class="ld-layers" data-layers></ol>
        </aside>
        <div class="ld-centre">
          <div class="ld-canvas" data-canvas><div class="ld-draw" data-draw></div><div class="ld-over" data-over></div></div>
          <p class="small muted" style="margin:.5rem 0 0">Drag a part to move it and its corners to resize it. With a part picked: arrow keys move it (Shift for bigger steps), Alt and the arrows resize it, Delete removes it, Ctrl+D copies it. Parts snap to the middle and to each other; hold Ctrl while dragging to place freely.</p>
        </div>
        <aside class="ld-right panel" data-props></aside>
      </div></div>`;
    const $ = (q) => el.querySelector(q);
    const canvas = $("[data-canvas]"), over = $("[data-over]");

    // ---- history: every change goes through change(), so it can be undone
    const snap = () => JSON.stringify(doc);
    function change(fn, { keep = false } = {}) {
      const before = snap();
      fn();
      if (snap() === before) return;
      if (!keep) { past.push(before); if (past.length > 100) past.shift(); future = []; }
      render();
    }
    function undo() { if (!past.length) return; future.push(snap()); doc = JSON.parse(past.pop()); if (sel && !find(sel)) sel = null; render(); }
    function redo() { if (!future.length) return; past.push(snap()); doc = JSON.parse(future.pop()); if (sel && !find(sel)) sel = null; render(); }

    const find = (id) => doc.layout.elements.find((e) => e.id === id);
    const newId = (type) => { let i = 1; while (find(`${type}${i}`)) i++; return `${type}${i}`; };
    const dirty = () => snap() !== saved;

    async function open(s) {
      editing = s;
      const designs = await api("/api/timers-designs");
      const d = s && designs.find((x) => x.slug === s);
      if (s && !d) { editing = null; return open(null); }
      if (d) {
        const des = d.design;
        doc = { name: des.name, background: des.background, text: des.text, layout: des.layout ? { ...LAYOUT, ...des.layout } : fromLegacy(des), _legacy: des };
        logos = d.logos || {};
      } else {
        const t = TL.TEMPLATES.standard;
        doc = { name: "", background: t.background, text: t.text, layout: { ...LAYOUT, ...copy(t.layout) } };
        logos = {};
      }
      saved = snap(); past = []; future = []; sel = null;
      $("[data-pick]").innerHTML = `<option value="">New layout</option>` + designs.map((x) => `<option value="${esc(x.slug)}" ${x.slug === editing ? "selected" : ""}>${esc(x.name)}${x.design.layout ? "" : " (older view)"}</option>`).join("");
      const o = $("[data-open]");
      o.classList.toggle("hidden", !editing || !boot.rooms.length);
      if (editing && boot.rooms.length) o.href = `/timer/${boot.rooms[0].id}?view=built:${encodeURIComponent(editing)}`;
      render();
    }

    function render() {
      const look = { layout: doc.layout, background: doc.background, text: doc.text, logos };
      if (!lay) lay = TL.mount($("[data-draw]"), look, { edit: true });
      else lay.set(look);
      lay.update(frame(sample));
      canvas.classList.toggle("clear", !!doc.layout.transparent);
      drawOverlay(); drawLayers(); drawProps();
      el.querySelectorAll("[data-sample]").forEach((b) => { b.classList.toggle("on", b.dataset.sample === sample); b.setAttribute("aria-checked", b.dataset.sample === sample); });
      $("[data-undo]").disabled = !past.length; $("[data-redo]").disabled = !future.length;
      $("[data-dirty]").textContent = dirty() ? "Not saved yet" : editing ? "Saved" : "";
    }

    // ---- the canvas: a see-through box over each part to pick, drag and resize it
    let focusHit = false; // put the keyboard on the picked part (after picking it on the canvas, or moving it with the keys)
    function drawOverlay() {
      const els = doc.layout.elements;
      focusHit = focusHit || over.contains(document.activeElement);
      over.innerHTML = els.map((e, i) => e.hidden ? "" : `<div class="ld-hit${e.id === sel ? " sel" : ""}${e.y < 6 ? " low" : ""}" data-hit="${esc(e.id)}" tabindex="0" role="button"
          aria-label="${esc(TL.TYPES[e.type].label)}, ${r1(e.x)}% across, ${r1(e.y)}% down, ${r1(e.w)}% by ${r1(e.h)}%${e.id === sel ? ", picked" : ""}"
          style="left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%;z-index:${e.type === "message" && e.cover !== false && e.id !== sel ? 0 : i + 1}">
          ${e.id === sel ? `<span class="ld-tag">${esc(TL.TYPES[e.type].label)}</span>` + ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => `<i class="ld-h h-${h}" data-h="${h}"></i>`).join("") : ""}</div>`).join("") +
        '<div class="ld-guide v hidden"></div><div class="ld-guide h hidden"></div>';
      if (sel && focusHit) over.querySelector(`[data-hit="${CSS.escape(sel)}"]`)?.focus({ preventScroll: true });
      focusHit = false;
    }

    // Snap an edge to the middle or sides of the screen, or to another part's edges and middle.
    function snapper(id) {
      const xs = [0, 50, 100], ys = [0, 50, 100];
      for (const o of doc.layout.elements) if (o.id !== id && !o.hidden) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
      const near = (v, list) => { let best = null; for (const t of list) if (Math.abs(t - v) < 0.9 && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t; return best; };
      return { xs, ys, near };
    }
    function guides(gx, gy) {
      const v = over.querySelector(".ld-guide.v"), h = over.querySelector(".ld-guide.h");
      v.classList.toggle("hidden", gx == null); h.classList.toggle("hidden", gy == null);
      if (gx != null) v.style.left = gx + "%";
      if (gy != null) h.style.top = gy + "%";
    }

    over.addEventListener("pointerdown", (ev) => {
      const hit = ev.target.closest("[data-hit]");
      if (!hit) { sel = null; render(); return; }
      if (!isAdmin) return;
      ev.preventDefault();
      const id = hit.dataset.hit, handle = ev.target.dataset.h || "";
      focusHit = true;
      if (sel !== id) { sel = id; render(); }
      const e = find(id), start = { ...e }, before = snap(), rect = canvas.getBoundingClientRect();
      const sx = ev.clientX, sy = ev.clientY;
      const { xs, ys, near } = snapper(id);
      let moved = false;
      const move = (m) => {
        const dx = (m.clientX - sx) / rect.width * 100, dy = (m.clientY - sy) / rect.height * 100;
        if (!moved && Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 3) return;
        moved = true;
        focusHit = true;
        const free = m.ctrlKey || m.metaKey;
        let gx = null, gy = null;
        const snapEdge = (v, list, set) => { if (free) return r1(v); const t = near(v, list); if (t !== null) { set(t); return t; } return Math.round(v * 2) / 2; };
        if (!handle) {
          let x = clamp(start.x + dx, 0, 100 - e.w), y = clamp(start.y + dy, 0, 100 - e.h);
          if (!free) {
            // the part's left edge, middle or right edge, whichever is nearest something
            for (const off of [0, e.w / 2, e.w]) { const t = near(x + off, xs); if (t !== null) { x = t - off; gx = t; break; } }
            for (const off of [0, e.h / 2, e.h]) { const t = near(y + off, ys); if (t !== null) { y = t - off; gy = t; break; } }
            if (gx === null) x = Math.round(x * 2) / 2;
            if (gy === null) y = Math.round(y * 2) / 2;
          }
          e.x = r1(clamp(x, 0, 100 - e.w)); e.y = r1(clamp(y, 0, 100 - e.h));
        } else {
          let l = start.x, t = start.y, r = start.x + start.w, b = start.y + start.h;
          if (handle.includes("w")) l = snapEdge(clamp(start.x + dx, 0, r - 1), xs, (v) => (gx = v));
          if (handle.includes("e")) r = snapEdge(clamp(r + dx, l + 1, 100), xs, (v) => (gx = v));
          if (handle.includes("n")) t = snapEdge(clamp(start.y + dy, 0, b - 1), ys, (v) => (gy = v));
          if (handle.includes("s")) b = snapEdge(clamp(b + dy, t + 1, 100), ys, (v) => (gy = v));
          e.x = r1(l); e.y = r1(t); e.w = r1(Math.max(1, r - l)); e.h = r1(Math.max(1, b - t));
        }
        const look = { layout: doc.layout, background: doc.background, text: doc.text, logos };
        lay.set(look); lay.update(frame(sample));
        const box = over.querySelector(`[data-hit="${CSS.escape(id)}"]`);
        Object.assign(box.style, { left: e.x + "%", top: e.y + "%", width: e.w + "%", height: e.h + "%" });
        guides(gx, gy);
        drawProps(true);
      };
      const up = () => {
        removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
        guides(null, null);
        if (moved && snap() !== before) { past.push(before); future = []; }
        render();
      };
      addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    });

    el.addEventListener("keydown", (ev) => {
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName);
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === "z" && !inField) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if (mod && ev.key.toLowerCase() === "y" && !inField) { ev.preventDefault(); redo(); return; }
      if (inField || !sel || !isAdmin || !ev.target.closest("[data-over]")) return;
      const e = find(sel);
      if (!e) return;
      const step = ev.shiftKey ? 5 : 0.5;
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[ev.key]) {
        ev.preventDefault();
        const [dx, dy] = arrows[ev.key];
        change(() => {
          if (ev.altKey) { e.w = r1(clamp(e.w + dx, 1, 100 - e.x)); e.h = r1(clamp(e.h + dy, 1, 100 - e.y)); }
          else { e.x = r1(clamp(e.x + dx, 0, 100 - e.w)); e.y = r1(clamp(e.y + dy, 0, 100 - e.h)); }
        });
      } else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); remove(sel); }
      else if (mod && ev.key.toLowerCase() === "d") { ev.preventDefault(); duplicate(sel); }
      else if (ev.key === "Escape") { sel = null; render(); }
    });

    function remove(id) { change(() => { doc.layout.elements = doc.layout.elements.filter((x) => x.id !== id); }); sel = null; render(); }
    function duplicate(id) {
      const e = find(id); if (!e) return;
      const n = { ...copy(e), id: newId(e.type), x: r1(clamp(e.x + 2, 0, 100 - e.w)), y: r1(clamp(e.y + 2, 0, 100 - e.h)) };
      change(() => doc.layout.elements.push(n)); sel = n.id; render();
    }
    function restack(id, by) {
      change(() => {
        const a = doc.layout.elements, i = a.findIndex((x) => x.id === id), j = clamp(i + by, 0, a.length - 1);
        if (i !== j) a.splice(j, 0, a.splice(i, 1)[0]);
      });
    }

    // ---- the parts list: the top of the list is drawn on top
    function drawLayers() {
      const els = doc.layout.elements;
      $("[data-layers]").innerHTML = [...els].reverse().map((e) => `<li class="${e.id === sel ? "sel" : ""}${e.hidden ? " off" : ""}">
          <button class="ld-pick" data-pick-el="${esc(e.id)}" aria-pressed="${e.id === sel}">${esc(TL.TYPES[e.type].label)}${e.type === "text" && e.text ? `: ${esc(e.text.slice(0, 18))}` : ""}</button>
          ${isAdmin ? `<button class="small" data-up="${esc(e.id)}" aria-label="Bring ${esc(TL.TYPES[e.type].label)} forward" title="Forward">▲</button><button class="small" data-down="${esc(e.id)}" aria-label="Send ${esc(TL.TYPES[e.type].label)} back" title="Back">▼</button>
          <button class="small" data-eye="${esc(e.id)}" aria-pressed="${!e.hidden}" title="${e.hidden ? "Hidden: show it" : "Shown: hide it"}" aria-label="${e.hidden ? "Show" : "Hide"} ${esc(TL.TYPES[e.type].label)}">${e.hidden ? "◌" : "●"}</button>` : ""}</li>`).join("")
        || '<li class="muted small">Nothing yet. Add a part above.</li>';
    }

    // ---- the settings on the right: the picked part, or the whole view
    const num = (k, v, label, min, max, step = 0.5) => `<label class="ld-f"><span>${label}</span><input type="number" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}"></label>`;
    const chk = (k, v, label) => `<label class="ld-c"><input type="checkbox" data-k="${k}" ${v ? "checked" : ""}> ${label}</label>`;
    const colour = (k, v, label, optional) => optional
      ? `<div class="ld-f"><span>${label}</span><span class="row" style="gap:.3rem;flex-wrap:nowrap"><input type="checkbox" data-own="${k}" ${v ? "checked" : ""} aria-label="Own ${label.toLowerCase()}"><input type="color" data-k="${k}" value="${v || "#ffffff"}" ${v ? "" : "disabled"} aria-label="${label}"></span></div>`
      : `<label class="ld-f"><span>${label}</span><input type="color" data-k="${k}" value="${v}"></label>`;

    function drawProps(onlyNumbers) {
      const box = $("[data-props]"), e = sel && find(sel);
      if (onlyNumbers && e) { for (const k of ["x", "y", "w", "h"]) { const i = box.querySelector(`[data-k="${k}"]`); if (i) i.value = e[k]; } return; }
      if (onlyNumbers) return;
      const dis = isAdmin ? "" : " disabled";
      if (e) {
        const T = TL.TYPES[e.type], texty = !["progress", "logo", "box", "status"].includes(e.type);
        box.innerHTML = `<fieldset${dis}><legend class="sr-only">${esc(T.label)}</legend>
          <div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(T.label)}</h2><button class="small" data-desel>View settings</button></div>
          <h3 style="margin-top:.8rem">Place</h3>
          <div class="ld-grid">${num("x", e.x, "Across %", 0, 100)}${num("y", e.y, "Down %", 0, 100)}${num("w", e.w, "Width %", 1, 100)}${num("h", e.h, "Height %", 1, 100)}</div>
          <div class="row" style="gap:.3rem;margin-top:.4rem"><button class="small" data-quick="centre">Centre</button><button class="small" data-quick="hcentre">Centre across</button><button class="small" data-quick="full">Full width</button></div>
          ${texty ? `<h3 style="margin-top:.8rem">Words</h3>
            ${e.type === "text" ? `<label class="ld-f"><span>Text</span><input data-k="text" value="${esc(e.text)}" maxlength="200"></label>` : ""}
            ${TL.LABELLED.has(e.type) ? `<label class="ld-f"><span>Label in front</span><input data-k="text" value="${esc(e.text)}" maxlength="60" placeholder="e.g. Next:"></label>` : ""}
            <div class="ld-f"><span>Line up</span><div class="ld-seg" role="radiogroup" aria-label="Line up">${["left", "center", "right"].map((a) => `<button class="small${e.align === a ? " on" : ""}" role="radio" aria-checked="${e.align === a}" data-align="${a}">${{ left: "Left", center: "Middle", right: "Right" }[a]}</button>`).join("")}</div></div>
            <label class="ld-f"><span>Text size</span><input type="range" data-k="size" min="10" max="100" value="${e.size}" aria-valuetext="${e.size}% of the box"></label>
            <div class="row" style="gap:1rem">${chk("bold", e.bold !== false, "Bold")}${chk("upper", e.upper, "Capitals")}</div>` : ""}
          ${e.type === "message" ? chk("cover", e.cover !== false, "Fill the whole screen when a message is up") : ""}
          <h3 style="margin-top:.8rem">Colour</h3>
          ${e.type === "box" ? "" : colour("color", e.color, e.type === "progress" ? "Bar colour" : "Text colour", true)}
          ${colour("bg", e.bg, "Background", true)}
          ${e.bg ? `<label class="ld-f"><span>See-through</span><input type="range" data-k="bg_opacity" min="0" max="100" value="${e.bg_opacity}" aria-valuetext="${e.bg_opacity}% solid"></label>` : ""}
          <label class="ld-f"><span>Round corners</span><input type="range" data-k="radius" min="0" max="50" value="${e.radius}"></label>
          ${e.type === "logo" ? `<p class="small muted">The logo is the one under View settings → Pictures.</p>` : ""}
          <div class="row" style="gap:.3rem;margin-top:1rem"><button class="small" data-dup>Copy</button><button class="small" data-hide>${e.hidden ? "Show" : "Hide"}</button><span class="grow"></span><button class="small danger" data-rm>Remove</button></div>
          </fieldset>`;
      } else {
        const L = doc.layout;
        box.innerHTML = `<fieldset${dis}><legend class="sr-only">View settings</legend><h2 style="margin:0 0 .4rem">View settings</h2>
          <label class="ld-f"><span>Name</span><input data-d="name" value="${esc(doc.name)}" maxlength="80" placeholder="e.g. Green room" required></label>
          ${doc._legacy && !doc._legacy.layout ? '<p class="small muted">This view was made before the layout designer. Its parts are laid out here the way it looked; saving keeps the new layout.</p>' : ""}
          <h3 style="margin-top:.8rem">Look</h3>
          ${colour("background", doc.background, "Background")}${colour("text", doc.text, "Text")}
          <label class="ld-f"><span>Font</span><select data-l="font">${Object.entries(TL.FONT_NAMES).map(([k, n]) => `<option value="${k}" ${L.font === k ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
          ${chk("transparent", L.transparent, "See-through background (for an overlay window or a vision mixer)")}
          <h3 style="margin-top:.8rem">Timer colours</h3>
          <div class="ld-grid">${colour("warn", L.warn, "Warning")}${colour("danger", L.danger, "Danger")}${colour("over", L.over, "Overtime")}</div>
          ${chk("flash_over", L.flash_over !== false, "Flash a red border round the screen in overtime")}
          <h3 style="margin-top:.8rem">Pictures</h3>
          ${editing ? ["logo", "bg"].map((slot) => `<div class="ld-f"><span>${slot === "logo" ? "Logo" : "Background picture"}</span><span class="row" style="gap:.3rem">
              ${logos[slot] ? `<img src="${esc(logos[slot])}" alt="" class="ld-thumb">` : ""}
              <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" data-up="${slot}" aria-label="Upload a ${slot === "logo" ? "logo" : "background picture"}" style="width:auto;max-width:12rem">
              ${logos[slot] ? `<button class="small" data-unpic="${slot}">Remove</button>` : ""}</span></div>`).join("") +
            (logos.bg ? `<label class="ld-f"><span>Fit the picture</span><select data-l="bg_fit">${[["cover", "Fill the screen"], ["contain", "Show it all"], ["stretch", "Stretch"]].map(([k, n]) => `<option value="${k}" ${L.bg_fit === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>` : "")
            : '<p class="small muted">Save the view first, then add a logo and a background picture.</p>'}
          ${editing ? '<div class="row" style="margin-top:1rem"><span class="grow"></span><button class="small danger" data-delview>Remove this view</button></div>' : ""}
          </fieldset>`;
      }
    }

    const props = $("[data-props]");
    props.addEventListener("input", (ev) => {
      const t = ev.target, e = sel && find(sel);
      if (t.dataset.k && e) {
        const k = t.dataset.k;
        change(() => {
          if (t.type === "checkbox") e[k] = t.checked;
          else if (t.type === "number" || t.type === "range") {
            let v = +t.value; if (isNaN(v)) return;
            if (k === "x") v = clamp(v, 0, 100 - e.w); if (k === "y") v = clamp(v, 0, 100 - e.h);
            if (k === "w") v = clamp(v, 1, 100 - e.x); if (k === "h") v = clamp(v, 1, 100 - e.y);
            e[k] = r1(v);
          } else e[k] = t.value;
        }, { keep: t.type === "range" || t.type === "color" || t.type === "text" ? !!t._typing : false });
        if (t.type === "range" || t.type === "color" || t.type === "text") t._typing = true; // one undo step per drag or word
        refocus(t);
      } else if (t.dataset.k) {
        change(() => { const L = doc.layout; if (t.dataset.k in L) L[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value; else doc[t.dataset.k] = t.value; }, { keep: !!t._typing && t.type === "color" });
        if (t.type === "color") t._typing = true;
        refocus(t);
      } else if (t.dataset.l) { change(() => { doc.layout[t.dataset.l] = t.value; }); refocus(t); }
      else if (t.dataset.d) { change(() => { doc[t.dataset.d] = t.value; }, { keep: !!t._typing }); t._typing = true; refocus(t); }
    });
    props.addEventListener("change", (ev) => {
      const t = ev.target;
      t._typing = false;
      if (t.dataset.own && sel) {
        const e = find(sel), k = t.dataset.own;
        change(() => { e[k] = t.checked ? (k === "bg" ? "#1e293b" : "#ffcc00") : ""; });
      }
      if (t.dataset.up && t.files[0]) {
        guard(() => upload(`/api/timers-views/look/built:${editing}/logo/${t.dataset.up}`, t.files[0])).then(async (r) => {
          logos = { ...logos, [t.dataset.up]: r.url }; toast("Picture saved", "good"); render();
        });
      }
    });
    // After the panel redraws, put the cursor back where the admin was typing.
    function refocus(t) {
      const q = t.dataset.k ? `[data-k="${t.dataset.k}"]` : t.dataset.l ? `[data-l="${t.dataset.l}"]` : `[data-d="${t.dataset.d}"]`;
      const n = props.querySelector(q);
      if (n && n !== t) {
        n._typing = t._typing; n.focus();
        if (n.setSelectionRange && t.selectionStart != null && n.type === "text") try { n.setSelectionRange(t.selectionStart, t.selectionEnd); } catch (_) {}
      }
    }
    props.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      const e = sel && find(sel);
      if (b.dataset.desel !== undefined) { sel = null; render(); }
      if (b.dataset.align && e) change(() => { e.align = b.dataset.align; });
      if (b.dataset.quick && e) change(() => {
        if (b.dataset.quick === "full") { e.x = 0; e.w = 100; }
        if (b.dataset.quick !== "full") e.x = r1((100 - e.w) / 2);
        if (b.dataset.quick === "centre") e.y = r1((100 - e.h) / 2);
      });
      if (b.dataset.dup !== undefined && e) duplicate(e.id);
      if (b.dataset.hide !== undefined && e) change(() => { e.hidden = !e.hidden; });
      if (b.dataset.rm !== undefined && e) remove(e.id);
      if (b.dataset.unpic) guard(() => del(`/api/timers-views/look/built:${editing}/logo/${b.dataset.unpic}`)).then(() => { logos = { ...logos, [b.dataset.unpic]: "" }; render(); });
      if (b.dataset.delview !== undefined && confirm(`Remove ${doc.name}? Screens showing it go back to the Standard view.`))
        guard(() => del(`/api/timers-designs/${editing}`)).then(() => { toast("View removed", "good"); onSaved(null); open(null); });
    });

    $("[data-layers]").addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.pickEl) { sel = b.dataset.pickEl; render(); }
      if (b.dataset.up) restack(b.dataset.up, 1);
      if (b.dataset.down) restack(b.dataset.down, -1);
      if (b.dataset.eye) { const e = find(b.dataset.eye); change(() => { e.hidden = !e.hidden; }); }
    });
    el.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
      const n = TL.element(b.dataset.add, newId(b.dataset.add));
      change(() => doc.layout.elements.push(n)); sel = n.id; render();
    });
    el.querySelectorAll("[data-sample]").forEach((b) => b.onclick = () => { sample = b.dataset.sample; render(); });
    $("[data-undo]").onclick = undo; $("[data-redo]").onclick = redo;
    $("[data-tpl]").onchange = (ev) => {
      const t = TL.TEMPLATES[ev.target.value]; ev.target.value = "";
      if (!t || (doc.layout.elements.length && !confirm(`Replace this layout with ${t.name}? You can undo it.`))) return;
      change(() => { doc.background = t.background; doc.text = t.text; doc.layout = { ...LAYOUT, ...copy(t.layout) }; if (!doc.name && !editing) doc.name = t.name; });
      sel = null; render();
    };
    $("[data-pick]").onchange = (ev) => {
      if (dirty() && !confirm("Leave this layout without saving it?")) { ev.target.value = editing || ""; return; }
      open(ev.target.value || null);
    };

    async function save(asNew) {
      if (!doc.name.trim()) { sel = null; render(); toast("Give the view a name", "bad"); props.querySelector('[data-d="name"]')?.focus(); return; }
      const { _legacy, ...body } = copy(doc);
      const keep = _legacy ? Object.fromEntries(Object.entries(_legacy).filter(([k]) => k.startsWith("show_") || k.endsWith("_size"))) : {};
      const out = { ...keep, ...body, name: doc.name.trim() + (asNew && editing ? " copy" : "") };
      const r = await guard(() => editing && !asNew ? put(`/api/timers-designs/${editing}`, out) : post("/api/timers-designs", out));
      if (!r) return;
      toast(editing && !asNew ? "Saved. Screens showing it have updated." : "View saved. Pick it for a screen under Screens.", "good");
      const s = r.slug || editing;
      onSaved(s);
      await open(s);
    }
    if (isAdmin) { $("[data-save]").onclick = () => save(false); $("[data-saveas]").onclick = () => save(true); }

    // Don't lose a layout by leaving the page.
    const leave = (ev) => { if (doc && dirty()) { ev.preventDefault(); ev.returnValue = ""; } };
    addEventListener("beforeunload", leave);
    const watch = setInterval(() => { if (!document.body.contains(el)) { removeEventListener("beforeunload", leave); clearInterval(watch); lay && lay.destroy(); } }, 2000);

    open(slug);
    return { isDirty: () => doc && dirty() };
  }

  return { mount, fromLegacy, SAMPLES };
})();
