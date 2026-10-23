// AT SUITE website: menu, monthly/yearly switch, copy buttons, order status. No inline scripts (CSP).
(() => {
  // One polite live region (in base.html) for short spoken updates: "Copied", "Showing monthly prices".
  const announce = (text) => {
    const el = document.getElementById("announce");
    if (!el) return;
    el.textContent = "";
    setTimeout(() => { el.textContent = text; }, 50);
  };

  const menu = document.querySelector(".menu-toggle");
  const nav = document.getElementById("nav");
  if (menu && nav) {
    menu.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      menu.setAttribute("aria-expanded", String(open));
    });
    // Escape closes the open menu and puts focus back on its button.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        nav.classList.remove("open");
        menu.setAttribute("aria-expanded", "false");
        menu.focus();
      }
    });
  }

  // Pricing: one switch for every plan card. Remembered for the visit only.
  const scope = document.querySelector("[data-cycle]");
  document.querySelectorAll(".cycle button").forEach((b) => {
    b.addEventListener("click", () => {
      scope.dataset.cycle = b.dataset.value;
      document.querySelectorAll(".cycle button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      announce(b.dataset.value === "month" ? "Showing monthly prices" : "Showing yearly prices");
      document.querySelectorAll("a[data-buy]").forEach((a) => {
        const u = new URL(a.href, location.href);
        u.searchParams.set("cycle", b.dataset.value);
        a.href = u.pathname + u.search;
      });
    });
  });

  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      const el = document.getElementById(b.dataset.copy);
      try {
        await navigator.clipboard.writeText(el.textContent.trim());
        const t = b.textContent;
        b.textContent = "Copied";
        announce("Copied");
        setTimeout(() => (b.textContent = t), 1500);
      } catch {
        const r = document.createRange();
        r.selectNodeContents(el);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }
    });
  });

  // Sign-in link: the token is after "#" so it stays out of web addresses servers see. Move it into the
  // form and wipe it from the address bar and history.
  const linkToken = document.getElementById("link-token");
  if (linkToken) {
    const t = new URLSearchParams(location.hash.slice(1)).get("token") || "";
    linkToken.value = t;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  // Forms: stop a second click sending twice.
  document.querySelectorAll("form").forEach((f) => {
    f.addEventListener("submit", (e) => {
      if (f.dataset.sent) { e.preventDefault(); return; }
      if (f.checkValidity()) f.dataset.sent = "1";
    });
  });

  // Confirm before risky admin actions.
  document.querySelectorAll("[data-confirm]").forEach((el) => {
    el.addEventListener("click", (e) => { if (!confirm(el.dataset.confirm)) e.preventDefault(); });
  });

  // Thank-you page: wait for the payment to be confirmed and the key made.
  const wait = document.querySelector("[data-order]");
  if (wait) {
    let tries = 0;
    const poll = async () => {
      tries++;
      try {
        const r = await fetch(`/account/order/${encodeURIComponent(wait.dataset.order)}`, { credentials: "same-origin" });
        if (r.ok) {
          const d = await r.json();
          if (d.licence) { location.href = "/account#licence"; return; }
        }
      } catch {}
      if (tries < 40) setTimeout(poll, 3000);
      else wait.textContent = "This is taking longer than usual. Your key will be emailed to you; you can close this page.";
    };
    poll();
  }

  // Animations on the features page move on their own, so each has a Pause button (WCAG 2.2.2) and
  // they stay still for people who ask for less motion.
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pauseButton = (b, playing, onToggle) => {
    const show = (on) => { b.textContent = on ? "Pause" : "Play"; b.setAttribute("aria-label", `${on ? "Pause" : "Play"} the animation`); };
    show(playing);
    b.hidden = false;
    b.addEventListener("click", () => show(onToggle()));
  };

  // Features: the stage timer through a session, one stage at a time.
  document.querySelectorAll("[data-slider]").forEach((el) => {
    const slides = [...el.querySelectorAll(".slide")];
    const picks = [...el.querySelectorAll("[data-slide-to]")];
    if (slides.length < 2) return;
    let at = 0, playing = !calm, timer = 0, held = false;
    const show = (i, user) => {
      at = (i + slides.length) % slides.length;
      slides.forEach((s, n) => s.classList.toggle("on", n === at));
      picks.forEach((p, n) => p.setAttribute("aria-pressed", String(n === at)));
      if (user) announce(slides[at].getAttribute("aria-label"));
    };
    const tick = () => {
      clearTimeout(timer);
      if (playing && !held) timer = setTimeout(() => { show(at + 1); tick(); }, 4000);
    };
    el.dataset.ready = "1";
    picks.forEach((p, n) => { p.hidden = false; p.addEventListener("click", () => { show(n, true); tick(); }); });
    // Hovering or focusing it holds it still, so nothing moves while someone reads or uses it.
    const hold = (on) => { held = on; tick(); };
    el.addEventListener("mouseenter", () => hold(true));
    el.addEventListener("mouseleave", () => hold(false));
    el.addEventListener("focusin", () => hold(true));
    el.addEventListener("focusout", (e) => { if (!el.contains(e.relatedTarget)) hold(false); });
    const play = el.querySelector("[data-slide-play]");
    if (play) pauseButton(play, playing, () => { playing = !playing; tick(); return playing; });
    show(0);
    tick();
  });

  // Features: the audience caption screen, with the words arriving as the speaker says them.
  document.querySelectorAll("[data-captions]").forEach((el) => {
    const box = el.querySelector(".caplines");
    const button = el.querySelector("[data-cap-play]");
    if (!box || calm) return;
    const speech = [
      "Good morning everyone and welcome to Riverside.",
      "Over the next ten years the way we build events will change more than in the last fifty.",
      "These captions are made on the tech's laptop as I speak,",
      "so every screen in the room can show them, and nothing leaves the building.",
      "Let's start with a question for all of you.",
    ];
    let line = 0, word = 0, playing = true, timer = 0, current = null;
    box.replaceChildren();
    const step = () => {
      if (!playing) return;
      const words = speech[line].split(" ");
      if (!current) {
        current = document.createElement("div");
        current.className = "capline";
        box.append(current);
        // Three lines at most: the oldest fades out, as on the real screen.
        const lines = [...box.querySelectorAll(".capline:not(.gone)")];
        if (lines.length > 3) {
          const old = lines[0];
          old.classList.add("gone");
          setTimeout(() => old.remove(), 1300);
        }
      }
      const w = document.createElement("span");
      w.className = "w";
      w.textContent = (word ? " " : "") + words[word];
      current.append(w);
      word++;
      let wait = 150 + Math.random() * 160;
      if (word >= words.length) {
        current = null;
        word = 0;
        line = (line + 1) % speech.length;
        wait = line ? 900 : 2600;
      }
      timer = setTimeout(step, wait);
    };
    if (button) pauseButton(button, true, () => { playing = !playing; clearTimeout(timer); if (playing) step(); return playing; });
    step();
  });

  // Boxes that scroll sideways (wide tables, code, licence keys) need a focus stop so a keyboard can scroll them.
  const labels = new Set();
  const scrollers = () => document.querySelectorAll(".table-wrap, pre, .key").forEach((el) => {
    const scrolls = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    if (scrolls && !el.hasAttribute("tabindex")) {
      el.tabIndex = 0;
      el.dataset.scrolls = "1";
      if (!el.getAttribute("role")) el.setAttribute("role", "region");
      if (!el.getAttribute("aria-label")) {
        const h = el.closest("section, .card, main")?.querySelector("h1, h2, h3");
        const what = el.matches(".table-wrap") ? "Table" : el.matches(".key") ? "Licence key" : "Code";
        let label = h ? `${what}: ${h.textContent.trim()}` : what;
        for (let n = 2; labels.has(label); n++) label = `${label.replace(/ \(\d+\)$/, "")} (${n})`;
        labels.add(label);
        el.setAttribute("aria-label", label);
      }
    } else if (!scrolls && el.dataset.scrolls) {
      el.removeAttribute("tabindex");
      delete el.dataset.scrolls;
    }
  });
  scrollers();
  let resizing;
  addEventListener("resize", () => { clearTimeout(resizing); resizing = setTimeout(scrollers, 150); });
})();
