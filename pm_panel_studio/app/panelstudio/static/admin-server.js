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

  // Proxmox VE: je Gerät der Integration ein Knoten, ein Gast (VM oder Container) oder ein Speicher
  function proxmox() {
    const je = new Map();
    plattform("proxmoxve").forEach((e) => { const d = PS.reg[e].d || e; if (!je.has(d)) je.set(d, []); je.get(d).push(e); });
    const alle = [...je.entries()].map(([d, es]) => {
      const sensor = es.filter((e) => e.startsWith("sensor."));
      const taste = (re) => es.find((e) => e.startsWith("button.") && re.test(e));
      return {
        d, es, name: PS.geraete[d] || PS.name(es[0]),
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

  // ------------------------------------------------------------ Lebendige Bausteine
  const beobachtet = new Set();
  const FORMAT = {
    pct: (v) => PS.zahl(v, v >= 10 ? 0 : 1), grad: (v) => PS.zahl(v, 1), last: (v) => PS.zahl(v, 2), gb: (v) => gb(v),
  };
  // Ring mit Wert in der Mitte; Anteil aus Wert/Max, gleitet bei jeder Messung (CSS-Übergang am Ring)
  const ring = (titel, eid, farbe, max = 100, fmt = "pct", einheitText = "%") => {
    if (eid) beobachtet.add(eid);
    return `<div class="ring r-ring sv-ring" data-ring="${PS.esc(eid || "")}" data-max="${max}" style="--farbe:${farbe}">${PS.ringSVG(0)}
      <div class="innen"><b class="tabular"><span data-sv="${PS.esc(eid || "")}" data-fmt="${fmt}"></span><i>${einheitText}</i></b><small>${PS.esc(titel)}</small></div></div>`;
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
  function liveSetzen(wurzel = document) {
    wurzel.querySelectorAll("[data-sv]").forEach((el) => {
      const v = zahl(el.dataset.sv), t = v == null ? "–" : (FORMAT[el.dataset.fmt] || FORMAT.pct)(v);
      if (el._t !== t) { el._t = t; PS.walze(el, t); }
    });
    wurzel.querySelectorAll("[data-ring]").forEach((el) => {
      const v = zahl(el.dataset.ring);
      PS.ringSetzen(el.querySelector("svg"), v == null ? 0 : v / (+el.dataset.max || 100));
    });
    wurzel.querySelectorAll("[data-balken]").forEach((el) => {
      const v = zahl(el.dataset.balken);
      el.firstElementChild.style.width = `${Math.max(0, Math.min(100, v || 0))}%`;
      el.classList.toggle("warn", v >= 80); el.classList.toggle("krit", v >= 92);
    });
    wurzel.querySelectorAll("[data-seit]").forEach((el) => { const t = dauer(seit(el.dataset.seit)); if (el.textContent !== t) el.textContent = t; });
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
  const gastZeile = (g) => {
    const laeuft = PS.s(g.status) === "running";
    const z = E(`<table><tr class="${laeuft ? "" : "aus"}"><td><span class="sv-gast"><i class="sv-punkt${laeuft ? " an" : ""}"></i><b>${PS.esc(g.name)}</b></span></td>
      <td class="vw-status"><i class="${laeuft ? "ok" : "aus"}">${laeuft ? "läuft" : PS.esc(PS.text(g.status))}</i></td>
      <td class="sv-zelle">${g.cpu ? `${balken(g.cpu, "var(--info)")}<small>${wert(g.cpu)} %</small>` : "–"}</td>
      <td class="sv-zelle">${g.ram ? `${balken(g.ram, "var(--akzent)")}<small>${wert(g.ram)} %${g.ramMax ? ` von ${gb(zahl(g.ramMax))} GiB` : ""}</small>` : "–"}</td>
      <td class="tabular">${laeuft && g.laufzeit ? `<span data-seit="${PS.esc(g.laufzeit)}"></span>` : "–"}</td><td class="sv-tasten"></td></tr></table>`).querySelector("tr");
    const t = z.querySelector(".sv-tasten");
    const druck = (eid, text) => PS.dienst("button", "press", { entity_id: eid }).then(() => PS.toast(`${g.name}: ${text}`));
    if (!laeuft && g.start) { const b = knopf("", "play", () => druck(g.start, "wird gestartet")); b.title = "Starten"; t.appendChild(b); }
    if (laeuft && g.neu) { const b = knopf("", "restart"); b.title = "Neu starten (halten)"; PS.halten(b, 1000, () => druck(g.neu, "startet neu")); t.appendChild(b); }
    if (laeuft && g.stopp) { const b = knopf("", "stop", null, "gefahr"); b.title = "Herunterfahren (halten)"; PS.halten(b, 1200, () => druck(g.stopp, "fährt herunter")); t.appendChild(b); }
    return z;
  };
  PS.admin.bloecke.proxmox = {
    titel: "Proxmox", icon: "server",
    render(b) {
      const p = proxmox(), k = p.knoten[0];
      if (!k) { b.appendChild(E('<div class="leer">Keine Proxmox-Daten. Die Integration „Proxmox VE“ in Home Assistant liefert sie.</div>')); return; }
      b.querySelector("h3 small").innerHTML = puls(k.name);
      const online = PS.s(k.status) === "online" || PS.s(k.status) === "on";
      b.appendChild(E(`<div class="nz-status ${online ? "ok" : "krit"}">${PS.ic(online ? "server" : "server-off")}<b>${online ? "Knoten online" : "Knoten nicht erreichbar"}</b><span class="tabular">${p.laeuft.length}/${p.gaeste.length} laufen</span></div>`));
      b.appendChild(E(`<div class="sv-ringe">${ring("CPU", k.cpu, "var(--info)")}${ring("RAM", k.ram, "var(--akzent)")}${p.speicher[0] ? ring(p.speicher[0].name.replace(/^Storage\s*/, ""), p.speicher[0].belegt, "var(--gut)") : ""}</div>`));
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
        const tab = E('<div class="as-tabelle sv-gaeste"><table><thead><tr><th>Name</th><th>Zustand</th><th>CPU</th><th>RAM</th><th>Läuft seit</th><th></th></tr></thead><tbody></tbody></table></div>');
        p.gaeste.forEach((x) => tab.querySelector("tbody").appendChild(gastZeile(x)));
        t.appendChild(tab);
        g._sig = PS.admin.bloecke.proxmox.signatur();
        requestAnimationFrame(() => liveSetzen(g));
      };
      zeichnen();
      // Wechselt ein Gast seinen Zustand, die Seite neu aufbauen; Werte laufen sonst an Ort und Stelle
      const t = setInterval(() => { if (!g.isConnected) { clearInterval(t); return; } if (PS.admin.bloecke.proxmox.signatur() !== g._sig) zeichnen(); }, 3000);
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
