/* PM Panel Studio – Live-Aktivität: laufende Timer als Kapsel in einer Ecke, nur auf Unterseiten (Konzept Stufe 4) */
(function () {
  "use strict";
  const MAX = 3;
  const FARBE = { kohle: "#ff9a5c", dusche: "var(--info)", spa: "var(--akzent)", waesche: "var(--info)", spueler: "var(--info)", terminuhr: "#c99bf0", rams: "#ffd100" };
  const NAME = { kohle: "Kohle", dusche: "Duschmodus", spa: "Spa", waesche: "Waschmaschine", spueler: "Spülmaschine", terminuhr: "Termin" };
  const SEK = ["kohle", "dusche", "spa", "terminuhr"];
  const $ = (s) => document.querySelector(s);
  let box = null, kapsel = null, gross = false, grossFrist = null, ids = [];
  const zeilen = new Map();

  // Laufende Timer: Feed-Liste von start.js (PS.feedListe, falls exportiert), sonst die Backend-Karten
  function timer() {
    const quelle = PS.feedListe || PS.karten || [];
    const jetzt = Date.now(), aus = [];
    for (const k of quelle) {
      if (k.schluessel === "musik" || k.schluessel === "robo") continue;
      if (k.ende) {
        const rest = (new Date(k.ende).getTime() - jetzt) / 1000;
        if (rest > 0) aus.push({ k, rest });
      } else if (k.schluessel === "rams") { if (k.zustand === "IN") aus.push({ k, rest: null }); }  // Spielstand nur, solange das Spiel läuft
      else if ((k.schluessel === "waesche" || k.schluessel === "spueler") && k.art === "aktivitaet") aus.push({ k, rest: null });
    }
    return aus;
  }
  const name = (k) => (k.schluessel === "rams" ? k.titel : NAME[k.schluessel]) || (k.modell && k.modell.h2) || k.titel || "Timer";
  const zusatz = (k, rest) => {
    if (k.schluessel === "rams") return k.hinweis;
    if (k.schluessel === "terminuhr") return (k.modell && k.modell.h2) || "Als Nächstes";
    const fertig = rest != null ? `fertig gegen ${PS.uhrzeit(new Date(Date.now() + rest * 1000))}` : "";
    return [k.titel && k.titel !== name(k) ? k.titel : "", k.hinweis, fertig].filter(Boolean).join(" · ");
  };
  function zeit(k, rest) {
    if (rest == null) return String(k.wert || "");
    const g = Math.ceil(rest), z2 = (n) => String(n).padStart(2, "0");
    if (SEK.includes(k.schluessel)) return g >= 3600 ? `${Math.floor(g / 3600)}:${z2(Math.floor(g % 3600 / 60))}:${z2(g % 60)}` : `${Math.floor(g / 60)}:${z2(g % 60)}`;
    const min = Math.ceil(g / 60);
    return min >= 60 ? `${Math.floor(min / 60)}:${z2(min % 60)} h` : `${min} min`;
  }
  const anteil = (k, rest) => (rest != null && k.dauer_s ? rest / k.dauer_s : k.ring != null ? k.ring : 1);
  function seite(k) {
    if (k.schluessel === "kohle") PS.oeffnen("shisha"); else if (k.schluessel === "rams") PS.sportZeigen(k); else PS.schliessen();
  }
  function aufbauen() {
    box = document.createElement("div");
    box.id = "live"; box.className = "live"; box.setAttribute("aria-hidden", "true");
    kapsel = document.createElement("div"); kapsel.className = "live-kapsel";
    box.appendChild(kapsel); document.body.appendChild(box);
    eckeSetzen(gemerkteEcke());
    verschiebbar();
    kapsel.addEventListener("click", (ev) => {
      if (gezogen) { gezogen = false; ev.stopPropagation(); return; }
      const z = ev.target.closest(".live-zeile");
      if (!gross) { grossSetzen(true); return; }
      if (ev.target.closest(".live-zu")) { grossSetzen(false); return; }
      const e = z && zeilen.get(z.dataset.id);
      if (e) { grossSetzen(false); seite(e.k); }
    });
    document.addEventListener("pointerdown", (ev) => { if (gross && !box.contains(ev.target)) grossSetzen(false); });
  }
  // Verschieben wie ein Bild-in-Bild-Fenster: Die Kapsel hängt am Finger, hebt sich an und neigt sich mit dem Tempo.
  // Beim Loslassen schwebt sie mit einer Feder in die nächste Ecke (Wurf-Richtung zählt mit) und merkt sich diese.
  const ECKEN = ["ur", "ul", "or", "ol"];
  let gezogen = false;
  function gemerkteEcke() { try { const e = localStorage.getItem("ps-live-ecke"); return ECKEN.includes(e) ? e : "ur"; } catch { return "ur"; } }
  function eckeSetzen(e) {
    ECKEN.forEach((x) => box.classList.toggle("ecke-" + x, x === e));
    try { localStorage.setItem("ps-live-ecke", e); } catch { /* optional */ }
  }
  function verschiebbar() {
    let start = null, letzt = null, vx = 0, vy = 0;
    kapsel.addEventListener("pointerdown", (ev) => {
      start = { x: ev.clientX, y: ev.clientY, t: performance.now() }; letzt = { ...start }; vx = vy = 0; gezogen = false;
    });
    window.addEventListener("pointermove", (ev) => {
      if (!start) return;
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!gezogen && Math.hypot(dx, dy) < 10) return;
      if (!gezogen) { gezogen = true; kapsel.setPointerCapture?.(ev.pointerId); box.classList.add("zieht"); if (gross) grossSetzen(false); }
      const jetzt = performance.now(), dt = Math.max(1, jetzt - letzt.t);
      vx = vx * 0.6 + ((ev.clientX - letzt.x) / dt) * 0.4; vy = vy * 0.6 + ((ev.clientY - letzt.y) / dt) * 0.4;
      letzt = { x: ev.clientX, y: ev.clientY, t: jetzt };
      const neigung = Math.max(-8, Math.min(8, vx * 6));
      kapsel.style.transform = `translate(${dx}px,${dy}px) rotate(${neigung}deg) scale(1.06)`;
      PS.emit("beruehrt");
    });
    const los = () => {
      if (!start) return;
      start = null;
      if (!gezogen) return;
      box.classList.remove("zieht");
      // Ziel: Mitte nach dem „Wurf“ (aktuelle Lage + Tempo · 180 ms)
      const r = kapsel.getBoundingClientRect();
      const mx = r.left + r.width / 2 + vx * 180, my = r.top + r.height / 2 + vy * 180;
      const ziel = (my < innerHeight / 2 ? "o" : "u") + (mx < innerWidth / 2 ? "l" : "r");
      // FLIP: Ecke wechseln, die Kapsel von ihrer jetzigen Lage dorthin federn lassen
      const vorher = r;
      kapsel.style.transition = "none"; kapsel.style.transform = "";
      eckeSetzen(ziel);
      const nachher = kapsel.getBoundingClientRect();
      kapsel.style.transform = `translate(${vorher.left - nachher.left}px,${vorher.top - nachher.top}px) scale(1.06)`;
      void kapsel.offsetWidth;
      kapsel.style.transition = "";
      kapsel.style.transform = "";
      setTimeout(() => { gezogen = false; }, 0);
    };
    window.addEventListener("pointerup", los); window.addEventListener("pointercancel", los);
  }
  function grossSetzen(an) {
    gross = an; clearTimeout(grossFrist);
    box.classList.toggle("weit", an);
    if (an) grossFrist = setTimeout(() => grossSetzen(false), 10000);
    PS.emit("beruehrt");
  }
  // Sitz: Ecke unten rechts (per CSS); --live-oben bleibt für ältere Regeln gesetzt
  function sitz() {
    const kopf = $(".sheet-kopf"); if (!kopf) return;
    const sh = kopf.offsetParent || $(".sheet");  // offsetTop ignoriert die Einfahr-Verschiebung des Sheets
    box.style.setProperty("--live-oben", `${Math.round((sh ? sh.offsetTop : 0) + kopf.offsetTop + kopf.offsetHeight)}px`);
  }
  function zeichnen(neu) {
    const sichtbar = document.body.classList.contains("offen");
    const liste = timer();
    const zeigen = sichtbar && liste.length > 0;
    if (!box) { if (!zeigen) return; aufbauen(); }
    sitz();
    box.classList.toggle("sichtbar", zeigen);
    box.setAttribute("aria-hidden", zeigen ? "false" : "true");
    if (!zeigen) { if (gross) grossSetzen(false); return; }
    const teil = liste.slice(0, MAX), rest = liste.length - teil.length;
    const neueIds = teil.map((t) => t.k.id).join("|") + "|" + rest;
    if (neueIds !== ids.join("|") || neu) {
      // Zeilen angleichen: vorhandene behalten (Ring gleitet weiter), neue anlegen, übrige entfernen
      const behalten = new Set(teil.map((t) => t.k.id));
      for (const [id, z] of zeilen) if (!behalten.has(id)) { z.el.remove(); zeilen.delete(id); }
      teil.forEach((t) => {
        if (zeilen.has(t.k.id)) return;
        const el = document.createElement("div"); el.className = "live-zeile"; el.dataset.id = t.k.id;
        el.style.setProperty("--farbe", FARBE[t.k.schluessel] || "var(--lavender)");
        el.innerHTML = `<div class="ring laeuft">${PS.ringSVG(anteil(t.k, t.rest))}</div><div class="live-text"><b class="live-name"></b><small class="live-zusatz"></small></div><span class="live-zeit tabular"></span><button class="live-zu" aria-label="Zuklappen">${PS.ic("chevron-up")}</button><span class="live-auf" aria-hidden="true">${PS.ic("chevron-right")}</span>`;
        zeilen.set(t.k.id, { el, k: t.k });
      });
      teil.forEach((t) => kapsel.appendChild(zeilen.get(t.k.id).el));
      let mehr = kapsel.querySelector(".live-mehr");
      if (!mehr) { mehr = document.createElement("div"); mehr.className = "live-mehr"; }
      kapsel.appendChild(mehr);
      ids = neueIds.split("|");
    }
    // Zugeklappt nur der erste Timer, daneben die Zahl der übrigen; erweitert bis zu MAX Zeilen
    const mehrEl = kapsel.querySelector(".live-mehr"), uebrig = gross ? rest : liste.length - 1;
    if (mehrEl) { mehrEl.textContent = `+${uebrig}`; mehrEl.hidden = uebrig <= 0; }
    for (const t of teil) {
      const z = zeilen.get(t.k.id); z.k = t.k;
      const n = z.el.querySelector(".live-name"); if (n.textContent !== name(t.k)) n.textContent = name(t.k);
      const zs = z.el.querySelector(".live-zusatz"), zt = zusatz(t.k, t.rest); if (zs.textContent !== zt) zs.textContent = zt;
      const ze = z.el.querySelector(".live-zeit");
      if (t.rest == null) { if (ze.textContent !== zeit(t.k, null)) ze.textContent = zeit(t.k, null); }  // Gerät ohne Sekunden: kein Rollen
      else PS.walze(ze, zeit(t.k, t.rest));
      PS.ringSetzen(z.el.querySelector(".ring svg"), anteil(t.k, t.rest));
    }
  }
  const neuZeichnen = () => zeichnen(false);
  PS.on("karten", () => zeichnen(true));
  PS.on("seite", () => setTimeout(neuZeichnen, 30));
  new MutationObserver(() => { zeichnen(false); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", () => { if (box) sitz(); });
  setInterval(neuZeichnen, 1000);
})();
