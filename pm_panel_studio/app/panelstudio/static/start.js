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
    el.innerHTML = `${PS.ic(PS.wetterIcon(st.s))}<div><b class="tabular">${PS.zahl(aussen, 1)}°</b><small>${PS.esc(PS.text(w))}${heute.temperature != null ? ` · ${PS.zahl(heute.templow, 0)}–${PS.zahl(heute.temperature, 0)}°` : ""}${regen}</small></div>`;
    const tage = vorhersage.slice(1, 4);
    $("#vorschau").innerHTML = tage.map((t) => {
      const d = new Date(t.datetime);
      return `<div>${d.toLocaleDateString("de-DE", { weekday: "short" })}${PS.ic(PS.wetterIcon(t.condition))}<span class="tabular">${PS.zahl(t.templow, 0)}–${PS.zahl(t.temperature, 0)}°</span></div>`;
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
    const anzahl = (PS.meldungen || []).length + (PS.karten || []).filter((k) => k.art === "hinweis").length;
    teile.push(`<button class="pille glocke${(PS.meldungen || []).length ? " neu" : ""}" data-modul="hinweise" aria-label="Hinweise">${PS.ic(anzahl ? "bell-badge-outline" : "bell-outline")}${anzahl ? `<span class="tabular">${anzahl}</span>` : ""}</button>`);
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
  }

  // ------------------------------------------------------------ Karussell
  const KARTE = {
    eil: ["alert-decagram-outline", "var(--krit)"], warnung: ["alert-outline", "var(--warn)"], termin: ["calendar-clock-outline", "#c99bf0"],
    arbeit: ["car-clock", "var(--gut)"], wetter: ["weather-partly-cloudy", "var(--info)"], muell: ["trash-can-outline", "#d9a7ff"],
    fertig: ["check-circle-outline", "var(--gut)"], offen: ["door-open", "var(--warn)"], lueften: ["window-open-variant", "var(--warn)"],
    pollen: ["flower-pollen-outline", "#f6d36b"], eigen: ["information-outline", "var(--lavender)"], neutral: ["information-outline", "var(--lavender)"],
    dusche: ["shower-head", "var(--info)"], spa: ["hot-tub", "var(--akzent)"], kohle: ["fire", "#ff9a5c"], waesche: ["washing-machine", "var(--info)"],
    spueler: ["dishwasher", "var(--info)"], robo: ["robot-vacuum", "var(--gut)"], musik: ["music-note-outline", "#c99bf0"], ruhig: ["leaf", "var(--gut)"],
  };
  PS.kartenIcon = (k) => (KARTE[k] || KARTE.neutral)[0];
  const LEER = { id: "leer", art: "hinweis", schluessel: "ruhig", titel: "Hinweise", wert: "Alles ruhig", hinweis: "Keine Hinweise und keine laufenden Geräte.", ring: null };
  let aktuell = 0, liste = [], wechselZeit = 0;
  const elemente = new Map();

  function karteInhalt(k) {
    const [ic, farbe] = KARTE[k.schluessel] || KARTE.neutral;
    const akt = k.art === "aktivitaet";
    const kopf = k.schluessel === "musik" ? "Musik" : akt ? "Aktivität" : k.schluessel === "eil" ? `Eilmeldung · ${k.titel}` : k.titel || "Hinweis";
    const innen = akt
      ? `<b class="wert-txt">${PS.esc(k.wert)}</b><small>${PS.esc(k.hinweis)}</small>`
      : PS.ic(ic);
    const h2 = akt ? k.titel : k.schluessel === "eil" ? k.hinweis : k.wert;
    const p = k.unter ? k.unter : akt ? (k.ende ? `fertig gegen ${PS.uhrzeit(new Date(k.ende))}` : "") : k.schluessel === "eil" ? "" : k.hinweis;
    return { farbe, html: `<div class="kopf">${PS.ic(ic)}<span>${PS.esc(kopf)}</span></div><div class="ring">${PS.ringSVG(akt ? k.ring : 1)}<div class="innen">${innen}</div></div><h2>${PS.esc(h2)}</h2><p>${PS.esc(p)}</p>` };
  }
  function kartenSetzen(karten) {
    const alt = liste[aktuell] && liste[aktuell].id;
    liste = karten && karten.length ? karten : [LEER];
    const box = $("#karussell");
    const ids = new Set(liste.map((k) => k.id));
    for (const [id, el] of elemente) if (!ids.has(id)) { el.remove(); elemente.delete(id); }
    for (const k of liste) {
      let el = elemente.get(k.id);
      const inhalt = karteInhalt(k);
      if (!el) {
        el = document.createElement("div"); el.className = "karte"; el.dataset.id = k.id;
        el.addEventListener("click", () => { weiter(); });
        box.appendChild(el); elemente.set(k.id, el);
        el.innerHTML = inhalt.html;
      } else if (el._html !== inhalt.html) {
        // Teile tauschen, den Ring aber behalten, damit er weich zum neuen Wert gleitet
        const neu = document.createElement("div"); neu.innerHTML = inhalt.html;
        el.querySelector(".kopf").replaceWith(neu.querySelector(".kopf"));
        el.querySelector(".ring .innen").replaceWith(neu.querySelector(".ring .innen"));
        el.querySelector("h2").replaceWith(neu.querySelector("h2"));
        el.querySelector("p").replaceWith(neu.querySelector("p"));
        PS.ringSetzen(el.querySelector(".ring svg"), k.art === "aktivitaet" ? k.ring : 1);
      }
      el._html = inhalt.html; el._karte = k;
      el.style.setProperty("--farbe", inhalt.farbe);
      el.classList.toggle("eil", k.schluessel === "eil");
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
      if (el && k.art === "aktivitaet") { const svg = el.querySelector(".ring svg"); PS.ringSetzen(svg, 0); requestAnimationFrame(() => requestAnimationFrame(() => PS.ringSetzen(svg, k.ring))); }
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
      const t = el.querySelector(".wert-txt"); if (t) t.textContent = fmtRest(rest);
      if (k.dauer_s) PS.ringSetzen(el.querySelector(".ring svg"), rest / k.dauer_s);
    }
  }
  function fmtRest(sek) {
    sek = Math.round(sek); const h = Math.floor(sek / 3600), m = Math.floor((sek % 3600) / 60), s = sek % 60;
    return h ? `${h}:${String(m).padStart(2, "0")} h` : `${m}:${String(s).padStart(2, "0")}`;
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
      const teile = [];
      if (w.temp != null) teile.push(`${PS.zahl(w.temp, 1)}°`);
      if (w.feuchte != null) teile.push(`${PS.zahl(w.feuchte, 0)} %`);
      teile.push(w.lichterAn ? `${w.lichterAn} Licht${w.lichterAn > 1 ? "er" : ""}` : "Licht aus");
      return `<div data-b="${PS.esc(b)}"><span>${PS.esc(PS.bereichName(b))}</span><span>${teile.join(" · ")}</span></div>`;
    }).join("");
    box.querySelectorAll("[data-b]").forEach((el) => el.addEventListener("click", () => PS.oeffnen("raeume", el.dataset.b)));
  }

  // ------------------------------------------------------------ Modulleiste und Sheet
  const stapel = [];
  let zuletztBeruehrt = Date.now();
  function dock() {
    const mods = ["start", ...(PS.einst.module || [])].filter((m) => PS.module[m] || m === "start");
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
    $("#sheet-tabs").innerHTML = "";
    const inhalt = $("#sheet-inhalt");
    inhalt.querySelectorAll("img").forEach(PS.kameraStoppen);
    PS.emit("seite");
    inhalt.classList.toggle("still", !!still);
    inhalt.innerHTML = ""; inhalt.scrollTop = 0;
    seite.render(inhalt);
    PS.kachelnBinden(inhalt);
  }
  PS.neuZeichnen = () => { if (stapel.length) { const y = $("#sheet-inhalt").scrollTop; zeichnen(true); $("#sheet-inhalt").scrollTop = y; } };
  PS.tabs = (eintraege, aktiv, beiWahl) => {
    const box = $("#sheet-tabs");
    box.innerHTML = eintraege.map(([k, t]) => `<button data-k="${PS.esc(k)}" class="${k === aktiv ? "aktiv" : ""}">${PS.esc(t)}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      box.querySelectorAll("button").forEach((x) => x.classList.toggle("aktiv", x === b)); beiWahl(b.dataset.k);
    }));
  };

  // ------------------------------------------------------------ Ereignis (Tür)
  function ereignis(e) {
    const an = !!(e && e.aktiv);
    document.body.classList.toggle("ereignis-an", an);
    const img = $("#ereignis-bild");
    if (!an) { PS.kameraStoppen(img); return; }
    document.body.classList.remove("ruhe");
    $("#ereignis-titel").textContent = e.titel || "Tür";
    if (e.kamera) PS.kameraStarten(img, e.kamera);
    $("#ereignis-oeffnen").hidden = !e.tueroeffner;
  }

  // ------------------------------------------------------------ Aufbau
  function alles() {
    uhr(); wetter(); personen(); statusZeile(); schnellzugriff(); raeumeKurz(); dock();
  }
  PS.on("init", () => { alles(); vorhersageLaden(); if (stapel.length) PS.neuZeichnen(); });
  PS.on("karten", (k) => { kartenSetzen(k); statusZeile(); });
  PS.on("meldungen", () => { statusZeile(); if (stapel.length && stapel[0].modul === "hinweise") PS.neuZeichnen(); });
  PS.on("ereignis", ereignis);
  PS.on("einstellungen", () => { schnellzugriff(); raeumeKurz(); dock(); zeigen(false); });
  PS.on("registry", () => { raeumeKurz(); });
  let diffTimer = null;
  PS.on("diff", (ids) => {
    const relevant = [...ids].some((e) => e.startsWith("person.") || e.startsWith("binary_sensor.") || e.startsWith("lock.") || e === PS.opt.alarm_entitaet || e === PS.opt.wetter_entitaet || e === PS.opt.aussentemperatur || e.startsWith("sensor.") || e.startsWith("light.") || e.startsWith("climate.") || e.startsWith("update."));
    if (!relevant || diffTimer) return;
    diffTimer = setTimeout(() => { diffTimer = null; wetter(); personen(); statusZeile(); raeumeKurz(); dock(); }, 600);
  });
  PS.on("beruehrt", () => { zuletztBeruehrt = Date.now(); });

  document.addEventListener("DOMContentLoaded", () => {
    $("#sheet-zu").addEventListener("click", PS.schliessen);
    $("#sheet-zurueck").addEventListener("click", zurueck);
    $("#ereignis-ignorieren").addEventListener("click", () => { PS.anfrage({ typ: "ereignis_ende" }).catch(() => {}); ereignis({ aktiv: false }); });
    PS.halten($("#ereignis-oeffnen"), 2000, () => {
      PS.dienst(PS.domain(PS.opt.tueroeffner), PS.domain(PS.opt.tueroeffner) === "lock" ? "open" : "press", { entity_id: PS.opt.tueroeffner }).then(() => PS.toast("Tür geöffnet"));
    });
    setInterval(uhr, 5000);
    setInterval(takt, 1000);
    setInterval(vorhersageLaden, 30 * 60 * 1000);
    setInterval(() => {
      if (document.body.classList.contains("offen") && Date.now() - zuletztBeruehrt > (PS.einst.bedienung_zurueck_s || 60) * 1000) PS.schliessen();
    }, 5000);
    // Wischen im Sheet nach unten (am Kopf) schließt
    let y0 = null;
    $(".sheet-kopf").addEventListener("pointerdown", (e) => { y0 = e.clientY; });
    $(".sheet-kopf").addEventListener("pointerup", (e) => { if (y0 != null && e.clientY - y0 > 80) PS.schliessen(); y0 = null; });
    try { if ("wakeLock" in navigator) navigator.wakeLock.request("screen").catch(() => {}); } catch { /* optional */ }
    PS.verbinden();
  });
})();
