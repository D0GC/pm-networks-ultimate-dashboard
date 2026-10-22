/* PM Panel Studio – Ansagen (Piper) und Sprachassistent (Assist).
 * Ansagen: Der Server meldet {typ:"ansage", id, text}; der Ton kommt von api/ansage?id=… und läuft über die
 * Tonkette (Art "ansage"). Assistent: Knopf neben der Glocke → Mikrofon (16 kHz) → Assist-Pipeline in Home Assistant;
 * erkannter Text, Antwort und Antwortton erscheinen in einem Overlay.
 * Weckwort: Wandpanels schicken das Mikrofon dauerhaft an die App; die Pipeline beginnt mit openWakeWord in Home
 * Assistant. Nach dem Weckwort ein kurzer Doppelton, dann wie beim Knopf. Während eines Anrufs ruht das Lauschen. */
(function () {
  "use strict";
  const PS = window.PS, $ = (s) => document.querySelector(s);
  const tonUrl = (id) => "api/ansage?id=" + encodeURIComponent(id);
  let laufend = null;  // laufende Ansage { stoppen() }

  // ------------------------------------------------------------ Ansagen
  PS.on("ansage", (m) => {
    if (!m || !m.id || !PS.audio) return;
    if (laufend) laufend.stoppen();
    laufend = PS.audio.abspielen(tonUrl(m.id), "ansage");
    if (m.text) PS.toast((m.titel ? m.titel + ": " : "") + (m.text.length > 140 ? m.text.slice(0, 137) + " …" : m.text));
  });

  // ------------------------------------------------------------ Assistent
  // lauf: laufender Assist-Lauf { art: "weck" | "knopf", geweckt, zu (Spracheingabe beendet), timer }
  let mic = null, micLaedt = null, lauf = null, schliessTimer = null, weckTimer = null, fehlversuche = 0;
  const box = () => $("#assist");
  const knopf = () => $("#assist-knopf");
  const sicher = () => window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  const AKTIV = ["klingelt", "waehlt", "verbunden"];
  const telefoniert = () => !!(PS.telefon && PS.telefon.anruf && AKTIV.includes(PS.telefon.anruf.zustand));
  // Nie im eingebetteten Panel der Admin-Ansicht (Flur-Startseite anordnen): dort kein Mikrofon
  const weckGewuenscht = () => !!(PS.einst && PS.einst.assist_aktiv !== false && PS.einst.weckwort_aktiv !== false && sicher()) && !/[?&]anordnen=1/.test(location.search);

  function overlay(phase, oben, unten) {
    const b = box(); if (!b) return;
    clearTimeout(schliessTimer);
    b.hidden = false; b.dataset.phase = phase;
    b.querySelector(".assist-phase").textContent = { hoert: "Ich höre …", versteht: "Einen Moment …", denkt: "Einen Moment …", antwortet: "", spricht: "", fehler: "Das hat nicht geklappt", ende: "" }[phase] ?? "";
    if (oben != null) b.querySelector(".assist-text").textContent = oben;
    if (unten != null) b.querySelector(".assist-antwort").textContent = unten;
    requestAnimationFrame(() => b.classList.add("an"));
    knopfZeigen();
  }
  function schliessen(nachMs) {
    clearTimeout(schliessTimer);
    schliessTimer = setTimeout(() => {
      const b = box(); if (!b) return;
      b.classList.remove("an"); setTimeout(() => { if (!b.classList.contains("an")) b.hidden = true; }, 400);
    }, nachMs || 0);
  }
  function knopfZeigen() {
    const k = knopf(); if (!k) return;
    k.classList.toggle("aktiv", !!(lauf && lauf.geweckt && !lauf.zu));
    k.classList.toggle("lauscht", !!(lauf && lauf.art === "weck" && !lauf.geweckt));
  }

  // Mikrofon (16 kHz über das Worklet); bleibt an, solange das Weckwort lauscht
  async function micAn() {
    if (mic) return mic;
    if (micLaedt) return micLaedt;
    micLaedt = (async () => {
      const ctx = PS.audio && PS.audio.kontext();
      if (!ctx || !ctx.audioWorklet) throw new Error("Web Audio nicht verfügbar");
      const strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      await ctx.audioWorklet.addModule("static/assist-ton.js");
      const quelle = ctx.createMediaStreamSource(strom);
      const knoten = new AudioWorkletNode(ctx, "assist-mikrofon", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const nullPegel = ctx.createGain(); nullPegel.gain.value = 0;  // hält das Worklet am Laufen, ohne Mithören
      quelle.connect(knoten).connect(nullPegel).connect(ctx.destination);
      knoten.port.onmessage = (e) => { if (lauf && !lauf.zu) PS.sendeBinaer(e.data); };
      mic = { strom, quelle, knoten, null: nullPegel };
      return mic;
    })();
    try { return await micLaedt; } finally { micLaedt = null; }
  }
  function micAus() {
    if (!mic) return;
    const m = mic; mic = null;
    try { m.quelle.disconnect(); m.knoten.disconnect(); m.null.disconnect(); } catch { /* getrennt */ }
    m.strom.getTracks().forEach((t) => t.stop());
  }

  // ---- Weckwort: dauerhaft lauschen; nach jedem Lauf (oder Abbruch) beginnt ein neuer
  function weckPlanen(ms) {
    clearTimeout(weckTimer);
    weckTimer = setTimeout(weckStarten, ms);
  }
  async function weckStarten() {
    clearTimeout(weckTimer);
    if (lauf) return;
    if (!weckGewuenscht()) { micAus(); return; }
    if (telefoniert()) { micAus(); return; }  // nach dem Anruf startet der Telefon-Stand neu
    const eigener = lauf = { art: "weck", geweckt: false, zu: false };
    try {
      await micAn();
      const r = await PS.anfrage({ typ: "assist_start", weckwort: true });
      if (lauf !== eigener) return;
      if (r && r.ok === false) {
        // „aus“/„vorschau“: dieses Panel lauscht nicht; „ruhe“: Ruhezeit, in zehn Minuten erneut prüfen
        lauf = null; micAus(); knopfZeigen();
        if (r.grund === "ruhe") weckPlanen(600000);
        return;
      }
      fehlversuche = 0;
    } catch (e) {
      console.warn("assist: Weckwort", e);
      if (lauf === eigener) lauf = null;
      micAus();
      fehlversuche++;
      weckPlanen(Math.min(300000, 5000 * 2 ** Math.min(fehlversuche, 6)));
    }
    knopfZeigen();
  }
  function nachLauf(ms) {
    lauf = null; knopfZeigen();
    if (weckGewuenscht()) weckPlanen(ms); else micAus();
  }

  // ---- Knopf: sofort zuhören (auch während das Weckwort lauscht)
  async function knopfDruck() {
    if (lauf && lauf.geweckt) { stoppen(); return; }
    if (!sicher()) { PS.toast("Mikrofon gesperrt: Panel-Adresse in Chromium als sicher freigeben (siehe Dokumentation)", true); return; }
    clearTimeout(weckTimer);
    if (laufend) { laufend.stoppen(); laufend = null; }
    const eigener = lauf = { art: "knopf", geweckt: true, zu: false };
    overlay("hoert", "", "");
    try {
      await micAn();
      await PS.anfrage({ typ: "assist_start" });
      sicherheitsnetz(eigener);
    } catch (e) {
      overlay("fehler", "", (e && e.message) || String(e)); schliessen(4000);
      if (lauf === eigener) nachLauf(5000);
    }
  }
  // Nach 15 s endet die Eingabe auch ohne Sprachende-Erkennung
  function sicherheitsnetz(l) {
    clearTimeout(l.timer);
    l.timer = setTimeout(() => { if (lauf === l && !l.zu) { l.zu = true; knopfZeigen(); PS.anfrage({ typ: "assist_stopp" }).catch(() => {}); } }, 15000);
  }
  function stoppen() {
    // Zweites Tippen: Eingabe beenden (die Antwort kommt noch) oder ein offenes Overlay schließen
    if (lauf && lauf.geweckt && !lauf.zu) { lauf.zu = true; PS.anfrage({ typ: "assist_stopp" }).catch(() => {}); overlay("versteht"); return; }
    if (laufend) { laufend.stoppen(); laufend = null; }
    schliessen(0);
  }

  // Kurzer, leiser Doppelton: Weckwort erkannt
  function ding() {
    const c = PS.audio && PS.audio.kontext(), aus = c && PS.audio.ausgang("ton");
    if (!aus) return;
    [[880, 0], [1320, 0.09]].forEach(([f, t]) => {
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + t;
      o.frequency.value = f; g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.25, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
      o.connect(g).connect(aus); o.start(t0); o.stop(t0 + 0.18);
    });
  }

  PS.on("assist", (m) => {
    // Antwortton: kommt oft erst nach „ende“ (Home Assistant meldet tts-end und run-end gleichzeitig, die App lädt den
    // Ton danach), deshalb unabhängig vom Lauf abspielen
    if (m.phase === "spricht" && m.ton) {
      if (laufend) laufend.stoppen();
      laufend = PS.audio.abspielen(tonUrl(m.ton), "ansage");
      // Overlay bleibt, bis die Antwort ungefähr gesprochen ist (≈ 70 ms je Zeichen, mind. 5 s)
      const n = (box() && box().querySelector(".assist-antwort").textContent.length) || 60;
      schliessen(Math.max(5000, Math.min(30000, n * 70 + 1500)));
      return;
    }
    const l = lauf;
    if (!l) return;
    if (m.phase === "lauscht") { knopfZeigen(); return; }
    if (m.phase === "geweckt") {
      l.geweckt = true;
      if (laufend) { laufend.stoppen(); laufend = null; }
      ding(); overlay("hoert", "", ""); sicherheitsnetz(l);
      return;
    }
    if (m.phase === "hoert") { overlay("hoert"); return; }
    if (["versteht", "denkt", "antwortet", "fehler"].includes(m.phase)) l.zu = true;  // keine Rahmen mehr senden
    if (m.phase === "versteht" || m.phase === "denkt") overlay("denkt", m.text != null ? m.text : null);
    else if (m.phase === "antwortet") { overlay("antwortet", null, m.antwort || ""); l.antwort = true; schliessen(9000); }
    else if (m.phase === "fehler") { overlay("fehler", null, m.fehler || ""); schliessen(5000); clearTimeout(l.timer); nachLauf(5000); }
    else if (m.phase === "ende") {
      clearTimeout(l.timer);
      if (!l.geweckt) { nachLauf(m.code ? 3000 : 500); return; }  // Lauschen endete ohne Weckwort: neu beginnen
      if (!l.antwort) schliessen(2500);
      nachLauf(1500);
    }
    knopfZeigen();
  });

  // Anrufe: Telefon braucht Mikrofon und Binärkanal, das Weckwort ruht bis zum Ende des Anrufs
  PS.on("telefon", () => {
    if (telefoniert()) {
      if (lauf) { clearTimeout(lauf.timer); lauf = null; }
      clearTimeout(weckTimer); micAus(); knopfZeigen();
    } else if (!lauf) weckPlanen(2000);
  });

  function einrichten() {
    const zeile = document.querySelector(".glocke-zeile");
    if (zeile && !knopf()) {
      const k = document.createElement("button");
      k.className = "glocke assist-knopf"; k.id = "assist-knopf"; k.setAttribute("aria-label", "Sprachassistent");
      k.innerHTML = PS.ic("microphone-outline");
      k.addEventListener("click", knopfDruck);
      zeile.insertBefore(k, zeile.firstChild);
    }
    if (!box()) {
      const b = document.createElement("div");
      b.id = "assist"; b.className = "assist"; b.hidden = true;
      b.innerHTML = `<div class="assist-ring">${PS.ic("microphone-outline")}</div><div class="assist-inhalt"><small class="assist-phase"></small><p class="assist-text"></p><p class="assist-antwort"></p></div>`;
      b.addEventListener("click", stoppen);
      document.body.appendChild(b);
    }
    sichtbar();
  }
  function sichtbar() { const k = knopf(); if (k) k.hidden = PS.einst && PS.einst.assist_aktiv === false; }
  // Nach jeder (Neu-)Verbindung kennt der Server keinen Lauf mehr: neu lauschen
  PS.on("init", () => { einrichten(); if (lauf) { clearTimeout(lauf.timer); lauf = null; } weckPlanen(1500); });
  PS.on("einstellungen", () => {
    sichtbar();
    if (lauf && lauf.art === "weck" && !lauf.geweckt) {
      // Weckwort oder Pipeline geändert: Lauf neu beginnen (oder beenden, wenn abgeschaltet)
      lauf = null; PS.anfrage({ typ: "assist_stopp", abbrechen: true }).catch(() => {});
    }
    if (!lauf) weckPlanen(1000);
  });
})();
