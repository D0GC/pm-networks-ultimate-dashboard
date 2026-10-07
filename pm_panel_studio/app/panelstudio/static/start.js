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
  function wetter() {
    const w = PS.opt.wetter_entitaet, st = PS.z[w];
    const el = $("#wetter"); if (!st) { el.hidden = true; return; } el.hidden = false;
    const aussen = PS.opt.aussentemperatur && PS.z[PS.opt.aussentemperatur] ? PS.s(PS.opt.aussentemperatur) : st.a.temperature;
    const heute = vorhersage[0] || {};
    const regen = heute.precipitation_probability != null ? ` · Regen ${heute.precipitation_probability} %` : "";
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
    $("#status").innerHTML = teile.join("");
    $("#status").querySelectorAll("[data-eid]").forEach((el) => el.addEventListener("click", () => PS.mehrInfos(el.dataset.eid)));
    $("#status").querySelectorAll("[data-modul]").forEach((el) => el.addEventListener("click", () => PS.oeffnen(el.dataset.modul)));
    glocke();
  }
  // Glocke oben rechts: nur echte Meldungen (Panel-Meldungen, Popups, HA-Benachrichtigungen), keine Hinweise
  function glocke() {
    const el = $("#glocke"); if (!el) return;
    const n = (PS.meldungen || []).length + (PS.popups || []).length;
    const hoch = (PS.popups || []).some((m) => m.prio === "high");
    el.className = "glocke" + (n ? " neu" : "") + (hoch ? " hoch" : "");
    el.innerHTML = PS.ic(hoch ? "bell-ring-outline" : n ? "bell-badge-outline" : "bell-outline") + (n ? `<span class="zahl tabular">${n}</span>` : "");
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
    meldung: ["bell-ring-outline", "var(--warn)"], spueler: ["dishwasher", "var(--info)"], robo: ["robot-vacuum", "var(--gut)"], musik: ["music-note-outline", "#c99bf0"], ruhig: ["leaf", "var(--gut)"],
  };
  PS.kartenIcon = (k) => (KARTE[k] || KARTE.neutral)[0];
  let aktuell = 0, liste = [], wechselZeit = 0;
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
    if (sekunden && sek < 3600) { const g = Math.ceil(Math.max(0, sek)); return { zahl: `${Math.floor(g / 60)}:${String(g % 60).padStart(2, "0")}`, einheit: "min" }; }
    const min = Math.ceil(Math.max(0, sek) / 60);
    return min >= 60 ? { zahl: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`, einheit: "h" } : { zahl: String(min), einheit: "min" };
  }
  const AKT_KOPF = { waesche: "Gerät läuft", spueler: "Gerät läuft", kohle: "Kohle", dusche: "Duschmodus", spa: "Spa", robo: "Roborock", musik: "Musik" };
  function modell(k) {
    let [icon, farbe] = KARTE[k.schluessel] || KARTE.neutral;
    const m = { kopf: k.titel || "Hinweis", farbe, anteil: 1, zahl: null, einheit: "", icon, h2: k.wert, p: k.hinweis };
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
    if (k.art === "praktisch") return { ...m, ...k.modell };
    if (k.art === "meldung") {
      return { ...m, kopf: k.prio === "high" ? "Meldung · wichtig" : "Meldung", farbe: PS.meldungFarbe(k.prio), icon: PS.meldungIcon(k.icon), h2: k.titel, p: k.hinweis };
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
      case "eil": return { ...m, kopf: `Eilmeldung · ${k.titel}`, h2: k.hinweis, p: "" };
      case "ruhig": return { ...m, kopf: "Hinweise", h2: "Alles ruhig", p: k.hinweis };
    }
    return m;
  }
  const WARN_FARBE = { 1: "#f0d34c", 2: "#f0964c", 3: "#ef6a7a", 4: "#b05bd6" };
  const WARN_NAME = { 1: "Wetterwarnung", 2: "Markante Warnung", 3: "Unwetterwarnung", 4: "Extreme Unwetterwarnung" };
  function ringAnteil(k) { return modell(k).anteil; }
  PS.ringAnteil = ringAnteil;
  function karteInhalt(k) {
    const m = modell(k);
    const laeuft = !!k.ende;
    let innen;
    if (m.svg) innen = `${m.svg}<small class="einheit">${PS.esc(m.einheit)}</small>`;
    else if (m.zahl != null) innen = `<b class="wert-txt tabular" data-text="${PS.esc(m.zahl)}"></b><small class="einheit">${PS.esc(m.einheit)}</small>`;
    else innen = PS.ic(m.icon);
    return { farbe: m.farbe, glut: !!m.glut, html: `<div class="kopf"><i class="punkt"></i><span>${PS.esc(m.kopf)}</span></div><div class="ring${laeuft ? " laeuft glimmt" : ""}">${PS.ringSVG(m.anteil)}<div class="innen">${innen}</div></div><h2>${PS.esc(m.h2 || "")}</h2><p>${PS.esc(m.p || "")}</p>` };
  }
  // Zahl im Ring rollt wie ein Zählwerk auf den Wert (Konzept Stufe 1); bei jedem Zeigen aus dem Leeren
  function walzeStarten(el, neu) {
    const b = el && el.querySelector(".wert-txt[data-text]"); if (!b) return;
    if (neu) { b._walze = null; b.textContent = ""; }
    PS.walze(b, b.dataset.text);
  }
  function kartenSetzen(karten) {
    const alt = liste[aktuell] && liste[aktuell].id;
    liste = karten || [];
    $(".mitte").classList.toggle("leer", !liste.length);
    const box = $("#karussell");
    const ids = new Set(liste.map((k) => k.id));
    for (const [id, el] of elemente) if (!ids.has(id)) { el.remove(); elemente.delete(id); }
    for (const k of liste) {
      let el = elemente.get(k.id);
      const inhalt = karteInhalt(k);
      if (!el) {
        el = document.createElement("div"); el.className = "karte"; el.dataset.id = k.id;
        el.addEventListener("click", () => { const kk = el._karte; if (kk && kk.art === "meldung") PS.popupZeigen(kk.id); else weiter(); });
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
        PS.ringSetzen(el.querySelector(".ring svg"), ringAnteil(k));
      }
      el._html = inhalt.html; el._karte = k;
      el.style.setProperty("--farbe", inhalt.farbe);
      el.classList.toggle("eil", k.schluessel === "eil");
      el.classList.toggle("glut", inhalt.glut);
    }
    const pos = liste.findIndex((k) => k.id === alt);
    aktuell = pos >= 0 ? pos : Math.min(aktuell, liste.length - 1);
    zeigen(false);
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
    pk.style.setProperty("--verweil", (PS.einst.verweildauer_s || 8) + "s");
    pk.innerHTML = liste.length > 1 ? liste.map((_, i) => `<span class="${i < aktuell ? "vorbei" : i === aktuell ? "jetzt" : ""}"></span>`).join("") : "";
  }
  function weiter() { if (liste.length < 2) return; aktuell = (aktuell + 1) % liste.length; zeigen(); }
  function takt() {
    if (liste.length > 1 && Date.now() - wechselZeit > (PS.einst.verweildauer_s || 8) * 1000 && !document.body.classList.contains("offen")) weiter();
    // Restzeiten lokal herunterzählen
    for (const k of liste) {
      if (!k.ende) continue;
      const el = elemente.get(k.id); if (!el) continue;
      const rest = Math.max(0, (new Date(k.ende).getTime() - Date.now()) / 1000);
      const t = el.querySelector(".wert-txt"), r = restText(rest, SEKUNDEN.includes(k.schluessel));
      // Restzeit rollt wie ein Zählwerk herunter (nur die sichtbare Karte, die anderen werden beim Zeigen gefüllt)
      if (t && r) { t.dataset.text = r.zahl; if (el.classList.contains("an")) PS.walze(t, r.zahl); const e = el.querySelector(".einheit"); if (e) e.textContent = r.einheit; }
      if (k.dauer_s) PS.ringSetzen(el.querySelector(".ring svg"), rest / k.dauer_s);
    }
  }


  // ------------------------------------------------------------ Feed: was gerade zählt
  // Das Wetter steht links; der Feed zeigt es nur kurz vor einem Wetterwechsel (nächste 3 Stunden). Ohne Hinweise
  // bleibt der Feed im Ruhezustand leer; wach zeigt er, was gerade praktisch ist.
  let stuendlich = [], naechsterTermin = null;
  async function stuendlichLaden() {
    const w = PS.opt.wetter_entitaet; if (!w || !PS.z[w]) return;
    try {
      const r = await PS.anfrage({ typ: "dienst", domain: "weather", service: "get_forecasts", data: { entity_id: w, type: "hourly" }, antwort: true });
      stuendlich = ((r || {})[w] || {}).forecast || [];
    } catch { stuendlich = []; }
    feedAufbauen();
  }
  async function termineLaden() {
    const kals = Object.keys(PS.z).filter((e) => e.startsWith("calendar.") && PS.sichtbar(e));
    const start = new Date(), ende = new Date(Date.now() + 24 * 3600e3), alle = [];
    await Promise.all(kals.map(async (k) => {
      try {
        const r = await PS.anfrage({ typ: "rest", pfad: `calendars/${k}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(ende.toISOString())}` });
        (r || []).forEach((t) => { if (t.start && t.start.dateTime) alle.push({ titel: t.summary, start: new Date(t.start.dateTime) }); });
      } catch { /* einzelne Kalender dürfen fehlen */ }
    }));
    naechsterTermin = alle.filter((t) => t.start > new Date()).sort((a, b) => a.start - b.start)[0] || null;
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
  // Praktische Karten: „Alles in Ordnung“, wenn sonst nichts läuft (wach und in Ruhe), und der nächste Termin
  // (24 h) immer zusätzlich zu den übrigen Karten.
  function okKarte() {
    const offen = offeneZugaenge().length, al = PS.opt.alarm_entitaet;
    const teile = [offen ? `${offen} offen` : "Fenster und Türen zu"];
    if (al && PS.z[al]) teile.push(PS.s(al).startsWith("armed") ? "Alarm scharf" : "Alarm aus");
    teile.push("keine Geräte aktiv");
    return { id: "ok", art: "praktisch", schluessel: "ok", titel: "Zuhause", wert: "", hinweis: "",
      modell: { kopf: "Zuhause", farbe: "var(--gut)", icon: "shield-check-outline", anteil: 1, h2: "Alles in Ordnung", p: teile.join(" · ") } };
  }
  function terminKarte() {
    if (!naechsterTermin) return null;
    const t = naechsterTermin.start, min = (t - Date.now()) / 60e3, heute = t.toDateString() === new Date().toDateString();
    return { id: "naechstes", art: "praktisch", schluessel: "naechstes", titel: "Als Nächstes", wert: "", hinweis: "",
      modell: { kopf: "Als Nächstes", farbe: "#c99bf0", h2: naechsterTermin.titel || "Termin", p: `${heute ? "heute" : "morgen"} um ${PS.uhrzeit(t)}`,
        zahl: PS.uhrzeit(t), einheit: "Uhr", anteil: Math.max(0.02, 1 - min / 1440) } };
  }
  function feedAufbauen() {
    let k = (PS.karten || []).filter((x) => x.schluessel !== "wetter");
    const ww = (PS.einst.karten_aus || []).includes("wetter") ? null : wetterwechsel(); if (ww) k.push(ww);
    if (!k.length) k.push(okKarte());
    const termin = terminKarte(); if (termin) k.push(termin);
    kartenSetzen(k);
  }

  // Kachel wird Seite (Konzept Stufe 3): View Transitions, ohne Unterstützung einfach öffnen
  PS.mitUebergang = (quelle, fn) => {
    if (!document.startViewTransition || !quelle || document.body.classList.contains("ohne-animation")) { fn(); return; }
    quelle.style.viewTransitionName = "raum-kopf";
    const vt = document.startViewTransition(() => {
      quelle.style.viewTransitionName = "";
      fn();
      $("#sheet-titel").style.viewTransitionName = "raum-kopf";
    });
    vt.finished.finally(() => { $("#sheet-titel").style.viewTransitionName = ""; });
  };

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
      const teile = [];
      if (w.temp != null) teile.push(`${PS.zahl(w.temp, 1)}°`);
      if (w.feuchte != null) teile.push(`${PS.zahl(w.feuchte, 0)} %`);
      teile.push(w.lichterAn ? `${w.lichterAn} Licht${w.lichterAn > 1 ? "er" : ""}` : "Licht aus");
      return `<div data-b="${PS.esc(b)}"><span>${PS.esc(PS.bereichName(b))}</span><span>${teile.join(" · ")}</span></div>`;
    }).join("");
    box.querySelectorAll("[data-b]").forEach((el) => el.addEventListener("click", () => PS.mitUebergang(el, () => PS.oeffnen("raeume", el.dataset.b))));
  }

  // ------------------------------------------------------------ Modulleiste und Sheet
  const stapel = [];
  let zuletztBeruehrt = Date.now();
  function dock() {
    const mods = ["start", ...(PS.einst.module || [])].filter((m) => PS.modulDa(m) || m === "start");
    $("#dock").innerHTML = mods.map((m) => {
      const def = m === "start" ? { titel: "Start", icon: "home" } : PS.module[m];
      const zahl = def.zaehler ? def.zaehler() : 0;
      return `<button data-m="${m}">${PS.ic(def.icon)}${zahl ? `<span class="zaehler">${zahl}</span>` : ""}${PS.esc(def.titel)}</button>`;
    }).join("");
    $("#dock").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (b.dataset.m === "start" ? PS.schliessen() : PS.oeffnen(b.dataset.m))));
    markieren();
  }
  function markieren() {
    const aktiv = stapel.length ? stapel[0].modul : "start";
    document.querySelectorAll("#dock button").forEach((b) => b.classList.toggle("aktiv", b.dataset.m === aktiv));
  }
  PS.oeffnen = (modul, arg) => {
    const def = PS.module[modul]; if (!def) return;
    stapel.length = 0;
    stapel.push({ modul, titel: def.titel, render: (el) => def.render(el, arg) });
    document.body.classList.add("offen"); document.body.classList.remove("ruhe");
    zeichnen(); markieren();
    if (arg && def.unterseite) def.unterseite(arg);
  };
  PS.unterseite = (titel, render) => { stapel.push({ modul: stapel[0] && stapel[0].modul, titel, render }); zeichnen(); };
  PS.seiteErsetzen = (titel, render) => { if (!stapel.length) return; stapel[stapel.length - 1] = { modul: stapel[0].modul, titel, render }; zeichnen(true); };
  PS.schliessen = () => {
    document.body.classList.remove("offen"); stapel.length = 0; markieren();
    $("#sheet-inhalt").querySelectorAll("img").forEach(PS.kameraStoppen); PS.emit("seite");
    setTimeout(() => { if (!stapel.length) $("#sheet-inhalt").innerHTML = ""; }, 700);
  };
  function zurueck() { if (stapel.length > 1) { stapel.pop(); zeichnen(); } else PS.schliessen(); }
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
  PS.neuZeichnen = () => { if (stapel.length) { const y = $("#sheet-inhalt").scrollTop; zeichnen(true); $("#sheet-inhalt").scrollTop = y; } };
  // Modulband im Seitenkopf, auf allen Modulseiten gleich (Seiten mit eigenen Reitern ersetzen es über PS.tabs)
  function modulBand(aktiv) {
    const mods = (PS.einst.module || []).filter((m) => PS.modulDa(m) && m !== "suche");
    PS.tabs(mods.map((m) => [m, PS.module[m].titel]), aktiv, (k) => PS.oeffnen(k));
  }
  PS.tabs = (eintraege, aktiv, beiWahl, box = $("#sheet-tabs")) => {
    box.innerHTML = eintraege.map(([k, t]) => `<button data-k="${PS.esc(k)}" class="${k === aktiv ? "aktiv" : ""}">${PS.esc(t)}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      box.querySelectorAll("button").forEach((x) => x.classList.toggle("aktiv", x === b)); beiWahl(b.dataset.k);
    }));
  };

  // ------------------------------------------------------------ Ereignis (Tür)
  function ereignis(e) {
    const an = !!(e && e.aktiv);
    document.body.classList.toggle("ereignis-an", an);
    const box = $("#ereignis-kamera");
    if (!an) { PS.kameraLiveStoppen(box.parentElement); box._eid = null; return; }
    document.body.classList.remove("ruhe");
    $("#ereignis-titel").textContent = e.titel || "Tür";
    // Läuft das Overlay schon mit derselben Kamera, nur den Titel nachführen (kein Neustart des Streams)
    if (e.kamera && !(box._eid === e.kamera && box.classList.contains("live") && box._stop)) { PS.kameraLive(box, e.kamera); box._eid = e.kamera; }
    $("#ereignis-oeffnen").hidden = !e.tueroeffner;
  }

  // ------------------------------------------------------------ Aufbau
  function alles() {
    uhr(); wetter(); personen(); statusZeile(); schnellzugriff(); raeumeKurz(); dock(); gruss();
  }
  PS.on("init", () => { alles(); vorhersageLaden(); stuendlichLaden(); termineLaden(); feedAufbauen(); if (stapel.length) PS.neuZeichnen(); });
  let letzterModus = null;
  PS.on("modus", () => {
    // Weckstrahl beim Aufwachen (Konzept Stufe 3), Feed neu: in Ruhe ohne leere Karte
    if (letzterModus === "ruhe" && PS.modus === "wach" && !document.body.classList.contains("ohne-animation")) {
      const w = $(".weckstrahl"); w.classList.remove("an"); void w.offsetWidth; w.classList.add("an");
    }
    letzterModus = PS.modus;
    feedAufbauen();
  });
  PS.on("karten", () => { feedAufbauen(); statusZeile(); gruss(); });
  PS.on("popups", (neu) => {
    statusZeile();
    if (stapel.length && stapel[0].modul === "hinweise") PS.neuZeichnen();
    // Wie an den Panels: hoch weckt und öffnet sofort, normal öffnet, wenn jemand am Panel ist, niedrig nur Glocke
    const m = neu && (PS.popups || []).find((x) => x.id === neu);
    if (!m) return;
    PS.alarmTon(m);
    if (document.body.classList.contains("ereignis-an")) return;
    if (m.prio === "high" || (m.prio === "normal" && PS.modus === "wach")) { document.body.classList.remove("ruhe"); PS.popupZeigen(neu); }
  });
  PS.on("meldungen", () => { statusZeile(); if (stapel.length && stapel[0].modul === "hinweise") PS.neuZeichnen(); });
  PS.on("ereignis", ereignis);
  PS.on("einstellungen", () => { schnellzugriff(); raeumeKurz(); dock(); zeigen(false); gruss(); });
  PS.on("registry", () => { raeumeKurz(); });
  let diffTimer = null;
  PS.on("diff", (ids) => {
    const relevant = [...ids].some((e) => e.startsWith("person.") || e.startsWith("binary_sensor.") || e.startsWith("lock.") || e === PS.opt.alarm_entitaet || e === PS.opt.wetter_entitaet || e === PS.opt.aussentemperatur || e.startsWith("sensor.") || e.startsWith("light.") || e.startsWith("climate.") || e.startsWith("update."));
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
      PS.dienst(PS.domain(PS.opt.tueroeffner), PS.domain(PS.opt.tueroeffner) === "lock" ? "open" : "press", { entity_id: PS.opt.tueroeffner }).then(() => PS.toast("Tür geöffnet"));
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
      const frist = stapel[0] && stapel[0].modul === "studio" ? 600 : PS.einst.bedienung_zurueck_s || 60;
      if (document.body.classList.contains("offen") && Date.now() - zuletztBeruehrt > frist * 1000) PS.schliessen();
    }, 5000);
    // Wischen im Sheet nach unten (am Kopf) schließt
    let y0 = null;
    $(".sheet-kopf").addEventListener("pointerdown", (e) => { y0 = e.clientY; });
    $(".sheet-kopf").addEventListener("pointerup", (e) => { if (y0 != null && e.clientY - y0 > 80) PS.schliessen(); y0 = null; });
    try { if ("wakeLock" in navigator) navigator.wakeLock.request("screen").catch(() => {}); } catch { /* optional */ }
    PS.verbinden();
  });
})();
