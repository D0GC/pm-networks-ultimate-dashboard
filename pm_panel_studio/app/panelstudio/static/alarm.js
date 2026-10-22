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
  let tafel = null;
  PS.codeTafel = ({ titel, unter = "Code eingeben", symbol = "", pruefen }) => {
    if (tafel) tafel.schliessen(true);
    const g = E(`<div class="ct-grund" role="dialog" aria-modal="true" aria-label="${PS.esc(titel)}"><div class="ct-tafel">
      <div class="ct-kopf"><div class="ct-symbol">${symbol}</div><b>${PS.esc(titel)}</b><small>${PS.esc(unter)}</small></div>
      <div class="ct-felder" aria-live="polite"></div>
      <div class="ct-haken"><svg viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="24"/><path d="M16 28 l7 7 l15 -15"/></svg></div>
      <div class="ct-meldung">&nbsp;</div>
      <div class="ct-tasten"></div>
      <button type="button" class="ct-abbrechen">Abbrechen</button></div></div>`);
    const felder = g.querySelector(".ct-felder"), meldung = g.querySelector(".ct-meldung"), tasten = g.querySelector(".ct-tasten");
    let code = "", sperre = false;
    const FELDER = 8;
    const zeigen = (neu) => {
      felder.innerHTML = "";
      const n = Math.max(4, code.length);
      for (let i = 0; i < Math.min(FELDER, n); i++) {
        const f = E(`<div class="ct-feld${i < code.length ? " voll" : ""}"><i></i><span></span></div>`);
        if (i === neu) { f.querySelector("span").textContent = code[i]; f.classList.add("zeigt", "neu"); setTimeout(() => f.classList.remove("zeigt"), 550); }
        felder.appendChild(f);
      }
    };
    const melden = (text, art = "") => { meldung.textContent = text || " "; meldung.className = `ct-meldung ${art}`; };
    const ziffer = (z) => { if (sperre || code.length >= FELDER) return; code += z; zeigen(code.length - 1); melden(""); };
    const loeschen = () => { if (sperre) return; code = code.slice(0, -1); zeigen(-1); };
    const bestaetigen = async () => {
      if (sperre || !code) return;
      sperre = true; g.classList.add("prueft"); melden("Wird geprüft …");
      let ok = false, text = "";
      try { const r = await pruefen(code); ok = r === true; text = typeof r === "string" ? r : ""; } catch (e) { text = e && e.message ? e.message : ""; }
      g.classList.remove("prueft");
      if (ok) {
        felder.classList.add("ok"); g.classList.add("geschafft"); melden("Code richtig", "ok");
        setTimeout(() => schliessen(), 1000);
      } else {
        felder.classList.add("fehler"); melden(text || "Falscher Code", "fehler");
        setTimeout(() => { felder.classList.remove("fehler"); code = ""; zeigen(-1); sperre = false; }, 700);
      }
    };
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].forEach((z) => {
      const b = E(`<button type="button" class="ct-taste${z === "⌫" ? " leise" : z === "✓" ? " ok" : ""}" aria-label="${z === "⌫" ? "Löschen" : z === "✓" ? "Bestätigen" : `Ziffer ${z}`}">${z === "⌫" ? PS.ic("backspace-outline") : z === "✓" ? PS.ic("check") : z}</button>`);
      b.addEventListener("pointerdown", (e) => {
        const r = b.getBoundingClientRect(), w = document.createElement("span");
        w.className = "ct-riffel"; w.style.left = `${e.clientX - r.left - 5}px`; w.style.top = `${e.clientY - r.top - 5}px`;
        b.appendChild(w); setTimeout(() => w.remove(), 520);
      });
      b.addEventListener("click", () => (z === "⌫" ? loeschen() : z === "✓" ? bestaetigen() : ziffer(z)));
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
    function schliessen(sofort) {
      document.removeEventListener("keydown", taste, true);
      if (tafel && tafel.g === g) tafel = null;
      if (sofort) { g.remove(); return; }
      g.classList.add("schliesst");
      setTimeout(() => g.remove(), 340);
    }
    g.querySelector(".ct-abbrechen").addEventListener("click", () => schliessen());
    g.addEventListener("click", (e) => { if (e.target === g) schliessen(); });
    document.addEventListener("keydown", taste, true);
    zeigen(-1);
    document.body.appendChild(g);
    requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add("offen")));
    tafel = { g, schliessen };
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
            PS.codeTafel({ titel: `Scharf · ${titel}`, unter: "Code eingeben und bestätigen", symbol: PS.alarmSymbol(art, FARBE[art]), pruefen: (code) => ausfuehren(eid, dienst, code, ziel) });
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
})();
