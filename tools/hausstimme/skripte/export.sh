#!/usr/bin/env bash
# Schritt 4: jüngsten Checkpoint als Piper-Stimme ausgeben und Hörproben erzeugen. Geht auch während des Trainings
# (in einem zweiten Fenster), um den Stand anzuhören.
set -euo pipefail
QUALITAET="${QUALITAET:-medium}"
NAME="de_DE-pm_hausstimme-$QUALITAET"
TRAIN=/arbeit/training
FERTIG=/arbeit/fertig
mkdir -p "$FERTIG"
CKPT=$(ls -t "$TRAIN"/lightning_logs/version_*/checkpoints/*.ckpt 2>/dev/null | head -n1 || true)
[ -n "$CKPT" ] || { echo "Noch kein Checkpoint. Zuerst: hausstimme.ps1 training"; exit 1; }
echo "Exportiere $CKPT"
python3 -m piper_train.export_onnx "$CKPT" "$FERTIG/$NAME.onnx"
python3 - "$TRAIN/config.json" "$FERTIG/$NAME.onnx.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1], encoding="utf-8"))
c["dataset"] = "pm_hausstimme"
c.setdefault("language", {})["code"] = "de_DE"
json.dump(c, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
EPOCHE=$(basename "$CKPT" | sed -n 's/.*epoch=\([0-9]*\).*/\1/p')
while IFS= read -r satz; do
  [ -n "$satz" ] || continue
  i=$(( ${i:-0} + 1 ))
  echo "$satz" | python3 -m piper -m "$FERTIG/$NAME.onnx" -f "$FERTIG/probe_epoche${EPOCHE}_$i.wav" >/dev/null 2>&1
done <<'SAETZE'
Guten Abend, Sir. Willkommen zu Hause.
Die Haustür ist verriegelt, die Alarmanlage ist scharf geschaltet.
Im Wohnzimmer liegt die Temperatur bei einundzwanzig Grad. Ich empfehle, kurz zu lüften.
Selbstverständlich, Sir. Ich melde mich, sobald die Waschmaschine fertig ist.
SAETZE
echo "Fertig: $FERTIG/$NAME.onnx (+ .onnx.json), Hörproben: $FERTIG/probe_epoche${EPOCHE}_*.wav"
