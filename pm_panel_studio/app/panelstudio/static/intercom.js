/* PM Panel Studio – Gegensprechen mit der Ring Intercom (über die Integration PM Ring Intercom).
 * Signalisierung läuft über den Panel-WebSocket und die App zu Home Assistant, der Ton direkt zwischen Browser und Ring.
 * Das Mikrofon gibt der Browser nur in einem sicheren Kontext frei (HTTPS, localhost oder per Chromium-Freigabe). */
(function () {
  "use strict";
  const PS = window.PS;
  const $ = (s) => document.querySelector(s);

  let pc = null, mic = null, gespraech = null, sitzung = false;
  let eigene = [], fremde = [];

  function zustand(text, aktiv) {
    const k = $("#ereignis-sprechen");
    if (k) {
      k.classList.toggle("gefahr", !!aktiv);
      k.classList.toggle("primaer", !aktiv);
      k.innerHTML = aktiv ? PS.ic("phone-hangup") + " Auflegen" : PS.ic("microphone") + " Sprechen";
    }
    const s = $("#intercom-status");
    if (s) { s.textContent = text || ""; s.hidden = !text; }
    document.body.classList.toggle("gespraech", !!aktiv);
    if (aktiv && PS.klingelStopp) PS.klingelStopp();  // das Mikrofon soll den Klingelton nicht aufnehmen
  }

  function aufraeumen(text) {
    if (pc) { try { pc.close(); } catch { /* bereits zu */ } }
    if (mic) mic.getTracks().forEach((t) => t.stop());
    const ton = $("#intercom-ton");
    if (ton) ton.srcObject = null;
    pc = null; mic = null; gespraech = null; sitzung = false; eigene = []; fremde = [];
    zustand(text || "", false);
  }

  function kandidatSenden(c) {
    PS.anfrage({ typ: "intercom_kandidat", gespraech, kandidat: c.candidate, index: c.sdpMLineIndex ?? 0 }).catch(() => {});
  }

  async function starten() {
    if (pc) return beenden();
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      PS.toast("Mikrofon gesperrt: Panel-Adresse in Chromium als sicher freigeben (siehe Dokumentation)", true);
      return;
    }
    zustand("Verbinde mit der Haustür …", true);
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      mic.getTracks().forEach((t) => pc.addTransceiver(t, { direction: "sendrecv", streams: [mic] }));
      pc.ontrack = (ev) => {
        const ton = $("#intercom-ton");
        ton.srcObject = ev.streams[0] || new MediaStream([ev.track]);
        ton.play().catch(() => {});
      };
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        const c = ev.candidate.toJSON();
        if (sitzung) kandidatSenden(c); else eigene.push(c);
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        const s = pc.connectionState;
        if (s === "connected") zustand("Verbunden – sprechen Sie", true);
        else if (s === "disconnected") zustand("Verbindung unterbrochen …", true);
        else if (s === "failed") { beenden(); PS.toast("Verbindung zur Haustür fehlgeschlagen", true); }
      };
      const angebot = await pc.createOffer();
      await pc.setLocalDescription(angebot);
      const kennung = await PS.anfrage({ typ: "intercom_start", angebot: angebot.sdp });
      if (pc && !gespraech) gespraech = kennung;
    } catch (e) {
      aufraeumen();
      PS.toast("Gegensprechen: " + (e && e.message ? e.message : e), true);
    }
  }

  function beenden() {
    if (gespraech) PS.anfrage({ typ: "intercom_ende", gespraech }).catch(() => {});
    aufraeumen();
  }

  async function nachricht(m) {
    if (!pc) return;
    if (!gespraech) gespraech = m.gespraech;  // die Signalisierung kann vor der Antwort auf die Anfrage eintreffen
    if (m.gespraech !== gespraech) return;
    try {
      if (m.type === "session") {
        sitzung = true;
        eigene.splice(0).forEach(kandidatSenden);
      } else if (m.type === "answer") {
        await pc.setRemoteDescription({ type: "answer", sdp: m.answer });
        for (const c of fremde.splice(0)) await pc.addIceCandidate(c);
        zustand("Haustür antwortet …", true);
      } else if (m.type === "candidate" && m.candidate) {
        const c = { candidate: m.candidate.candidate, sdpMLineIndex: m.candidate.sdpMLineIndex ?? 0 };
        if (pc.remoteDescription) await pc.addIceCandidate(c); else fremde.push(c);
      } else if (m.type === "error") {
        aufraeumen();
        PS.toast("Haustür: " + (m.message || m.code || "Fehler"), true);
      } else if (m.type === "closed") {
        aufraeumen(m.grund || "");
      }
    } catch (e) {
      console.warn("intercom", e);
    }
  }

  PS.intercomBeenden = () => { if (pc) beenden(); };
  PS.on("intercom", nachricht);

  document.addEventListener("DOMContentLoaded", () => {
    const k = $("#ereignis-sprechen");
    if (k) k.addEventListener("click", starten);
    zustand("", false);
  });
  addEventListener("pagehide", () => { if (pc) beenden(); });
})();
