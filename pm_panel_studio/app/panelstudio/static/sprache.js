/* PM Panel Studio – Ansagen (Piper) und Sprachassistent (Assist).
 * Ansagen: Der Server meldet {typ:"ansage", id, text}; der Ton kommt von api/ansage?id=… und läuft über die
 * Tonkette (Art "ansage"). Assistent: Knopf neben der Glocke → Mikrofon (16 kHz) → Assist-Pipeline in Home Assistant;
 * erkannter Text, Antwort und Antwortton erscheinen in einem Overlay. */
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
  let mic = null, sitzung = null, schliessTimer = null;
  const box = () => $("#assist");
  const knopf = () => $("#assist-knopf");

  function overlay(phase, oben, unten) {
    const b = box(); if (!b) return;
    clearTimeout(schliessTimer);
    b.hidden = false; b.dataset.phase = phase;
    b.querySelector(".assist-phase").textContent = { hoert: "Ich höre …", versteht: "Einen Moment …", denkt: "Einen Moment …", antwortet: "", spricht: "", fehler: "Das hat nicht geklappt", ende: "" }[phase] ?? "";
    if (oben != null) b.querySelector(".assist-text").textContent = oben;
    if (unten != null) b.querySelector(".assist-antwort").textContent = unten;
    requestAnimationFrame(() => b.classList.add("an"));
    knopf() && knopf().classList.toggle("aktiv", phase === "hoert");
  }
  function schliessen(nachMs) {
    clearTimeout(schliessTimer);
    schliessTimer = setTimeout(() => {
      const b = box(); if (!b) return;
      b.classList.remove("an"); setTimeout(() => { if (!b.classList.contains("an")) b.hidden = true; }, 400);
      knopf() && knopf().classList.remove("aktiv");
    }, nachMs || 0);
  }
  function micStoppen() {
    if (!mic) return;
    const m = mic; mic = null;
    try { m.quelle.disconnect(); m.knoten.disconnect(); m.null.disconnect(); } catch { /* getrennt */ }
    m.strom.getTracks().forEach((t) => t.stop());
  }

  async function starten() {
    if (sitzung) { stoppen(); return; }
    if (!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      PS.toast("Mikrofon gesperrt: Panel-Adresse in Chromium als sicher freigeben (siehe Dokumentation)", true); return;
    }
    const ctx = PS.audio && PS.audio.kontext();
    if (!ctx || !ctx.audioWorklet) { PS.toast("Assistent: Web Audio nicht verfügbar", true); return; }
    sitzung = { start: Date.now() };
    if (laufend) { laufend.stoppen(); laufend = null; }
    overlay("hoert", "", "");
    try {
      const strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      await ctx.audioWorklet.addModule("static/assist-ton.js");
      const quelle = ctx.createMediaStreamSource(strom);
      const knoten = new AudioWorkletNode(ctx, "assist-mikrofon", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const nullPegel = ctx.createGain(); nullPegel.gain.value = 0;  // hält das Worklet am Laufen, ohne Mithören
      quelle.connect(knoten).connect(nullPegel).connect(ctx.destination);
      mic = { strom, quelle, knoten, null: nullPegel };
      knoten.port.onmessage = (e) => { if (mic && sitzung) PS.sendeBinaer(e.data); };
      await PS.anfrage({ typ: "assist_start" });
      // Sicherheitsnetz: nach 15 s endet die Eingabe auch ohne Sprachende-Erkennung
      sitzung.timer = setTimeout(() => { if (mic) { micStoppen(); PS.anfrage({ typ: "assist_stopp" }).catch(() => {}); } }, 15000);
    } catch (e) {
      micStoppen(); sitzung = null;
      overlay("fehler", "", (e && e.message) || String(e)); schliessen(4000);
    }
  }
  function stoppen() {
    // Zweites Tippen: Eingabe beenden (die Antwort kommt noch) oder ein offenes Overlay schließen
    if (mic) { micStoppen(); PS.anfrage({ typ: "assist_stopp" }).catch(() => {}); overlay("versteht"); return; }
    if (laufend) { laufend.stoppen(); laufend = null; }
    sitzung = null; schliessen(0);
  }

  PS.on("assist", (m) => {
    if (!sitzung) return;
    if (m.phase !== "hoert") micStoppen();
    if (m.phase === "hoert") overlay("hoert");
    else if (m.phase === "versteht" || m.phase === "denkt") overlay("denkt", m.text != null ? m.text : null);
    else if (m.phase === "antwortet") { overlay("antwortet", null, m.antwort || ""); sitzung.antwort = true; schliessen(9000); }
    else if (m.phase === "spricht" && m.ton) {
      if (laufend) laufend.stoppen();
      laufend = PS.audio.abspielen(tonUrl(m.ton), "ansage");
      // Overlay bleibt, bis die Antwort ungefähr gesprochen ist (≈ 70 ms je Zeichen, mind. 5 s)
      const n = (box() && box().querySelector(".assist-antwort").textContent.length) || 60;
      schliessen(Math.max(5000, Math.min(30000, n * 70 + 1500)));
    } else if (m.phase === "fehler") { overlay("fehler", null, m.fehler || ""); schliessen(5000); sitzung = null; }
    else if (m.phase === "ende") { clearTimeout(sitzung && sitzung.timer); if (!sitzung.antwort) schliessen(2500); sitzung = null; }
  });

  function einrichten() {
    const zeile = document.querySelector(".glocke-zeile");
    if (zeile && !knopf()) {
      const k = document.createElement("button");
      k.className = "glocke assist-knopf"; k.id = "assist-knopf"; k.setAttribute("aria-label", "Sprachassistent");
      k.innerHTML = PS.ic("microphone-outline");
      k.addEventListener("click", starten);
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
  PS.on("init", einrichten);
  PS.on("einstellungen", sichtbar);
})();
