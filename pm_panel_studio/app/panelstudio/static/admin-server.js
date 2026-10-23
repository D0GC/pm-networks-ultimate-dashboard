/* PM Panel Studio – Server in der Admin-Ansicht: Seiten „Proxmox“ und „HA-Host“ (der Raspberry Pi, auf dem Home
   Assistant läuft) samt je einem Block für die Startseite. Quelle sind die Integrationen Proxmox VE und System Monitor.
   Lebendig wie das Netzwerk: Ringe gleiten auf neue Werte, Zahlen rollen, Kurven laufen stetig mit der Zeit nach links
   (Verlauf der letzten Stunden aus Home Assistant, danach jede neue Messung), ein Puls zeigt jede neue Messung an.
   Neue Werte kommen so oft, wie die Integrationen abfragen (System Monitor und Proxmox VE: etwa alle 30–60 s). */
(function () {
  "use strict";
  const PS = window.PS;
  const { E, box, knopf } = PS.bau;

  // ------------------------------------------------------------ Daten
  const zahl = (e) => { if (!e || !PS.z[e] || PS.nichtDa(e)) return null; const v = Number(PS.s(e)); return isFinite(v) ? v : null; };
  const plattform = (p) => Object.keys(PS.z).filter((e) => (PS.reg[e] || {}).p === p);
  const einheit = (e) => (e && PS.z[e] ? PS.a(e).unit_of_measurement || "" : "");
  const prozent = (e) => einheit(e) === "%";
  const seit = (e) => { const t = e && PS.z[e] ? Date.parse(PS.s(e)) : NaN; return isFinite(t) ? (Date.now() - t) / 1000 : null; };
  const dauer = (s) => {
    if (s == null || !isFinite(s)) return "–";
    const t = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return t ? `${t} T ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  };
  const gb = (v) => (v == null ? "–" : v >= 100 ? PS.zahl(v, 0) : PS.zahl(v, 1));

  // Gerätename ohne Geräteregister: gemeinsamer Anfang der Entitätsnamen („Storage (local) Speicher aktiv“,
  // „Storage (local) Belegter Speicherplatz“ → „Storage (local)“), sonst der erste Name
  const gemeinsamerName = (es) => {
    const n = es.map((e) => PS.name(e)).filter(Boolean);
    if (n.length < 2) return n[0] || "";
    let p = n[0];
    for (const x of n) while (p && !x.startsWith(p)) p = p.slice(0, -1);
    // nur an einer Wortgrenze abschneiden
    if (!n.every((x) => x.length === p.length || /\s/.test(x[p.length]))) p = p.slice(0, p.lastIndexOf(" ") + 1);
    p = p.trim();
    return p.length >= 3 ? p : n[0];
  };
  // Proxmox VE: je Gerät der Integration ein Knoten, ein Gast (VM oder Container) oder ein Speicher
  function proxmox() {
    const je = new Map();
    plattform("proxmoxve").forEach((e) => { const d = PS.reg[e].d || e; if (!je.has(d)) je.set(d, []); je.get(d).push(e); });
    const alle = [...je.entries()].map(([d, es]) => {
      const sensor = es.filter((e) => e.startsWith("sensor."));
      const taste = (re) => es.find((e) => e.startsWith("button.") && re.test(e));
      return {
        d, es, name: PS.geraete[d] || gemeinsamerName(es),
        status: sensor.find((e) => /_status$/.test(e)),
        cpu: sensor.find((e) => /cpu/.test(e) && prozent(e)),
        ram: sensor.find((e) => /arbeitsspeicher|memory/.test(e) && prozent(e)),
        ramMax: sensor.find((e) => /maximal|max_/.test(e) && !prozent(e)),
        laufzeit: sensor.find((e) => PS.a(e).device_class === "timestamp"),
        belegt: sensor.find((e) => /speicherauslastung|disk.*(percent|usage)/.test(e) && prozent(e)),
        gesamt: sensor.find((e) => /gesamt|total/.test(e)),
        frei: sensor.find((e) => /verfug|frei|free|avail/.test(e)),
        start: taste(/_starten$/), stopp: taste(/_herunterfahren$/) || taste(/_stoppen$/), neu: taste(/_neu_starten$/),
        alleStarten: taste(/_alle_starten$/), update: es.find((e) => e.startsWith("update.")),
      };
    });
    const knoten = alle.filter((g) => g.alleStarten || (g.status && ["online", "offline"].includes(PS.s(g.status))));
    const speicher = alle.filter((g) => !knoten.includes(g) && g.belegt);
    const gaeste = alle.filter((g) => !knoten.includes(g) && !speicher.includes(g) && g.status)
      .sort((a, b) => (PS.s(b.status) === "running") - (PS.s(a.status) === "running") || a.name.localeCompare(b.name, "de"));
    return { knoten, speicher, gaeste, laeuft: gaeste.filter((g) => PS.s(g.status) === "running") };
  }
  // HA-Host: System Monitor (deutsche und englische Kennungen), Netzteilprüfung und Updates der Supervisor-Integration
  function host() {
    const es = plattform("systemmonitor"), f = (re) => es.find((e) => re.test(e));
    const strom = plattform("rpi_power")[0];
    return {
      cpu: f(/prozessornutzung|processor_use/), ram: f(/arbeitsspeicherauslastung|memory_use_percent|memory_usage/),
      temp: f(/prozessortemperatur|processor_temperature/), disk: f(/massenspeicher_auslastung|disk_use_percent|disk_usage/),
      diskFrei: f(/freier_massenspeicher|disk_free/), ramBelegt: f(/belegter_arbeitsspeicher|memory_use$/),
      swap: f(/swap_auslastung|swap_use_percent|swap_usage/), laufzeit: f(/betriebszeit|last_boot/),
      last1: f(/last_1_min|load_1m/), last5: f(/last_5_min|load_5m/), last15: f(/last_15_min|load_15m/),
      strom, stromFehler: strom ? PS.s(strom) === "on" : false,
      updates: plattform("hassio").filter((e) => e.startsWith("update.") && PS.s(e) === "on"),
    };
  }

  // ------------------------------------------------------------ Verlauf (Home Assistant) und neue Messungen
  const VERLAUF = new Map();  // Entität → [[ms, Wert], …]
  const geladen = new Set();
  const SPANNE_MS = 3 * 3600e3;
  async function verlaufLaden(ids, stunden = 2) {
    const neu = ids.filter((e) => e && !geladen.has(e));
    if (!neu.length) return;
    neu.forEach((e) => geladen.add(e));
    const ende = new Date(), start = new Date(ende - stunden * 3600e3);
    try {
      const r = await PS.anfrage({ typ: "ws", befehl: { type: "history/history_during_period", start_time: start.toISOString(), end_time: ende.toISOString(), entity_ids: neu, minimal_response: true, no_attributes: true, include_start_time_state: true, significant_changes_only: false } });
      neu.forEach((e) => {
        const pkt = ((r || {})[e] || []).map((p) => [((p.lu || p.lc || 0) * 1000) || Date.parse(p.last_updated || p.last_changed), Number(p.s ?? p.state)]).filter((p) => isFinite(p[1]) && p[0]);
        VERLAUF.set(e, [...pkt, ...(VERLAUF.get(e) || [])].sort((a, b) => a[0] - b[0]));
      });
    } catch { /* ohne Verlauf beginnt die Kurve mit der nächsten Messung */ }
  }
  PS.on("diff", (ids) => {
    let neu = false;
    ids.forEach((e) => {
      if (!geladen.has(e)) return;
      const v = zahl(e); if (v == null) return;
      const l = VERLAUF.get(e) || [];
      l.push([Date.now(), v]);
      while (l.length && l[0][0] < Date.now() - SPANNE_MS) l.shift();
      VERLAUF.set(e, l);
      neu = true;
    });
    if (neu) document.querySelectorAll(".sv-puls").forEach((p) => { p.classList.remove("schlag"); void p.offsetWidth; p.classList.add("schlag"); });
    if ([...ids].some((e) => beobachtet.has(e))) liveSetzen();
  });

  // ------------------------------------------------------------ Proxmox direkt (optional, App-Option „Proxmox: API-Token“)
  // Liefert IP-Adressen und Werte im Abstand weniger Sekunden; ohne Token bleiben die Werte aus Home Assistant.
  const PX = { stand: null, vorher: new Map(), raten: new Map(), laeuft: null };
  async function pxLaden() {
    if (!PS.opt || !PS.opt.proxmox || PX.laeuft) return PX.laeuft;
    PX.laeuft = (async () => {
      try {
        const r = await fetch("api/proxmox", { cache: "no-store" });
        if (!r.ok) return;
        const st = await r.json(), jetzt = Date.now();
        (st.gaeste || []).forEach((g) => {
          const v = PX.vorher.get(g.vmid);
          if (v && g.netin != null && v.netin != null && jetzt - v.t > 500 && g.netin >= v.netin) {
            const s2 = (jetzt - v.t) / 1000;
            PX.raten.set(g.vmid, { rx: (g.netin - v.netin) / s2, tx: Math.max(0, (g.netout - v.netout) / s2) });
          }
          PX.vorher.set(g.vmid, { t: jetzt, netin: g.netin, netout: g.netout });
        });
        PX.stand = st;
      } catch { /* bleibt beim letzten Stand */ } finally { PX.laeuft = null; }
    })();
    return PX.laeuft;
  }
  const pxGast = (name) => (PX.stand && PX.stand.gaeste || []).find((g) => String(g.name).toLowerCase() === String(name).toLowerCase()) || null;
  const rate = (bps) => { const m = (bps * 8) / 1e6; return m >= 1 ? `${PS.zahl(m, m >= 100 ? 0 : 1)} Mbit/s` : `${PS.zahl(m * 1000, 0)} kbit/s`; };
  // IP-Adresse: Proxmox (Container-Schnittstellen, Gast-Agent der VM), sonst UniFi-Client mit gleichem Hostnamen
  const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function ipText(name) {
    const g = pxGast(name);
    if (g && g.ips && g.ips.length) return { text: g.ips.join(", "), quelle: "laut Proxmox" };
    const n = norm(name);
    const t = Object.keys(PS.z).find((e) => e.startsWith("device_tracker.") && PS.a(e).ip
      && [PS.a(e).host_name, PS.a(e).hostname, PS.name(e).split(" ")[0]].some((x) => x && norm(x) === n));
    return t ? { text: PS.a(t).ip, quelle: "laut UniFi (Hostname)" } : { text: "–", quelle: PS.opt && PS.opt.proxmox ? "Proxmox liefert keine Adresse (Gast-Agent nötig)" : "Keine Adresse bekannt" };
  }

  // ------------------------------------------------------------ Lebendige Bausteine
  const beobachtet = new Set();
  const FORMAT = {
    pct: (v) => PS.zahl(v, v >= 10 ? 0 : 1), grad: (v) => PS.zahl(v, 1), last: (v) => PS.zahl(v, 2), gb: (v) => gb(v),
  };
  // Ring mit Wert in der Mitte; Anteil aus Wert/Max, gleitet bei jeder Messung (CSS-Übergang am Ring)
  const ring = (titel, eid, farbe, max = 100, fmt = "pct", einheitText = "%", px = "") => {
    if (eid) beobachtet.add(eid);
    const p = px ? ` data-px="${PS.esc(px)}"` : "";
    return `<div class="ring r-ring sv-ring" data-ring="${PS.esc(eid || "")}"${p} data-max="${max}" style="--farbe:${farbe}">${PS.ringSVG(0)}
      <div class="innen"><b class="tabular"><span data-sv="${PS.esc(eid || "")}"${p} data-fmt="${fmt}"></span><i>${einheitText}</i></b><small>${PS.esc(titel)}</small></div></div>`;
  };
  // Zahl als Walze
  const wert = (eid, fmt = "pct") => { if (eid) beobachtet.add(eid); return `<span class="tabular" data-sv="${PS.esc(eid || "")}" data-fmt="${fmt}"></span>`; };
  // Balken, dessen Breite gleitet
  const balken = (eid, farbe) => { if (eid) beobachtet.add(eid); return `<span class="sv-balken" data-balken="${PS.esc(eid || "")}" style="--farbe:${farbe}"><i></i></span>`; };
  // Kurve: Reihen „Entität|Farbe|Max“; läuft stetig mit der Uhr
  const kurve = (reihen, spanneS = 3600, gross = false) => {
    reihen.forEach((r) => r[0] && beobachtet.add(r[0]));
    verlaufLaden(reihen.map((r) => r[0]), Math.ceil(spanneS / 3600) + 0.5);
    return `<canvas class="sv-kurve${gross ? " sv-gross" : ""}" data-spanne="${spanneS}" data-reihen="${PS.esc(reihen.filter((r) => r[0]).map((r) => r.join("|")).join(";"))}"></canvas>`;
  };
  // Wert eines Elements: aus Proxmox direkt (data-px „Name|Feld“), sonst aus Home Assistant
  const wertVon = (el, eid) => {
    if (el.dataset.px) { const [n, f] = el.dataset.px.split("|"), g = pxGast(n); if (g && g[f] != null) return g[f]; }
    return zahl(eid);
  };
  function liveSetzen(wurzel = document) {
    wurzel.querySelectorAll("[data-sv]").forEach((el) => {
      const v = wertVon(el, el.dataset.sv), t = v == null ? "–" : (FORMAT[el.dataset.fmt] || FORMAT.pct)(v);
      if (el._t !== t) { el._t = t; PS.walze(el, t); }
    });
    wurzel.querySelectorAll("[data-ring]").forEach((el) => {
      const v = wertVon(el, el.dataset.ring);
      PS.ringSetzen(el.querySelector("svg"), v == null ? 0 : v / (+el.dataset.max || 100));
    });
    wurzel.querySelectorAll("[data-balken]").forEach((el) => {
      const v = wertVon(el, el.dataset.balken);
      el.firstElementChild.style.width = `${Math.max(0, Math.min(100, v || 0))}%`;
      el.classList.toggle("warn", v >= 80); el.classList.toggle("krit", v >= 92);
    });
    wurzel.querySelectorAll("[data-seit]").forEach((el) => { const t = dauer(seit(el.dataset.seit)); if (el.textContent !== t) el.textContent = t; });
    wurzel.querySelectorAll("[data-ip]").forEach((el) => { const t = ipText(el.dataset.ip); if (el.textContent !== t.text) { el.textContent = t.text; el.title = t.quelle; } });
    wurzel.querySelectorAll("[data-netz-px]").forEach((el) => {
      const g = pxGast(el.dataset.netzPx), rt = g && PX.raten.get(g.vmid);
      const t = rt ? `↓ ${rate(rt.rx)} · ↑ ${rate(rt.tx)}` : "–";
      if (el.textContent !== t) el.textContent = t;
    });
    kurvenStarten();
  }

  // Zeichnen der Kurven: gemeinsame Schleife mit höchstens 20 Bildern je Sekunde, solange eine Kurve zu sehen ist
  let raf = 0, letzt = 0;
  const farbeCache = new Map();
  function rgb(name) {
    if (farbeCache.has(name)) return farbeCache.get(name);
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = "#8fb4ff";
    c.fillStyle = name.startsWith("--") ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#8fb4ff" : name;
    const s = c.fillStyle, m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
    const w = m ? m.slice(1).map((x) => parseInt(x, 16)).join(",") : ((/\d+\s*,\s*\d+\s*,\s*\d+/.exec(s) || ["143,180,255"])[0]);
    farbeCache.set(name, w); return w;
  }
  function kurvenStarten() { if (!raf && document.querySelector("canvas.sv-kurve")) raf = requestAnimationFrame(schritt); }
  function schritt(jetzt) {
    raf = 0;
    const alle = [...document.querySelectorAll("canvas.sv-kurve")];
    if (!alle.length) return;
    raf = requestAnimationFrame(schritt);
    if (jetzt - letzt < 50 || document.hidden) return;
    letzt = jetzt;
    alle.forEach(zeichnen);
  }
  function zeichnen(cv) {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const spanne = (+cv.dataset.spanne || 3600) * 1000, jetzt = Date.now(), oben = cv.classList.contains("sv-gross") ? 16 : 4;
    const X = (t) => w - ((jetzt - t) / spanne) * w;
    // feine Rasterlinien je Viertel der Spanne, laufen mit
    c.strokeStyle = "rgba(197,192,211,.07)"; c.lineWidth = 1;
    const schrittMs = spanne / 4;
    for (let t = Math.floor(jetzt / schrittMs) * schrittMs; t > jetzt - spanne; t -= schrittMs) { const x = Math.round(X(t)) + 0.5; c.beginPath(); c.moveTo(x, oben); c.lineTo(x, h); c.stroke(); }
    const reihen = (cv.dataset.reihen || "").split(";").filter(Boolean).map((r) => r.split("|"));
    reihen.forEach(([eid, farbe, max], i) => {
      const pkt = (VERLAUF.get(eid) || []).filter((p) => p[0] >= jetzt - spanne - 600e3);
      const aktuell = zahl(eid);
      if (aktuell != null) pkt.push([jetzt, aktuell]);
      if (pkt.length < 2) return;
      const m = +max || 100, Y = (v) => h - 1 - Math.max(0, Math.min(1, v / m)) * (h - oben - 1), f = rgb(farbe);
      c.beginPath();
      pkt.forEach(([t, v], n) => { const x = Math.max(0, X(t)), y = Y(v); if (!n) c.moveTo(x, y); else { c.lineTo(x, Y(pkt[n - 1][1])); c.lineTo(x, y); } });
      c.strokeStyle = `rgb(${f})`; c.lineWidth = 1.6; c.lineJoin = "round"; c.stroke();
      if (i === 0) {
        c.lineTo(w, h); c.lineTo(Math.max(0, X(pkt[0][0])), h); c.closePath();
        const g = c.createLinearGradient(0, oben, 0, h); g.addColorStop(0, `rgba(${f},.32)`); g.addColorStop(1, `rgba(${f},0)`);
        c.fillStyle = g; c.fill();
      }
      // leuchtender Kopfpunkt am rechten Rand
      c.beginPath(); c.arc(w - 3, Y(pkt[pkt.length - 1][1]), 3, 0, Math.PI * 2); c.fillStyle = `rgb(${f})`; c.fill();
    });
    if (cv.classList.contains("sv-gross")) {
      c.fillStyle = "rgba(197,192,211,.6)"; c.font = "11px system-ui, sans-serif"; c.textBaseline = "top";
      c.fillText(`letzte ${Math.round(spanne / 60000) >= 120 ? `${Math.round(spanne / 3600000)} h` : `${Math.round(spanne / 60000)} min`}`, 2, 1);
    }
  }
  const legende = (eintraege) => `<div class="sv-legende">${eintraege.map(([t, f]) => `<span><i style="background:${f.startsWith("--") ? `var(${f})` : f}"></i>${PS.esc(t)}</span>`).join("")}</div>`;
  const puls = (text) => `<span class="sv-puls" title="Neue Messung"><i></i>${PS.esc(text || "")}</span>`;

  // ------------------------------------------------------------ Proxmox
  // Kachel je VM und Container: Zustand, IP-Adresse (kopierbar), Ringe für CPU und RAM, CPU-Verlauf, Laufzeit, Netz;
  // Starten per Tippen, Neustart und Herunterfahren per Halten, weitere Befehle hinter „Mehr“
  const MEHR = [
    [/_stoppen$/, "Hart stoppen", "stop-circle-outline", true], [/_anhalten$/, "Anhalten", "pause", false],
    [/_in_ruhezustand_versetzen$/, "Ruhezustand", "sleep", false], [/_zurucksetzen$/, "Zurücksetzen", "backup-restore", true],
    [/_snapshot_erstellen$/, "Snapshot erstellen", "camera-plus-outline", false],
  ];
  const ZUSTAND = { running: "läuft", stopped: "gestoppt", suspended: "angehalten", paused: "pausiert", unknown: "unbekannt" };
  function gastKachel(g) {
    const laeuft = PS.s(g.status) === "running", px = pxGast(g.name);
    const art = px ? (px.art === "lxc" ? "Container" : "VM") : g.es.some((e) => /_anhalten$/.test(e)) ? "VM" : "Container";
    const k = E(`<div class="sv-gk${laeuft ? " an" : ""}">
      <div class="sv-gk-kopf">${PS.ic(art === "VM" ? "monitor" : "package-variant-closed")}<div><b>${PS.esc(g.name)}</b><small>${art}${px ? ` · ${px.vmid}` : ""}</small></div>
        <span class="sv-gk-zustand ${laeuft ? "an" : ""}"><i class="sv-punkt${laeuft ? " an" : ""}"></i>${laeuft ? "läuft" : PS.esc(ZUSTAND[PS.s(g.status)] || PS.text(g.status))}</span></div>
      <button type="button" class="sv-gk-ip" title="Adresse kopieren">${PS.ic("ip-network")}<span data-ip="${PS.esc(g.name)}"></span>${PS.ic("content-copy")}</button>
      <div class="sv-ringe sv-klein">${ring("CPU", g.cpu, "var(--info)", 100, "pct", "%", `${g.name}|cpu`)}${ring("RAM", g.ram, "var(--akzent)", 100, "pct", "%", `${g.name}|ram`)}</div>
      ${g.cpu ? kurve([[g.cpu, "--info", 100], [g.ram, "--akzent", 100]], 3600) : ""}
      <dl class="as-werte">
        <dt>Läuft seit</dt><dd class="tabular">${laeuft && g.laufzeit ? `<span data-seit="${PS.esc(g.laufzeit)}"></span>` : "–"}</dd>
        <dt>Arbeitsspeicher</dt><dd class="tabular">${g.ramMax ? `${gb(zahl(g.ramMax))} GiB` : "–"}${px && px.kerne ? ` · ${px.kerne} ${px.kerne === 1 ? "Kern" : "Kerne"}` : ""}</dd>
        ${PS.opt && PS.opt.proxmox ? `<dt>Netz</dt><dd class="tabular" data-netz-px="${PS.esc(g.name)}">–</dd>` : ""}</dl>
      <div class="sv-gk-tasten"></div><div class="sv-gk-mehr" hidden></div></div>`);
    k.querySelector(".sv-gk-ip").addEventListener("click", async () => {
      const t = ipText(g.name).text;
      if (t === "–") return;
      try { await navigator.clipboard.writeText(t.split(",")[0].trim()); PS.toast(`${t.split(",")[0].trim()} kopiert`); } catch { PS.toast(t); }
    });
    const druck = (eid, text) => PS.dienst("button", "press", { entity_id: eid }).then(() => PS.toast(`${g.name}: ${text}`));
    const tasten = k.querySelector(".sv-gk-tasten"), mehr = k.querySelector(".sv-gk-mehr");
    if (!laeuft && g.start) tasten.appendChild(knopf("Starten", "play", () => druck(g.start, "wird gestartet"), "primaer"));
    if (laeuft && g.neu) { const b = knopf("Neustart", "restart"); b.title = "Halten zum Neustarten"; PS.halten(b, 1000, () => druck(g.neu, "startet neu")); tasten.appendChild(b); }
    if (laeuft && g.stopp) { const b = knopf("Herunterfahren", "power", null, "gefahr"); b.title = "Halten zum Herunterfahren"; PS.halten(b, 1200, () => druck(g.stopp, "fährt herunter")); tasten.appendChild(b); }
    MEHR.forEach(([re, text, icon, halten]) => {
      const eid = g.es.find((e) => e.startsWith("button.") && re.test(e) && e !== g.stopp && e !== g.neu && e !== g.start);
      if (!eid) return;
      const b = knopf(text, icon, halten ? null : () => druck(eid, text.toLowerCase()), halten ? "gefahr" : "");
      if (halten) { b.title = "Halten"; PS.halten(b, 1200, () => druck(eid, text.toLowerCase())); }
      mehr.appendChild(b);
    });
    if (PS.opt && PS.opt.proxmox_ui && px) {
      mehr.appendChild(knopf("In Proxmox öffnen", "open-in-new", () => window.open(`${PS.opt.proxmox_ui.replace(/\/$/, "")}/#v1:0:=${px.art}/${px.vmid}`, "_blank", "noopener")));
    }
    if (mehr.children.length) {
      const b = knopf("", "dots-horizontal", () => { mehr.hidden = !mehr.hidden; b.classList.toggle("aktiv", !mehr.hidden); });
      b.title = "Weitere Befehle"; tasten.appendChild(b);
    }
    return k;
  }

  PS.admin.bloecke.proxmox = {
    titel: "Proxmox", icon: "server",
    render(b) {
      const p = proxmox(), k = p.knoten[0];
      if (!k) { b.appendChild(E('<div class="leer">Keine Proxmox-Daten. Die Integration „Proxmox VE“ in Home Assistant liefert sie.</div>')); return; }
      b.querySelector("h3 small").innerHTML = puls(k.name);
      const online = PS.s(k.status) === "online" || PS.s(k.status) === "on";
      b.appendChild(E(`<div class="nz-status ${online ? "ok" : "krit"}">${PS.ic(online ? "server" : "server-off")}<b>${online ? "Knoten online" : "Knoten nicht erreichbar"}</b><span class="tabular">${p.laeuft.length}/${p.gaeste.length} laufen</span></div>`));
      // Ring „Speicher“: der am stärksten belegte Speicher (local, local-lvm …)
      const voll = p.speicher.slice().sort((x, y) => (Number(PS.s(y.belegt)) || 0) - (Number(PS.s(x.belegt)) || 0))[0];
      b.appendChild(E(`<div class="sv-ringe">${ring("CPU", k.cpu, "var(--info)")}${ring("RAM", k.ram, "var(--akzent)")}${voll ? ring("Speicher", voll.belegt, "var(--gut)") : ""}</div>`));
      b.appendChild(E(`<div>${kurve([[k.cpu, "--info", 100], [k.ram, "--akzent", 100]], 3600)}${legende([["CPU", "--info"], ["RAM", "--akzent"]])}</div>`));
      if (p.laeuft.length) b.appendChild(E(`<div class="sv-chips">${p.laeuft.map((g) => `<span><i class="sv-punkt an"></i>${PS.esc(g.name)}<small>${wert(g.cpu)} %</small></span>`).join("")}</div>`));
      if (k.update && PS.s(k.update) === "on") b.appendChild(E(`<div class="nz-zeile info">${PS.ic("update")}<span>Update für Proxmox verfügbar</span></div>`));
      b.appendChild(knopf("Proxmox öffnen", "server", () => PS.oeffnen("proxmox")));
      requestAnimationFrame(() => liveSetzen(b));
    },
    relevant: (ids) => [...ids].some((e) => (PS.reg[e] || {}).p === "proxmoxve"),
    signatur: () => { const p = proxmox(), k = p.knoten[0] || {}; return JSON.stringify([k.name, k.status && PS.s(k.status), p.gaeste.map((g) => [g.name, PS.s(g.status)]), k.update && PS.s(k.update)]); },
    aktualisieren: (b) => { if (b) liveSetzen(b); },
  };
  PS.module.proxmox = {
    titel: "Proxmox", icon: "server",
    render(el) {
      el.classList.add("admin-seite");
      const g = E('<div class="as-seitenraster sv-seite"></div>'); el.appendChild(g);
      const block = (titel, klein, breite = 1) => { const b = box(titel, klein || " "); const w = E(`<div class="as-block" style="--breite:${breite}"></div>`); w.appendChild(b); g.appendChild(w); return b; };
      const zeichnen = () => {
        g.innerHTML = "";
        const p = proxmox();
        if (!p.knoten.length && !p.gaeste.length) { block("Proxmox").appendChild(E('<div class="leer">Keine Proxmox-Daten. Die Integration „Proxmox VE“ in Home Assistant liefert sie.</div>')); return; }
        p.knoten.forEach((k) => {
          const online = PS.s(k.status) === "online" || PS.s(k.status) === "on";
          const b = block(`Knoten ${k.name}`, ""); b.querySelector("h3 small").innerHTML = puls(online ? "online" : "nicht erreichbar");
          b.appendChild(E(`<div class="sv-ringe sv-gross">${ring("CPU", k.cpu, "var(--info)")}${ring("RAM", k.ram, "var(--akzent)")}</div>`));
          b.appendChild(E(`<dl class="as-werte"><dt>Arbeitsspeicher</dt><dd class="tabular">${k.ramMax ? `${gb(zahl(k.ramMax))} GiB` : "–"}</dd>
            <dt>Läuft seit</dt><dd class="tabular">${k.laufzeit ? `<span data-seit="${PS.esc(k.laufzeit)}"></span>` : "–"}</dd>
            <dt>Gäste</dt><dd class="tabular">${p.laeuft.length} von ${p.gaeste.length} laufen</dd>
            ${k.update ? `<dt>Software</dt><dd>${PS.s(k.update) === "on" ? "Update verfügbar" : "aktuell"}</dd>` : ""}</dl>`));
          const r = E('<div class="reihe"></div>');
          if (k.neu) { const x = knopf("Neu starten (halten)", "restart"); PS.halten(x, 1500, () => PS.dienst("button", "press", { entity_id: k.neu }).then(() => PS.toast(`${k.name} startet neu`))); r.appendChild(x); }
          if (k.stopp) { const x = knopf("Herunterfahren (halten)", "power", null, "gefahr"); PS.halten(x, 2000, () => PS.dienst("button", "press", { entity_id: k.stopp }).then(() => PS.toast(`${k.name} fährt herunter`))); r.appendChild(x); }
          if (r.children.length) b.appendChild(r);
          const v = block(`Auslastung ${k.name}`, "CPU und RAM", 2);
          v.appendChild(E(`<div>${kurve([[k.cpu, "--info", 100], [k.ram, "--akzent", 100]], 7200, true)}${legende([["CPU", "--info"], ["RAM", "--akzent"]])}</div>`));
        });
        if (p.speicher.length) {
          const s = block("Speicher", `${p.speicher.length} Speicher`);
          p.speicher.forEach((x) => s.appendChild(E(`<div class="sv-speicher"><div><b>${PS.esc(x.name.replace(/^Storage\s*/, ""))}</b><small class="tabular">${gb(zahl(x.frei))} GiB frei von ${gb(zahl(x.gesamt))} GiB</small></div>${balken(x.belegt, "var(--gut)")}<span class="tabular">${wert(x.belegt)} %</span></div>`)));
        }
        const t = block("VMs und Container", `${p.laeuft.length} von ${p.gaeste.length} laufen`, 3);
        const raster = E('<div class="sv-gk-raster"></div>');
        p.gaeste.forEach((x) => raster.appendChild(gastKachel(x)));
        t.appendChild(raster);
        if (!(PS.opt && PS.opt.proxmox)) t.appendChild(E(`<div class="nz-zeile">${PS.ic("information-outline")}<span>IP-Adressen kommen über UniFi (Hostname). Für alle Adressen und Werte im Sekundentakt in den App-Optionen „Proxmox: API-Token“ eintragen (nur lesend).</span></div>`));
        g._sig = PS.admin.bloecke.proxmox.signatur();
        requestAnimationFrame(() => liveSetzen(g));
      };
      zeichnen();
      pxLaden().then(() => { if (g.isConnected) zeichnen(); });
      // Wechselt ein Gast seinen Zustand, die Seite neu aufbauen; Werte laufen sonst an Ort und Stelle. Proxmox direkt
      // (falls eingerichtet) alle 5 s.
      let n = 0;
      const t = setInterval(() => {
        if (!g.isConnected) { clearInterval(t); return; }
        if (PS.admin.bloecke.proxmox.signatur() !== g._sig) zeichnen();
        if (++n % 2 === 0) pxLaden().then(() => liveSetzen(g));
      }, 2500);
    },
  };

  // ------------------------------------------------------------ HA-Host (Raspberry Pi)
  const TEMP_MAX = 85;
  PS.admin.bloecke.pi = {
    titel: "HA-Host", icon: "raspberry-pi",
    render(b) {
      const x = host();
      if (!x.cpu && !x.ram) { b.appendChild(E('<div class="leer">Keine Werte. Die Integration „System Monitor“ in Home Assistant liefert sie.</div>')); return; }
      b.querySelector("h3 small").innerHTML = puls("Raspberry Pi");
      b.appendChild(E(`<div class="sv-ringe">${ring("CPU", x.cpu, "var(--info)")}${ring("RAM", x.ram, "var(--akzent)")}${x.temp ? ring("Temp.", x.temp, "var(--warn)", TEMP_MAX, "grad", "°") : ""}</div>`));
      b.appendChild(E(`<div>${kurve([[x.cpu, "--info", 100], [x.temp, "--warn", TEMP_MAX]], 3600)}${legende([["CPU", "--info"], ["Temperatur", "--warn"]])}</div>`));
      b.appendChild(E(`<div class="nz-zeile">${PS.ic("chip")}<span>Last ${wert(x.last1, "last")} · ${wert(x.last5, "last")} · ${wert(x.last15, "last")}${x.disk ? ` · Speicher ${wert(x.disk)} %` : ""}</span></div>`));
      if (x.stromFehler) b.appendChild(E(`<div class="nz-zeile krit">${PS.ic("flash-alert")}<span>Netzteil: Unterspannung erkannt</span></div>`));
      if (x.updates.length) b.appendChild(E(`<div class="nz-zeile info">${PS.ic("update")}<span>${x.updates.length} Update${x.updates.length > 1 ? "s" : ""} verfügbar</span></div>`));
      b.appendChild(knopf("HA-Host öffnen", "raspberry-pi", () => PS.oeffnen("pi")));
      requestAnimationFrame(() => liveSetzen(b));
    },
    relevant: (ids) => [...ids].some((e) => ["systemmonitor", "rpi_power", "hassio"].includes((PS.reg[e] || {}).p)),
    signatur: () => { const x = host(); return JSON.stringify([!!x.cpu, x.stromFehler, x.updates]); },
    aktualisieren: (b) => { if (b) liveSetzen(b); },
  };
  PS.module.pi = {
    titel: "HA-Host", icon: "raspberry-pi",
    render(el) {
      el.classList.add("admin-seite");
      const g = E('<div class="as-seitenraster sv-seite"></div>'); el.appendChild(g);
      const block = (titel, klein, breite = 1) => { const b = box(titel, klein || " "); const w = E(`<div class="as-block" style="--breite:${breite}"></div>`); w.appendChild(b); g.appendChild(w); return b; };
      const zeichnen = () => {
        g.innerHTML = "";
        const x = host();
        if (!x.cpu && !x.ram) { block("HA-Host").appendChild(E('<div class="leer">Keine Werte. Die Integration „System Monitor“ in Home Assistant liefert sie.</div>')); return; }
        const a = block("Auslastung", ""); a.querySelector("h3 small").innerHTML = puls("Raspberry Pi");
        a.appendChild(E(`<div class="sv-ringe sv-gross">${ring("CPU", x.cpu, "var(--info)")}${ring("RAM", x.ram, "var(--akzent)")}${x.temp ? ring("Temperatur", x.temp, "var(--warn)", TEMP_MAX, "grad", "°") : ""}${x.disk ? ring("Speicher", x.disk, "var(--gut)") : ""}</div>`));
        const v = block("Verlauf", "CPU, RAM, Temperatur", 2);
        v.appendChild(E(`<div>${kurve([[x.cpu, "--info", 100], [x.ram, "--akzent", 100], [x.temp, "--warn", TEMP_MAX]], 7200, true)}${legende([["CPU", "--info"], ["RAM", "--akzent"], ["Temperatur (bis 85 °)", "--warn"]])}</div>`));
        const s = block("System", "");
        s.appendChild(E(`<dl class="as-werte">
          <dt>Last 1 · 5 · 15 min</dt><dd>${wert(x.last1, "last")} · ${wert(x.last5, "last")} · ${wert(x.last15, "last")}</dd>
          ${x.ramBelegt ? `<dt>RAM belegt</dt><dd>${wert(x.ramBelegt, "gb")} ${PS.esc(einheit(x.ramBelegt))}</dd>` : ""}
          ${x.swap ? `<dt>Swap</dt><dd>${wert(x.swap)} %</dd>` : ""}
          ${x.diskFrei ? `<dt>Speicher frei</dt><dd>${wert(x.diskFrei, "gb")} ${PS.esc(einheit(x.diskFrei))}</dd>` : ""}
          ${x.laufzeit ? `<dt>Läuft seit</dt><dd class="tabular"><span data-seit="${PS.esc(x.laufzeit)}"></span></dd>` : ""}
          ${x.strom ? `<dt>Netzteil</dt><dd class="${x.stromFehler ? "krit" : ""}">${x.stromFehler ? "Unterspannung erkannt" : "in Ordnung"}</dd>` : ""}</dl>`));
        if (x.swap) s.appendChild(E(`<div class="sv-speicher"><div><b>Swap</b></div>${balken(x.swap, "var(--akzent)")}<span class="tabular">${wert(x.swap)} %</span></div>`));
        const u = block("Updates", x.updates.length ? `${x.updates.length} verfügbar` : "alles aktuell");
        if (x.updates.length) u.appendChild(PS.bau.raster(x.updates));
        else u.appendChild(E('<div class="leer">Home Assistant, Betriebssystem und Apps sind aktuell.</div>'));
        u.appendChild(knopf("Updates in Home Assistant", "open-in-app", () => PS.haOeffnen("/config/updates", "Updates")));
        PS.kachelnBinden(u);
        g._sig = PS.admin.bloecke.pi.signatur();
        requestAnimationFrame(() => liveSetzen(g));
      };
      zeichnen();
      const t = setInterval(() => { if (!g.isConnected) { clearInterval(t); return; } if (PS.admin.bloecke.pi.signatur() !== g._sig) zeichnen(); }, 3000);
    },
  };
  // Laufzeiten jede Minute nachführen, auch ohne neue Messung
  setInterval(() => document.querySelectorAll("[data-seit]").forEach((el) => { const t = dauer(seit(el.dataset.seit)); if (el.textContent !== t) el.textContent = t; }), 30000);

  // In die Modulleiste hinter „Netzwerk“
  const i = PS.admin.module.indexOf("netzwerk");
  PS.admin.module.splice(i < 0 ? PS.admin.module.length : i + 1, 0, "proxmox", "pi");
})();
