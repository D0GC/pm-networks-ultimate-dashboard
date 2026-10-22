/* PM Panel Studio – Startbildschirm, Karussell, Modulleiste, Sheet-Navigation, Ereignis-Overlay. */
(function () {
  "use strict";
  const PS = window.PS, $ = (s, r = document) => r.querySelector(s);

  // ------------------------------------------------------------ Uhr und Wetter
  function uhr() {
    const d = new Date();
    $("#uhr").textContent = PS.uhrzeit(d);
    $("#datum").textContent = d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  }
  let vorhersage = [];
  async function vorhersageLaden() {
    const w = PS.opt.wetter_entitaet; if (!w || !PS.z[w]) return;
    try {
      const r = await PS.anfrage({ typ: "dienst", domain: "weather", service: "get_forecasts", data: { entity_id: w, type: "daily" }, antwort: true });
      vorhersage = ((r || {})[w] || {}).forecast || [];
    } catch { vorhersage = []; }
    wetter();
  }
  const REGEN_MENGE = "sensor.niederschlag_lokal";
  function wetter() {
    const w = PS.opt.wetter_entitaet, st = PS.z[w];
    const el = $("#wetter"); if (!st) { el.hidden = true; return; } el.hidden = false;
    const aussen = PS.opt.aussentemperatur && PS.z[PS.opt.aussentemperatur] ? PS.s(PS.opt.aussentemperatur) : st.a.temperature;
    const heute = vorhersage[0] || {};
    // Gemessene Regenmenge (Regenradar, wie im Lovelace-Dashboard) nur, solange es tatsächlich regnet
    const menge = Number(PS.s(REGEN_MENGE));
    const mm = PS.z[REGEN_MENGE] && isFinite(menge) && Math.round(menge * 10) > 0 ? ` · ${PS.zahl(menge, 1)} mm` : "";
    const regen = heute.precipitation_probability != null || mm ? ` · Regen${heute.precipitation_probability != null ? ` ${heute.precipitation_probability} %` : ""}${mm}` : "";
    // Symbol nur bei neuem Zustand austauschen: Ein Neuaufbau startet die Animation von vorn (sichtbarer Sprung)
    const text = `<b class="tabular">${PS.zahl(aussen, 1)}°</b><small>${PS.esc(PS.text(w))}${heute.temperature != null ? ` · ${PS.zahl(heute.templow, 0)}–${PS.zahl(heute.temperature, 0)}°` : ""}${regen}</small>`;
    if (el.dataset.z !== st.s || !el.querySelector(":scope > div")) {
      el.dataset.z = st.s;
      el.innerHTML = `${PS.wetterSvg ? PS.wetterSvg(st.s) : PS.ic(PS.wetterIcon(st.s))}<div>${text}</div>`;
    } else if (el._text !== text) el.querySelector(":scope > div").innerHTML = text;
    el._text = text;
    const tage = vorhersage.slice(1, 4);
    const schluessel = JSON.stringify(tage.map((t) => [t.datetime, t.condition, t.templow, t.temperature]));
    if ($("#vorschau")._schluessel === schluessel) return;
    $("#vorschau")._schluessel = schluessel;
    $("#vorschau").innerHTML = tage.map((t) => {
      const d = new Date(t.datetime);
      return `<div>${d.toLocaleDateString("de-DE", { weekday: "short" })}${PS.wetterSvg ? PS.wetterSvg(t.condition) : PS.ic(PS.wetterIcon(t.condition))}<span class="tabular">${PS.zahl(t.templow, 0)}–${PS.zahl(t.temperature, 0)}°</span></div>`;
    }).join("");
  }

  // ------------------------------------------------------------ Personen und Status
  function personen() {
    $("#personen").innerHTML = (PS.opt.personen || []).filter((p) => PS.z[p]).map((p) => {
      const st = PS.z[p], da = st.s === "home", n = PS.name(p).split(" ")[0];
      const bild = st.a.entity_picture ? ` style="background-image:url('${PS.esc(PS.bildUrl(st.a.entity_picture).replace(/&t=\d+/, ""))}')"` : "";
      const ort = da ? "" : st.s === "not_home" ? " · unterwegs" : ` · ${PS.esc(st.s)}`;
      return `<span class="person${da ? " da" : ""}"><span class="av"${bild}>${bild ? "" : PS.esc(n[0] || "?")}</span>${PS.esc(n)}${ort}</span>`;
    }).join("");
  }
  function offeneZugaenge() {
    return Object.keys(PS.z).filter((e) => {
      if (!e.startsWith("binary_sensor.") || !PS.sichtbar(e)) return false;
      const st = PS.z[e]; return st.s === "on" && ["door", "window", "opening", "garage_door"].includes(st.a.device_class);
    });
  }
  // Bekannte Haus-Modi: Text und Symbol der Statuspille (andere Entitäten zeigen Namen und Symbol aus HA)
  const STATUS_MODI = {
    "input_boolean.finn_ist_da": ["Finn ist da", "account-child"],
    "input_boolean.alles_stumm": ["Alles stumm", "volume-off"],
    "input_boolean.gina_lernt": ["Gina lernt", "book-open-variant"],
    "input_boolean.kohle_stumm": ["Kohle stumm", "bell-off"],
    "input_boolean.wohnung_ist_leer": ["Wohnung leer", "home-export-outline"],
  };
  function statusZeile() {
    const teile = [];
    const al = PS.opt.alarm_entitaet;
    if (al && PS.z[al]) {
      const s = PS.s(al), kl = s === "triggered" ? "krit" : s === "pending" || s === "arming" ? "warn" : s.startsWith("armed") ? "gut" : "";
      teile.push(`<span class="pille ${kl}" data-eid="${al}">${PS.icon(al)}${PS.esc(PS.text(al))}</span>`);
    }
    const offen = offeneZugaenge();
    if (offen.length) teile.push(`<span class="pille warn" data-modul="sicherheit">${PS.ic("door-open")}${offen.length} offen</span>`);
    const schloss = Object.keys(PS.z).filter((e) => e.startsWith("lock.") && PS.sichtbar(e) && PS.s(e) !== "locked" && !PS.nichtDa(e));
    if (schloss.length) teile.push(`<span class="pille warn" data-modul="sicherheit">${PS.ic("lock-open-variant")}${schloss.length === 1 ? PS.esc(PS.name(schloss[0])) : schloss.length + " Schlösser"} offen</span>`);
    for (const e of PS.einst.status_modi || []) {
      if (!PS.z[e] || PS.s(e) !== "on") continue;
      const m = STATUS_MODI[e];
      teile.push(`<span class="pille info" data-eid="${e}">${m ? PS.ic(m[1]) : PS.icon(e)}${PS.esc(m ? m[0] : PS.name(e))}</span>`);
    }
    $("#status").innerHTML = teile.join("");
    $("#status").querySelectorAll("[data-eid]").forEach((el) => el.addEventListener("click", () => PS.mehrInfos(el.dataset.eid)));
    $("#status").querySelectorAll("[data-modul]").forEach((el) => el.addEventListener("click", () => PS.oeffnen(el.dataset.modul)));
    glocke();
  }
  // Glocke oben rechts: nur echte Meldungen (Panel-Meldungen, Popups, HA-Benachrichtigungen), keine Hinweise
  function glocke() {
    const el = $("#glocke"); if (!el) return;
    const n = (PS.meldungen || []).length + (PS.popups || []).length;
    const stufen = (PS.popups || []).map(PS.meldungStufe);
    const hoch = stufen.includes("kritisch"), eilig = !hoch && stufen.includes("zeitkritisch");
    el.className = "glocke" + (n ? " neu" : "") + (hoch ? " hoch" : "") + (eilig ? " zeitkritisch" : "");
    el.innerHTML = PS.ic(hoch || eilig ? "bell-ring-outline" : n ? "bell-badge-outline" : "bell-outline") + (n ? `<span class="zahl tabular">${n}</span>` : "");
  }

  // ------------------------------------------------------------ Begrüßung unten links (höchstens zwei Sätze)
  // Ankunft (20 min nach dem Heimkommen), morgens 6–10 Uhr, nachts 0–1:30 Uhr mit kurzem Abschluss des Tages.
  const GRUSS = {
    ankunft: [
      "Willkommen zuhause, {n}.", "Willkommen daheim, {n}.", "Willkommen zurück, {n}.", "{g}, {n}. Willkommen zuhause.",
      "{g}, {n}. Schön, dass Sie wieder da sind.", "Willkommen zuhause, {n}. Die Wohnung ist bereit.", "Da sind Sie ja, {n}. Willkommen daheim.",
      "Willkommen zurück, {n}. Alles ist an seinem Platz.", "{g}, {n}. Willkommen daheim.", "Willkommen zuhause, {n}. Ich habe die Stellung gehalten.",
    ],
    morgen: [
      "Guten Morgen, {n}.", "Einen guten Morgen, {n}.", "Guten Morgen, {n}, ich hoffe, Sie haben gut geschlafen.", "Guten Morgen, {n}, die Systeme sind bereit.",
      "Guten Morgen, {n}, ein neuer Tag beginnt.", "Willkommen im neuen Tag, {n}.", "Guten Morgen, {n}, alles ist vorbereitet.",
      "Einen angenehmen Morgen, {n}.", "Guten Morgen, {n}, ich stehe zur Verfügung.", "Guten Morgen, {n}, Zeit für einen guten Start.",
    ],
    nacht: [
      "Gute Nacht, {n}.", "Angenehme Nachtruhe, {n}.", "Schlafen Sie gut, {n}.", "Gute Nacht, {n}, ich halte Wache.", "Eine erholsame Nacht, {n}.",
      "Gute Nacht, {n}, der Tag ist geschafft.", "Zeit zur Ruhe, {n}.", "Gute Nacht, {n}, ich kümmere mich um den Rest.", "Ruhen Sie sich aus, {n}.", "Gute Nacht, {n}, bis morgen.",
    ],
  };
  const vorname = (p) => PS.name(p).split(" ")[0];
  const anrede = (p) => (PS.einst.gruss_anrede || {})[p] || vorname(p);
  const streu = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const karte = (schl) => (PS.karten || []).find((k) => k.schluessel === schl);
  function grussFakt(anlass, wer, da) {
    if (anlass === "ankunft") {
      const andere = da.filter((p) => p !== wer);
      return andere.length ? `${andere.map(vorname).join(" und ")} ${andere.length > 1 ? "sind" : "ist"} bereits zuhause.` : "";
    }
    if (anlass === "morgen") {
      const t = karte("termin");
      if (t) return t.wert === "heute" ? `Heute steht an: ${t.hinweis}.` : `Ihr nächster Termin: ${t.hinweis}, ${t.wert}.`;
      const h = vorhersage[0];
      if (h && h.temperature != null) return `Heute ${PS.zahl(h.templow, 0)} bis ${PS.zahl(h.temperature, 0)} Grad${(h.precipitation_probability || 0) >= 50 ? ", Regen ist wahrscheinlich" : ""}.`;
      return "";
    }
    const offen = offeneZugaenge();
    if (offen.length) return `Noch offen: ${offen.slice(0, 2).map((e) => PS.name(e)).join(" und ")}${offen.length > 2 ? ` und ${offen.length - 2} weitere` : ""}.`;
    const m = karte("muell");
    if (m && m.wert === "morgen") return `Morgen früh wird abgeholt: ${m.hinweis}.`;
    const al = PS.opt.alarm_entitaet;
    if (al && PS.s(al) === "disarmed") return "Alle Türen und Fenster sind zu, die Alarmanlage ist noch nicht scharf.";
    return "Alle Türen und Fenster sind geschlossen.";
  }
  function gruss() {
    const el = $("#gruss"); if (!el) return;
    const da = (PS.opt.personen || []).filter((p) => PS.s(p) === "home");
    let text = "";
    if (PS.einst.gruss !== false && da.length) {
      const jetzt = new Date(), min = jetzt.getHours() * 60 + jetzt.getMinutes();
      const kam = da.map((p) => [p, Date.parse(PS.st(p).lc) || 0]).sort((x, y) => y[1] - x[1])[0];
      const chef = da.find((p) => (PS.einst.gruss_anrede || {})[p]) || da[0];
      let anlass = null, wer = chef, schluessel = "";
      if (Date.now() - kam[1] < 20 * 60e3) { anlass = "ankunft"; wer = kam[0]; schluessel = kam[0] + kam[1]; }
      else if (min >= 360 && min < 600) anlass = "morgen";
      else if (min < 90) anlass = "nacht";
      if (anlass) {
        const liste = GRUSS[anlass], g = min < 660 ? "Guten Morgen" : min < 1080 ? "Guten Tag" : "Guten Abend";
        const satz = liste[streu(anlass + schluessel + jetzt.toDateString()) % liste.length].replace("{n}", anrede(wer)).replace("{g}", g);
        // Höchstens zwei Sätze: der Zusatz nur, wenn die Begrüßung aus einem Satz besteht
        const zusatz = (satz.match(/\./g) || []).length < 2 ? grussFakt(anlass, wer, da) : "";
        text = zusatz ? `${satz} ${zusatz}` : satz;
      }
    }
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    el.classList.remove("an");
    setTimeout(() => { el.textContent = text; if (text) requestAnimationFrame(() => el.classList.add("an")); }, el.textContent ? 600 : 0);
  }

  // ------------------------------------------------------------ Karussell
  const KARTE = {
    eil: ["alert-decagram-outline", "var(--krit)"], warnung: ["alert-outline", "var(--warn)"], termin: ["calendar-clock-outline", "#c99bf0"],
    arbeit: ["car-clock", "var(--gut)"], wetter: ["weather-partly-cloudy", "var(--info)"], muell: ["trash-can-outline", "#d9a7ff"],
    fertig: ["check-circle-outline", "var(--gut)"], offen: ["door-open", "var(--warn)"], lueften: ["window-open-variant", "var(--warn)"],
    pollen: ["flower-pollen-outline", "#f6d36b"], eigen: ["information-outline", "var(--lavender)"], neutral: ["information-outline", "var(--lavender)"],
    dusche: ["shower-head", "var(--info)"], spa: ["hot-tub", "var(--akzent)"], kohle: ["fire", "#ff9a5c"], waesche: ["washing-machine", "var(--info)"],
    unwetter: ["alert-outline", "#f0964c"], wetterwechsel: ["weather-partly-cloudy", "var(--info)"], ok: ["shield-check-outline", "var(--gut)"],
    naechstes: ["calendar-arrow-right", "#c99bf0"],
    meldung: ["bell-ring-outline", "var(--warn)"], spueler: ["dishwasher", "var(--info)"], robo: ["robot-vacuum", "var(--gut)"], musik: ["music-note-outline", "#c99bf0"], ruhig: ["leaf", "var(--gut)"], heimweg: ["home-import-outline", "var(--gut)"],
    pakete: ["package-variant-closed", "#e3a35d"], verpasst: ["phone-missed", "var(--krit)"],
  };
  PS.kartenIcon = (k) => (KARTE[k] || KARTE.neutral)[0];
  let aktuell = 0, liste = [], wechselZeit = 0, wischt = false;
  // Relevanz 0–100 (Backend: Feld `relevanz`; Frontend-Karten setzen es selbst). Der Feed sortiert danach, stabil.
  const RELEVANZ_STANDARD = 40;
  const relevanz = (k) => (k && k.relevanz != null ? k.relevanz : RELEVANZ_STANDARD);
  const sortiert = (karten) => karten.map((k, i) => [k, i]).sort((a, b) => relevanz(b[0]) - relevanz(a[0]) || a[1] - b[1]).map((x) => x[0]);
  // Verweildauer dezent nach Relevanz: Basisdauer × 0,8 (unwichtig) bis 1,4 (dringend)
  const verweil = (k) => (PS.einst.verweildauer_s || 8) * (0.8 + 0.6 * Math.max(0, Math.min(100, relevanz(k))) / 100);
  const elemente = new Map();

  // ------------------------------------------------------------ Kartenmodell 1:1 nach dem Konzept
  // Jede Karte: Kopf mit Punkt, Ring mit Zahl und Einheit (oder Symbol), Überschrift, eine Textzeile.
  const zahlAus = (t) => { const m = String(t || "").match(/(-?\d+(?:[.,]\d+)?)/); return m ? Number(m[1].replace(",", ".")) : null; };
  function raumDerHinweise() {
    const e = PS.opt.hinweise_entitaet || "";
    return e.includes("bad") ? "Bad" : e.includes("buero") ? "Büro" : e.includes("flur") ? "Flur" : "";
  }
  // HA-Timer (Kohle, Duschmodus, Spa) zählen wie an den Panels Bad und Büro sekundengenau („12:34“); Geräte mit
  // geschätzter Restzeit (Waschmaschine, Spüler) bleiben bei Minuten
  const SEKUNDEN = ["kohle", "dusche", "spa"];
  function restText(sek, sekunden = false) {
    if (sek == null) return null;
    if (sekunden === "voll" && sek >= 3600) { const g = Math.ceil(sek); return { zahl: `${Math.floor(g / 3600)}:${String(Math.floor(g % 3600 / 60)).padStart(2, "0")}:${String(g % 60).padStart(2, "0")}`, einheit: "h" }; }
    if (sekunden && sek < 3600) { const g = Math.ceil(Math.max(0, sek)); return { zahl: `${Math.floor(g / 60)}:${String(g % 60).padStart(2, "0")}`, einheit: "min" }; }
    const min = Math.ceil(Math.max(0, sek) / 60);
    return min >= 60 ? { zahl: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`, einheit: "h" } : { zahl: String(min), einheit: "min" };
  }
  const sekModus = (k) => (k.schluessel === "terminuhr" ? "voll" : SEKUNDEN.includes(k.schluessel));
  const AKT_KOPF = { waesche: "Gerät läuft", spueler: "Gerät läuft", kohle: "Kohle", dusche: "Duschmodus", spa: "Spa", robo: "Roborock", musik: "Musik" };
  function modell(k) {
    let [icon, farbe] = KARTE[k.schluessel] || KARTE.neutral;
    const m = { kopf: k.titel || "Hinweis", farbe, anteil: 1, zahl: null, einheit: "", icon, h2: k.wert, p: k.hinweis };
    if (k.art === "aktivitaet" && k.schluessel === "heimweg") {
      // Ring = zurückgelegter Anteil der Strecke (bei 0 km voll), im Ring die verbleibenden Kilometer
      return { ...m, kopf: "Heimweg", h2: k.titel, anteil: k.ring, zahl: k.wert, einheit: "km",
        p: [k.hinweis, k.rest_min != null ? `noch etwa ${k.rest_min} min` : null].filter(Boolean).join(" · ") };
    }
    if (k.art === "aktivitaet") {
      m.kopf = AKT_KOPF[k.schluessel] || "Aktivität"; m.h2 = k.titel; m.anteil = k.ring;
      const sek = k.ende ? (new Date(k.ende).getTime() - Date.now()) / 1000 : null;
      const hm = String(k.wert).match(/^(\d+):(\d\d)( h)?$/);
      const r = sek != null ? restText(sek, SEKUNDEN.includes(k.schluessel)) : hm ? (hm[3] ? { zahl: `${hm[1]}:${hm[2]}`, einheit: "h" } : restText(Number(hm[1]) * 60 + Number(hm[2]))) : null;
      const pct = /%/.test(k.wert) ? zahlAus(k.wert) : null;
      if (r) { m.zahl = r.zahl; m.einheit = r.einheit; } else if (pct != null) { m.zahl = String(pct); m.einheit = "%"; } else if (k.wert && k.wert !== "–") { m.zahl = k.wert; m.einheit = ""; }
      // Fertigzeit wie im Konzept („Waschen 35 % · fertig gegen 17:24“), aus Ende oder Restzeit
      const restMin = sek != null ? sek / 60 : hm ? (hm[3] ? Number(hm[1]) * 60 + Number(hm[2]) : Number(hm[1]) + Number(hm[2]) / 60) : null;
      const fertig = restMin != null && restMin > 0 ? `fertig gegen ${PS.uhrzeit(new Date(Date.now() + restMin * 60e3))}` : null;
      m.p = k.unter || [k.ende ? null : k.hinweis, fertig].filter(Boolean).join(" · ");
      if (k.schluessel === "musik" && m.zahl === "♪") { m.zahl = null; }
      return m;
    }
    if (k.art === "warnung") {
      // Amtliche Warnung des DWD: Stufe 1 gelb, 2 orange, 3 rot, 4 violett; Ring = Stufe von 4, im Ring das
      // animierte Warnsymbol (Blitz, Wind, Regen …)
      const stufe = Math.max(1, Math.min(4, Number(k.stufe) || 1));
      const bis = k.bis ? new Date(k.bis) : null;
      const heute = bis && bis.toDateString() === new Date().toDateString();
      const bisText = bis && !isNaN(bis) ? `bis ${heute ? "" : bis.toLocaleDateString("de-DE", { weekday: "short" }) + " "}${bis.getHours()} Uhr` : "";
      return { ...m, kopf: `${k.vorab ? "Vorabinformation" : WARN_NAME[stufe]} · DWD`, farbe: WARN_FARBE[stufe], anteil: stufe / 4,
        svg: PS.warnSvg ? PS.warnSvg(PS.warnTyp(k.titel), "warn-ring") : null, icon: "alert-outline", einheit: `Stufe ${stufe} von 4`,
        h2: k.titel, p: [bisText, k.hinweis && k.hinweis !== k.titel ? k.hinweis : ""].filter(Boolean).join(" · "), glut: stufe >= 3 && !k.vorab };
    }
    if (k.art === "sport") return PS.sportModell(k, m);
    if (k.art === "pakete") return PS.paketeModell(k, m);
    if (k.art === "praktisch") return { ...m, ...k.modell };
    if (k.art === "meldung") {
      const stufe = PS.meldungStufe(k);
      return { ...m, kopf: stufe === "aktiv" ? "Meldung" : `Meldung · ${stufe}`, farbe: PS.meldungFarbe(k), icon: PS.meldungIcon(k.icon), h2: k.titel, p: k.hinweis };
    }
    switch (k.schluessel) {
      case "lueften": {
        const f = /%/.test(`${k.wert}${k.hinweis}`) ? zahlAus(/%/.test(k.wert) ? k.wert : k.hinweis) : null;
        if (f == null) break;
        const raum = raumDerHinweise();
        const rat = /fenster öffnen|empf/i.test(`${k.hinweis} ${k.wert}`) ? "Fenster 10 Minuten öffnen" : "";
        return { ...m, kopf: "Lüften", anteil: f / 100, zahl: String(f), einheit: "% rF", h2: raum ? `${raum} lüften` : "Lüften empfohlen", p: `Luftfeuchte ${f} %${rat ? " · " + rat : ""}` };
      }
      case "muell": {
        const ziel = new Date(); ziel.setHours(6, 0, 0, 0);
        if (/morgen/i.test(k.wert)) ziel.setDate(ziel.getDate() + 1);
        const std = (ziel - Date.now()) / 3600e3;
        const morgen = /morgen/i.test(k.wert);
        return { ...m, kopf: "Müll", h2: k.hinweis || "Müllabfuhr", p: morgen ? "Morgen früh · bitte heute Abend rausstellen" : "Heute · Abholung",
          ...(std > 0 ? { zahl: String(Math.ceil(std)), einheit: "h bis", anteil: Math.min(1, std / 24) } : {}) };
      }
      case "termin": {
        const min = /in\s+\d+/i.test(k.wert) ? zahlAus(k.wert) : /jetzt/i.test(k.wert) ? 0 : null;
        return { ...m, kopf: "Termin", h2: k.hinweis || "Termin", p: min == null ? "heute, ganztägig" : min ? `in ${min} Minuten` : "jetzt",
          ...(min != null ? { zahl: String(min), einheit: "min bis", anteil: Math.max(0.02, 1 - min / 60) } : {}) };
      }
      case "arbeit": {
        const min = zahlAus(k.wert);
        return { ...m, kopf: "Fahrt", h2: k.titel || "Fahrt", p: k.hinweis || "im Verkehr", ...(min != null ? { zahl: String(min), einheit: "min", anteil: Math.min(1, min / 60) } : {}) };
      }
      case "wetter": {
        const regen = /% Regen/i.test(k.hinweis) ? zahlAus(k.hinweis) : null;
        if (regen != null) return { ...m, kopf: "Wetter", zahl: String(regen), einheit: "% Regen", anteil: regen / 100, h2: regen >= 50 ? "Regen erwartet" : "Regen möglich", p: k.wert };
        const temps = String(k.wert).match(/-?\d+/g) || [];
        const hoch = temps.length ? Number(temps[temps.length - 1]) : null;
        const zustand = k.hinweis ? k.hinweis.charAt(0).toUpperCase() + k.hinweis.slice(1) : "Wetter";
        return { ...m, kopf: "Wetter", h2: zustand, p: k.wert, ...(hoch != null ? { zahl: `${hoch}°`, einheit: "max", anteil: Math.max(0.05, Math.min(1, (hoch + 10) / 45)) } : {}) };
      }
      case "offen": {
        const liste = /^\d+\s+offen/i.test(k.wert);
        const n = liste ? zahlAus(k.wert) : 1;
        return { ...m, kopf: "Offen", zahl: String(n || 1), einheit: "offen", h2: liste ? k.hinweis : k.wert, p: n > 1 ? "Fenster und Türen prüfen" : "steht offen" };
      }
      case "fertig": return { ...m, kopf: "Fertig", h2: `${k.wert} fertig`, p: k.hinweis };
      case "pollen": {
        // Skala des Österreichischen Pollenwarndienstes (polleninformation_zuhause_*): 0 keine … 4 sehr hoch
        const stufe = { keine: 0, "keine belastung": 0, gering: 1, "mäßig": 2, hoch: 3, "sehr hoch": 4 }[String(k.wert).toLowerCase()];
        const farbe = stufe >= 3 ? "var(--krit)" : stufe === 2 ? "var(--warn)" : m.farbe;
        return { ...m, kopf: "Pollen", farbe, h2: `Pollen ${k.wert}`, p: k.hinweis,
          ...(stufe != null ? { zahl: String(stufe), einheit: "von 4", anteil: Math.max(0.02, stufe / 4) } : {}) };
      }
      case "eil": return { ...m, kopf: `Eilmeldung · ${k.titel}`, h2: k.hinweis, p: "Antippen zum Lesen" };
      case "ruhig": return { ...m, kopf: "Hinweise", h2: "Alles ruhig", p: k.hinweis };
    }
    return m;
  }
  const WARN_FARBE = { 1: "#f0d34c", 2: "#f0964c", 3: "#ef6a7a", 4: "#b05bd6" };
  const WARN_NAME = { 1: "Wetterwarnung", 2: "Markante Warnung", 3: "Unwetterwarnung", 4: "Extreme Unwetterwarnung" };
  function ringAnteil(k) { return modell(k).anteil; }
  PS.ringAnteil = ringAnteil;
  PS.kartenModell = modell;  // auch für die Hinweisliste der Admin-Ansicht
  // Detail einer Feed-Karte zeigen; false, wenn die Karte keines hat
  PS.karteOeffnen = (kk) => {
    if (kk && kk.art === "meldung") PS.popupZeigen(kk.id);
    else if (kk && kk.schluessel === "eil") PS.eilZeigen(kk);
    else if (kk && kk.art === "sport") PS.sportZeigen(kk);
    else if (kk && kk.art === "pakete") PS.paketeZeigen(kk);
    else return false;
    return true;
  };
  // Kurze Terminliste im p-Platz der Karte (Uhrzeit fett, Titel einzeilig gekürzt)
  const listeHTML = (zeilen, klasse = "") => `<p class="liste${klasse ? " " + klasse : ""}">${zeilen.map((z) => `<span><b>${PS.esc(z[0])}</b>${PS.esc(z[1])}</span>`).join("")}</p>`;
  function karteInhalt(k) {
    const m = modell(k);
    const laeuft = !!k.ende;
    let innen;
    if (m.innen) innen = m.innen;
    else if (m.svg) innen = `${m.svg}<small class="einheit">${PS.esc(m.einheit)}</small>`;
    else if (m.zahl != null) innen = `<b class="wert-txt tabular" data-text="${PS.esc(m.zahl)}"></b><small class="einheit">${PS.esc(m.einheit)}</small>`;
    else innen = PS.ic(m.icon);
    return { farbe: m.farbe, glut: !!m.glut, html: `<div class="kopf"><i class="punkt"></i><span>${PS.esc(m.kopf)}</span>${m.badge ? `<em class="sport-badge${m.badge.live ? " puls" : ""}" style="--badge:${PS.esc(m.badge.farbe)}">${PS.esc(m.badge.text)}</em>` : ""}</div><div class="ring${laeuft ? " laeuft glimmt" : ""}${m.ringKlasse ? " " + m.ringKlasse : ""}">${PS.ringSVG(m.anteil)}<div class="innen">${innen}</div></div><h2>${PS.esc(m.h2 || "")}</h2>${m.liste ? listeHTML(m.liste, m.listeKlasse) : `<p>${PS.esc(m.p || "")}</p>`}${m.aktionen ? aktionenHTML(m.aktionen) : ""}` };
  }
  // Knöpfe auf einer Karte (z. B. „Verpasster Anruf“): { akt, text, icon, klasse, daten }; Klicks fängt kartenSetzen ab
  const aktionenHTML = (a) => `<div class="aktionen">${a.map((x) => `<button type="button" class="knopf ${x.klasse || ""}" data-akt="${PS.esc(x.akt)}"${x.daten ? ` data-nummer="${PS.esc(x.daten)}"` : ""}>${x.icon ? PS.ic(x.icon) : ""}${PS.esc(x.text)}</button>`).join("")}</div>`;
  // Zahl im Ring rollt wie ein Zählwerk auf den Wert (Konzept Stufe 1); bei jedem Zeigen aus dem Leeren
  function walzeStarten(el, neu) {
    const b = el && el.querySelector(".wert-txt[data-text]"); if (!b) return;
    if (neu) { b._walze = null; b.textContent = ""; }
    PS.walze(b, b.dataset.text);
  }
  function kartenSetzen(karten) {
    const alt = liste[aktuell] && liste[aktuell].id;
    liste = karten || [];
    PS.feedListe = liste;  // für die Live-Kapsel (auch Termin-Countdowns aus dem Frontend)
    $(".mitte").classList.toggle("leer", !liste.length);
    const box = $("#karussell");
    const ids = new Set(liste.map((k) => k.id));
    for (const [id, el] of elemente) if (!ids.has(id)) { el.remove(); elemente.delete(id); }
    for (const k of liste) {
      let el = elemente.get(k.id);
      const inhalt = karteInhalt(k);
      if (!el) {
        el = document.createElement("div"); el.className = "karte"; el.dataset.id = k.id;
        el.addEventListener("click", (ev) => {
          const b = ev.target.closest && ev.target.closest(".aktionen [data-akt]");
          if (b) { ev.stopPropagation(); kartenAktion(b.dataset.akt, el._karte); return; }
          if (!PS.karteOeffnen(el._karte)) weiter();
        });
        box.appendChild(el); elemente.set(k.id, el);
        el.innerHTML = inhalt.html;
        walzeStarten(el, true);
      } else if (el._html !== inhalt.html) {
        // Teile tauschen, den Ring aber behalten, damit er weich zum neuen Wert gleitet; Zahlen rollen
        const neu = document.createElement("div"); neu.innerHTML = inhalt.html;
        el.querySelector(".kopf").replaceWith(neu.querySelector(".kopf"));
        const altB = el.querySelector(".ring .innen .wert-txt[data-text]"), neuB = neu.querySelector(".ring .innen .wert-txt[data-text]");
        if (altB && neuB) {
          altB.dataset.text = neuB.dataset.text; PS.walze(altB, neuB.dataset.text);
          el.querySelector(".ring .innen .einheit").textContent = neu.querySelector(".ring .innen .einheit").textContent;
        } else {
          // Gleiches animiertes Symbol (Wetter, Warnung) behalten, sonst springt seine Animation an den Anfang
          const altWi = el.querySelector(".ring .innen .wi"), neuWi = neu.querySelector(".ring .innen .wi");
          if (altWi && neuWi && altWi.dataset.z === neuWi.dataset.z) neuWi.replaceWith(altWi);
          el.querySelector(".ring .innen").replaceWith(neu.querySelector(".ring .innen"));
        }
        el.querySelector(".ring").className = neu.querySelector(".ring").className;
        el.querySelector("h2").replaceWith(neu.querySelector("h2"));
        el.querySelector("p").replaceWith(neu.querySelector("p"));
        const altA = el.querySelector(".aktionen"), neuA = neu.querySelector(".aktionen");
        if (altA && neuA) altA.replaceWith(neuA); else if (altA) altA.remove(); else if (neuA) el.appendChild(neuA);
        PS.ringSetzen(el.querySelector(".ring svg"), ringAnteil(k));
      }
      el._html = inhalt.html; el._karte = k;
      el.style.setProperty("--farbe", inhalt.farbe);
      el.classList.toggle("eil", k.schluessel === "eil");
      el.classList.toggle("verpasst", k.schluessel === "verpasst");
      el.classList.toggle("glut", inhalt.glut);
    }
    const pos = liste.findIndex((k) => k.id === alt);
    aktuell = pos >= 0 ? pos : Math.min(aktuell, liste.length - 1);
    zeigen(!wechselZeit && liste.length > 0);  // erste Karte: Verweilzeit und Ring starten, sonst springt sie nach 1 s weiter
  }
  function zeigen(neuStart = true) {
    liste.forEach((k, i) => {
      const el = elemente.get(k.id); if (!el) return;
      if (i === aktuell) { el.classList.remove("weg"); el.classList.add("an"); }
      else if (el.classList.contains("an")) { el.classList.remove("an"); el.classList.add("weg"); setTimeout(() => el.classList.remove("weg"), 950); }
    });
    if (neuStart) {
      wechselZeit = Date.now();
      const k = liste[aktuell]; const el = k && elemente.get(k.id);
      if (el) {
        const svg = el.querySelector(".ring svg"); PS.ringSetzen(svg, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => PS.ringSetzen(svg, ringAnteil(k))));
        walzeStarten(el, true);
      }
    }
    const pk = $("#punkte");
    pk.style.setProperty("--verweil", verweil(liste[aktuell]).toFixed(2) + "s");
    pk.innerHTML = liste.length > 1 ? liste.map((_, i) => `<span class="${i < aktuell ? "vorbei" : i === aktuell ? "jetzt" : ""}"></span>`).join("") : "";
  }
  function weiter() { if (liste.length < 2) return; aktuell = (aktuell + 1) % liste.length; zeigen(); }
  function vorher() { if (liste.length < 2) return; aktuell = (aktuell - 1 + liste.length) % liste.length; zeigen(); }
  function takt() {
    if (liste.length > 1 && !wischt && Date.now() - wechselZeit > verweil(liste[aktuell]) * 1000 && !document.body.classList.contains("offen") && !$("#dialog-grund").classList.contains("offen")) weiter();
    // Restzeiten lokal herunterzählen
    for (const k of liste) {
      if (!k.ende) continue;
      const el = elemente.get(k.id); if (!el) continue;
      const rest = Math.max(0, (new Date(k.ende).getTime() - Date.now()) / 1000);
      const t = el.querySelector(".wert-txt"), r = restText(rest, sekModus(k));
      // Restzeit rollt wie ein Zählwerk herunter (nur die sichtbare Karte, die anderen werden beim Zeigen gefüllt)
      if (t && r) { t.dataset.text = r.zahl; if (el.classList.contains("an")) PS.walze(t, r.zahl); const e = el.querySelector(".einheit"); if (e) e.textContent = r.einheit; }
      if (k.dauer_s) PS.ringSetzen(el.querySelector(".ring svg"), rest / k.dauer_s);
      if (rest <= 0 && k.schluessel === "terminuhr") feedAufbauen();  // Termin beginnt: Karte verschwindet
    }
  }


  // ------------------------------------------------------------ Feed: was gerade zählt
  // Das Wetter steht links; der Feed zeigt es nur kurz vor einem Wetterwechsel (nächste 3 Stunden). Ohne Hinweise
  // bleibt der Feed im Ruhezustand leer; wach zeigt er, was gerade praktisch ist.
  let stuendlich = [], termine = [];
  async function stuendlichLaden() {
    const w = PS.opt.wetter_entitaet; if (!w || !PS.z[w]) return;
    try {
      const r = await PS.anfrage({ typ: "dienst", domain: "weather", service: "get_forecasts", data: { entity_id: w, type: "hourly" }, antwort: true });
      stuendlich = ((r || {})[w] || {}).forecast || [];
    } catch { stuendlich = []; }
    feedAufbauen();
  }
  // Termine ab heute 0 Uhr bis Ende von morgen (mind. 36 h), aus allen sichtbaren Kalendern; ganztägige tragen `ganztag`.
  // Einträge der Stundenplan-Kalender (Einstellung `stundenplan_kalender`) tragen `plan` und den Kalendernamen als `kalender`.
  const tagText = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  async function termineLaden() {
    const kals = Object.keys(PS.z).filter(PS.feedKalender);
    const jetzt = new Date(), morgenEnde = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 2);
    const plaene = new Set(PS.einst.stundenplan_kalender || []);
    const start = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()), ende = new Date(Math.max(morgenEnde.getTime(), Date.now() + 36 * 3600e3)), alle = [];
    await Promise.all(kals.map(async (k) => {
      try {
        const r = await PS.anfrage({ typ: "rest", pfad: `calendars/${k}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(ende.toISOString())}` });
        (r || []).forEach((t) => {
          if (!t.start) return;
          const ort = t.location || "", plan = plaene.has(k) ? { plan: true, kalender: PS.a(k).friendly_name || "" } : {};
          if (t.start.dateTime) alle.push({ titel: t.summary, start: new Date(t.start.dateTime), ende: t.end && t.end.dateTime ? new Date(t.end.dateTime) : null, ort, ...plan });
          else if (t.start.date) alle.push({ titel: t.summary, ganztag: true, von: t.start.date, bis: (t.end && t.end.date) || t.start.date, start: new Date(`${t.start.date}T00:00:00`), ort, ...plan });
        });
      } catch { /* einzelne Kalender dürfen fehlen */ }
    }));
    termine = alle.sort((a, b) => a.start - b.start);
    feedAufbauen();
  }
  const NASS = ["rainy", "pouring", "lightning-rainy", "snowy", "snowy-rainy", "hail"];
  const nass = (f) => NASS.includes(f.condition) || f.condition === "lightning" || (f.precipitation_probability || 0) >= 60;
  function wetterwechsel() {
    const jetzt = Date.now(), w = PS.opt.wetter_entitaet;
    const naechste = stuendlich.filter((f) => { const t = Date.parse(f.datetime); return t > jetzt - 30 * 60e3 && t <= jetzt + 3 * 3600e3; });
    if (naechste.length < 2) return null;
    const nun = { condition: PS.s(w), precipitation_probability: (naechste[0] || {}).precipitation_probability };
    const art = (f) => (/lightning/.test(f.condition) ? "Gewitter" : /snow/.test(f.condition) ? "Schnee" : f.condition === "hail" ? "Hagel" : "Regen");
    const uhr = (f) => `${new Date(f.datetime).getHours()} Uhr`;
    const karte = (h2, p, prozent, zustand) => ({ id: "ww", art: "praktisch", schluessel: "wetterwechsel", titel: "Wetterwechsel", wert: "", hinweis: "",
      relevanz: 45,
      modell: { kopf: "Wetterwechsel", farbe: "var(--info)", h2, p, zahl: String(prozent), einheit: "% Regen", anteil: Math.max(0.02, prozent / 100), zustand } });
    if (!nass(nun)) {
      const f = naechste.slice(1).find(nass);
      if (f) return karte(`${art(f)} ab ${uhr(f)}`, `Wahrscheinlichkeit ${f.precipitation_probability ?? "–"} % · dann ${PS.zahl(f.temperature, 0)}°`, f.precipitation_probability || 60, f.condition);
    } else {
      const f = naechste.slice(1).find((x) => !nass(x) && (x.precipitation_probability || 0) < 30);
      if (f) return karte(`${art(nun)} hört gegen ${uhr(f)} auf`, `danach ${PS.text(w, f.condition)} · ${PS.zahl(f.temperature, 0)}°`, f.precipitation_probability || 0, f.condition);
    }
    return null;
  }
  // Praktische Karten: „Alles in Ordnung“, wenn sonst nichts läuft (wach und in Ruhe), und Termine
  // (ab 3 h vor Beginn mit Countdown; ab 20 Uhr morgige Termine, bis 1 Uhr die des gerade begonnenen Tages;
  // morgens der Stundenplan) immer zusätzlich zu den übrigen Karten.
  function okKarte() {
    const offen = offeneZugaenge().length, al = PS.opt.alarm_entitaet;
    const teile = [offen ? `${offen} offen` : "Fenster und Türen zu"];
    if (al && PS.z[al]) teile.push(PS.s(al).startsWith("armed") ? "Alarm scharf" : "Alarm aus");
    teile.push("keine Geräte aktiv");
    return { id: "ok", art: "praktisch", schluessel: "ok", titel: "Zuhause", wert: "", hinweis: "", relevanz: 10,
      modell: { kopf: "Zuhause", farbe: "var(--gut)", icon: "shield-check-outline", anteil: 1, h2: "Alles in Ordnung", p: teile.join(" · ") } };
  }
  // Termine mit Uhrzeit, die in den nächsten 3 Stunden beginnen: je Termin eine Karte mit Countdown im Ring
  // (läuft leer; `ende` und `dauer_s` wie bei den Gerätetimern, `takt()` zählt sekündlich herunter)
  const VORLAUF_S = 3 * 3600;
  function terminKarten() {
    const jetzt = Date.now();
    return termine.filter((t) => !t.plan && !t.ganztag && t.start > jetzt && (t.start - jetzt) / 1000 <= VORLAUF_S).map((t) => {
      const rest = (t.start - jetzt) / 1000, r = restText(rest, "voll");
      return { id: `termin:${t.start.getTime()}:${t.titel}`, art: "praktisch", schluessel: "terminuhr", titel: "Als Nächstes", wert: "", hinweis: "",
        ende: t.start.toISOString(), dauer_s: VORLAUF_S, relevanz: Math.round(60 + 35 * (1 - Math.max(0, Math.min(1, rest / VORLAUF_S)))),  // 60 bei 3 h Vorlauf, 95 bei Beginn
        modell: { kopf: "Als Nächstes", farbe: "#c99bf0", h2: t.titel || "Termin", p: `heute um ${PS.uhrzeit(t.start)}${t.ort ? " · " + t.ort : ""}`,
          zahl: r.zahl, einheit: r.einheit, anteil: Math.max(0.02, rest / VORLAUF_S) } };
    });
  }
  // Abendkarte ab 20 Uhr bis 1 Uhr: Termine von morgen (nur wenn es welche gibt). Nach Mitternacht ist „morgen“ aus Sicht
  // des Abends schon heute: dann die Termine des gerade begonnenen Tages, Titel „Heute“. Stundenplan-Einträge fehlen hier.
  const MAX_LISTE = 5;
  const zeilenListe = (tag) => {
    const zeilen = tag.slice(0, MAX_LISTE).map((t) => [t.ganztag ? "ganztägig" : PS.uhrzeit(t.start), (t.titel || "Termin") + (t.plan && t.ort ? ` · ${t.ort}` : "")]);
    if (tag.length > MAX_LISTE) zeilen.push(["", `+${tag.length - MAX_LISTE} weitere`]);
    return zeilen;
  };
  const amTag = (tText) => (t) => (t.ganztag ? t.von <= tText && tText < t.bis : tagText(t.start) === tText);
  const ganztagZuerst = (a, b) => (b.ganztag ? 1 : 0) - (a.ganztag ? 1 : 0) || a.start - b.start;
  function morgenKarte() {
    const jetzt = new Date(), h = jetzt.getHours();
    if (h >= 1 && h < 20) return null;
    const nachMitternacht = h < 1;
    const m = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + (nachMitternacht ? 0 : 1));
    const tag = termine.filter((t) => !t.plan).filter(amTag(tagText(m))).sort(ganztagZuerst);
    if (!tag.length) return null;
    const kopf = nachMitternacht ? "Heute" : "Morgen";
    return { id: "morgen", art: "praktisch", schluessel: "morgen", titel: kopf, wert: "", hinweis: "", relevanz: 50,
      modell: { kopf, farbe: "#c99bf0", icon: "calendar", anteil: 1, zahl: String(tag.length), einheit: tag.length === 1 ? "Termin" : "Termine",
        h2: m.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }), liste: zeilenListe(tag) } };
  }
  // Stundenplan (Gina): täglich von 5:30 bis 9:00 Uhr die heutigen Einträge der Stundenplan-Kalender, nur wenn es welche gibt
  function stundenplanKarte() {
    const jetzt = new Date(), min = jetzt.getHours() * 60 + jetzt.getMinutes();
    if (min < 5 * 60 + 30 || min >= 9 * 60) return null;
    const tag = termine.filter((t) => t.plan).filter(amTag(tagText(jetzt))).sort(ganztagZuerst);
    if (!tag.length) return null;
    const namen = [...new Set(tag.map((t) => t.kalender).filter(Boolean))];
    const kopf = namen.length === 1 ? namen[0] : "Stundenplan";
    return { id: "stundenplan", art: "praktisch", schluessel: "stundenplan", titel: kopf, wert: "", hinweis: "", relevanz: 55,
      modell: { kopf, farbe: "#c99bf0", icon: "school-outline", anteil: 1, zahl: String(tag.length), einheit: tag.length === 1 ? "Eintrag" : "Einträge",
        h2: jetzt.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }), liste: zeilenListe(tag) } };
  }
  // Verpasste Anrufe (Telefon aktiv): je Nummer eine Karte, Ring läuft über 2 Stunden seit dem letzten Anruf leer.
  // Relevanz 80 in den ersten 2 Stunden, danach 50; der Server räumt die Einträge um Mitternacht ab.
  const VERPASST_S = 2 * 3600;
  const vorZeit = (min) => {
    if (min < 1) return "gerade eben";
    if (min < 60) return `vor ${min} ${min === 1 ? "Minute" : "Minuten"}`;
    const h = Math.floor(min / 60);
    return `vor ${h} ${h === 1 ? "Stunde" : "Stunden"}`;
  };
  function verpasstKarten() {
    const t = PS.telefon || {};
    if (!t.aktiv || (PS.einst.karten_aus || []).includes("verpasst")) return [];
    const jetzt = Date.now();
    return (t.verpasst || []).map((v) => {
      const seit = Date.parse(v.zuletzt), alter = isFinite(seit) ? Math.max(0, (jetzt - seit) / 1000) : VERPASST_S;
      const uhr = isFinite(seit) ? PS.uhrzeit(new Date(seit)) : "";
      const av = PS.telefonAvatar ? PS.telefonAvatar(v.name, v.nummer, "mittel") : PS.ic("account");
      const n = Number(v.anzahl) || 1;
      return { id: `verpasst:${v.nummer}`, art: "praktisch", schluessel: "verpasst", titel: "Verpasster Anruf", wert: "", hinweis: "",
        relevanz: alter < VERPASST_S ? 80 : 50,
        modell: { kopf: "Verpasster Anruf", farbe: "var(--krit)", anteil: Math.max(0.02, 1 - alter / VERPASST_S), h2: v.name || v.nummer || "Unbekannt",
          p: `zuletzt ${uhr} · ${vorZeit(Math.floor(alter / 60))}`,
          innen: `<span class="v-av">${av}<i class="v-badge">${PS.ic("phone-missed")}</i></span><b class="tabular">${n}×</b><small class="einheit">heute</small>`,
          aktionen: [...(v.nummer ? [{ akt: "zurueckrufen", text: "Zurückrufen", icon: "phone", klasse: "gut", daten: v.nummer }] : []), { akt: "erledigt", text: "Erledigt", daten: v.nummer }] } };
    });
  }
  function kartenAktion(akt, k) {
    if (!k || k.schluessel !== "verpasst") return;
    const v = ((PS.telefon || {}).verpasst || []).find((x) => `verpasst:${x.nummer}` === k.id);
    if (!v) return;
    if (akt === "zurueckrufen" && PS.telefonWaehlen) PS.telefonWaehlen(v.nummer, v.name);
    else if (akt === "erledigt" && PS.telefonVerpasstErledigt) PS.telefonVerpasstErledigt(v.nummer);
  }
  let verpasstSig = "";
  PS.on("telefon", (t) => {
    const sig = JSON.stringify([t && t.aktiv, t && t.verpasst]);
    if (sig !== verpasstSig) { verpasstSig = sig; feedAufbauen(); }
  });
  function feedAufbauen() {
    let k = (PS.karten || []).filter((x) => x.schluessel !== "wetter");
    // Kein „Wetterwechsel“, wenn der DWD dieselbe Lage schon als Warnung meldet (Gewitter, Regen, Schnee)
    const gewarnt = k.some((x) => x.art === "warnung" && ["gewitter", "regen", "schnee"].includes(x.familie));
    const ww = (PS.einst.karten_aus || []).includes("wetter") || gewarnt ? null : wetterwechsel(); if (ww) k.push(ww);
    if (!k.length) k.push(okKarte());
    k.push(...verpasstKarten());
    if (!(PS.einst.karten_aus || []).includes("termin")) { k.push(...terminKarten()); const mk = morgenKarte(); if (mk) k.push(mk); }
    if (!(PS.einst.karten_aus || []).includes("stundenplan")) { const sk = stundenplanKarte(); if (sk) k.push(sk); }
    kartenSetzen(sortiert(k));
  }

  // Kachel wird Seite (Konzept Stufe 3): View Transitions, ohne Unterstützung einfach öffnen.
  // Die Quelle wird gemerkt: Beim Schließen läuft der Übergang umgekehrt, der Sheet-Titel schrumpft in die Quelle zurück.
  let rueck = null;  // { quelle, tiefe (Seitenstapel beim Öffnen), intern (Quelle liegt im Sheet), klasse, key }
  const animiert = () => !!document.startViewTransition && !document.body.classList.contains("ohne-animation");
  PS.mitUebergang = (quelle, fn) => {
    // Beschreibung vor dem Öffnen: danach ist die Quelle bei einem Neuaufbau des Sheets nicht mehr im DOM
    const bild = quelle ? { quelle, intern: !!quelle.closest(".sheet"), klasse: quelle.classList[0] || "", key: (quelle.textContent || "").trim().slice(0, 12) } : null;
    const merken = () => { rueck = bild && { ...bild, tiefe: stapel.length }; };
    if (!animiert() || !quelle) { fn(); merken(); return; }
    quelle.style.viewTransitionName = "raum-kopf";
    const vt = document.startViewTransition(() => {
      quelle.style.viewTransitionName = "";
      fn(); merken();
      $("#sheet-titel").style.viewTransitionName = "raum-kopf";
    });
    vt.finished.finally(() => { $("#sheet-titel").style.viewTransitionName = ""; });
  };
  // Rückweg: Titel vor dem Wechsel benennen, danach die Quelle (bei Neuaufbau des Sheets über Klasse und Textanfang gefunden)
  function rueckUebergang(r, aendern) {
    const titel = $("#sheet-titel");
    titel.style.viewTransitionName = "raum-kopf";
    let ziel = null;
    const vt = document.startViewTransition(() => {
      titel.style.viewTransitionName = "";
      aendern();
      ziel = r.quelle.isConnected ? r.quelle : r.intern ? [...$("#sheet-inhalt").querySelectorAll(r.klasse ? "." + r.klasse : "*")].find((e) => (e.textContent || "").trim().startsWith(r.key)) : null;
      if (ziel) ziel.style.viewTransitionName = "raum-kopf";
    });
    vt.finished.finally(() => { titel.style.viewTransitionName = ""; if (ziel) ziel.style.viewTransitionName = ""; });
  }

  // ------------------------------------------------------------ Schnellzugriff und Räume
  function schnellzugriff() {
    const box = $("#kacheln");
    const ids = (PS.einst.schnellzugriff || []).filter((e) => PS.z[e]).slice(0, 6);
    box.innerHTML = ids.map((e, i) => PS.kachelHTML(e, { i })).join("");
    PS.kachelnBinden(box);
  }
  PS.raumWerte = (bereich) => {
    const ent = Object.keys(PS.reg).filter((e) => PS.reg[e].b === bereich && PS.z[e] && PS.sichtbar(e));
    const sensor = (dc) => ent.find((e) => e.startsWith("sensor.") && PS.a(e).device_class === dc && !PS.nichtDa(e));
    const klima = ent.find((e) => e.startsWith("climate.") && !PS.nichtDa(e));
    let temp = sensor("temperature") ? PS.s(sensor("temperature")) : klima ? PS.a(klima).current_temperature : null;
    if (klima && PS.a(klima).current_temperature != null) temp = PS.a(klima).current_temperature;
    const feuchte = sensor("humidity") ? PS.s(sensor("humidity")) : klima ? PS.a(klima).current_humidity : null;
    const lichter = PS.lichtAuswahl(ent, PS.bereichName(bereich)).sichtbar;
    return { ent, temp, feuchte, klima, lichterAn: lichter.filter((e) => PS.s(e) === "on").length, lichter: lichter.length };
  };
  function raeumeKurz() {
    const box = $("#raeume-kurz");
    const ids = (PS.einst.start_raeume || []).filter((b) => PS.bereiche.some((x) => x.id === b));
    box.innerHTML = ids.map((b) => {
      const w = PS.raumWerte(b);
      const stueck = {
        temp: w.temp != null ? `${PS.zahl(w.temp, 1)}°` : "",
        feuchte: w.feuchte != null ? `${PS.zahl(w.feuchte, 0)} %` : "",
        licht: w.lichterAn ? `${w.lichterAn} Licht${w.lichterAn > 1 ? "er" : ""}` : "Licht aus",
      };
      const teile = PS.raumkarte().map((t) => stueck[t]).filter(Boolean);
      return `<div data-b="${PS.esc(b)}"><span>${PS.esc(PS.bereichName(b))}</span><span>${teile.join(" · ")}</span></div>`;
    }).join("");
    box.querySelectorAll("[data-b]").forEach((el) => el.addEventListener("click", () => PS.mitUebergang(el, () => PS.oeffnen("raeume", el.dataset.b))));
  }

  // ------------------------------------------------------------ Modulleiste und Sheet
  const stapel = [];
  let zuletztBeruehrt = Date.now();
  // Nur Symbole; der aktive Eintrag zeigt zusätzlich seinen Namen. Die ersten `dock_anzahl` Module stehen direkt in der
  // Leiste (plus „Start“), die übrigen hinter „Mehr“ (kleines Glas-Raster über der Leiste). Bleibt nur ein Modul übrig, steht es direkt da.
  let mehrOffen = false;
  const dockKnopf = (m, def, zahl, klasse = "") => {
    const name = def.kurz || def.titel;
    return `<button type="button" data-m="${m}" aria-label="${PS.esc(def.titel)}" title="${PS.esc(def.titel)}"${klasse ? ` class="${klasse}"` : ""}>${PS.ic(def.icon)}${zahl ? `<span class="zaehler">${zahl}</span>` : ""}<span class="dock-name">${PS.esc(name)}</span></button>`;
  };
  function dock() {
    const mods = ["start", ...(PS.einst.module || [])].filter((m) => PS.modulDa(m) || m === "start");
    const def = (m) => (m === "start" ? { titel: "Start", icon: "home" } : PS.module[m]);
    const zaehler = (m) => (def(m).zaehler ? def(m).zaehler() : 0);
    // Admin-Ansicht: alle Module untereinander in der Leiste, dahinter die Admin-Seiten
    if (PS.admin) mods.push(...PS.admin.module.filter(PS.modulDa));
    const anzahl = PS.admin ? 99 : Math.max(3, Math.min(12, +PS.einst.dock_anzahl || 6));
    let direkt = mods.slice(0, anzahl + 1), mehr = mods.slice(anzahl + 1);  // „Start“ zählt nicht mit
    if (mehr.length === 1) { direkt = mods; mehr = []; }
    if (!mehr.length) mehrOffen = false;
    const summe = mehr.reduce((n, m) => n + zaehler(m), 0);
    $("#dock").innerHTML = direkt.map((m) => dockKnopf(m, def(m), zaehler(m), PS.admin ? PS.admin.klasse(m) : "")).join("")
      + (mehr.length ? `${dockKnopf("mehr", { titel: "Mehr", icon: "dots-horizontal" }, summe).replace("<button ", `<button aria-haspopup="true" aria-expanded="${mehrOffen}" `)}`
        + `<div class="dock-mehr" id="dock-mehr" role="menu" aria-label="Weitere Module"${mehrOffen ? "" : " hidden"}>${mehr.map((m) => dockKnopf(m, def(m), zaehler(m))).join("")}</div>` : "");
    $("#dock").dataset.mehr = mehr.join(",");
    $("#dock").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.m === "mehr") { mehrSetzen(!mehrOffen); return; }
      mehrSetzen(false);
      if (b.dataset.m === "start") PS.schliessen(); else PS.oeffnen(b.dataset.m);
    }));
    markieren();
  }
  function mehrSetzen(an) {
    mehrOffen = an;
    const box = $("#dock-mehr"); if (box) box.hidden = !an;
    const knopf = document.querySelector('#dock button[data-m="mehr"]'); if (knopf) knopf.setAttribute("aria-expanded", String(an));
  }
  document.addEventListener("pointerdown", (ev) => { if (mehrOffen && !ev.target.closest("#dock")) mehrSetzen(false); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && mehrOffen) mehrSetzen(false); });
  function markieren() {
    const aktiv = stapel.length ? stapel[0].modul : "start";
    const versteckt = ($("#dock").dataset.mehr || "").split(",");
    document.querySelectorAll("#dock button").forEach((b) => b.classList.toggle("aktiv", b.dataset.m === aktiv || (b.dataset.m === "mehr" && versteckt.includes(aktiv))));
  }
  PS.oeffnen = (modul, arg) => {
    const def = PS.module[modul]; if (!def) return;
    stapel.length = 0; rueck = null;
    stapel.push({ modul, titel: def.titel, render: (el) => def.render(el, arg) });
    document.body.classList.add("offen"); document.body.classList.remove("ruhe");
    zeichnen(); markieren();
    if (arg && def.unterseite) def.unterseite(arg);
  };
  PS.unterseite = (titel, render) => { stapel.push({ modul: stapel[0] && stapel[0].modul, titel, render }); zeichnen(); };
  PS.seiteErsetzen = (titel, render) => { if (!stapel.length) return; stapel[stapel.length - 1] = { modul: stapel[0].modul, titel, render }; zeichnen(true); };
  function schliessenDirekt() {
    ziehReste();
    document.body.classList.remove("offen"); stapel.length = 0; markieren();
    $("#sheet-inhalt").querySelectorAll("img").forEach(PS.kameraStoppen); PS.emit("seite");
    setTimeout(() => { if (!stapel.length) $("#sheet-inhalt").innerHTML = ""; }, 700);
  }
  // Schließen (X, Wischen, Zeit, Start im Dock): lag die Quelle außerhalb des Sheets und steht noch im DOM, läuft der Übergang zurück
  PS.schliessen = () => {
    const r = rueck; rueck = null;
    if (r && !r.intern && r.quelle.isConnected && stapel.length === r.tiefe && document.body.classList.contains("offen") && animiert()) rueckUebergang(r, schliessenDirekt);
    else schliessenDirekt();
  };
  PS.zurueck = () => zurueck();
  function zurueck() {
    if (stapel.length < 2) return PS.schliessen();
    const r = rueck;
    const tun = () => { stapel.pop(); zeichnen(true); };
    if (r && r.intern && stapel.length === r.tiefe && animiert()) { rueck = null; rueckUebergang(r, tun); return; }
    stapel.pop(); zeichnen();
    if (rueck && stapel.length < rueck.tiefe) rueck = null;
  }
  function zeichnen(still) {
    const seite = stapel[stapel.length - 1]; if (!seite) return;
    $("#sheet-titel").textContent = seite.titel;
    $("#sheet-zurueck").hidden = stapel.length < 2;
    modulBand(seite.modul);
    const inhalt = $("#sheet-inhalt");
    inhalt.querySelectorAll("img").forEach(PS.kameraStoppen);
    PS.emit("seite");
    inhalt.classList.toggle("still", !!still);
    inhalt.classList.remove("raumseite", "energie-seite", "studio-seite");
    inhalt.innerHTML = ""; inhalt.scrollTop = 0;
    seite.render(inhalt);
    PS.kachelnBinden(inhalt);
  }
  // ------------------------------------------------------------ Eigene Reihenfolge (am PC angeordnet, überall gültig)
  // Jede Liste mit mindestens zwei kenntlichen Einträgen ist sortierbar: Kacheln (data-eid), Räume (data-b), Thermostate
  // (data-klima), Boxen und Gruppen (über ihren Titel). Ihr Schlüssel aus Seite, umgebender Box und Position ist auf
  // Panel und PC gleich; Räume folgen der gemeinsamen Raumreihenfolge. Nicht kenntliche Elemente (Knöpfe wie „Alle …“)
  // behalten ihren Platz, Neues reiht sich hinten ein. Ein Beobachter ordnet auch nach, was später nachgeladen wird.
  const kennung = (el) => {
    if (el.dataset.raum) return "raum:" + el.dataset.raum;
    if (el.dataset.eid || el.dataset.klima) return el.dataset.eid || el.dataset.klima;
    const h = el.matches(".r-box, .gruppe") && el.querySelector(":scope > h3 > span");
    return h ? "box:" + h.textContent.trim() : "";
  };
  const ORDNUNG_KANDIDATEN = "[data-eid], [data-raum], [data-klima], .r-box, .gruppe";
  function ordnungsListen(wurzel) {
    const eltern = new Set();
    wurzel.querySelectorAll(ORDNUNG_KANDIDATEN).forEach((el) => { if (el.parentElement && kennung(el)) eltern.add(el.parentElement); });
    // Kachelraster zählen schon mit einer Kachel (dort lassen sich Geräte hinzufügen), andere Listen ab zwei Einträgen
    return [...eltern].filter((c) => (c === wurzel || wurzel.contains(c)) && [...c.children].filter((x) => kennung(x)).length >= (c.classList.contains("raster") ? 1 : 2));
  }
  function seitenSchluessel() { const s = stapel[stapel.length - 1]; return s ? `${s.modul}/${s.titel}` : ""; }
  function listenSchluessel(c, wurzel, listen, seite = seitenSchluessel()) {
    const box = c.parentElement && c.parentElement.closest(".r-box, .gruppe");
    const titel = box && wurzel.contains(box) ? (box.querySelector(":scope > h3 > span") || {}).textContent || "" : "";
    const art = c === wurzel ? "seite" : c.classList[0] || c.tagName.toLowerCase();
    const bereich = box && wurzel.contains(box) ? box : wurzel;
    const gleiche = listen.filter((x) => x !== wurzel && bereich.contains(x) && (x.classList[0] || x.tagName.toLowerCase()) === art);
    return `${seite}|${titel.trim()}|${art}${c === wurzel ? "" : Math.max(0, gleiche.indexOf(c))}`;
  }
  function ordnen(c, folge) {
    const kinder = [...c.children].filter((x) => kennung(x));
    const rang = (x) => { const i = folge.indexOf(kennung(x)); return i < 0 ? 1e6 + kinder.indexOf(x) : i; };
    const soll = [...kinder].sort((x, y) => rang(x) - rang(y));
    if (soll.every((x, i) => x === kinder[i])) return;
    const platz = kinder.map((x) => { const m = document.createComment(""); x.replaceWith(m); return m; });
    platz.forEach((m, i) => m.replaceWith(soll[i]));
  }
  PS.ordnung = {
    zieht: false,
    kennung, schluessel: (c, wurzel = $("#sheet-inhalt"), seite) => listenSchluessel(c, wurzel, ordnungsListen(wurzel), seite),
    listen: (wurzel = $("#sheet-inhalt")) => ordnungsListen(wurzel),
    seite: seitenSchluessel,
    // Ohne „seite“ die offene Modulseite; die Startseite der Admin-Ansicht gibt ihre Blöcke mit eigener Seite an
    anwenden(wurzel = $("#sheet-inhalt"), seite) {
      if (PS.ordnung.zieht || (!seite && !stapel.length)) return;
      const alle = PS.einst.reihenfolgen || {}, raeume = (PS.einst.bereiche_reihenfolge || []).map((b) => "raum:" + b);
      const listen = ordnungsListen(wurzel);
      listen.forEach((c) => {
        const folge = [...c.children].some((x) => x.dataset.raum) ? raeume : alle[listenSchluessel(c, wurzel, listen, seite)];
        if (folge && folge.length) ordnen(c, folge);
      });
    },
  };
  // ------------------------------------------------------------ Freies Raster (Position und Größe, am PC eingestellt)
  // Seiten im Drei-Spalten-Muster (.raum-ansicht) werden, sobald für sie ein Raster gespeichert ist, zu einem Raster aus
  // zwölf Spalten: jedes Teil (Box, Klima-, Medienkarte, Knopf) in gespeicherter Folge, Breite in Spalten, Höhe in
  // feinen Zeilen (0 = nach Inhalt). Schmal: zwei Spalten (ab halber Breite voll), ganz schmal eine; Höhe nach Inhalt.
  // Kacheln in einem Raster können mehrere Spalten breit sein. Gespeichert in PS.einst.layouts:
  // „seite:Modul/Titel“ → ["b:h:Kennung", …] und „liste:Listenschlüssel“ → ["b:0:Entität", …].
  const ZEILE_PX = 8;
  const teilId = (el) => kennung(el) || (el.dataset.medien ? "medien:" + el.dataset.medien : "")
    || (el.matches(".knopf") ? "knopf:" + (el.querySelector(":scope > span") || el).textContent.trim() : "") || "";
  function teileVon(g) {
    if (g.classList.contains("frei")) return [...g.children];
    return [...g.children].flatMap((x) => (x.classList.contains("r-spalte") ? [...x.children] : [x]));
  }
  function teilIds(teile) {
    const zaehler = {};
    return teile.map((el) => {
      let id = teilId(el);
      if (!id) { const k = el.classList[0] || el.tagName.toLowerCase(); zaehler[k] = (zaehler[k] || 0) + 1; id = `teil:${k}${zaehler[k]}`; }
      return id;
    });
  }
  const eintragLesen = (x) => { const m = /^(\d{1,2}):(\d{1,3}):(.+)$/.exec(x); return m ? { w: +m[1], h: +m[2], id: m[3] } : null; };
  function freiSpannen(g) {
    const breit = g.clientWidth, spalten = breit < 560 ? 1 : breit < 900 ? 2 : 12;
    g.style.setProperty("--spalten", spalten);
    const luecke = parseFloat(getComputedStyle(g).rowGap) || 0;
    [...g.children].forEach((el) => {
      const w = +el.dataset.w || 4, h = +el.dataset.h || 0;
      el.style.gridColumn = `span ${spalten === 12 ? w : spalten === 2 ? (w >= 6 ? 2 : 1) : 1}`;
      const fest = spalten === 12 && h > 0;
      el.classList.toggle("frei-fest", fest);
      const hoehe = fest ? 0 : el.getBoundingClientRect().height;
      el.style.gridRow = `span ${fest ? h : Math.max(1, Math.ceil((hoehe + luecke) / (ZEILE_PX + luecke)))}`;
    });
  }
  const freiBeobachter = new ResizeObserver((liste) => {
    const gs = new Set(liste.map((x) => x.target.closest(".raum-ansicht.frei")).filter(Boolean));
    requestAnimationFrame(() => gs.forEach((g) => g.isConnected && freiSpannen(g)));
  });
  function rasterAnwenden(g, eintraege) {
    const teile = teileVon(g), ids = teilIds(teile);
    const nachId = new Map(teile.map((el, i) => [ids[i], el]));
    const folge = eintraege.map(eintragLesen).filter((x) => x && nachId.has(x.id));
    const gesehen = new Set(folge.map((x) => x.id));
    const alle = [...folge, ...ids.filter((id) => !gesehen.has(id)).map((id) => ({ id, w: 4, h: 0 }))];
    const soll = alle.map((x) => nachId.get(x.id));
    alle.forEach((x, i) => { const el = soll[i]; el.dataset.w = x.w; el.dataset.h = x.h; el.dataset.teil = x.id; });
    if (!g.classList.contains("frei")) {
      g.classList.add("frei");
      if (g.parentElement) g.parentElement.classList.add("frei-seite");
      g.replaceChildren(...soll);
    } else if (!soll.every((el, i) => g.children[i] === el)) g.replaceChildren(...soll);
    soll.forEach((el) => { if (!el._freiBeob) { el._freiBeob = true; freiBeobachter.observe(el); } });
    freiSpannen(g);
  }
  // Boxen mit Obergrenze (z. B. „Geräte“ der Raumansicht, sechs Kacheln): vor dem Kürzen nach der eigenen
  // Reihenfolge sortieren und Entferntes herausnehmen, damit die Auswahl stimmt; die Grenze selbst ist einstellbar
  // („max:Liste“ → "0:Anzahl:max"). Liefert die Auswahl; das Raster bekommt Grenze und Gesamtzahl als Daten.
  PS.ordnung.auswahl = (boxTitel, ids, grenze, index = 0) => {
    const k = `${seitenSchluessel()}|${boxTitel}|raster${index}`, L = PS.einst.layouts || {};
    const folge = (PS.einst.reihenfolgen || {})[k] || [];
    const minus = new Set((L["minus:" + k] || []).map(eintragLesen).filter(Boolean).map((x) => x.id));
    const rang = (e) => { const i = folge.indexOf(e); return i < 0 ? 1e6 : i; };
    const sortiert = ids.filter((e) => !minus.has(e)).map((e, i) => [e, i]).sort((x, y) => rang(x[0]) - rang(y[0]) || x[1] - y[1]).map((x) => x[0]);
    const m = (L["max:" + k] || []).map(eintragLesen).filter(Boolean)[0];
    const n = m ? m.h : grenze;
    return { ids: sortiert.slice(0, n), alle: sortiert.length, grenze: n };
  };
  PS.ordnung.begrenzt = (raster, a) => { if (raster) { raster.dataset.grenze = a.grenze; raster.dataset.alle = a.alle; } return raster; };
  PS.layout = {
    teileVon, teilIds, freiSpannen, eintragLesen,
    // Kachel im Raster: Breite in Spalten und optional fester Platz {w: Spalte, h: Zeile}
    kachelSetzen(el, w, platz) {
      el.dataset.spanne = w > 1 ? w : "";
      if (platz) { el.dataset.px = platz.w; el.dataset.py = platz.h; } else { delete el.dataset.px; delete el.dataset.py; }
      el.style.gridColumn = platz ? `${platz.w} / span ${w}` : w > 1 ? `span ${w}` : "";
      el.style.gridRow = platz ? String(platz.h) : "";
    },
    anwenden(wurzel = $("#sheet-inhalt"), seite) {
      if (PS.ordnung.zieht || (!seite && !stapel.length)) return;
      const L = PS.einst.layouts || {};
      const g = wurzel.querySelector(".raum-ansicht"), raster = L["seite:" + (seite || seitenSchluessel())];
      if (g && raster && raster.length) rasterAnwenden(g, raster);
      // Kachelraster: Breite je Kachel („liste:“) und freier Platz („pos:“ → Spalte:Zeile:Kennung). Passt ein Platz
      // nicht in die aktuelle Spaltenzahl (schmale Anzeige), ordnet sich die Liste wieder von selbst.
      const listen = ordnungsListen(wurzel);
      listen.filter((c) => c.classList.contains("raster")).forEach((c) => {
        const k = listenSchluessel(c, wurzel, listen, seite);
        // Hinzugefügte Geräte („plus:“) anhängen, entfernte („minus:“) herausnehmen
        const ids = (n) => (L[n + k] || []).map(eintragLesen).filter(Boolean).map((x) => x.id);
        const minus = new Set(ids("minus:")), da = new Set([...c.children].map(kennung));
        ids("plus:").filter((e) => PS.z[e] && !da.has(e) && !minus.has(e)).forEach((e) => {
          c.insertAdjacentHTML("beforeend", PS.kachelHTML(e, {}));
          PS.kachelVerdrahten(c.lastElementChild);
        });
        [...c.children].forEach((el) => { if (minus.has(kennung(el))) el.remove(); });
        const breite = new Map((L["liste:" + k] || []).map(eintragLesen).filter(Boolean).map((x) => [x.id, x.w]));
        const platz = new Map((L["pos:" + k] || []).map(eintragLesen).filter(Boolean).map((x) => [x.id, x]));
        const spalten = getComputedStyle(c).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
        const passt = [...platz.values()].every((p) => p.w + (breite.get(p.id) || 1) - 1 <= spalten);
        [...c.children].forEach((el) => PS.layout.kachelSetzen(el, breite.get(kennung(el)) || 1, passt ? platz.get(kennung(el)) : null));
      });
    },
  };

  let ordnungBald = 0;
  const ordnungVormerken = () => { if (!ordnungBald) ordnungBald = requestAnimationFrame(() => { ordnungBald = 0; PS.ordnung.anwenden(); PS.layout.anwenden(); }); };
  new MutationObserver(ordnungVormerken).observe($("#sheet-inhalt"), { childList: true, subtree: true });
  PS.on("einstellungen", ordnungVormerken);

  PS.neuZeichnen = () => { if (stapel.length) { const y = $("#sheet-inhalt").scrollTop; zeichnen(true); $("#sheet-inhalt").scrollTop = y; } };
  // Modulband im Seitenkopf, auf allen Modulseiten gleich (Seiten mit eigenen Reitern ersetzen es über PS.tabs)
  function modulBand(aktiv) {
    if (PS.admin) { $("#sheet-tabs").innerHTML = ""; return; }  // am PC steht die Modulleiste daneben
    const mods = (PS.einst.module || []).filter((m) => PS.modulDa(m) && m !== "suche");
    PS.tabs(mods.map((m) => [m, PS.module[m].kurz || PS.module[m].titel]), aktiv, (k) => PS.oeffnen(k));
  }
  PS.tabs = (eintraege, aktiv, beiWahl, box = $("#sheet-tabs")) => {
    box.innerHTML = eintraege.map(([k, t]) => `<button data-k="${PS.esc(k)}" class="${k === aktiv ? "aktiv" : ""}">${PS.esc(t)}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      box.querySelectorAll("button").forEach((x) => x.classList.toggle("aktiv", x === b)); beiWahl(b.dataset.k);
    }));
    // Aktiven Reiter sichtbar halten, auch wenn die Leiste länger ist als der Platz
    const akt = box.querySelector("button.aktiv");
    if (akt && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, akt.offsetLeft - (box.clientWidth - akt.offsetWidth) / 2);
  };


  // ------------------------------------------------------------ Gesten (Konzept Stufe 4)
  // Sheet folgt dem Finger: Wischen nach unten am Sheet-Kopf zieht das Sheet mit, die Startseite dahinter wird mit dem
  // Weg größer und heller (Ruhezustand des Sheets: scale .965, Deckkraft .25, Sättigung .6). Loslassen: Weg > 140 px
  // oder Tempo > 0,6 px/ms schließt, sonst federt das Sheet zurück. Jederzeit unterbrechbar.
  let rueckTimer = null;
  function ziehReste() {
    clearTimeout(rueckTimer); rueckTimer = null;
    const sheet = $(".sheet"), start = $(".start");
    [sheet, start].forEach((e) => { e.style.transition = ""; e.style.transform = ""; e.style.opacity = ""; e.style.filter = ""; });
    sheet.classList.remove("zieht");
  }
  function sheetZiehen() {
    const kopf = $(".sheet-kopf"), sheet = $(".sheet"), start = $(".start");
    let d = null;
    const versatz = () => { try { return new DOMMatrix(getComputedStyle(sheet).transform).m42 || 0; } catch { return 0; } };
    const stand = (y) => {
      const p = Math.max(0, Math.min(1, y / 320));
      sheet.style.transform = `translateY(${y}px)`;
      start.style.transform = `scale(${(0.965 + 0.035 * p).toFixed(4)})`; start.style.opacity = (0.25 + 0.75 * p).toFixed(3); start.style.filter = `saturate(${(0.6 + 0.4 * p).toFixed(3)})`;
    };
    kopf.addEventListener("pointerdown", (e) => {
      if (!document.body.classList.contains("offen") || (e.pointerType === "mouse" && e.button !== 0)) return;
      // Läuft gerade die Rückfederung, den Stand übernehmen und weiterziehen
      const laeuft = rueckTimer != null, basis = laeuft ? Math.max(0, versatz()) : 0;
      if (laeuft) { clearTimeout(rueckTimer); rueckTimer = null; sheet.style.transition = start.style.transition = "none"; stand(basis); }
      d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, basis, aktiv: laeuft, y: basis, proben: [] };
      if (laeuft) { sheet.classList.add("zieht"); try { kopf.setPointerCapture(e.pointerId); } catch { /* optional */ } }
    });
    kopf.addEventListener("pointermove", (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.aktiv) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy < 8 || Math.abs(dx) > Math.abs(dy)) { d = null; return; }  // nur nach unten, sonst bleibt es ein Tippen
        d.aktiv = true; sheet.classList.add("zieht"); sheet.style.transition = start.style.transition = "none";
        try { kopf.setPointerCapture(e.pointerId); } catch { /* optional */ }
      }
      d.y = Math.max(0, d.basis + dy);
      d.proben.push([performance.now(), d.y]); if (d.proben.length > 6) d.proben.shift();
      PS.emit("beruehrt"); stand(d.y);
    });
    const ende = (e, abbruch) => {
      if (!d || e.pointerId !== d.id) return;
      const g = d; d = null;
      if (!g.aktiv) return;
      const [t0, y0] = g.proben.find((p) => performance.now() - p[0] < 120) || g.proben[0] || [0, g.y];
      const dt = performance.now() - t0, tempo = dt > 8 ? (g.y - y0) / dt : 0;
      if (!abbruch && (g.y > 140 || (tempo > 0.6 && g.y > 20))) { PS.schliessen(); return; }
      sheet.style.transition = "transform .65s var(--e-feder)";
      start.style.transition = "transform .6s var(--e-auftakt),opacity .6s ease,filter .6s ease";
      sheet.style.transform = ""; start.style.transform = ""; start.style.opacity = ""; start.style.filter = "";
      rueckTimer = setTimeout(ziehReste, 700);
    };
    kopf.addEventListener("pointerup", (e) => ende(e, false));
    kopf.addEventListener("pointercancel", (e) => ende(e, true));
  }

  // Feed-Karte folgt dem Finger waagerecht; Loslassen wechselt mit dem Schichtwechsel zur nächsten (links) oder
  // vorigen (rechts) Karte, sonst federt sie zurück. Ein kurzes Tippen bleibt ein Tippen.
  function feedWischen() {
    const box = $("#karussell");
    let d = null, zuletzt = 0;
    box.addEventListener("pointerdown", (e) => {
      if (liste.length < 2 || (e.pointerType === "mouse" && e.button !== 0)) return;
      const el = elemente.get((liste[aktuell] || {}).id); if (!el) return;
      d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, aktiv: false, dx: 0, el, proben: [] };
    });
    box.addEventListener("pointermove", (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.aktiv) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) < Math.abs(dy)) { d = null; return; }
        d.aktiv = wischt = true; d.el.style.transition = "none";
        try { box.setPointerCapture(e.pointerId); } catch { /* optional */ }
      }
      d.dx = dx; wechselZeit = Date.now();
      d.proben.push([performance.now(), dx]); if (d.proben.length > 6) d.proben.shift();
      const p = Math.min(1, Math.abs(dx) / 600);
      d.el.style.transform = `translateX(${dx}px) rotateY(${(-dx / 70).toFixed(2)}deg) scale(${(1 - p * 0.05).toFixed(3)})`;
      d.el.style.opacity = (1 - p * 0.5).toFixed(3);
    });
    const ende = (e, abbruch) => {
      if (!d || e.pointerId !== d.id) return;
      const g = d; d = null;
      if (!g.aktiv) return;
      wischt = false; zuletzt = Date.now(); wechselZeit = Date.now();
      const [t0, x0] = g.proben.find((p) => performance.now() - p[0] < 120) || g.proben[0] || [0, g.dx];
      const dt = performance.now() - t0, tempo = dt > 8 ? (g.dx - x0) / dt : 0;
      const el = g.el;
      if (!abbruch && (Math.abs(g.dx) > 160 || (Math.abs(tempo) > 0.5 && Math.abs(g.dx) > 30))) {
        // Inline-Werte weg und Klassen wechseln im selben Takt: die Karte gleitet vom Fingerstand in den Schichtwechsel
        el.style.transition = el.style.transform = el.style.opacity = "";
        if (g.dx < 0) weiter(); else vorher();
      } else {
        el.style.transition = "transform .55s var(--e-feder),opacity .3s ease";
        el.style.transform = el.style.opacity = "";
        setTimeout(() => { el.style.transition = ""; }, 600);
      }
    };
    box.addEventListener("pointerup", (e) => ende(e, false));
    box.addEventListener("pointercancel", (e) => ende(e, true));
    // Nach einem Wischen kein Tippen auslösen
    box.addEventListener("click", (e) => { if (Date.now() - zuletzt < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  // ------------------------------------------------------------ Ereignis (Tür)
  function ereignis(e) {
    const an = !!(e && e.aktiv);
    document.body.classList.toggle("ereignis-an", an);
    const box = $("#ereignis-kamera");
    if (!an) { PS.klingelStopp(); PS.kameraLiveStoppen(box.parentElement); box._eid = null; if (PS.intercomBeenden) PS.intercomBeenden(); return; }
    document.body.classList.remove("ruhe");
    $("#ereignis-titel").textContent = e.titel || "Tür";
    // Läuft das Overlay schon mit derselben Kamera, nur den Titel nachführen (kein Neustart des Streams)
    if (e.kamera && !(box._eid === e.kamera && box.classList.contains("live") && box._stop)) { PS.kameraLive(box, e.kamera); box._eid = e.kamera; }
    else if (!e.kamera) {
      // Ohne Kamera (Haustür): Klingel-Hinweis statt leerer Fläche
      PS.kameraLiveStoppen(box.parentElement); box._eid = null;
      box.classList.remove("kamera", "live", "laeuft");
      box.innerHTML = `<div class="ereignis-hinweis">${PS.ic(e.intercom ? "doorbell" : "door")}<span>${PS.esc(e.intercom ? "Es klingelt an der Haustür" : e.titel || "Tür")}</span></div>`;
    }
    $("#ereignis-oeffnen").hidden = !e.tueroeffner;
    $("#ereignis-sprechen").hidden = !e.intercom;
  }

  // ------------------------------------------------------------ Aufbau
  function alles() {
    uhr(); wetter(); personen(); statusZeile(); schnellzugriff(); raeumeKurz(); dock(); gruss();
  }
  PS.on("init", () => { alles(); vorhersageLaden(); stuendlichLaden(); termineLaden(); feedAufbauen(); if (stapel.length) PS.neuZeichnen(); });

  // ------------------------------------------------------------ Startseite im Flur frei anordnen (am PC eingestellt)
  // „flur:spalten“ → ["0:31:links", "0:27:rechts"] (Breite in Prozent; die Mitte nimmt den Rest),
  // „flur:teile“ → ["Spalte:0:Kennung", …] in Folge (Spalte 1 links, 2 Mitte, 3 rechts, 9 ausgeblendet).
  // Nur auf dem Panel, nicht in der Admin-Ansicht (dort hängen Uhr, Wetter und Personen in der Kopfzeile).
  PS.FLUR_TEILE = { uhr: "Uhr", datum: "Datum", wetter: "Wetter", vorschau: "Vorschau", personen: "Personen", status: "Status",
    gruss: "Begrüßung", karussell: "Karten", punkte: "Kartenpunkte", "glocke-zeile": "Glocke", kacheln: "Schnellzugriff", "raeume-kurz": "Räume" };
  const FLUR_SPALTEN = () => [$(".start > .spalte.links"), $(".start > .mitte"), $(".start > .spalte.rechts")];
  PS.flurAnordnen = () => {
    if (document.body.classList.contains("admin")) return;
    const L = PS.einst.layouts || {}, start = $(".start"), spalten = FLUR_SPALTEN();
    if (!start || spalten.some((x) => !x)) return;
    const breite = Object.fromEntries((L["flur:spalten"] || []).map(eintragLesen).filter(Boolean).map((x) => [x.id, x.h]));
    start.style.gridTemplateColumns = breite.links || breite.rechts ? `${breite.links || 31}% 1fr ${breite.rechts || 27}%` : "";
    const teile = (L["flur:teile"] || []).map(eintragLesen).filter((x) => x && PS.FLUR_TEILE[x.id]);
    Object.keys(PS.FLUR_TEILE).forEach((id) => { const el = document.getElementById(id); if (el) el.classList.remove("flur-aus"); });
    teile.forEach((x) => {
      const el = document.getElementById(x.id); if (!el) return;
      if (x.w === 9) { el.classList.add("flur-aus"); return; }
      const ziel = spalten[Math.max(0, Math.min(2, x.w - 1))];
      ziel.appendChild(el);
    });
  };
  PS.on("init", PS.flurAnordnen);
  PS.on("einstellungen", PS.flurAnordnen);
  // Eingebettet in die Admin-Ansicht mit ?anordnen=1: Bearbeiten der Flur-Startseite
  if (/[?&]anordnen=1/.test(location.search) && window.top !== window) {
    const sk = document.createElement("script"); sk.src = "static/flur-anordnen.js?v=" + Date.now(); document.head.appendChild(sk);
  }
  let letzterModus = null, aufgewachtUm = 0;
  PS.on("modus", () => {
    if (letzterModus === "ruhe" && PS.modus === "wach") aufgewachtUm = Date.now();
    letzterModus = PS.modus;
    // Feed neu: in Ruhe ohne leere Karte
    feedAufbauen();
  });
  PS.on("karten", () => { feedAufbauen(); statusZeile(); gruss(); });
  PS.on("popups", (neu) => {
    statusZeile();
    if (stapel.length && stapel[0].modul === "hinweise") PS.neuZeichnen();
    // Vier Stufen: passiv nur Glocke · aktiv weckt (nachts nicht), Popup nur, wenn das Panel schon wach war ·
    // zeitkritisch weckt und öffnet (nachts nur Feed und Glocke) · kritisch durchbricht Ruhe und Nacht
    const m = neu && (PS.popups || []).find((x) => x.id === neu);
    if (!m) return;
    const stufe = PS.meldungStufe(m);
    PS.alarmTon(m);
    if (document.body.classList.contains("ereignis-an") || stufe === "passiv") return;
    const wach = PS.modus === "wach" && Date.now() - aufgewachtUm > 2500;  // der Server meldet „wach“ schon vor der Meldung
    if (stufe === "kritisch" || (stufe === "zeitkritisch" && !PS.nacht)) { document.body.classList.remove("ruhe"); PS.popupZeigen(neu); }
    else if (stufe === "aktiv" && !PS.nacht && !wach) document.body.classList.remove("ruhe");
    else if (stufe === "aktiv" && wach) PS.popupZeigen(neu);
  });
  PS.on("meldungen", () => { statusZeile(); if (stapel.length && stapel[0].modul === "hinweise") PS.neuZeichnen(); });
  PS.on("ereignis", ereignis);
  PS.on("einstellungen", () => { schnellzugriff(); raeumeKurz(); dock(); zeigen(false); gruss(); termineLaden(); });
  PS.on("registry", () => { raeumeKurz(); });
  let diffTimer = null;
  PS.on("diff", (ids) => {
    const relevant = [...ids].some((e) => e.startsWith("person.") || e.startsWith("binary_sensor.") || e.startsWith("lock.") || e === PS.opt.alarm_entitaet || (PS.einst.status_modi || []).includes(e) || e === PS.opt.wetter_entitaet || e === PS.opt.aussentemperatur || e.startsWith("sensor.") || e.startsWith("light.") || e.startsWith("climate.") || e.startsWith("update."));
    if (!relevant || diffTimer) return;
    diffTimer = setTimeout(() => { diffTimer = null; wetter(); personen(); statusZeile(); raeumeKurz(); dock(); gruss(); }, 600);
  });
  PS.on("beruehrt", () => { zuletztBeruehrt = Date.now(); });

  document.addEventListener("DOMContentLoaded", () => {
    $("#sheet-zu").addEventListener("click", PS.schliessen);
    $("#glocke").addEventListener("click", () => PS.oeffnen("hinweise"));
    $("#sheet-zurueck").addEventListener("click", zurueck);
    $("#ereignis-ignorieren").addEventListener("click", () => { PS.anfrage({ typ: "ereignis_ende" }).catch(() => {}); ereignis({ aktiv: false }); });
    PS.halten($("#ereignis-oeffnen"), 2000, () => {
      const oeffner = (PS.ereignis && PS.ereignis.tueroeffner) || PS.opt.tueroeffner;
      PS.dienst(PS.domain(oeffner), PS.domain(oeffner) === "lock" ? "open" : "press", { entity_id: oeffner }).then(() => PS.toast("Tür geöffnet"));
    });
    setInterval(uhr, 5000);
    setInterval(gruss, 30000);
    setInterval(takt, 1000);
    setInterval(vorhersageLaden, 30 * 60 * 1000);
    setInterval(stuendlichLaden, 30 * 60 * 1000);
    setInterval(termineLaden, 15 * 60 * 1000);
    setInterval(feedAufbauen, 60 * 1000);
    setInterval(() => {
      // In Klima Studio (eingebettet) kommen Berührungen nicht beim Panel an: dort erst nach 10 Minuten zurück
      if (PS.admin) return;  // am PC bleibt die Seite offen
      const frist = stapel[0] && stapel[0].modul === "studio" ? 600 : PS.einst.bedienung_zurueck_s || 60;
      if (document.body.classList.contains("offen") && Date.now() - zuletztBeruehrt > frist * 1000) PS.schliessen();
    }, 5000);
    sheetZiehen(); feedWischen();
    try { if ("wakeLock" in navigator) navigator.wakeLock.request("screen").catch(() => {}); } catch { /* optional */ }
    PS.verbinden();
  });
})();
