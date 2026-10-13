/* PM Panel Studio – Telefon: Modul (Favoriten, Kontakte, Tastatur, Verlauf), Anrufkarte und WebRTC-Audio.
 * Der Server meldet den Zustand als {typ:"telefon", aktiv, registriert, fehler, anruf}; das Panel fordert Aktionen über
 * PS.anfrage (telefon_*) an. Signalisierung ohne Trickle: Das Angebot (SDP) geht erst nach dem ICE-Sammeln raus.
 * Die Karte liegt über allem außer Hinweisen; minimiert zieht sie in die Live-Kapsel (live.js, PS.telefonKapsel). */
(function () {
  "use strict";
  const PS = window.PS;
  const E = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const body = document.body;

  // ------------------------------------------------------------ Helfer
  const FARBEN = ["#784295", "#5b4aa6", "#443171", "#8a5aa8", "#4d6fb5", "#9b4f86"];
  const initialen = (name, nummer) => {
    const w = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "";
    const z = (s) => (s.match(/[A-Za-zÄÖÜäöüß0-9]/) || [""])[0].toUpperCase();
    return w.length === 1 ? z(w[0]) : z(w[0]) + z(w[w.length - 1]);
  };
  const farbe = (s) => { let h = 0; for (const c of String(s || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return FARBEN[h % FARBEN.length]; };
  const avatar = (name, nummer, klasse = "") => {
    const i = initialen(name);
    return `<span class="tel-av ${klasse}" style="--av:${farbe(name || nummer)}">${i ? PS.esc(i) : PS.ic("account")}</span>`;
  };
  const z2 = (n) => String(n).padStart(2, "0");
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); return s >= 3600 ? `${Math.floor(s / 3600)}:${z2(Math.floor(s % 3600 / 60))}:${z2(s % 60)}` : `${z2(Math.floor(s / 60))}:${z2(s % 60)}`; };
  // Zeitangaben vom Server: Unix-Sekunden, Millisekunden oder ISO-Text
  const zeitms = (v) => {
    if (v == null || v === "") return NaN;
    if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v))) { const n = Number(v); return n > 1e11 ? n : n * 1000; }
    return Date.parse(v);
  };
  const zeitText = (v) => {
    const t = zeitms(v); if (!isFinite(t)) return "";
    const d = new Date(t), h = new Date(), uhr = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const tag = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((tag(h) - tag(d)) / 864e5);
    if (diff === 0) return `Heute, ${uhr}`;
    if (diff === 1) return `Gestern, ${uhr}`;
    return `${z2(d.getDate())}.${z2(d.getMonth() + 1)}., ${uhr}`;
  };
  const bereinigen = (n) => String(n || "").replace(/[^\d+*#]/g, "");
  const sicher = () => window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  const st = () => PS.telefon || { aktiv: false };

  // ------------------------------------------------------------ Anfragen (Demo: nur Oberfläche)
  let demo = false;
  const DEMO_KONTAKTE = [
    { name: "Anna Becker", nummern: [{ nummer: "+49 171 2345678", typ: "Mobil" }, { nummer: "+49 30 1234567", typ: "Arbeit" }] },
    { name: "Bernd Schulz", nummern: [{ nummer: "+49 151 9876543", typ: "Mobil" }] },
    { name: "Clara Hoffmann", nummern: [{ nummer: "+49 40 5550123", typ: "Privat" }] },
    { name: "Dr. Meier Praxis", nummern: [{ nummer: "+49 30 7654321", typ: "Arbeit" }] },
    { name: "Maria Mustermann", nummern: [{ nummer: "+49 171 1234567", typ: "Mobil" }] },
    { name: "Paul Wagner", nummern: [{ nummer: "+49 160 1112223", typ: "Mobil" }] },
  ];
  const DEMO_VERLAUF = [
    { richtung: "verpasst", nummer: "+49 171 1234567", name: "Maria Mustermann", zeit: Date.now() / 1000 - 1800, dauer_s: 0 },
    { richtung: "ein", nummer: "+49 151 9876543", name: "Bernd Schulz", zeit: Date.now() / 1000 - 7200, dauer_s: 312 },
    { richtung: "aus", nummer: "+49 30 7654321", name: "Dr. Meier Praxis", zeit: Date.now() / 1000 - 90000, dauer_s: 74 },
    { richtung: "verpasst", nummer: "+49 89 998877", name: "", zeit: Date.now() / 1000 - 200000, dauer_s: 0 },
  ];
  function anf(msg) {
    if (!demo) return PS.anfrage(msg);
    if (msg.typ === "telefon_kontakte") return Promise.resolve(DEMO_KONTAKTE);
    if (msg.typ === "telefon_verlauf") return Promise.resolve(DEMO_VERLAUF);
    if (msg.typ === "telefon_annehmen") setTimeout(() => PS.telefonDemo("verbunden"), 300);
    if (msg.typ === "telefon_auflegen" || msg.typ === "telefon_ablehnen") setTimeout(() => PS.telefonDemo("beendet"), 200);
    return Promise.resolve(null);
  }

  // ------------------------------------------------------------ Zustand der laufenden Karte
  let lokal = null;          // {id, a, minimiert, dtmf, stumm, annehmen, laeuft, abbruch, verbundenAb, dauer, beendet}
  let endeTimer = null, tickTimer = null, sig = "";
  let intercomStumm = false;

  const aktuell = () => (lokal && lokal.a) || null;
  const stummAnzeige = () => !!(lokal && lokal.stumm) || intercomStumm;

  // ------------------------------------------------------------ Ton über den Panel-WebSocket
  // Mikrofon → AudioWorklet (8 kHz, Int16, 160 Samples je 20 ms) → binäre WS-Nachrichten; Gegenrichtung genauso.
  // Kein WebRTC: Die App läuft im Docker-Netz, ICE-Kandidaten wären für das Panel unerreichbar.
  let ton = null;  // {strom, quelle, mikN, wgN, stumm0, hoerer}
  function medienAufraeumen() {
    const t = ton; ton = null;
    if (!t) return;
    t.aus = true;
    try { t.mikN.port.onmessage = null; t.mikN.disconnect(); } catch { /* getrennt */ }
    try { t.wgN.disconnect(); } catch { /* getrennt */ }
    try { t.quelle.disconnect(); } catch { /* getrennt */ }
    try { t.null.disconnect(); } catch { /* getrennt */ }
    t.strom.getTracks().forEach((x) => x.stop());
    PS.off("telefon_ton", t.hoerer);
  }
  function micSetzen() { if (ton) { ton.strom.getAudioTracks().forEach((t) => { t.enabled = !stummAnzeige(); }); ton.mikN.port.postMessage({ stumm: stummAnzeige() }); } }
  // Mikrofon öffnen, Worklets starten. Wirft bei gesperrtem Mikrofon.
  async function tonStarten() {
    if (ton) return;
    if (!sicher()) { PS.toast("Mikrofon gesperrt: Panel-Adresse in Chromium als sicher freigeben (siehe Dokumentation)", true); throw new Error("mikrofon"); }
    const ctx = PS.audio && PS.audio.kontext && PS.audio.kontext();
    if (!ctx || !ctx.audioWorklet) { PS.toast("Telefon: Web Audio nicht verfügbar", true); throw new Error("mikrofon"); }
    let strom;
    try {
      strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) { PS.toast("Mikrofon gesperrt: " + (e && e.message ? e.message : e), true); throw e; }
    try {
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      await ctx.audioWorklet.addModule("static/telefon-ton.js");
      const quelle = ctx.createMediaStreamSource(strom);
      const mikN = new AudioWorkletNode(ctx, "tel-mikrofon", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const wgN = new AudioWorkletNode(ctx, "tel-wiedergabe", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      const nullPegel = ctx.createGain(); nullPegel.gain.value = 0;  // hält das Mikrofon-Worklet am Laufen, ohne Mithören
      quelle.connect(mikN).connect(nullPegel).connect(ctx.destination);
      const aus = PS.audio.ausgang("telefon") || ctx.destination;
      wgN.connect(aus);
      const t = { strom, quelle, mikN, wgN, null: nullPegel, aus: false, gesendet: 0, empfangen: 0 };
      t.hoerer = (buf) => { if (!t.aus && buf && buf.byteLength === 320) { t.empfangen++; wgN.port.postMessage(buf, [buf]); } };
      mikN.port.onmessage = (e) => { if (!t.aus && !stummAnzeige() && PS.sendeBinaer(e.data)) t.gesendet++; };
      PS.on("telefon_ton", t.hoerer);
      ton = t; micSetzen();
      PS.telefonTonStand = () => (ton ? { gesendet: ton.gesendet, empfangen: ton.empfangen } : null);
    } catch (e) {
      strom.getTracks().forEach((x) => x.stop());
      PS.toast("Telefon: Ton konnte nicht gestartet werden (" + (e && e.message ? e.message : e) + ")", true);
      throw e;
    }
  }

  // ------------------------------------------------------------ Aktionen
  function neuerLokal(id) {
    lokal = { id, a: null, minimiert: body.classList.contains("ereignis-an"), dtmf: false, ziffern: "", stumm: false, annehmen: false, laeuft: false, abbruch: false, verbundenAb: null, dauer: 0, beendet: false };
    sig = "";
  }
  function waehlen(nummer, name) {
    nummer = bereinigen(nummer);
    if (!nummer) return;
    if (lokal && !lokal.beendet) { PS.toast("Es läuft bereits ein Anruf", true); PS.telefonZeigen(); return; }
    if (!st().aktiv && !demo) { PS.toast("Telefon ist nicht aktiv", true); return; }
    clearTimeout(endeTimer); endeTimer = null;
    neuerLokal(null);
    lokal.laeuft = true;
    lokal.a = { id: null, richtung: "aus", nummer, name: name || "", zustand: "waehlt", seit: Date.now() / 1000 };
    zeichnen();
    (async () => {
      try {
        if (demo) { setTimeout(() => PS.telefonDemo("waehlt"), 150); setTimeout(() => PS.telefonDemo("verbunden"), 2500); lokal.laeuft = false; return; }
        await tonStarten();
        const r = await PS.anfrage({ typ: "telefon_waehlen", nummer });
        const l = lokal;
        if (!l) return;
        l.laeuft = false;
        if (r && r.anruf) { if (l.id == null) l.id = r.anruf.id; l.a = { ...l.a, ...r.anruf }; }
        if (l.abbruch) auflegen();
        zeichnen();
      } catch (e) {
        if (lokal && lokal.id == null) abschliessen(true);
        if (e && e.message !== "mikrofon" && e.name !== "NotAllowedError") PS.toast("Anruf fehlgeschlagen: " + (e && e.message ? e.message : e), true);
      }
    })();
  }
  async function annehmen() {
    const l = lokal, a = aktuell();
    if (!l || !a || l.annehmen) return;
    klingelnStopp();
    l.annehmen = true; zeichnen();
    try {
      if (demo) return void anf({ typ: "telefon_annehmen" });
      await tonStarten();
      await PS.anfrage({ typ: "telefon_annehmen", anruf: a.id });
    } catch (e) {
      l.annehmen = false;
      PS.anfrage({ typ: "telefon_ablehnen", anruf: a.id }).catch(() => {});
      medienAufraeumen();
      if (e && e.message !== "mikrofon" && e.name !== "NotAllowedError") PS.toast("Anruf annehmen fehlgeschlagen: " + (e && e.message ? e.message : e), true);
      zeichnen();
    }
  }
  function ablehnen() {
    const a = aktuell(); if (!a) return;
    klingelnStopp();
    anf({ typ: "telefon_ablehnen", anruf: a.id }).catch((e) => PS.toast("Ablehnen: " + e.message, true));
  }
  function auflegen() {
    const l = lokal, a = aktuell(); if (!l || !a) return;
    klingelnStopp();
    if (l.id == null) { l.abbruch = true; l.hinweis = "Beende …"; zeichnen(); return; }  // Wählen läuft noch: nach der Antwort auflegen
    l.hinweis = "Beende …"; zeichnen();
    medienAufraeumen();
    anf({ typ: "telefon_auflegen", anruf: a.id }).catch((e) => PS.toast("Auflegen: " + e.message, true));
    // Meldet der Server das Ende nicht, die Karte trotzdem schließen
    setTimeout(() => { if (lokal === l && !l.beendet) abschliessen(true); }, 4000);
  }
  function stummSetzen(an) {
    if (!lokal) return;
    lokal.stumm = an; micSetzen(); zeichnen();
    const a = aktuell(); if (a && a.id != null) anf({ typ: "telefon_stumm", anruf: a.id, an }).catch(() => {});
  }
  function dtmf(z) {
    const a = aktuell(); if (!a || a.id == null || !lokal) return;
    lokal.ziffern = (lokal.ziffern + z).slice(-18);
    const d = karte().querySelector(".tel-ziffern"); if (d) d.textContent = lokal.ziffern;
    anf({ typ: "telefon_dtmf", anruf: a.id, ziffern: z }).catch(() => {});
  }
  function minimieren(an) { if (!lokal) return; lokal.minimiert = an; zeichnen(); PS.emit("telefon-ui"); }

  // ------------------------------------------------------------ Server-Zustand
  function wecken() {
    body.classList.remove("ruhe");
    try { window.dispatchEvent(new Event("pointerdown")); } catch { /* optional */ }  // meldet dem Server „berührt“ und weckt das Panel
  }
  function verarbeiten(m) {
    const a = m && m.anruf || null;
    if (a) {
      if (lokal && lokal.id != null && lokal.id !== a.id) { medienAufraeumen(); klingelnStopp(); lokal = null; }
      if (!lokal) {
        clearTimeout(endeTimer); endeTimer = null;
        neuerLokal(a.id);
        if (a.richtung === "ein" && a.zustand === "klingelt") wecken();
      }
      if (lokal.id == null) lokal.id = a.id;
      clearTimeout(endeTimer); endeTimer = null;
      lokal.a = { ...lokal.a, ...a };
      if ((a.zustand === "verbunden" || (a.zustand === "beendet" && isFinite(zeitms(a.verbunden_seit)))) && !lokal.verbundenAb) {
        const t = zeitms(a.verbunden_seit), jetzt = Date.now();
        lokal.verbundenAb = isFinite(t) && t <= jetzt + 5000 && jetzt - t < 864e5 ? Math.min(t, jetzt) : jetzt;
        lokal.annehmen = false;
      }
      if (a.zustand === "beendet") beendet(a); else lokal.beendet = false;
    } else if (lokal && !lokal.beendet && !lokal.laeuft) {
      beendet(lokal.a);
    }
    zeichnen();
    PS.emit("telefon-ui");
  }
  function beendet(a) {
    if (!lokal || lokal.beendet) return;
    lokal.beendet = true;
    lokal.dauer = lokal.verbundenAb ? (Date.now() - lokal.verbundenAb) / 1000 : 0;
    lokal.grund = (a && a.grund) || "";
    klingelnStopp(); medienAufraeumen(); intercomFreigeben();
    clearTimeout(endeTimer);
    endeTimer = setTimeout(() => abschliessen(), 2000);
  }
  function abschliessen(sofort) {
    clearTimeout(endeTimer); endeTimer = null;
    klingelnStopp(); medienAufraeumen(); intercomFreigeben();
    lokal = null; sig = "";
    zeichnen(); PS.emit("telefon-ui");
  }
  PS.on("telefon", verarbeiten);

  // ------------------------------------------------------------ Klingelton
  // Eigenes weiches Zweiklang-Muster („ti-ta ti-ta“), bewusst anders als das Ding-Dong der Haustür. Läuft über die
  // gemeinsame Tonkette (Art „klingel“), sonst über einen eigenen Kontext.
  let kl = { timer: null, pegel: null, an: false }, eigenerKontext = null;
  function klingelSpielen() {
    const aus = PS.audio && PS.audio.ausgang && PS.audio.ausgang("klingel");
    let c = aus && aus.context;
    if (!c) { try { eigenerKontext = eigenerKontext || new (window.AudioContext || window.webkitAudioContext)(); c = eigenerKontext; } catch { return; } }
    (c.state === "running" ? Promise.resolve() : c.resume()).then(() => {
      if (!kl.an || c.state !== "running") return;
      const pegel = c.createGain(); pegel.gain.value = 1; pegel.connect(aus || c.destination);
      const laut = (aus ? 0.3 : 0.5) * Math.max(0.2, Math.min(1, (PS.einst.klingel_lautstaerke ?? 100) / 100));
      const t0 = c.currentTime + 0.05;
      [[880, 0], [1174.7, 0.2], [880, 0.6], [1174.7, 0.8]].forEach(([hz, ab]) => {
        [[hz, 1], [hz * 2, 0.18]].forEach(([f, anteil]) => {
          const o = c.createOscillator(), g = c.createGain();
          o.type = "sine"; o.frequency.value = f;
          g.gain.setValueAtTime(0, t0 + ab);
          g.gain.linearRampToValueAtTime(laut * anteil, t0 + ab + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + ab + 0.32);
          o.connect(g).connect(pegel); o.start(t0 + ab); o.stop(t0 + ab + 0.36);
        });
      });
      const alt = kl.pegel; kl.pegel = pegel;
      if (alt) setTimeout(() => { try { alt.disconnect(); } catch { /* getrennt */ } }, 100);
    }).catch(() => {});
  }
  function klingelnStart() {
    if (kl.an || PS.einst.ton_klingel === false) return;
    kl.an = true; klingelSpielen();
    kl.timer = setInterval(klingelSpielen, 3200);
  }
  function klingelnStopp() {
    kl.an = false; clearInterval(kl.timer); kl.timer = null;
    const p = kl.pegel; kl.pegel = null;
    if (!p) return;
    try { const t = p.context.currentTime; p.gain.cancelScheduledValues(t); p.gain.setTargetAtTime(0, t, 0.02); } catch { /* Kontext zu */ }
    setTimeout(() => { try { p.disconnect(); } catch { /* getrennt */ } }, 300);
  }

  // ------------------------------------------------------------ Anrufkarte
  let kEl = null;
  function karte() {
    if (kEl) return kEl;
    kEl = E(`<div class="tel-karte" id="tel-karte" aria-live="assertive" aria-hidden="true"><div class="tel-box"></div></div>`);
    body.appendChild(kEl);
    kEl.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-akt]"); if (!b || b.disabled) return;
      const akt = b.dataset.akt;
      if (akt === "annehmen") annehmen();
      else if (akt === "ablehnen") ablehnen();
      else if (akt === "auflegen") auflegen();
      else if (akt === "mini") minimieren(true);
      else if (akt === "stumm") stummSetzen(!(lokal && lokal.stumm));
      else if (akt === "tastatur") { lokal.dtmf = !lokal.dtmf; zeichnen(); }
      else if (akt === "ziffer") dtmf(b.dataset.z);
    });
    return kEl;
  }
  const TASTEN = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]];
  const knopfHTML = (akt, icon, text, klasse = "", an = false, aus = false) =>
    `<button class="tel-k ${klasse}${an ? " an" : ""}" data-akt="${akt}"${aus ? " disabled" : ""} aria-label="${PS.esc(text)}"><span class="tel-k-ic">${PS.ic(icon)}</span><span class="tel-k-t">${PS.esc(text)}</span></button>`;

  function statusText() {
    const l = lokal, a = aktuell();
    if (!l || !a) return "";
    if (l.beendet) return "Beendet" + (l.dauer >= 1 ? ` · ${mmss(l.dauer)}` : "");
    if (l.hinweis) return l.hinweis;
    if (a.zustand === "verbunden") return l.verbundenAb ? mmss((Date.now() - l.verbundenAb) / 1000) : "00:00";
    if (a.zustand === "waehlt") return "Wählt …";
    if (a.richtung === "ein") return l.annehmen ? "Verbindet …" : "Eingehender Anruf";
    return "Klingelt …";
  }
  function zeichnen() {
    const l = lokal, a = aktuell();
    body.classList.toggle("tel-an", !!l);
    body.classList.toggle("tel-mini", !!(l && l.minimiert));
    if (!l || !a) { if (kEl) { kEl.setAttribute("aria-hidden", "true"); } klingelnStopp(); stopTick(); return; }
    const k = karte();
    k.setAttribute("aria-hidden", l.minimiert ? "true" : "false");
    const ring = a.richtung === "ein" && a.zustand === "klingelt" && !l.annehmen && !l.beendet;
    if (ring && !body.classList.contains("gespraech")) klingelnStart(); else klingelnStopp();
    const verb = a.zustand === "verbunden" && !l.beendet;
    const neu = [a.id, a.zustand, a.richtung, a.name, a.nummer, l.dtmf, l.annehmen, l.beendet, l.hinweis || "", stummAnzeige(), l.grund || ""].join("|");
    if (neu !== sig) {
      sig = neu;
      const name = a.name || a.nummer || "Unbekannt";
      let akt = "";
      if (l.beendet) akt = "";
      else if (ring || (a.richtung === "ein" && l.annehmen && !verb)) akt = knopfHTML("ablehnen", "phone-hangup", "Ablehnen", "rot", false, l.annehmen) + knopfHTML("mini", "arrow-collapse", "Minimieren") + knopfHTML("annehmen", "phone", "Annehmen", "gruen puls", false, l.annehmen);
      else if (verb) akt = knopfHTML("stumm", stummAnzeige() ? "microphone-off" : "microphone", "Stumm", "", stummAnzeige()) + knopfHTML("tastatur", "dialpad", "Tastatur", "", l.dtmf) + knopfHTML("mini", "arrow-collapse", "Minimieren") + knopfHTML("auflegen", "phone-hangup", "Auflegen", "rot");
      else akt = knopfHTML("mini", "arrow-collapse", "Minimieren") + knopfHTML("auflegen", "phone-hangup", "Auflegen", "rot", false, !!l.hinweis);
      const pad = verb && l.dtmf
        ? `<div class="tel-dtmf"><div class="tel-ziffern tabular">${PS.esc(l.ziffern)}</div><div class="tel-pad">${TASTEN.map(([z, s]) => `<button class="tel-t" data-akt="ziffer" data-z="${z}"><b>${z}</b></button>`).join("")}</div></div>` : "";
      const grund = l.beendet && l.grund ? `<div class="tel-grund">${PS.esc(l.grund)}</div>` : "";
      k.querySelector(".tel-box").className = "tel-box" + (ring ? " klingelt" : "") + (verb ? " verbunden" : "") + (l.beendet ? " beendet" : "") + (l.dtmf && verb ? " mit-pad" : "");
      k.querySelector(".tel-box").innerHTML =
        `<div class="tel-kopf"><span class="tel-art">${PS.ic(a.richtung === "ein" ? "phone-incoming" : "phone-outgoing")}${a.richtung === "ein" ? "Eingehend" : "Ausgehend"}</span></div>` +
        `<div class="tel-mitte"><div class="tel-avatar">${avatar(a.name, a.nummer, "gross")}<i class="tel-puls"></i></div>` +
        `<h2 class="tel-name">${PS.esc(name)}</h2>` +
        (a.name && a.nummer ? `<div class="tel-nummer tabular">${PS.esc(a.nummer)}</div>` : "") +
        `<div class="tel-zustand tabular">${PS.esc(statusText())}</div>${grund}</div>${pad}` +
        `<div class="tel-akt">${akt}</div>`;
    } else {
      const z = k.querySelector(".tel-zustand"), t = statusText();
      if (z && z.textContent !== t) z.textContent = t;
    }
    startTick();
  }
  function startTick() { if (!tickTimer) tickTimer = setInterval(() => { if (lokal) { zeichnen(); PS.emit("telefon-ui"); } else stopTick(); }, 500); }
  function stopTick() { clearInterval(tickTimer); tickTimer = null; }

  // Für die Live-Kapsel (live.js): Zeile für einen minimierten Anruf
  PS.telefonKapsel = () => {
    const l = lokal, a = aktuell();
    if (!l || !a || !l.minimiert) return null;
    const verb = a.zustand === "verbunden" && !l.beendet;
    return { name: a.name || a.nummer || "Unbekannt", zeit: verb || l.beendet || l.hinweis ? statusText() : (a.richtung === "ein" ? "Klingelt" : "Wählt …"), verbunden: verb, klingelt: a.richtung === "ein" && a.zustand === "klingelt" };
  };
  PS.telefonZeigen = () => { if (lokal) { lokal.minimiert = false; zeichnen(); PS.emit("telefon-ui"); } };
  PS.telefonWaehlen = waehlen;

  // ------------------------------------------------------------ Konflikte mit dem Türüberlagerung / Gegensprechen
  // Türklingel-Overlay: laufender Anruf geht in die Kapsel. Gegensprechen (body.gespraech): Telefon-Mikrofon stumm,
  // danach wiederherstellen. intercom.js bleibt unberührt, wir beobachten nur die Klassen am body.
  let warTuer = body.classList.contains("ereignis-an"), warGespraech = body.classList.contains("gespraech");
  function intercomFreigeben() { if (!intercomStumm) return; intercomStumm = false; micSetzen(); const a = aktuell(); if (lokal && !lokal.stumm && a && a.id != null && !lokal.beendet) anf({ typ: "telefon_stumm", anruf: a.id, an: false }).catch(() => {}); }
  new MutationObserver(() => {
    const tuer = body.classList.contains("ereignis-an"), sprech = body.classList.contains("gespraech");
    if (tuer && !warTuer && lokal && !lokal.beendet) minimieren(true);
    if (sprech !== warGespraech) {
      const a = aktuell();
      if (sprech && lokal && !lokal.beendet && a && a.zustand === "verbunden") {
        intercomStumm = true; micSetzen(); zeichnen();
        if (!lokal.stumm && a.id != null) anf({ typ: "telefon_stumm", anruf: a.id, an: true }).catch(() => {});
      } else if (!sprech && intercomStumm) { intercomFreigeben(); zeichnen(); }
      else zeichnen();  // Klingelton pausiert/setzt fort
    }
    warTuer = tuer; warGespraech = sprech;
  }).observe(body, { attributes: true, attributeFilter: ["class"] });
  addEventListener("pagehide", () => { medienAufraeumen(); });

  // ------------------------------------------------------------ Modul
  let tab = "favoriten", kontakte = null, kontakteFehler = "";
  const ladeKontakte = () => anf({ typ: "telefon_kontakte" }).then((r) => { kontakte = Array.isArray(r) ? r : []; kontakteFehler = ""; }).catch((e) => { kontakte = []; kontakteFehler = e.message; });

  function favoriten(box) {
    const f = (PS.einst.telefon_favoriten || []).filter((x) => x && x.nummer);
    if (!f.length) { box.innerHTML = '<div class="leer">Noch keine Favoriten. Favoriten werden im Editor festgelegt.</div>'; return; }
    box.innerHTML = `<div class="tel-favoriten">${f.map((x, i) => `<button class="tel-fav" data-i="${i}">${avatar(x.name, x.nummer, "fav")}<b>${PS.esc(x.name || x.nummer)}</b>${x.name ? `<small class="tabular">${PS.esc(x.nummer)}</small>` : ""}</button>`).join("")}</div>`;
    box.querySelectorAll(".tel-fav").forEach((b) => b.addEventListener("click", () => { const x = f[Number(b.dataset.i)]; waehlen(x.nummer, x.name); }));
  }

  function kontakteTab(box) {
    box.innerHTML = `<div class="tel-suchzeile">${PS.ic("magnify")}<input class="tel-suche" type="search" placeholder="Kontakt suchen" autocomplete="off"></div><div class="tel-liste-box"><div class="tel-liste"></div><div class="tel-schiene"></div></div>`;
    const liste = box.querySelector(".tel-liste"), schiene = box.querySelector(".tel-schiene"), feld = box.querySelector(".tel-suche");
    const aus = () => {
      if (kontakte == null) { liste.innerHTML = '<div class="leer">Lade Kontakte …</div>'; schiene.innerHTML = ""; return; }
      const q = feld.value.trim().toLowerCase(), qz = bereinigen(q);
      const treffer = kontakte.filter((k) => !q || String(k.name).toLowerCase().includes(q) || (qz && (k.nummern || []).some((n) => bereinigen(n.nummer).includes(qz))))
        .sort((x, y) => String(x.name).localeCompare(String(y.name), "de"));
      if (!treffer.length) { liste.innerHTML = `<div class="leer">${kontakteFehler ? "Kontakte nicht verfügbar: " + PS.esc(kontakteFehler) : "Keine Kontakte gefunden."}</div>`; schiene.innerHTML = ""; return; }
      const buchstaben = []; let html = "", akt = "";
      treffer.forEach((k, i) => {
        const b = (String(k.name).trim()[0] || "#").toUpperCase(), bb = /[A-ZÄÖÜ]/.test(b) ? b.replace("Ä", "A").replace("Ö", "O").replace("Ü", "U") : "#";
        if (bb !== akt) { akt = bb; buchstaben.push(bb); html += `<div class="tel-abc" data-b="${bb}">${bb}</div>`; }
        const n = k.nummern || [];
        html += `<div class="tel-kontakt" data-i="${i}"><button class="tel-zeile">${avatar(k.name, "", "klein")}<span class="tel-zt"><b>${PS.esc(k.name)}</b><small class="tabular">${n.length > 1 ? `${n.length} Nummern` : PS.esc((n[0] && n[0].nummer) || "")}</small></span>${PS.ic(n.length > 1 ? "chevron-down" : "phone")}</button><div class="tel-nummern" hidden>${n.map((x, j) => `<button class="knopf tel-nr" data-j="${j}">${PS.ic("phone")}<span>${PS.esc(x.typ || "Nummer")}</span><span class="tabular">${PS.esc(x.nummer)}</span></button>`).join("")}</div></div>`;
      });
      liste.innerHTML = html;
      schiene.innerHTML = buchstaben.map((b) => `<button data-b="${b}">${b}</button>`).join("");
      schiene.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const z = liste.querySelector(`.tel-abc[data-b="${b.dataset.b}"]`); if (z) z.scrollIntoView({ block: "start", behavior: "smooth" }); }));
      liste.querySelectorAll(".tel-kontakt").forEach((el) => {
        const k = treffer[Number(el.dataset.i)], n = k.nummern || [];
        el.querySelector(".tel-zeile").addEventListener("click", () => {
          if (n.length === 1) return waehlen(n[0].nummer, k.name);
          if (!n.length) return;
          const p = el.querySelector(".tel-nummern"); const offen = p.hidden;
          liste.querySelectorAll(".tel-nummern").forEach((x) => { x.hidden = true; x.parentElement.classList.remove("offen"); });
          p.hidden = !offen; el.classList.toggle("offen", offen);
        });
        el.querySelectorAll(".tel-nr").forEach((b) => b.addEventListener("click", () => waehlen(n[Number(b.dataset.j)].nummer, k.name)));
      });
    };
    feld.addEventListener("input", aus);
    aus();
    if (kontakte == null) ladeKontakte().then(() => { if (box.isConnected) aus(); });
  }

  function tastatur(box) {
    let nr = "", lang = null, langGeschehen = false;
    box.innerHTML = `<div class="tel-tastatur"><div class="tel-anzeige"><span class="tel-nr-anz tabular" aria-live="polite"></span><button class="tel-loeschen" aria-label="Löschen">${PS.ic("backspace-outline")}</button></div>` +
      `<div class="tel-pad">${TASTEN.map(([z, s]) => `<button class="tel-t" data-z="${z}"><b>${z}</b><small>${s}</small></button>`).join("")}</div>` +
      `<button class="tel-anruf" aria-label="Anrufen">${PS.ic("phone")}</button></div>`;
    const anz = box.querySelector(".tel-nr-anz");
    const zeigen = () => { anz.textContent = nr; box.querySelector(".tel-loeschen").style.visibility = nr ? "visible" : "hidden"; };
    box.querySelectorAll(".tel-t").forEach((b) => {
      const z = b.dataset.z;
      b.addEventListener("pointerdown", () => {
        langGeschehen = false;
        if (z !== "0") return;
        lang = setTimeout(() => { langGeschehen = true; nr = (nr + "+").slice(0, 24); zeigen(); }, 500);
      });
      const los = () => clearTimeout(lang);
      b.addEventListener("pointerup", los); b.addEventListener("pointerleave", los); b.addEventListener("pointercancel", los);
      b.addEventListener("click", () => { if (langGeschehen) { langGeschehen = false; return; } nr = (nr + z).slice(0, 24); zeigen(); });
    });
    const del = box.querySelector(".tel-loeschen"); let delLang = null, delGeschehen = false;
    del.addEventListener("pointerdown", () => { delGeschehen = false; delLang = setTimeout(() => { delGeschehen = true; nr = ""; zeigen(); }, 600); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((e) => del.addEventListener(e, () => clearTimeout(delLang)));
    del.addEventListener("click", () => { if (delGeschehen) return; nr = nr.slice(0, -1); zeigen(); });
    box.querySelector(".tel-anruf").addEventListener("click", () => { if (nr) waehlen(nr); else PS.toast("Nummer eingeben"); });
    zeigen();
  }

  function verlauf(box) {
    box.innerHTML = '<div class="leer">Lade Verlauf …</div>';
    anf({ typ: "telefon_verlauf" }).then((r) => {
      if (!box.isConnected) return;
      const l = Array.isArray(r) ? r : [];
      if (!l.length) { box.innerHTML = '<div class="leer">Noch keine Anrufe.</div>'; return; }
      const IC = { ein: "phone-incoming", aus: "phone-outgoing", verpasst: "phone-missed" };
      box.innerHTML = `<div class="tel-verlauf">${l.map((x, i) => `<button class="tel-zeile verlauf ${x.richtung === "verpasst" ? "verpasst" : ""}" data-i="${i}">${avatar(x.name, x.nummer, "klein")}<span class="tel-zt"><b>${PS.esc(x.name || x.nummer || "Unbekannt")}</b><small class="tabular">${PS.ic(IC[x.richtung] || "phone")}${x.richtung === "verpasst" ? "Verpasst" : x.richtung === "aus" ? "Ausgehend" : "Eingehend"}${x.name && x.nummer ? " · " + PS.esc(x.nummer) : ""}</small></span><span class="tel-zeit tabular">${PS.esc(zeitText(x.zeit))}${x.dauer_s > 0 ? `<small>${mmss(x.dauer_s)}</small>` : ""}</span>${PS.ic("phone")}</button>`).join("")}</div>`;
      box.querySelectorAll(".tel-zeile").forEach((b) => b.addEventListener("click", () => { const x = l[Number(b.dataset.i)]; waehlen(x.nummer, x.name); }));
    }).catch((e) => { if (box.isConnected) box.innerHTML = `<div class="leer">Verlauf nicht verfügbar: ${PS.esc(e.message)}</div>`; });
  }

  PS.module.telefon = {
    titel: "Telefon", icon: "phone",
    verfuegbar: () => !!(st().aktiv) || demo,
    render(el) {
      const hinweis = E('<div class="tel-hinweis" hidden></div>');
      const inhalt = E('<div class="tel-inhalt"></div>');
      el.append(hinweis, inhalt);
      const status = () => {
        const s = st(), schlecht = (s.aktiv || demo) && s.registriert === false;
        hinweis.hidden = !schlecht && !s.fehler;
        hinweis.innerHTML = schlecht || s.fehler ? `${PS.ic("phone-alert")}<span>${schlecht ? "Nicht registriert" : "Telefon"}${s.fehler ? " · " + PS.esc(s.fehler) : ""}</span>` : "";
      };
      status();
      const tabs = [["favoriten", "Favoriten"], ["kontakte", "Kontakte"], ["tastatur", "Tastatur"], ["verlauf", "Verlauf"]];
      const wahl = (k) => { tab = k; inhalt.innerHTML = ""; ({ favoriten, kontakte: kontakteTab, tastatur, verlauf })[k](inhalt); };
      PS.tabs(tabs, tab, wahl); wahl(tab);
      const h = () => { if (hinweis.isConnected) status(); };
      PS.on("telefon", h);
    },
  };

  // ------------------------------------------------------------ Test ohne Server
  // PS.telefonDemo("klingelt" | "waehlt" | "verbunden" | "beendet" | null) speist einen Scheinstatus ein (nur Oberfläche).
  PS.telefonDemo = (zustand, opt = {}) => {
    demo = true;
    const jetzt = Date.now() / 1000;
    const anruf = zustand ? {
      id: "demo", richtung: opt.richtung || (zustand === "waehlt" ? "aus" : "ein"), nummer: opt.nummer || "+49 171 1234567", name: opt.name === undefined ? "Maria Mustermann" : opt.name,
      zustand, seit: jetzt, verbunden_seit: zustand === "verbunden" || zustand === "beendet" ? jetzt - (opt.dauer ?? 83) : null, grund: opt.grund || "", stumm: false,
    } : null;
    PS.telefon = { typ: "telefon", aktiv: true, registriert: true, fehler: "", anruf };
    PS.emit("telefon", PS.telefon);
  };
})();
