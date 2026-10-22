/* PM Panel Studio – Alarmanlage: aktiver Modus mit animiertem Symbol, Moduswahl daneben und Codetafel als Pop-up.
   Scharf schalten per Tippen (verlangt die Anlage dafür einen Code, öffnet sich die Codetafel), unscharf nur per
   Halten, dann Codetafel. Ziffern erscheinen kurz und werden zu Punkten; ein falscher Code schüttelt die Felder, der
   richtige zeichnet einen Haken, die Tafel verschwindet und der Modus wechselt. Ersetzt PS.alarmSteuerung (dialog.js). */
(function () {
  "use strict";
  const PS = window.PS;
  const E = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // ------------------------------------------------------------ Symbole je Zustand
  const SCHILD = "M90 22 L142 40 V86 C142 120 120 146 90 158 C60 146 38 120 38 86 V40 Z";
  let nr = 0;
  const SYM = {
    unscharf: (f) => `<g class="al-atmen"><path d="${SCHILD}" fill="rgba(197,192,211,.07)" stroke="${f}" stroke-width="3"/>
      <rect x="70" y="86" width="40" height="32" rx="6" fill="none" stroke="${f}" stroke-width="3"/>
      <path class="al-buegel" d="M78 86 V74 a12 12 0 0 1 24 0" fill="none" stroke="${f}" stroke-width="3" stroke-linecap="round"/></g>`,
    zuhause: (f) => `<circle class="al-welle" cx="90" cy="90" r="80" stroke="${f}"/><circle class="al-welle b" cx="90" cy="90" r="80" stroke="${f}"/>
      <path d="${SCHILD}" fill="rgba(95,211,160,.14)" stroke="${f}" stroke-width="3"/>
      <path class="al-einrasten" d="M66 98 L90 78 L114 98 V120 H66 Z M84 120 V106 H96 V120" fill="none" stroke="${f}" stroke-width="3" stroke-linejoin="round"/>`,
    abwesend: (f) => { const id = `al-strahl${++nr}`; return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${f}" stop-opacity="0"/><stop offset="1" stop-color="${f}" stop-opacity=".55"/></linearGradient></defs>
      <circle cx="90" cy="90" r="82" fill="none" stroke="${f}" stroke-opacity=".18" stroke-width="1.5"/>
      <g class="al-radar"><path d="M90 90 L172 90 A82 82 0 0 0 148 32 Z" fill="url(#${id})"/></g>
      <path d="${SCHILD}" fill="rgba(143,180,255,.12)" stroke="${f}" stroke-width="3"/>
      <g class="al-einrasten"><rect x="70" y="88" width="40" height="32" rx="6" fill="none" stroke="${f}" stroke-width="3"/>
      <path d="M78 88 V76 a12 12 0 0 1 24 0 V88" fill="none" stroke="${f}" stroke-width="3"/></g>`; },
    nacht: (f) => `<path d="${SCHILD}" fill="rgba(176,127,208,.13)" stroke="${f}" stroke-width="3"/>
      <path class="al-atmen" d="M104 74 A26 26 0 1 0 108 112 A20 20 0 1 1 104 74 Z" fill="rgba(176,127,208,.35)" stroke="${f}" stroke-width="2.5"/>
      <circle class="al-stern" cx="66" cy="72" r="3" fill="#ECEBF2"/><circle class="al-stern" cx="116" cy="62" r="2.5" fill="#ECEBF2"/><circle class="al-stern" cx="74" cy="122" r="2" fill="#ECEBF2"/>`,
    wird: (f, rest, gesamt) => {
      const U = 2 * Math.PI * 80, anteil = gesamt ? Math.max(0, Math.min(1, rest / gesamt)) : null;
      return `<circle cx="90" cy="90" r="80" fill="none" stroke="${f}" stroke-opacity=".15" stroke-width="6"/>
        <circle class="al-countdown${anteil == null ? " al-kreisen" : ""}" cx="90" cy="90" r="80" fill="none" stroke="${f}" stroke-width="6" stroke-linecap="round"
          stroke-dasharray="${U.toFixed(1)}" stroke-dashoffset="${(U * (1 - (anteil ?? 0.3))).toFixed(1)}"/>
        ${rest != null ? `<text class="al-zahl" x="90" y="106" text-anchor="middle" font-size="48" font-weight="600" fill="${f}">${Math.max(0, Math.ceil(rest))}</text>` : `<path d="${SCHILD}" transform="translate(45 45) scale(.5)" fill="none" stroke="${f}" stroke-width="5"/>`}`;
    },
    ausgeloest: (f) => `<circle class="al-welle schnell" cx="90" cy="90" r="80" stroke="${f}"/><circle class="al-welle schnell b" cx="90" cy="90" r="80" stroke="${f}"/>
      <g class="al-zittern"><path d="${SCHILD}" fill="rgba(239,106,122,.2)" stroke="${f}" stroke-width="3"/>
      <g class="al-blinken"><path d="M90 70 V102" stroke="${f}" stroke-width="7" stroke-linecap="round"/><circle cx="90" cy="120" r="4.5" fill="${f}"/></g></g>`,
    unbekannt: (f) => `<path d="${SCHILD}" fill="none" stroke="${f}" stroke-width="3" stroke-dasharray="6 6"/><text x="90" y="104" text-anchor="middle" font-size="40" fill="${f}">?</text>`,
  };
  // HA-Zustand → Darstellung
  const ZUSTAND = {
    disarmed: ["unscharf", "Unscharf", "Niemand überwacht, alles frei", "var(--lavender)"],
    armed_home: ["zuhause", "Scharf · Zuhause", "Türen und Fenster gesichert", "var(--gut)"],
    armed_away: ["abwesend", "Scharf · Abwesend", "Alle Melder aktiv", "var(--info)"],
    armed_night: ["nacht", "Scharf · Nacht", "Nachtbetrieb gesichert", "var(--akzent)"],
    armed_vacation: ["abwesend", "Scharf · Urlaub", "Alle Melder aktiv", "var(--info)"],
    armed_custom_bypass: ["zuhause", "Scharf · Eigene", "Ausgewählte Melder aktiv", "var(--gut)"],
    arming: ["wird", "Wird scharf", "", "var(--warn)"],
    pending: ["wird", "Verzögerung", "Code eingeben, sonst Alarm", "var(--warn)"],
    disarming: ["wird", "Wird unscharf", "", "var(--lavender)"],
    triggered: ["ausgeloest", "Alarm ausgelöst", "", "var(--krit)"],
  };
  const zustand = (eid) => ZUSTAND[PS.s(eid)] || ["unbekannt", PS.text(eid), "", "var(--leise)"];
  PS.alarmSymbol = (art, farbe, rest, gesamt) => `<svg viewBox="0 0 180 180" aria-hidden="true" class="al-svg">${SYM[art](farbe, rest, gesamt)}</svg>`;
  // Restzeit bei Vorlauf und Verzögerung (Alarmo: Attribut „delay“ in Sekunden ab dem Zustandswechsel)
  const restzeit = (eid) => {
    const d = Number(PS.a(eid).delay), t = Date.parse(PS.st(eid).lc);
    return d > 0 && t ? { rest: d - (Date.now() - t) / 1000, gesamt: d } : { rest: null, gesamt: null };
  };

  // ------------------------------------------------------------ Modi
  const MODI = [  // Dienst, Bit in supported_features, Darstellung
    ["armed_home", "alarm_arm_home", 1, "zuhause", "Zuhause", "Außenhaut gesichert"],
    ["armed_away", "alarm_arm_away", 2, "abwesend", "Abwesend", "alle Melder"],
    ["armed_night", "alarm_arm_night", 4, "nacht", "Nacht", "Nachtbetrieb"],
    ["armed_vacation", "alarm_arm_vacation", 32, "abwesend", "Urlaub", "alle Melder"],
  ];
  const FARBE = { zuhause: "var(--gut)", abwesend: "var(--info)", nacht: "var(--akzent)", unscharf: "var(--lavender)" };
  const ICON = { zuhause: "shield-home", abwesend: "shield-lock", nacht: "shield-moon", unscharf: "shield-off-outline" };

  // ------------------------------------------------------------ Codetafel (Pop-up mitten im Bild)
  // Wie die iPhone-Sperre: sechs Punkte füllen sich, beim letzten wird automatisch geprüft. Falsch schüttelt die Punkte,
  // richtig färbt sie nacheinander grün, zeichnet einen Haken und schließt die Tafel.
  // Optionen: klasse (z. B. „ct-alarm“), fest (Hintergrund schließt nicht), abbrechen (Text), beimSchliessen.
  const STELLEN = 6;
  let tafel = null;
  PS.codeTafel = ({ titel, unter = "Code eingeben", symbol = "", pruefen, stellen = STELLEN, klasse = "", fest = false, abbrechen = "Abbrechen", beimSchliessen = null }) => {
    if (tafel) tafel.schliessen(true);
    const g = E(`<div class="ct-grund ${klasse}" role="dialog" aria-modal="true" aria-label="${PS.esc(titel)}"><div class="ct-tafel">
      <div class="ct-kopf"><div class="ct-symbol">${symbol}</div><b>${PS.esc(titel)}</b><small class="ct-unter">${PS.esc(unter)}</small></div>
      <div class="ct-punkte" aria-live="polite">${Array.from({ length: stellen }, (_, i) => `<i style="--k:${i}"></i>`).join("")}</div>
      <div class="ct-haken"><svg viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="24"/><path d="M16 28 l7 7 l15 -15"/></svg></div>
      <div class="ct-meldung">&nbsp;</div>
      <div class="ct-tasten"></div>
      <button type="button" class="ct-abbrechen">${PS.esc(abbrechen)}</button></div></div>`);
    const punkte = g.querySelector(".ct-punkte"), meldung = g.querySelector(".ct-meldung"), tasten = g.querySelector(".ct-tasten");
    let code = "", sperre = false;
    const zeigen = (neu) => {
      [...punkte.children].forEach((p, i) => {
        p.classList.toggle("voll", i < code.length);
        if (i === neu) { p.classList.remove("neu"); void p.offsetWidth; p.classList.add("neu"); }
      });
    };
    const melden = (text, art = "") => { meldung.textContent = text || " "; meldung.className = `ct-meldung ${art}`; };
    const bestaetigen = async () => {
      if (sperre || !code) return;
      sperre = true; g.classList.add("prueft"); melden("Wird geprüft …");
      let ok = false, text = "";
      try { const r = await pruefen(code); ok = r === true; text = typeof r === "string" ? r : ""; } catch (e) { text = e && e.message ? e.message : ""; }
      g.classList.remove("prueft");
      if (ok) {
        punkte.classList.add("ok"); g.classList.add("geschafft"); melden("Code richtig", "ok");
        setTimeout(() => schliessen(), 1100);
      } else {
        punkte.classList.add("fehler"); melden(text || "Falscher Code", "fehler");
        if (navigator.vibrate) try { navigator.vibrate(120); } catch { /* ohne */ }
        setTimeout(() => { punkte.classList.remove("fehler"); code = ""; zeigen(-1); sperre = false; }, 750);
      }
    };
    const ziffer = (z) => {
      if (sperre || code.length >= stellen) return;
      code += z; zeigen(code.length - 1); melden("");
      if (code.length === stellen) setTimeout(bestaetigen, 180);  // letzter Punkt sichtbar, dann prüfen
    };
    const loeschen = () => { if (sperre) return; code = code.slice(0, -1); zeigen(-1); };
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].forEach((z) => {
      if (!z) { tasten.appendChild(E('<span aria-hidden="true"></span>')); return; }
      const b = E(`<button type="button" class="ct-taste${z === "⌫" ? " leise" : ""}" aria-label="${z === "⌫" ? "Löschen" : `Ziffer ${z}`}">${z === "⌫" ? PS.ic("backspace-outline") : z}</button>`);
      b.addEventListener("pointerdown", (e) => {
        const r = b.getBoundingClientRect(), w = document.createElement("span");
        w.className = "ct-riffel"; w.style.left = `${e.clientX - r.left - 5}px`; w.style.top = `${e.clientY - r.top - 5}px`;
        b.appendChild(w); setTimeout(() => w.remove(), 520);
      });
      b.addEventListener("click", () => (z === "⌫" ? loeschen() : ziffer(z)));
      tasten.appendChild(b);
    });
    const taste = (e) => {
      if (/^[0-9]$/.test(e.key)) ziffer(e.key);
      else if (e.key === "Backspace") loeschen();
      else if (e.key === "Enter") bestaetigen();
      else if (e.key === "Escape") schliessen();
      else return;
      e.preventDefault();
    };
    let zu = false;
    function schliessen(sofort) {
      if (zu) return;
      zu = true;
      document.removeEventListener("keydown", taste, true);
      if (tafel && tafel.g === g) tafel = null;
      if (beimSchliessen) try { beimSchliessen(g.classList.contains("geschafft")); } catch { /* egal */ }
      if (sofort) { g.remove(); return; }
      g.classList.add("schliesst");
      setTimeout(() => g.remove(), 340);
    }
    g.querySelector(".ct-abbrechen").addEventListener("click", () => schliessen());
    if (!fest) g.addEventListener("click", (e) => { if (e.target === g) schliessen(); });
    document.addEventListener("keydown", taste, true);
    document.body.appendChild(g);
    requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add("offen")));
    tafel = {
      g, schliessen,
      symbol: (html) => { g.querySelector(".ct-symbol").innerHTML = html; },
      unter: (text) => { g.querySelector(".ct-unter").textContent = text; },
      laeuft: () => !sperre && !g.classList.contains("geschafft"),
    };
    return tafel;
  };

  // Dienst mit Code ausführen und warten, bis die Anlage reagiert (sonst gilt der Code als abgelehnt)
  const ausfuehren = (eid, dienst, code, ziel) => new Promise((fertig) => {
    let erledigt = false;
    const ende = (wert) => { if (erledigt) return; erledigt = true; PS.off("diff", beobachter); clearTimeout(frist); fertig(wert); };
    const beobachter = (ids) => { if (ids.has(eid) && ziel(PS.s(eid))) ende(true); };
    PS.on("diff", beobachter);
    const frist = setTimeout(() => ende("Code nicht angenommen"), 5000);
    PS.anfrage({ typ: "dienst", domain: "alarm_control_panel", service: dienst, data: { entity_id: eid, ...(code ? { code } : {}) } })
      .then(() => { if (ziel(PS.s(eid))) ende(true); })
      .catch((e) => ende(/code/i.test(e && e.message) ? "Falscher Code" : (e && e.message) || "Abgelehnt"));
  });

  // ------------------------------------------------------------ Steuerung
  PS.alarmSteuerung = (eid) => {
    const el = E(`<div class="gross alarm2" data-alarm="${PS.esc(eid)}">
      <div class="al-zustand"><div class="al-symbol"></div><div class="al-text"><b class="al-name"></b><small class="al-unter"></small><small class="al-seit"></small></div></div>
      <div class="al-modi"></div></div>`);
    const modi = el.querySelector(".al-modi");
    const a = () => PS.a(eid);
    const brauchtCode = () => !!a().code_format;
    const symbolSetzen = (z) => {
      const [art, , , farbe] = z, { rest, gesamt } = restzeit(eid);
      el.querySelector(".al-symbol").innerHTML = PS.alarmSymbol(art, farbe, rest, gesamt);
    };
    let alt = null, takt = null;
    el.aktualisieren = () => {
      const s = PS.s(eid), z = zustand(eid);
      el.style.setProperty("--al-farbe", z[3]);
      el.dataset.zustand = z[0];
      const wechsel = alt !== null && alt !== s;
      symbolSetzen(z);
      el.querySelector(".al-name").textContent = z[1];
      const { rest } = restzeit(eid);
      el.querySelector(".al-unter").textContent = z[0] === "wird" && rest != null ? `noch ${Math.max(0, Math.ceil(rest))} s${a().next_state ? ` · ${(ZUSTAND[a().next_state] || [])[1] || ""}` : ""}` : z[2];
      el.querySelector(".al-seit").textContent = PS.st(eid).lc ? `seit ${PS.uhrzeit(new Date(PS.st(eid).lc))}${a().changed_by ? ` · ${a().changed_by}` : ""}` : "";
      if (wechsel) ["al-symbol", "al-name"].forEach((k) => { const x = el.querySelector("." + k); x.classList.remove("al-wechsel"); void x.offsetWidth; x.classList.add("al-wechsel"); });
      alt = s;
      modiZeigen();
      clearInterval(takt);
      if (z[0] === "wird") takt = setInterval(() => { if (!el.isConnected) { clearInterval(takt); return; } symbolSetzen(zustand(eid)); const r = restzeit(eid).rest; if (r != null) el.querySelector(".al-unter").textContent = `noch ${Math.max(0, Math.ceil(r))} s`; }, 1000);
    };
    function modiZeigen() {
      const s = PS.s(eid), f = Number(a().supported_features || 15);
      const verfuegbar = MODI.filter((m) => f & m[2]);
      modi.innerHTML = "";
      const knopfBau = (art, titel, unter, aktiv, halten) => {
        const b = E(`<button type="button" class="al-modus${aktiv ? " aktiv" : ""}" style="--c:${FARBE[art]}">${PS.ic(ICON[art])}<span><b>${PS.esc(titel)}</b><small>${PS.esc(unter)}</small></span>${aktiv ? '<i class="al-marke">aktiv</i>' : ""}</button>`);
        if (halten) b.classList.add("al-halten");
        modi.appendChild(b);
        return b;
      };
      verfuegbar.forEach(([zst, dienst, , art, titel, unter]) => {
        const aktiv = s === zst || (s === "arming" && a().next_state === zst);
        const b = knopfBau(art, titel, unter, aktiv);
        b.addEventListener("click", () => {
          if (aktiv) return;
          const ziel = (n) => ["arming", "pending", zst].includes(n);
          if (brauchtCode() && a().code_arm_required !== false) {
            PS.codeTafel({ titel: `Scharf · ${titel}`, symbol: PS.alarmSymbol(art, FARBE[art]), pruefen: (code) => ausfuehren(eid, dienst, code, ziel) });
          } else ausfuehren(eid, dienst, "", ziel).then((r) => { if (r !== true) PS.toast(r, true); });
        });
      });
      const unscharf = s === "disarmed";
      const b = knopfBau("unscharf", "Unscharf", unscharf ? "Anlage ist aus" : "halten, dann Code", unscharf, !unscharf);
      if (!unscharf) {
        PS.halten(b, 900, () => {
          const ziel = (n) => n === "disarmed";
          if (brauchtCode()) PS.codeTafel({ titel: "Unscharf schalten", symbol: PS.alarmSymbol(zustand(eid)[0], zustand(eid)[3]), pruefen: (code) => ausfuehren(eid, "alarm_disarm", code, ziel) });
          else ausfuehren(eid, "alarm_disarm", "", ziel).then((r) => { if (r !== true) PS.toast(r, true); });
        });
      }
    }
    el.codeAktiv = () => !!tafel;
    el.aktualisieren();
    return el;
  };
  // ------------------------------------------------------------ Meldung am Panel: Eingangsverzögerung und Alarm
  // Steht die Anlage in der Eingangsverzögerung (pending), weckt das Panel und zeigt mittig die Codetafel mit
  // ablaufendem Countdown; bei Auslösung (triggered) dieselbe Tafel rot mit pulsierendem Symbol. Richtiger Code
  // schaltet unscharf. „Ausblenden“ gilt bis zum nächsten Zustandswechsel. Nur an den Panels, nicht in der Admin-Ansicht.
  const alarmEid = () => (PS.opt.alarm_entitaet && PS.z[PS.opt.alarm_entitaet] ? PS.opt.alarm_entitaet : Object.keys(PS.z).find((e) => e.startsWith("alarm_control_panel.") && PS.sichtbar(e)));
  const MELDEN = { pending: ["Eingangsverzögerung", "ct-warn"], triggered: ["Alarm ausgelöst", "ct-alarm"] };
  let melder = null, meldeZustand = null, ausgeblendet = null, meldeTakt = null;
  const meldeUnter = (eid) => {
    if (PS.s(eid) === "triggered") return `${PS.a(eid).changed_by ? `durch ${PS.a(eid).changed_by} · ` : ""}Code eingeben zum Unscharfschalten`;
    const r = restzeit(eid).rest;
    return r != null ? `noch ${Math.max(0, Math.ceil(r))} s · Code eingeben, sonst Alarm` : "Code eingeben, sonst Alarm";
  };
  const meldeSymbol = (eid) => { const [art, , , farbe] = zustand(eid), { rest, gesamt } = restzeit(eid); return PS.alarmSymbol(art, farbe, rest, gesamt); };
  function meldungPruefen() {
    if (document.body.classList.contains("admin")) return;
    const eid = alarmEid(); if (!eid) return;
    const s = PS.s(eid);
    if (s !== meldeZustand) { ausgeblendet = null; }
    const war = meldeZustand; meldeZustand = s;
    if (!MELDEN[s]) {
      clearInterval(meldeTakt); meldeTakt = null;
      if (melder && melder.laeuft()) melder.schliessen();
      melder = null;
      return;
    }
    if (ausgeblendet === s) return;
    if (melder && war === s) return;  // läuft schon
    if (melder) { const alt = melder; melder = null; alt.schliessen(true); }
    document.body.classList.remove("ruhe");
    try { window.dispatchEvent(new Event("pointerdown")); } catch { /* weckt das Panel */ }
    const [titel, klasse] = MELDEN[s];
    const t = PS.codeTafel({ titel, unter: meldeUnter(eid), symbol: meldeSymbol(eid), klasse: `ct-melder ${klasse}`, fest: true, abbrechen: "Ausblenden",
      pruefen: (code) => ausfuehren(eid, "alarm_disarm", code, (n) => n === "disarmed"),
      beimSchliessen: (geschafft) => { if (melder === t) { melder = null; if (!geschafft) ausgeblendet = s; } clearInterval(meldeTakt); meldeTakt = null; } });
    melder = t;
    clearInterval(meldeTakt);
    meldeTakt = setInterval(() => { if (melder !== t) return; t.unter(meldeUnter(eid)); if (PS.s(eid) === "pending") t.symbol(meldeSymbol(eid)); }, 1000);
  }
  PS.on("diff", (ids) => { const e = alarmEid(); if (e && ids.has(e)) meldungPruefen(); });
  PS.on("init", meldungPruefen);

  // ------------------------------------------------------------ Feed-Karten der Startseite: Alarmanlage und Haustür
  // Gleiche Symbole und Bewegungen wie auf der Sicherheitsseite. start.js holt die Karten über PS.sicherheitKarten()
  // und baut den Feed bei jeder Änderung über PS.feedNeu() neu auf.
  const TUER = {
    klingelt: (f) => `<g class="ts-schall"><path d="M38 58 Q24 82 38 106" /><path d="M142 58 Q156 82 142 106" />
      <path class="b" d="M24 46 Q4 82 24 118" /><path class="b" d="M156 46 Q176 82 156 118" /></g>
      <g class="ts-glocke"><circle cx="90" cy="38" r="6" fill="${f}"/>
      <path d="M90 42 C69 42 58 58 58 80 V104 L47 120 H133 L122 104 V80 C122 58 111 42 90 42 Z" fill="color-mix(in srgb,${f} 18%,transparent)" stroke="${f}" stroke-width="4" stroke-linejoin="round"/>
      <circle class="ts-kloeppel" cx="90" cy="131" r="9" fill="${f}"/></g>`,
    nachricht: (f) => `<g class="ts-band" stroke="${f}" stroke-width="5" fill="none"><circle cx="58" cy="78" r="22"/><circle cx="122" cy="78" r="22"/>
      <path d="M58 100 H122"/><circle class="ts-spule" cx="58" cy="78" r="7"/><circle class="ts-spule" cx="122" cy="78" r="7"/></g>
      <g class="ts-pegel" fill="${f}">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${51 + i * 12}" y="118" width="6" height="34" rx="3" style="animation-delay:${(-i * 0.13).toFixed(2)}s"/>`).join("")}</g>`,
    verpasst: (f) => `<g class="ts-wackeln"><circle cx="90" cy="40" r="6" fill="${f}"/>
      <path d="M90 44 C69 44 58 60 58 82 V106 L47 122 H133 L122 106 V82 C122 60 111 44 90 44 Z" fill="color-mix(in srgb,${f} 14%,transparent)" stroke="${f}" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="90" cy="133" r="9" fill="${f}"/><path d="M44 40 L136 144" stroke="${f}" stroke-width="5" stroke-linecap="round"/></g>
      <circle class="ts-punkt" cx="136" cy="44" r="11" fill="${f}"/>`,
  };
  PS.tuerSymbol = (art, farbe) => `<svg viewBox="0 0 180 180" aria-hidden="true" class="al-svg ts-svg">${(TUER[art] || TUER.klingelt)(farbe)}</svg>`;

  const KARTE_UNSCHARF_S = 10 * 60;  // nach dem Entschärfen kurz bestätigen, dann verschwindet die Karte
  function alarmKarte() {
    const eid = alarmEid(); if (!eid) return null;
    const s = PS.s(eid), [art, name, unter, farbe] = zustand(eid);
    const seit = Date.parse(PS.st(eid).lc), uhr = isFinite(seit) ? PS.uhrzeit(new Date(seit)) : "";
    const basis = { id: "alarm", art: "praktisch", schluessel: "alarm", titel: name, wert: "", hinweis: "", oeffnen: "sicherheit" };
    const symbol = (a = art) => `${PS.alarmSymbol(a, farbe)}`;
    if (s === "triggered") {
      return { ...basis, relevanz: 100, modell: { kopf: "Alarmanlage", farbe, anteil: 1, glut: true, h2: "Alarm ausgelöst",
        p: [PS.a(eid).changed_by ? `durch ${PS.a(eid).changed_by}` : "", uhr ? `seit ${uhr}` : ""].filter(Boolean).join(" · "),
        innen: `${symbol()}<small class="einheit">Alarm</small>`, aktionen: [{ akt: "anlage", text: "Zur Anlage", icon: "shield-alert-outline", klasse: "gut" }] } };
    }
    if (art === "wird") {
      const { rest, gesamt } = restzeit(eid);
      const r = rest != null ? Math.max(0, Math.ceil(rest)) : null;
      return { ...basis, relevanz: 95, ...(r != null ? { ende: new Date(Date.now() + r * 1000).toISOString(), dauer_s: gesamt } : {}),
        modell: { kopf: "Alarmanlage", farbe, anteil: r != null && gesamt ? r / gesamt : 1, h2: name,
          p: unter || (PS.a(eid).next_state && ZUSTAND[PS.a(eid).next_state] ? `dann ${ZUSTAND[PS.a(eid).next_state][1]}` : ""),
          ...(r != null ? { zahl: `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`, einheit: "min" } : { innen: `${symbol()}<small class="einheit">bitte warten</small>` }) } };
    }
    if (s === "disarmed") {
      if (!isFinite(seit) || (Date.now() - seit) / 1000 > KARTE_UNSCHARF_S) return null;
      return { ...basis, relevanz: 35, modell: { kopf: "Alarmanlage", farbe, anteil: 1, h2: name, p: uhr ? `seit ${uhr} · ${unter}` : unter,
        innen: `${symbol()}<small class="einheit">unscharf</small>` } };
    }
    if (art === "unbekannt") return null;
    // scharf: ruhig im Hintergrund, mit dem animierten Modus
    return { ...basis, relevanz: 25, modell: { kopf: "Alarmanlage", farbe, anteil: 1, h2: name, p: uhr ? `seit ${uhr} · ${unter}` : unter,
      innen: `${symbol()}<small class="einheit">scharf</small>` } };
  }

  // Haustür: klingelt gerade, dazu höchstens eine Karte für eine ungehörte Nachricht oder ein verpasstes Klingeln. „Erledigt“ merkt sich das Panel selbst.
  const OFFEN_S = 180, NACHRICHT_S = 12 * 3600, VERPASST_KARTE_S = 3 * 3600;
  let klingeln = [];
  const gesehenLesen = () => { try { return Number(localStorage.getItem("ps.haustuer.gesehen")) || 0; } catch { return 0; } };
  const gesehenSetzen = (t) => { try { localStorage.setItem("ps.haustuer.gesehen", String(t)); } catch { /* nur für diese Sitzung */ } gesehen = t; };
  let gesehen = gesehenLesen();
  const feedNeu = () => { if (PS.feedNeu) PS.feedNeu(); };
  async function klingelnLaden() {
    try { const r = await fetch("api/klingeln?anzahl=12", { cache: "no-store" }); if (r.ok) klingeln = await r.json(); } catch { /* bleibt beim Stand */ }
    feedNeu();
  }
  function haustuerKarte() {
    const jetzt = Date.now() / 1000;
    const art = (e) => (e.ausgang === "laeuft" && jetzt - e.t > OFFEN_S ? "verpasst" : e.ausgang);
    const basis = (e, extra) => ({ id: `haustuer:${e.id}`, art: "praktisch", schluessel: "haustuer", titel: "Haustür", wert: "", hinweis: "", oeffnen: "sicherheit", _t: e.t, ...extra });
    const uhr = (e) => PS.uhrzeit(new Date(e.t * 1000));
    const vor = (e) => { const m = Math.floor((jetzt - e.t) / 60); return m < 1 ? "gerade eben" : m < 60 ? `vor ${m} min` : `vor ${Math.floor(m / 60)} h`; };
    const erledigt = { akt: "erledigt", text: "Erledigt" };
    const karten = [];
    const laeuft = klingeln.find((e) => art(e) === "laeuft");
    if (laeuft) {
      karten.push(basis(laeuft, { relevanz: 98, ende: new Date((laeuft.t + OFFEN_S) * 1000).toISOString(), dauer_s: OFFEN_S,
        modell: { kopf: "Haustür", farbe: "var(--warn)", anteil: 1, glut: true, h2: "Es klingelt", p: `${uhr(laeuft)}${laeuft.mal > 1 ? ` · ${laeuft.mal}× geklingelt` : ""}`,
          innen: `${PS.tuerSymbol("klingelt", "var(--warn)")}<small class="einheit">jetzt</small>` } }));
    }
    const offen = klingeln.filter((e) => e.t > gesehen);
    const nachrichten = offen.filter((e) => art(e) === "nachricht" && e.datei && jetzt - e.t < NACHRICHT_S);
    if (nachrichten.length) {
      const e = nachrichten[0];
      const text = e.text ? `„${e.text.length > 90 ? e.text.slice(0, 88).trimEnd() + " …" : e.text}“` : `${uhr(e)} · ${vor(e)}`;
      karten.push(basis(e, { relevanz: 75, datei: e.datei, dauer: e.dauer_s,
        modell: { kopf: "Haustür", farbe: "var(--akzent)", anteil: Math.max(0.05, 1 - (jetzt - e.t) / NACHRICHT_S),
          h2: nachrichten.length > 1 ? `${nachrichten.length} neue Nachrichten` : "Neue Nachricht", p: text,
          innen: `${PS.tuerSymbol("nachricht", "var(--akzent)")}<small class="einheit">${e.dauer_s ? `${Math.floor(e.dauer_s / 60)}:${String(Math.round(e.dauer_s % 60)).padStart(2, "0")}` : uhr(e)}</small>`,
          aktionen: [{ akt: "anhoeren", text: "Anhören", icon: "play", klasse: "gut" }, erledigt] } }));
      return karten;
    }
    const verpasst = offen.filter((e) => ["verpasst", "ohne"].includes(art(e)) && jetzt - e.t < VERPASST_KARTE_S);
    if (verpasst.length) {
      const e = verpasst[0];
      karten.push(basis(e, { relevanz: 60,
        modell: { kopf: "Haustür", farbe: "var(--krit)", anteil: Math.max(0.05, 1 - (jetzt - e.t) / VERPASST_KARTE_S),
          h2: art(e) === "ohne" ? "Geklingelt, keine Nachricht" : "Klingeln verpasst",
          p: `${uhr(e)} · ${vor(e)}${e.mal > 1 ? ` · ${e.mal}×` : ""}${verpasst.length > 1 ? ` · ${verpasst.length} insgesamt` : ""}`,
          innen: `${PS.tuerSymbol("verpasst", "var(--krit)")}<small class="einheit">${uhr(e)}</small>`, aktionen: [erledigt] } }));
    }
    return karten;
  }
  PS.sicherheitKarten = () => {
    const aus = (PS.einst && PS.einst.karten_aus) || [];
    return [aus.includes("alarm") ? null : alarmKarte(), ...(aus.includes("haustuer") ? [] : haustuerKarte())].filter(Boolean);
  };
  PS.sicherheitAktion = (akt, k, knopf) => {
    if (akt === "anlage") PS.oeffnen("sicherheit");
    else if (akt === "erledigt") { gesehenSetzen(Math.max(gesehen, k._t || 0)); feedNeu(); }
    else if (akt === "anhoeren" && k.datei && PS.aufnahmeSpielen) PS.aufnahmeSpielen(k.datei, k.dauer, knopf);
  };
  PS.on("klingeln", klingelnLaden);
  PS.on("aufnahmen", klingelnLaden);
  PS.on("init", klingelnLaden);
  PS.on("diff", (ids) => { const e = alarmEid(); if (e && ids.has(e)) feedNeu(); });
})();
