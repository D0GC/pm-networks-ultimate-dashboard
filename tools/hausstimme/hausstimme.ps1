# PM Hausstimme – Steuerung unter Windows (PowerShell, im Ordner dieser Datei ausführen)
#   .\hausstimme.ps1 pruefen          Grafikkarte in Docker testen
#   .\hausstimme.ps1 proben           Stimmproben entwerfen (proben\NN.wav)
#   .\hausstimme.ps1 mehr             weitere Proben
#   .\hausstimme.ps1 waehlen 07       Probe 07 als Hausstimme festlegen
#   .\hausstimme.ps1 test             Datensatz mit 20 Sätzen ausprobieren
#   .\hausstimme.ps1 datensatz        alle Sätze sprechen lassen und prüfen (fortsetzbar)
#   .\hausstimme.ps1 training         Piper nachtrainieren (fortsetzbar, Strg+C beendet)
#   .\hausstimme.ps1 export           Stimme ausgeben + Hörproben (fertig\)
param([Parameter(Position = 0)][string]$Schritt = "hilfe", [Parameter(Position = 1)][string]$Wert = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
switch ($Schritt) {
  "pruefen"   { docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi }
  "proben"    { docker compose run --rm proben python3 skripte/proben.py }
  "mehr"      { docker compose run --rm proben python3 skripte/proben.py --mehr }
  "waehlen"   { docker compose run --rm proben python3 skripte/proben.py --waehlen $Wert }
  "test"      { docker compose run --rm datensatz python3 skripte/datensatz.py --anzahl 20 }
  "datensatz" { docker compose run --rm datensatz python3 skripte/datensatz.py }
  "training"  { docker compose run --rm training bash skripte/training.sh }
  "export"    { docker compose run --rm training bash skripte/export.sh }
  default     { Get-Content $PSCommandPath | Select-Object -Skip 1 -First 9 }
}
