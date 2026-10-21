/* PM Panel Studio – Verwaltung in der Admin-Ansicht: Schnellsuche (wie „C“ in Home Assistant), Automationen,
   Entitäten und Geräte (ausblenden, deaktivieren), Verwaltungsknöpfe im Entitäten-Dialog. Änderungen laufen über die
   Verbindung des angemeldeten Benutzers zu Home Assistant (Seitenleiste oder eigene App); bearbeitet wird im Editor
   von Home Assistant, eingebettet im Dashboard. */
(function () {
  "use strict";
  const PS = window.PS;
  const { E, box, knopf } = PS.bau;
  const alle = () => Object.keys(PS.z);
  const nameSort = (x, y) => String(x.n).localeCompare(String(y.n), "de");

  // ------------------------------------------------------------ Verbindung und Registrierungen
  async function ws(msg) {
    const c = await PS.admin.verbindung();
    if (!c) throw new Error("Keine Verbindung zu Home Assistant. Nur in der Seitenleiste oder der eigenen App verfügbar.");
    return c.sendMessagePromise(msg);
  }
  let reg = null, regZeit = 0;
  async function registrierungen(neu) {
    if (reg && !neu && Date.now() - regZeit < 30000) return reg;
    const [ent, ger, kat, lab] = await Promise.all([
      ws({ type: "config/entity_registry/list" }),
      ws({ type: "config/device_registry/list" }),
      ws({ type: "config/category_registry/list", scope: "automation" }).catch(() => []),
      ws({ type: "config/label_registry/list" }).catch(() => []),
    ]);
    reg = {
      ent: new Map(ent.map((e) => [e.entity_id, e])),
      ger: new Map(ger.map((d) => [d.id, d])),
      kat: new Map(kat.map((k) => [k.category_id, k])),
      lab: new Map(lab.map((l) => [l.label_id, l])),
    };
    regZeit = Date.now();
    return reg;
  }
  const geraetName = (d) => d.name_by_user || d.name || d.id;
  async function entitaetSetzen(eid, aenderung, text) {
    try {
      await ws({ type: "config/entity_registry/update", entity_id: eid, ...aenderung });
      PS.toast(text); regZeit = 0;
    } catch (e) { PS.toast(e.message || String(e), true); throw e; }
  }
  async function geraetSetzen(id, aenderung, text) {
    try {
      await ws({ type: "config/device_registry/update", device_id: id, ...aenderung });
      PS.toast(text); regZeit = 0;
    } catch (e) { PS.toast(e.message || String(e), true); throw e; }
  }
  const automationId = (eid) => PS.a(eid).id;

  // ------------------------------------------------------------ Schnellsuche
  const HA_SEITEN = [
    ["Einstellungen", "cog-outline", "/config/dashboard"], ["Automationen", "robot", "/config/automation/dashboard"],
    ["Szenen", "palette-outline", "/config/scene/dashboard"], ["Skripte", "script-text-outline", "/config/script/dashboard"],
    ["Blueprints", "floor-plan", "/config/blueprint/dashboard"], ["Geräte und Dienste", "devices", "/config/integrations/dashboard"],
    ["Geräte", "devices", "/config/devices/dashboard"], ["Entitäten", "shape-outline", "/config/entities"], ["Helfer", "tools", "/config/helpers"],
    ["Bereiche und Zonen", "texture-box", "/config/areas/dashboard"], ["Personen", "account-multiple-outline", "/config/person"],
    ["Labels", "label-outline", "/config/labels"], ["Kategorien und Tags", "tag-outline", "/config/tags"], ["Dashboards", "view-dashboard-outline", "/config/lovelace/dashboards"],
    ["Sprachassistenten", "microphone-outline", "/config/voice-assistants/assistants"], ["Apps", "puzzle-outline", "/hassio/dashboard"],
    ["Updates", "update", "/config/updates"], ["Sicherungen", "backup-restore", "/config/backup"], ["Protokolle", "math-log", "/config/logs"],
    ["System", "server-outline", "/config/system"], ["Netzwerk", "lan", "/config/network"], ["Speicher", "harddisk", "/config/storage"],
    ["Hardware", "memory", "/config/hardware"], ["Reparaturen", "auto-fix", "/config/repairs"], ["Info", "information-outline", "/config/info"],
    ["Entwicklerwerkzeuge: Zustände", "hammer-wrench", "/developer-tools/state"], ["Entwicklerwerkzeuge: Aktionen", "play-box-outline", "/developer-tools/action"],
    ["Entwicklerwerkzeuge: Vorlage", "code-braces", "/developer-tools/template"], ["Entwicklerwerkzeuge: YAML", "file-code-outline", "/developer-tools/yaml"],
    ["Verlauf", "chart-box-outline", "/history"], ["Logbuch", "format-list-bulleted", "/logbook"], ["Karte", "map-outline", "/map"], ["Energie", "lightning-bolt", "/energy"],
    ["Medien", "play-box-multiple-outline", "/media-browser"], ["Profil", "account-circle-outline", "/profile"],
  ];
  const BEFEHLE = [
    ["Automationen neu laden", "robot", "automation", "reload"], ["Skripte neu laden", "script-text-outline", "script", "reload"],
    ["Szenen neu laden", "palette-outline", "scene", "reload"], ["Vorlagen-Entitäten neu laden", "code-braces", "template", "reload"],
    ["Gruppen neu laden", "google-circles-communities", "group", "reload"], ["Eigene Vorlagen neu laden", "code-braces-box", "homeassistant", "reload_custom_templates"],
    ["Kern-Konfiguration neu laden", "cog-refresh-outline", "homeassistant", "reload_core_config"], ["Alle YAML-Konfigurationen neu laden", "reload", "homeassistant", "reload_all"],
    ["Home Assistant neu starten", "restart", "homeassistant", "restart", true],
  ];
  function eintraege() {
    const l = [];
    Object.entries(PS.module).forEach(([m, d]) => {
      if (m === "ha_seite" || d.versteckt || !PS.modulDa(m)) return;
      l.push({ art: "Seite", icon: d.icon, n: d.titel, u: "Dashboard", tun: () => PS.oeffnen(m) });
    });
    HA_SEITEN.forEach(([n, icon, pfad]) => l.push({ art: "Home Assistant", icon, n, u: pfad, tun: () => PS.haOeffnen(pfad) }));
    BEFEHLE.forEach(([n, icon, domain, service, gefahr]) => l.push({ art: "Befehl", icon, n, u: `${domain}.${service}`, befehl: true, gefahr,
      tun: () => PS.dienst(domain, service, {}).then(() => PS.toast(`${n}: ausgeführt`)) }));
    PS.bereiche.forEach((b) => l.push({ art: "Bereich", icon: b.icon || "texture-box", n: b.name, u: b.id, tun: () => PS.oeffnen("raeume", b.id) }));
    Object.entries(PS.geraete || {}).forEach(([id, n]) => l.push({ art: "Gerät", icon: "devices", n, u: id, tun: () => PS.haOeffnen(`/config/devices/device/${id}`) }));
    alle().forEach((e) => {
      const d = PS.domain(e);
      if (d === "automation") {
        const id = automationId(e);
        l.push({ art: "Automation", icon: "robot", n: PS.name(e), u: e, tun: () => (id ? PS.haOeffnen(`/config/automation/edit/${id}`) : PS.mehrInfos(e)) });
      } else if (d === "script") {
        l.push({ art: "Skript", icon: "script-text-outline", n: PS.name(e), u: e, tun: () => PS.haOeffnen(`/config/script/edit/${e.split(".")[1]}`) });
      } else {
        l.push({ art: "Entität", icon: PS.iconName(e), n: PS.name(e), u: e, rechts: PS.text(e), tun: () => PS.mehrInfos(e) });
      }
    });
    return l;
  }
  const RANG = { Befehl: 0, Seite: 1, "Home Assistant": 2, Bereich: 3, Automation: 4, Skript: 5, Gerät: 6, Entität: 7 };
  function suchen(liste, q) {
    q = q.trim().toLowerCase();
    let nurBefehle = false;
    if (q.startsWith(">")) { nurBefehle = true; q = q.slice(1).trim(); }
    const teile = q.split(/\s+/).filter(Boolean);
    return liste
      .filter((x) => (!nurBefehle || x.befehl) && teile.every((t) => `${x.n} ${x.u} ${x.art}`.toLowerCase().includes(t)))
      .map((x) => ({ x, p: (teile[0] && x.n.toLowerCase().startsWith(teile[0]) ? 0 : 1) * 10 + (RANG[x.art] ?? 9) }))
      .sort((a, b) => a.p - b.p || a.x.n.localeCompare(b.x.n, "de"))
      .slice(0, q ? 60 : 30).map((y) => y.x);
  }
  let leiste = null;
  function schnellsuche(start = "") {
    if (leiste) { leiste.querySelector("input").focus(); return; }
    const liste = eintraege();
    leiste = E(`<div class="qs-grund" role="dialog" aria-modal="true" aria-label="Schnellsuche"><div class="qs">
      <div class="qs-feld">${PS.ic("magnify")}<input id="qs-eingabe" type="search" autocomplete="off" spellcheck="false" placeholder="Seiten, Entitäten, Automationen, Geräte … („>“ für Befehle)"><kbd>Esc</kbd></div>
      <div class="qs-liste" role="listbox"></div><div class="qs-fuss"><span>↑↓ wählen</span><span>Enter öffnen</span><span>&gt; Befehle</span></div></div></div>`);
    document.body.appendChild(leiste);
    const feld = leiste.querySelector("input"), box = leiste.querySelector(".qs-liste");
    let treffer = [], wahl = 0, scharf = null;
    const zu = () => { leiste.remove(); leiste = null; };
    const zeigen = () => {
      treffer = suchen(liste, feld.value); wahl = Math.min(wahl, Math.max(0, treffer.length - 1));
      box.innerHTML = treffer.length ? treffer.map((x, i) => `<div class="qs-z${i === wahl ? " an" : ""}${x === scharf ? " scharf" : ""}" role="option" data-i="${i}">${PS.ic(x.icon || "circle-small")}
        <span class="t"><b>${PS.esc(x === scharf ? `${x.n}: zum Bestätigen erneut Enter` : x.n)}</b><small>${PS.esc(x.u)}</small></span>
        ${x.rechts ? `<span class="r">${PS.esc(x.rechts)}</span>` : ""}<em>${PS.esc(x.art)}</em></div>`).join("") : '<div class="leer">Nichts gefunden.</div>';
      const an = box.querySelector(".qs-z.an"); if (an) an.scrollIntoView({ block: "nearest" });
    };
    const ausfuehren = (x) => {
      if (!x) return;
      if (x.gefahr && scharf !== x) { scharf = x; zeigen(); return; }
      zu(); x.tun();
    };
    feld.addEventListener("input", () => { wahl = 0; scharf = null; zeigen(); });
    feld.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { ev.preventDefault(); wahl = Math.min(treffer.length - 1, wahl + 1); zeigen(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); wahl = Math.max(0, wahl - 1); zeigen(); }
      else if (ev.key === "Enter") { ev.preventDefault(); ausfuehren(treffer[wahl]); }
      else if (ev.key === "Escape") { ev.preventDefault(); zu(); }
    });
    box.addEventListener("click", (ev) => { const z = ev.target.closest(".qs-z"); if (z) ausfuehren(treffer[+z.dataset.i]); });
    leiste.addEventListener("pointerdown", (ev) => { if (ev.target === leiste) zu(); });
    feld.value = start; zeigen(); setTimeout(() => feld.focus(), 0);
  }
  PS.schnellsuche = schnellsuche;
  document.addEventListener("keydown", (ev) => {
    const t = ev.target, tippt = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); schnellsuche(); return; }
    if (tippt || ev.ctrlKey || ev.metaKey || ev.altKey || leiste) return;
    if (ev.key === "c" || ev.key === "e") { ev.preventDefault(); schnellsuche(ev.key === "c" ? ">" : ""); }
  }, true);
  // Suchknopf in der Kopfzeile öffnet die Schnellsuche
  const suchKnopf = document.getElementById("ak-suche");
  if (suchKnopf) {
    const neu = suchKnopf.cloneNode(true); suchKnopf.replaceWith(neu);
    neu.querySelector("kbd").textContent = "Strg K";
    neu.addEventListener("click", () => schnellsuche());
  }

  // ------------------------------------------------------------ Automationen
  PS.module.automationen = {
    titel: "Automationen", icon: "robot",
    async render(el) {
      el.classList.add("admin-seite");
      const kopf = E(`<div class="vw-kopf"><input class="feld" id="au-suche" type="search" placeholder="Automation suchen" autocomplete="off">
        <div class="tabs vw-filter"><button data-f="alle" class="aktiv">Alle</button><button data-f="an">Aktiv</button><button data-f="aus">Deaktiviert</button></div></div>`);
      kopf.appendChild(knopf("Neue Automation", "plus", () => PS.haOeffnen("/config/automation/edit/new"), "primaer"));
      const liste = E('<div class="vw-gruppen"><div class="leer">Wird geladen …</div></div>');
      el.append(kopf, liste);
      let r = null;
      try { r = await registrierungen(true); } catch (e) { r = null; el.insertBefore(E(`<div class="leer">${PS.esc(e.message)} Kategorien und Labels fehlen daher.</div>`), liste); }
      let filter = "alle";
      const zeichnen = () => {
        const q = kopf.querySelector("input").value.trim().toLowerCase();
        const autos = alle().filter((e) => PS.domain(e) === "automation").map((e) => {
          const re = r && r.ent.get(e);
          const kat = re && re.categories && re.categories.automation && r.kat.get(re.categories.automation);
          const labels = ((re && re.labels) || []).map((l) => (r.lab.get(l) || {}).name || l);
          return { e, n: PS.name(e), kat: kat ? kat.name : "", katIcon: kat && kat.icon, labels };
        }).filter((x) => (filter === "alle" || (filter === "an") === (PS.s(x.e) === "on"))
          && (!q || `${x.n} ${x.e} ${x.kat} ${x.labels.join(" ")}`.toLowerCase().includes(q)));
        const gruppen = new Map();
        autos.sort(nameSort).forEach((x) => { const k = x.kat || "Ohne Kategorie"; if (!gruppen.has(k)) gruppen.set(k, []); gruppen.get(k).push(x); });
        const namen = [...gruppen.keys()].sort((a, b) => (a === "Ohne Kategorie") - (b === "Ohne Kategorie") || a.localeCompare(b, "de"));
        liste.innerHTML = "";
        if (!autos.length) { liste.appendChild(E('<div class="leer">Keine Automation passt.</div>')); return; }
        namen.forEach((k) => {
          const g = box(k, `${gruppen.get(k).length}`);
          gruppen.get(k).forEach((x) => g.appendChild(autoZeile(x)));
          liste.appendChild(g);
        });
      };
      const autoZeile = (x) => {
        const a = PS.a(x.e), id = a.id, an = PS.s(x.e) === "on";
        const z = E(`<div class="vw-z${an ? "" : " aus"}"><button type="button" class="vw-schalter${an ? " an" : ""}" role="switch" aria-checked="${an}" title="${an ? "Deaktivieren" : "Aktivieren"}"><i></i></button>
          <span class="t"><b>${PS.esc(x.n)}</b><small>${PS.esc([a.last_triggered ? `zuletzt ${PS.zeitRelativ(a.last_triggered)}` : "noch nie ausgelöst", a.mode].filter(Boolean).join(" · "))}</small></span>
          <span class="vw-labels">${x.labels.map((l) => `<i>${PS.esc(l)}</i>`).join("")}</span><span class="vw-akt"></span></div>`);
        z.querySelector(".vw-schalter").addEventListener("click", (ev) => { ev.stopPropagation(); PS.dienst("automation", an ? "turn_off" : "turn_on", { entity_id: x.e }); });
        const akt = z.querySelector(".vw-akt");
        akt.append(
          knopf("", "play", (ev) => { ev.stopPropagation(); PS.dienst("automation", "trigger", { entity_id: x.e }).then(() => PS.toast(`${x.n} ausgeführt`)); }, "rund"),
          knopf("", "timeline-text-outline", (ev) => { ev.stopPropagation(); if (id) PS.haOeffnen(`/config/automation/trace/${id}`); }, "rund"),
          knopf("", "pencil-outline", (ev) => { ev.stopPropagation(); if (id) PS.haOeffnen(`/config/automation/edit/${id}`); }, "rund"),
        );
        akt.children[0].title = "Jetzt ausführen"; akt.children[1].title = "Verlauf der Ausführungen"; akt.children[2].title = "Im Editor von Home Assistant bearbeiten";
        z.addEventListener("click", () => (id ? PS.haOeffnen(`/config/automation/edit/${id}`) : PS.mehrInfos(x.e)));
        return z;
      };
      kopf.querySelector("input").addEventListener("input", zeichnen);
      kopf.querySelectorAll(".vw-filter button").forEach((b) => b.addEventListener("click", () => {
        filter = b.dataset.f; kopf.querySelectorAll(".vw-filter button").forEach((x) => x.classList.toggle("aktiv", x === b)); zeichnen();
      }));
      zeichnen();
      el._neu = zeichnen;
    },
  };

  // ------------------------------------------------------------ Entitäten und Geräte
  PS.module.entitaeten = {
    titel: "Entitäten und Geräte", kurz: "Entitäten", icon: "shape-outline",
    async render(el) {
      el.classList.add("admin-seite");
      const inhalt = E("<div></div>"); el.appendChild(inhalt);
      const wahl = (k) => { inhalt.innerHTML = ""; (k === "geraete" ? geraeteListe : entitaetenListe)(inhalt); };
      PS.tabs([["entitaeten", "Entitäten"], ["geraete", "Geräte"]], "entitaeten", wahl);
      wahl("entitaeten");
    },
  };
  const bereichName = (id) => (id ? PS.bereichName(id) : "");
  async function entitaetenListe(el) {
    const kopf = E(`<div class="vw-kopf"><input class="feld" id="en-suche" type="search" placeholder="Name oder entity_id" autocomplete="off">
      <select class="feld" id="en-domain"><option value="">Alle Domänen</option></select>
      <div class="tabs vw-filter"><button data-f="alle" class="aktiv">Alle</button><button data-f="sichtbar">Sichtbar</button><button data-f="versteckt">Ausgeblendet</button><button data-f="deaktiviert">Deaktiviert</button></div></div>`);
    const tab = E('<div class="as-tabelle vw-tabelle"><table><thead><tr><th>Entität</th><th>Bereich</th><th>Status</th><th></th></tr></thead><tbody><tr><td colspan="4" class="leer">Wird geladen …</td></tr></tbody></table></div>');
    const mehr = E('<div class="leer" hidden></div>');
    el.append(kopf, tab, mehr);
    let r;
    try { r = await registrierungen(true); } catch (e) { tab.querySelector("tbody").innerHTML = `<tr><td colspan="4" class="leer">${PS.esc(e.message)}</td></tr>`; return; }
    const domains = [...new Set([...r.ent.keys()].map((e) => e.split(".")[0]))].sort();
    kopf.querySelector("select").insertAdjacentHTML("beforeend", domains.map((d) => `<option>${PS.esc(d)}</option>`).join(""));
    let filter = "alle";
    const zeichnen = () => {
      const q = kopf.querySelector("input").value.trim().toLowerCase(), dom = kopf.querySelector("select").value;
      const treffer = [...r.ent.values()].map((re) => ({ re, n: re.name || (PS.z[re.entity_id] ? PS.name(re.entity_id) : re.original_name) || re.entity_id }))
        .filter(({ re, n }) => (!dom || re.entity_id.startsWith(dom + "."))
          && (filter === "alle" || (filter === "versteckt" ? !!re.hidden_by : filter === "deaktiviert" ? !!re.disabled_by : !re.hidden_by && !re.disabled_by))
          && (!q || `${n} ${re.entity_id}`.toLowerCase().includes(q)))
        .sort(nameSort);
      const tb = tab.querySelector("tbody"); tb.innerHTML = "";
      treffer.slice(0, 300).forEach(({ re, n }) => tb.appendChild(entitaetZeile(re, n, zeichnen)));
      if (!treffer.length) tb.innerHTML = '<tr><td colspan="4" class="leer">Keine Entität passt.</td></tr>';
      mehr.hidden = treffer.length <= 300; mehr.textContent = `${treffer.length - 300} weitere; Suche eingrenzen.`;
    };
    const entitaetZeile = (re, n, neu) => {
      const eid = re.entity_id, ger = re.device_id && r.ger.get(re.device_id);
      const area = re.area_id || (ger && ger.area_id);
      const status = re.disabled_by ? `<i class="aus">deaktiviert${re.disabled_by !== "user" ? ` (${PS.esc(re.disabled_by)})` : ""}</i>` : re.hidden_by ? '<i class="vers">ausgeblendet</i>' : '<i class="ok">aktiv</i>';
      const tr = E(`<table><tr><td><span class="vw-name">${PS.ic(PS.z[eid] ? PS.iconName(eid) : "shape-outline")}<span><b>${PS.esc(n)}</b><small>${PS.esc(eid)}</small></span></span></td>
        <td>${PS.esc(bereichName(area))}</td><td class="vw-status">${status}</td><td class="vw-akt"></td></tr></table>`).querySelector("tr");
      const akt = tr.querySelector(".vw-akt");
      const versteckt = !!re.hidden_by, aus = !!re.disabled_by;
      const kv = knopf("", versteckt ? "eye-outline" : "eye-off-outline", async () => {
        await entitaetSetzen(eid, { hidden_by: versteckt ? null : "user" }, versteckt ? `${n} wieder sichtbar` : `${n} ausgeblendet`);
        re.hidden_by = versteckt ? null : "user"; neu();
      }, "rund");
      kv.title = versteckt ? "Einblenden" : "Ausblenden";
      const ka = knopf("", aus ? "power" : "power-off", async () => {
        await entitaetSetzen(eid, { disabled_by: aus ? null : "user" }, aus ? `${n} aktiviert (wirkt nach rund 30 s)` : `${n} deaktiviert`);
        re.disabled_by = aus ? null : "user"; neu();
      }, "rund" + (aus ? "" : " gefahr-leise"));
      ka.title = aus ? "Aktivieren" : "Deaktivieren";
      akt.append(kv, ka);
      if (ger) { const kg = knopf("", "devices", () => PS.haOeffnen(`/config/devices/device/${ger.id}`), "rund"); kg.title = `Gerät: ${geraetName(ger)}`; akt.appendChild(kg); }
      if (PS.z[eid]) { const ki = knopf("", "information-outline", () => PS.mehrInfos(eid), "rund"); ki.title = "Details"; akt.appendChild(ki); }
      return tr;
    };
    kopf.querySelector("input").addEventListener("input", zeichnen);
    kopf.querySelector("select").addEventListener("change", zeichnen);
    kopf.querySelectorAll(".vw-filter button").forEach((b) => b.addEventListener("click", () => {
      filter = b.dataset.f; kopf.querySelectorAll(".vw-filter button").forEach((x) => x.classList.toggle("aktiv", x === b)); zeichnen();
    }));
    zeichnen();
  }
  async function geraeteListe(el) {
    const kopf = E(`<div class="vw-kopf"><input class="feld" id="ge-suche" type="search" placeholder="Gerät, Hersteller oder Modell" autocomplete="off">
      <div class="tabs vw-filter"><button data-f="alle" class="aktiv">Alle</button><button data-f="aktiv">Aktiv</button><button data-f="deaktiviert">Deaktiviert</button></div></div>`);
    const tab = E('<div class="as-tabelle vw-tabelle"><table><thead><tr><th>Gerät</th><th>Bereich</th><th>Entitäten</th><th>Status</th><th></th></tr></thead><tbody><tr><td colspan="5" class="leer">Wird geladen …</td></tr></tbody></table></div>');
    el.append(kopf, tab);
    let r;
    try { r = await registrierungen(true); } catch (e) { tab.querySelector("tbody").innerHTML = `<tr><td colspan="5" class="leer">${PS.esc(e.message)}</td></tr>`; return; }
    const anzahl = new Map();
    r.ent.forEach((re) => { if (re.device_id) anzahl.set(re.device_id, (anzahl.get(re.device_id) || 0) + 1); });
    let filter = "alle";
    const zeichnen = () => {
      const q = kopf.querySelector("input").value.trim().toLowerCase();
      const treffer = [...r.ger.values()].filter((d) => d.entry_type !== "service" || anzahl.get(d.id))
        .map((d) => ({ d, n: geraetName(d) }))
        .filter(({ d, n }) => (filter === "alle" || (filter === "deaktiviert") === !!d.disabled_by)
          && (!q || `${n} ${d.manufacturer || ""} ${d.model || ""}`.toLowerCase().includes(q)))
        .sort(nameSort);
      const tb = tab.querySelector("tbody"); tb.innerHTML = "";
      treffer.slice(0, 300).forEach(({ d, n }) => {
        const aus = !!d.disabled_by;
        const tr = E(`<table><tr><td><span class="vw-name">${PS.ic("devices")}<span><b>${PS.esc(n)}</b><small>${PS.esc([d.manufacturer, d.model].filter(Boolean).join(" · "))}</small></span></span></td>
          <td>${PS.esc(bereichName(d.area_id))}</td><td class="tabular">${anzahl.get(d.id) || 0}</td>
          <td class="vw-status">${aus ? `<i class="aus">deaktiviert${d.disabled_by !== "user" ? ` (${PS.esc(d.disabled_by)})` : ""}</i>` : '<i class="ok">aktiv</i>'}</td><td class="vw-akt"></td></tr></table>`).querySelector("tr");
        const ka = knopf("", aus ? "power" : "power-off", async () => {
          await geraetSetzen(d.id, { disabled_by: aus ? null : "user" }, aus ? `${n} aktiviert` : `${n} deaktiviert`);
          d.disabled_by = aus ? null : "user"; zeichnen();
        }, "rund" + (aus ? "" : " gefahr-leise"));
        ka.title = aus ? "Aktivieren" : "Deaktivieren";
        const ko = knopf("", "open-in-app", () => PS.haOeffnen(`/config/devices/device/${d.id}`), "rund"); ko.title = "In Home Assistant öffnen";
        tr.querySelector(".vw-akt").append(ka, ko);
        tr.addEventListener("click", (ev) => { if (!ev.target.closest(".vw-akt")) PS.haOeffnen(`/config/devices/device/${d.id}`); });
        tb.appendChild(tr);
      });
      if (!treffer.length) tb.innerHTML = '<tr><td colspan="5" class="leer">Kein Gerät passt.</td></tr>';
    };
    kopf.querySelector("input").addEventListener("input", zeichnen);
    kopf.querySelectorAll(".vw-filter button").forEach((b) => b.addEventListener("click", () => {
      filter = b.dataset.f; kopf.querySelectorAll(".vw-filter button").forEach((x) => x.classList.toggle("aktiv", x === b)); zeichnen();
    }));
    zeichnen();
  }

  // Automationen-Seite live nachführen (Zustand und letzte Auslösung)
  let auTimer = null;
  PS.on("diff", (ids) => {
    const el = document.querySelector("#sheet-inhalt");
    if (!el || !el._neu || auTimer || ![...ids].some((e) => e.startsWith("automation."))) return;
    if (el.contains(document.activeElement) && document.activeElement.tagName === "INPUT") { /* Suchfeld behält den Fokus */ }
    auTimer = setTimeout(() => { auTimer = null; if (el._neu && el.querySelector(".vw-gruppen")) el._neu(); }, 1000);
  });
  PS.on("seite", () => { const el = document.querySelector("#sheet-inhalt"); if (el) el._neu = null; });

  // ------------------------------------------------------------ Verwaltung im Entitäten-Dialog
  PS.on("dialog_entitaet", ({ eid, dlg }) => {
    queueMicrotask(() => {
      if (!dlg.isConnected || dlg.querySelector(".vw-dialog")) return;
      const r = PS.reg[eid] || {}, d = PS.domain(eid);
      const leiste = E('<div class="vw-dialog"><small>Verwaltung</small><div class="reihe"></div></div>');
      const reihe = leiste.querySelector(".reihe");
      if (d === "automation" && PS.a(eid).id) {
        reihe.append(knopf("Bearbeiten", "pencil-outline", () => { PS.dialogSchliessen(); PS.haOeffnen(`/config/automation/edit/${PS.a(eid).id}`); }),
          knopf("Verlauf", "timeline-text-outline", () => { PS.dialogSchliessen(); PS.haOeffnen(`/config/automation/trace/${PS.a(eid).id}`); }));
      }
      if (d === "script") reihe.append(knopf("Bearbeiten", "pencil-outline", () => { PS.dialogSchliessen(); PS.haOeffnen(`/config/script/edit/${eid.split(".")[1]}`); }));
      if (r.d) reihe.append(knopf("Gerät", "devices", () => { PS.dialogSchliessen(); PS.haOeffnen(`/config/devices/device/${r.d}`); }));
      reihe.append(
        knopf(r.h ? "Einblenden" : "Ausblenden", r.h ? "eye-outline" : "eye-off-outline", () => entitaetSetzen(eid, { hidden_by: r.h ? null : "user" }, r.h ? "Wieder sichtbar" : "Ausgeblendet").then(() => PS.dialogSchliessen()).catch(() => {})),
        knopf("Deaktivieren", "power-off", () => entitaetSetzen(eid, { disabled_by: "user" }, "Deaktiviert").then(() => PS.dialogSchliessen()).catch(() => {}), "gefahr-leise"),
        knopf("Verlauf", "chart-box-outline", () => { PS.dialogSchliessen(); PS.haOeffnen(`/history?entity_id=${encodeURIComponent(eid)}`); }),
      );
      dlg.appendChild(leiste);
    });
  });

  // In die Modulleiste nach „System“
  const i = PS.admin.module.indexOf("system");
  PS.admin.module.splice(i + 1, 0, "automationen", "entitaeten");
})();
