/* PM Panel Studio – Module. Jedes Modul baut seine Inhalte aus der Registry auf, damit keine Funktion
   aus dem bisherigen Dashboard verloren geht: neue Geräte erscheinen automatisch an der passenden Stelle. */
(function () {
  "use strict";
  const PS = window.PS;
  const E = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const alle = () => Object.keys(PS.z);
  const imBereich = (b) => alle().filter((e) => PS.bereichVon(e) === b && PS.sichtbar(e));
  const istGruppe = (e) => Array.isArray(PS.a(e).entity_id) && PS.a(e).entity_id.length > 0;
  const dom = (d) => (e) => PS.domain(e) === d;
  const bereicheSortiert = () => {
    const ordnung = PS.einst.bereiche_reihenfolge || [], aus = new Set(PS.einst.bereiche_ausblenden || []);
    return PS.bereiche.filter((b) => !aus.has(b.id)).sort((x, y) => {
      const ix = ordnung.indexOf(x.id), iy = ordnung.indexOf(y.id);
      if (ix !== iy) return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy);
      return (x.etage_level ?? 0) - (y.etage_level ?? 0) || String(x.name).localeCompare(y.name, "de");
    });
  };
  function gruppe(titel, inhalt, aktion) {
    const g = E(`<section class="gruppe"><h3><span>${PS.esc(titel)}</span></h3></section>`);
    if (aktion) { aktion.classList.add("aktion"); g.querySelector("h3").appendChild(aktion); }
    if (typeof inhalt === "string") g.insertAdjacentHTML("beforeend", inhalt); else if (inhalt) g.appendChild(inhalt);
    return g;
  }
  function kachelRaster(ids, bereichName, breit = false) {
    if (!ids.length) return null;
    return E(`<div class="raster${breit ? " breit" : ""}">${ids.map((e, i) => PS.kachelHTML(e, { i, bereich: bereichName })).join("")}</div>`);
  }
  function knopf(text, icon, fn, klasse = "") {
    const b = E(`<button class="knopf ${klasse}">${icon ? PS.ic(icon) : ""}${text ? `<span>${PS.esc(text)}</span>` : ""}</button>`);
    if (fn) b.addEventListener("click", fn); return b;
  }
  const sortName = (bn) => (x, y) => PS.kurzname(x, bn).localeCompare(PS.kurzname(y, bn), "de");
  // Zahl der Einträge in einer Unteransicht neu zeichnen, wenn sich dort etwas ändert (gedrosselt)
  let neuTimer = null, beobachtet = null;
  PS.on("diff", (ids) => {
    if (!beobachtet || !document.body.classList.contains("offen")) return;
    if (![...ids].some(beobachtet)) return;
    clearTimeout(neuTimer);
    const versuch = () => {
      // Während der Bedienung (letzte Berührung < 3 s) nicht neu aufbauen
      if (Date.now() - letzteBeruehrung < 3000) { neuTimer = setTimeout(versuch, 1000); return; }
      PS.neuZeichnen();
    };
    neuTimer = setTimeout(versuch, 700);
  });
  let letzteBeruehrung = 0;
  PS.on("beruehrt", () => { letzteBeruehrung = Date.now(); });
  const beobachten = (fn) => { beobachtet = fn; };

  // ------------------------------------------------------------ Räume
  const ABSCHNITTE = [
    ["Licht", (e) => dom("light")(e)],
    ["Klima", (e) => dom("climate")(e) || dom("fan")(e) || dom("humidifier")(e) || dom("water_heater")(e)],
    ["Rollos und Fenster", (e) => dom("cover")(e) || dom("valve")(e)],
    ["Medien", (e) => dom("media_player")(e) || dom("remote")(e)],
    ["Szenen", (e) => dom("scene")(e) || dom("script")(e)],
    ["Schalter", (e) => ["switch", "input_boolean", "lock", "vacuum", "siren", "button", "input_button", "lawn_mower"].includes(PS.domain(e))],
    ["Einstellungen", (e) => ["number", "input_number", "select", "input_select", "input_text", "input_datetime", "timer", "counter"].includes(PS.domain(e))],
    ["Kameras", (e) => dom("camera")(e)],
    ["Sensoren", (e) => dom("sensor")(e) || dom("binary_sensor")(e) || dom("event")(e)],
  ];
  function raumAnsicht(el, b) {
    const name = PS.bereichName(b);
    const ids = imBereich(b);
    const klima = ids.filter(dom("climate"));
    if (klima.length) { const r = E('<div class="raster breit"></div>'); klima.forEach((k) => r.appendChild(PS.klimaSteuerung(k))); el.appendChild(gruppe("Heizung", r)); }
    const lichter = ids.filter(dom("light")).filter((e) => !istGruppe(e));
    for (const [titel, filter] of ABSCHNITTE) {
      let teil = ids.filter(filter).filter((e) => !(titel === "Licht" && istGruppe(e)) && !(titel === "Klima" && dom("climate")(e)));
      if (!teil.length) continue;
      teil.sort(sortName(name));
      if (titel === "Kameras") {
        const r = E('<div class="raster breit"></div>');
        teil.forEach((c) => { const k = E(`<div class="kamera"><img alt=""><span>${PS.esc(PS.kurzname(c, name))}</span></div>`); k.addEventListener("click", () => PS.mehrInfos(c)); k.querySelector("img").src = PS.bildUrl(`/api/camera_proxy/${c}`); r.appendChild(k); });
        el.appendChild(gruppe(titel, r)); continue;
      }
      const aktion = titel === "Licht" && lichter.length > 1 ? knopf("Alle aus", "lightbulb-group-off-outline", () => PS.dienst("light", "turn_off", { entity_id: lichter })) : null;
      el.appendChild(gruppe(titel, kachelRaster(teil, name), aktion));
    }
    if (!ids.length) el.appendChild(E('<div class="leer">Diesem Bereich sind keine Geräte zugeordnet.</div>'));
    beobachten((e) => PS.bereichVon(e) === b && dom("climate")(e));
  }
  function raumKarte(b, i) {
    const w = PS.raumWerte(b.id);
    const chips = [];
    if (w.lichterAn) chips.push(`<span class="chip an">${PS.ic("lightbulb")}${w.lichterAn}</span>`);
    const offen = w.ent.filter((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on" && ["door", "window", "opening"].includes(PS.a(e).device_class));
    if (offen.length) chips.push(`<span class="chip warn">${PS.ic("window-open-variant")}${offen.length} offen</span>`);
    const bew = w.ent.find((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on" && ["motion", "occupancy", "presence"].includes(PS.a(e).device_class));
    if (bew) chips.push(`<span class="chip">${PS.ic("motion-sensor")}Bewegung</span>`);
    const medien = w.ent.find((e) => e.startsWith("media_player.") && PS.s(e) === "playing");
    if (medien) chips.push(`<span class="chip an">${PS.ic("play")}${PS.esc(PS.kurzname(medien, b.name))}</span>`);
    if (w.klima && PS.a(w.klima).hvac_action === "heating") chips.push(`<span class="chip warn">${PS.ic("fire")}heizt</span>`);
    const k = E(`<div class="raum" style="--i:${i}"><div class="oben">${PS.ic(b.icon || "texture-box")}<b>${PS.esc(b.name)}</b></div>
      <div class="werte">${w.temp != null ? `<span>${PS.ic("thermometer")} ${PS.zahl(w.temp, 1)}°</span>` : ""}${w.feuchte != null ? `<span>${PS.ic("water-percent")} ${PS.zahl(w.feuchte, 0)} %</span>` : ""}</div>
      <div class="chips">${chips.join("")}</div></div>`);
    k.addEventListener("click", () => PS.unterseite(b.name, (el) => raumAnsicht(el, b.id)));
    return k;
  }

  // ------------------------------------------------------------ Module
  PS.module = {
    raeume: {
      titel: "Räume", icon: "floor-plan",
      render(el) {
        const r = E('<div class="raster"></div>');
        bereicheSortiert().forEach((b, i) => r.appendChild(raumKarte(b, i)));
        el.appendChild(r);
        const ohne = alle().filter((e) => !PS.bereichVon(e) && PS.sichtbar(e) && ["light", "switch", "cover", "climate", "media_player", "fan", "lock"].includes(PS.domain(e)));
        if (ohne.length) el.appendChild(gruppe("Ohne Bereich", kachelRaster(ohne.sort(sortName()))));
        beobachten((e) => ["light", "climate", "binary_sensor", "media_player", "sensor"].includes(PS.domain(e)));
      },
      unterseite(b) { PS.unterseite(PS.bereichName(b), (el) => raumAnsicht(el, b)); },
    },

    klima: {
      titel: "Klima", icon: "thermostat",
      render(el) {
        const thermo = alle().filter(dom("climate")).filter((e) => PS.sichtbar(e) && !PS.nichtDa(e));
        const r = E('<div class="raster breit"></div>'); thermo.sort(sortName()).forEach((t) => r.appendChild(PS.klimaSteuerung(t)));
        if (thermo.length) el.appendChild(gruppe("Heizung", r));
        const empf = alle().find((e) => e === "sensor.pm_klima_empfehlung");
        if (empf) el.appendChild(gruppe("Empfehlung", kachelRaster([empf], undefined, true)));
        // Raumklima je Bereich
        const zeilen = bereicheSortiert().map((b) => ({ b, w: PS.raumWerte(b.id) })).filter((x) => x.w.temp != null || x.w.feuchte != null);
        el.appendChild(gruppe("Raumklima", E(`<div class="liste">${zeilen.map(({ b, w }) => `<div class="zeile" data-b="${PS.esc(b.id)}">${PS.ic(b.icon || "texture-box")}<span class="n">${PS.esc(b.name)}</span><span class="w">${w.temp != null ? PS.zahl(w.temp, 1) + "°" : ""}${w.feuchte != null ? " · " + PS.zahl(w.feuchte, 0) + " %" : ""}</span></div>`).join("")}</div>`)));
        el.querySelectorAll("[data-b]").forEach((z) => z.addEventListener("click", () => PS.module.raeume.unterseite(z.dataset.b)));
        const aussen = ["sensor.aussentemperatur", "sensor.aussenluftfeuchte", "sensor.zuhause_uv_index", "sensor.zuhause_windgeschwindigkeit", "sensor.niederschlag_lokal", "sensor.wetterstation_kohlendioxid", "sensor.wetterstation_atmospharischer_druck"].filter((e) => PS.z[e]);
        if (aussen.length) el.appendChild(gruppe("Außen", kachelRaster(aussen)));
        const luft = alle().filter((e) => e.startsWith("sensor.") && PS.sichtbar(e) && ["carbon_dioxide", "pm25", "volatile_organic_compounds", "aqi"].includes(PS.a(e).device_class));
        if (luft.length) el.appendChild(gruppe("Luftqualität", kachelRaster(luft.sort(sortName()))));
        const sonst = alle().filter((e) => (dom("fan")(e) || dom("humidifier")(e)) && PS.sichtbar(e));
        if (sonst.length) el.appendChild(gruppe("Lüfter und Luftreiniger", kachelRaster(sonst.sort(sortName()))));
        if (PS.opt.klima_studio_url) el.appendChild(gruppe("Heizpläne", knopf("Klima Studio öffnen", "calendar-week", () => { location.href = PS.opt.klima_studio_url; }, "primaer")));
        beobachten(dom("climate"));
      },
    },

    licht: {
      titel: "Licht", icon: "lightbulb-group",
      render(el) {
        const lichter = alle().filter(dom("light")).filter((e) => PS.sichtbar(e) && !istGruppe(e));
        const an = lichter.filter((e) => PS.s(e) === "on");
        const allesAus = knopf(`Alle aus (${an.length})`, "lightbulb-group-off", null, "gefahr");
        PS.halten(allesAus, 1200, () => PS.dienst("light", "turn_off", { entity_id: an }).then(() => PS.toast("Alle Lichter aus")), () => an.length > 3);
        if (an.length) el.appendChild(gruppe("Gerade an", kachelRaster(an.sort(sortName())), allesAus));
        for (const b of bereicheSortiert()) {
          const teil = lichter.filter((e) => PS.bereichVon(e) === b.id).sort(sortName(b.name));
          if (!teil.length) continue;
          const szenen = alle().filter((e) => dom("scene")(e) && PS.bereichVon(e) === b.id && PS.sichtbar(e));
          const g = gruppe(b.name, kachelRaster([...teil, ...szenen], b.name), teil.length > 1 ? knopf("Aus", "lightbulb-off-outline", () => PS.dienst("light", "turn_off", { entity_id: teil })) : null);
          el.appendChild(g);
        }
        const ohne = lichter.filter((e) => !PS.bereichVon(e));
        if (ohne.length) el.appendChild(gruppe("Ohne Bereich", kachelRaster(ohne.sort(sortName()))));
      },
    },

    sicherheit: {
      titel: "Sicherheit", icon: "shield-home",
      zaehler: () => alle().filter((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on" && ["smoke", "moisture", "gas", "carbon_monoxide", "safety"].includes(PS.a(e).device_class)).length,
      render(el) {
        const alarm = alle().filter(dom("alarm_control_panel")).filter(PS.sichtbar);
        if (alarm.length) { const r = E('<div class="raster breit"></div>'); alarm.forEach((a) => r.appendChild(PS.alarmSteuerung(a))); el.appendChild(gruppe("Alarmanlage", r)); }
        const zugang = [...alle().filter(dom("lock")), ...(PS.opt.tueroeffner && PS.z[PS.opt.tueroeffner] ? [PS.opt.tueroeffner] : [])].filter(PS.sichtbar);
        if (zugang.length) el.appendChild(gruppe("Zugang", kachelRaster(zugang)));
        const bs = (klassen) => alle().filter((e) => e.startsWith("binary_sensor.") && PS.sichtbar(e) && klassen.includes(PS.a(e).device_class));
        const kontakte = bs(["door", "window", "opening", "garage_door"]).sort((x, y) => (PS.s(y) === "on") - (PS.s(x) === "on") || sortName()(x, y));
        const offen = kontakte.filter((e) => PS.s(e) === "on");
        el.appendChild(gruppe(offen.length ? `Türen und Fenster · ${offen.length} offen` : "Türen und Fenster · alles zu", kachelRaster(kontakte)));
        const gefahr = bs(["smoke", "moisture", "gas", "carbon_monoxide", "safety", "tamper"]);
        if (gefahr.length) el.appendChild(gruppe("Melder", kachelRaster(gefahr.sort(sortName()))));
        const kameras = alle().filter(dom("camera")).filter((e) => PS.sichtbar(e) && !PS.nichtDa(e));
        if (kameras.length) {
          const r = E('<div class="raster breit"></div>');
          const imgs = kameras.map((c) => { const k = E(`<div class="kamera"><img alt=""><span>${PS.esc(PS.name(c))}</span></div>`); k.addEventListener("click", () => PS.mehrInfos(c)); r.appendChild(k); return [c, k.querySelector("img")]; });
          const laden = () => { if (!r.isConnected) return clearInterval(t); imgs.forEach(([c, img]) => { img.src = PS.bildUrl(`/api/camera_proxy/${c}`); }); };
          const t = setInterval(laden, 4000); laden();
          el.appendChild(gruppe("Kameras", r));
        }
        const aufnahme = alle().filter((e) => e.startsWith("switch.") && /aufzeichn|aufnahme|record|privacy|voralarm|sirene/i.test(e) && PS.sichtbar(e));
        if (aufnahme.length) el.appendChild(gruppe("Kamera-Einstellungen", kachelRaster(aufnahme.sort(sortName()))));
        const bewegung = bs(["motion", "occupancy", "presence"]).sort((x, y) => (PS.s(y) === "on") - (PS.s(x) === "on") || sortName()(x, y));
        if (bewegung.length) el.appendChild(gruppe("Bewegung", kachelRaster(bewegung)));
        beobachten((e) => dom("alarm_control_panel")(e));
      },
    },

    medien: {
      titel: "Medien", icon: "play-circle",
      render(el) {
        const player = alle().filter(dom("media_player")).filter(PS.sichtbar);
        const aktiv = player.filter((p) => ["playing", "paused", "on", "idle", "buffering"].includes(PS.s(p)));
        const r = E('<div class="raster breit"></div>');
        aktiv.sort((x, y) => (PS.s(y) === "playing") - (PS.s(x) === "playing")).forEach((p) => r.appendChild(PS.medienSteuerung(p, false)));
        el.appendChild(gruppe("Aktiv", aktiv.length ? r : E('<div class="leer">Gerade spielt nichts.</div>')));
        const rest = player.filter((p) => !aktiv.includes(p));
        if (rest.length) el.appendChild(gruppe("Alle Player", kachelRaster(rest.sort(sortName()))));
        const fern = alle().filter(dom("remote")).filter(PS.sichtbar);
        if (fern.length) el.appendChild(gruppe("Fernbedienungen", kachelRaster(fern)));
        beobachten(dom("media_player"));
      },
    },

    listen: {
      titel: "Listen", icon: "clipboard-text",
      render(el) {
        const listen = alle().filter(dom("todo")).filter(PS.sichtbar).sort((x, y) => (y.includes("einkauf") || y.includes("shopping")) - (x.includes("einkauf") || x.includes("shopping")) || sortName()(x, y));
        const tabs = [...listen.map((l) => [l, PS.name(l)]), ["kalender", "Kalender"], ...(PS.z["sensor.pmn_angebote_alle"] ? [["angebote", "Angebote"]] : [])];
        const box = E("<div></div>"); el.appendChild(box);
        const wahl = (k) => { box.innerHTML = ""; if (k === "kalender") kalender(box); else if (k === "angebote") angebote(box); else todo(box, k); };
        PS.tabs(tabs, tabs[0] && tabs[0][0], wahl);
        if (tabs[0]) wahl(tabs[0][0]);
      },
    },

    energie: {
      titel: "Energie", icon: "lightning-bolt",
      render(el) {
        const leistung = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "power" && PS.sichtbar(e) && isFinite(Number(PS.s(e))));
        leistung.sort((x, y) => Number(PS.s(y)) - Number(PS.s(x)));
        const max = Math.max(1, ...leistung.map((e) => Math.abs(Number(PS.s(e)))));
        const summe = leistung.reduce((s, e) => s + Math.max(0, Number(PS.s(e))), 0);
        const liste = E(`<div>${leistung.map((e) => `<div class="balken-zeile" data-eid="${PS.esc(e)}"><span>${PS.esc(PS.name(e))}</span><span class="w">${PS.esc(PS.text(e))}</span><div class="bar"><i style="width:${(Math.abs(Number(PS.s(e))) / max) * 100}%"></i></div></div>`).join("")}</div>`);
        liste.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => PS.mehrInfos(z.dataset.eid)));
        el.appendChild(gruppe(`Leistung jetzt · ${PS.zahl(summe, 0)} W gesamt`, leistung.length ? liste : E('<div class="leer">Keine Leistungssensoren gefunden.</div>')));
        if (leistung[0]) { const d = E("<div></div>"); el.appendChild(gruppe(`Verlauf 24 h · ${PS.name(leistung[0])}`, d)); PS.diagramm(d, leistung[0], 24); }
        const energie = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "energy" && PS.sichtbar(e) && !PS.nichtDa(e));
        if (energie.length) el.appendChild(gruppe("Zähler", kachelRaster(energie.sort(sortName()))));
        const steckdosen = alle().filter((e) => e.startsWith("switch.") && PS.sichtbar(e) && leistung.some((l) => PS.reg[l] && PS.reg[e] && PS.reg[l].d && PS.reg[l].d === PS.reg[e].d));
        if (steckdosen.length) el.appendChild(gruppe("Geschaltete Verbraucher", kachelRaster(steckdosen.sort(sortName()))));
        beobachten((e) => leistung.includes(e));
      },
    },

    wartung: {
      titel: "Wartung", icon: "wrench",
      zaehler: () => wartungsListe().batterien.filter((e) => Number(PS.s(e)) < 20).length + alle().filter((e) => e.startsWith("update.") && PS.s(e) === "on" && PS.sichtbar(e)).length,
      render(el) {
        const tabs = [["uebersicht", "Übersicht"], ["batterien", "Batterien"], ["erreichbar", "Nicht erreichbar"], ["protokoll", "Protokoll"], ["automationen", "Automationen"]];
        const box = E("<div></div>"); el.appendChild(box);
        const wahl = (k) => { box.innerHTML = ""; ({ uebersicht, batterien, erreichbar, protokoll, automationen })[k](box); PS.kachelnBinden(box); };
        PS.tabs(tabs, "uebersicht", wahl); wahl("uebersicht");
      },
    },

    suche: {
      titel: "Suche", icon: "magnify",
      render(el) {
        const feld = E('<input class="feld" id="suche-feld" type="search" placeholder="Gerät, Raum oder Entität suchen" autocomplete="off">');
        const domains = [...new Set(alle().map(PS.domain))].sort();
        const chips = E(`<div class="tabs" style="flex-wrap:wrap">${["alle", ...domains].map((d) => `<button data-d="${d}" class="${d === "alle" ? "aktiv" : ""}">${d === "alle" ? "Alle" : d}</button>`).join("")}</div>`);
        const ergebnis = E('<div class="liste"></div>');
        el.append(feld, chips, ergebnis);
        let domain = "alle";
        const suchen = () => {
          const q = feld.value.trim().toLowerCase();
          const treffer = alle().filter((e) => (domain === "alle" || PS.domain(e) === domain) && (!q || e.includes(q) || PS.name(e).toLowerCase().includes(q) || String(PS.bereichName(PS.bereichVon(e)) || "").toLowerCase().includes(q)));
          treffer.sort(sortName());
          ergebnis.innerHTML = treffer.slice(0, 150).map((e) => `<div class="zeile" data-eid="${PS.esc(e)}">${PS.icon(e)}<span class="n">${PS.esc(PS.name(e))}<small>${PS.esc(e)}${PS.bereichVon(e) ? " · " + PS.esc(PS.bereichName(PS.bereichVon(e))) : ""}</small></span><span class="w">${PS.esc(PS.text(e))}</span></div>`).join("") + (treffer.length > 150 ? `<div class="leer">${treffer.length - 150} weitere Treffer. Bitte die Suche eingrenzen.</div>` : "") + (!treffer.length ? '<div class="leer">Keine Treffer.</div>' : "");
          ergebnis.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => PS.mehrInfos(z.dataset.eid)));
        };
        feld.addEventListener("input", suchen);
        chips.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { domain = b.dataset.d; chips.querySelectorAll("button").forEach((x) => x.classList.toggle("aktiv", x === b)); suchen(); }));
        suchen();
        setTimeout(() => feld.focus(), 400);
      },
    },
  };

  // ------------------------------------------------------------ Listen
  async function todo(box, eid) {
    const kopf = E(`<div class="reihe" style="margin-bottom:1rem"></div>`);
    const feld = E('<input class="feld" type="text" placeholder="Neuer Eintrag" style="flex:1;min-width:14rem">');
    kopf.append(feld, knopf("Hinzufügen", "plus", hinzu, "primaer"));
    const liste = E('<div class="liste"><div class="leer">Wird geladen …</div></div>');
    box.append(kopf, liste);
    feld.addEventListener("keydown", (ev) => { if (ev.key === "Enter") hinzu(); });
    async function hinzu() {
      const t = feld.value.trim(); if (!t) return;
      await PS.dienst("todo", "add_item", { entity_id: eid, item: t }); feld.value = ""; laden();
    }
    async function laden() {
      try {
        const r = await PS.anfrage({ typ: "ws", befehl: { type: "todo/item/list", entity_id: eid } });
        const items = (r && r.items) || [];
        const offen = items.filter((i) => i.status !== "completed"), fertig = items.filter((i) => i.status === "completed");
        liste.innerHTML = [...offen, ...fertig].map((i) => `<div class="zeile${i.status === "completed" ? " erledigt" : ""}" data-uid="${PS.esc(i.uid)}" data-s="${i.status}">${PS.ic(i.status === "completed" ? "checkbox-marked-circle-outline" : "checkbox-blank-circle-outline")}<span class="n">${PS.esc(i.summary)}${i.due ? `<small>fällig ${PS.esc(i.due)}</small>` : i.description ? `<small>${PS.esc(i.description)}</small>` : ""}</span></div>`).join("") || '<div class="leer">Die Liste ist leer.</div>';
        if (fertig.length) liste.appendChild(knopf(`Erledigte entfernen (${fertig.length})`, "broom", () => PS.dienst("todo", "remove_completed_items", { entity_id: eid }).then(laden)));
        liste.querySelectorAll("[data-uid]").forEach((z) => z.addEventListener("click", () => PS.dienst("todo", "update_item", { entity_id: eid, item: z.dataset.uid, status: z.dataset.s === "completed" ? "needs_action" : "completed" }).then(laden)));
      } catch (e) { liste.innerHTML = `<div class="leer">Liste nicht lesbar: ${PS.esc(e.message)}</div>`; }
    }
    laden();
  }
  async function kalender(box) {
    const kals = alle().filter(dom("calendar")).filter(PS.sichtbar);
    const liste = E('<div class="liste"><div class="leer">Termine werden geladen …</div></div>'); box.appendChild(liste);
    const start = new Date(); start.setHours(0, 0, 0, 0); const ende = new Date(start.getTime() + 8 * 86400e3);
    const alleTermine = [];
    await Promise.all(kals.map(async (k) => {
      try {
        const r = await PS.anfrage({ typ: "rest", pfad: `calendars/${k}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(ende.toISOString())}` });
        (r || []).forEach((t) => alleTermine.push({ ...t, k }));
      } catch { /* einzelne Kalender dürfen fehlen */ }
    }));
    const zeit = (t) => t.dateTime || t.date;
    alleTermine.sort((x, y) => String(zeit(x.start)).localeCompare(String(zeit(y.start))));
    let tag = "";
    liste.innerHTML = alleTermine.map((t) => {
      const s = new Date(zeit(t.start)), ganz = !t.start.dateTime;
      const tagTxt = s.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
      const kopf = tagTxt !== tag ? `<h3 style="margin:1.4rem 0 .4rem;font-size:1rem;letter-spacing:.16em;text-transform:uppercase;color:var(--akzent)">${PS.esc(tagTxt)}</h3>` : "";
      tag = tagTxt;
      return `${kopf}<div class="zeile">${PS.ic("calendar")}<span class="n">${PS.esc(t.summary)}<small>${PS.esc(PS.name(t.k))}${t.location ? " · " + PS.esc(t.location) : ""}</small></span><span class="w">${ganz ? "ganztägig" : PS.uhrzeit(s)}</span></div>`;
    }).join("") || '<div class="leer">Keine Termine in den nächsten 7 Tagen.</div>';
  }
  async function angebote(box) {
    const feld = E('<input class="feld" type="search" placeholder="Angebote durchsuchen (z. B. Kaffee)">');
    const liste = E('<div class="liste"><div class="leer">Angebote werden geladen …</div></div>');
    box.append(feld, liste);
    let daten = [];
    try { daten = ((await PS.anfrage({ typ: "attribute", entity_id: "sensor.pmn_angebote_alle" })) || {}).angebote || []; } catch { daten = []; }
    const wunsch = PS.z["sensor.einkaufsliste_begriffe"] ? String(PS.s("sensor.einkaufsliste_begriffe")).toLowerCase().split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];
    const zeigen = () => {
      const q = feld.value.trim().toLowerCase();
      let t = daten.filter((a) => (q ? (a.such || a.titel || "").toLowerCase().includes(q) : wunsch.length ? wunsch.some((w) => (a.such || "").includes(w)) : true));
      t = t.slice(0, 120);
      liste.innerHTML = (q || !wunsch.length ? "" : '<div class="leer">Treffer zu Ihrer Einkaufsliste. Suche für alle Angebote.</div>') + t.map((a) => `<div class="zeile">${PS.ic("tag-outline")}<span class="n">${PS.esc(a.titel)}<small>${PS.esc(a.haendler)}${a.einheit ? " · " + PS.esc(a.einheit) : ""}${a.bis ? " · bis " + PS.esc(new Date(a.bis).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })) : ""}</small></span><span class="w">${a.preis != null ? PS.zahl(a.preis, 2) + " €" : ""}</span></div>`).join("") || '<div class="leer">Keine passenden Angebote.</div>';
    };
    feld.addEventListener("input", zeigen); zeigen();
  }

  // ------------------------------------------------------------ Wartung
  function wartungsListe() {
    const batterien = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "battery" && isFinite(Number(PS.s(e)))).sort((x, y) => Number(PS.s(x)) - Number(PS.s(y)));
    return { batterien };
  }
  function uebersicht(box) {
    const updates = alle().filter((e) => e.startsWith("update.") && PS.s(e) === "on" && PS.sichtbar(e));
    box.appendChild(gruppe(updates.length ? `Updates · ${updates.length}` : "Updates · alles aktuell", kachelRaster(updates)));
    const schwach = wartungsListe().batterien.filter((e) => Number(PS.s(e)) < 25);
    const binSchwach = alle().filter((e) => e.startsWith("binary_sensor.") && PS.a(e).device_class === "battery" && PS.s(e) === "on");
    box.appendChild(gruppe(schwach.length + binSchwach.length ? "Schwache Batterien" : "Batterien · alle über 25 %", kachelRaster([...schwach, ...binSchwach])));
    const material = alle().filter((e) => e.startsWith("sensor.") && PS.sichtbar(e) && /filter|burste|bürste|sensorzeit|verbrauch(smaterial)?|wartung|reinigung/i.test(e + " " + PS.name(e)) && !PS.nichtDa(e) && !["power", "energy", "temperature", "humidity"].includes(PS.a(e).device_class));
    if (material.length) box.appendChild(gruppe("Verbrauchsmaterial", kachelRaster(material.sort(sortName()))));
    const probleme = alle().filter((e) => e.startsWith("binary_sensor.") && PS.a(e).device_class === "problem" && PS.s(e) === "on");
    if (probleme.length) box.appendChild(gruppe("Problem-Meldungen", kachelRaster(probleme)));
  }
  function batterien(box) {
    const { batterien } = wartungsListe();
    const l = E(`<div>${batterien.map((e) => { const v = Number(PS.s(e)); return `<div class="balken-zeile${v < 25 ? " niedrig" : ""}" data-eid="${PS.esc(e)}"><span>${PS.esc(PS.name(e))}</span><span class="w">${PS.zahl(v, 0)} %</span><div class="bar"><i style="width:${Math.max(2, v)}%"></i></div></div>`; }).join("")}</div>`);
    l.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => PS.mehrInfos(z.dataset.eid)));
    box.appendChild(gruppe(`Alle Batterien · ${batterien.length}`, l));
  }
  function erreichbar(box) {
    const weg = alle().filter((e) => PS.s(e) === "unavailable" && PS.sichtbar(e) && !["button", "scene", "event"].includes(PS.domain(e)));
    const nachBereich = {};
    weg.forEach((e) => { const b = PS.bereichVon(e) || "_"; (nachBereich[b] = nachBereich[b] || []).push(e); });
    if (!weg.length) box.appendChild(E('<div class="leer">Alle Geräte antworten.</div>'));
    Object.keys(nachBereich).sort().forEach((b) => box.appendChild(gruppe(b === "_" ? "Ohne Bereich" : PS.bereichName(b), kachelRaster(nachBereich[b].sort(sortName())))));
  }
  async function protokoll(box) {
    const liste = E('<div class="liste"><div class="leer">Protokoll wird geladen …</div></div>'); box.appendChild(liste);
    const start = new Date(Date.now() - 12 * 3600e3);
    try {
      const r = await PS.anfrage({ typ: "rest", pfad: `logbook/${start.toISOString()}` });
      const eintraege = (r || []).slice(-150).reverse();
      liste.innerHTML = eintraege.map((e) => `<div class="zeile"${e.entity_id ? ` data-eid="${PS.esc(e.entity_id)}"` : ""}>${e.entity_id && PS.z[e.entity_id] ? PS.icon(e.entity_id) : PS.ic("history")}<span class="n">${PS.esc(e.name || e.entity_id || "")}<small>${PS.esc(e.message || (e.state ? PS.text(e.entity_id || "", e.state) : ""))}</small></span><span class="w">${PS.uhrzeit(new Date(e.when))}</span></div>`).join("") || '<div class="leer">Keine Einträge.</div>';
      liste.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => { if (PS.z[z.dataset.eid]) PS.mehrInfos(z.dataset.eid); }));
    } catch (e) { liste.innerHTML = `<div class="leer">Protokoll nicht verfügbar: ${PS.esc(e.message)}</div>`; }
  }
  function automationen(box) {
    const auto = alle().filter((e) => (dom("automation")(e) || dom("script")(e)) && PS.sichtbar(e)).sort(sortName());
    box.appendChild(gruppe(`Automationen und Skripte · ${auto.length}`, kachelRaster(auto)));
  }
})();
