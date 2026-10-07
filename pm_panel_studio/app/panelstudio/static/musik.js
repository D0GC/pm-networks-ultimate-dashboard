/* PM Panel Studio – Music Assistant: nativ über die HA-Integration music_assistant (Player, Suche, Bibliothek).
   Links die Player, Mitte „Läuft gerade“, rechts Suche und Bibliothek. Live-Änderungen werden an Ort und Stelle
   nachgeführt (kein Neuaufbau der Seite). */
(function () {
  "use strict";
  const PS = window.PS;
  const E = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const alle = () => Object.keys(PS.z);
  const box = (titel, klein) => E(`<section class="r-box"><h3><span>${PS.esc(titel)}</span>${klein ? `<small>${PS.esc(klein)}</small>` : ""}</h3></section>`);
  const knopf = (text, icon, fn, klasse = "") => { const b = E(`<button class="knopf ${klasse}">${icon ? PS.ic(icon) : ""}${text ? `<span>${PS.esc(text)}</span>` : ""}</button>`); if (fn) b.addEventListener("click", fn); return b; };
  function seite(el) {
    el.classList.add("raumseite");
    const g = E('<div class="raum-ansicht musik"><div class="r-spalte"></div><div class="r-spalte"></div><div class="r-spalte"></div></div>');
    el.appendChild(g);
    return g.children;
  }

  // ------------------------------------------------------------ Player
  // Nur Player der Integration (Attribut mass_player_type); gleichnamige Alexa-Player haben es nicht
  const istMass = (e) => PS.domain(e) === "media_player" && !!PS.a(e).mass_player_type;
  const spieler = () => alle().filter((e) => istMass(e) && PS.sichtbar(e))
    .sort((x, y) => (PS.s(y) === "playing") - (PS.s(x) === "playing") || PS.name(x).localeCompare(PS.name(y), "de"));
  const ZUSTAND = { playing: "Spielt", paused: "Pausiert", buffering: "Lädt", idle: "Bereit", on: "An", off: "Aus", standby: "Bereit", unavailable: "Nicht erreichbar", unknown: "Unbekannt" };
  const zustandText = (e) => ZUSTAND[PS.s(e)] || PS.s(e);
  const aktiv = (e) => ["playing", "paused", "buffering"].includes(PS.s(e));
  const BILD_OK = ["/api/media_player_proxy/", "/api/image_proxy/", "/api/image/serve/"];
  // Cover wie im Medien-Modul über /api/bild; nur Pfade, die der Server durchreicht (MA-Server-URLs sind es nicht)
  const bildPfad = (a) => [a.entity_picture, a.entity_picture_local].find((p) => typeof p === "string" && BILD_OK.some((x) => p.startsWith(x))) || null;
  const bildSrc = (p) => "api/bild?pfad=" + encodeURIComponent(p);
  const bildFlaeche = (pfad, icon, klasse = "") => {
    const c = E(`<div class="musik-cover ${klasse}"><span class="leer-icon">${PS.ic(icon)}</span><img alt="" hidden></div>`);
    c.setzen = (p) => {
      const img = c.querySelector("img");
      if (!p) { img.hidden = true; img.removeAttribute("src"); c.dataset.p = ""; return; }
      if (c.dataset.p === p) return;
      c.dataset.p = p;
      img.onload = () => { img.hidden = false; };
      img.onerror = () => { img.hidden = true; };
      img.src = bildSrc(p);
    };
    c.setzen(pfad);
    return c;
  };

  let gewaehlt = null;     // gewählter Player (bleibt über Neuaufbau erhalten)
  let ui = null;           // Verweise auf die aktuell gezeichnete Seite
  let eintragP = null;     // config_entry_id der Integration (einmal ermittelt)
  const eintrag = () => (eintragP = eintragP || PS.anfrage({ typ: "mass_eintrag" }).then((id) => { if (!id) throw new Error("Music Assistant ist nicht eingerichtet"); return id; }).catch((e) => { eintragP = null; throw e; }));
  const mass = async (service, data) => PS.dienst("music_assistant", service, { config_entry_id: await eintrag(), ...data }, true);

  function startwahl() {
    const l = spieler();
    if (gewaehlt && l.includes(gewaehlt)) return;
    const neuester = (e) => Date.parse(PS.st(e).lc) || 0;
    gewaehlt = (l.find((e) => PS.s(e) === "playing") || l.find((e) => PS.s(e) === "paused") || l.slice().sort((x, y) => neuester(y) - neuester(x))[0] || null);
  }

  // ------------------------------------------------------------ Links: Player-Liste
  function playerZeile(e) {
    const b = E(`<button class="musik-player" data-eid="${PS.esc(e)}"></button>`);
    b.append(bildFlaeche(null, "speaker", "klein"), E('<div class="txt"><b></b><small></small></div>'), E(`<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>`));
    b.addEventListener("click", () => { gewaehlt = e; if (ui) { ui.zeilen.forEach(playerAktualisieren); mitteAktualisieren(); ui.ziel.textContent = PS.name(e); } });
    playerAktualisieren(b);
    return b;
  }
  function playerAktualisieren(b) {
    const e = b.dataset.eid, a = PS.a(e);
    b.querySelector("b").textContent = PS.name(e);
    const titel = aktiv(e) && a.media_title ? `${zustandText(e)} · ${a.media_title}` : zustandText(e);
    b.querySelector("small").textContent = titel;
    b.classList.toggle("gewaehlt", e === gewaehlt);
    b.classList.toggle("spielt", PS.s(e) === "playing");
    b.classList.toggle("weg", !PS.z[e] || PS.nichtDa(e));
    b.querySelector(".musik-cover").setzen(aktiv(e) ? bildPfad(a) : null);
  }

  // ------------------------------------------------------------ Mitte: Läuft gerade
  const zeit = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function position(e) {
    const a = PS.a(e), dauer = Number(a.media_duration) || 0;
    if (a.media_position == null || !dauer) return { dauer, pos: 0 };
    let pos = Number(a.media_position) || 0;
    if (PS.s(e) === "playing" && a.media_position_updated_at) pos += Math.max(0, (Date.now() - Date.parse(a.media_position_updated_at)) / 1000);
    return { dauer, pos: Math.min(pos, dauer) };
  }
  function mitteBauen(host) {
    host.innerHTML = `<div class="musik-jetzt">
      <div class="musik-leerzustand">${PS.ic("music-box-multiple")}<b>Gerade spielt nichts</b><small>Such etwas aus oder tipp rechts auf ein Album.</small></div>
      <div class="musik-buehne"></div>
      <div class="musik-info"><b class="titel"></b><span class="interpret"></span><small class="album"></small></div>
      <div class="musik-zeit"><span class="pos tabular">0:00</span><div class="musik-balken"><i></i></div><span class="rest tabular">0:00</span></div>
      <div class="reihe musik-steuer"></div>
      <div class="musik-laut"></div></div>`;
    const j = host.firstElementChild, o = { host, j };
    o.cover = bildFlaeche(null, "music-note", "gross"); j.querySelector(".musik-buehne").appendChild(o.cover);
    const dienst = (s, d = {}) => () => gewaehlt && PS.dienst("media_player", s, { entity_id: gewaehlt, ...d });
    o.shuffle = knopf("", "shuffle-variant", () => gewaehlt && PS.dienst("media_player", "shuffle_set", { entity_id: gewaehlt, shuffle: !PS.a(gewaehlt).shuffle }), "rund");
    o.zurueck = knopf("", "skip-previous", dienst("media_previous_track"), "rund");
    o.spiel = knopf("", "play", dienst("media_play_pause"), "rund primaer gross");
    o.weiter = knopf("", "skip-next", dienst("media_next_track"), "rund");
    o.wiederhole = knopf("", "repeat", () => { if (!gewaehlt) return; const n = { off: "all", all: "one", one: "off" }[PS.a(gewaehlt).repeat] || "all"; PS.dienst("media_player", "repeat_set", { entity_id: gewaehlt, repeat: n }); }, "rund");
    j.querySelector(".musik-steuer").append(o.shuffle, o.zurueck, o.spiel, o.weiter, o.wiederhole);
    o.laut = PS.schieber({ label: "Lautstärke", min: 0, max: 100, schritt: 2, wert: 0, text: (v) => v + " %", beiEnde: (v) => gewaehlt && PS.dienst("media_player", "volume_set", { entity_id: gewaehlt, volume_level: v / 100 }) });
    j.querySelector(".musik-laut").appendChild(o.laut);
    return o;
  }
  function mitteAktualisieren() {
    if (!ui) return;
    const o = ui.mitte, e = gewaehlt, a = e ? PS.a(e) : {};
    const hat = !!e && PS.z[e] && !!a.media_title && aktiv(e);
    o.j.classList.toggle("leer", !hat);
    o.j.classList.toggle("kein-player", !e);
    o.j.classList.toggle("spielt", !!e && PS.s(e) === "playing");
    if (!e) return;
    o.cover.setzen(hat ? bildPfad(a) : null);
    o.j.querySelector(".titel").textContent = a.media_title || "";
    o.j.querySelector(".interpret").textContent = a.media_artist || "";
    o.j.querySelector(".album").textContent = a.media_album_name || "";
    o.spiel.innerHTML = PS.ic(PS.s(e) === "playing" ? "pause" : "play");
    o.shuffle.classList.toggle("aktiv", !!a.shuffle);
    const rep = a.repeat || "off";
    o.wiederhole.innerHTML = PS.ic(rep === "one" ? "repeat-once" : rep === "all" ? "repeat" : "repeat-off");
    o.wiederhole.classList.toggle("aktiv", rep !== "off");
    if (a.volume_level != null && !o.laut.classList.contains("zieht")) o.laut.setzen(Math.round(a.volume_level * 100));
    o.laut.hidden = a.volume_level == null;
    fortschritt();
  }
  // Fortschritt läuft lokal weiter (media_position + Zeitstempel), ohne dass HA ständig Werte schickt
  function fortschritt() {
    if (!ui || !gewaehlt || !PS.z[gewaehlt]) return;
    const o = ui.mitte, { dauer, pos } = position(gewaehlt);
    o.j.querySelector(".musik-balken i").style.width = (dauer ? (pos / dauer) * 100 : 0) + "%";
    o.j.querySelector(".pos").textContent = dauer ? zeit(pos) : "";
    o.j.querySelector(".rest").textContent = dauer ? "-" + zeit(dauer - pos) : "";
    o.j.querySelector(".musik-zeit").classList.toggle("ohne", !dauer);
  }

  // ------------------------------------------------------------ Rechts: Suche und Bibliothek
  const GRUPPEN = [["tracks", "Titel", "music-note"], ["albums", "Alben", "album"], ["playlists", "Playlists", "playlist-music"], ["artists", "Interpreten", "account-music"], ["radio", "Radio", "radio"]];
  const ICON_ART = { track: "music-note", album: "album", playlist: "playlist-music", artist: "account-music", radio: "radio" };
  const unter = (it) => [(it.artists || []).map((x) => (typeof x === "string" ? x : x.name)).filter(Boolean).join(", "), it.album && (it.album.name || it.album)].filter((x) => typeof x === "string" && x).join(" · ");
  const medienBild = (it) => (typeof it.image === "string" && BILD_OK.some((x) => it.image.startsWith(x)) ? it.image : null);
  function abspielen(it, wie) {
    if (!gewaehlt) { PS.toast("Kein Music-Assistant-Player gewählt", true); return; }
    const ziel = gewaehlt;
    // Einzelne Titel „jetzt“ vor die Warteschlange, alles andere ersetzt sie; „als Nächstes“ reiht ein
    const enqueue = wie || (it.media_type === "track" ? "play" : "replace");
    PS.dienst("music_assistant", "play_media", { entity_id: ziel, media_id: it.uri, media_type: it.media_type, enqueue })
      .then(() => PS.toast(enqueue === "next" ? `„${it.name}“ als Nächstes auf ${PS.name(ziel)}` : `„${it.name}“ auf ${PS.name(ziel)}`));
  }
  function ergebnisZeile(it) {
    const z = E(`<div class="musik-treffer"><button class="haupt"><span class="txt"><b></b><small></small></span></button></div>`);
    const h = z.querySelector(".haupt");
    h.prepend(bildFlaeche(medienBild(it), ICON_ART[it.media_type] || "music-note", "klein"));
    z.querySelector("b").textContent = it.name;
    z.querySelector("small").textContent = unter(it);
    h.addEventListener("click", () => abspielen(it));
    if (["track", "album", "playlist"].includes(it.media_type)) {
      const n = knopf("", "playlist-play", () => abspielen(it, "next"), "rund");
      n.title = "Als Nächstes"; n.setAttribute("aria-label", "Als Nächstes");
      z.appendChild(n);
    }
    return z;
  }
  async function suchen(q, ziel) {
    q = q.trim();
    const lauf = (ui.suchLauf = (ui.suchLauf || 0) + 1);
    if (!q) { ziel.innerHTML = ""; ui.bib.hidden = false; return; }
    ui.bib.hidden = true;
    ziel.innerHTML = '<div class="leer">Suche läuft …</div>';
    let r;
    try { r = await mass("search", { name: q, media_type: ["track", "album", "playlist", "artist", "radio"], limit: 6 }); }
    catch (e) { if (lauf === ui.suchLauf) ziel.innerHTML = `<div class="leer">${PS.esc(e.message || "Suche fehlgeschlagen")}</div>`; return; }
    if (!ui || lauf !== ui.suchLauf) return;
    ziel.innerHTML = "";
    r = r || {};
    let n = 0;
    GRUPPEN.forEach(([k, titel, icon]) => {
      const l = r[k] || []; if (!l.length) return;
      n += l.length;
      const g = E(`<div class="musik-gruppe"><h4>${PS.ic(icon)}<span>${PS.esc(titel)}</span></h4></div>`);
      l.forEach((it) => g.appendChild(ergebnisZeile({ media_type: k === "radio" ? "radio" : k.replace(/s$/, ""), ...it })));
      ziel.appendChild(g);
    });
    if (!n) ziel.innerHTML = `<div class="leer">Nichts gefunden für „${PS.esc(q)}“.</div>`;
  }
  const BIB = { zuletzt: ["Zuletzt", { media_type: "album", order_by: "last_played_desc", limit: 12 }], playlists: ["Playlists", { media_type: "playlist", order_by: "last_played_desc", limit: 12 }], radio: ["Radio", { media_type: "radio", order_by: "last_played_desc", limit: 12 }] };
  const bibCache = {};
  async function bibLaden(k, ziel) {
    ziel.innerHTML = '<div class="leer">Lädt …</div>';
    let items = bibCache[k];
    if (!items) {
      try { items = bibCache[k] = ((await mass("get_library", BIB[k][1])) || {}).items || []; }
      catch (e) { if (ui && ui.bibZiel === ziel) ziel.innerHTML = `<div class="leer">${PS.esc(e.message || "Bibliothek nicht erreichbar")}</div>`; return; }
      setTimeout(() => { delete bibCache[k]; }, 120e3);
    }
    if (!ui || ui.bibZiel !== ziel) return;
    ziel.innerHTML = "";
    if (!items.length) { ziel.innerHTML = '<div class="leer">Noch nichts da.</div>'; return; }
    const raster = E('<div class="musik-kacheln"></div>');
    items.forEach((it, i) => {
      const t = E(`<button class="musik-kachel" style="--i:${i}"><span class="txt"><b></b></span></button>`);
      t.prepend(bildFlaeche(medienBild(it), ICON_ART[it.media_type] || ICON_ART[BIB[k][1].media_type], "quadrat"));
      t.querySelector("b").textContent = it.name;
      t.addEventListener("click", () => abspielen({ media_type: BIB[k][1].media_type, ...it }));
      raster.appendChild(t);
    });
    ziel.appendChild(raster);
  }

  // ------------------------------------------------------------ Seite
  function musik(el) {
    const [l, m, r] = seite(el);
    startwahl();
    ui = { el, zeilen: [], mitte: null, suchLauf: 0 };
    // Links
    const b1 = box("Player", `${spieler().filter((e) => PS.s(e) === "playing").length} spielen`);
    ui.kopfKlein = b1.querySelector("small");
    const liste = E('<div class="musik-playerliste"></div>');
    spieler().forEach((e) => { const z = playerZeile(e); ui.zeilen.push(z); liste.appendChild(z); });
    b1.appendChild(liste); l.appendChild(b1);
    // Mitte
    const b2 = box("Läuft gerade", "");
    ui.mitte = mitteBauen(b2.appendChild(E('<div class="musik-host"></div>')));
    m.appendChild(b2);
    mitteAktualisieren();
    // Rechts: Suche
    const b3 = box("Suche", "x");
    b3.querySelector("small").innerHTML = `auf <b class="ziel"></b>`;
    ui.ziel = b3.querySelector(".ziel"); ui.ziel.textContent = gewaehlt ? PS.name(gewaehlt) : "–";
    const feld = E(`<form class="musik-suche" role="search">${PS.ic("magnify")}<input type="search" placeholder="Titel, Album, Interpret, Radio …" enterkeyhint="search" autocomplete="off" spellcheck="false"></form>`);
    const eingabe = feld.querySelector("input"), treffer = E('<div class="musik-treffer-liste"></div>');
    let t = null;
    eingabe.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => suchen(eingabe.value, treffer), 450); });
    feld.addEventListener("submit", (ev) => { ev.preventDefault(); clearTimeout(t); eingabe.blur(); suchen(eingabe.value, treffer); });
    b3.append(feld, treffer);
    r.appendChild(b3);
    // Rechts: Bibliothek
    const b4 = ui.bib = box("Bibliothek", "");
    const chips = E('<div class="reihe musik-chips"></div>');
    const bibZiel = E('<div class="musik-bibziel"></div>');
    const wahl = (k) => { chips.querySelectorAll("button").forEach((c) => c.classList.toggle("aktiv", c.dataset.k === k)); ui.bibZiel = bibZiel; bibLaden(k, bibZiel); };
    Object.entries(BIB).forEach(([k, [titel]]) => { const c = knopf(titel, null, () => wahl(k), "chip"); c.dataset.k = k; chips.appendChild(c); });
    b4.append(chips, bibZiel);
    r.appendChild(b4);
    if (spieler().length) wahl("zuletzt"); else bibZiel.innerHTML = '<div class="leer">Kein Music-Assistant-Player gefunden.</div>';
    // Fortschritt weiterlaufen lassen, solange diese Seite steht
    const mein = ui, uhr = setInterval(() => { if (ui !== mein || !el.isConnected) { clearInterval(uhr); return; } fortschritt(); }, 1000);
  }

  // Live: nur betroffene Player nachführen
  PS.on("diff", (ids) => {
    if (!ui) return;
    if (!ui.el.isConnected) { ui = null; return; }
    let geaendert = false;
    ui.zeilen.forEach((z) => { if (ids.has(z.dataset.eid)) { playerAktualisieren(z); geaendert = true; } });
    if (!geaendert) return;
    ui.kopfKlein.textContent = `${ui.zeilen.filter((z) => PS.s(z.dataset.eid) === "playing").length} spielen`;
    if (gewaehlt && ids.has(gewaehlt)) mitteAktualisieren();
  });
  PS.on("seite", () => { ui = null; });

  PS.module.musik = {
    titel: "Musik", icon: "music-box-multiple",
    verfuegbar: () => alle().some((e) => istMass(e) && PS.sichtbar(e)),
    render: (el) => musik(el),
  };
})();
