# PM Panel Studio

Wandpanel-Oberfläche für den Flur (Surface Go 2, 1920 × 1280). Die App hält die Verbindung zu Home Assistant, berechnet
Karten und Zustände selbst und schickt dem Panel nur fertige Änderungen.

## Zugänge

| Zugang | Zweck |
|--------|-------|
| Seitenleiste „Panel Studio“ (Ingress) | Editor: Verhalten, Schnellzugriff, Module, Räume, Karten; Panel-Adresse; Vorschau |
| `http://<Home-Assistant>:8098/?token=…` | Das Wandpanel selbst. Der Schlüssel steht im Editor. Nach dem ersten Aufruf merkt sich der Browser den Zugang (Cookie) |

Der Zugangsschlüssel liegt in `/data/panel_token`. „Neuen Schlüssel erzeugen“ im Editor trennt alle Panels.

## Optionen

| Option | Bedeutung |
|--------|-----------|
| `hinweise_entitaet` | Sensor mit Attribut `zeilen` (Format der Panels Bad und Büro). Vorgabe `sensor.panel_bad_hinweise` |
| `bewegung` | Bewegungsmelder, die das Panel wecken |
| `personen` | Personen auf der Startseite |
| `wetter_entitaet`, `aussentemperatur` | Wetter und große Temperaturanzeige |
| `alarm_entitaet` | Alarmanlage für die Statuszeile |
| `ereignis_ausloeser` | Wird eine dieser Entitäten „an“, erscheint die Kamera im Vollbild |
| `ereignis_kamera`, `tueroeffner` | Kamera und Türöffner im Overlay |
| `klima_praefix` | Nur Thermostate mit diesem Präfix (Standard `climate.pm_`); ohne Bereich Zuordnung über den Namen |

## Schutz am Panel

- Entriegeln, Öffnen und Türöffner lösen erst nach 2 Sekunden Halten aus; die Bedingung wird beim Drücken geprüft.
- Unscharf schalten nur nach 2 Sekunden Halten, mit Code, falls die Alarmanlage einen verlangt.
- Gesperrte Dienste am Panel: `hassio`, `recorder`, `backup`, `shell_command`, `rest_command`, `python_script`,
  `pyscript`, `logger`, `system_log`, `frontend`, `lovelace`, `cloud`, `ffmpeg`; bei `homeassistant` nur
  `turn_on`, `turn_off`, `toggle`, `update_entity`.
- Lesende Abfragen nur über eine feste Liste (To-dos, Verlauf, Logbuch, Kalender, Statistik).

## Kiosk auf dem Surface (Linux)

Chromium mit eigenem, dauerhaftem Profil starten (nicht inkognito, sonst geht der Zugang verloren):

```sh
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 --overscroll-history-navigation=0 \
  --user-data-dir="$HOME/.config/pm-panel" "http://homeassistant.local:8098/"
```

`--autoplay-policy=no-user-gesture-required` erlaubt den Hinweiston bei Meldungen mit Priorität hoch auch ohne
vorherige Berührung. Ohne den Parameter spielt das Panel Ton erst nach der ersten Berührung seit dem Start.

Beim ersten Start einmal die Adresse mit `?token=…` aus dem Editor öffnen. Bildschirmschoner und Energiesparen des
Desktops abschalten; die App dunkelt selbst ab. Für den Autostart eine `.desktop`-Datei unter `~/.config/autostart/`
mit obiger Befehlszeile anlegen.

## Meldungen

Der Flur zeigt alle Meldungen, die über `script.panel_meldung` an die Panels Büro und Bad gehen, mit derselben
Gliederung (Symbol, Priorität, Bestätigen/Später). Ein Browser-Mod-Popup mit gleicher Kennung liefert den
ausführlichen Text (etwa das Morgen-Briefing). Geschlossen wird mit `script.panel_meldung_schliessen` oder
`browser_mod.close_popup` derselben Kennung, sonst nach der Laufzeit. Im Editor abwählbar („Panel-Meldungen“).

## Hinweise eigens für den Flur

Vorgabe ist die Hinweisliste des Bads. Eine eigene Liste entsteht, indem in `panel_hinweise.jinja` ein Panel `flur`
ergänzt und unter `template:` ein Sensor `sensor.panel_flur_hinweise` angelegt wird (Muster: Bad). Danach in den
Optionen `hinweise_entitaet` umstellen. Einzelne Kartentypen lassen sich auch ohne das im Editor ausblenden.
