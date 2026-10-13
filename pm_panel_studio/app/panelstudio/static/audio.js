/* PM Panel Studio – zentrale Tonausgabe (Web Audio). Alle Töne des Panels laufen über eine Kette:
 * Quelle → Pegel je Art → gemeinsamer Kompressor → Master → Lautsprecher.
 * Die Lautsprecher des Panels sind sehr leise; ein Audio-Element kann nicht über 100 % gehen. Der Kompressor fängt
 * Spitzen ab, damit die Verstärkung nicht übersteuert. Arten: "ton" (Hinweis-/Alarmton), "klingel" (Türklingel),
 * "intercom" (Gegensprechen), "telefon" (Telefonie). Pegel je Art und Verstärkung kommen aus den Einstellungen. */
(function () {
  "use strict";
  const PS = window.PS;
  const ARTEN = ["ton", "klingel", "intercom", "telefon"];
  let ctx = null, kompressor = null, master = null;
  const pegel = {};

  const zahl = (k, standard) => { const v = Number(PS.einst && PS.einst[k]); return Number.isFinite(v) ? v : standard; };
  // Verstärkungsfaktor je Art. ton und klingel: ihr Pegel (5–100 %) mal die Master-Verstärkung ton_verstaerkung;
  // intercom und telefon bringen ihre eigene Verstärkung (100–800 %) mit.
  function faktor(art) {
    const m = Math.max(1, Math.min(8, zahl("ton_verstaerkung", 300) / 100));
    if (art === "ton") return Math.max(0.05, Math.min(1, zahl("ton_lautstaerke", 70) / 100)) * m;
    if (art === "klingel") return Math.max(0.05, Math.min(1, zahl("klingel_lautstaerke", 100) / 100)) * m;
    if (art === "intercom") return Math.max(1, Math.min(8, zahl("intercom_lautstaerke", 400) / 100));
    if (art === "telefon") return Math.max(1, Math.min(8, zahl("telefon_lautstaerke", 400) / 100));
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
        kompressor = ctx.createDynamicsCompressor();
        kompressor.threshold.value = -30; kompressor.knee.value = 20; kompressor.ratio.value = 6;
        kompressor.attack.value = 0.005; kompressor.release.value = 0.2;
        master = ctx.createGain();
        master.gain.value = 1;
        kompressor.connect(master).connect(ctx.destination);
      } catch (e) {
        console.warn("audio: Web Audio nicht verfügbar", e);
        ctx = null; kompressor = null; master = null;
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
      g.connect(kompressor);
      pegel[art] = g;
    }
    return pegel[art];
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
