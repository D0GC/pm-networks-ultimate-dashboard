"""Schritt 1: Hausstimme entwerfen.

Parler-TTS (mehrsprachig, Apache 2.0) erzeugt Stimmen aus einer Beschreibung. Dieses Skript spricht denselben Probetext
mit mehreren Beschreibungen und Startwerten; die Ergebnisse liegen unter ``proben/``. Die beste Probe wird mit
``--waehlen NN`` zur Referenzstimme (``referenz.wav``), aus der Schritt 2 den ganzen Datensatz spricht.

    python3 skripte/proben.py                 # Proben erzeugen
    python3 skripte/proben.py --mehr          # weitere Proben mit neuen Startwerten
    python3 skripte/proben.py --waehlen 07    # Probe 07 als Referenz übernehmen
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

MODELL = "parler-tts/parler-tts-mini-multilingual-v1.1"
PROBETEXT = (
    "Guten Abend, Sir. Die Haustür ist verriegelt, und die Alarmanlage ist scharf geschaltet. "
    "Im Wohnzimmer liegt die Temperatur bei einundzwanzig Grad. Ich wünsche Ihnen eine ruhige Nacht."
)
# Parler versteht englische Beschreibungen am besten; „very clear audio“ und „close-sounding“ halten das Ergebnis sauber
BESCHREIBUNGEN = [
    "A man with a deep, low-pitched and resonant voice speaks German slowly and calmly, with a composed, dignified "
    "and authoritative tone. The recording is very clear and close-sounding, with no background noise.",
    "A mature male speaker with a very deep, warm and powerful voice delivers his words in German at a slow, "
    "measured pace with quiet gravitas. Very clear audio, close-sounding, no reverberation.",
    "A calm, deep male voice speaks German with a steady, unhurried rhythm and a refined, butler-like composure. "
    "Low pitch, rich and full tone. The audio is very clear and studio quality.",
    "A man speaks German in a low, sonorous and confident voice, slowly and with gentle authority, like the "
    "artificial intelligence of a grand house. Very clear, close-sounding recording without noise.",
]
ARBEIT = Path("/arbeit")


def erzeugen(start: int) -> None:
    import soundfile as sf
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    geraet = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Lade {MODELL} auf {geraet} …", flush=True)
    modell = ParlerTTSForConditionalGeneration.from_pretrained(MODELL).to(geraet)
    tok_text = AutoTokenizer.from_pretrained(MODELL)
    tok_beschreibung = AutoTokenizer.from_pretrained(modell.config.text_encoder._name_or_path)
    ziel = ARBEIT / "proben"
    ziel.mkdir(exist_ok=True)
    liste = ziel / "liste.txt"
    nr = len(list(ziel.glob("*.wav")))
    with liste.open("a", encoding="utf-8") as log:
        for b, beschreibung in enumerate(BESCHREIBUNGEN):
            for seed in range(start, start + 3):
                torch.manual_seed(seed)
                eingabe = tok_beschreibung(beschreibung, return_tensors="pt").input_ids.to(geraet)
                prompt = tok_text(PROBETEXT, return_tensors="pt").input_ids.to(geraet)
                audio = modell.generate(input_ids=eingabe, prompt_input_ids=prompt, do_sample=True, temperature=0.8)
                nr += 1
                datei = ziel / f"{nr:02d}.wav"
                sf.write(datei, audio.cpu().numpy().squeeze(), modell.config.sampling_rate)
                log.write(f"{nr:02d}\tBeschreibung {b + 1}\tStartwert {seed}\n")
                print(f"  {datei.name}  (Beschreibung {b + 1}, Startwert {seed})", flush=True)
    print("\nFertig. Proben anhören unter: proben\\  —  dann: hausstimme.ps1 waehlen NN", flush=True)


def waehlen(nr: str) -> None:
    quelle = ARBEIT / "proben" / f"{int(nr):02d}.wav"
    if not quelle.exists():
        raise SystemExit(f"Probe {quelle.name} gibt es nicht.")
    shutil.copy(quelle, ARBEIT / "referenz.wav")
    print(f"{quelle.name} ist jetzt die Referenzstimme (referenz.wav). Weiter mit: hausstimme.ps1 datensatz")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--waehlen", metavar="NN")
    ap.add_argument("--mehr", action="store_true", help="weitere Proben mit neuen Startwerten")
    a = ap.parse_args()
    if a.waehlen:
        waehlen(a.waehlen)
    else:
        bisher = len(list((ARBEIT / "proben").glob("*.wav"))) if (ARBEIT / "proben").exists() else 0
        erzeugen(start=100 + bisher if a.mehr else 1)
