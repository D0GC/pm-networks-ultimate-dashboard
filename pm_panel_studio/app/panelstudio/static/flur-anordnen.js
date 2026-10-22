/* PM Panel Studio – Startseite des Flurs anordnen. Läuft nur im Panel, das die Admin-Ansicht mit ?anordnen=1
   einbettet: Teile (Uhr, Wetter, Personen, Karten, Schnellzugriff, Räume …) zwischen und in den Spalten ziehen,
   ausblenden und wieder einblenden, die Spaltenbreiten an den Trennlinien ziehen. Jede Änderung wird sofort in den
   Einstellungen gespeichert (layouts „flur:teile“ und „flur:spalten“) und gilt damit auch auf dem Panel im Flur. */
(function () {
  "use strict";
  const PS = window.PS;
  const $ = (s) => document.querySelector(s);
  const start = $(".start");
  if (!start) return;
  document.body.classList.add("flur-anordnen");
  const stil = document.createElement("style");
  stil.textContent = `
    body.flur-anordnen .start{transform:none!important;opacity:1!important;filter:none!important}
    body.flur-anordnen .start > .spalte,body.flur-anordnen .start > .mitte{outline:1px dashed rgba(197,192,211,.35);outline-offset:.6rem;border-radius:1rem;opacity:1!important;transform:none!important;pointer-events:auto!important}
    body.flur-anordnen .fa-teil{position:relative;cursor:grab;touch-action:none;outline:1px dashed rgba(197,192,211,.25);outline-offset:.2rem;border-radius:.6rem}
    body.flur-anordnen .fa-teil.flur-aus{display:flex!important;opacity:.3}
    body.flur-anordnen .fa-teil.fa-zieht{opacity:.55;outline:2px solid #b07fd0}
    .fa-marke{position:absolute;z-index:20;top:-.9rem;right:.2rem;display:flex;gap:.3rem;align-items:center;font:600 .8rem system-ui,sans-serif;color:#ECEBF2;
      background:#1b1744;border:1px solid rgba(197,192,211,.32);border-radius:.5rem;padding:.15rem .25rem .15rem .5rem}
    .fa-marke,.fa-marke *{letter-spacing:normal!important;line-height:1.2!important;font-variant:normal!important;text-transform:none!important}
    .fa-marke .mdi{font-size:1rem!important;color:inherit!important;margin:0!important;display:inline!important}
    .fa-marke button{all:unset;cursor:pointer;width:1.4rem;height:1.4rem;display:grid;place-items:center;border-radius:.35rem;color:#C5C0D3}
    .fa-marke button:hover{background:rgba(255,255,255,.1)}
    .fa-trenner{position:fixed;z-index:30;top:0;bottom:0;width:14px;margin-left:-7px;cursor:ew-resize;touch-action:none}
    .fa-trenner::after{content:"";position:absolute;left:6px;top:8%;bottom:8%;width:2px;border-radius:2px;background:rgba(176,127,208,.7)}
    .fa-hinweis{position:fixed;z-index:40;left:50%;bottom:.8rem;transform:translateX(-50%);font:500 1rem system-ui,sans-serif;color:#ECEBF2;
      background:#1b1744;border:1px solid rgba(197,192,211,.32);border-radius:.8rem;padding:.5rem 1rem;pointer-events:none}
  `;
  document.head.appendChild(stil);
  const hinweis = document.createElement("div");
  hinweis.className = "fa-hinweis";
  hinweis.textContent = "Teile ziehen · Auge: aus- oder einblenden · Trennlinien: Spaltenbreite";
  document.body.appendChild(hinweis);

  const spalten = () => [$(".start > .spalte.links"), $(".start > .mitte"), $(".start > .spalte.rechts")];
  const teile = () => Object.keys(PS.FLUR_TEILE).map((id) => document.getElementById(id)).filter(Boolean);

  // Markieren: Rahmen und Marke (Name, Auge) an jedem Teil
  function markieren() {
    teile().forEach((el) => {
      el.classList.add("fa-teil");
      let m = el.querySelector(":scope > .fa-marke");
      if (!m) {
        m = document.createElement("span"); m.className = "fa-marke";
        m.innerHTML = `<span></span><button type="button" title="Aus- oder einblenden">${PS.ic("eye-outline")}</button>`;
        m.querySelector("span").textContent = PS.FLUR_TEILE[el.id];
        el.appendChild(m);
      }
      m.querySelector("button").innerHTML = PS.ic(el.classList.contains("flur-aus") ? "eye-off-outline" : "eye-outline");
    });
    trennerSetzen();
  }

  // Speichern: Folge aller Teile je Spalte (1 links, 2 Mitte, 3 rechts), ausgeblendete mit 9; Breiten der äußeren Spalten in Prozent
  async function speichern(mitBreiten) {
    const eintraege = [];
    spalten().forEach((sp, i) => [...sp.children].forEach((el) => {
      if (PS.FLUR_TEILE[el.id]) eintraege.push(`${el.classList.contains("flur-aus") ? 9 : i + 1}:0:${el.id}`);
    }));
    const layouts = { ...(PS.einst.layouts || {}), "flur:teile": eintraege };
    if (mitBreiten) {
      // Prozent der Inhaltsbreite des Rasters (ohne Innenabstand), wie grid-template-columns sie rechnet
      const st = getComputedStyle(start), b = start.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) || 1;
      const sp = st.gridTemplateColumns.split(" ").map(parseFloat);
      layouts["flur:spalten"] = [`0:${Math.round((sp[0] / b) * 100)}:links`, `0:${Math.round((sp[2] / b) * 100)}:rechts`];
    }
    try {
      const antwort = await fetch("api/einstellungen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layouts }) });
      if (!antwort.ok) throw new Error(await antwort.text());
      PS.einst.layouts = (await antwort.json()).einstellungen.layouts;
      window.parent.postMessage({ typ: "flur-gespeichert" }, "*");
    } catch (e) { PS.toast("Nicht gespeichert: " + (e.message || e), true); }
  }

  // Klicks auf Inhalte sind im Anordnen-Modus stumm; das Auge schaltet sichtbar/ausgeblendet
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".start")) return;
    ev.stopPropagation(); ev.preventDefault();
    const auge = ev.target.closest(".fa-marke button");
    if (auge) { auge.closest(".fa-teil").classList.toggle("flur-aus"); markieren(); speichern(); }
  }, true);

  // Ziehen: das Teil wandert unter dem Zeiger in die Spalte darunter, vor oder hinter das Teil unter dem Zeiger
  start.addEventListener("pointerdown", (ev) => {
    const el = ev.target.closest(".fa-teil");
    if (!el || ev.target.closest(".fa-marke button")) return;
    ev.preventDefault();
    const s0 = { x: ev.clientX, y: ev.clientY };
    let aktiv = false;
    const bewegen = (e) => {
      if (!aktiv) { if (Math.hypot(e.clientX - s0.x, e.clientY - s0.y) < 6) return; aktiv = true; el.classList.add("fa-zieht"); }
      e.preventDefault();
      const sp = spalten().find((x) => { const r = x.getBoundingClientRect(); return e.clientX >= r.left - 20 && e.clientX <= r.right + 20; });
      if (!sp) return;
      const unter = [...sp.children].filter((x) => x !== el && x.classList.contains("fa-teil"))
        .find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (unter) { if (el.nextElementSibling !== unter) sp.insertBefore(el, unter); } else if (sp.lastElementChild !== el) sp.appendChild(el);
    };
    const ende = () => {
      window.removeEventListener("pointermove", bewegen); window.removeEventListener("pointerup", ende); window.removeEventListener("pointercancel", ende);
      if (!aktiv) return;
      el.classList.remove("fa-zieht"); markieren(); speichern();
    };
    window.addEventListener("pointermove", bewegen, { passive: false });
    window.addEventListener("pointerup", ende);
    window.addEventListener("pointercancel", ende);
  });

  // Trennlinien zwischen den Spalten: links-Mitte und Mitte-rechts
  const trenner = [0, 1].map((i) => { const t = document.createElement("div"); t.className = "fa-trenner"; t.dataset.i = i; document.body.appendChild(t); return t; });
  function trennerSetzen() {
    const [l, m] = spalten().map((x) => x.getBoundingClientRect());
    trenner[0].style.left = `${(l.right + m.left) / 2}px`;
    trenner[1].style.left = `${(m.right + spalten()[2].getBoundingClientRect().left) / 2}px`;
  }
  trenner.forEach((t) => t.addEventListener("pointerdown", (ev) => {
    ev.preventDefault(); t.setPointerCapture(ev.pointerId);
    const cs = getComputedStyle(start), r0 = start.getBoundingClientRect();
    const links0 = r0.left + parseFloat(cs.paddingLeft), breite = r0.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const bewegen = (e) => {
      const st = getComputedStyle(start).gridTemplateColumns.split(" ").map(parseFloat);
      let l = (st[0] / breite) * 100, r = (st[2] / breite) * 100;
      const p = ((e.clientX - links0) / breite) * 100;
      if (t.dataset.i === "0") l = Math.max(15, Math.min(50, p)); else r = Math.max(15, Math.min(50, 100 - p));
      start.style.gridTemplateColumns = `${l.toFixed(1)}% 1fr ${r.toFixed(1)}%`;
      trennerSetzen();
    };
    const ende = () => { t.removeEventListener("pointermove", bewegen); speichern(true); };
    t.addEventListener("pointermove", bewegen);
    t.addEventListener("pointerup", ende, { once: true });
    t.addEventListener("pointercancel", ende, { once: true });
  }));
  window.addEventListener("resize", trennerSetzen);
  // Nach jeder Anwendung der Einstellungen neu markieren; der Ruhezustand bleibt im Editor aus
  PS.on("einstellungen", () => setTimeout(markieren, 50));
  setInterval(() => { document.body.classList.remove("ruhe"); }, 2000);
  // Uhr, Personen und Status schreiben ihren Inhalt laufend neu; die Marken werden dann wieder angebracht
  setInterval(markieren, 1000);
  setTimeout(markieren, 300);
})();
