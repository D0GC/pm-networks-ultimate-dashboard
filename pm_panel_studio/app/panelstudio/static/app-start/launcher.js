/* PM Dashboard als eigene App: Startseite unter /local/pm-dashboard/ (von PM Panel Studio dorthin kopiert).
   Meldet sich wie das Frontend von Home Assistant an (dieselben gespeicherten Anmeldedaten „hassTokens“, sonst
   Anmeldung über /auth/authorize), hält die Ingress-Sitzung offen und zeigt die Admin-Ansicht im Vollbild.
   Die Admin-Ansicht erreicht über window.hassConnection dieselbe Verbindung wie in der Seitenleiste. */
(function () {
  "use strict";
  const SLUG = "__SLUG__";
  const ORIGIN = location.origin, CLIENT = ORIGIN + "/";
  const SPEICHER = "hassTokens";
  const $ = (id) => document.getElementById(id);
  const status = (text, knopf) => { $("status").textContent = text; $("neu").hidden = !knopf; };

  // ------------------------------------------------------------ Anmeldung
  const lesen = () => { try { return JSON.parse(localStorage.getItem(SPEICHER) || "null"); } catch { return null; } };
  const schreiben = (t) => { try { localStorage.setItem(SPEICHER, JSON.stringify(t)); } catch { /* privat: nur im Speicher */ } };
  let tokens = null;
  function anmelden() {
    const ziel = ORIGIN + location.pathname;
    location.href = `/auth/authorize?response_type=code&client_id=${encodeURIComponent(CLIENT)}&redirect_uri=${encodeURIComponent(ziel)}&state=pm-dashboard`;
  }
  async function tokenAnfrage(daten) {
    const r = await fetch("/auth/token", { method: "POST", body: new URLSearchParams(daten) });
    if (!r.ok) { const f = new Error(`Anmeldung abgelehnt (HTTP ${r.status})`); f.abgelehnt = r.status === 400 || r.status === 403; throw f; }
    const t = await r.json();
    return { ...t, hassUrl: ORIGIN, clientId: daten.client_id, expires: Date.now() + t.expires_in * 1000 };
  }
  async function zugang() {
    if (!tokens) tokens = lesen();
    if (!tokens || !tokens.refresh_token) { anmelden(); throw new Error("Weiterleitung zur Anmeldung"); }
    if (!tokens.expires || tokens.expires - Date.now() < 60000) {
      try {
        const neu = await tokenAnfrage({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId || CLIENT });
        tokens = { ...tokens, ...neu, refresh_token: tokens.refresh_token };
        schreiben(tokens);
      } catch (e) {
        if (e.abgelehnt) { try { localStorage.removeItem(SPEICHER); } catch { /* egal */ } anmelden(); }
        throw e;
      }
    }
    return tokens.access_token;
  }

  // ------------------------------------------------------------ WebSocket wie im Frontend (nur Befehle mit Antwort)
  const conn = (function () {
    let ws = null, id = 1, bereit = null;
    const offen = new Map();
    function verbinden() {
      bereit = new Promise((fertig, fehler) => {
        ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/websocket");
        ws.onmessage = async (ev) => {
          const m = JSON.parse(ev.data);
          if (m.type === "auth_required") {
            try { ws.send(JSON.stringify({ type: "auth", access_token: await zugang() })); } catch (e) { fehler(e); }
          } else if (m.type === "auth_ok") fertig();
          else if (m.type === "auth_invalid") { tokens = Object.assign(tokens || {}, { expires: 0 }); fehler(new Error("Anmeldung ungültig")); }
          else if (m.type === "result" && offen.has(m.id)) {
            const p = offen.get(m.id); offen.delete(m.id);
            m.success ? p.ok(m.result) : p.nein(Object.assign(new Error((m.error && m.error.message) || "Fehler"), { code: m.error && m.error.code }));
          }
        };
        ws.onclose = () => {
          offen.forEach((p) => p.nein(new Error("Verbindung getrennt"))); offen.clear();
          setTimeout(verbinden, 3000);
        };
      });
      bereit.catch(() => {});
    }
    verbinden();
    return {
      async sendMessagePromise(msg) {
        await bereit;
        return new Promise((ok, nein) => { const n = id++; offen.set(n, { ok, nein }); ws.send(JSON.stringify({ ...msg, id: n })); });
      },
    };
  })();
  window.hassConnection = Promise.resolve({ conn, auth: { get accessToken() { return tokens && tokens.access_token; } } });

  // ------------------------------------------------------------ Ingress-Sitzung (wie das Frontend: Cookie, jede Minute bestätigen)
  const keks = () => (document.cookie.match(/(?:^|;\s*)ingress_session=([^;]+)/) || [])[1];
  async function sitzungNeu() {
    const r = await fetch("/api/hassio/ingress/session", { method: "POST", headers: { Authorization: "Bearer " + await zugang() } });
    if (!r.ok) throw new Error(`Ingress-Sitzung nicht erhalten (HTTP ${r.status})`);
    const s = (await r.json()).data.session;
    document.cookie = `ingress_session=${s};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === "https:" ? ";Secure" : ""}`;
    return s;
  }
  async function sitzungHalten() {
    const s = keks();
    if (s) {
      try {
        const r = await fetch("/api/hassio/ingress/validate_session", {
          method: "POST", headers: { Authorization: "Bearer " + await zugang(), "Content-Type": "application/json" }, body: JSON.stringify({ session: s }),
        });
        if (r.ok) return;
      } catch { /* neu anlegen */ }
    }
    await sitzungNeu();
  }

  // ------------------------------------------------------------ Start
  async function start() {
    const q = new URLSearchParams(location.search);
    if (q.get("code")) {
      status("Anmeldung wird abgeschlossen …");
      tokens = await tokenAnfrage({ grant_type: "authorization_code", code: q.get("code"), client_id: CLIENT });
      schreiben(tokens);
      history.replaceState(null, "", location.pathname);
    }
    await zugang();
    status("Verbinde mit Home Assistant …");
    await sitzungNeu();
    setInterval(() => { sitzungHalten().catch(() => {}); }, 60000);
    let info = null;
    try { info = await conn.sendMessagePromise({ type: "supervisor/api", endpoint: `/addons/${SLUG}/info`, method: "get" }); } catch { info = null; }
    if (!info || !info.ingress_url) {
      const l = await conn.sendMessagePromise({ type: "supervisor/api", endpoint: "/addons", method: "get" });
      const a = ((l && l.addons) || []).find((x) => x.slug.endsWith("_pm_panel_studio"));
      if (a) info = await conn.sendMessagePromise({ type: "supervisor/api", endpoint: `/addons/${a.slug}/info`, method: "get" });
    }
    if (!info || !info.ingress_url) throw new Error("PM Panel Studio nicht gefunden.");
    if (info.state !== "started") throw new Error("PM Panel Studio ist gestoppt.");
    const app = $("app");
    app.addEventListener("load", () => { document.body.classList.add("bereit"); try { document.title = app.contentDocument.title || "PM Dashboard"; } catch { /* egal */ } }, { once: true });
    app.src = info.ingress_url;
  }
  $("neu").addEventListener("click", () => { try { localStorage.removeItem(SPEICHER); } catch { /* egal */ } anmelden(); });
  start().catch((e) => {
    const nurAdmins = e && e.code === "unauthorized";
    status(nurAdmins ? "Nur für Administratoren von Home Assistant." : `Start nicht möglich: ${e.message || e}`, true);
  });
})();
