/* PM Panel Studio – Netzwerk in der Admin-Ansicht: Seite „Netzwerk“ und Block für die Startseite.
   Quelle ist das UniFi-Gateway direkt (api/netz: Internet, Latenz, Speedtest, Durchsatz, Geräte, Clients). Ohne
   Zugangsdaten in den App-Optionen zeigt die Seite, was die UniFi-Integration von Home Assistant liefert. */
(function () {
  "use strict";
  const PS = window.PS;
  const { E, box, knopf } = PS.bau;

  // ------------------------------------------------------------ Daten
  const NETZ = { stand: null, zeit: 0, laeuft: null };
  async function laden(neu) {
    if (NETZ.laeuft) return NETZ.laeuft;
    NETZ.laeuft = (async () => {
      try {
        const r = await fetch("api/netz" + (neu ? "?neu=1" : ""), { cache: "no-store" });
        if (r.ok) { NETZ.stand = await r.json(); NETZ.zeit = Date.now(); }
      } catch { /* bleibt beim letzten Stand */ }
      NETZ.laeuft = null;
      return NETZ.stand;
    })();
    return NETZ.laeuft;
  }
  const unifi = () => NETZ.stand && NETZ.stand.quelle === "unifi" ? NETZ.stand : null;

  // Ersatz aus der UniFi-Integration von Home Assistant: Geräte (Gateway, Switches) und Clients
  function ausHA() {
    const ent = Object.keys(PS.reg).filter((e) => (PS.reg[e] || {}).p === "unifi" && PS.z[e]);
    const jeGeraet = new Map();
    ent.forEach((e) => { const d = PS.reg[e].d; if (!d) return; if (!jeGeraet.has(d)) jeGeraet.set(d, []); jeGeraet.get(d).push(e); });
    const wert = (es, endung) => { const e = es.find((x) => x.startsWith("sensor.") && x.endsWith(endung)); return e && !PS.nichtDa(e) ? e : null; };
    const geraete = [];
    jeGeraet.forEach((es, d) => {
      const zustand = wert(es, "_state"); if (!zustand) return;
      const cpu = wert(es, "_cpu_utilization"), ram = wert(es, "_memory_utilization"), up = wert(es, "_uptime");
      const temp = es.find((x) => x.startsWith("sensor.") && x.endsWith("_temperature") && !PS.nichtDa(x));
      const upd = es.find((x) => x.startsWith("update."));
      const name = PS.geraete[d] || PS.name(zustand).replace(/ (State|Zustand)$/i, "");
      const s = String(PS.s(zustand)).toLowerCase();
      geraete.push({
        name, typ: /gateway|udm|ucg|uxg|router/i.test(name + zustand) ? "gateway" : /usw|switch/i.test(name + zustand) ? "switch" : /uap|u6|u7|ap\b/i.test(name + zustand) ? "ap" : "sonst",
        online: ["connected", "online", "verbunden"].includes(s), zustandText: PS.text(zustand),
        cpu: cpu ? Number(PS.s(cpu)) : null, ram: ram ? Number(PS.s(ram)) : null, temp: temp ? Number(PS.s(temp)) : null,
        uptime: up ? (Date.now() - Date.parse(PS.s(up))) / 1000 : null, update: upd ? PS.s(upd) === "on" : false, geraet: d,
      });
    });
    const tracker = ent.filter((e) => e.startsWith("device_tracker."));
    const wlans = ent.filter((e) => e.startsWith("sensor.") && !PS.reg[e].d && isFinite(Number(PS.s(e))));
    return {
      geraete: geraete.sort((a, b) => ["gateway", "switch", "ap", "sonst"].indexOf(a.typ) - ["gateway", "switch", "ap", "sonst"].indexOf(b.typ) || a.name.localeCompare(b.name, "de")),
      clients: { gesamt: tracker.filter((e) => PS.s(e) === "home").length, wlans: wlans.map((e) => [PS.name(e).replace(/ (Clients|clients)$/, ""), Number(PS.s(e))]) },
    };
  }

  // ------------------------------------------------------------ Format
  const mbit = (v) => (v == null ? "–" : v >= 100 ? PS.zahl(v, 0) : PS.zahl(v, 1));
  const rate = (bytesProS) => (bytesProS == null ? "–" : mbit((bytesProS * 8) / 1e6));
  // Live-Rate wie in UniFi: unter 1 Mbit/s in kbit/s, damit kleine Werte nicht als 0 erscheinen
  const klein = (b) => b != null && (b * 8) / 1e6 < 1;
  const liveRate = (b) => (b == null ? "–" : klein(b) ? PS.zahl((b * 8) / 1e3, 0) : rate(b));
  const liveEinheit = (b) => (klein(b) ? "kbit/s" : "Mbit/s");
  const dauer = (s) => {
    if (s == null || !isFinite(s)) return "–";
    const t = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return t ? `${t} T ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  };
  const TYP_ICON = { gateway: "router-network", switch: "switch", ap: "access-point", sonst: "lan" };
  const TYP_NAME = { gateway: "Gateway", switch: "Switch", ap: "Access Point", sonst: "Gerät" };
  const lastFarbe = (v) => (v == null ? "" : v >= 90 ? "krit" : v >= 75 ? "warn" : "");
  function zusammenfassung() {
    const u = unifi(), h = ausHA();
    const geraete = u ? u.geraete : h.geraete;
    const aus = geraete.filter((g) => !g.online);
    const updates = geraete.filter((g) => g.update);
    const clients = u ? (u.clients.lan || 0) + (u.clients.wlan || 0) : h.clients.gesamt;
    const internet = u ? u.internet : null;
    // Ohne Gateway-Daten und ohne Gateway in Home Assistant ist der Zustand unbekannt (null)
    const gw = geraete.find((g) => g.typ === "gateway");
    const online = internet ? internet.status === "ok" : gw ? gw.online : null;
    return { u, h, geraete, aus, updates, clients, internet, online };
  }

  // ------------------------------------------------------------ Live: Verlauf, Zahlenwalzen, Netzfluss
  // Solange Seite oder Startblock sichtbar sind, alle 3 s nachfragen (das Backend fragt das Gateway höchstens alle
  // 2,5 s). Die Live-Werte rollen an Ort und Stelle; neu gezeichnet wird nur, was sich sonst geändert hat.
  const TAKT_MS = 3000;
  const VERLAUF_S = 600;
  NETZ.verlauf = [];
  NETZ.speedtestBis = 0;
  function merken() {
    const u = unifi(); if (!u || !u.internet || !u.zeit) return;
    const v = NETZ.verlauf, i = u.internet;
    if (v.length && v[v.length - 1].t >= u.zeit) return;
    v.push({ t: u.zeit, rx: i.rx_bps, tx: i.tx_bps, ping: pingMs() });
    while (v.length && v[0].t < u.zeit - VERLAUF_S) v.shift();
  }
  const speedtestText = (i) => `Speedtest: ↓ ${mbit(i.down_mbit)} · ↑ ${mbit(i.up_mbit)} Mbit/s · ${i.ping_ms != null ? PS.zahl(i.ping_ms, 0) : "–"} ms${i.speedtest_zeit ? ` · ${PS.zeitRelativ(new Date(i.speedtest_zeit * 1000).toISOString())}` : ""}`;
  // Eigener Live-Ping des Backends (TCP-Verbindungsaufbau zu Microsoft, Google, Cloudflare; Durchschnitt der
  // erreichten). Ohne Messung die Latenz laut Gateway.
  const PING_ZIELE = ["Microsoft", "Google", "Cloudflare"];
  const pingZiel = (name) => { const z = ((NETZ.stand && NETZ.stand.ping && NETZ.stand.ping.ziele) || []).find((x) => x.name === name); return z ? z.ms : null; };
  const pingMs = () => (NETZ.stand && NETZ.stand.ping && NETZ.stand.ping.ms != null ? NETZ.stand.ping.ms : null);
  const LIVE = {
    rx: (i) => liveRate(i.rx_bps),
    tx: (i) => liveRate(i.tx_bps),
    lat: (i) => { const p = pingMs() ?? i.latenz_ms; return p != null ? PS.zahl(p, p < 10 ? 1 : 0) : "–"; },
  };
  const TEXTE = {
    speedtest: speedtestText,
    rxEinheit: (i) => liveEinheit(i.rx_bps),
    txEinheit: (i) => liveEinheit(i.tx_bps),
    gateway: (i) => (i.latenz_ms != null ? `${PS.zahl(i.latenz_ms, 0)} ms` : "–"),
    zuletzt: (i) => (i.speedtest_zeit ? PS.zeitRelativ(new Date(i.speedtest_zeit * 1000).toISOString()) : "noch keiner"),
  };
  function liveSetzen(wurzel = document) {
    const i = unifi() && unifi().internet;
    if (i) {
      wurzel.querySelectorAll("[data-netz]").forEach((el) => {
        const k = el.dataset.netz, ms = k.startsWith("ping:") ? pingZiel(k.slice(5)) : null;
        const t = k.startsWith("ping:") ? (ms != null ? PS.zahl(ms, ms < 10 ? 1 : 0) : "–") : LIVE[k](i);
        if (el._text !== t) { el._text = t; PS.walze(el, t); }
      });
      wurzel.querySelectorAll("[data-netz-text]").forEach((el) => { const t = TEXTE[el.dataset.netzText](i); if (el.textContent !== t) el.textContent = t; });
    }
    wurzel.querySelectorAll("canvas.nz-fluss").forEach((cv) => { if (!FLUSS.has(cv)) flussAnmelden(cv); });
    wurzel.querySelectorAll("canvas.nz-verlauf").forEach(verlaufZeichnen);
  }

  // Leinwand in Gerätepixeln, gelöscht, Koordinaten in CSS-Pixeln
  function leinwand(cv) {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    return { c, w, h };
  }
  // Farbe einer CSS-Variablen als "r,g,b"
  function rgb(name, ersatz) {
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = ersatz;
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || ersatz;
    const s = c.fillStyle, m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
    return m ? m.slice(1).map((x) => parseInt(x, 16)).join(",") : ((/\d+\s*,\s*\d+\s*,\s*\d+/.exec(s) || ["143,180,255"])[0]);
  }
  // Weicher Lichtpunkt wie im Energiefluss: weißer Kern, getönter Schein
  const SPRITES = new Map();
  function punkt(farbe) {
    let s = SPRITES.get(farbe); if (s) return s;
    s = document.createElement("canvas"); s.width = s.height = 32;
    const c = s.getContext("2d"), g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, `rgba(${farbe},.8)`); g.addColorStop(1, `rgba(${farbe},0)`);
    c.fillStyle = g; c.fillRect(0, 0, 32, 32);
    SPRITES.set(farbe, s); return s;
  }

  // Netzfluss: Internet (links) ⇄ Zuhause (rechts). Untere Bahn Download nach rechts, obere Upload nach links.
  // Dichte und Tempo wachsen logarithmisch mit dem Durchsatz; ohne Verbindung oder bei reduzierter Bewegung ruhen sie.
  const FLUSS = new Set();
  const reduziert = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let flussRaf = 0, flussLetzt = 0;
  function flussAnmelden(cv) {
    cv._t = { rx: [], tx: [] }; cv._rest = { rx: Math.random(), tx: Math.random() }; cv._seit = performance.now();
    cv._farbe = { rx: rgb("--info", "#8fb4ff"), tx: rgb("--akzent", "#b07fd0"), linie: rgb("--lavender", "#C5C0D3") };
    FLUSS.add(cv);
    if (!flussRaf) { flussLetzt = 0; flussRaf = requestAnimationFrame(flussSchritt); }
  }
  const mbitVon = (bps) => (bps ? (bps * 8) / 1e6 : 0);
  function flussSchritt(jetzt) {
    flussRaf = 0;
    FLUSS.forEach((cv) => { if (!cv.isConnected && jetzt - cv._seit > 3000) FLUSS.delete(cv); });
    if (!FLUSS.size) return;
    flussRaf = requestAnimationFrame(flussSchritt);
    if (flussLetzt && jetzt - flussLetzt < 25) return;  // höchstens 40 Bilder je Sekunde
    const dt = flussLetzt ? Math.min(0.1, (jetzt - flussLetzt) / 1000) : 0;
    flussLetzt = jetzt;
    const i = (unifi() && unifi().internet) || {};
    const ruhig = (reduziert && reduziert.matches) || document.body.classList.contains("ohne-animation") || i.status !== "ok";
    FLUSS.forEach((cv) => { if (cv.isConnected) flussZeichnen(cv, i, dt, ruhig); });
  }
  function flussZeichnen(cv, i, dt, ruhig) {
    if (ruhig && cv._ruhig) return;  // stehendes Bild nur einmal zeichnen
    const l = leinwand(cv); if (!l) return;
    const { c, w, h } = l;
    cv._ruhig = ruhig;
    for (const [k, y, rechts] of [["tx", h * 0.3, false], ["rx", h * 0.7, true]]) {
      const farbe = cv._farbe[k], t = cv._t[k], m = mbitVon(i[k + "_bps"]);
      c.strokeStyle = `rgba(${farbe},${ruhig ? 0.12 : 0.22})`; c.lineWidth = 2; c.lineCap = "round";
      c.beginPath(); c.moveTo(6, y); c.lineTo(w - 6, y); c.stroke();
      // Pfeilspitze am Ziel
      const x = rechts ? w - 6 : 6, d = rechts ? -1 : 1;
      c.beginPath(); c.moveTo(x + d * 6, y - 4); c.lineTo(x, y); c.lineTo(x + d * 6, y + 4); c.stroke();
      if (ruhig) { t.length = 0; continue; }
      const lg = Math.log10(1 + m);
      cv._rest[k] += (m > 0.01 ? 1 + 2.6 * lg : 0) * dt;  // Teilchen je Sekunde
      while (cv._rest[k] >= 1) { cv._rest[k] -= 1; t.push({ x: 0, v: (0.35 + 0.13 * lg) * (0.85 + Math.random() * 0.3), dy: (Math.random() - 0.5) * h * 0.12 }); }
      const sp = punkt(farbe), r = Math.max(4, Math.min(7, h * 0.13));
      for (let n = t.length - 1; n >= 0; n--) {
        const p = t[n]; p.x += p.v * dt;
        if (p.x >= 1) { t.splice(n, 1); continue; }
        const px = rechts ? 8 + p.x * (w - 16) : w - 8 - p.x * (w - 16);
        c.globalAlpha = Math.min(1, Math.sin(Math.PI * p.x) * 1.6);
        c.drawImage(sp, px - r, y + p.dy - r, r * 2, r * 2);
      }
      c.globalAlpha = 1;
    }
  }

  // Durchsatz der letzten zehn Minuten: Download als Fläche, Upload als Linie
  function verlaufZeichnen(cv) {
    const l = leinwand(cv); if (!l) return;
    const { c, w, h } = l, v = NETZ.verlauf;
    if (v.length < 2) return;
    // Anfangs füllt der Verlauf die Breite, bis zehn Minuten beisammen sind
    const ende = v[v.length - 1].t, anfang = Math.max(v[0].t, ende - VERLAUF_S), spanne = Math.max(30, ende - anfang), oben = 16;
    const spitze = Math.max(1, ...v.map((p) => Math.max(mbitVon(p.rx), mbitVon(p.tx))));
    const X = (t) => ((t - anfang) / spanne) * (w - 2) + 1, Y = (m) => h - 1 - (m / (spitze * 1.1)) * (h - oben - 1);
    const linie = (k) => {
      const zuege = [];
      v.forEach((p, n) => { if (p[k] == null) return; if (!n || p.t - v[n - 1].t > 12 || v[n - 1][k] == null) zuege.push([]); zuege[zuege.length - 1].push([X(p.t), Y(mbitVon(p[k]))]); });
      return zuege;
    };
    const info = rgb("--info", "#8fb4ff"), akzent = rgb("--akzent", "#b07fd0");
    const g = c.createLinearGradient(0, oben, 0, h); g.addColorStop(0, `rgba(${info},.35)`); g.addColorStop(1, `rgba(${info},0)`);
    linie("rx").forEach((z) => {
      if (z.length < 2) return;
      c.beginPath(); z.forEach(([x, y], n) => (n ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.strokeStyle = `rgb(${info})`; c.lineWidth = 1.6; c.stroke();
      c.lineTo(z[z.length - 1][0], h); c.lineTo(z[0][0], h); c.closePath(); c.fillStyle = g; c.fill();
    });
    linie("tx").forEach((z) => {
      if (z.length < 2) return;
      c.beginPath(); z.forEach(([x, y], n) => (n ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.strokeStyle = `rgb(${akzent})`; c.lineWidth = 1.6; c.stroke();
    });
    const pings = v.map((p) => p.ping).filter((x) => x != null);
    if (pings.length > 1) {
      const pmax = Math.max(10, ...pings) * 1.1, gut = rgb("--gut", "#5fd3a0");
      c.beginPath(); let an = false;
      v.forEach((p, n) => { if (p.ping == null || (n && p.t - v[n - 1].t > 12)) { an = false; if (p.ping == null) return; } const x = X(p.t), y = h - 1 - (p.ping / pmax) * (h - oben - 1); an ? c.lineTo(x, y) : c.moveTo(x, y); an = true; });
      c.setLineDash([3, 3]); c.strokeStyle = `rgba(${gut},.85)`; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
      c.fillStyle = `rgb(${gut})`; c.font = "11px system-ui, sans-serif"; c.textBaseline = "top"; c.textAlign = "right";
      c.fillText(`Ping bis ${PS.zahl(Math.max(...pings), 0)} ms`, w - 2, 1); c.textAlign = "left";
    }
    c.fillStyle = getComputedStyle(cv).color; c.font = "11px system-ui, sans-serif"; c.textBaseline = "top";
    c.fillText(`Spitze ${mbit(spitze)} Mbit/s · letzte ${spanne < 90 ? `${Math.round(spanne)} s` : `${Math.round(spanne / 60)} min`}`, 2, 1);
  }

  // Live-Teil: Ping, Download, Upload als Zahlenwalzen, darunter der Netzfluss (auf der Seite zusätzlich der Verlauf)
  const liveTeil = (gross) => E(`<div class="nz-live">
    <div class="nz-werte${gross ? " nz-gross" : ""}">
      <div class="nz-ping"><small>Ping Ø jetzt</small><b class="tabular"><span data-netz="lat"></span><i>ms</i></b></div>
      <div class="nz-rx"><small>Download jetzt</small><b class="tabular"><span data-netz="rx"></span><i data-netz-text="rxEinheit">Mbit/s</i></b></div>
      <div class="nz-tx"><small>Upload jetzt</small><b class="tabular"><span data-netz="tx"></span><i data-netz-text="txEinheit">Mbit/s</i></b></div></div>
    ${gross ? `<div class="nz-pings">${PING_ZIELE.map((n) => `<div><small>${n}</small><b class="tabular"><span data-netz="ping:${n}"></span><i>ms</i></b></div>`).join("")}</div>` : ""}
    <div class="nz-flussbahn${gross ? " nz-gross" : ""}"><span title="Internet">${PS.ic("web")}</span><canvas class="nz-fluss"></canvas><span title="Zuhause">${PS.ic("home-outline")}</span></div>
    ${gross ? '<canvas class="nz-verlauf"></canvas>' : ""}</div>`);

  // ------------------------------------------------------------ Block für die Startseite
  PS.admin.bloecke.netzwerk = {
    titel: "Netzwerk", icon: "lan",
    render(b) {
      const z = zusammenfassung();
      if (!z.geraete.length && !z.internet) { b.appendChild(E('<div class="leer">Keine UniFi-Daten. Seite „Netzwerk“ öffnen für Hinweise zur Einrichtung.</div>')); return; }
      const i = z.internet;
      b.querySelector("h3 small").textContent = i && i.isp ? i.isp : "";
      b.appendChild(E(`<div class="nz-status ${z.online == null ? "" : z.online ? "ok" : "krit"}">${PS.ic(z.online == null ? "web" : z.online ? "web-check" : "web-off")}<b>${z.online == null ? "Internet: Zustand unbekannt" : z.online ? "Internet verbunden" : "Internet gestört"}</b></div>`));
      if (i) {
        b.appendChild(liveTeil(false));
        b.appendChild(E(`<div class="nz-zeile">${PS.ic("speedometer")}<span data-netz-text="speedtest"></span></div>`));
      }
      b.appendChild(E(`<div class="nz-zeile">${PS.ic("devices")}<span>${z.clients} Clients · ${z.geraete.length - z.aus.length}/${z.geraete.length} UniFi-Geräte online</span></div>`));
      z.aus.forEach((g) => b.appendChild(E(`<div class="nz-zeile krit">${PS.ic("lan-disconnect")}<span>${PS.esc(g.name)} offline</span></div>`)));
      if (z.updates.length) b.appendChild(E(`<div class="nz-zeile info">${PS.ic("update")}<span>${z.updates.length} Firmware-Update${z.updates.length > 1 ? "s" : ""} verfügbar</span></div>`));
      b.appendChild(knopf("Netzwerk öffnen", "lan", () => PS.oeffnen("netzwerk")));
      requestAnimationFrame(() => liveSetzen(b));
    },
    relevant: () => false,
    // Neu zeichnen nur bei Änderungen außerhalb der Live-Werte; diese führt liveSetzen an Ort und Stelle nach
    signatur: () => {
      const z = zusammenfassung(), i = z.internet;
      return JSON.stringify([z.online, !!i, i && i.isp, z.clients, z.aus.map((g) => g.name), z.updates.length, z.geraete.length]);
    },
    aktualisieren: (b) => { if (b) liveSetzen(b); },
  };

  // Takt: alle 3 s, solange Seite oder Startblock zu sehen sind; ohne Gateway-Daten genügen 15 s
  let schlag = 0;
  const seiteOffen = () => document.querySelector(".nz-seite");
  const blockSichtbar = () => !document.body.classList.contains("offen") && document.querySelector('.as-block[data-id="netzwerk"]');
  let seiteNachfuehren = null;
  setInterval(async () => {
    schlag++;
    if (document.hidden || !(seiteOffen() || blockSichtbar())) return;
    const live = NETZ.stand && NETZ.stand.quelle === "unifi";
    if (!live && schlag % 5) return;
    await laden(); merken();
    if (seiteOffen() && seiteNachfuehren) seiteNachfuehren();
    if (blockSichtbar()) { liveSetzen(document.querySelector('.as-block[data-id="netzwerk"]')); PS.admin.vormerken("netzwerk"); }
  }, TAKT_MS);
  PS.on("init", () => { laden().then(() => { merken(); PS.admin.vormerken("netzwerk"); }); });

  // ------------------------------------------------------------ Seite „Netzwerk“
  // Jeder Bereich hat eine Signatur ohne Live-Werte und wird nur neu gefüllt, wenn sie sich ändert. Der Live-Teil
  // (Walzen, Netzfluss, Verlauf) bleibt stehen, damit Zahlen rollen und Teilchen weiterfließen.
  const behalten = (b) => [...b.children].forEach((c) => { if (c.tagName !== "H3" && !c.classList.contains("nz-live")) c.remove(); });
  function speedtestKnopf() {
    const laeuft = Date.now() < NETZ.speedtestBis;
    const st = knopf(laeuft ? "Speedtest läuft …" : "Speedtest starten", "speedometer", async () => {
      st.disabled = true; st.querySelector("span").textContent = "Speedtest läuft …";
      try {
        const r = await fetch("api/netz/speedtest", { method: "POST", headers: { "X-PMPS-Aktion": "1" } });
        if (!r.ok) throw new Error(await r.text());
        NETZ.speedtestBis = Date.now() + 75000;
        PS.toast("Speedtest gestartet; das Ergebnis erscheint in etwa einer Minute.");
      } catch (e) { PS.toast(e.message || String(e), true); st.disabled = false; st.querySelector("span").textContent = "Speedtest starten"; }
    }, "primaer");
    st.disabled = laeuft;
    return st;
  }
  const BEREICHE = [
    {
      titel: "Internet", klein: (z) => (z.internet && z.internet.isp) || "",
      sig: (z) => { const i = z.internet || {}; return [z.online, !!z.internet, i.wan_ip, i.down_mbit, i.up_mbit, i.ping_ms, i.speedtest_zeit, dauer(i.uptime), i.ausfaelle, NETZ.stand && NETZ.stand.fehler, Date.now() < NETZ.speedtestBis]; },
      fuellen(b, z) {
        const i = z.internet;
        let live = b.querySelector(".nz-live");
        b.insertBefore(E(`<div class="nz-status ${z.online == null ? "" : z.online ? "ok" : "krit"}">${PS.ic(z.online == null ? "web" : z.online ? "web-check" : "web-off")}<b>${z.online == null ? "Zustand unbekannt" : z.online ? "Verbunden" : "Gestört"}</b>${i && i.wan_ip ? `<span class="tabular">${PS.esc(i.wan_ip)}</span>` : ""}</div>`), live);
        if (!i) {
          if (live) live.hidden = true;
          b.appendChild(E(`<div class="leer">${PS.esc(NETZ.stand && NETZ.stand.fehler ? `Gateway nicht erreichbar: ${NETZ.stand.fehler}` : "Ping, Download, Upload und Durchsatz kommen direkt vom UniFi-Gateway. Dafür in den App-Optionen „UniFi: API-Schlüssel“ eintragen (UniFi Network → Einstellungen → Control Plane → Integrationen) oder Benutzer und Kennwort eines lokalen Kontos.")}</div>`));
          return;
        }
        if (!live) { live = liveTeil(true); b.appendChild(live); }
        live.hidden = false;
        if (NETZ.stand.fehler) b.appendChild(E(`<div class="nz-zeile warn">${PS.ic("alert-outline")}<span>Gateway antwortet gerade nicht: ${PS.esc(NETZ.stand.fehler)}</span></div>`));
        b.appendChild(E(`<dl class="as-werte">
          <dt>Speedtest</dt><dd class="tabular">↓ ${mbit(i.down_mbit)} · ↑ ${mbit(i.up_mbit)} Mbit/s · Ping ${i.ping_ms != null ? PS.zahl(i.ping_ms, 0) : "–"} ms</dd>
          <dt>Ping laut Gateway</dt><dd class="tabular" data-netz-text="gateway"></dd>
          <dt>Letzter Speedtest</dt><dd data-netz-text="zuletzt"></dd>
          <dt>Verbunden seit</dt><dd>${dauer(i.uptime)}</dd>
          ${i.ausfaelle != null ? `<dt>Ausfälle</dt><dd class="tabular">${PS.zahl(i.ausfaelle, 0)}</dd>` : ""}</dl>`));
        b.appendChild(speedtestKnopf());
      },
    },
    {
      titel: "Clients", klein: (z) => (z.u ? "laut Gateway" : "laut Home Assistant"),
      sig: (z) => [z.u && z.u.clients, z.clients, z.h.clients.wlans],
      fuellen(b, z) {
        const u = z.u;
        if (u) {
          b.appendChild(E(`<div class="nz-werte">
            <div><small>Gesamt</small><b class="tabular">${z.clients}</b></div>
            <div><small>LAN</small><b class="tabular">${u.clients.lan ?? "–"}</b></div>
            <div><small>WLAN</small><b class="tabular">${u.clients.wlan ?? "–"}</b></div>
            <div><small>Gäste</small><b class="tabular">${u.clients.gast ?? "–"}</b></div></div>`));
        } else b.appendChild(E(`<div class="nz-werte"><div><small>Im Netz</small><b class="tabular">${z.clients}</b></div></div>`));
        const wl = z.h.clients.wlans;
        if (wl.length) b.appendChild(E(`<dl class="as-werte">${wl.map(([n, v]) => `<dt>WLAN ${PS.esc(n)}</dt><dd class="tabular">${v}</dd>`).join("")}</dl>`));
      },
    },
    {
      titel: "Zustand", klein: (z) => `${z.geraete.length - z.aus.length}/${z.geraete.length} online`,
      heiss: (z) => z.geraete.filter((x) => (x.cpu || 0) >= 90 || (x.ram || 0) >= 90 || (x.temp || 0) >= 80),
      sig(z) { return [z.geraete.length, z.aus.map((x) => x.name), z.updates.map((x) => x.name), this.heiss(z).map((x) => x.name)]; },
      fuellen(b, z) {
        b.appendChild(E(`<div class="nz-status ${!z.geraete.length ? "" : z.aus.length ? "krit" : "ok"}">${PS.ic(!z.geraete.length ? "lan" : z.aus.length ? "lan-disconnect" : "check-network-outline")}<b>${!z.geraete.length ? "Keine UniFi-Geräte gefunden" : z.aus.length ? `${z.aus.length} ${z.aus.length === 1 ? "Gerät" : "Geräte"} offline` : "Alle UniFi-Geräte online"}</b></div>`));
        if (z.updates.length) b.appendChild(E(`<div class="nz-zeile info">${PS.ic("update")}<span>Update für ${PS.esc(z.updates.map((x) => x.name).join(", "))}</span></div>`));
        this.heiss(z).forEach((x) => b.appendChild(E(`<div class="nz-zeile warn">${PS.ic("alert-outline")}<span>${PS.esc(x.name)}: hohe Auslastung oder Temperatur</span></div>`)));
        b.appendChild(knopf("UniFi-Integration in Home Assistant", "open-in-app", () => PS.haOeffnen("/config/integrations/integration/unifi", "UniFi")));
      },
    },
    {
      titel: "UniFi-Geräte", klein: (z) => (z.u ? "Gateway, Switches, Access Points" : "aus Home Assistant"), breite: 3,
      sig: (z) => z.geraete.map((x) => [x.name, x.online, x.zustandText, Math.round(x.cpu || 0), Math.round(x.ram || 0), Math.round(x.temp || 0), dauer(x.uptime), x.clients, x.ports_aktiv, x.update, x.version, x.ip]),
      fuellen(b, z) {
        const t = E(`<div class="as-tabelle nz-geraete"><table><thead><tr><th>Gerät</th><th>Zustand</th><th>CPU</th><th>RAM</th><th>Temp.</th><th>Laufzeit</th><th>Clients</th><th>Ports</th><th></th></tr></thead><tbody></tbody></table></div>`);
        const tb = t.querySelector("tbody");
        z.geraete.forEach((x) => {
          const tr = E(`<table><tr><td><span class="vw-name">${PS.ic(TYP_ICON[x.typ])}<span><b>${PS.esc(x.name)}</b><small>${PS.esc([TYP_NAME[x.typ], x.modell, x.version, x.ip].filter(Boolean).join(" · "))}</small></span></span></td>
            <td class="vw-status"><i class="${x.online ? "ok" : "aus"}">${x.online ? "online" : PS.esc(x.zustandText || "offline")}</i></td>
            <td class="tabular ${lastFarbe(x.cpu)}">${x.cpu != null ? PS.zahl(x.cpu, 0) + " %" : "–"}</td>
            <td class="tabular ${lastFarbe(x.ram)}">${x.ram != null ? PS.zahl(x.ram, 0) + " %" : "–"}</td>
            <td class="tabular ${x.temp >= 80 ? "krit" : x.temp >= 70 ? "warn" : ""}">${x.temp != null ? PS.zahl(x.temp, 0) + " °C" : "–"}</td>
            <td class="tabular">${dauer(x.uptime)}</td><td class="tabular">${x.clients ?? "–"}</td>
            <td class="tabular">${x.ports ? `${x.ports_aktiv}/${x.ports}` : "–"}</td>
            <td class="vw-status">${x.update ? '<i class="vers">Update</i>' : ""}</td></tr></table>`).querySelector("tr");
          if (x.geraet) { tr.style.cursor = "pointer"; tr.addEventListener("click", () => PS.haOeffnen(`/config/devices/device/${x.geraet}`, x.name)); }
          tb.appendChild(tr);
        });
        if (!z.geraete.length) tb.innerHTML = '<tr><td colspan="9" class="leer">Keine UniFi-Geräte gefunden.</td></tr>';
        b.appendChild(t);
      },
    },
  ];
  PS.module.netzwerk = {
    titel: "Netzwerk", icon: "lan",
    async render(el) {
      el.classList.add("admin-seite");
      const g = E('<div class="as-seitenraster nz-seite"></div>'); el.appendChild(g);
      const bereiche = BEREICHE.map((def) => {
        const b = box(def.titel, ""), w = E(`<div class="as-block" style="--breite:${def.breite || 1}"></div>`);
        w.appendChild(b); g.appendChild(w);
        return { def, b, s: null };
      });
      const nachfuehren = () => {
        if (!g.isConnected) return;
        const z = zusammenfassung();
        bereiche.forEach((x) => {
          const s = JSON.stringify(x.def.sig(z));
          if (s === x.s) return;
          x.s = s; behalten(x.b);
          const k = x.b.querySelector("h3 small"); if (k) k.textContent = x.def.klein(z);
          x.def.fuellen(x.b, z);
        });
        liveSetzen(g);
      };
      seiteNachfuehren = nachfuehren;
      await laden(true); merken();
      nachfuehren();
    },
  };
  // In die Modulleiste vor „Automationen“
  const i = PS.admin.module.indexOf("automationen");
  PS.admin.module.splice(i < 0 ? PS.admin.module.length : i, 0, "netzwerk");
})();
