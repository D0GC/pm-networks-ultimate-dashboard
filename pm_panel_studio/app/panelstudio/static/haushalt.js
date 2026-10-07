/* PM Panel Studio – Haushaltsgeräte: Roborock mit Live-Karte, Waschmaschine, Geschirrspüler und weitere Geräte.
   Links die Gerätekarten, Mitte die Karte des Roboters, rechts Steuerung und Verbrauchsmaterial. Live-Änderungen werden
   an Ort und Stelle nachgeführt (kein Neuaufbau der Seite). Fehlende Entitäten blendet das Modul einfach aus. */
(function () {
  "use strict";
  const PS = window.PS;

  // ------------------------------------------------------------ Geräte (hier anpassen)
  // Waschmaschine und Geschirrspüler: Status-Werte klein geschrieben, ohne Präfix (Home Connect liefert z. B. „BSH.….Run“)
  const GERAETE = {
    waesche: {
      titel: "Waschmaschine", icon: "washing-machine",
      status: "sensor.karl_die_waschmaschine_aktueller_status",
      laeuft: ["running", "rinsing", "spinning", "rinse_hold", "cool_down", "drying", "steam_softening", "refreshing", "detecting"],
      pause: ["pause"], fertig: ["end"], fehler: ["error"],
      phase: "sensor.waschmaschine_phase",
      fortschritt: "sensor.waschmaschine_fortschritt",
      ende: "sensor.waschmaschine_programmende",          // Zeitstempel, maßgeblich für die Restzeit
      rest: "sensor.karl_die_waschmaschine_verbleibende_zeit",
      gesamtdauer: "sensor.karl_die_waschmaschine_gesamtdauer",  // Minuten, letztes Programm
      zyklen: "sensor.karl_die_waschmaschine_zyklen",
      energie: "sensor.karl_die_waschmaschine_energie_in_diesem_monat",  // Wh
      quittung: "input_button.wasche_entnommen", quittungText: "Wäsche entnommen",
    },
    spueler: {
      titel: "Geschirrspüler", icon: "dishwasher",
      status: "sensor.dishwasher_bsh_common_status_operationstate",
      laeuft: ["run", "delayedstart", "actionrequired", "aborting"],
      pause: ["pause"], fertig: ["finished"], fehler: ["error"],
      statusText: { delayedstart: "Wartet auf Start", actionrequired: "Eingriff nötig", aborting: "Bricht ab" },
      phase: "sensor.geschirrspuler_phase",
      phaseEnum: "sensor.dishwasher_dishcare_dishwasher_status_programphase",
      phaseText: { prerinse: "Vorspülen", mainwash: "Reinigen", finalrinse: "Klarspülen", drying: "Trocknen" },
      programm: "sensor.dishwasher_bsh_common_option_programname",
      fortschritt: "sensor.dishwasher_bsh_common_option_programprogress",
      rest: "sensor.dishwasher_bsh_common_option_remainingprogramtime",  // Sekunden
      zyklen: "sensor.dishwasher_bsh_common_status_program_all_count_started",
      letztEnde: "event.dishwasher_bsh_common_event_programfinished",
      quittung: "input_button.geschirr_ausgeraumt", quittungText: "Geschirr ausgeräumt",
    },
  };
  // Roborock S8
  const ROBO = {
    vacuum: "vacuum.roborock_s8", status: "sensor.roborock_s8_status", batterie: "sensor.roborock_s8_batterie",
    raum: "sensor.roborock_s8_aktueller_raum", fortschritt: "sensor.roborock_s8_reinigungsfortschritt",
    flaeche: "sensor.roborock_s8_reinigungsbereich", zeit: "sensor.roborock_s8_reinigungszeit",
    fehler: "sensor.roborock_s8_staubsauger_fehler", letztesEnde: "sensor.roborock_s8_letztes_reinigungsende", gesamt: "sensor.roborock_s8_gesamtzahl_reinigungen",
    karte: "image.roborock_s8_wohnung",
    programme: [
      ["button.roborock_s8_full_clean", "Komplett", "robot-vacuum"],
      ["button.roborock_s8_vac_followed_by_mop", "Saugen, dann Wischen", "water"],
      ["button.roborock_s8_deep", "Gründlich", "magnify-scan"],
      ["button.roborock_s8_end_of_day", "Feierabend", "weather-night"],
    ],
    waehler: [
      ["select.flur_roborock_s8_reinigungsmodus", "Modus", { vacuum: "Saugen", vac_and_mop: "Saugen + Wischen", mop: "Wischen", custom: "Eigene" }],
      ["select.roborock_s8_wisch_intensitat", "Wischen", { off: "Aus", mild: "Sanft", moderate: "Mittel", intense: "Intensiv", custom: "Eigene", custom_water_flow: "Eigene" }],
    ],
    // Verbrauchsmaterial: Entität, Name, Lebensdauer in Stunden (wie in der Wartung)
    material: [
      ["sensor.roborock_s8_verbleibende_filterzeit", "Filter", 150],
      ["sensor.roborock_s8_verbleibende_zeit_der_hauptburste", "Hauptbürste", 300],
      ["sensor.roborock_s8_verbleibende_zeit_der_seitenburste", "Seitenbürste", 200],
      ["sensor.roborock_s8_verbleibende_sensorzeit", "Sensoren", 30],
    ],
    aktualisierung: 5,  // Sekunden zwischen Kartenbildern, solange der Roboter fährt
  };
  // Weitere Geräte als Kacheln: [Entität, Titel]
  const WEITERE = [
    ["fan.wohnzimmer_luftreiniger_wohnzimmer", "Luftreiniger"],
    ["sensor.wohnzimmer_luftreiniger_wohnzimmer_feinstaub_pm2_5", "Feinstaub"],
    ["sensor.wohnzimmer_luftreiniger_wohnzimmer_allergen_index", "Allergen-Index"],
    ["switch.pm_wohnzimmer_luftreiniger_automatik", "Automatik"],
  ];

  // ------------------------------------------------------------ Bausteine
  const E = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const da = (e) => !!e && !!PS.z[e] && !PS.nichtDa(e);
  const wert = (e) => (da(e) ? PS.s(e) : null);
  const zahl = (e) => { const v = wert(e); const n = v == null || v === "" ? NaN : Number(v); return isFinite(n) ? n : null; };
  const box = (titel, klein) => E(`<section class="r-box"><h3><span>${PS.esc(titel)}</span>${klein != null ? `<small>${PS.esc(klein)}</small>` : ""}</h3></section>`);
  const knopf = (text, icon, fn, klasse = "") => { const b = E(`<button class="knopf ${klasse}">${icon ? PS.ic(icon) : ""}${text ? `<span>${PS.esc(text)}</span>` : ""}</button>`); if (fn) b.addEventListener("click", fn); return b; };
  const alleIds = (o) => Object.values(o).flat(2).filter((v) => typeof v === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test(v));
  function seite(el) {
    el.classList.add("raumseite");
    const g = E('<div class="raum-ansicht haushalt"><div class="r-spalte"></div><div class="r-spalte"></div><div class="r-spalte"></div></div>');
    el.appendChild(g);
    return g.children;
  }
  const kurz = (s) => String(s == null ? "" : s).split(".").pop().toLowerCase();
  const uhr = (ms) => PS.uhrzeit(new Date(ms));
  const tagUhr = (ms) => {
    const d = new Date(ms), heute = new Date(), gestern = new Date(Date.now() - 864e5);
    const tag = d.toDateString() === heute.toDateString() ? "heute" : d.toDateString() === gestern.toDateString() ? "gestern" : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
    return `${tag} ${uhr(ms)}`;
  };
  // Restzeit als Walzentext: ab einer Stunde „1:12“ (Std.), darunter Minuten
  const restText = (sek) => {
    const min = Math.max(0, Math.ceil(sek / 60));
    return min >= 60 ? { text: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`, einheit: "Std." } : { text: String(min), einheit: "Min." };
  };

  let ui = null;  // Verweise auf die aktuell gezeichnete Seite

  // ------------------------------------------------------------ Gerätekarten (Waschmaschine, Geschirrspüler)
  function zustand(g) {
    if (!da(g.status)) return "weg";
    const s = kurz(PS.s(g.status));
    let z = g.laeuft.includes(s) ? "laeuft" : g.pause.includes(s) ? "pausiert" : g.fehler.includes(s) ? "fehler" : g.fertig.includes(s) ? "fertig" : "ruhe";
    // Quittiert (Knopf nach Programmende gedrückt): wieder ruhig
    if (z === "fertig" && g.quittung && da(g.quittung) && Date.parse(PS.s(g.quittung)) > (Date.parse(PS.st(g.status).lc) || 0)) z = "ruhe";
    return z;
  }
  // Programmende in ms: Zeitstempel-Sensor, sonst Restzeit-Sensor (Zeitstempel, Sekunden oder Minuten)
  function endeMs(g, z) {
    // Nur echte Zeitstempel (mit Datum) – eine reine Zahl wie „7500“ (Sekunden) würde Date.parse als Jahr lesen
    const stempel = (e) => {
      const roh = da(e) ? String(PS.s(e)) : "";
      if (!/^\d{4}-\d{2}-\d{2}/.test(roh)) return null;
      const t = Date.parse(roh); return isFinite(t) ? t : null;
    };
    const t = stempel(g.ende) ?? stempel(g.rest);
    // Unplausible Werte (mehr als zwei Tage) nicht anzeigen
    if (t != null) return (t - Date.now()) / 1000 > 2 * 86400 ? null : { ende: t, rest: (t - Date.now()) / 1000 };
    const n = zahl(g.rest);
    if (n == null) return null;
    const einheit = String(PS.a(g.rest).unit_of_measurement || "min").toLowerCase();
    const sek = n * (einheit === "s" ? 1 : einheit === "h" ? 3600 : 60);
    // Bei Pause steht die Restzeit still; sonst läuft sie seit der letzten Meldung weiter
    const seit = z === "pausiert" ? 0 : (Date.now() - (Date.parse(PS.st(g.rest).lc) || Date.now())) / 1000;
    if (sek - seit > 2 * 86400) return null;
    return { ende: Date.now() + (sek - seit) * 1000, rest: sek - seit };
  }
  function geraetBauen(schluessel, g, i) {
    const b = E(`<section class="r-box hh-geraet" data-g="${schluessel}" style="--i:${i}">
      <h3><span>${PS.esc(g.titel)}</span><small class="hh-zust"></small></h3>
      <div class="hh-kopf">
        <div class="ring r-ring r-gross" style="--farbe:var(--leise)">${PS.ringSVG(0)}<div class="innen"><b class="tabular hh-rest"></b><small class="hh-einheit"></small></div></div>
        <div class="hh-info"><b class="hh-phase"></b><span class="hh-ende"></span><small class="hh-extra"></small></div>
      </div>
      <div class="hh-aktion"></div></section>`);
    const o = { b, g, ring: b.querySelector(".ring"), rest: b.querySelector(".hh-rest"), einheit: b.querySelector(".hh-einheit"), z: null, ids: alleIds(g) };
    o.ring.addEventListener("click", () => PS.mehrInfos(g.status));
    o.ring.style.cursor = "pointer";
    if (g.quittung && PS.z[g.quittung]) {
      o.knopf = knopf(g.quittungText, "check-circle-outline", () => PS.dienst("input_button", "press", { entity_id: g.quittung }).then(() => PS.toast(g.quittungText)), "primaer breit");
      b.querySelector(".hh-aktion").appendChild(o.knopf);
    }
    geraetAktualisieren(o);
    return o;
  }
  const FARBE = { laeuft: "var(--info)", pausiert: "var(--warn)", fertig: "var(--gut)", fehler: "var(--krit)", ruhe: "var(--leise)" };
  const ZUST_TEXT = { laeuft: "Läuft", pausiert: "Pausiert", fertig: "Fertig", fehler: "Fehler", ruhe: "Aus" };
  function geraetAktualisieren(o) {
    const g = o.g, z = zustand(g), st = kurz(da(g.status) ? PS.s(g.status) : "");
    const wechsel = z !== o.z;
    o.z = z;
    o.b.dataset.z = z;
    o.b.classList.toggle("weg", z === "weg");
    o.b.querySelector(".hh-zust").textContent = ZUST_TEXT[z] || "";
    o.ring.style.setProperty("--farbe", FARBE[z] || FARBE.ruhe);
    o.ring.classList.toggle("laeuft", z === "laeuft");
    o.ring.classList.toggle("glimmt", z === "laeuft");
    const phase = o.b.querySelector(".hh-phase"), ende = o.b.querySelector(".hh-ende"), extra = o.b.querySelector(".hh-extra");
    const info = (a, b, c) => { phase.textContent = a || ""; ende.textContent = b || ""; extra.textContent = c || ""; };
    const proz = zahl(g.fortschritt);
    const teile = [];
    if (z === "laeuft" || z === "pausiert") {
      const e = endeMs(g, z);
      // Phase: Text-Sensor (deutsch), sonst Enum-Übersetzung, sonst Statuswort
      const ps = da(g.phase) && !/^[—–-]?$/.test(PS.s(g.phase)) ? PS.s(g.phase) : (g.phaseEnum && da(g.phaseEnum) && (g.phaseText || {})[kurz(PS.s(g.phaseEnum))]) || null;
      const kopf = (g.statusText || {})[st] || (z === "pausiert" ? "Pausiert" : ps || "Läuft");
      if (g.programm && da(g.programm)) teile.push(PS.s(g.programm));
      if (proz != null) teile.push(`${Math.round(proz)} %`);
      if (ps && kopf !== ps) teile.push(ps);
      info(kopf, e && z === "laeuft" ? `fertig um ${uhr(e.ende)}` : e ? `noch ${restText(e.rest).text} ${restText(e.rest).einheit}` : "", teile.join(" · "));
      let anteil = proz != null ? proz / 100 : null;
      if (anteil == null && e && zahl(g.gesamtdauer)) anteil = 1 - e.rest / (zahl(g.gesamtdauer) * 60);
      PS.ringSetzen(o.ring.querySelector("svg"), Math.max(0.01, Math.min(1, anteil == null ? 0.02 : anteil)));
      o.tickerNoetig = true;
      geraetTick(o, true);
    } else {
      o.tickerNoetig = false;
      o.rest._walze = null; o.rest.textContent = "";
      o.einheit.textContent = "";
      if (z === "fertig") {
        o.rest.innerHTML = PS.ic("check");
        const seit = Date.parse(PS.st(g.status).lc);
        info("Fertig", seit ? `seit ${uhr(seit)}` : "", g.quittung ? (g.quittungText.startsWith("Wäsche") ? "wartet aufs Entnehmen" : "wartet aufs Ausräumen") : "");
        PS.ringSetzen(o.ring.querySelector("svg"), 1);
      } else if (z === "fehler") {
        o.rest.innerHTML = PS.ic("alert-circle-outline");
        info("Fehler", "", "Bitte am Gerät prüfen");
        PS.ringSetzen(o.ring.querySelector("svg"), 1);
      } else {
        o.rest.innerHTML = PS.ic(g.icon);
        // Ruhig: letzte Laufzeit, Zyklen, Energie dieses Monats
        const l = [];
        if (da(g.zyklen)) l.push(`${PS.zahl(zahl(g.zyklen), 0)} ${g.energie ? "Zyklen" : "Programme"}`);
        if (da(g.energie)) { const wh = zahl(g.energie); if (wh != null) l.push(`${PS.zahl(wh / 1000, 1)} kWh im Monat`); }
        const letzt = [];
        if (g.gesamtdauer && zahl(g.gesamtdauer)) letzt.push(`Letzter Lauf ${PS.zahl(zahl(g.gesamtdauer), 0)} min`);
        const le = g.letztEnde && da(g.letztEnde) ? Date.parse(PS.s(g.letztEnde)) : NaN;
        if (isFinite(le)) letzt.push(`Zuletzt fertig ${tagUhr(le)}`);
        const quittiert = g.quittung && da(g.quittung) && st && g.fertig.includes(st);
        info(quittiert ? g.quittungText : "Aus", letzt.join(" · "), l.join(" · "));
        PS.ringSetzen(o.ring.querySelector("svg"), 0);
      }
    }
    if (o.knopf) o.knopf.hidden = z !== "fertig";
    o.b.classList.toggle("hat-aktion", z === "fertig" && !!o.knopf);
    if (wechsel) o.b.classList.remove("flash"), void o.b.offsetWidth, o.b.classList.add("flash");
  }
  // Sekundentakt: Restzeit rollt weiter, ohne dass HA etwas schickt
  function geraetTick(o, neu) {
    if (!o.tickerNoetig) return;
    const e = endeMs(o.g, o.z);
    if (!e) { if (neu) { o.rest.textContent = "–"; o.einheit.textContent = ""; } return; }
    const r = restText(e.rest);
    PS.walze(o.rest, r.text);
    o.einheit.textContent = r.einheit;
    if (o.z === "laeuft") o.b.querySelector(".hh-ende").textContent = `fertig um ${uhr(e.ende)}`;
  }

  // ------------------------------------------------------------ Roboter
  const STATUS = {
    charging: "Lädt", cleaning: "Reinigt", returning_home: "Fährt zur Station", docking: "Dockt an", idle: "Bereit", paused: "Pausiert",
    error: "Fehler", emptying_the_bin: "Leert den Staubbehälter", washing_the_mop: "Wäscht den Mopp", going_to_wash_the_mop: "Fährt zum Moppwaschen",
    segment_cleaning: "Reinigt Räume", zoned_cleaning: "Reinigt Zone", spot_cleaning: "Punktreinigung", charging_complete: "Voll geladen",
    going_to_target: "Fährt zum Ziel", mapping: "Kartiert", segment_mopping: "Wischt Räume", zoned_mopping: "Wischt Zone", robot_status_mopping: "Wischt",
    clean_mop_cleaning: "Saugt und wischt", clean_mop_mopping: "Wischt", segment_clean_mop_cleaning: "Saugt und wischt Räume",
    segment_clean_mop_mopping: "Wischt Räume", zoned_clean_mop_cleaning: "Saugt und wischt Zone", zoned_clean_mop_mopping: "Wischt Zone",
    air_drying_stopping: "Trocknet", attaching_the_mop: "Setzt Mopp an", detaching_the_mop: "Nimmt Mopp ab", device_offline: "Offline",
    updating: "Aktualisiert", shutting_down: "Fährt herunter", patrol: "Kontrollfahrt", locked: "Gesperrt", starting: "Startet",
  };
  const VAC_TEXT = { docked: "In der Station", cleaning: "Reinigt", returning: "Fährt zur Station", paused: "Pausiert", idle: "Bereit", error: "Fehler", unavailable: "Nicht erreichbar" };
  const roboFahrt = () => ["cleaning", "returning"].includes(PS.s(ROBO.vacuum));
  const roboReinigt = () => PS.s(ROBO.vacuum) === "cleaning";
  const roboText = () => (da(ROBO.status) && STATUS[PS.s(ROBO.status)]) || VAC_TEXT[PS.s(ROBO.vacuum)] || (da(ROBO.status) ? PS.text(ROBO.status) : "–");
  const matText = (h) => `${PS.zahl(h, 0)} h`;

  // Karte: zwei Bilder übereinander; das neue Bild liegt erst nach „load“ oben und blendet weich über das alte
  const bildPfad = (a) => [a.entity_picture, a.entity_picture_local].find((p) => typeof p === "string" && p.startsWith("/api/image_proxy/")) || null;
  // Wohnung füllt die Kachel: Das Kartenbild hat viel leeren Rand. Der Umriss der Wohnung (nicht transparente bzw. vom
  // Eckhintergrund abweichende Pixel) wird ermittelt und dieser Ausschnitt so groß wie möglich in die Kachel gezeichnet.
  // Die Kachel selbst behält ihre Größe.
  function umriss(img) {
    const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0);
    let d; try { d = x.getImageData(0, 0, w, h).data; } catch { return { x: 0, y: 0, w, h }; }
    const eck = [d[0], d[1], d[2], d[3]];
    const leer = (i) => d[i + 3] < 16 || (eck[3] > 16 && Math.abs(d[i] - eck[0]) + Math.abs(d[i + 1] - eck[1]) + Math.abs(d[i + 2] - eck[2]) < 24);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      if (leer((y * w + xx) * 4)) continue;
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return { x: 0, y: 0, w, h };
    const rand = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
    x0 = Math.max(0, x0 - rand); y0 = Math.max(0, y0 - rand); x1 = Math.min(w - 1, x1 + rand); y1 = Math.min(h - 1, y1 + rand);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function karteZeichnen(img, buehne) {
    const r = buehne.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const c = document.createElement("canvas"); c.className = "hh-kimg";
    c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
    const u = umriss(img), f = Math.min(c.width / u.w, c.height / u.h);
    const x = c.getContext("2d"); x.imageSmoothingEnabled = f < 2; x.imageSmoothingQuality = "high";
    x.drawImage(img, u.x, u.y, u.w, u.h, (c.width - u.w * f) / 2, (c.height - u.h * f) / 2, u.w * f, u.h * f);
    return c;
  }
  function karteLaden() {
    if (!ui) return;
    const k = ui.karte, pfad = bildPfad(PS.a(ROBO.karte));
    if (!pfad || k.laedt) { if (k.laedt) k.nochmal = true; return; }
    k.laedt = true;
    const img = new Image();
    img.onload = () => {
      k.laedt = false;
      if (!k.buehne.isConnected) return;
      const alt = [...k.buehne.querySelectorAll(".hh-kimg")];
      const bild = karteZeichnen(img, k.buehne);
      k.buehne.appendChild(bild);
      requestAnimationFrame(() => requestAnimationFrame(() => bild.classList.add("da")));
      k.buehne.classList.add("hat-bild");
      setTimeout(() => alt.forEach((a) => a.remove()), 1200);
      if (k.nochmal) { k.nochmal = false; karteLaden(); }
    };
    img.onerror = () => { k.laedt = false; k.nochmal = false; };
    // Cache-Buster: jede Anfrage holt das aktuelle Bild von HA
    img.src = "api/bild?pfad=" + encodeURIComponent(pfad) + "&z=" + Date.now();
  }

  function roboBauen(host) {
    host.innerHTML = `<div class="hh-robo">
      <div class="hh-robo-kopf">
        <div class="ring r-ring" style="--farbe:var(--gut)">${PS.ringSVG(0)}<div class="innen"><b class="tabular hh-akku"></b><small>Akku</small></div></div>
        <div class="hh-robo-status"><b class="hh-st"></b><span class="hh-raum"></span><small class="hh-hinweis"></small></div>
      </div>
      <div class="hh-zahlen"><div><b class="tabular"></b><small></small></div><div><b class="tabular"></b><small></small></div><div><b class="tabular"></b><small></small></div></div>
      <div class="reihe hh-steuer"></div></div>`;
    const j = host.firstElementChild, o = { j, ring: j.querySelector(".ring") };
    const dienst = (s) => () => PS.dienst("vacuum", s, { entity_id: ROBO.vacuum });
    o.start = knopf("Start", "play", () => PS.dienst("vacuum", roboReinigt() ? "pause" : "start", { entity_id: ROBO.vacuum }), "primaer");
    o.station = knopf("Zur Station", "home-import-outline", dienst("return_to_base"));
    o.finden = knopf("Finden", "map-marker-radius", () => PS.dienst("vacuum", "locate", { entity_id: ROBO.vacuum }).then(() => PS.toast("Roborock piept")));
    j.querySelector(".hh-steuer").append(o.start, o.station, o.finden);
    o.zahlen = [...j.querySelectorAll(".hh-zahlen>div")];
    o.ring.addEventListener("click", () => PS.mehrInfos(ROBO.vacuum));
    o.ring.style.cursor = "pointer";
    return o;
  }
  function roboAktualisieren() {
    if (!ui) return;
    const o = ui.robo, vac = PS.s(ROBO.vacuum), reinigt = roboReinigt(), fahrt = roboFahrt();
    o.j.classList.toggle("fahrt", fahrt);
    o.j.querySelector(".hh-st").textContent = roboText();
    const raum = da(ROBO.raum) ? PS.s(ROBO.raum) : "";
    o.j.querySelector(".hh-raum").textContent = fahrt && raum ? `in ${raum}` : vac === "docked" ? "Station" : "";
    const fehler = da(ROBO.fehler) && PS.s(ROBO.fehler) !== "none" ? PS.text(ROBO.fehler) : "";
    o.j.querySelector(".hh-hinweis").textContent = fehler;
    ui.karte.kopfKlein.textContent = fahrt && raum ? `${roboText()} · ${raum}` : roboText();
    // Akku
    const akku = zahl(ROBO.batterie);
    o.j.querySelector(".hh-akku").textContent = akku == null ? "–" : `${Math.round(akku)} %`;
    o.ring.style.setProperty("--farbe", akku == null ? "var(--leise)" : akku < 15 ? "var(--krit)" : akku < 30 ? "var(--warn)" : "var(--gut)");
    PS.ringSetzen(o.ring.querySelector("svg"), akku == null ? 0 : akku / 100);
    // Start/Pause
    o.start.innerHTML = `${PS.ic(reinigt ? "pause" : "play")}<span>${reinigt ? "Pause" : vac === "paused" ? "Weiter" : "Start"}</span>`;
    o.station.classList.toggle("aktiv", vac === "returning");
    // Kennzahlen: beim Fahren der laufende Auftrag, sonst die letzte Reinigung
    const z = o.zahlen, set = (i, w, l) => { z[i].querySelector("b").textContent = w; z[i].querySelector("small").textContent = l; };
    if (fahrt) {
      const p = zahl(ROBO.fortschritt), f = zahl(ROBO.flaeche), t = zahl(ROBO.zeit);
      set(0, p == null ? "–" : `${Math.round(p)} %`, "Fortschritt");
      set(1, f == null ? "–" : `${PS.zahl(f, 1)} m²`, "Fläche");
      set(2, t == null ? "–" : `${Math.round(t)} min`, "Zeit");
    } else {
      const le = da(ROBO.letztesEnde) ? Date.parse(PS.s(ROBO.letztesEnde)) : NaN;
      const f = zahl(ROBO.flaeche), t = zahl(ROBO.zeit);
      set(0, isFinite(le) ? tagUhr(le).replace(/^heute /, "") : "–", "Zuletzt");
      set(1, da(ROBO.gesamt) ? PS.zahl(zahl(ROBO.gesamt), 0) : "–", "Reinigungen");
      set(2, f ? `${PS.zahl(f, 1)} m²` : t ? `${Math.round(t)} min` : "–", f ? "Fläche" : "Letzte Zeit");
    }
    ui.waehler.forEach(waehlerAktualisieren);
    materialAktualisieren();
  }
  function programmeBauen(box) {
    const l = ROBO.programme.filter(([e]) => PS.z[e]);
    if (!l.length) return;
    box.appendChild(E('<h3 class="unter"><span>Programme</span></h3>'));
    const r = E('<div class="hh-programme"></div>');
    l.forEach(([e, text, icon]) => r.appendChild(knopf(text, icon, () => PS.dienst("button", "press", { entity_id: e }).then(() => PS.toast(`Roborock: ${text}`)))));
    box.appendChild(r);
  }
  function waehlerBauen(box) {
    ui.waehler = [];
    ROBO.waehler.filter(([e]) => PS.z[e]).forEach(([e, titel, namen]) => {
      const z = E(`<div class="hh-waehler" data-eid="${PS.esc(e)}"><small>${PS.esc(titel)}</small><div class="reihe"></div></div>`);
      z._namen = namen;
      box.appendChild(z); ui.waehler.push(z);
      waehlerAktualisieren(z);
    });
  }
  function waehlerAktualisieren(z) {
    const e = z.dataset.eid, opts = PS.a(e).options || [], reihe = z.querySelector(".reihe");
    if (reihe.children.length !== opts.length || [...reihe.children].some((c, i) => c.dataset.o !== opts[i])) {
      reihe.innerHTML = "";
      opts.forEach((op) => { const c = knopf(z._namen[op] || op.replace(/_/g, " "), null, () => PS.dienst("select", "select_option", { entity_id: e, option: op }), "chip"); c.dataset.o = op; reihe.appendChild(c); });
    }
    [...reihe.children].forEach((c) => c.classList.toggle("aktiv", c.dataset.o === PS.s(e)));
    z.hidden = !da(e) && !opts.length;
  }
  function materialBauen(box) {
    const l = ROBO.material.filter(([e]) => PS.z[e]);
    if (!l.length) return null;
    const host = E('<div class="hh-material"></div>');
    l.forEach(([e, name]) => {
      const z = E(`<div class="balken-zeile" data-eid="${PS.esc(e)}"><span>${PS.esc(name)}</span><span class="w tabular"></span><div class="bar"><i></i></div></div>`);
      z.addEventListener("click", () => PS.mehrInfos(e));
      host.appendChild(z);
    });
    box.appendChild(host);
    return host;
  }
  function materialAktualisieren() {
    if (!ui || !ui.material) return;
    ui.material.querySelectorAll("[data-eid]").forEach((z) => {
      const e = z.dataset.eid, def = ROBO.material.find((m) => m[0] === e), h = zahl(e), soll = def[2];
      const anteil = h == null ? 0 : Math.max(0, Math.min(1, h / soll));
      z.querySelector(".w").textContent = h == null ? "–" : matText(h);
      z.querySelector("i").style.width = Math.max(2, anteil * 100) + "%";
      z.classList.toggle("niedrig", h != null && (anteil < 0.1 || h < 20));
    });
  }

  // ------------------------------------------------------------ Seite
  function haushalt(el) {
    const [l, m, r] = seite(el);
    ui = { el, geraete: [], robo: null, karte: null, waehler: [], material: null, n: 0 };
    const mein = ui;
    // Links: Gerätekarten und Kacheln
    let i = 0;
    Object.entries(GERAETE).forEach(([k, g]) => {
      if (!da(g.status)) return;
      const o = geraetBauen(k, g, i++);
      ui.geraete.push(o); l.appendChild(o.b);
    });
    const weitere = WEITERE.filter(([e]) => PS.z[e]);
    if (weitere.length) {
      const b = box("Weitere Geräte", "");
      b.classList.add("hh-weitere");
      b.appendChild(E(`<div class="raster mini">${weitere.map(([e, titel], n) => PS.kachelHTML(e, { i: n, titel })).join("")}</div>`));
      PS.kachelnBinden(b); l.appendChild(b);
    }
    // Mitte: Karte
    if (PS.z[ROBO.vacuum]) {
      const bk = box("Karte", "");
      const buehne = E(`<div class="hh-buehne"><div class="hh-leer">${PS.ic("map-outline")}<b>Keine Karte</b><small>Der Roboter hat noch kein Bild geliefert.</small></div></div>`);
      bk.appendChild(buehne);
      ui.karte = { buehne, kopfKlein: bk.querySelector("small"), laedt: false, nochmal: false };
      m.appendChild(bk);
      // Rechts: Steuerung
      const br = box("Roborock S8", "");
      ui.robo = roboBauen(br.appendChild(E('<div class="hh-host"></div>')));
      programmeBauen(br);
      waehlerBauen(br);
      r.appendChild(br);
      const bm = box("Verbrauchsmaterial", "");
      bm.classList.add("hh-materialbox");
      ui.material = materialBauen(bm);
      if (ui.material) m.appendChild(bm);
      roboAktualisieren();
      if (da(ROBO.karte)) karteLaden();
    }
    // Sekundentakt: Restzeiten, bei fahrendem Roboter alle paar Sekunden ein frisches Kartenbild; endet mit der Seite
    const takt = setInterval(() => {
      if (ui !== mein || !el.isConnected) { clearInterval(takt); return; }
      ui.n++;
      ui.geraete.forEach((o) => geraetTick(o));
      if (ui.karte && roboFahrt() && ui.n % ROBO.aktualisierung === 0) karteLaden();
    }, 1000);
  }

  // Live: nur betroffene Teile nachführen
  PS.on("diff", (ids) => {
    if (!ui) return;
    if (!ui.el.isConnected) { ui = null; return; }
    ui.geraete.forEach((o) => { if (o.ids.some((e) => ids.has(e))) geraetAktualisieren(o); });
    if (ui.robo) {
      if (alleIds(ROBO).some((e) => ids.has(e) && e !== ROBO.karte)) roboAktualisieren();
      // Neuer Zeitstempel der Karte (oder Statuswechsel): sofort neues Bild
      if (ids.has(ROBO.karte) || ids.has(ROBO.vacuum)) karteLaden();
    }
  });
  PS.on("seite", () => { ui = null; });

  PS.module.haushalt = {
    titel: "Haushaltsgeräte", kurz: "Haushalt", icon: "washing-machine",
    verfuegbar: () => Object.values(GERAETE).some((g) => PS.z[g.status]) || !!PS.z[ROBO.vacuum],
    render: (el) => haushalt(el),
  };
})();
