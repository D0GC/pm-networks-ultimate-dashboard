/* PM Panel Studio – Mikrofon für den Sprachassistenten (AudioWorklet): Mikrofon → 16 kHz Int16 (320er-Rahmen, 20 ms),
 * wie es Home Assistant für Assist erwartet. Eigene Datei, weil die CSP für Skripte nur 'self' erlaubt. */
class AssistMikrofon extends AudioWorkletProcessor {
  constructor() {
    super();
    this.r = sampleRate / 16000; this.acc = 0; this.n = 0; this.pos = 0;
    this.rahmen = new Int16Array(320); this.k = 0;
  }
  process(eingaenge) {
    const x = eingaenge[0] && eingaenge[0][0];
    if (!x) return true;
    for (let i = 0; i < x.length; i++) {
      // Mittelwert über das Verhältnis Kontextrate / 16000 (einfacher Tiefpass gegen Aliasing)
      this.acc += x[i]; this.n++; this.pos += 1;
      if (this.pos >= this.r) {
        this.pos -= this.r;
        const v = Math.max(-1, Math.min(1, this.acc / this.n));
        this.acc = 0; this.n = 0;
        this.rahmen[this.k++] = v < 0 ? v * 32768 : v * 32767;
        if (this.k === 320) {
          const buf = this.rahmen.buffer.slice(0);
          this.port.postMessage(buf, [buf]);
          this.k = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("assist-mikrofon", AssistMikrofon);
