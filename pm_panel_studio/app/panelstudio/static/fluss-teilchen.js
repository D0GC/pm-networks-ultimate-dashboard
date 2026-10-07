// Lichtteilchen, die entlang der Sankey-Bänder fließen (Canvas über dem SVG).
(function () {
  "use strict";
  const PS = window.PS;
  const LAVENDEL = "#C5C0D3";
  const MAX_ANZAHL = 28;
  const FRAME_MS = 1000 / 40;
  const START_VERZOEGERUNG = 1200;
  const spriteCache = new Map();

  // Farbe (auch var(--x)) in [r,g,b] auflösen
  function farbeAufloesen(farbe) {
    let f = String(farbe || "").trim();
    const m = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(f);
    if (m) {
      let w = "";
      try { w = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim(); } catch (e) {}
      f = w || LAVENDEL;
    }
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = LAVENDEL;
    c.fillStyle = f; // ungültig -> bleibt Lavendel
    const s = c.fillStyle;
    let r;
    if ((r = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s))) {
      return [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)];
    }
    if ((r = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s))) return [+r[1], +r[2], +r[3]];
    return [197, 192, 211];
  }

  // weicher Lichtpunkt: weiß, leicht getönt -> transparent
  function sprite(rgb, px) {
    const key = rgb.join(",") + "/" + px;
    let cv = spriteCache.get(key);
    if (cv) return cv;
    cv = document.createElement("canvas");
    cv.width = cv.height = px;
    const c = cv.getContext("2d");
    const mix = (k) => Math.round(255 * 0.7 + k * 0.3);
    const tint = `${mix(rgb[0])},${mix(rgb[1])},${mix(rgb[2])}`;
    const g = c.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, `rgba(${tint},0.75)`);
    g.addColorStop(1, `rgba(${rgb.join(",")},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, px, px);
    spriteCache.set(key, cv);
    return cv;
  }

  function bezier(a, b, c, d, t) {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  }

  // Live-Aktualisierung: Läuft in der Hülle schon eine Instanz, übernimmt sie die neuen Bänder und behält ihre
  // Teilchen (gleiches Band = gleiche id). Ein Neustart ließe die Teilchen kurz verschwinden und von vorn beginnen.
  PS.flussTeilchen = function (huelle, svg, baender) {
    if (!huelle || !svg) return;
    if (huelle._fluss && huelle._fluss.laeuft()) { huelle._fluss.setzen(svg, baender); return; }
    if (huelle._flussStop) huelle._flussStop();
    huelle.querySelectorAll("canvas.fluss-teilchen").forEach((n) => n.remove());
    if (getComputedStyle(huelle).position === "static") huelle.style.position = "relative";

    const canvas = document.createElement("canvas");
    canvas.className = "fluss-teilchen";
    canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;";
    huelle.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const vb = svg.viewBox && svg.viewBox.baseVal;
    const W = vb && vb.width ? vb.width : 640;

    let dpr = 1, skala = 1, offX = 0, offY = 0, cssW = 0;
    let gestoppt = false, timer = 0, raf = 0, letzter = 0;
    const start = performance.now() + START_VERZOEGERUNG;
    const reduziert = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

    // Teilchen je Band vorbereiten; vorhandene Teilchen eines Bandes (gleiche id) laufen weiter
    let liste = [];
    function baenderSetzen(neu) {
      const alt = new Map(liste.map((e) => [e.b.id, e]));
      liste = (neu || []).map((b, j) => {
        const rgb = farbeAufloesen(b.farbe);
        const n = Math.max(0, Math.round((b.anteil || 0) * MAX_ANZAHL));
        const basis = 0.18 + (b.anteil || 0) * 0.1; // Bandlängen pro Sekunde
        const vorher = b.id != null ? alt.get(b.id) : null;
        const teile = vorher ? vorher.teile.slice(0, n) : [];
        for (const p of teile) p.tempo = basis * p.faktor;
        for (let i = teile.length; i < n; i++) {
          const faktor = 0.8 + Math.random() * 0.4;
          // neue Teilchen beginnen am Bandanfang verteilt, beim ersten Aufbau über das ganze Band
          teile.push({ t: vorher ? Math.random() * 0.15 : (i + Math.random()) / n, v: 0.2 + Math.random() * 0.6, faktor, tempo: basis * faktor, r: 2.5 + Math.random() * 1.5 });
        }
        return { b: { ...b, id: b.id != null ? b.id : `#${j}` }, rgb, teile };
      }).filter((e) => e.teile.length);
    }
    baenderSetzen(baender);

    function groesse() {
      if (!svg.isConnected) return;
      const r = svg.getBoundingClientRect();
      const huellenR = huelle.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      cssW = r.width;
      skala = r.width / W;
      offX = r.left - huellenR.left;
      offY = r.top - huellenR.top;
      canvas.style.left = offX + "px";
      canvas.style.top = offY + "px";
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    }
    groesse();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(groesse) : null;
    if (ro) ro.observe(huelle);

    function beenden() {
      gestoppt = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (huelle._flussStop === beenden) { huelle._flussStop = null; huelle._fluss = null; }
    }
    huelle._flussStop = beenden;
    huelle._fluss = {
      laeuft: () => !gestoppt && canvas.isConnected && huelle.contains(canvas),
      // neues SVG (gleiche viewBox) und neue Bänder; Teilchen und Canvas bleiben
      setzen(neuSvg, neu) { svg = neuSvg; baenderSetzen(neu); groesse(); },
    };

    function pausiert() {
      const k = document.body.classList;
      return document.hidden || k.contains("ruhe") || k.contains("ohne-animation") ||
        (reduziert && reduziert.matches);
    }

    function leeren() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

    function zeichne(dt) {
      leeren();
      const px = Math.max(8, Math.round(16 * dpr));
      const f = skala * dpr; // SVG-Einheiten -> Canvas-Pixel
      for (const e of liste) {
        const b = e.b;
        const xm = (b.x0 + b.x1) / 2;
        const dMax = Math.max(1, b.h * skala); // Bandhöhe in CSS-px
        const spr = sprite(e.rgb, px);
        for (const p of e.teile) {
          p.t += p.tempo * dt;
          if (p.t >= 1) { p.t -= 1; p.v = 0.2 + Math.random() * 0.6; }
          const t = p.t;
          const x = bezier(b.x0, xm, xm, b.x1, t);
          const y = bezier(b.y0, b.y0, b.y1, b.y1, t) + p.v * b.h;
          // Einblenden/Ausblenden am Bandanfang und -ende
          const a = Math.min(1, t / 0.12, (1 - t) / 0.12);
          // bei dünnen Bändern kleiner
          const r = Math.min(p.r, dMax * 0.4) * dpr;
          if (r < 0.6 || a <= 0) continue;
          ctx.globalAlpha = a * 0.9;
          ctx.drawImage(spr, x * f - r, y * f - r, r * 2, r * 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    function schritt(jetzt) {
      if (gestoppt) return;
      if (!canvas.isConnected) { beenden(); return; }
      if (pausiert() || jetzt < start) {
        leeren();
        letzter = 0;
        timer = setTimeout(() => { raf = requestAnimationFrame(schritt); }, pausiert() ? 500 : 100);
        return;
      }
      if (!letzter) letzter = jetzt;
      const dtMs = jetzt - letzter;
      if (dtMs >= FRAME_MS - 2) {
        letzter = jetzt;
        zeichne(Math.min(dtMs, 100) / 1000);
      }
      raf = requestAnimationFrame(schritt);
    }
    raf = requestAnimationFrame(schritt);
  };
})();
