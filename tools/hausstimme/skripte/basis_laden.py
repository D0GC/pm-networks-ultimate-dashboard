"""Basis-Checkpoint zum Nachtrainieren laden: deutsches Piper-Modell „thorsten“ (CC0) aus rhasspy/piper-checkpoints.

    python3 skripte/basis_laden.py --qualitaet medium
Legt den Checkpoint unter basis/ ab und gibt seinen Pfad aus. Vorhandene Dateien werden nicht erneut geladen.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import requests

REPO = "rhasspy/piper-checkpoints"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sprecher", default="thorsten")
    ap.add_argument("--qualitaet", default="medium", choices=["low", "medium", "high"])
    ap.add_argument("--ziel", default="/arbeit/basis")
    a = ap.parse_args()
    ziel = Path(a.ziel)
    ziel.mkdir(parents=True, exist_ok=True)
    vorhanden = sorted(ziel.glob(f"{a.sprecher}-{a.qualitaet}-*.ckpt"))
    if vorhanden:
        print(vorhanden[-1])
        return
    ordner = f"de/de_DE/{a.sprecher}/{a.qualitaet}"
    r = requests.get(f"https://huggingface.co/api/models/{REPO}/tree/main/{ordner}", timeout=30)
    r.raise_for_status()
    ckpts = [d["path"] for d in r.json() if d.get("path", "").endswith(".ckpt")]
    if not ckpts:
        sys.exit(f"Kein Checkpoint unter {ordner}. Andere Qualität wählen (--qualitaet) oder Sprecher prüfen.")
    pfad = sorted(ckpts)[-1]
    datei = ziel / f"{a.sprecher}-{a.qualitaet}-{Path(pfad).name}"
    print(f"Lade {pfad} …", file=sys.stderr)
    with requests.get(f"https://huggingface.co/{REPO}/resolve/main/{pfad}", stream=True, timeout=60) as d:
        d.raise_for_status()
        with open(datei, "wb") as f:
            for block in d.iter_content(1 << 20):
                f.write(block)
    print(datei)


if __name__ == "__main__":
    main()
