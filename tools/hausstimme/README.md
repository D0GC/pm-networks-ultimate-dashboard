# PM Hausstimme – eigene Piper-Stimme ohne Aufnahmen

Eine eigene, ruhige und kräftige Männerstimme für Home Assistant, die wie die bisherige Jarvis-Stimme lokal in
Piper läuft. Niemand muss etwas einsprechen. Das Paket läuft auf einem Windows-PC mit NVIDIA-Grafikkarte
(ausgelegt für eine RTX 3060 Ti mit 8 GB).

| Schritt | Was passiert | Werkzeug (Lizenz) | Dauer etwa |
|---|---|---|---|
| 1 Proben | Stimmen aus einer Beschreibung entwerfen, die beste auswählen | Parler-TTS mini multilingual (Apache 2.0) | 10 min |
| 2 Datensatz | 1.462 Sätze in der gewählten Stimme sprechen lassen, jede Aufnahme prüfen | Chatterbox Multilingual (MIT), faster-whisper (MIT) | 3–5 h |
| 3 Training | deutsches Piper-Modell „thorsten“ (CC0) auf die neue Stimme nachtrainieren | rhasspy/piper (MIT) | 8–20 h |
| 4 Export | Stimme für Piper ausgeben, Hörproben | Piper | 2 min |

Die Sätze stammen aus der gemeinfreien Satzsammlung von Mozilla Common Voice (CC0) und aus eigenen Hausansagen
(`saetze/`, Quellen in `saetze/QUELLEN.md`). Chatterbox versieht seine Ausgaben mit einem unhörbaren Wasserzeichen;
für das Training spielt das keine Rolle.

## Einmalig einrichten

1. **NVIDIA-Treiber** aktuell halten (GeForce Experience oder nvidia.de).
2. **Docker Desktop** installieren (docker.com), beim Einrichten „WSL 2“ verwenden. Die Grafikkarte reicht Docker
   Desktop unter WSL 2 von selbst durch.
3. Diesen Ordner `tools/hausstimme` auf den PC kopieren, auf ein Laufwerk mit **mindestens 40 GB frei**.
4. PowerShell in diesem Ordner öffnen (im Explorer: Umschalt + Rechtsklick → „PowerShell-Fenster hier öffnen“).
   Falls Windows Skripte blockiert, einmalig: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
5. Grafikkarte prüfen:

   ```powershell
   .\hausstimme.ps1 pruefen
   ```

   Es muss eine Tabelle mit „RTX 3060 Ti“ erscheinen.

Beim ersten Aufruf jedes Schritts baut Docker die Umgebung und lädt die Modelle; das dauert einmalig 10–20 Minuten.

## 1 · Stimme entwerfen

```powershell
.\hausstimme.ps1 proben
```

Im Ordner `proben\` liegen danach zwölf Hörproben (`01.wav` …). Gefällt keine, `.\hausstimme.ps1 mehr` erzeugt
weitere. Die Beschreibungen stehen oben in `skripte\proben.py` und lassen sich frei ändern (englisch beschreiben,
z. B. „deeper“, „slower“, „warmer“). Die beste Probe festlegen:

```powershell
.\hausstimme.ps1 waehlen 07
```

Sie wird zu `referenz.wav` – das ist ab jetzt die Hausstimme.

**Akzent in den Proben?** Parler hat Deutsch aus Hörbuchaufnahmen gelernt; manche Stimmen klingen dadurch regional
gefärbt. Dann hilft der zweite Weg:

```powershell
.\hausstimme.ps1 vorlagen
```

Drei männliche Piper-Stimmen in klarem Hochdeutsch (thorsten, karlsson, pavoque) sprechen den Probetext etwas
langsamer, jeweils in Originallage sowie zwei und vier Halbtöne tiefer. Die neun Proben kommen fortlaufend nummeriert
dazu und werden genauso mit `waehlen NN` übernommen. Chatterbox übernimmt in Schritt 2 daraus Klangfarbe und
Aussprache und spricht alles neu; die Absenkung klingt dort natürlich. Dieser Befehl nutzt die Trainingsumgebung –
beim ersten Mal wird sie gebaut (einmalig 10–20 Minuten), Schritt 3 profitiert davon.

## 2 · Datensatz erzeugen

Erst ein kurzer Versuch mit 20 Sätzen, dann alles:

```powershell
.\hausstimme.ps1 test
.\hausstimme.ps1 datensatz
```

Die Aufnahmen liegen in `datensatz\wav\`; reinhören lohnt sich. Jeder Satz wird von Whisper zurückerkannt und nur
übernommen, wenn er stimmt und das Tempo passt (Bericht: `datensatz\bericht.csv`). Abbrechen mit Strg+C ist
jederzeit möglich, ein erneuter Aufruf setzt fort. Klingt die Stimme im Datensatz zu lebhaft oder zu schnell: in
`skripte\datensatz.py` oben `exaggeration` senken (ruhiger) bzw. `cfg_weight` senken (langsamer).

## 3 · Piper trainieren

```powershell
.\hausstimme.ps1 training
```

Läuft über Nacht. Standard sind 1.500 zusätzliche Epochen; ändern mit z. B.
`$env:ZUSATZ_EPOCHEN=800; .\hausstimme.ps1 training`. Wird der Grafikspeicher knapp („CUDA out of memory“):
`$env:BATCH=12`. Strg+C beendet, ein erneuter Aufruf setzt beim letzten Stand fort.

## 4 · Exportieren und anhören

Geht auch während des Trainings in einem zweiten PowerShell-Fenster:

```powershell
.\hausstimme.ps1 export
```

Ergebnis in `fertig\`:

- `de_DE-pm_hausstimme-medium.onnx` und `de_DE-pm_hausstimme-medium.onnx.json` – die Stimme
- `probe_epocheNNNN_1.wav` … – Hörproben des aktuellen Stands

Meist klingt es nach einigen hundert Epochen schon gut; besser wird es bis etwa 1.500.

## 5 · In Home Assistant einsetzen

1. Die beiden Dateien `de_DE-pm_hausstimme-medium.onnx` und `.onnx.json` in den Ordner **`share/piper`** von Home
   Assistant kopieren (über die Samba-Freigabe: `\\homeassistant\share\piper`; Ordner anlegen, falls er fehlt).
2. Die App **Piper** neu starten.
3. Bescheid geben – die Pipelines und Ansagen stellt Claude dann auf die neue Stimme um. Piper bleibt dabei die lokale
   Sprachausgabe; die bisherige Jarvis-Stimme bleibt als Rückfall erhalten.

## Wenn etwas hakt

| Meldung | Abhilfe |
|---|---|
| `could not select device driver "nvidia"` | Docker Desktop aktualisieren, WSL 2 aktiv, NVIDIA-Treiber aktuell |
| `CUDA out of memory` | `$env:BATCH=12` (Training) bzw. andere Programme mit Grafiklast schließen |
| `Kein Checkpoint unter de/de_DE/thorsten/medium` | `$env:QUALITAET="high"; .\hausstimme.ps1 training` (größer, langsamer) |
| Viele Sätze „verworfen“ | `bericht.csv` ansehen; meist hilft eine klarere Referenzprobe |
