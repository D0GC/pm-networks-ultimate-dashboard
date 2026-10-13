/* PM Panel Studio – Telefon-Ton (AudioWorklet): Mikrofon → 8 kHz Int16 (160er-Rahmen), 8 kHz Int16 → Lautsprecher.
 * Eigene Datei, weil die CSP für Skripte nur 'self' erlaubt. */
class TelMikrofon extends AudioWorkletProcessor {
  constructor() {
    super();
    this.r = sampleRate / 8000; this.acc = 0; this.n = 0; this.pos = 0;
    this.rahmen = new Int16Array(160); this.k = 0; this.stumm = false;
    this.port.onmessage = (e) => { if (e.data && "stumm" in e.data) this.stumm = !!e.data.stumm; };
  }
  process(eingaenge) {
    const x = eingaenge[0] && eingaenge[0][0];
    if (!x) return true;
    for (let i = 0; i < x.length; i++) {
      // Mittelwert über das Verhältnis Kontextrate / 8000 (einfacher Tiefpass gegen Aliasing)
      this.acc += x[i]; this.n++; this.pos += 1;
      if (this.pos >= this.r) {
        this.pos -= this.r;
        const v = this.stumm ? 0 : Math.max(-1, Math.min(1, this.acc / this.n));
        this.acc = 0; this.n = 0;
        this.rahmen[this.k++] = v < 0 ? v * 32768 : v * 32767;
        if (this.k === 160) {
          const buf = this.rahmen.buffer.slice(0);
          this.port.postMessage(buf, [buf]);
          this.k = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("tel-mikrofon", TelMikrofon);

class TelWiedergabe extends AudioWorkletProcessor {
  constructor() {
    super();
    this.puffer = new Float32Array(8000); this.lese = 0; this.schreibe = 0; this.fuell = 0; this.frac = 0;
    this.spielt = false; this.schritt = 8000 / sampleRate;
    this.port.onmessage = (e) => {
      const d = new Int16Array(e.data), P = this.puffer;
      for (let i = 0; i < d.length; i++) { P[this.schreibe] = d[i] / 32768; this.schreibe = (this.schreibe + 1) % P.length; }
      this.fuell += d.length;
      if (this.fuell > 2400) {  // über ~300 ms: Älteres verwerfen, ~120 ms behalten
        const weg = this.fuell - 960; this.lese = (this.lese + weg) % P.length; this.fuell -= weg;
      }
    };
  }
  process(_e, ausgaenge) {
    const out = ausgaenge[0][0], P = this.puffer;
    if (!this.spielt && this.fuell >= 480) this.spielt = true;  // ~60 ms Vorlauf
    for (let i = 0; i < out.length; i++) {
      if (!this.spielt || this.fuell < 2) { out[i] = 0; if (this.spielt) this.spielt = false; continue; }
      const a = P[this.lese], b = P[(this.lese + 1) % P.length];
      out[i] = a + (b - a) * this.frac;
      this.frac += this.schritt;
      while (this.frac >= 1) { this.frac -= 1; this.lese = (this.lese + 1) % P.length; this.fuell--; }
    }
    return true;
  }
}
registerProcessor("tel-wiedergabe", TelWiedergabe);
