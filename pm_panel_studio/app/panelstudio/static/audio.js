/* PM Panel Studio – zentrale Tonausgabe (Web Audio). Alle Töne des Panels laufen über eine Kette:
 * Quelle → [Sprache: Ausgleich] → Pegel je Art (Verstärkung) → Hochpass 300 Hz → Präsenz +6 dB bei 2,8 kHz →
 * Sättigung → Begrenzer → Lautsprecher.
 * Die Lautsprecher des Panels sind sehr leise; ein Audio-Element kann nicht über 100 % gehen. Die Verstärkung sitzt
 * deshalb VOR Sättigung und Begrenzer: Die weiche Sättigung (tanh) macht laute Töne dichter und damit hörbar lauter,
 * der Begrenzer kurz unter 0 dBFS verhindert Übersteuern. (Früher saß ein Kompressor mit -30 dB Schwelle hinter der
 * Verstärkung und nahm sie fast vollständig wieder weg.) Sprache (Gegensprechen, Telefon) wird vorher ausgeglichen,
 * damit leise Stellen mitkommen. Arten: "ton" (Hinweis-/Alarmton), "klingel" (Türklingel),
 * "intercom" (Gegensprechen), "telefon" (Telefonie), "ansage" (Piper-Ansagen, Assistent). Pegel je Art und Verstärkung kommen aus den Einstellungen. */
(function () {
  "use strict";
  const PS = window.PS;
  const ARTEN = ["ton", "klingel", "intercom", "telefon", "ansage"];
  let ctx = null, eingang = null, saettigung = null, begrenzer = null;
  const pegel = {};
  const SPRACHE = ["intercom", "telefon", "ansage"];

  // tanh-Kennlinie, normiert auf ±1: kleine Pegel werden rund dreifach angehoben, große laufen weich gegen ±1
  function kennlinie() {
    const n = 2048, k = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; k[i] = Math.tanh(x * 3) / Math.tanh(3); }
    return k;
  }

  const zahl = (k, standard) => { const v = Number(PS.einst && PS.einst[k]); return Number.isFinite(v) ? v : standard; };
  // Verstärkungsfaktor je Art. ton und klingel: ihr Pegel (5–100 %) mal die Master-Verstärkung ton_verstaerkung;
  // intercom und telefon bringen ihre eigene Verstärkung (100–800 %) mit.
  function faktor(art) {
    const m = Math.max(1, Math.min(8, zahl("ton_verstaerkung", 300) / 100));
    if (art === "ton") return Math.max(0.05, Math.min(1, zahl("ton_lautstaerke", 70) / 100)) * m;
    if (art === "klingel") return Math.max(0.05, Math.min(1, zahl("klingel_lautstaerke", 100) / 100)) * m;
    if (art === "intercom") return Math.max(1, Math.min(8, zahl("intercom_lautstaerke", 400) / 100));
    if (art === "telefon") return Math.max(1, Math.min(8, zahl("telefon_lautstaerke", 400) / 100));
    if (art === "ansage") return Math.max(1, Math.min(8, zahl("ansage_lautstaerke", 300) / 100));
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
        // Klang an die kleinen Lautsprecher anpassen: Tiefen unter ~300 Hz geben sie kaum wieder, kosten aber Aussteuerung;
        // der Bereich um 2,8 kHz klingt dort am lautesten (und dort ist das Gehör am empfindlichsten).
        eingang = ctx.createBiquadFilter(); eingang.type = "highpass"; eingang.frequency.value = 300; eingang.Q.value = 0.7;
        const praesenz = ctx.createBiquadFilter();
        praesenz.type = "peaking"; praesenz.frequency.value = 2800; praesenz.Q.value = 0.9; praesenz.gain.value = 6;
        saettigung = ctx.createWaveShaper(); saettigung.curve = kennlinie(); saettigung.oversample = "4x";
        eingang.connect(praesenz).connect(saettigung);
        begrenzer = ctx.createDynamicsCompressor();
        begrenzer.threshold.value = -1.5; begrenzer.knee.value = 0; begrenzer.ratio.value = 20;
        begrenzer.attack.value = 0.002; begrenzer.release.value = 0.1;
        saettigung.connect(begrenzer).connect(ctx.destination);
      } catch (e) {
        console.warn("audio: Web Audio nicht verfügbar", e);
        ctx = null; eingang = null; saettigung = null; begrenzer = null;
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
      if (SPRACHE.includes(art)) {
        // Ausgleich für Sprache: hebt leise Stellen an, bevor verstärkt wird
        const a = ctx.createDynamicsCompressor();
        a.threshold.value = -32; a.knee.value = 12; a.ratio.value = 4; a.attack.value = 0.003; a.release.value = 0.25;
        a.connect(g);
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
