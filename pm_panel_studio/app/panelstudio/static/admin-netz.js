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

  // ------------------------------------------------------------ Block für die Startseite
  PS.admin.bloecke.netzwerk = {
    titel: "Netzwerk", icon: "lan",
    render(b) {
      const z = zusammenfassung();
      if (!z.geraete.length && !z.internet) { b.appendChild(E('<div class="leer">Keine UniFi-Daten. Seite „Netzwerk“ öffnen für Hinweise zur Einrichtung.</div>')); return; }
      const i = z.internet;
      b.querySelector("h3 small").textContent = i && i.isp ? i.isp : "";
      b.appendChild(E(`<div class="nz-status ${z.online == null ? "" : z.online ? "ok" : "krit"}">${PS.ic(z.online == null ? "web" : z.online ? "web-check" : "web-off")}<b>${z.online == null ? "Internet: Zustand unbekannt" : z.online ? "Internet verbunden" : "Internet gestört"}</b>${i && i.latenz_ms != null ? `<span class="tabular">${PS.zahl(i.latenz_ms, 0)} ms</span>` : ""}</div>`));
      if (i) {
        // Groß: Live-Werte; darunter das letzte Speedtest-Ergebnis
        b.appendChild(E(`<div class="nz-werte">
          <div><small>Ping jetzt</small><b class="tabular">${i.latenz_ms != null ? PS.zahl(i.latenz_ms, 0) : "–"}<i>ms</i></b></div>
          <div><small>Download jetzt</small><b class="tabular">${rate(i.rx_bps)}<i>Mbit/s</i></b></div>
          <div><small>Upload jetzt</small><b class="tabular">${rate(i.tx_bps)}<i>Mbit/s</i></b></div></div>`));
        b.appendChild(E(`<div class="nz-zeile">${PS.ic("speedometer")}<span>Speedtest: ↓ ${mbit(i.down_mbit)} · ↑ ${mbit(i.up_mbit)} Mbit/s · ${i.ping_ms != null ? PS.zahl(i.ping_ms, 0) : "–"} ms${i.speedtest_zeit ? ` · ${PS.esc(PS.zeitRelativ(new Date(i.speedtest_zeit * 1000).toISOString()))}` : ""}</span></div>`));
      }
      b.appendChild(E(`<div class="nz-zeile">${PS.ic("devices")}<span>${z.clients} Clients · ${z.geraete.length - z.aus.length}/${z.geraete.length} UniFi-Geräte online</span></div>`));
      z.aus.forEach((g) => b.appendChild(E(`<div class="nz-zeile krit">${PS.ic("lan-disconnect")}<span>${PS.esc(g.name)} offline</span></div>`)));
      if (z.updates.length) b.appendChild(E(`<div class="nz-zeile info">${PS.ic("update")}<span>${z.updates.length} Firmware-Update${z.updates.length > 1 ? "s" : ""} verfügbar</span></div>`));
      b.appendChild(knopf("Netzwerk öffnen", "lan", () => PS.oeffnen("netzwerk")));
    },
    relevant: () => false,
    // Neu zeichnen nur bei sichtbaren Änderungen (Durchsatz auf 1 Mbit/s gerundet)
    signatur: () => {
      const z = zusammenfassung(), i = z.internet || {};
      return JSON.stringify([z.online, i.latenz_ms, i.ping_ms, i.down_mbit, i.up_mbit, rate(i.rx_bps), rate(i.tx_bps), z.clients, z.aus.map((g) => g.name), z.updates.length, z.geraete.length]);
    },
  };
  setInterval(() => { if (document.querySelector('.as-block[data-id="netzwerk"]') && !document.body.classList.contains("offen")) laden().then(() => PS.admin.vormerken("netzwerk")); }, 15000);
  PS.on("init", () => { laden().then(() => PS.admin.vormerken("netzwerk")); });

  // ------------------------------------------------------------ Seite „Netzwerk“
  PS.module.netzwerk = {
    titel: "Netzwerk", icon: "lan",
    async render(el) {
      el.classList.add("admin-seite");
      const g = E('<div class="as-seitenraster nz-seite"></div>'); el.appendChild(g);
      const block = (titel, klein, breite = 1) => { const b = box(titel, klein); const w = E(`<div class="as-block" style="--breite:${breite}"></div>`); w.appendChild(b); g.appendChild(w); return b; };
      const zeichnen = () => {
        g.innerHTML = "";
        const z = zusammenfassung(), i = z.internet, u = z.u;
        // Internet
        const bi = block("Internet", i && i.isp ? i.isp : "");
        bi.appendChild(E(`<div class="nz-status ${z.online == null ? "" : z.online ? "ok" : "krit"}">${PS.ic(z.online == null ? "web" : z.online ? "web-check" : "web-off")}<b>${z.online == null ? "Zustand unbekannt" : z.online ? "Verbunden" : "Gestört"}</b>${i && i.wan_ip ? `<span class="tabular">${PS.esc(i.wan_ip)}</span>` : ""}</div>`));
        if (i) {
          bi.appendChild(E(`<div class="nz-werte nz-gross">
            <div><small>Ping jetzt</small><b class="tabular">${i.latenz_ms != null ? PS.zahl(i.latenz_ms, 0) : "–"}<i>ms</i></b></div>
            <div><small>Download jetzt</small><b class="tabular">${rate(i.rx_bps)}<i>Mbit/s</i></b></div>
            <div><small>Upload jetzt</small><b class="tabular">${rate(i.tx_bps)}<i>Mbit/s</i></b></div></div>`));
          bi.appendChild(E(`<dl class="as-werte">
            <dt>Speedtest</dt><dd class="tabular">↓ ${mbit(i.down_mbit)} · ↑ ${mbit(i.up_mbit)} Mbit/s · Ping ${i.ping_ms != null ? PS.zahl(i.ping_ms, 0) : "–"} ms</dd>
            <dt>Letzter Speedtest</dt><dd>${i.speedtest_zeit ? PS.esc(PS.zeitRelativ(new Date(i.speedtest_zeit * 1000).toISOString())) : "noch keiner"}</dd>
            <dt>Verbunden seit</dt><dd>${dauer(i.uptime)}</dd>
            ${i.ausfaelle != null ? `<dt>Ausfälle</dt><dd class="tabular">${PS.zahl(i.ausfaelle, 0)}</dd>` : ""}</dl>`));
          const st = knopf("Speedtest starten", "speedometer", async () => {
            st.disabled = true; st.querySelector("span").textContent = "Speedtest läuft …";
            try {
              const r = await fetch("api/netz/speedtest", { method: "POST", headers: { "X-PMPS-Aktion": "1" } });
              if (!r.ok) throw new Error(await r.text());
              PS.toast("Speedtest gestartet; das Ergebnis erscheint in etwa einer Minute.");
              setTimeout(() => laden(true).then(() => { if (g.isConnected) zeichnen(); }), 60000);
            } catch (e) { PS.toast(e.message || String(e), true); st.disabled = false; }
          }, "primaer");
          bi.appendChild(st);
        } else {
          bi.appendChild(E(`<div class="leer">${PS.esc(NETZ.stand && NETZ.stand.fehler ? `Gateway nicht erreichbar: ${NETZ.stand.fehler}` : "Ping, Download, Upload und Durchsatz kommen direkt vom UniFi-Gateway. Dafür in den App-Optionen „UniFi: API-Schlüssel“ eintragen (UniFi Network → Einstellungen → Control Plane → Integrationen) oder Benutzer und Kennwort eines lokalen Kontos.")}</div>`));
        }
        // Clients
        const bc = block("Clients", u ? "laut Gateway" : "laut Home Assistant");
        if (u) {
          bc.appendChild(E(`<div class="nz-werte">
            <div><small>Gesamt</small><b class="tabular">${z.clients}</b></div>
            <div><small>LAN</small><b class="tabular">${u.clients.lan ?? "–"}</b></div>
            <div><small>WLAN</small><b class="tabular">${u.clients.wlan ?? "–"}</b></div>
            <div><small>Gäste</small><b class="tabular">${u.clients.gast ?? "–"}</b></div></div>`));
        } else bc.appendChild(E(`<div class="nz-werte"><div><small>Im Netz</small><b class="tabular">${z.clients}</b></div></div>`));
        const wl = z.h.clients.wlans;
        if (wl.length) bc.appendChild(E(`<dl class="as-werte">${wl.map(([n, v]) => `<dt>WLAN ${PS.esc(n)}</dt><dd class="tabular">${v}</dd>`).join("")}</dl>`));
        // Zustand
        const bz = block("Zustand", `${z.geraete.length - z.aus.length}/${z.geraete.length} online`);
        bz.appendChild(E(`<div class="nz-status ${!z.geraete.length ? "" : z.aus.length ? "krit" : "ok"}">${PS.ic(!z.geraete.length ? "lan" : z.aus.length ? "lan-disconnect" : "check-network-outline")}<b>${!z.geraete.length ? "Keine UniFi-Geräte gefunden" : z.aus.length ? `${z.aus.length} ${z.aus.length === 1 ? "Gerät" : "Geräte"} offline` : "Alle UniFi-Geräte online"}</b></div>`));
        if (z.updates.length) bz.appendChild(E(`<div class="nz-zeile info">${PS.ic("update")}<span>Update für ${PS.esc(z.updates.map((x) => x.name).join(", "))}</span></div>`));
        const heiss = z.geraete.filter((x) => (x.cpu || 0) >= 90 || (x.ram || 0) >= 90 || (x.temp || 0) >= 80);
        heiss.forEach((x) => bz.appendChild(E(`<div class="nz-zeile warn">${PS.ic("alert-outline")}<span>${PS.esc(x.name)}: hohe Auslastung oder Temperatur</span></div>`)));
        bz.appendChild(knopf("UniFi-Integration in Home Assistant", "open-in-app", () => PS.haOeffnen("/config/integrations/integration/unifi", "UniFi")));
        // Geräte
        const bg = block("UniFi-Geräte", u ? "Gateway, Switches, Access Points" : "aus Home Assistant", 3);
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
        bg.appendChild(t);
      };
      await laden(true);
      zeichnen();
      // Alle 15 s nachladen, solange die Seite offen ist
      const t = setInterval(() => { if (!g.isConnected) { clearInterval(t); return; } laden().then(zeichnen); }, 15000);
    },
  };
  // In die Modulleiste vor „Automationen“
  const i = PS.admin.module.indexOf("automationen");
  PS.admin.module.splice(i < 0 ? PS.admin.module.length : i, 0, "netzwerk");
})();
