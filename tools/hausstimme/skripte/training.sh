#!/usr/bin/env bash
# Schritt 3: Piper auf die Hausstimme nachtrainieren. Fortsetzbar: läuft schon ein Training, geht es beim letzten
# Checkpoint weiter. ZUSATZ_EPOCHEN (Standard 1500) bestimmt, wie lange; jederzeit mit Strg+C beenden, dann exportieren.
set -euo pipefail
QUALITAET="${QUALITAET:-medium}"
ZUSATZ_EPOCHEN="${ZUSATZ_EPOCHEN:-1500}"
BATCH="${BATCH:-16}"
DATEN=/arbeit/datensatz
TRAIN=/arbeit/training

[ -s "$DATEN/metadata.csv" ] || { echo "Kein Datensatz. Zuerst: hausstimme.ps1 datensatz"; exit 1; }
echo "Datensatz: $(wc -l < "$DATEN/metadata.csv") Sätze"

BASIS=$(python3 /arbeit/skripte/basis_laden.py --qualitaet "$QUALITAET")
echo "Basismodell: $BASIS"

if [ ! -s "$TRAIN/dataset.jsonl" ]; then
  echo "Bereite den Datensatz auf (Lautschrift mit espeak-ng) …"
  python3 -m piper_train.preprocess --language de --input-dir "$DATEN" --output-dir "$TRAIN" \
    --dataset-format ljspeech --single-speaker --sample-rate 22050
fi

# Fortsetzen: jüngster eigener Checkpoint, sonst das Basismodell
LETZTER=$(ls -t "$TRAIN"/lightning_logs/version_*/checkpoints/*.ckpt 2>/dev/null | head -n1 || true)
START="${LETZTER:-$BASIS}"
# Lightning zählt die Epochen des Basismodells mit: Ziel = deren Epoche + Zusatz
BASIS_EPOCHE=$(basename "$BASIS" | sed -n 's/.*epoch=\([0-9]*\).*/\1/p')
ZIEL=$(( ${BASIS_EPOCHE:-0} + ZUSATZ_EPOCHEN ))
echo "Starte bei: $START  →  bis Epoche $ZIEL (Batch $BATCH)"

python3 -m piper_train \
  --dataset-dir "$TRAIN" --accelerator gpu --devices 1 --batch-size "$BATCH" \
  --validation-split 0.0 --num-test-examples 0 --max_epochs "$ZIEL" \
  --resume_from_checkpoint "$START" --checkpoint-epochs 1 --precision 32 \
  --quality "$QUALITAET" --max-phoneme-ids 400
