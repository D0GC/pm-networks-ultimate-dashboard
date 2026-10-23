"""Schritt 2: Trainingsdatensatz in der Hausstimme erzeugen.

Chatterbox Multilingual (MIT) spricht jeden Satz aus ``saetze/*.txt`` mit der Stimme aus ``referenz.wav``. Jede
Aufnahme wird geprüft und nur übernommen, wenn sie stimmt:

- faster-whisper erkennt den gesprochenen Text; er muss dem Satz weitgehend entsprechen (keine Versprecher,
  ausgelassenen oder erfundenen Wörter),
- Sprechtempo plausibel (weder gehetzt noch abgehackt), keine Übersteuerung.

Schlägt die Prüfung fehl, wird der Satz bis zu zweimal neu erzeugt. Ergebnis im Format LJSpeech, wie Piper es
erwartet: ``datensatz/wav/NNNN.wav`` (22.050 Hz, mono, 16 bit) und ``datensatz/metadata.csv`` („NNNN|Text“).
Abbrechen und erneut starten setzt dort fort, wo es aufgehört hat. ``datensatz/bericht.csv`` listet jede Prüfung.

    python3 skripte/datensatz.py              # alles erzeugen bzw. fortsetzen
    python3 skripte/datensatz.py --anzahl 20  # nur 20 Sätze (zum Ausprobieren)
"""

from __future__ import annotations

import argparse
import csv
import difflib
import re
import time
from pathlib import Path

ARBEIT = Path("/arbeit")
ZIEL_SR = 22050
# Ruhige, gleichmäßige Sprechweise: wenig Übertreibung, etwas geringere Führung = langsameres Tempo
EINSTELLUNGEN = {"exaggeration": 0.35, "cfg_weight": 0.4, "temperature": 0.7}
MIN_AEHNLICH = 0.85
VERSUCHE = 3


def saetze() -> list[str]:
    alle: list[str] = []
    for datei in ("haus.txt", "allgemein.txt"):
        alle += [z.strip() for z in (ARBEIT / "saetze" / datei).read_text(encoding="utf-8").splitlines() if z.strip()]
    return alle


def normal(text: str) -> str:
    """Für den Vergleich: Ziffern als Wörter, klein, ohne Satzzeichen."""
    from num2words import num2words

    def wort(m: re.Match) -> str:
        z = m.group().replace(",", ".")
        return " " + num2words(float(z) if "." in z else int(z), lang="de") + " "

    text = re.sub(r"\d+([.,]\d+)?", wort, text)
    return " ".join(re.sub(r"[^a-zäöüß ]+", " ", text.lower()).split())


def aehnlich(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, normal(a), normal(b)).ratio()


def aufbereiten(wav, sr: int):
    """Stille am Rand kürzen (mit kurzem Polster), auf 22.050 Hz, gleichmäßige Lautheit, Spitzen begrenzen."""
    import librosa
    import numpy as np

    wav = np.asarray(wav, dtype="float32").squeeze()
    wav, _ = librosa.effects.trim(wav, top_db=40)
    wav = librosa.resample(wav, orig_sr=sr, target_sr=ZIEL_SR)
    polster = np.zeros(int(0.15 * ZIEL_SR), dtype="float32")
    wav = np.concatenate([polster, wav, polster])
    rms = float(np.sqrt(np.mean(wav**2)) or 1e-9)
    wav = wav * (10 ** (-20 / 20) / rms)  # etwa -20 dBFS
    spitze = float(np.max(np.abs(wav)) or 1)
    if spitze > 0.95:
        wav = wav * (0.95 / spitze)
    return wav


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--anzahl", type=int, default=0, help="nur so viele Sätze (0 = alle)")
    a = ap.parse_args()

    import soundfile as sf
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from faster_whisper import WhisperModel

    referenz = ARBEIT / "referenz.wav"
    if not referenz.exists():
        raise SystemExit("Keine referenz.wav. Zuerst Proben erzeugen und eine wählen (hausstimme.ps1 proben / waehlen).")
    wavdir = ARBEIT / "datensatz" / "wav"
    wavdir.mkdir(parents=True, exist_ok=True)
    meta_pfad = ARBEIT / "datensatz" / "metadata.csv"
    bericht_pfad = ARBEIT / "datensatz" / "bericht.csv"

    print("Lade Chatterbox Multilingual (GPU) und Whisper (Prozessor) …", flush=True)
    tts = ChatterboxMultilingualTTS.from_pretrained(device="cuda" if torch.cuda.is_available() else "cpu")
    pruefer = WhisperModel("small", device="cpu", compute_type="int8")
    # Referenzstimme einmal analysieren statt bei jedem Satz
    tts.prepare_conditionals(str(referenz), exaggeration=EINSTELLUNGEN["exaggeration"])

    liste = saetze()
    if a.anzahl:
        liste = liste[: a.anzahl]
    fertig = {z.split("|", 1)[0] for z in meta_pfad.read_text(encoding="utf-8").splitlines()} if meta_pfad.exists() else set()
    start, neu, verworfen = time.time(), 0, 0
    with meta_pfad.open("a", encoding="utf-8") as meta, bericht_pfad.open("a", encoding="utf-8", newline="") as bf:
        bericht = csv.writer(bf)
        for i, satz in enumerate(liste, 1):
            kennung = f"{i:04d}"
            if kennung in fertig:
                continue
            ok = False
            for versuch in range(1, VERSUCHE + 1):
                torch.manual_seed(1000 * versuch + i)
                roh = tts.generate(satz, language_id="de", **EINSTELLUNGEN)
                wav = aufbereiten(roh.cpu().numpy(), tts.sr)
                pfad = wavdir / f"{kennung}.wav"
                sf.write(pfad, wav, ZIEL_SR, subtype="PCM_16")
                erkannt = " ".join(s.text for s in pruefer.transcribe(str(pfad), language="de", beam_size=1)[0])
                wert = aehnlich(satz, erkannt)
                dauer = len(wav) / ZIEL_SR
                tempo = len(satz) / max(dauer, 0.1)  # Zeichen je Sekunde
                gut = wert >= MIN_AEHNLICH and 7 <= tempo <= 22
                urteil = "ok" if gut else "nein"
                bericht.writerow([kennung, versuch, f"{wert:.2f}", f"{tempo:.1f}", urteil, satz, erkannt.strip()])
                if gut:
                    ok = True
                    break
            if ok:
                meta.write(f"{kennung}|{satz}\n")
                meta.flush()
                neu += 1
            else:
                (wavdir / f"{kennung}.wav").unlink(missing_ok=True)
                verworfen += 1
            if (neu + verworfen) % 10 == 0:
                rest = (time.time() - start) / max(neu + verworfen, 1) * (len(liste) - i)
                print(f"  {i}/{len(liste)}  übernommen {neu}, verworfen {verworfen}, noch etwa {rest / 60:.0f} min", flush=True)
    print(f"\nFertig: {neu} neu übernommen, {verworfen} verworfen. Weiter mit: hausstimme.ps1 training", flush=True)


if __name__ == "__main__":
    main()
