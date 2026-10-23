"""Schritt 1, zweiter Weg: Referenzstimme aus hochdeutschen Piper-Stimmen.

Parler-TTS hat Deutsch aus Hörbuchaufnahmen gelernt; viele Proben tragen dadurch einen regionalen Akzent. Hier
sprechen stattdessen männliche Piper-Stimmen in klarem Hochdeutsch den Probetext, jeweils etwas langsamer und in
mehreren Tonlagen abgesenkt (tiefer = kräftiger). Chatterbox übernimmt daraus in Schritt 2 Klangfarbe und Aussprache
und spricht neu – die Absenkung klingt dort nicht mehr nach Effekt. Die Ergebnisse landen fortlaufend nummeriert in
``proben/`` und werden wie gewohnt mit ``hausstimme.ps1 waehlen NN`` übernommen.

    python3 skripte/vorlagen.py
"""

from __future__ import annotations

import subprocess

from proben import ARBEIT, PROBETEXT

STIMMEN = ["de_DE-thorsten-high", "de_DE-karlsson-low", "de_DE-pavoque-low"]
HALBTOENE = [0, -2, -4]
TEMPO = 1.15  # Piper length_scale: größer = ruhiger


def main() -> None:
    ziel = ARBEIT / "proben"
    ziel.mkdir(exist_ok=True)
    stimmen_dir = ARBEIT / ".cache" / "piper"
    stimmen_dir.mkdir(parents=True, exist_ok=True)
    nr = len(list(ziel.glob("*.wav")))
    with (ziel / "liste.txt").open("a", encoding="utf-8") as log:
        for stimme in STIMMEN:
            roh = stimmen_dir / f"{stimme}.wav"
            print(f"Spreche mit {stimme} …", flush=True)
            befehl = ["piper", "--model", stimme, "--data-dir", str(stimmen_dir), "--download-dir", str(stimmen_dir)]
            befehl += ["--length-scale", str(TEMPO), "--output-file", str(roh)]
            subprocess.run(befehl, input=PROBETEXT.encode("utf-8"), check=True)  # noqa: S603
            for ht in HALBTOENE:
                nr += 1
                datei = ziel / f"{nr:02d}.wav"
                faktor = 2 ** (ht / 12)
                # Tonhöhe senken, Tempo beibehalten (Piper „low“ liefert 16 kHz, daher zuerst auf 22,05 kHz)
                filt = "anull"
                if ht:
                    filt = f"aresample=22050,asetrate={22050 * faktor:.0f},aresample=22050,atempo={1 / faktor:.5f}"
                befehl = ["ffmpeg", "-v", "error", "-y", "-i", str(roh), "-af", filt, "-ar", "44100", "-ac", "1"]
                subprocess.run([*befehl, str(datei)], check=True)  # noqa: S603
                log.write(f"{nr:02d}\t{stimme}\t{ht:+d} Halbtöne\n")
                print(f"  {datei.name}  ({stimme}, {ht:+d} Halbtöne)", flush=True)
    print("\nFertig. Proben anhören unter: proben\\  —  dann: hausstimme.ps1 waehlen NN", flush=True)


if __name__ == "__main__":
    main()
