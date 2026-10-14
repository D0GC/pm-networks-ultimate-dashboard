/* PM Panel Studio – zentrale Tonausgabe (Web Audio). Alle Töne des Panels laufen über eine Kette:
 * Quelle → [Gegensprechen/Telefon: Ausgleich] → Pegel je Art → Hochpass 250 Hz → Präsenz +3 dB bei 2,8 kHz →
 * Begrenzer → Lautsprecher.
 * Die Grundlautstärke kommt von der Systemlautstärke des Panels. Die Kette verstärkt nur gezielt (Pegel je Art,
 * 100 % = unverändert) und lässt saubere Quellen wie Piper unverändert durch. Der Begrenzer fängt nur Spitzen ab.
 * Früher machten eine tanh-Sättigung und Verstärkungen bis 800 % eine zu niedrige Systemlautstärke wett; das
 * übersteuerte hörbar (Kratzen), sobald die Systemlautstärke wieder normal stand.
 * Der Ausgleich für Gegensprechen und Telefon hebt leise Stellen an; sein automatischer Aufholpegel wird danach
 * wieder abgezogen, damit 100 % auch dort ungefähr dem Original entspricht. Arten: "ton" (Hinweis-/Alarmton),
 * "klingel" (Türklingel), "intercom" (Gegensprechen), "telefon" (Telefonie), "ansage" (Piper-Ansagen, Assistent). */
(function () {
  "use strict";
  const PS = window.PS;
  const ARTEN = ["ton", "klingel", "intercom", "telefon", "ansage"];
  let ctx = null, eingang = null, begrenzer = null;
  const pegel = {};
  const AUSGLEICH = ["intercom", "telefon"];  // Piper-Ansagen sind bereits gleichmäßig ausgesteuert
  const AUFHOL = 0.33;  // ≈ −9,6 dB: gleicht den automatischen Aufholpegel des Ausgleichs aus

  const zahl = (k, standard) => { const v = Number(PS.einst && PS.einst[k]); return Number.isFinite(v) ? v : standard; };
  const verst = (k, standard) => Math.max(0.25, Math.min(4, zahl(k, standard) / 100));
  // Verstärkungsfaktor je Art. ton und klingel: ihr Pegel (5–100 %) mal die Verstärkung ton_verstaerkung;
  // intercom, telefon und ansage bringen ihre eigene Verstärkung (25–400 %, 100 % = unverändert) mit.
  function faktor(art) {
    const m = verst("ton_verstaerkung", 100);
    if (art === "ton") return Math.max(0.05, Math.min(1, zahl("ton_lautstaerke", 70) / 100)) * m;
    if (art === "klingel") return Math.max(0.05, Math.min(1, zahl("klingel_lautstaerke", 100) / 100)) * m;
    if (art === "intercom") return verst("intercom_lautstaerke", 150);
    if (art === "telefon") return verst("telefon_lautstaerke", 100);
    if (art === "ansage") return verst("ansage_lautstaerke", 100);
    return 1;
  }
  function pegelSetzen() {
    ARTEN.forEach((a) => {
      const g = pegel[a];
      if (!g) return;
      try { g.gain.setTargetAtTime(faktor(a), ctx.currentTime, 0.02); } catch { g.gain.value = faktor(a); }
    });
  }

  // Ein gemeinsamer AudioContext; null, wenn Web Audio fehlt. Wird bei Berührung und bei jedem Abruf fortgesetzt.
  function kontext() {
    if (!ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        // Klang an die kleinen Lautsprecher anpassen: Tiefen unter ~250 Hz geben sie kaum wieder, kosten aber Aussteuerung
        // (und klirren als Erste); um 2,8 kHz etwas Präsenz für Verständlichkeit.
        eingang = ctx.createBiquadFilter(); eingang.type = "highpass"; eingang.frequency.value = 250; eingang.Q.value = 0.7;
        const praesenz = ctx.createBiquadFilter();
        praesenz.type = "peaking"; praesenz.frequency.value = 2800; praesenz.Q.value = 0.9; praesenz.gain.value = 3;
        // Begrenzer: greift nur bei Spitzen über −3 dBFS, damit nie digital übersteuert wird
        begrenzer = ctx.createDynamicsCompressor();
        begrenzer.threshold.value = -3; begrenzer.knee.value = 3; begrenzer.ratio.value = 20;
        begrenzer.attack.value = 0.003; begrenzer.release.value = 0.25;
        eingang.connect(praesenz).connect(begrenzer).connect(ctx.destination);
      } catch (e) {
        console.warn("audio: Web Audio nicht verfügbar", e);
        ctx = null; eingang = null; begrenzer = null;
        return null;
      }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // Knoten, an den Quellen der Art angeschlossen werden (null ohne Web Audio)
  function ausgang(art) {
    if (!ARTEN.includes(art)) art = "ton";
    if (!kontext()) return null;
    if (!pegel[art]) {
      const g = ctx.createGain();
      g.gain.value = faktor(art);
      g.connect(eingang);
      pegel[art] = g;
      if (AUSGLEICH.includes(art)) {
        // Ausgleich für Gegensprechen und Telefon: hebt leise Stellen an; der Aufholpegel wird danach wieder abgezogen
        const a = ctx.createDynamicsCompressor();
        a.threshold.value = -24; a.knee.value = 10; a.ratio.value = 3; a.attack.value = 0.005; a.release.value = 0.3;
        const zurueck = ctx.createGain(); zurueck.gain.value = AUFHOL;
        a.connect(zurueck).connect(g);
        pegel[art]._eingang = a;
      }
    }
    return pegel[art]._eingang || pegel[art];
  }

  // Wartet, bis der Kontext läuft (höchstens maxMs); löst mit dem Kontext auf, sonst mit null
  function bereit(maxMs) {
    const c = kontext();
    if (!c) return Promise.resolve(null);
    if (c.state === "running") return Promise.resolve(c);
    const frist = new Promise((r) => setTimeout(r, maxMs || 1500, null));
    return Promise.race([c.resume().then(() => (c.state === "running" ? c : null)), frist]).catch(() => null);
  }

  // Entfernten MediaStream (WebRTC) über die Kette abspielen. Das Audio-Element bleibt stumm angehängt, sonst liefert
  // Chromium für entfernte WebRTC-Spuren keine Samples. Ohne Web Audio spielt das Element selbst (Lautstärke 1).
  function strom(mediaStream, art) {
    // Vorhandenes Element "#<art>-ton" nutzen (z. B. #intercom-ton), sonst ein verstecktes anlegen
    let eigenes = false, el = document.querySelector("#" + (art || "ton") + "-ton");
    if (!el) { el = document.createElement("audio"); el.hidden = true; document.body.appendChild(el); eigenes = true; }
    el.autoplay = true; el.setAttribute("playsinline", "");
    el.srcObject = mediaStream;
    let quelle = null;
    try {
      const aus = ausgang(art);
      if (!aus) throw new Error("kein Web Audio");
      quelle = ctx.createMediaStreamSource(mediaStream);
      quelle.connect(aus);
      el.muted = true;
    } catch (e) {
      console.warn("audio: Strom ohne Verstärkung", e);
      el.muted = false; el.volume = 1;
    }
    el.play().catch(() => {});
    return {
      stoppen() {
        if (quelle) { try { quelle.disconnect(); } catch { /* bereits getrennt */ } quelle = null; }
        el.srcObject = null;
        if (eigenes) el.remove();
      },
    };
  }

  // Datei oder AudioBuffer über die Kette abspielen: url (String), ArrayBuffer oder AudioBuffer.
  // Gibt { stoppen() } zurück; Fehler (z. B. nicht dekodierbar) bleiben stumm.
  function abspielen(quelle, art) {
    let knoten = null, beendet = false;
    const stoppen = () => { beendet = true; if (knoten) { try { knoten.stop(); } catch { /* nicht gestartet */ } try { knoten.disconnect(); } catch { /* getrennt */ } } };
    (async () => {
      const aus = ausgang(art), c = ctx;
      if (!aus) return;
      let puffer = quelle;
      if (typeof quelle === "string") puffer = await (await fetch(quelle)).arrayBuffer();
      if (puffer instanceof ArrayBuffer) puffer = await c.decodeAudioData(puffer);
      if (beendet) return;
      knoten = c.createBufferSource(); knoten.buffer = puffer; knoten.connect(aus); knoten.start();
    })().catch((e) => console.warn("audio: abspielen", e));
    return { stoppen };
  }

  PS.audio = { kontext, ausgang, bereit, strom, abspielen };

  // Autoplay-Regeln: beim ersten Tippen (Capture) und danach bei jeder Berührung fortsetzen
  addEventListener("pointerdown", () => { const c = kontext(); if (c && c.state === "suspended") c.resume().catch(() => {}); }, { capture: true, passive: true });
  // Änderungen im Editor wirken sofort, auch bei laufendem Ton
  PS.on("einstellungen", pegelSetzen);
})();
