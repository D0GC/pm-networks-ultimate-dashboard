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
| `haustueroeffner` | Haustür-Öffner in der Gruppe Zugang (neben den Schlössern) |
| `klima_praefix` | Nur Thermostate mit diesem Präfix (Standard `climate.pm_`); ohne Bereich Zuordnung über den Namen |
| `klima_studio_url` | Interne Adresse von PM Klima Studio (Standard `http://bdf1cc64-pm-klima-studio:8099`) |
| `klima_studio_schluessel` | Mindestens 16 Zeichen; derselbe Wert wie `panel_schluessel` in PM Klima Studio (ab 1.2.2). Dann erscheint „Klima Studio“ als Seite im Panel |

### PM Klima Studio im Panel

Das Panel läuft ohne Anmeldung bei Home Assistant und kann Klima Studio daher nicht über Ingress öffnen. PM Panel
Studio reicht Klima Studio deshalb selbst durch:

1. Einen zufälligen Schlüssel mit mindestens 16 Zeichen wählen.
2. In PM Klima Studio unter Konfiguration als `panel_schluessel` eintragen und die App neu starten.
3. In PM Panel Studio als `klima_studio_schluessel` eintragen und die App neu starten.

Danach erscheint „Klima Studio“ in der Modulleiste und auf der Seite Klima. Ohne Schlüssel bleibt Klima Studio wie
bisher nur über die Seitenleiste erreichbar.

### Energiefluss

Die Seite Energie zeigt den Verbrauch kaskadiert wie das Energie-Dashboard von Home Assistant. Grundlage sind
allein dessen Einstellungen (Einstellungen → Dashboards → Energie): Geräte unter „Einzelne Geräte“, die
Kaskade über „Vorgelagertes Gerät“ (`included_in_stat`), dazu Netzbezug, Solar und Batterie. Neue Zähler dort
eintragen genügt; am Panel ist nichts zu ändern. Ist die Seite Energie offen, übernimmt sie Änderungen dort
innerhalb einer Minute.

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
  --unsafely-treat-insecure-origin-as-secure="http://homeassistant.local:8098" \
  --use-fake-ui-for-media-stream \
  --check-for-update-interval=31536000 --overscroll-history-navigation=0 \
  --user-data-dir="$HOME/.config/pm-panel" "http://homeassistant.local:8098/"
```

Die beiden Zeilen `--unsafely-treat-insecure-origin-as-secure` und `--use-fake-ui-for-media-stream` braucht das
Gegensprechen an der Haustür: Browser geben das Mikrofon sonst nur über HTTPS frei, und das Panel hat niemanden, der
die Mikrofon-Abfrage bestätigt. Die Adresse muss genau der im Kiosk geöffneten entsprechen (Schema, Name, Port).

`--autoplay-policy=no-user-gesture-required` erlaubt den Hinweiston bei Meldungen mit Priorität hoch auch ohne
vorherige Berührung, ebenso den Klingelton am Haustür-Overlay (siehe „Gegensprechen an der Haustür“). Ohne den
Parameter spielt das Panel Ton erst nach der ersten Berührung seit dem Start; nach einem Neuladen klingelt es also erst
wieder, wenn das Panel einmal berührt wurde.

Beim ersten Start einmal die Adresse mit `?token=…` aus dem Editor öffnen. Bildschirmschoner und Energiesparen des
Desktops abschalten; die App dunkelt selbst ab. Für den Autostart eine `.desktop`-Datei unter `~/.config/autostart/`
mit obiger Befehlszeile anlegen.

## Meldungen

Der Flur zeigt alle Meldungen, die über `script.panel_meldung` an die Panels Büro und Bad gehen, mit derselben
Gliederung (Symbol, Priorität, Bestätigen/Später). Ein Browser-Mod-Popup mit gleicher Kennung liefert den
ausführlichen Text (etwa das Morgen-Briefing). Geschlossen wird mit `script.panel_meldung_schliessen` oder
`browser_mod.close_popup` derselben Kennung, sonst nach der Laufzeit. Im Editor abwählbar („Panel-Meldungen“).

### Stufen

`script.panel_meldung` nimmt im Feld `stufe` (oder wie bisher `prioritaet`) eine von vier Stufen. Nacht heißt: Sonne
unter dem Horizont (`sun.sun`).

| Stufe | Verhalten | Laufzeit |
|-------|-----------|----------|
| `passiv` | nur Glocke, keine Feed-Karte; weckt nie, kein Popup, kein Ton | 15 min |
| `aktiv` | weckt das Panel (nachts nicht); Popup nur, wenn das Panel schon wach war; kein Ton | 60 min |
| `zeitkritisch` | weckt, Popup, einmal kurzer Ton, gelbes Rahmenglühen; nachts nur Feed und Glocke | 120 min |
| `kritisch` | durchbricht Ruhe und Nacht, Popup, Rahmenglühen; Ton bis zur Bestätigung (höchstens 3 × alle 20 s) | 240 min |

Alte Werte gelten weiter: `high` = kritisch, `normal` = aktiv, `low` = passiv; fehlt die Angabe, ist es aktiv. Der Ton
folgt der Einstellung „Ton bei hoher Priorität“ (`ton_hoch`) und `input_boolean.alles_stumm` (Sicherheitsmeldungen
ausgenommen). Der Klingelton der Haustür ist davon unabhängig (siehe „Gegensprechen an der Haustür“). Passive
Meldungen erscheinen jetzt auch als Karte im Feed (zuvor nur unter der Glocke).

### Reihenfolge im Feed

Der Feed ist nach Relevanz (0–100) sortiert und rotiert wie zuvor; je höher die Relevanz, desto etwas länger die
Verweildauer (× 0,8 bis × 1,4). Beispiele: Eilmeldung und Warnung ab Stufe 2 100, kritische Meldung 100, zeitkritische 90,
Timer kurz vor Ende (unter 2 min) 95, sonst 70, Termin 60 + 35 · (1 − Rest/3 h), Müll am Vorabend ab 18 Uhr und morgens
vor der Abholung 80 (sonst 30), Lüften und Offen 55, Wetterwechsel 45, übrige Hinweise 40, „Alles in Ordnung“ 10.

## Hinweise eigens für den Flur

Vorgabe ist die Hinweisliste des Bads. Eine eigene Liste entsteht, indem in `panel_hinweise.jinja` ein Panel `flur`
ergänzt und unter `template:` ein Sensor `sensor.panel_flur_hinweise` angelegt wird (Muster: Bad). Danach in den
Optionen `hinweise_entitaet` umstellen. Einzelne Kartentypen lassen sich auch ohne das im Editor ausblenden.

## Gegensprechen an der Haustür

Voraussetzung ist die Integration **PM Ring Intercom** (Repository `D0GC/pm-networks-ring`). Wechselt einer der
Auslöser aus `intercom_ausloeser` (Standard `binary_sensor.haustur_klingelt`) auf „an“, zeigt das Panel das Overlay
„Haustür“ mit drei Knöpfen: Schließen, **Sprechen** und Tür öffnen (2 Sekunden halten, öffnet `haustueroeffner`).

- *Sprechen* öffnet ein Gespräch mit der Ring Intercom. Das Mikrofon des Panels geht an die Haustür, der Ton der
  Haustür kommt aus dem Lautsprecher des Panels. *Auflegen* beendet es, ebenso Schließen oder das Ende des Overlays.
- Während eines Gesprächs bleibt das Overlay offen.
- Die App vermittelt nur den Verbindungsaufbau (WebRTC über Home Assistant), der Ton läuft direkt zwischen Panel und
  Ring.
- Ohne freigegebenes Mikrofon meldet das Panel „Mikrofon gesperrt“. Dann fehlen die Chromium-Parameter oben.
- Test ohne Klingeln: im Editor „Haustür testen“ (spielt auch den Klingelton).

Ob Ring für die Intercom eine Live-Sitzung annimmt, zeigt der erste Versuch. Den Verlauf der Signalisierung enthält
die Diagnose der Integration PM Ring Intercom.

### Klingelton

Zusammen mit dem Overlay „Haustür“ spielt das Panel ein zweitöniges „Ding-Dong“, das es selbst erzeugt (Web Audio,
keine Datei). Es unterscheidet sich vom dreistimmigen Hinweiston bei Meldungen.

- Der Ton erklingt einmal und nach etwa 4,5 Sekunden ein zweites Mal, solange das Overlay offen ist und kein Gespräch
  läuft. Klingelt es bei offenem Overlay erneut, klingelt auch das Panel erneut (mindestens 3 Sekunden Abstand). Der
  Server zählt dazu im Ereignis das Feld `klingel` hoch; Overlays für Person und Ereignis klingeln nicht.
- Er endet sofort, wenn das Overlay schließt oder ein Gespräch beginnt, damit das Mikrofon ihn nicht aufnimmt.
- Nach einem Neuladen oder einer neuen Verbindung (etwa nach einem Update der App) bleibt das Panel stumm, auch wenn das
  Overlay gerade offen ist.
- Der Ton ist immer voll: `input_boolean.alles_stumm`, Finn, Gina lernt und die Nachtabsenkung gelten für ihn nicht.
  Im Editor lassen sich „Lautstärke Klingelton“ (`klingel_lautstaerke`, 5–100 %, Standard 100) und der Schalter
  „Klingelton beim Haustür-Overlay“ (`ton_klingel`) einstellen; die Lautstärke des Hinweistons gilt hier nicht.
- Ohne `--autoplay-policy=no-user-gesture-required` (siehe Kiosk) spielt Chromium nach einem Neuladen erst nach der
  ersten Berührung des Panels Ton ab.
