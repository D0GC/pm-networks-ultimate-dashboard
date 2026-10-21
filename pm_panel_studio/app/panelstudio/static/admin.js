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

  PS.admin = { module: ["tuerdienst", "system", "terminal", "editor"] };
  document.body.classList.add("admin");

  // ------------------------------------------------------------ Aufbau: Kopfzeile und Startseite
  const start = $(".start");
  const kopf = E(`<header class="admin-kopf">
    <div class="ak-zeit"></div><div class="ak-lage"></div>
    <div class="ak-rechts"><button type="button" class="ak-suche" id="ak-suche">${PS.ic("magnify")}<span>Suchen</span><kbd>/</kbd></button></div>
  </header>`);
  kopf.querySelector(".ak-zeit").append($("#uhr"), $("#datum"));
  kopf.querySelector(".ak-lage").append($("#wetter"), $("#personen"), $("#status"));
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
  // Seite in Home Assistant öffnen (Seitenleiste bleibt; die Admin-Ansicht läuft im selben Fenster eingebettet)
  function haOeffnen(pfad) {
    try {
      const t = window.top;
      if (t && t !== window && t.location.origin === location.origin) {
        t.history.pushState(null, "", pfad);
        t.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
        return;
      }
    } catch { /* anderer Ursprung: normal öffnen */ }
    window.open(pfad, "_top");
  }
  PS.haOeffnen = haOeffnen;
  const HA_LINKS = [
    ["Automationen", "robot", "/config/automation/dashboard"], ["Skripte", "script-text-outline", "/config/script/dashboard"],
    ["Geräte und Dienste", "devices", "/config/integrations/dashboard"], ["Entitäten", "shape-outline", "/config/entities"],
    ["Helfer", "tools", "/config/helpers"], ["Apps", "puzzle-outline", "/hassio/dashboard"],
    ["Protokolle", "math-log", "/config/logs"], ["Entwicklerwerkzeuge", "hammer-wrench", "/developer-tools/state"],
    ["Verlauf", "chart-box-outline", "/history"], ["Logbuch", "format-list-bulleted", "/logbook"],
    ["Sicherungen", "backup-restore", "/config/backup"], ["Einstellungen", "cog-outline", "/config/dashboard"],
  ];

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
        const g = E('<div class="r-thermos"></div>');
        thermo.forEach((t) => { const c = PS.klimaSteuerung(t); c.classList.add("kompakt"); g.appendChild(c); });
        b.appendChild(g);
      },
      // Thermostate aktualisieren sich an Ort und Stelle (siehe unten), laufende Eingaben bleiben
      relevant: () => false,
    },
    raeume: {
      titel: "Räume", icon: "floor-plan",
      render(b) {
        const aus = new Set(PS.einst.bereiche_ausblenden || []), folge = PS.einst.bereiche_reihenfolge || [];
        const rang = (id) => { const i = folge.indexOf(id); return i < 0 ? 999 : i; };
        const bereiche = PS.bereiche.filter((x) => !aus.has(x.id)).sort((x, y) => rang(x.id) - rang(y.id) || x.name.localeCompare(y.name, "de"));
        const r = E('<div class="as-raeume"></div>');
        bereiche.forEach((x) => {
          const w = PS.raumWerte(x.id);
          if (!w.ent.length) return;
          const chips = [];
          if (w.lichterAn) chips.push(`<i class="an">${w.lichterAn} Licht${w.lichterAn > 1 ? "er" : ""}</i>`);
          w.ent.filter((e) => PS.domain(e) === "media_player" && PS.s(e) === "playing").slice(0, 1).forEach((e) => chips.push(`<i>${PS.esc(PS.kurzname(e, x.name))} spielt</i>`));
          w.ent.filter((e) => e.startsWith("binary_sensor.") && ["door", "window", "opening"].includes(PS.a(e).device_class) && PS.s(e) === "on").slice(0, 1).forEach(() => chips.push('<i class="warn">offen</i>'));
          const k = E(`<button type="button" class="as-raum">${PS.ic(x.icon || "texture-box")}<span class="n">${PS.esc(x.name)}</span>
            <span class="w tabular">${w.temp != null ? PS.zahl(w.temp, 1) + "°" : "–"}${w.feuchte != null ? `<small>${PS.zahl(w.feuchte, 0)} %</small>` : ""}</span>
            <span class="c">${chips.join("") || "<i>ruhig</i>"}</span></button>`);
          k.addEventListener("click", () => PS.oeffnen("raeume", x.id));
          r.appendChild(k);
        });
        b.appendChild(r);
      },
      relevant: (ids) => [...ids].some((e) => /^(light|climate|sensor|media_player|binary_sensor)\./.test(e)),
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
        const leistung = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "power" && PS.sichtbar(e) && isFinite(num(e)));
        leistung.sort((x, y) => num(y) - num(x));
        const summe = leistung.reduce((s, e) => s + Math.max(0, num(e)), 0);
        const max = Math.max(1, ...leistung.map((e) => Math.abs(num(e))));
        b.querySelector("h3 small").textContent = `${PS.zahl(summe, 0)} W jetzt`;
        if (!leistung.length) { b.appendChild(leer("Keine Leistungssensoren gefunden.")); return; }
        leistung.slice(0, 6).forEach((e) => b.appendChild(balken(PS.name(e), PS.text(e), Math.abs(num(e)) / max, null, e)));
        b.appendChild(knopf("Energie öffnen", "chart-line", () => PS.oeffnen("energie")));
      },
      relevant: (ids) => [...ids].some((e) => e.startsWith("sensor.") && PS.a(e).device_class === "power"),
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
    },
  };
  const STANDARD = ["aufmerksamkeit:3", "hinweise:1", "tueren:1", "klima:1", "raeume:2", "schnellzugriff:1", "energie:1", "pakete:1", "medien:1"];

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

  // ------------------------------------------------------------ Startseite zeichnen und anpassen
  const bloecke = new Map();  // id → { el, def, sig, timer }
  let anpassen = null;        // Arbeitskopie der Anordnung im Anpassen-Modus
  let gedrueckt = 0;          // letzte Bedienung in einem Block: so lange nicht neu zeichnen
  const anordnung = () => {
    const roh = anpassen || (Array.isArray(PS.einst.admin_start) ? PS.einst.admin_start : STANDARD);
    return roh.map((x) => { const [id, br] = String(x).split(":"); return { id, breite: Math.max(1, Math.min(3, +br || 1)) }; }).filter((x) => B[x.id]);
  };
  function blockZeichnen(id) {
    const b = bloecke.get(id); if (!b) return;
    const inhalt = box(b.def.titel, " ");
    inhalt.querySelector("h3").prepend(E(PS.ic(b.def.icon)));
    b.def.render(inhalt);
    PS.kachelnBinden(inhalt);
    b.el.querySelector(".r-box") ? b.el.querySelector(".r-box").replaceWith(inhalt) : b.el.prepend(inhalt);
    b.sig = b.def.signatur ? b.def.signatur() : null;
  }
  function startZeichnen() {
    const raster = $("#as-raster");
    raster.querySelectorAll("img").forEach(PS.kameraStoppen);
    raster.innerHTML = ""; bloecke.clear();
    const liste = anordnung();
    liste.forEach(({ id, breite }, i) => {
      const el = E(`<div class="as-block" data-id="${id}" style="--breite:${breite}"></div>`);
      bloecke.set(id, { el, def: B[id] });
      raster.appendChild(el);
      blockZeichnen(id);
      if (anpassen) el.appendChild(werkzeugBlock(id, breite, i, liste.length));
    });
    if (!liste.length) raster.appendChild(leer("Die Startseite ist leer. Über „Anpassen“ Blöcke hinzufügen."));
    vorrat(); werkzeug(); grussZeigen();
  }
  function werkzeugBlock(id, breite, i, n) {
    const w = E(`<div class="as-werkzeug">
      <button type="button" data-a="hoch" title="Nach vorn"${i === 0 ? " disabled" : ""}>${PS.ic("arrow-left")}</button>
      <button type="button" data-a="runter" title="Nach hinten"${i === n - 1 ? " disabled" : ""}>${PS.ic("arrow-right")}</button>
      <span class="breiten">${[1, 2, 3].map((x) => `<button type="button" data-b="${x}" class="${x === breite ? "aktiv" : ""}" title="${x} Spalte${x > 1 ? "n" : ""}">${x}</button>`).join("")}</span>
      <button type="button" data-a="weg" title="Ausblenden">${PS.ic("eye-off-outline")}</button></div>`);
    w.addEventListener("click", (ev) => {
      const t = ev.target.closest("button"); if (!t) return;
      const l = anpassen, j = l.findIndex((x) => x.startsWith(id + ":"));
      if (t.dataset.b) l[j] = `${id}:${t.dataset.b}`;
      else if (t.dataset.a === "hoch" && j > 0) [l[j - 1], l[j]] = [l[j], l[j - 1]];
      else if (t.dataset.a === "runter" && j < l.length - 1) [l[j + 1], l[j]] = [l[j], l[j + 1]];
      else if (t.dataset.a === "weg") l.splice(j, 1);
      startZeichnen();
    });
    return w;
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
      c.addEventListener("click", () => { anpassen.push(`${id}:1`); startZeichnen(); });
      r.appendChild(c);
    });
    v.appendChild(r);
  }
  function werkzeug() {
    const w = $("#as-werkzeug"); w.innerHTML = "";
    document.body.classList.toggle("anpassen", !!anpassen);
    if (!anpassen) { w.appendChild(knopf("Anpassen", "view-dashboard-edit-outline", () => { anpassen = anordnung().map((x) => `${x.id}:${x.breite}`); startZeichnen(); })); return; }
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
  function vormerken(id) {
    faellig.add(id);
    if (bundel) return;
    bundel = setTimeout(function los() {
      if (Date.now() - gedrueckt < 4000 || anpassen) { bundel = setTimeout(los, 1500); return; }
      bundel = null;
      [...faellig].forEach((x) => {
        const b = bloecke.get(x); if (!b) return;
        if (b.def.signatur && b.def.signatur() === b.sig) return;
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

  // ------------------------------------------------------------ Admin-Seiten
  PS.module.tuerdienst = {
    titel: "Türdienst", kurz: "Tür", icon: "doorbell",
    async render(el) {
      el.classList.add("admin-seite");
      const g = E('<div class="as-raster"></div>'); el.appendChild(g);
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
      const g = E('<div class="as-raster"></div>'); el.appendChild(g);
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
      b2.appendChild(knopf("Panel-Vorschau", "tablet", () => window.open("panel", "_blank", "noopener")));
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

  // Terminal: die App „Advanced SSH & Web Terminal“ über Ingress eingebettet (Adresse über die Sitzung von Home Assistant)
  const TERMINAL_APPS = ["a0d7b954_ssh", "core_ssh"];
  async function terminalAdresse() {
    const t = window.top;
    if (!t || t === window || !t.hassConnection) return null;
    const { conn } = await t.hassConnection;
    for (const slug of TERMINAL_APPS) {
      try {
        const info = await conn.sendMessagePromise({ type: "supervisor/api", endpoint: `/addons/${slug}/info`, method: "get" });
        if (info && info.ingress_url && info.state === "started") return { url: info.ingress_url, slug, name: info.name };
        if (info && info.ingress_url) return { slug, name: info.name, aus: true };
      } catch { /* nächste App */ }
    }
    return null;
  }
  PS.module.terminal = {
    titel: "Terminal", icon: "console",
    async render(el) {
      el.classList.add("rahmen-seite");
      const hinweis = E('<div class="leer">Terminal wird verbunden …</div>'); el.appendChild(hinweis);
      let t = null;
      try { t = await terminalAdresse(); } catch { t = null; }
      if (t && t.url) { hinweis.remove(); el.appendChild(E(`<iframe class="admin-rahmen" src="${PS.esc(t.url)}" title="Terminal"></iframe>`)); return; }
      hinweis.textContent = t && t.aus ? `${t.name} ist gestoppt.` : "Kein Web-Terminal gefunden. Benötigt wird die App „Advanced SSH & Web Terminal“ oder „Terminal & SSH“.";
      el.appendChild(knopf("In Home Assistant öffnen", "open-in-app", () => haOeffnen(`/hassio/ingress/${(t && t.slug) || TERMINAL_APPS[0]}`)));
    },
  };

  PS.module.editor = {
    titel: "Editor", icon: "tune-variant",
    render(el) {
      el.classList.add("rahmen-seite");
      el.appendChild(E('<iframe class="admin-rahmen" src="editor" title="Editor"></iframe>'));
    },
  };
})();
