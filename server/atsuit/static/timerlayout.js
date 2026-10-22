// Draws a timer view made in the layout designer (Timers → Layout designer). Each part
// (timer, cue title, clock, stage message, logo...) sits in its own box, placed as a
// share of the screen's width and height, so one layout fits any screen. The stage
// screens (timer.html) and the designer's canvas both draw with this, so what the
// admin sees while designing is what the screens show.
const TimerLayout = (() => {
  const FONTS = {
    arial: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
    saira: '"Saira", system-ui, sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    condensed: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace',
    serif: 'Georgia, "Times New Roman", serif',
  };
  const FONT_NAMES = { arial: "Arial", saira: "Saira", system: "System", condensed: "Condensed", mono: "Monospaced", serif: "Serif" };
  // Every kind of part, with the size it starts at (% of the screen) and its text height (% of its box).
  const TYPES = {
    timer: { label: "Timer", w: 70, h: 40, size: 90 },
    title: { label: "Cue title", w: 80, h: 10, size: 70 },
    next: { label: "Next cue", w: 60, h: 7, size: 70, text: "Next:" },
    clock: { label: "Time of day", w: 24, h: 8, size: 80 },
    message: { label: "Stage message", w: 90, h: 30, size: 80, cover: true },
    secondary: { label: "Second line", w: 60, h: 10, size: 80 },
    progress: { label: "Progress bar", w: 100, h: 2 },
    logo: { label: "Logo", w: 18, h: 12 },
    text: { label: "Text", w: 40, h: 8, size: 70, text: "Your text" },
    room: { label: "Room name", w: 24, h: 5, size: 70 },
    status: { label: "Status bar", w: 100, h: 7 },
    box: { label: "Shape", w: 30, h: 20, bg: "#1e293b" },
  };
  const LABELLED = new Set(["title", "next", "clock", "secondary", "room"]); // these can have a label in front
  const WRAPS = new Set(["message", "text"]); // these wrap onto more lines and shrink to fit their box

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = `
    .tl-root { position: absolute; inset: 0; overflow: hidden; background: var(--tl-bg); color: var(--tl-fg); container-type: size; }
    .tl-root.clear { background: transparent; }
    .tl-bgimg { position: absolute; inset: 0; background-position: center; background-repeat: no-repeat; pointer-events: none; }
    .tl-el { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center;
      container-type: size; overflow: hidden; color: var(--c, var(--tl-fg)); }
    .tl-el.al-left { justify-content: flex-start; text-align: left; } .tl-el.al-right { justify-content: flex-end; text-align: right; }
    .tl-in { font-size: calc(var(--sz) * 1cqh); line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; padding: 0 .12em; max-width: 100%; box-sizing: border-box; }
    .tl-el.bold .tl-in { font-weight: 700; } .tl-el.upper .tl-in { text-transform: uppercase; letter-spacing: .04em; }
    .tl-el.wrap .tl-in { white-space: normal; line-height: 1.12; overflow-wrap: anywhere; }
    .tl-in .lb { opacity: .62; margin-right: .35em; font-weight: inherit; }
    .tl-el.t-timer .tl-in { transition: color .4s ease; }
    .tl-el.t-timer.warn .tl-in { color: var(--tl-warn); } .tl-el.t-timer.danger .tl-in { color: var(--tl-danger); } .tl-el.t-timer.over .tl-in { color: var(--tl-over); }
    .tl-el.t-secondary.over .tl-in { color: var(--tl-danger); }
    .tl-el.blink .tl-in { animation: tl-pulse .8s ease-in-out infinite; }
    @keyframes tl-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .12; } }
    .tl-el.t-logo img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
    .tl-el.t-progress { background: color-mix(in srgb, var(--c, var(--tl-fg)) 15%, transparent); }
    .tl-el.t-progress i { position: absolute; top: 0; bottom: 0; }
    .tl-el.t-progress .zn { background: var(--c, var(--tl-fg)); } .tl-el.t-progress .zw { background: var(--tl-warn); } .tl-el.t-progress .zd { background: var(--tl-danger); }
    .tl-el.t-progress .mask { background: var(--tl-bg); opacity: .55; }
    .tl-root.clear .tl-el.t-progress .mask { background: #000; }
    .tl-el.t-progress .ot { inset: 0; background: var(--tl-over); display: none; }
    .tl-el.t-progress.over .ot { display: block; } .tl-el.t-progress.over :is(.zn, .zw, .zd, .mask) { display: none; }
    .tl-el.t-progress.off { visibility: hidden; }
    .tl-el.t-status { justify-content: flex-start; gap: 4cqh; padding: 0 1.4cqw; font-variant-numeric: tabular-nums; }
    .tl-el.t-status .it { display: flex; flex-direction: column; justify-content: center; flex-shrink: 0; line-height: 1.15; min-width: 0; }
    .tl-el.t-status .it.grow { flex: 1; flex-shrink: 1; }
    .tl-el.t-status .it b { font-size: 20cqh; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; opacity: .62; }
    .tl-el.t-status .it span { font-size: 40cqh; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tl-el.t-status .it.over span { color: var(--tl-over); }
    .tl-el.t-status .it.empty { display: none; }
    .tl-el.t-message.off .tl-in { visibility: hidden; }
    .tl-cover { position: absolute; inset: 0; z-index: 900; display: none; align-items: center; justify-content: center; padding: 4cqw; box-sizing: border-box;
      background: var(--tl-bg); text-align: center; container-type: size; }
    .tl-root.clear .tl-cover { background: rgba(0,0,0,.92); }
    .tl-cover.on { display: flex; }
    .tl-cover div { font-size: 18cqh; font-weight: 600; line-height: 1.15; overflow-wrap: anywhere; color: var(--c, var(--tl-fg)); }
    .tl-cover.blink div { animation: tl-pulse .8s ease-in-out infinite; }
    .tl-alert { position: absolute; inset: 0; z-index: 950; pointer-events: none; box-sizing: border-box; border: 0 solid var(--tl-over); }
    .tl-alert.on { animation: tl-border .6s ease-in-out infinite; }
    @keyframes tl-border { 0%, 100% { border-width: 1.5cqmin; } 50% { border-width: 4cqmin; } }
    @media (prefers-reduced-motion: reduce) { .tl-el.blink .tl-in, .tl-cover.blink div { animation-duration: 2.4s; } }
    .tl-root.edit .tl-el.empty::after { content: attr(data-label); position: absolute; inset: 0; padding: 2px 5px; box-sizing: border-box;
      font: 600 11px/1.3 system-ui, sans-serif; color: var(--tl-fg); opacity: .4; border: 1px dashed currentColor; text-align: left; }
  `;

  function addCss() {
    if (document.getElementById("tl-css")) return;
    const st = document.createElement("style");
    st.id = "tl-css"; st.textContent = css;
    document.head.append(st);
  }

  const withAlpha = (hex, pct) => pct >= 100 ? hex : `color-mix(in srgb, ${hex} ${pct}%, transparent)`;

  // host: the element to draw in. look: { layout, background, text, logos: { logo, bg } }.
  // edit: true in the designer (empty parts show their name so they can be found).
  function mount(host, look, { edit = false } = {}) {
    addCss();
    const root = document.createElement("div");
    root.className = "tl-root" + (edit ? " edit" : "");
    host.append(root);
    let L = null, nodes = new Map(), last = null;

    function set(next) {
      look = next || look;
      L = look.layout || { elements: [] };
      const st = root.style;
      st.setProperty("--tl-bg", look.background || "#000000");
      st.setProperty("--tl-fg", look.text || "#ffffff");
      st.setProperty("--tl-warn", L.warn || "#ffcc00");
      st.setProperty("--tl-danger", L.danger || "#ff1744");
      st.setProperty("--tl-over", L.over || "#ff0000");
      st.fontFamily = FONTS[L.font] || FONTS.arial;
      root.classList.toggle("clear", !!L.transparent);
      const bgUrl = look.logos && look.logos.bg;
      const fit = { cover: "cover", contain: "contain", stretch: "100% 100%" }[L.bg_fit] || "cover";
      root.innerHTML = `<div class="tl-bgimg" style="${bgUrl ? `background-image:url('${esc(bgUrl)}');background-size:${fit}` : ""}"></div>` +
        (L.elements || []).filter((e) => !e.hidden).map((e, i) => part(e, i)).join("") +
        '<div class="tl-cover"><div></div></div><div class="tl-alert"></div>';
      nodes = new Map([...root.querySelectorAll(".tl-el")].map((n) => [n.dataset.id, n]));
      for (const img of root.querySelectorAll(".t-logo img")) img.onerror = () => { img.remove(); };
      if (last) update(last, true);
    }

    function part(e, i) {
      const T = TYPES[e.type] || {};
      const style = [`left:${e.x}%`, `top:${e.y}%`, `width:${e.w}%`, `height:${e.h}%`, `z-index:${i + 1}`, `--sz:${e.size || T.size || 80}`];
      if (e.color) style.push(`--c:${e.color}`);
      if (e.bg) style.push(`background:${withAlpha(e.bg, e.bg_opacity ?? 100)}`);
      if (e.radius) style.push(`border-radius:${e.radius * 0.5}cqmin`);
      const cls = ["tl-el", `t-${e.type}`, `al-${e.align || "center"}`, e.bold === false ? "" : "bold", e.upper ? "upper" : "", WRAPS.has(e.type) ? "wrap" : ""].filter(Boolean).join(" ");
      let inner = '<div class="tl-in"></div>';
      if (e.type === "progress") inner = '<i class="zn"></i><i class="zw"></i><i class="zd"></i><i class="mask"></i><i class="ot"></i>';
      if (e.type === "box") inner = "";
      if (e.type === "logo") {
        const url = look.logos && look.logos.logo;
        inner = url ? `<img src="${esc(url)}" alt="">` : "";
      }
      if (e.type === "status") {
        inner = [["tod", "Time now"], ["state", "Timer"], ["cue", "Now", "grow"], ["start", "Started"], ["elapsed", "Elapsed"], ["end", "Expected end"]]
          .map(([k, l, c]) => `<div class="it ${c || ""}" data-s="${k}"><b>${l}</b><span></span></div>`).join("");
      }
      const empty = (e.type === "logo" && !(look.logos && look.logos.logo)) ? " empty" : "";
      return `<div class="${cls}${empty}" data-id="${esc(e.id)}" data-label="${esc(T.label || e.type)}" style="${style.join(";")}">${inner}</div>`;
    }

    // Shrink a part's words until they fit its box (one line, or several for the ones that wrap).
    function fit(n) {
      const t = n.firstElementChild;
      if (!t || !t.classList.contains("tl-in")) return;
      t.style.fontSize = "";
      if (!t.textContent) return;
      if (n.classList.contains("wrap")) {
        let size = parseFloat(getComputedStyle(t).fontSize), k = 0;
        while ((t.scrollHeight > n.clientHeight * 1.01 || t.scrollWidth > n.clientWidth + 1) && size > 6 && k++ < 40) { size *= 0.9; t.style.fontSize = size + "px"; }
      } else if (t.scrollWidth > n.clientWidth + 1) {
        t.style.fontSize = parseFloat(getComputedStyle(t).fontSize) * n.clientWidth / t.scrollWidth * 0.98 + "px";
      }
    }

    function text(n, e, value, label = true) {
      const t = n.firstElementChild;
      const v = value == null ? "" : String(value);
      const html = v && label && e.text && LABELLED.has(e.type) ? `<span class="lb">${esc(e.text)}</span>${esc(v)}` : esc(v);
      if (t._v === html) return;
      const grew = !t._v || t._v.length !== html.length;
      t._v = html; t.innerHTML = html;
      n.classList.toggle("empty", !v);
      if (grew || !n.classList.contains("t-timer")) fit(n);
    }

    // f: what to show now, worked out by the page (live) or the designer (a sample).
    function update(f, force) {
      last = f;
      if (force) for (const n of nodes.values()) if (n.firstElementChild) n.firstElementChild._v = undefined;
      let cover = null;
      for (const e of L.elements || []) {
        const n = nodes.get(e.id);
        if (!n) continue;
        switch (e.type) {
          case "timer": {
            text(n, e, f.timer.text);
            const cls = `tl-el t-timer al-${e.align || "center"}${e.bold === false ? "" : " bold"}${e.upper ? " upper" : ""} ${f.timer.phase || ""}${f.timer.blink ? " blink" : ""}${f.timer.text ? "" : " empty"}`;
            if (n.className !== cls) n.className = cls;
            break;
          }
          case "title": text(n, e, f.title); break;
          case "next": text(n, e, f.next); break;
          case "clock": text(n, e, f.clock); break;
          case "room": text(n, e, f.room); break;
          case "text": text(n, e, e.text, false); break;
          case "secondary":
            text(n, e, f.secondary.on ? f.secondary.text : "");
            n.classList.toggle("over", !!f.secondary.over);
            break;
          case "message":
            if (e.cover !== false) { cover = cover || e; text(n, e, ""); n.classList.add("empty"); break; }
            text(n, e, f.message.on ? f.message.text : "");
            n.classList.toggle("blink", !!(f.message.on && f.message.blink));
            break;
          case "progress": {
            const p = f.progress, [zn, zw, zd, mask] = n.children;
            n.classList.toggle("off", !!p.off); n.classList.toggle("over", !!p.over);
            const put = (el, l, w) => { el.style.left = l + "%"; el.style.width = w + "%"; };
            put(zn, 0, 100 - p.danger - p.warn); put(zw, 100 - p.danger - p.warn, p.warn); put(zd, 100 - p.danger, p.danger);
            put(mask, p.done, 100 - p.done);
            break;
          }
          case "status": {
            const s = f.status;
            for (const [k, v] of Object.entries(s.items)) {
              const it = n.querySelector(`[data-s="${k}"]`);
              if (!it) continue;
              if (it.lastChild.textContent !== v) it.lastChild.textContent = v;
              it.classList.toggle("empty", v === "—");
            }
            n.querySelector('[data-s="state"]').classList.toggle("over", s.over);
            break;
          }
        }
      }
      const cv = root.querySelector(".tl-cover");
      const on = !!(cover && f.message.on && f.message.text);
      cv.classList.toggle("on", on);
      cv.classList.toggle("blink", on && !!f.message.blink);
      cv.style.cssText = cover && cover.color ? `--c:${cover.color}` : "";
      if (on && cv.firstChild.textContent !== f.message.text) {
        cv.firstChild.textContent = f.message.text;
        const d = cv.firstChild;
        d.style.fontSize = "";
        let size = parseFloat(getComputedStyle(d).fontSize), k = 0;
        while ((d.scrollHeight > cv.clientHeight * 0.92 || d.scrollWidth > cv.clientWidth) && size > 10 && k++ < 40) { size *= 0.92; d.style.fontSize = size + "px"; }
      }
      root.querySelector(".tl-alert").classList.toggle("on", !!(f.alert && L.flash_over !== false));
    }

    set(look);
    const ro = new ResizeObserver(() => { for (const n of nodes.values()) fit(n); if (last) update(last, true); });
    ro.observe(root);
    return { root, set, update, node: (id) => nodes.get(id), destroy() { ro.disconnect(); root.remove(); } };
  }

  // A new part of the given type, placed in the middle of the screen.
  function element(type, id) {
    const T = TYPES[type];
    const e = { id, type, x: +((100 - T.w) / 2).toFixed(1), y: +((100 - T.h) / 2).toFixed(1), w: T.w, h: T.h, align: "center", color: "", bg: T.bg || "",
      bg_opacity: 100, radius: 0, size: T.size || 80, bold: true, upper: false, text: T.text || "", cover: T.cover ?? true, hidden: false };
    if (type === "progress") Object.assign(e, { x: 0, y: 98 });
    if (type === "status") Object.assign(e, { x: 0, y: 91, size: 80 });
    return e;
  }

  // Ready-made layouts to start from. Each part: [type, x, y, w, h, extra].
  const mk = (rows) => rows.map(([type, x, y, w, h, extra], i) => ({ ...element(type, `${type}${i}`), x, y, w, h, ...(extra || {}) }));
  const TEMPLATES = {
    standard: { name: "Standard", background: "#000000", text: "#ffffff", layout: { font: "arial", elements: mk([
      ["logo", 3.5, 3.5, 16, 10, { align: "left" }],
      ["timer", 4, 18, 92, 52, { size: 92 }],
      ["secondary", 10, 70, 80, 11],
      ["status", 0, 88.5, 100, 7.5],
      ["progress", 0, 96, 100, 4],
      ["message", 5, 20, 90, 60],
    ]) } },
    bdng: { name: "BDNG style", background: "#f5f5f5", text: "#1a1a1a", layout: { font: "arial", over: "#fa5656", danger: "#fa5656", elements: mk([
      ["logo", 11, 3, 78, 22],
      ["timer", 8, 30, 84, 34, { size: 92 }],
      ["secondary", 15, 64, 70, 9],
      ["text", 10, 76, 80, 6, { text: "Official Timekeeping Sponsor", size: 70, upper: true }],
      ["progress", 0, 97, 100, 3],
      ["message", 5, 20, 90, 60],
    ]) } },
    speaker: { name: "Speaker", background: "#0b1020", text: "#ffffff", layout: { font: "saira", elements: mk([
      ["title", 4, 4, 70, 9, { align: "left" }],
      ["clock", 74, 4, 22, 9, { align: "right" }],
      ["timer", 4, 18, 92, 50, { size: 92 }],
      ["next", 4, 74, 92, 8, { color: "#94a3b8" }],
      ["progress", 0, 96, 100, 4],
      ["message", 5, 20, 90, 60],
    ]) } },
    split: { name: "Timer and clock", background: "#000000", text: "#ffffff", layout: { font: "arial", elements: mk([
      ["box", 51, 12, 0.4, 60, { bg: "#334155" }],
      ["text", 4, 10, 44, 6, { text: "Time left", size: 70, upper: true, color: "#94a3b8" }],
      ["timer", 4, 20, 44, 40, { size: 70 }],
      ["text", 54, 10, 42, 6, { text: "Time now", size: 70, upper: true, color: "#94a3b8" }],
      ["clock", 54, 20, 42, 40, { size: 70 }],
      ["title", 4, 74, 92, 10],
      ["progress", 0, 96, 100, 4],
      ["message", 5, 20, 90, 60],
    ]) } },
    lower: { name: "Lower third", background: "#000000", text: "#ffffff", layout: { font: "saira", transparent: true, flash_over: false, elements: mk([
      ["box", 3, 74, 94, 20, { bg: "#0b1020", bg_opacity: 85, radius: 6 }],
      ["title", 6, 77, 58, 8, { align: "left" }],
      ["next", 6, 85.5, 58, 6, { align: "left", color: "#cbd5e1" }],
      ["timer", 66, 76, 28, 16, { align: "right", size: 85 }],
      ["progress", 3, 92.5, 94, 1.5],
      ["message", 6, 76, 58, 16, { cover: false, align: "left" }],
    ]) } },
    blank: { name: "Blank", background: "#000000", text: "#ffffff", layout: { font: "arial", elements: mk([["timer", 15, 30, 70, 40]]) } },
  };

  return { mount, element, TYPES, TEMPLATES, FONTS, FONT_NAMES, LABELLED };
})();
