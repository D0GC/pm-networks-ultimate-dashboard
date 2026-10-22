/* PM Panel Studio – Admin-Ansicht am PC (Eintrag „PM Dashboard“ in der Seitenleiste von Home Assistant).
   Dieselbe Seite wie das Wandpanel mit eigenem Layout: links die Modulleiste, oben die Kopfzeile, darunter eine
   anpassbare Startseite aus Blöcken. Module öffnen sich im Inhaltsbereich; dazu kommen die Admin-Seiten Türdienst,
   System, Terminal und Editor. Kein Ruhezustand, keine Rückkehr zur Startseite nach Zeit. */
(function () {
  "use strict";
  const PS = window.PS, $ = (s, r = document) => r.querySelector(s);
  const { E, box, raster, knopf, balken } = PS.bau;
  const alle = () => Object.keys(PS.z);
  const nameSort = (x, y) => PS.name(x).localeCompare(PS.name(y), "de");
  const num = (e) => Number(PS.s(e));

  // Admin-Seiten und Seiten von Home Assistant in der Modulleiste; Trennlinie vor der jeweils ersten jeder Gruppe
  const HA_MODULE = ["ha_einstellungen", "ha_karte", "ha_energie", "music_assistant"];
  PS.admin = {
    module: ["tuerdienst", "system", "terminal", "editor", ...HA_MODULE],
    klasse: (m) => (HA_MODULE.includes(m) ? "admin-modul ha-modul" : PS.admin.module.includes(m) ? "admin-modul" : ""),
  };
  document.body.classList.add("admin");

  // ------------------------------------------------------------ Laufband in der Kopfzeile
  // Passt der Inhalt nicht, folgt ihm eine Kopie und beide gleiten mit gleichmäßigem Tempo nach links; nach dem
  // letzten Eintrag beginnt nahtlos wieder der erste. Die Kopie wird bei jeder Änderung des Originals erneuert, das
  // Tempo bleibt (Wegstrecke und Dauer wachsen gemeinsam). Klicks auf die Kopie wirken wie auf das Original;
  // beim Zeigen hält das Band an, bei reduzierter Bewegung lässt es sich stattdessen von Hand schieben.
  const BAND_PX_S = 45;
  function bandEinrichten(band) {
    const innen = band.querySelector(".ak-band-innen"), teil = band.querySelector(".ak-band-teil");
    let klon = null, geplant = 0, weg = 0;
    const messen = () => {
      geplant = 0;
      const passt = teil.scrollWidth <= band.clientWidth + 1;
      band.classList.toggle("laeuft", !passt);
      if (passt) { if (klon) { klon.remove(); klon = null; } weg = 0; innen.style.removeProperty("--weg"); return; }
      const neu = teil.cloneNode(true);
      neu.classList.add("ak-band-klon"); neu.setAttribute("aria-hidden", "true");
      neu.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      if (klon) klon.replaceWith(neu); else innen.appendChild(neu);
      klon = neu;
      // Abstand zwischen Ende und Anfang ist der Spaltabstand des Bandes
      const w = teil.getBoundingClientRect().width + parseFloat(getComputedStyle(innen).columnGap || "0");
      if (Math.abs(w - weg) > 1) {
        weg = w;
        innen.style.setProperty("--weg", `${-w}px`);
        innen.style.setProperty("--dauer", `${(w / BAND_PX_S).toFixed(2)}s`);
      }
    };
    const vormerken = () => { if (!geplant) geplant = requestAnimationFrame(messen); };
    new MutationObserver((liste) => { if (liste.some((m) => !klon || !klon.contains(m.target))) vormerken(); })
      .observe(teil, { childList: true, subtree: true, characterData: true, attributes: true });
    if (window.ResizeObserver) new ResizeObserver(vormerken).observe(band);
    band.addEventListener("click", (ev) => {
      if (!klon || !klon.contains(ev.target)) return;
      const z = ev.target.closest("[data-eid],[data-modul]"); if (!z) return;
      if (z.dataset.eid) PS.mehrInfos(z.dataset.eid); else PS.oeffnen(z.dataset.modul);
    });
    vormerken();
  }

  // ------------------------------------------------------------ Aufbau: Kopfzeile und Startseite
  const start = $(".start");
  const kopf = E(`<header class="admin-kopf">
    <div class="ak-zeit"></div><div class="ak-lage"></div>
    <div class="ak-rechts"><button type="button" class="ak-suche" id="ak-suche">${PS.ic("magnify")}<span>Suchen</span><kbd>/</kbd></button></div>
  </header>`);
  kopf.querySelector(".ak-zeit").append($("#uhr"), $("#datum"));
  // Personen und Statuspillen laufen als Band durch (Bauchbinde), sobald sie nicht in die Kopfzeile passen
  const band = E('<div class="ak-band"><div class="ak-band-innen"><div class="ak-band-teil"></div></div></div>');
  band.querySelector(".ak-band-teil").append($("#personen"), $("#status"));
  kopf.querySelector(".ak-lage").append($("#wetter"), band);
  bandEinrichten(band);
  kopf.querySelector(".ak-rechts").append($("#glocke"));
  const seite = E(`<section class="admin-start" id="admin-start" aria-label="Startseite">
    <div class="as-kopf"><div><h1 id="as-gruss"></h1><p id="as-lage"></p></div>
      <div class="reihe" id="as-werkzeug"></div></div>
    <div class="as-raster" id="as-raster"></div>
    <div class="as-vorrat" id="as-vorrat" hidden></div>
  </section>`);
  start.prepend(kopf);
  start.appendChild(seite);
  $("#ak-suche").addEventListener("click", () => PS.oeffnen("suche"));
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target; if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    ev.preventDefault(); PS.oeffnen("suche");
  });

  // Kein Ruhezustand und kein Abdunkeln am PC
  PS.on("modus", () => { document.body.classList.remove("ruhe"); document.documentElement.style.setProperty("--abdunkeln", "0"); });

  // ------------------------------------------------------------ Helfer
  const AUFNAHMEN = { liste: [], zeit: 0 };
  async function aufnahmenLaden(anzahl = 10) {
    try {
      const r = await fetch("api/aufnahmen?anzahl=" + anzahl, { cache: "no-store" });
      if (r.ok) { AUFNAHMEN.liste = await r.json(); AUFNAHMEN.zeit = Date.now(); }
    } catch { /* bleibt beim letzten Stand */ }
    return AUFNAHMEN.liste;
  }
  const zeitText = (iso) => {
    const d = new Date(iso); if (isNaN(d)) return "";
    const heute = new Date().toDateString() === d.toDateString();
    return heute ? PS.uhrzeit(d) : `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${PS.uhrzeit(d)}`;
  };
  const leer = (text) => E(`<div class="leer">${PS.esc(text)}</div>`);
  const zeile = (icon, titel, unter, fn, rechts) => {
    const z = E(`<div class="zeile">${PS.ic(icon)}<span class="n">${PS.esc(titel)}${unter ? `<small>${PS.esc(unter)}</small>` : ""}</span></div>`);
    if (rechts) z.appendChild(rechts);
    if (fn) { z.classList.add("klickbar"); z.addEventListener("click", fn); }
    return z;
  };
  // Seite von Home Assistant im Dashboard öffnen (eingebettet, ohne die Seitenleiste von Home Assistant)
  // Aus einer offenen Seite heraus (z. B. „Automationen“) als Unterseite mit Zurück-Knopf, sonst als eigene Seite
  function haOeffnen(pfad, titel) {
    if (document.body.classList.contains("offen")) PS.unterseite(titel || "Home Assistant", (el) => haRahmen(el, pfad, titel, true));
    else PS.oeffnen("ha_seite", pfad);
  }
  PS.haOeffnen = haOeffnen;
  // Verbindung zu Home Assistant: in der Seitenleiste die des Frontends, als eigene App die der Startseite
  const haVerbindung = async () => {
    const t = window.top;
    if (!t || t === window || !t.hassConnection) return null;
    return (await t.hassConnection).conn;
  };
  PS.admin.verbindung = haVerbindung;
  // Seitenleiste von Home Assistant im eingebetteten Rahmen: Modus „immer ausblenden“ (wie im Profil), dann entfällt auch
  // der freigehaltene Platz. Home Assistant speichert die Wahl im Browser; der alte Wert wird sofort wiederhergestellt,
  // damit Home Assistant im normalen Browserfenster unverändert bleibt.
  function seitenleisteAus(frame) {
    let n = 0;
    const t = setInterval(() => {
      if (++n > 120 || !frame.isConnected) { clearInterval(t); return; }
      try {
        const w = frame.contentWindow, d = frame.contentDocument;
        const ha = d && d.querySelector("home-assistant");
        if (!ha || !ha.hass) return;
        if (ha.hass.dockedSidebar !== "always_hidden") {
          let alt = null;
          try { alt = w.localStorage.getItem("dockedSidebar"); } catch { /* ohne Speicher */ }
          ha.dispatchEvent(new w.CustomEvent("hass-dock-sidebar", { detail: { dock: "always_hidden" }, bubbles: true, composed: true }));
          try { if (alt === null) w.localStorage.removeItem("dockedSidebar"); else w.localStorage.setItem("dockedSidebar", alt); } catch { /* egal */ }
        }
        clearInterval(t);
      } catch { clearInterval(t); }
    }, 250);
  }
  // Übersichten von Home Assistant, zu denen dessen Zurück-Pfeil aus Editoren und Detailseiten springt
  const HA_UEBERSICHTEN = ["/config/automation/dashboard", "/config/script/dashboard", "/config/scene/dashboard", "/config/devices/dashboard", "/config/entities"];
  function haRahmen(el, pfad, titel, unterseite) {
    el.classList.add("rahmen-seite");
    const f = E(`<iframe class="admin-rahmen ha-rahmen" title="${PS.esc(titel || "Home Assistant")}"></iframe>`);
    f.addEventListener("load", () => seitenleisteAus(f));
    f.src = pfad;
    el.appendChild(f);
    if (!unterseite) return;
    // Seiten unter /config haben einen eigenen Zurück-Pfeil (wird unten abgefangen): dann ohne Kopfzeile des Dashboards
    if (pfad.startsWith("/config/")) f.classList.add("eigener-kopf");
    // Zurück-Pfeil von Home Assistant: statt dessen Übersicht wieder die Seite des Dashboards zeigen, von der man kam
    const start = pfad.split("?")[0];
    const t = setInterval(() => {
      if (!f.isConnected) { clearInterval(t); return; }
      let p = "";
      try { p = f.contentWindow.location.pathname; } catch { return; }
      if (p && p !== start && HA_UEBERSICHTEN.some((u) => p.startsWith(u)) && !HA_UEBERSICHTEN.some((u) => start.startsWith(u))) {
        clearInterval(t); PS.zurueck();
      }
    }, 300);
  }
  // App über Ingress einbetten (erste gestartete aus der Liste der Kennungen oder mit passender Endung)
  async function appAdresse(slugs, endung) {
    const conn = await haVerbindung(); if (!conn) return null;
    let kandidaten = [...slugs];
    if (endung) {
      try {
        const l = await conn.sendMessagePromise({ type: "supervisor/api", endpoint: "/addons", method: "get" });
        kandidaten.push(...((l && l.addons) || []).map((a) => a.slug).filter((x) => x.endsWith(endung) && !kandidaten.includes(x)));
      } catch { /* nur die bekannten */ }
    }
    let gestoppt = null;
    for (const slug of kandidaten) {
      try {
        const info = await conn.sendMessagePromise({ type: "supervisor/api", endpoint: `/addons/${slug}/info`, method: "get" });
        if (info && info.ingress_url && info.state === "started") return { url: info.ingress_url, slug, name: info.name };
        if (info && info.ingress_url && !gestoppt) gestoppt = { slug, name: info.name, aus: true };
      } catch { /* nächste App */ }
    }
    return gestoppt;
  }
  function appSeite(titel, icon, slugs, endung, fehlt) {
    return {
      titel, icon,
      async render(el) {
        el.classList.add("rahmen-seite");
        const hinweis = E(`<div class="leer">${PS.esc(titel)} wird verbunden …</div>`); el.appendChild(hinweis);
        let a = null;
        try { a = await appAdresse(slugs, endung); } catch { a = null; }
        if (a && a.url) { hinweis.remove(); el.appendChild(E(`<iframe class="admin-rahmen" src="${PS.esc(a.url)}" title="${PS.esc(titel)}" allow="autoplay; clipboard-read; clipboard-write"></iframe>`)); return; }
        hinweis.textContent = a && a.aus ? `${a.name} ist gestoppt.` : fehlt;
        el.appendChild(knopf("In Home Assistant öffnen", "open-in-app", () => haOeffnen(`/hassio/ingress/${(a && a.slug) || slugs[0]}`)));
      },
    };
  }
  const HA_LINKS = [
    ["Automationen", "robot", "/config/automation/dashboard"], ["Skripte", "script-text-outline", "/config/script/dashboard"],
    ["Geräte und Dienste", "devices", "/config/integrations/dashboard"], ["Entitäten", "shape-outline", "/config/entities"],
    ["Helfer", "tools", "/config/helpers"], ["Apps", "puzzle-outline", "/hassio/dashboard"],
    ["Protokolle", "math-log", "/config/logs"], ["Entwicklerwerkzeuge", "hammer-wrench", "/developer-tools/state"],
    ["Verlauf", "chart-box-outline", "/history"], ["Logbuch", "format-list-bulleted", "/logbook"],
    ["Sicherungen", "backup-restore", "/config/backup"], ["Einstellungen", "cog-outline", "/config/dashboard"],
  ];

  // Räume in der Reihenfolge des Editors, ohne ausgeblendete
  function bereicheListe() {
    const aus = new Set(PS.einst.bereiche_ausblenden || []), folge = PS.einst.bereiche_reihenfolge || [];
    const rang = (id) => { const i = folge.indexOf(id); return i < 0 ? 999 : i; };
    return PS.bereiche.filter((x) => !aus.has(x.id)).sort((x, y) => rang(x.id) - rang(y.id) || x.name.localeCompare(y.name, "de"));
  }
  // Raumkachel: Name, Lichtschalter für alle Lichter des Raums, Temperatur und Feuchte, Zustände als Chips
  function raumKachel(x, oeffnen) {
    const w = PS.raumWerte(x.id);
    const lichter = PS.lichtAuswahl(w.ent, x.name).sichtbar;
    const teile = PS.raumkarte();
    const offen = w.ent.filter((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on" && ["door", "window", "opening", "garage_door"].includes(PS.a(e).device_class));
    const medien = w.ent.find((e) => e.startsWith("media_player.") && PS.s(e) === "playing");
    const an = lichter.filter((e) => PS.s(e) === "on").length;
    const hatWert = (teile.includes("temp") && w.temp != null) || (teile.includes("feuchte") && w.feuchte != null);
    const stueck = {
      temp: w.temp != null ? `<span class="tabular">${PS.zahl(w.temp, 1)}°</span>` : "",
      feuchte: w.feuchte != null ? `<small class="tabular">${PS.ic("water-percent")}${PS.zahl(w.feuchte, 0)} %</small>` : "",
      anzahl: hatWert ? "" : `<small>${w.ent.length} ${w.ent.length === 1 ? "Gerät" : "Geräte"}</small>`,
      licht: lichter.length ? `<button type="button" class="licht${an ? " an" : ""}" title="${an ? "Lichter ausschalten" : "Lichter einschalten"}">${PS.ic(an ? "lightbulb-on" : "lightbulb-outline")}<span class="tabular">${an}/${lichter.length}</span></button>` : "",
      offen: offen.length ? `<i class="warn">${PS.ic("window-open-variant")}${offen.length} offen</i>` : "",
      heizt: w.klima && PS.a(w.klima).hvac_action === "heating" ? `<i class="warn">${PS.ic("fire")}heizt</i>` : "",
      medien: medien ? `<i class="an">${PS.ic("play")}${PS.esc(PS.kurzname(medien, x.name))}</i>` : "",
      bewegung: w.ent.some((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on" && ["motion", "occupancy", "presence"].includes(PS.a(e).device_class)) ? `<i>${PS.ic("motion-sensor")}Bewegung</i>` : "",
    };
    const zone = (wert) => teile.filter((t) => PS.RAUMKARTE_WERTE.includes(t) === wert).map((t) => stueck[t] || "").join("");
    const k = E(`<div class="as-raum" data-raum="${PS.esc(x.id)}" role="button" tabindex="0">
      <div class="kopf">${PS.ic(x.icon || "texture-box")}<span class="n">${PS.esc(x.name)}</span></div>
      <div class="w">${zone(true)}</div>
      <div class="c">${zone(false)}</div></div>`);
    const l = k.querySelector(".licht");
    if (l) l.addEventListener("click", (ev) => { ev.stopPropagation(); PS.dienst("light", an ? "turn_off" : "turn_on", { entity_id: lichter }); });
    k.addEventListener("click", oeffnen);
    k.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); oeffnen(); } });
    return k;
  }
  // Seite „Räume“ am PC: dieselben Kacheln im breiten Raster statt der Panel-Karten
  const RAEUME = PS.module.raeume;
  RAEUME.render = (el) => {
    const r = E('<div class="as-raeume voll"></div>');
    const fuellen = () => { r.innerHTML = ""; bereicheListe().forEach((x) => r.appendChild(raumKachel(x, () => RAEUME.unterseite(x.id)))); };
    fuellen(); r._fuellen = fuellen;
    el.appendChild(r);
  };
  let raeumeTimer = null;
  PS.on("diff", (ids) => {
    const r = document.querySelector("#sheet-inhalt .as-raeume.voll");
    if (!r || raeumeTimer || ![...ids].some((e) => /^(light|climate|sensor|media_player|binary_sensor)\./.test(e))) return;
    raeumeTimer = setTimeout(() => { raeumeTimer = null; if (r.isConnected && r._fuellen) r._fuellen(); }, 800);
  });

  // Thermostat als eine Zeile: Name (öffnet alle Einstellungen), Ist, Zustand, Soll mit − und +
  function thermoZeile(eid) {
    const a = PS.a(eid), pm = eid.startsWith("climate.pm_");
    const lo = a.min_temp ?? 5, hi = a.max_temp ?? 30, schritt = a.target_temp_step || 0.5;
    const z = E(`<div class="as-thermo" data-klima="${PS.esc(eid)}">
      <button type="button" class="n">${PS.icon(eid)}<span>${PS.esc(PS.kurzname(eid).replace(/^PM\s+/, ""))}</span></button>
      <span class="ist tabular"></span><span class="zst"></span>
      <span class="soll"><button type="button" class="knopf rund" aria-label="Kälter">${PS.ic("minus")}</button><b class="tabular"></b><button type="button" class="knopf rund" aria-label="Wärmer">${PS.ic("plus")}</button></span></div>`);
    let wunsch = a.temperature, timer = null;
    const zeigen = () => {
      const n = PS.a(eid);
      z.querySelector(".ist").textContent = n.current_temperature != null ? PS.zahl(n.current_temperature, 1) + "°" : "–";
      const heizt = n.hvac_action === "heating";
      z.classList.toggle("heizt", heizt);
      z.querySelector(".zst").textContent = heizt ? "heizt" : PS.s(eid) === "off" ? "aus" : n.preset_mode || "bereit";
      if (!timer) wunsch = n.temperature;
      z.querySelector(".soll b").textContent = wunsch != null ? PS.zahl(wunsch, 1) + "°" : "–";
    };
    const aendern = (d) => {
      if (wunsch == null) return;
      wunsch = Math.max(lo, Math.min(hi, Math.round((wunsch + d) / schritt) * schritt));
      z.querySelector(".soll b").textContent = PS.zahl(wunsch, 1) + "°";
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pm) PS.dienst("pm_heizung", "set_overlay", { entity_id: eid, temperatur: wunsch, dauer: 120 }).then(() => PS.toast(`${PS.zahl(wunsch, 1)}° für 2 Stunden`));
        else PS.dienst("climate", "set_temperature", { entity_id: eid, temperature: wunsch });
      }, 1200);
    };
    const [minus, plus] = z.querySelectorAll(".soll .knopf");
    minus.addEventListener("click", () => aendern(-schritt));
    plus.addEventListener("click", () => aendern(schritt));
    z.querySelector(".n").addEventListener("click", () => PS.mehrInfos(eid));
    z.aktualisieren = zeigen;
    zeigen();
    return z;
  }

  const energieTop = () => alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "power" && PS.sichtbar(e) && isFinite(num(e)))
    .sort((x, y) => num(y) - num(x));
  // Was eine Raumkachel zeigt, als Vergleichswert (Temperatur und Feuchte gerundet wie angezeigt)
  function raumSignatur(x) {
    const w = PS.raumWerte(x.id);
    const lichter = PS.lichtAuswahl(w.ent, x.name).sichtbar;
    return [x.id, w.temp != null ? PS.zahl(w.temp, 1) : null, w.feuchte != null ? PS.zahl(w.feuchte, 0) : null,
      lichter.filter((e) => PS.s(e) === "on").length, lichter.length, w.ent.length,
      w.ent.filter((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on").join(","),
      w.klima ? PS.a(w.klima).hvac_action : null, w.ent.filter((e) => e.startsWith("media_player.") && PS.s(e) === "playing").join(",")];
  }

  // ------------------------------------------------------------ Blöcke der Startseite
  // relevant(ids): bei welchen Zustandsänderungen der Block neu gezeichnet wird (Kacheln aktualisieren sich selbst)
  const B = {
    aufmerksamkeit: {
      titel: "Aufmerksamkeit", icon: "alert-circle-outline",
      render(b) {
        const punkte = lage();
        if (!punkte.length) {
          b.appendChild(E(`<div class="as-nominal">${PS.ic("check-circle-outline")}<div><b>Alles nominal</b><small>Alle Geräte antworten, keine offenen Meldungen.</small></div></div>`));
          return;
        }
        const r = E('<div class="as-chips"></div>');
        punkte.forEach((p) => {
          const c = E(`<button type="button" class="as-chip ${p.stufe}">${PS.ic(p.icon)}<span>${PS.esc(p.text)}</span></button>`);
          c.addEventListener("click", p.ziel); r.appendChild(c);
        });
        b.appendChild(r);
      },
      relevant: () => true,
      signatur: () => JSON.stringify(lage().map((p) => [p.stufe, p.text])),
    },
    hinweise: {
      titel: "Hinweise", icon: "cards-outline",
      render(b) {
        const karten = (PS.feedListe || []).filter((k) => k.schluessel !== "ok");
        if (!karten.length) { b.appendChild(leer("Keine Hinweise. Alles erledigt.")); return; }
        const l = E('<div class="as-karten"></div>');
        karten.slice(0, 8).forEach((k) => {
          const m = PS.kartenModell(k);
          const innen = m.zahl != null ? `<b class="tabular">${PS.esc(m.zahl)}</b>` : PS.ic(m.icon || "information-outline");
          const text = m.liste ? m.liste.map((z) => z.join(" ")).join(" · ") : m.p || "";
          const z = E(`<div class="as-karte" style="--farbe:${PS.esc(m.farbe || "var(--akzent)")}"><div class="ring">${PS.ringSVG(m.anteil)}<div class="innen">${innen}</div></div>
            <div class="t"><small>${PS.esc(m.kopf || "")}</small><b>${PS.esc(m.h2 || "")}</b>${text ? `<span>${PS.esc(text)}</span>` : ""}</div></div>`);
          z.addEventListener("click", () => PS.karteOeffnen(k));
          l.appendChild(z);
        });
        b.appendChild(l);
      },
      relevant: () => false, karten: true,
      signatur: () => JSON.stringify((PS.feedListe || []).concat(PS.karten || []).map((k) => { const m = PS.kartenModell(k); return [k.id, m.zahl, m.h2, m.p, m.liste, Math.round((m.anteil || 0) * 20)]; })),
    },
    tueren: {
      titel: "Türen", icon: "door",
      render(b) {
        const r = E('<div class="reihe"></div>');
        const haus = PS.opt.haustueroeffner;
        if (haus && PS.z[haus]) {
          const k = knopf("Haustür öffnen (halten)", "door-open", null, "primaer");
          PS.halten(k, 2000, () => PS.dienst(PS.domain(haus), PS.domain(haus) === "lock" ? "open" : "press", { entity_id: haus }).then(() => PS.toast("Haustür geöffnet")));
          r.appendChild(k);
        }
        r.appendChild(knopf("Alle Nachrichten", "voicemail", () => PS.oeffnen("tuerdienst")));
        b.appendChild(r);
        const zugang = PS.zugang(alle().filter((e) => PS.domain(e) === "lock")).filter((e) => e !== haus);
        if (zugang.length) b.appendChild(raster(zugang));
        const kam = PS.opt.ereignis_kamera;
        if (kam && PS.z[kam]) {
          const k = E(`<div class="kamera as-kamera"><img alt=""><span>${PS.esc(PS.name(kam))}</span></div>`);
          k.addEventListener("click", () => PS.mehrInfos(kam));
          b.appendChild(k); setTimeout(() => PS.kameraVorschau(k.querySelector("img"), kam), 50);
        }
        const liste = E('<div class="liste"></div>'); b.appendChild(liste);
        const fuellen = (n) => {
          liste.innerHTML = "";
          if (!n.length) { liste.appendChild(leer("Keine Nachrichten an der Haustür.")); return; }
          n.slice(0, 3).forEach((a) => liste.appendChild(zeile("voicemail", a.text || "Nachricht ohne Abschrift", `${zeitText(a.zeit)} · ${a.dauer_s || "?"} s`, null, PS.aufnahmeKnopf(a.datei, a.dauer_s))));
        };
        fuellen(AUFNAHMEN.liste);
        aufnahmenLaden().then(fuellen);
      },
      relevant: () => false, aufnahmen: true,
    },
    klima: {
      titel: "Klima", icon: "thermostat",
      render(b) {
        const thermo = alle().filter((e) => PS.domain(e) === "climate" && PS.sichtbar(e) && !PS.nichtDa(e)).sort(nameSort);
        if (PS.z["sensor.pm_klima_empfehlung"]) b.appendChild(E(`<div class="r-text">${PS.esc(PS.text("sensor.pm_klima_empfehlung"))}</div>`));
        if (!thermo.length) { b.appendChild(leer("Keine Thermostate gefunden.")); return; }
        const g = E('<div class="as-thermos"></div>');
        thermo.forEach((t) => g.appendChild(thermoZeile(t)));
        b.appendChild(g);
      },
      // Zeilen aktualisieren sich an Ort und Stelle (siehe unten), laufende Eingaben bleiben
      relevant: () => false,
    },
    raeume: {
      titel: "Räume", icon: "floor-plan",
      render(b) {
        const r = E('<div class="as-raeume"></div>');
        bereicheListe().filter((x) => PS.raumWerte(x.id).ent.length).forEach((x) => r.appendChild(raumKachel(x, () => PS.oeffnen("raeume", x.id))));
        b.appendChild(r);
      },
      relevant: (ids) => [...ids].some((e) => /^(light|climate|sensor|media_player|binary_sensor)\./.test(e)),
      // Nur neu zeichnen, wenn sich an einer Kachel sichtbar etwas ändert (Sensoren melden sich im Sekundentakt)
      signatur: () => JSON.stringify(bereicheListe().map((x) => raumSignatur(x))),
    },
    schnellzugriff: {
      titel: "Schnellzugriff", icon: "lightning-bolt-outline",
      render(b) {
        const pcs = alle().filter((e) => PS.rechner(e) && PS.sichtbar(e));
        const wol = alle().filter((e) => PS.domain(e) === "button" && /wol|wake/.test(e) && PS.sichtbar(e));
        const ids = [...new Set([...(PS.einst.schnellzugriff || []), ...pcs, ...wol])].filter((e) => PS.z[e]);
        b.appendChild(ids.length ? raster(ids) : leer("Im Editor unter „Schnellzugriff“ festlegen."));
      },
      relevant: () => false,
    },
    energie: {
      titel: "Energie", icon: "lightning-bolt",
      render(b) {
        const leistung = energieTop();
        const summe = leistung.reduce((s, e) => s + Math.max(0, num(e)), 0);
        const max = Math.max(1, ...leistung.map((e) => Math.abs(num(e))));
        b.querySelector("h3 small").textContent = `${PS.zahl(summe, 0)} W jetzt`;
        if (!leistung.length) { b.appendChild(leer("Keine Leistungssensoren gefunden.")); return; }
        leistung.slice(0, 6).forEach((e) => b.appendChild(balken(PS.name(e), PS.text(e), Math.abs(num(e)) / max, null, e)));
        b.appendChild(knopf("Energie öffnen", "chart-line", () => PS.oeffnen("energie")));
      },
      relevant: (ids) => [...ids].some((e) => e.startsWith("sensor.") && PS.a(e).device_class === "power"),
      // Reihenfolge der sechs größten Verbraucher; solange sie gleich bleibt, nur Werte und Balken nachführen
      signatur: () => JSON.stringify(energieTop().slice(0, 6)),
      aktualisieren(b) {
        const l = energieTop(), max = Math.max(1, ...l.map((e) => Math.abs(num(e))));
        const s = b.querySelector("h3 small"); if (s) s.textContent = `${PS.zahl(l.reduce((a, e) => a + Math.max(0, num(e)), 0), 0)} W jetzt`;
        b.querySelectorAll(".balken-zeile[data-eid]").forEach((z) => {
          const e = z.dataset.eid; if (!PS.z[e]) return;
          z.querySelector(".w").textContent = PS.text(e);
          z.querySelector(".bar i").style.width = `${Math.max(1, Math.min(100, (Math.abs(num(e)) / max) * 100))}%`;
        });
      },
      takt: 10000,
    },
    pakete: {
      titel: "Pakete", icon: "package-variant-closed",
      render(b) {
        const k = (PS.karten || []).find((x) => x.art === "pakete");
        if (!k) { b.appendChild(leer("Keine Sendungen unterwegs.")); return; }
        b.appendChild(E(`<div class="r-zahl tabular">${PS.esc(k.anzahl)}<small> ${k.anzahl === 1 ? "Sendung" : "Sendungen"}</small></div>`));
        if (k.hinweis) b.appendChild(E(`<div class="r-unter">${PS.esc(k.hinweis)}</div>`));
        const l = E('<div class="liste"></div>');
        (k.liste || []).forEach((z) => l.appendChild(zeile("package-variant", z[0], z[1], () => PS.paketeZeigen(k))));
        b.appendChild(l);
      },
      relevant: () => false, karten: true,
      signatur: () => JSON.stringify((PS.feedListe || []).concat(PS.karten || []).map((k) => { const m = PS.kartenModell(k); return [k.id, m.zahl, m.h2, m.p, m.liste, Math.round((m.anteil || 0) * 20)]; })),
    },
    medien: {
      titel: "Medien", icon: "play-circle",
      render(b) {
        const aktiv = alle().filter((e) => PS.domain(e) === "media_player" && PS.sichtbar(e) && ["playing", "paused", "on", "buffering"].includes(PS.s(e)));
        if (!aktiv.length) { b.appendChild(leer("Gerade spielt nichts.")); return; }
        const r = E('<div class="as-medien"></div>');
        aktiv.sort((x, y) => (PS.s(y) === "playing") - (PS.s(x) === "playing")).slice(0, 3).forEach((p) => r.appendChild(PS.medienSteuerung(p, false)));
        b.appendChild(r);
      },
      // Nur bei neuem Zustand (spielt, pausiert, aus) oder neuem Titel neu zeichnen, nicht bei jeder Positionsmeldung
      relevant: (ids) => [...ids].some((e) => e.startsWith("media_player.")),
      signatur: () => JSON.stringify(alle().filter((e) => e.startsWith("media_player.")).map((e) => [e, PS.s(e), PS.a(e).media_title])),
    },
    termine: { titel: "Termine", icon: "calendar", render(b) { PS.baustein.kalender(b); }, relevant: () => false },
    einkauf: {
      titel: "Einkauf", icon: "cart-outline",
      render(b) {
        const l = alle().filter((e) => PS.domain(e) === "todo" && PS.sichtbar(e)).sort((x, y) => /einkauf|shopping/.test(y) - /einkauf|shopping/.test(x));
        if (!l[0]) { b.appendChild(leer("Keine Listen gefunden.")); return; }
        b.querySelector("h3 span").textContent = PS.name(l[0]);
        PS.baustein.todo(b, l[0]);
      },
      relevant: () => false,
    },
    angebote: { titel: "Angebote", icon: "tag-outline", render(b) { PS.baustein.angebote(b); }, relevant: () => false },
    sicherheit: {
      titel: "Sicherheit", icon: "shield-home",
      render(b) {
        alle().filter((e) => PS.domain(e) === "alarm_control_panel" && PS.sichtbar(e)).forEach((a) => b.appendChild(PS.alarmSteuerung(a)));
        const offen = alle().filter((e) => e.startsWith("binary_sensor.") && PS.sichtbar(e) && ["door", "window", "opening", "garage_door"].includes(PS.a(e).device_class) && PS.s(e) === "on");
        b.appendChild(offen.length ? raster(offen.sort(nameSort)) : leer("Alle Türen und Fenster sind zu."));
      },
      relevant: (ids) => [...ids].some((e) => e.startsWith("binary_sensor.") || e.startsWith("alarm_control_panel.")),
      signatur: () => JSON.stringify([alle().filter((e) => PS.domain(e) === "alarm_control_panel").map(PS.s),
        alle().filter((e) => e.startsWith("binary_sensor.") && ["door", "window", "opening", "garage_door"].includes(PS.a(e).device_class) && PS.s(e) === "on")]),
    },
  };
  // Größe je Block: Breite in 12 Spalten, Höhe in Rasterzeilen (wie ADMIN_BLOECKE in config.py)
  const GROESSE = { aufmerksamkeit: [12, 2], hinweise: [4, 8], tueren: [4, 8], klima: [4, 5], raeume: [6, 7], schnellzugriff: [3, 7], energie: [3, 7],
    pakete: [4, 5], medien: [4, 5], termine: [4, 6], einkauf: [4, 6], angebote: [4, 6], sicherheit: [4, 6], netzwerk: [4, 6] };
  PS.admin.bloecke = B; PS.admin.groesse = GROESSE;  // weitere Blöcke aus eigenen Dateien (z. B. Netzwerk)
  const STANDARD = ["aufmerksamkeit", "hinweise", "klima", "tueren", "raeume", "netzwerk", "schnellzugriff", "energie", "pakete", "medien"].map((id) => `${id}:${GROESSE[id].join(":")}`);

  // Lage für „Aufmerksamkeit“ und die Zeile unter dem Gruß
  function lage() {
    const p = [];
    const { weg } = PS.systemzustand();
    if (weg.length) p.push({ stufe: "warn", icon: "lan-disconnect", text: weg.length === 1 ? `${PS.geraete[weg[0].d] || PS.name(weg[0].e)} antwortet nicht` : `${weg.length} Geräte antworten nicht`, ziel: () => PS.oeffnen("wartung") });
    const alarm = PS.opt.alarm_entitaet;
    if (alarm && PS.s(alarm) === "triggered") p.push({ stufe: "krit", icon: "alarm-light", text: "Alarm ausgelöst", ziel: () => PS.oeffnen("sicherheit") });
    (PS.popups || []).slice(0, 5).forEach((m) => {
      const s = PS.meldungStufe(m);
      p.push({ stufe: s === "kritisch" ? "krit" : s === "zeitkritisch" ? "warn" : "info", icon: PS.meldungIcon(m.icon), text: m.titel, ziel: () => PS.popupZeigen(m.id) });
    });
    if ((PS.meldungen || []).length) p.push({ stufe: "info", icon: "bell-ring-outline", text: `${PS.meldungen.length} Benachrichtigung${PS.meldungen.length > 1 ? "en" : ""} in Home Assistant`, ziel: () => PS.oeffnen("hinweise") });
    const offen = alle().filter((e) => e.startsWith("binary_sensor.") && PS.sichtbar(e) && ["door", "window", "opening", "garage_door"].includes(PS.a(e).device_class) && PS.s(e) === "on");
    offen.slice(0, 4).forEach((e) => p.push({ stufe: "warn", icon: PS.iconName(e), text: `${PS.name(e)} offen`, ziel: () => PS.mehrInfos(e) }));
    const leer = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "battery" && isFinite(num(e)) && num(e) < 20 && PS.sichtbar(e)).sort((x, y) => num(x) - num(y));
    leer.slice(0, 3).forEach((e) => p.push({ stufe: num(e) < 10 ? "krit" : "warn", icon: "battery-alert-variant-outline", text: `${PS.name(e)} ${PS.zahl(num(e), 0)} %`, ziel: () => PS.mehrInfos(e) }));
    const upd = alle().filter((e) => e.startsWith("update.") && PS.s(e) === "on" && PS.sichtbar(e));
    if (upd.length) p.push({ stufe: "info", icon: "update", text: `${upd.length} Update${upd.length > 1 ? "s" : ""} verfügbar`, ziel: () => haOeffnen("/config/updates") });
    const neu = AUFNAHMEN.liste[0];
    if (neu && Date.now() - new Date(neu.zeit).getTime() < 24 * 3600 * 1000) p.push({ stufe: "info", icon: "voicemail", text: `Nachricht an der Haustür · ${zeitText(neu.zeit)}`, ziel: () => PS.oeffnen("tuerdienst") });
    return p;
  }

  // ------------------------------------------------------------ Ziehen zum Sortieren (Maus, Stift, Finger)
  // Das gezogene Element wandert unter dem Zeiger durch seine Geschwister; erst nach 6 px Weg, damit ein Klick ein
  // Klick bleibt. Geschwister zählen nur, wenn „gehoert“ sie annimmt.
  function ziehen(ev, el, gehoert, beiEnde) {
    if (ev.button > 0) return;
    const start = { x: ev.clientX, y: ev.clientY }, liste = el.parentElement;
    let aktiv = false;
    const bewegen = (e) => {
      if (!aktiv) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
        aktiv = true; el.classList.add("ord-zieht"); document.body.classList.add("ord-ziehen");
        try { el.setPointerCapture(e.pointerId); } catch { /* bereits losgelassen */ }
      }
      e.preventDefault();
      PS.letzteBeruehrung = Date.now();
      const unter = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x !== el && x.parentElement === liste && gehoert(x));
      if (!unter) return;
      const kinder = [...liste.children];
      liste.insertBefore(el, kinder.indexOf(unter) > kinder.indexOf(el) ? unter.nextSibling : unter);
    };
    const ende = () => {
      window.removeEventListener("pointermove", bewegen);
      window.removeEventListener("pointerup", ende);
      window.removeEventListener("pointercancel", ende);
      if (!aktiv) return;
      el.classList.remove("ord-zieht"); document.body.classList.remove("ord-ziehen");
      // Den Klick, der dem Loslassen folgt, verschlucken
      const schlucken = (k) => { k.stopPropagation(); k.preventDefault(); };
      window.addEventListener("click", schlucken, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", schlucken, true), 50);
      beiEnde();
    };
    window.addEventListener("pointermove", bewegen, { passive: false });
    window.addEventListener("pointerup", ende);
    window.addEventListener("pointercancel", ende);
  }

  // ------------------------------------------------------------ Anordnen: Reihenfolge auf allen Seiten
  // Nur hier am PC einstellbar; gespeichert in den Einstellungen und damit sofort auf jedem Panel gültig (start.js
  // wendet sie an). Kacheln, Räume, Thermostate ziehen; Boxen und Gruppen an ihrer Überschrift.
  const anordnenKnopf = E(`<button type="button" class="ord-knopf" title="Reihenfolge auf dieser Seite anordnen">${PS.ic("drag-variant")}<span>Anordnen</span></button>`);
  const anordnenLeiste = E(`<div class="ord-leiste" hidden><span>${PS.ic("drag-variant")}Ziehen zum Sortieren · Boxen an der Überschrift</span></div>`);
  document.body.append(anordnenKnopf, anordnenLeiste);
  // Wo angeordnet wird: die offene Modulseite oder die Startseite (dort ist jeder Block eine eigene Wurzel)
  const START = "admin-start";
  const aufStart = () => !document.body.classList.contains("offen");
  const wurzeln = () => (aufStart() ? [...$("#as-raster").querySelectorAll(":scope > .as-block")] : [$("#sheet-inhalt")]);
  const seiteJetzt = () => (aufStart() ? START : PS.ordnung.seite());
  const wurzelVon = (el) => (aufStart() ? el.closest(".as-block") : $("#sheet-inhalt"));
  const schluesselVon = (liste) => PS.ordnung.schluessel(liste, wurzelVon(liste), aufStart() ? START : undefined);
  let anordnenStart = false;
  const zuruecksetzen = knopf("Seite zurücksetzen", "restore", async () => {
    const seite = seiteJetzt(), alt = PS.einst.reihenfolgen || {}, lay = PS.einst.layouts || {};
    const neu = Object.fromEntries(Object.entries(alt).filter(([k]) => !k.startsWith(seite + "|")));
    const neuLay = Object.fromEntries(Object.entries(lay).filter(([k]) => k !== "seite:" + seite && !k.startsWith("liste:" + seite + "|") && !k.startsWith("pos:" + seite + "|")));
    await ordnungSpeichern({ reihenfolgen: neu, layouts: neuLay }, "Anordnung dieser Seite zurückgesetzt");
    if (aufStart()) startZeichnen(); else PS.neuZeichnen();
  });
  // Freies Raster: Position und Größe der Teile einer Seite im Drei-Spalten-Muster
  const freiKnopf = knopf("Freies Raster", "view-grid-plus-outline", () => {
    const g = $("#sheet-inhalt .raum-ansicht"); if (!g) return;
    const breite = g.clientWidth || 1, spalten = [...g.children].filter((x) => x.classList.contains("r-spalte"));
    const reihen = spalten.map((sp) => [...sp.children].map((el) => ({ el, w: Math.max(2, Math.min(12, Math.round((sp.getBoundingClientRect().width / breite) * 12))) })));
    const lose = [...g.children].filter((x) => !x.classList.contains("r-spalte")).map((el) => ({ el, w: 12 }));
    const folge = [...lose];
    for (let i = 0; i < Math.max(0, ...reihen.map((x) => x.length)); i++) reihen.forEach((sp) => { if (sp[i]) folge.push(sp[i]); });
    const ids = PS.layout.teilIds(folge.map((x) => x.el));
    layoutSpeichern("seite:" + PS.ordnung.seite(), folge.map((x, i) => `${x.w}:0:${ids[i]}`), "Freies Raster aktiv: Teile am Griff ziehen, Größe unten rechts");
  });
  // Inhalt der Raumkarten: Teile wählen und ihre Folge ziehen (Räume-Seite, Startseiten-Block, Flur)
  const karteKnopf = knopf("Karteninhalt", "card-text-outline", () => {
    const dlg = $("#dialog");
    delete dlg.dataset.popup;
    const an = PS.raumkarte(), namen = new Map(PS.RAUMKARTE);
    const folge = [...an, ...PS.RAUMKARTE.map((x) => x[0]).filter((t) => !an.includes(t))];
    dlg.innerHTML = `<div class="kopf">${PS.ic("card-text-outline", "gr")}<h2>Inhalt der Raumkarten<small>Häkchen: anzeigen · am Griff ziehen: Reihenfolge</small></h2><button class="zu" aria-label="Schließen">${PS.ic("close")}</button></div>
      <div class="ord-teile">${folge.map((t) => `<label data-t="${t}"><span class="griff">${PS.ic("drag-variant")}</span><input type="checkbox"${an.includes(t) ? " checked" : ""}><span>${PS.esc(namen.get(t))}</span>${PS.RAUMKARTE_WERTE.includes(t) ? "<small>Wertezeile</small>" : "<small>Hinweis</small>"}</label>`).join("")}</div>
      <p class="leise">Werte stehen in der oberen Zeile, Hinweise darunter; die Folge gilt innerhalb jeder Zeile.</p>
      <div class="reihe"></div>`;
    const liste = dlg.querySelector(".ord-teile");
    liste.addEventListener("pointerdown", (ev) => {
      const g = ev.target.closest(".griff"); if (!g) return;
      ev.preventDefault();
      ziehen(ev, g.parentElement, (x) => x.matches("label"), () => {});
    });
    dlg.querySelector(".reihe").append(
      knopf("Abbrechen", "close", PS.dialogSchliessen),
      knopf("Speichern", "check", async () => {
        const neu = [...liste.querySelectorAll("label")].filter((l) => l.querySelector("input").checked).map((l) => l.dataset.t);
        PS.dialogSchliessen();
        await ordnungSpeichern({ raumkarte: neu }, "Raumkarten gespeichert");
        neuAnwenden();
      }, "primaer"),
    );
    dlg.querySelector(".zu").addEventListener("click", PS.dialogSchliessen);
    $("#dialog-grund").classList.add("offen");
  });
  anordnenLeiste.append(karteKnopf, freiKnopf, zuruecksetzen, knopf("Fertig", "check", () => anordnen(false), "primaer"));
  function layoutSpeichern(schluessel, eintraege, meldung) {
    const neu = { ...(PS.einst.layouts || {}) };
    if (eintraege && eintraege.length) neu[schluessel] = eintraege; else delete neu[schluessel];
    PS.einst.layouts = neu;
    if (aufStart()) wurzeln().forEach((w) => PS.layout.anwenden(w, START)); else PS.layout.anwenden();
    listenMarkieren();
    return ordnungSpeichern({ layouts: neu }, meldung);
  }
  const freiEintraege = (g) => [...g.children].filter((el) => el.dataset.teil).map((el) => `${el.dataset.w || 4}:${el.dataset.h || 0}:${el.dataset.teil}`);
  anordnenKnopf.addEventListener("click", () => anordnen(!document.body.classList.contains("anordnen")));
  PS.admin.anordnen = (an) => anordnen(an);
  function anordnen(an) {
    anordnenStart = an && aufStart();
    document.body.classList.toggle("anordnen", an);
    anordnenLeiste.hidden = !an;
    anordnenKnopf.classList.toggle("aktiv", an);
    listenMarkieren();
  }
  function listenMarkieren() {
    const an = document.body.classList.contains("anordnen");
    [$("#sheet-inhalt"), $("#as-raster")].forEach((w) => {
      w.querySelectorAll(".ord-liste").forEach((x) => x.classList.remove("ord-liste"));
      if (!an) w.querySelectorAll(".frei-ziehen, .frei-groesse, .ord-breite").forEach((x) => x.remove());
    });
    const g = aufStart() ? null : $("#sheet-inhalt .raum-ansicht");
    freiKnopf.style.display = !g || g.classList.contains("frei") ? "none" : "";
    karteKnopf.style.display = wurzeln().some((w) => w.querySelector("[data-raum]")) ? "" : "none";
    if (!an) return;
    const listen = wurzeln().flatMap((w) => PS.ordnung.listen(w));
    listen.forEach((c) => c.classList.add("ord-liste"));
    // Kacheln in Rastern: Breite ziehen, entfernen; am Ende „Gerät hinzufügen“
    listen.filter((c) => c.classList.contains("raster")).forEach((c) => {
      [...c.children].forEach((k) => {
        if (!PS.ordnung.kennung(k) || k.querySelector(":scope > .ord-breite")) return;
        k.append(E(`<span class="ord-breite" title="Breite ziehen">${PS.ic("arrow-expand-horizontal")}</span>`),
          E(`<span class="ord-weg" role="button" title="Aus dieser Liste entfernen">${PS.ic("close")}</span>`));
      });
      if (!c.querySelector(":scope > .ord-plus")) c.appendChild(E(`<button type="button" class="ord-plus">${PS.ic("plus")}<span>Gerät hinzufügen</span></button>`));
    });
    // Teile im freien Raster: Griff zum Verschieben, Ecke für die Größe
    if (g && g.classList.contains("frei")) [...g.children].forEach((el) => {
      if (!el.querySelector(":scope > .frei-ziehen")) el.append(E(`<span class="frei-ziehen" title="Verschieben">${PS.ic("drag-variant")}</span>`), E(`<span class="frei-groesse" title="Größe ziehen · Doppelklick: Höhe nach Inhalt">${PS.ic("resize-bottom-right")}</span>`));
    });
  }
  let markierenBald = 0;
  const markierer = new MutationObserver(() => {
    if (!document.body.classList.contains("anordnen") || markierenBald) return;
    markierenBald = requestAnimationFrame(() => { markierenBald = 0; listenMarkieren(); });
  });
  [$("#sheet-inhalt"), $("#as-raster")].forEach((w) => markierer.observe(w, { childList: true, subtree: true }));
  // Wechsel zwischen Startseite und Modulseite beendet das Anordnen
  PS.on("seite", () => { if (document.body.classList.contains("anordnen") && anordnenStart !== aufStart()) anordnen(false); });
  async function ordnungSpeichern(teil, meldung) {
    try {
      const r = await fetch("api/einstellungen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(teil) });
      if (!r.ok) throw new Error(await r.text());
      Object.assign(PS.einst, (await r.json()).einstellungen);
      if (meldung) PS.toast(meldung);
    } catch (e) { PS.toast("Nicht gespeichert: " + (e.message || e), true); }
  }
  const kennbar = (x) => !!PS.ordnung.kennung(x);
  const druck = (ev) => {
    if (!document.body.classList.contains("anordnen")) return;
    if (freiGriffe(ev)) return;
    const listen = new Set(ev.currentTarget.querySelectorAll(".ord-liste"));
    // Überschrift einer Box: die Box ziehen; sonst das innerste kenntliche Element einer Liste
    const kopf = ev.target.closest(".r-box > h3, .gruppe > h3");
    let el = kopf && listen.has(kopf.parentElement.parentElement) ? kopf.parentElement : null;
    for (let x = ev.target; !el && x && x !== ev.currentTarget; x = x.parentElement) {
      if (listen.has(x.parentElement) && kennbar(x) && !x.matches(".r-box, .gruppe")) el = x;
    }
    if (!el) return;
    ev.preventDefault();
    const liste = el.parentElement;
    if (liste.classList.contains("raster") && !el.matches(".r-box, .gruppe")) { zellZiehen(ev, el, liste); return; }
    if (liste.matches(".raum-ansicht.frei")) {
      PS.ordnung.zieht = true;
      window.addEventListener("pointerup", () => setTimeout(() => { if (!document.body.classList.contains("ord-ziehen")) PS.ordnung.zieht = false; }, 0), { once: true });
      ziehen(ev, el, (x) => x.parentElement === liste, () => { PS.ordnung.zieht = false; layoutSpeichern("seite:" + PS.ordnung.seite(), freiEintraege(liste)); });
      return;
    }
    PS.ordnung.zieht = true;
    ziehen(ev, el, kennbar, () => {
      PS.ordnung.zieht = false;
      const folge = [...liste.children].filter(kennbar).map(PS.ordnung.kennung);
      if (folge[0].startsWith("raum:")) {
        const gezeigt = folge.map((x) => x.slice(5)), rest = (PS.einst.bereiche_reihenfolge || []).filter((b) => !gezeigt.includes(b));
        ordnungSpeichern({ bereiche_reihenfolge: [...gezeigt, ...rest] });
      } else {
        ordnungSpeichern({ reihenfolgen: { ...(PS.einst.reihenfolgen || {}), [schluesselVon(liste)]: folge } });
      }
    });
    // ohne Bewegung zurücksetzen
    window.addEventListener("pointerup", () => { setTimeout(() => { if (!document.body.classList.contains("ord-ziehen")) PS.ordnung.zieht = false; }, 0); }, { once: true });
  };
  $("#sheet-inhalt").addEventListener("pointerdown", druck);
  $("#as-raster").addEventListener("pointerdown", (ev) => { if (!anpassen) druck(ev); });
  // Kachelraster frei belegen: die Kachel landet in der Zelle unter dem Zeiger, auch in einer leeren; liegt dort
  // eine andere, tauschen beide die Plätze. Beim ersten Ziehen werden alle Plätze der Liste festgehalten.
  function rasterMasse(liste) {
    const st = getComputedStyle(liste), r0 = liste.getBoundingClientRect();
    const spalten = st.gridTemplateColumns.split(" ").map(parseFloat).filter((x) => x > 0);
    const zeilen = st.gridTemplateRows.split(" ").map(parseFloat).filter((x) => x > 0);
    return { r0, spalten, zeilen, gx: parseFloat(st.columnGap) || 0, gy: parseFloat(st.rowGap) || 0 };
  }
  function zelleBei(m, x, y) {
    const finde = (spuren, luecke, d) => { let a = 0; for (let i = 0; i < spuren.length; i++) { if (d < a + spuren[i] + luecke / 2) return i + 1; a += spuren[i] + luecke; } return spuren.length + 1; };
    const hoehe = m.zeilen.length ? m.zeilen[m.zeilen.length - 1] : 80;
    return { sp: Math.min(m.spalten.length, finde(m.spalten, m.gx, x - m.r0.left)), ze: finde([...m.zeilen, hoehe], m.gy, y - m.r0.top) };
  }
  function zellZiehen(ev, el, liste) {
    const start = { x: ev.clientX, y: ev.clientY };
    let aktiv = false, ziel = null;
    const kinder = () => [...liste.children].filter(kennbar);
    const platzVon = (k) => (k.dataset.px ? { w: +k.dataset.px, h: +k.dataset.py } : null);
    PS.ordnung.zieht = true;
    const bewegen = (e) => {
      if (!aktiv) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
        aktiv = true;
        // Alle Plätze festhalten, so wie sie gerade stehen
        const m = rasterMasse(liste);
        kinder().forEach((k) => { const r = k.getBoundingClientRect(), z = zelleBei(m, r.left + 4, r.top + 4); PS.layout.kachelSetzen(k, +k.dataset.spanne || 1, { w: z.sp, h: z.ze }); });
        el._alt = platzVon(el);
        el.classList.add("ord-zieht"); document.body.classList.add("ord-ziehen");
      }
      e.preventDefault(); PS.letzteBeruehrung = Date.now();
      const m = rasterMasse(liste), w = +el.dataset.spanne || 1, z = zelleBei(m, e.clientX, e.clientY);
      ziel = { w: Math.max(1, Math.min(m.spalten.length - w + 1, z.sp)), h: z.ze };
      PS.layout.kachelSetzen(el, w, ziel);
    };
    const ende = () => {
      window.removeEventListener("pointermove", bewegen); window.removeEventListener("pointerup", ende); window.removeEventListener("pointercancel", ende);
      PS.ordnung.zieht = false;
      if (!aktiv) return;
      el.classList.remove("ord-zieht"); document.body.classList.remove("ord-ziehen");
      const schlucken = (k) => { k.stopPropagation(); k.preventDefault(); };
      window.addEventListener("click", schlucken, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", schlucken, true), 50);
      // Belegte Zelle: die andere Kachel nimmt den alten Platz
      const andere = kinder().find((k) => k !== el && ziel && +k.dataset.px === ziel.w && +k.dataset.py === ziel.h);
      if (andere && el._alt) PS.layout.kachelSetzen(andere, +andere.dataset.spanne || 1, el._alt);
      const eintraege = kinder().filter((k) => k.dataset.px).map((k) => `${k.dataset.px}:${k.dataset.py}:${PS.ordnung.kennung(k)}`);
      layoutSpeichern("pos:" + schluesselVon(liste), eintraege);
    };
    window.addEventListener("pointermove", bewegen, { passive: false });
    window.addEventListener("pointerup", ende);
    window.addEventListener("pointercancel", ende);
  }

  // Griffe im Anordnen-Modus: Teil verschieben, Teil vergrößern, Kachelbreite
  function freiGriffe(ev) {
    const t = ev.target.closest(".frei-ziehen, .frei-groesse, .ord-breite"); if (!t) return false;
    ev.preventDefault(); ev.stopPropagation();
    const el = t.parentElement, g = el.parentElement;
    PS.ordnung.zieht = true;
    window.addEventListener("pointerup", () => setTimeout(() => { if (!document.body.classList.contains("ord-ziehen")) PS.ordnung.zieht = false; }, 0), { once: true });
    if (t.classList.contains("frei-ziehen")) {
      ziehen(ev, el, (x) => x.parentElement === g, () => { PS.ordnung.zieht = false; layoutSpeichern("seite:" + PS.ordnung.seite(), freiEintraege(g)); });
      return true;
    }
    const st = getComputedStyle(g), lueckeX = parseFloat(st.columnGap) || 0, lueckeY = parseFloat(st.rowGap) || 0;
    const spalten = st.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const spalteB = (g.clientWidth - lueckeX * (spalten - 1)) / spalten, r0 = el.getBoundingClientRect();
    t.setPointerCapture(ev.pointerId); el.classList.add("ord-zieht-groesse");
    const kachel = t.classList.contains("ord-breite");
    const bewegen = (e) => {
      const w = Math.max(1, Math.min(spalten, Math.round((e.clientX - r0.left + lueckeX) / (spalteB + lueckeX))));
      if (kachel) { PS.layout.kachelSetzen(el, w, el.dataset.px ? { w: Math.min(+el.dataset.px, spalten - w + 1), h: +el.dataset.py } : null); return; }
      if (spalten !== 12) return;
      el.dataset.w = Math.max(2, w);
      el.dataset.h = Math.max(4, Math.round((e.clientY - r0.top + lueckeY) / (8 + lueckeY)));
      PS.layout.freiSpannen(g);
    };
    const ende = () => {
      t.removeEventListener("pointermove", bewegen); el.classList.remove("ord-zieht-groesse");
      PS.ordnung.zieht = false;
      if (kachel) {
        const schluessel = "liste:" + schluesselVon(g);
        layoutSpeichern(schluessel, [...g.children].filter((k) => +k.dataset.spanne > 1 && PS.ordnung.kennung(k)).map((k) => `${k.dataset.spanne}:0:${PS.ordnung.kennung(k)}`));
        const plaetze = [...g.children].filter((k) => k.dataset.px && PS.ordnung.kennung(k));
        if (plaetze.length) layoutSpeichern("pos:" + schluesselVon(g), plaetze.map((k) => `${k.dataset.px}:${k.dataset.py}:${PS.ordnung.kennung(k)}`));
      } else layoutSpeichern("seite:" + PS.ordnung.seite(), freiEintraege(g));
    };
    t.addEventListener("pointermove", bewegen);
    t.addEventListener("pointerup", ende, { once: true });
    t.addEventListener("pointercancel", ende, { once: true });
    if (!kachel && spalten !== 12) PS.toast("Größen lassen sich im breiten Fenster ziehen; schmal folgt das Raster zwei Spalten.");
    return true;
  }
  $("#sheet-inhalt").addEventListener("dblclick", (ev) => {
    const t = ev.target.closest(".frei-groesse"); if (!t) return;
    const el = t.parentElement; el.dataset.h = 0;
    layoutSpeichern("seite:" + PS.ordnung.seite(), freiEintraege(el.parentElement), "Höhe folgt wieder dem Inhalt");
  }, true);
  // Im Anordnen-Modus nichts auslösen
  $("#sheet-inhalt").addEventListener("click", (ev) => { if (document.body.classList.contains("anordnen")) { ev.stopPropagation(); ev.preventDefault(); listenAktion(ev); } }, true);
  $("#as-raster").addEventListener("click", (ev) => { if (document.body.classList.contains("anordnen") && aufStart()) { ev.stopPropagation(); ev.preventDefault(); listenAktion(ev); } }, true);
  // Geräte einer Liste hinzufügen oder aus ihr entfernen (gilt auf allen Panels)
  function listenAktion(ev) {
    const t = ev.target.closest(".ord-plus, .ord-weg"); if (!t) return;
    const liste = t.closest(".ord-liste"); if (!liste) return;
    const k = schluesselVon(liste), L = PS.einst.layouts || {};
    const lesen = (n) => (L[n + k] || []).map(PS.layout.eintragLesen).filter(Boolean).map((x) => x.id);
    const schreiben = (plus, minus) => {
      const neu = { ...L };
      ["plus:", "minus:"].forEach((n, i) => { const l = [plus, minus][i]; if (l.length) neu[n + k] = l.map((e) => `0:0:${e}`); else delete neu[n + k]; });
      PS.einst.layouts = neu;
      return ordnungSpeichern({ layouts: neu });
    };
    if (t.classList.contains("ord-weg")) {
      const eid = PS.ordnung.kennung(t.parentElement);
      schreiben(lesen("plus:").filter((e) => e !== eid), [...new Set([...lesen("minus:"), eid])]).then(() => neuAnwenden());
      return;
    }
    const da = new Set([...liste.children].map(PS.ordnung.kennung).filter(Boolean));
    entitaetWaehlen("Gerät hinzufügen", da, (eid) => {
      schreiben([...new Set([...lesen("plus:"), eid])], lesen("minus:").filter((e) => e !== eid)).then(() => neuAnwenden());
    });
  }
  function neuAnwenden() { if (aufStart()) startZeichnen(); else PS.neuZeichnen(); }
  // Auswahl aus allen Entitäten mit Suche (Name, Kennung, Bereich)
  function entitaetWaehlen(titel, ausser, beiWahl) {
    const dlg = $("#dialog");
    delete dlg.dataset.popup;
    dlg.innerHTML = `<div class="kopf">${PS.ic("plus-box-outline", "gr")}<h2>${PS.esc(titel)}<small>Suche nach Name, Raum oder Kennung</small></h2><button class="zu" aria-label="Schließen">${PS.ic("close")}</button></div>
      <input class="ord-suche" type="search" placeholder="z. B. Schreibtisch, Büro, switch." autocomplete="off">
      <div class="ord-treffer"></div>`;
    const feld = dlg.querySelector(".ord-suche"), treffer = dlg.querySelector(".ord-treffer");
    const alleIds = Object.keys(PS.z).filter((e) => !ausser.has(e) && PS.sichtbar(e));
    const zeigen = () => {
      const q = feld.value.trim().toLowerCase();
      const liste = alleIds.map((e) => ({ e, n: PS.name(e), b: PS.bereichName(PS.bereichVon(e) || "") || "" }))
        .filter((x) => !q || `${x.n} ${x.b} ${x.e}`.toLowerCase().includes(q))
        .sort((a, b) => a.n.localeCompare(b.n, "de")).slice(0, 80);
      treffer.innerHTML = liste.map((x) => `<button type="button" data-e="${PS.esc(x.e)}">${PS.icon(x.e)}<span><b>${PS.esc(x.n)}</b><small>${PS.esc([x.b, x.e].filter(Boolean).join(" · "))}</small></span></button>`).join("") || '<div class="leer">Nichts gefunden.</div>';
    };
    feld.addEventListener("input", zeigen);
    treffer.addEventListener("click", (ev) => { const b = ev.target.closest("[data-e]"); if (!b) return; PS.dialogSchliessen(); beiWahl(b.dataset.e); });
    dlg.querySelector(".zu").addEventListener("click", PS.dialogSchliessen);
    zeigen();
    $("#dialog-grund").classList.add("offen");
    setTimeout(() => feld.focus(), 50);
  }

  // ------------------------------------------------------------ Startseite zeichnen und anpassen
  const bloecke = new Map();  // id → { el, def, sig, timer }
  let anpassen = null;        // Arbeitskopie der Anordnung im Anpassen-Modus
  let gedrueckt = 0;          // letzte Bedienung in einem Block: so lange nicht neu zeichnen
  const anordnung = () => {
    const roh = anpassen || (Array.isArray(PS.einst.admin_start) ? PS.einst.admin_start : STANDARD);
    return roh.map((x) => {
      const [id, w, h] = String(x).split(":");
      const g = GROESSE[id] || [4, 6];
      return { id, w: Math.max(2, Math.min(12, +w || g[0])), h: Math.max(2, Math.min(24, +h || g[1])) };
    }).filter((x) => B[x.id]);
  };
  const eintrag = (x) => `${x.id}:${x.w}:${x.h}`;
  function blockZeichnen(id) {
    const b = bloecke.get(id); if (!b) return;
    const inhalt = box(b.def.titel, " ");
    inhalt.querySelector("h3").prepend(E(PS.ic(b.def.icon)));
    b.def.render(inhalt);
    PS.kachelnBinden(inhalt);
    b.el.querySelector(".r-box") ? b.el.querySelector(".r-box").replaceWith(inhalt) : b.el.prepend(inhalt);
    // Eigene Reihenfolge und Kachelbreiten des Blockinhalts (im Anordnen-Modus der Startseite eingestellt)
    PS.ordnung.anwenden(b.el, "admin-start"); PS.layout.anwenden(b.el, "admin-start");
    b.sig = b.def.signatur ? b.def.signatur() : null;
  }
  // Breites Fenster: 12 Spalten mit den gezogenen Größen. Schmal oder hochkant: halbe oder volle Breite (ab 6 Spalten
  // voll), ganz schmal eine Spalte; die Höhe richtet sich dann nach dem Inhalt
  let spalten = 12;
  function spannen() {
    const raster = $("#as-raster"), breit = raster.clientWidth;
    spalten = breit < 560 ? 1 : breit < 1100 ? 2 : 12;
    raster.style.setProperty("--spalten", spalten);
    raster.classList.toggle("frei", spalten !== 12);
    raster.querySelectorAll(".as-block").forEach((el) => {
      const w = +el.dataset.w, h = +el.dataset.h;
      el.style.gridColumn = `span ${spalten === 12 ? w : spalten === 2 ? (w >= 6 ? 2 : 1) : 1}`;
      if (spalten === 12) el.style.gridRow = `span ${h}`;
    });
    raster.classList.toggle("mauer", spalten !== 12);
    if (spalten !== 12) mauern(raster);
  }
  new ResizeObserver(() => spannen()).observe($("#as-raster"));

  // Mauerwerk: Spalten unabhängig voneinander füllen. Feine Rasterzeilen (.mauer), jeder Block belegt so viele, wie
  // sein Inhalt hoch ist; ändert sich der Inhalt, wird nachgemessen.
  const MAUER_ZEILE = 6;
  function mauern(raster) {
    if (!raster.isConnected || !raster.classList.contains("mauer")) return;
    const luecke = parseFloat(getComputedStyle(raster).rowGap) || 0;
    raster.querySelectorAll(":scope > .as-block").forEach((el) => {
      const inhalt = el.querySelector(":scope > .r-box"); if (!inhalt) return;
      const h = inhalt.getBoundingClientRect().height;
      el.style.gridRow = `span ${Math.max(1, Math.ceil((h + luecke) / (MAUER_ZEILE + luecke)))}`;
    });
  }
  const mauerBeobachter = new ResizeObserver((eintraege) => {
    const raster = new Set(eintraege.map((x) => x.target.closest(".mauer")).filter(Boolean));
    requestAnimationFrame(() => raster.forEach(mauern));
  });
  PS.admin.mauer = (raster) => {
    raster.classList.add("mauer");
    raster.querySelectorAll(":scope > .as-block > .r-box").forEach((b) => mauerBeobachter.observe(b));
    mauern(raster);
  };
  // Neue Blöcke (Startseite und Admin-Seiten) beobachten
  let mauerBald = false;
  new MutationObserver(() => {
    if (mauerBald) return;
    mauerBald = true;
    requestAnimationFrame(() => { mauerBald = false; document.querySelectorAll(".as-raster.mauer, .as-seitenraster").forEach((r) => {
      r.classList.add("mauer");
      r.querySelectorAll(":scope > .as-block > .r-box").forEach((b) => { if (!b._mauer) { b._mauer = true; mauerBeobachter.observe(b); } });
      mauern(r);
    }); });
  }).observe(document.body, { childList: true, subtree: true });
  function startZeichnen() {
    const raster = $("#as-raster");
    raster.querySelectorAll("img").forEach(PS.kameraStoppen);
    raster.innerHTML = ""; bloecke.clear();
    const liste = anordnung();
    liste.forEach((x, i) => {
      const el = E(`<div class="as-block" data-id="${x.id}" data-w="${x.w}" data-h="${x.h}"></div>`);
      bloecke.set(x.id, { el, def: B[x.id] });
      raster.appendChild(el);
      blockZeichnen(x.id);
      if (anpassen) {
        el.appendChild(werkzeugBlock(x.id, i, liste.length)); el.appendChild(griff(el, x.id));
        // Am Block ziehen (der Inhalt ist im Anpassen-Modus stumm): Reihenfolge, in jeder Fensterbreite
        el.addEventListener("pointerdown", (ev) => {
          if (ev.target.closest(".as-werkzeug, .as-griff")) return;
          ev.preventDefault();
          ziehen(ev, el, (y) => y.classList.contains("as-block"), () => {
            const neu = [...raster.querySelectorAll(":scope > .as-block")].map((b) => b.dataset.id);
            anpassen = neu.map((id) => anpassen.find((e) => e.startsWith(id + ":"))).filter(Boolean);
            startZeichnen();
          });
        });
      }
    });
    if (!liste.length) raster.appendChild(leer("Die Startseite ist leer. Über „Anpassen“ Blöcke hinzufügen."));
    spannen(); vorrat(); werkzeug(); grussZeigen();
  }
  function werkzeugBlock(id, i, n) {
    const w = E(`<div class="as-werkzeug">
      <button type="button" data-a="hoch" title="Nach vorn"${i === 0 ? " disabled" : ""}>${PS.ic("arrow-left")}</button>
      <button type="button" data-a="runter" title="Nach hinten"${i === n - 1 ? " disabled" : ""}>${PS.ic("arrow-right")}</button>
      <button type="button" data-a="weg" title="Ausblenden">${PS.ic("eye-off-outline")}</button></div>`);
    w.addEventListener("click", (ev) => {
      const t = ev.target.closest("button"); if (!t) return;
      const l = anpassen, j = l.findIndex((x) => x.startsWith(id + ":"));
      if (t.dataset.a === "hoch" && j > 0) [l[j - 1], l[j]] = [l[j], l[j - 1]];
      else if (t.dataset.a === "runter" && j < l.length - 1) [l[j + 1], l[j]] = [l[j], l[j + 1]];
      else if (t.dataset.a === "weg") l.splice(j, 1);
      startZeichnen();
    });
    return w;
  }
  // Ziehgriff unten rechts: Breite und Höhe rasten im Raster ein, der Inhalt passt sich beim Ziehen an
  function griff(el, id) {
    const g = E(`<button type="button" class="as-griff" title="Größe ziehen" aria-label="Größe ändern">${PS.ic("resize-bottom-right")}</button>`);
    const masse = E('<span class="as-masse tabular" aria-live="polite"></span>');
    el.appendChild(masse);
    const zeigen = () => { masse.textContent = `${el.dataset.w} × ${el.dataset.h}`; };
    zeigen();
    g.addEventListener("pointerdown", (ev) => {
      if (spalten === 1) { PS.toast("In einer Spalte sind alle Blöcke voll breit; die Höhe folgt dem Inhalt."); return; }
      if (spalten === 2) { schmalZiehen(ev, el, id, g, zeigen); return; }
      ev.preventDefault(); g.setPointerCapture(ev.pointerId); el.classList.add("zieht");
      const raster = $("#as-raster"), st = getComputedStyle(raster);
      const luecke = parseFloat(st.columnGap) || 0, zeile = parseFloat(st.gridAutoRows) || 40;
      const spalteB = (raster.clientWidth - luecke * (spalten - 1)) / spalten;
      const r0 = el.getBoundingClientRect();
      const bewegen = (e) => {
        let w = Math.round((e.clientX - r0.left + luecke) / (spalteB + luecke));
        const h = Math.max(2, Math.min(24, Math.round((e.clientY - r0.top + luecke) / (zeile + luecke))));
        w = Math.max(1, Math.min(spalten, w));
        el.dataset.w = String(Math.max(2, spalten === 6 ? w * 2 : w)); el.dataset.h = String(h);
        zeigen(); spannen();
      };
      const ende = () => {
        g.removeEventListener("pointermove", bewegen); el.classList.remove("zieht");
        const l = anpassen, j = l.findIndex((x) => x.startsWith(id + ":"));
        if (j >= 0) l[j] = eintrag({ id, w: +el.dataset.w, h: +el.dataset.h });
      };
      g.addEventListener("pointermove", bewegen);
      g.addEventListener("pointerup", ende, { once: true });
      g.addEventListener("pointercancel", ende, { once: true });
    });
    return g;
  }
  // Schmal oder hochkant (zwei Spalten): halbe oder volle Breite ziehen; die Höhe folgt dort dem Inhalt. Gespeichert
  // wird eine passende Breite des breiten Rasters (halb: höchstens 4 von 12, voll: mindestens 6).
  function schmalZiehen(ev, el, id, g, zeigen) {
    ev.preventDefault(); g.setPointerCapture(ev.pointerId); el.classList.add("zieht");
    const raster = $("#as-raster"), r0 = raster.getBoundingClientRect();
    const bewegen = (e) => {
      const voll = e.clientX - r0.left > r0.width * 0.62;
      const w = +el.dataset.w;
      el.dataset.w = String(voll ? (w >= 6 ? w : 12) : (w >= 6 ? 4 : w));
      zeigen(); spannen();
    };
    const ende = () => {
      g.removeEventListener("pointermove", bewegen); el.classList.remove("zieht");
      const l = anpassen, j = l.findIndex((x) => x.startsWith(id + ":"));
      if (j >= 0) l[j] = eintrag({ id, w: +el.dataset.w, h: +el.dataset.h });
    };
    g.addEventListener("pointermove", bewegen);
    g.addEventListener("pointerup", ende, { once: true });
    g.addEventListener("pointercancel", ende, { once: true });
  }
  function vorrat() {
    const v = $("#as-vorrat");
    v.hidden = !anpassen; if (!anpassen) return;
    const da = new Set(anordnung().map((x) => x.id));
    const fehlt = Object.keys(B).filter((id) => !da.has(id));
    v.innerHTML = `<h3>Weitere Blöcke</h3>${fehlt.length ? "" : '<p class="leer">Alle Blöcke sind auf der Startseite.</p>'}`;
    const r = E('<div class="as-chips"></div>');
    fehlt.forEach((id) => {
      const c = E(`<button type="button" class="as-chip info">${PS.ic("plus")}<span>${PS.esc(B[id].titel)}</span></button>`);
      c.addEventListener("click", () => { anpassen.push(`${id}:${(GROESSE[id] || [4, 6]).join(":")}`); startZeichnen(); });
      r.appendChild(c);
    });
    v.appendChild(r);
  }
  function werkzeug() {
    const w = $("#as-werkzeug"); w.innerHTML = "";
    document.body.classList.toggle("anpassen", !!anpassen);
    if (!anpassen) {
      w.append(
        knopf("Inhalt anordnen", "drag-variant", () => PS.admin.anordnen(!document.body.classList.contains("anordnen"))),
        knopf("Anpassen", "view-dashboard-edit-outline", () => { PS.admin.anordnen(false); anpassen = anordnung().map(eintrag); startZeichnen(); }),
      );
      return;
    }
    w.append(
      knopf("Standard", "restore", () => { anpassen = [...STANDARD]; startZeichnen(); }),
      knopf("Abbrechen", "close", () => { anpassen = null; startZeichnen(); }),
      knopf("Speichern", "check", speichern, "primaer"),
    );
  }
  async function speichern() {
    const liste = anpassen;
    try {
      const r = await fetch("api/einstellungen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ admin_start: liste }) });
      if (!r.ok) throw new Error(await r.text());
      PS.einst.admin_start = (await r.json()).einstellungen.admin_start;
      anpassen = null; startZeichnen(); PS.toast("Startseite gespeichert");
    } catch (e) { PS.toast("Nicht gespeichert: " + (e.message || e), true); }
  }
  function grussZeigen() {
    const h = new Date().getHours();
    $("#as-gruss").textContent = h < 5 ? "Gute Nacht." : h < 11 ? "Guten Morgen." : h < 18 ? "Guten Tag." : "Guten Abend.";
    const n = lage();
    const krit = n.filter((x) => x.stufe !== "info").length;
    $("#as-lage").textContent = !n.length ? "Alles im grünen Bereich." : krit ? `${krit} ${krit === 1 ? "Punkt braucht" : "Punkte brauchen"} Aufmerksamkeit.` : `${n.length} ${n.length === 1 ? "Hinweis" : "Hinweise"}, nichts Dringendes.`;
  }

  // Neu zeichnen: nur betroffene Blöcke, gebündelt, nicht während jemand darin bedient
  const faellig = new Set();
  let bundel = null;
  PS.admin.vormerken = (id) => vormerken(id);
  function vormerken(id) {
    faellig.add(id);
    if (bundel) return;
    bundel = setTimeout(function los() {
      if (Date.now() - gedrueckt < 4000 || anpassen || PS.ordnung.zieht) { bundel = setTimeout(los, 1500); return; }
      bundel = null;
      [...faellig].forEach((x) => {
        const b = bloecke.get(x); if (!b) return;
        if (b.def.signatur && b.def.signatur() === b.sig) { if (b.def.aktualisieren) b.def.aktualisieren(b.el.querySelector(".r-box")); return; }
        if (b.el.contains(document.activeElement) && document.activeElement !== document.body) return;
        b.el.querySelectorAll("img").forEach(PS.kameraStoppen);
        blockZeichnen(x);
      });
      faellig.clear(); grussZeigen();
    }, 1200);
  }
  $("#as-raster").addEventListener("pointerdown", () => { gedrueckt = Date.now(); }, true);
  $("#as-raster").addEventListener("input", () => { gedrueckt = Date.now(); }, true);
  PS.on("diff", (ids) => {
    if (document.body.classList.contains("offen")) return;
    bloecke.forEach((b, id) => { if (b.def.relevant(ids)) vormerken(id); });
    // Thermostate an Ort und Stelle nachführen
    document.querySelectorAll("#as-raster [data-klima]").forEach((el) => { if (ids.has(el.dataset.klima) && el.aktualisieren) el.aktualisieren(); });
  });
  PS.on("karten", () => { setTimeout(() => bloecke.forEach((b, id) => { if (b.def.karten || id === "aufmerksamkeit") vormerken(id); }), 50); });
  PS.on("popups", () => vormerken("aufmerksamkeit"));
  PS.on("meldungen", () => vormerken("aufmerksamkeit"));
  PS.on("aufnahmen", () => { aufnahmenLaden().then(() => { vormerken("tueren"); vormerken("aufmerksamkeit"); }); });
  PS.on("init", () => { if (!anpassen) startZeichnen(); aufnahmenLaden().then(() => vormerken("aufmerksamkeit")); });
  PS.on("einstellungen", () => { if (!anpassen) startZeichnen(); });
  PS.on("registry", () => vormerken("raeume"));
  // Zurück auf die Startseite: frisch zeichnen (während ein Modul offen war, ruhten die Blöcke)
  let warOffen = false;
  PS.on("seite", () => {
    const offen = document.body.classList.contains("offen");
    if (warOffen && !offen) setTimeout(() => { if (!document.body.classList.contains("offen") && !anpassen) startZeichnen(); }, 30);
    warOffen = offen;
  });
  setInterval(() => { if (!document.body.classList.contains("offen")) bloecke.forEach((b, id) => { if (b.def.takt) vormerken(id); }); }, 15000);
  setInterval(grussZeigen, 60000);

  // ------------------------------------------------------------ Laufschrift für zu lange Namen
  const LAUF = ".kachel b, .as-raum .n, .gross .titel > span, .r-box h3 > span, .as-thermo .n > span, .raum .oben b";
  let laufNr = 0;
  function laufschrift() {
    document.querySelectorAll(LAUF).forEach((el) => {
      // Zahlenwalzen und Ringe haben ihr eigenes Innenleben
      if (el.classList.contains("lauf-innen") || el.matches(".wert-txt, [data-text]") || el.closest(".ring")) return;
      if (!el.firstElementChild && el.textContent.trim()) {
        const i = document.createElement("span"); i.className = "lauf-innen";
        i.textContent = el.textContent; el.textContent = ""; el.appendChild(i);
      }
      const innen = el.firstElementChild;
      if (!innen || !innen.classList.contains("lauf-innen")) { el.classList.remove("lauftext"); return; }
      const ueber = innen.offsetWidth - el.clientWidth;
      const an = el.clientWidth > 0 && ueber > 0;
      if (!an) { el.classList.remove("lauftext"); delete el.dataset.weg; return; }
      // Bis knapp vor den rechten Rand fahren (außerhalb der Ausblendung); nur bei echter Änderung neu setzen,
      // sonst springt die laufende Bewegung zurück
      const weg = Math.round(ueber + 18);
      if (el.dataset.weg !== String(weg)) {
        el.dataset.weg = String(weg);
        el.style.setProperty("--weg", `-${weg}px`);
        el.style.setProperty("--dauer", `${Math.max(9, weg / 26 / 0.42).toFixed(1)}s`);
        el.style.setProperty("--verzug", `${((laufNr++ % 7) * 0.9).toFixed(1)}s`);
      }
      el.classList.add("lauftext");
    });
  }
  let laufTimer = null;
  const laufBald = () => { clearTimeout(laufTimer); laufTimer = setTimeout(laufschrift, 250); };
  new MutationObserver(laufBald).observe(document.body, { childList: true, subtree: true, characterData: true });
  addEventListener("resize", laufBald);

  // ------------------------------------------------------------ Admin-Seiten
  PS.module.tuerdienst = {
    titel: "Türdienst", kurz: "Tür", icon: "doorbell",
    async render(el) {
      el.classList.add("admin-seite");
      const g = E('<div class="as-seitenraster"></div>'); el.appendChild(g);
      const b1 = box("Nachrichten", "Anrufbeantworter"); const w1 = E('<div class="as-block" style="--breite:2"></div>'); w1.appendChild(b1); g.appendChild(w1);
      const e = PS.einst;
      const b2 = box("Einstellungen", "Türdienst"); const w2 = E('<div class="as-block" style="--breite:1"></div>'); w2.appendChild(b2); g.appendChild(w2);
      const werte = [
        ["Türdienst", e.pforte_aktiv === false ? "aus" : "an"],
        ["Anrufbeantworter nach", `${e.pforte_ab_s ?? 30} s`],
        ["Vorlauf vor der Begrüßung", `${e.pforte_vorlauf_s ?? 3} s`],
        ["Längste Nachricht", `${e.pforte_max_s ?? 60} s`],
        ["Ablage", e.pforte_ordner || "lokal"],
        ["Push an", (e.pforte_push || []).map((x) => x.replace("notify.mobile_app_", "")).join(", ") || "–"],
      ];
      b2.appendChild(E(`<dl class="as-werte">${werte.map(([k, v]) => `<dt>${PS.esc(k)}</dt><dd>${PS.esc(v)}</dd>`).join("")}</dl>`));
      b2.appendChild(knopf("Im Editor ändern", "pencil-outline", () => PS.oeffnen("editor")));
      const haus = PS.opt.haustueroeffner;
      if (haus && PS.z[haus]) {
        const k = knopf("Haustür öffnen (halten)", "door-open", null, "primaer");
        PS.halten(k, 2000, () => PS.dienst(PS.domain(haus), PS.domain(haus) === "lock" ? "open" : "press", { entity_id: haus }).then(() => PS.toast("Haustür geöffnet")));
        b2.appendChild(k);
      }
      const tab = E('<div class="as-tabelle"><table><thead><tr><th></th><th>Zeit</th><th>Länge</th><th>Abschrift</th></tr></thead><tbody></tbody></table></div>');
      b1.appendChild(tab);
      const liste = await aufnahmenLaden(60);
      const tb = tab.querySelector("tbody");
      if (!liste.length) tb.innerHTML = '<tr><td colspan="4" class="leer">Noch keine Nachrichten.</td></tr>';
      liste.forEach((a) => {
        const tr = E(`<table><tr><td></td><td class="tabular">${PS.esc(zeitText(a.zeit))}</td><td class="tabular">${PS.esc(a.dauer_s ?? "?")} s</td><td>${PS.esc(a.text || "Keine Abschrift")}</td></tr></table>`).querySelector("tr");
        tr.firstElementChild.appendChild(PS.aufnahmeKnopf(a.datei, a.dauer_s));
        tb.appendChild(tr);
      });
    },
  };

  PS.module.system = {
    titel: "System", icon: "pulse",
    zaehler: () => PS.systemzustand().weg.length,
    async render(el) {
      el.classList.add("admin-seite");
      const g = E('<div class="as-seitenraster"></div>'); el.appendChild(g);
      const block = (titel, klein, breite = 1) => { const b = box(titel, klein); const w = E(`<div class="as-block" style="--breite:${breite}"></div>`); w.appendChild(b); g.appendChild(w); return b; };
      const { weg, gesamt } = PS.systemzustand();
      const b1 = block("Systemzustand", `${gesamt - weg.length} von ${gesamt} Geräten erreichbar`);
      if (!weg.length) b1.appendChild(E(`<div class="as-nominal">${PS.ic("check-circle-outline")}<div><b>Alles nominal</b><small>Alle Geräte melden sich.</small></div></div>`));
      else { const l = E('<div class="liste"></div>'); weg.slice(0, 8).forEach(({ d, e }) => l.appendChild(zeile(PS.iconName(e), PS.geraete[d] || PS.name(e), `nicht erreichbar · ${PS.zeitRelativ(PS.st(e).lc)}`, () => PS.mehrInfos(e)))); b1.appendChild(l); }
      b1.appendChild(knopf("Wartung öffnen", "wrench", () => PS.oeffnen("wartung")));
      const b2 = block("Panel Studio", `Version ${PS.version || "?"}`);
      const info = E('<dl class="as-werte"></dl>'); b2.appendChild(info);
      try {
        const d = await (await fetch("api/einstellungen", { cache: "no-store" })).json();
        info.innerHTML = `<dt>Home Assistant</dt><dd>${d.verbunden ? "verbunden" : "getrennt"}</dd><dt>Offene Verbindungen</dt><dd>${PS.esc(d.panels)} (Wandpanels und diese Ansicht)</dd><dt>Panel-Port</dt><dd>${PS.esc(d.port)}</dd>`;
      } catch { info.innerHTML = "<dt>Status</dt><dd>nicht abrufbar</dd>"; }
      b2.appendChild(E('<div class="reihe"></div>')).append(
        knopf("Als eigene App öffnen", "open-in-new", () => window.open("/local/pm-dashboard/index.html", "_blank", "noopener"), "primaer"),
        knopf("Panel-Vorschau", "tablet", () => window.open("panel", "_blank", "noopener")),
      );
      const b3 = block("Meldungen", `${(PS.popups || []).length} offen`);
      const l3 = E('<div class="liste"></div>');
      (PS.popups || []).forEach((m) => l3.appendChild(zeile(PS.meldungIcon(m.icon), m.titel, [m.text, PS.zeitRelativ(new Date(m.seit * 1000).toISOString())].filter(Boolean).join(" · "), () => PS.popupZeigen(m.id))));
      if (!(PS.popups || []).length) l3.appendChild(leer("Keine offenen Meldungen."));
      b3.appendChild(l3);
      b3.appendChild(knopf("Benachrichtigungen", "bell-outline", () => PS.oeffnen("hinweise")));
      const b4 = block("Home Assistant", "öffnet in Home Assistant", 3);
      const links = E('<div class="as-links"></div>');
      HA_LINKS.forEach(([t, i, p]) => { const a = E(`<button type="button" class="as-link">${PS.ic(i)}<span>${PS.esc(t)}</span></button>`); a.addEventListener("click", () => haOeffnen(p)); links.appendChild(a); });
      b4.appendChild(links);
    },
  };

  // Terminal: die App „Advanced SSH & Web Terminal“ (oder „Terminal & SSH“) über Ingress
  PS.module.terminal = appSeite("Terminal", "console", ["a0d7b954_ssh", "core_ssh"], null,
    "Kein Web-Terminal gefunden. Benötigt wird die App „Advanced SSH & Web Terminal“ oder „Terminal & SSH“.");
  PS.module.music_assistant = { ...appSeite("Music Assistant", "music-circle-outline", [], "_music_assistant", "Music Assistant ist nicht installiert.") };
  // Klima Studio über seinen eigenen Ingress (der Umweg über die App funktioniert nur am Wandpanel ohne Ingress)
  PS.module.studio = { ...appSeite("Klima Studio", "thermometer-lines", ["bdf1cc64_pm_klima_studio"], "_pm_klima_studio", "PM Klima Studio ist nicht installiert."), kurz: (PS.module.studio || {}).kurz };
  // Seiten von Home Assistant im Dashboard
  const haSeite = (titel, icon, pfad, kurz) => ({ titel, icon, kurz, render(el) { haRahmen(el, pfad, titel); } });
  PS.module.ha_einstellungen = haSeite("Einstellungen", "cog-outline", "/config/dashboard");
  PS.module.ha_karte = haSeite("Karte", "map-outline", "/map");
  PS.module.ha_energie = haSeite("Energie HA", "home-lightning-bolt-outline", "/energy");
  PS.module.ha_seite = { titel: "Home Assistant", icon: "home-assistant", render(el, pfad) { haRahmen(el, pfad || "/config/dashboard"); } };

  PS.module.editor = {
    titel: "Editor", icon: "tune-variant",
    render(el) {
      el.classList.add("rahmen-seite");
      el.appendChild(E('<iframe class="admin-rahmen" src="editor" title="Editor"></iframe>'));
    },
  };
})();
