# PM Panel Studio

Wandpanel-Oberfläche für Home Assistant (ausgelegt auf Tablets im Querformat, z. B. 1920 × 1280). Die App hält die Verbindung zu Home Assistant, berechnet
Karten und Zustände selbst und schickt dem Panel nur fertige Änderungen.

## Zugänge

| Zugang | Zweck |
|--------|-------|
| Seitenleiste „PM Dashboard“ (Ingress, nur Administratoren) | Admin-Ansicht am PC (siehe unten); Editor unter „Editor“ oder `…/editor`, Panel-Vorschau unter `…/panel` |
| `http://<Home-Assistant>:8098/?token=…` | Das Wandpanel selbst. Der Schlüssel steht im Editor. Nach dem ersten Aufruf merkt sich der Browser den Zugang (Cookie) |

Der Zugangsschlüssel liegt in `/data/panel_token`. „Neuen Schlüssel erzeugen“ im Editor trennt alle Panels.

## Admin-Ansicht am PC

Der Seitenleisten-Eintrag „PM Dashboard“ zeigt die Oberfläche des Wandpanels für Maus und großes Fenster, eingebettet
in Home Assistant (Seitenleiste, Benachrichtigungen und Einstellungen bleiben erreichbar).

- **Modulleiste links:** alle Module des Panels, darunter die Admin-Seiten Türdienst, System, Terminal und Editor.
- **Kopfzeile:** Uhr, Wetter, Anwesenheit, Statuspillen, Suche (Taste `/`) und Meldungsglocke.
- **Startseite:** Blöcke im Raster aus 12 Spalten. „Anpassen“ verschiebt Blöcke (Pfeile), zieht sie am Griff unten
  rechts frei auf jede Breite und Höhe, blendet sie aus und fügt weitere hinzu; der Inhalt passt sich der Blockgröße
  an. „Speichern“ legt die Anordnung in `admin_start` ab (`block:breite:höhe`). Blöcke:
  Aufmerksamkeit (nicht erreichbare Geräte, Meldungen, offene Fenster, schwache Batterien, Updates, neue
  Türnachricht), Hinweise (die Karten des Feeds als Liste), Türen, Klima, Räume, Schnellzugriff (inklusive PCs und
  Wake on LAN), Energie, Pakete, Medien, Termine, Einkauf, Angebote, Sicherheit.
- **Türdienst:** die letzten 60 Nachrichten mit Abschrift und Wiedergabe, die Einstellungen im Überblick, Haustür öffnen.
- **System:** Systemzustand, Verbindungen der App, offene Meldungen, Sprünge zu Automationen, Geräten, Protokollen
  und weiteren Seiten von Home Assistant.
- **Dateien:** Dateimanager für die Ordner Home Assistant (Konfiguration), share, media, App-Konfigurationen, ssl und
  backup, alle beschreibbar. Hochladen (auch per Ziehen und Ablegen), Herunterladen (Ordner als ZIP), Textdateien
  bearbeiten (Strg+S), anlegen, umbenennen, löschen. Nur für Administratoren: jede Anfrage wird über Home Assistant
  geprüft; über den Panel-Port nicht erreichbar. Achtung: Änderungen an der Konfiguration wirken wie im Editor von
  Home Assistant, ein Fehler in `configuration.yaml` kann den Neustart verhindern.
- **Terminal:** die App „Advanced SSH & Web Terminal“ (oder „Terminal & SSH“) über Ingress eingebettet; sie muss
  installiert und gestartet sein.

- **Schnellsuche:** Strg+K oder „e“ durchsucht Seiten, Bereiche, Geräte, Automationen, Skripte und Entitäten; „c“
  (oder „>“ im Suchfeld) zeigt Befehle wie „Automationen neu laden“ oder „Home Assistant neu starten“.
- **Automationen:** nach Kategorien gruppiert, ein- und ausschalten, ausführen, Verlauf, bearbeiten im Editor von
  Home Assistant.
- **Entitäten und Geräte:** ausblenden, deaktivieren und wieder aktivieren; der Detaildialog jeder Entität hat
  dafür ebenfalls eine Zeile „Verwaltung“. Diese Funktionen nutzen die Verbindung des angemeldeten Benutzers und
  stehen in der Seitenleiste und in der eigenen App bereit.
- **Netzwerk:** Internet (Latenz, Ping, Download, Upload, Durchsatz, Speedtest starten), Clients und alle
  UniFi-Geräte mit Zustand, Auslastung, Temperatur und Updates. Dafür in den App-Optionen „UniFi: API-Schlüssel“
  eintragen (UniFi Network → Einstellungen → Control Plane → Integrationen → API-Schlüssel erstellen) oder Benutzer und
  Kennwort eines lokalen Kontos; die Adresse des Gateways (z. B. `https://192.168.1.1`) steht in den App-Optionen. Ohne Zugang zeigt die Seite die
  Daten der UniFi-Integration von Home Assistant.
- **Home Assistant:** Einstellungen, Karte, Energie und Music Assistant öffnen sich als Seiten im Dashboard, ohne
  die Seitenleiste von Home Assistant.

**Als eigene App:** `http://<Home-Assistant>:8123/local/pm-dashboard/index.html` (bzw. die externe Adresse) zeigt das Dashboard
im Vollbild ohne Oberfläche von Home Assistant. Die App legt diese Startseite beim Start im Ordner `www` ab. Die
Anmeldung läuft über das Konto von Home Assistant; wer im selben Browser schon angemeldet ist („Angemeldet bleiben“),
landet direkt im Dashboard. Über HTTPS (z. B. Home Assistant Cloud) lässt sich die Seite im Browser als App
installieren. Fehlte der Ordner `www`, ist ein Neustart von Home Assistant nötig, bevor `/local/` ihn ausliefert.

Am PC gibt es keinen Ruhezustand und keine Rückkehr zur Startseite nach Zeit. Klicks am PC wecken das Wandpanel
nicht. Klingelt es, erscheint unten rechts ein Hinweis mit Sprechen und Türöffner.

## Lizenz

PM Panel Studio ist in der geschlossenen Beta. Ohne gültigen Lizenzschlüssel startet die App nur im
**Einrichtungsmodus**: keine Verbindung zu Home Assistant, kein Türdienst, kein Telefon. Wandpanel und Admin-Ansicht
zeigen „Freischaltung erforderlich“ mit der **Installations-ID**, der Editor nur den Reiter „Lizenz“.

| Schlüssel | Stable | Beta-Kanal und Testinstanz | Funktionen |
|-----------|--------|----------------------------|------------|
| keiner | Einrichtungsmodus | Einrichtungsmodus | keine |
| Closed Beta | nutzbar | gesperrt | alle (außer dem Beta-Kanal) |
| Developer | nutzbar | nutzbar | immer alle; ein Closed-Beta-Schlüssel ist nicht nötig |

So geht es: Die Installations-ID aus dem Editor (Einstellungen → Lizenz) an PM Networks senden, den erhaltenen
Schlüssel (`PMPS1.…`) dort einfügen und „Freischalten“ wählen. Die App startet sofort, ohne Neustart. Ein Schlüssel
in den App-Optionen (`lizenzschluessel`) gilt zusätzlich zu den im Editor eingetragenen.

- **Mehrere Schlüssel:** Eine Installation nimmt beliebig viele Schlüssel auf, etwa je gekauftem Paket einen.
  Weitere Schlüssel unter „Weiteren Schlüssel hinzufügen“ eintragen; vorhandene bleiben gültig. Freigeschaltet ist
  alles, was die nutzbaren Schlüssel zusammen enthalten. Der Editor listet jeden Schlüssel mit Art, Funktionen,
  Laufzeit und Zustand; einzelne lassen sich entfernen (wirkt ab dem nächsten Start).
- Die Schlüssel sind signiert und werden ohne Internet geprüft. Einzige Verbindung: Beim Start und alle 12 Stunden
  holt die App die signierte **Sperrliste** von pm-networks.com (ein reiner Abruf, es werden keine Daten der
  Installation gesendet). Ein gesperrter Schlüssel (z. B. nach Erstattung) erscheint ab dem nächsten Start als
  „gesperrt“ und schaltet nichts mehr frei. Ohne Internet gilt die zuletzt geholte Liste.
- Closed-Beta-Schlüssel gelten für eine Installation, Developer-Schlüssel auf jeder.
- Läuft ein Schlüssel ab, bleiben 7 Tage Kulanz; 14 Tage vorher zeigt der Editor einen Hinweis. Gesperrt wird nur beim
  Start der App, nie im laufenden Betrieb, damit Alarmanlage, Türöffner und Klingel nicht plötzlich ausfallen.
- Wer den Schlüssel entfernt, behält die Freischaltung bis zum nächsten Start der App.

## Einrichtung

**Beim ersten Start** erkennt die App passende Entitäten selbst und übernimmt die sicher erkannten (zum Beispiel
Personen, Bewegungsmelder am Flur, Wetter, Klingel, Türöffner, Waschmaschine, Spüler, Saugroboter). Das Panel
arbeitet damit sofort; die Einrichtung meldet, was übernommen wurde, und „Einrichtung speichern“ bestätigt es.
Jedes Feld zeigt weitere **Vorschläge**, „Leere Felder mit Vorschlägen füllen“ übernimmt alle. Wo ein Helfer nötig
ist, legt **„Helfer anlegen“** ihn direkt in Home Assistant an. Die Shisha-Seite erscheint erst mit dem Haken
„Shisha-Seite verwenden“ unter **Startseite und Leiste** → Module in der Leiste.

**Einrichtungsassistent:** Beim ersten Öffnen führt ein Assistent Schritt für Schritt durch Zuhause, Haustür und
Klingel, Haushaltsgeräte, Hinweise und Fahrten sowie die Verbindung zum Wandpanel. Jeder Schritt speichert für sich
und lässt sich überspringen; „×“ schließt ihn und setzt beim nächsten Öffnen fort. Nach „Fertig“ erscheint er nicht
mehr. Offene Punkte und weitere Zuordnungen tragen Sie unter Einrichtung nach; **„Einrichtung neu starten“** ruft den
Assistenten erneut auf. Bestehende Installationen gelten als eingerichtet.

Ab Werk ist nichts fest vorgegeben: Jede Installation wählt ihre Entitäten im Editor unter **Einrichtung**
(Seitenleiste „PM Dashboard“ → Einstellungen). Leere Felder schalten die jeweilige Funktion ab. Die Einrichtung ist in
Bereiche gegliedert; jeder zeigt, wie viel zugeordnet ist, und lässt sich auf- und zuklappen. Entitäten wählt eine
Suche nach Name oder Kennung, mehrere erscheinen als Chips. „Exportieren“ und „Importieren“ sichern die Zuordnungen
als JSON-Datei.

| Bereich | Inhalt |
|---------|--------|
| Zuhause | Personen, Bewegungsmelder am Panel, Wetter, Außentemperatur, weitere Außenwerte, Regenmenge, Alarmanlage, Schalter „Alles stumm“ |
| Haustür und Klingel | Klingeldienst (keine Klingel, jede Klingel, Ring Intercom), Klingel-Auslöser, Kamera, Türöffner, Schloss, Lautsprecher an der Tür, weitere Klingelsignale |
| Kamera bei Ereignissen | Auslöser (z. B. Person an der Wohnungstür), Kamera und Türöffner im Overlay |
| Haushaltsgeräte | Waschmaschine, Geschirrspüler, Saugroboter: je Gerät genügt die Hauptentität; Restzeit, Programme, Karte und Verbrauchsmaterial sucht das Panel am selben Gerät |
| Karten im Karussell | Hinweis-Sensor, Pakete, Eilmeldung, Sport (TeamTracker), Timer für Duschmodus und Spa |
| Shisha | Kohleanzünder, Timer, Stumm-Schalter, Leistung (die Seite ist ab Werk ausgeblendet) |
| Klima | Präfix der Thermostate (leer = alle), Adresse von PM Klima Studio |

**Gefühlte Temperatur:** Startseite (Wetter), Raumkacheln und die Raumansicht (Titelzeile des Thermostats) zeigen
„gefühlt“ neben der Temperatur. Die App rechnet nach Steadman (Formel des australischen Wetterdienstes BoM, wie die
iOS-App): `AT = T + 0,33·e − 0,70·v − 4,00`, `e` Dampfdruck in hPa aus der relativen Feuchte, `v` Wind in m/s. Außen
gelten die Außentemperatur, die Feuchte aus „Außenluftfeuchte“, einem Feuchtesensor unter „Weitere Außenwerte“ oder dem
Wetter und der Wind aus einem Windsensor dort oder dem Wetter (km/h, mph und Knoten werden umgerechnet); in Räumen
Temperatur und Luftfeuchte des Raums ohne Wind. Ohne Feuchtewert entfällt die Angabe, ebenso bei weniger als 1 °C
Abweichung außen und 0,5 °C innen. Sonnenstrahlung geht nicht ein; in praller Sonne fühlt es sich wärmer an als angezeigt.

Die Zuordnungen liegen in `/data/zuordnungen.json` und gehen den App-Optionen vor. Ältere Installationen, deren
Entitäten noch in den App-Optionen stehen, laufen unverändert weiter, bis die Einrichtung etwas anderes festlegt.

In den **App-Optionen** (Einstellungen → Apps → PM Panel Studio → Konfiguration) stehen nur noch Zugänge mit
Kennwort: Telefon und FRITZ!Box, UniFi, Proxmox und `klima_studio_schluessel` (mindestens 16 Zeichen; derselbe Wert
wie `panel_schluessel` in PM Klima Studio, ab 1.2.2).

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

## Kiosk am Wandpanel (Linux)

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

Lautstärke: Die App steuert den Ton bis zum vollen Ausschlag aus, lauter geht es nur über das System. Die
Lautsprecher mancher Tablets sind leise; unter Linux mit PipeWire oder PulseAudio lässt sich die Systemlautstärke über
100 % anheben. Dazu im Autostart vor Chromium `pactl set-sink-volume @DEFAULT_SINK@ 150%` ausführen (Werte über 150 %
verzerren meist hörbar) und prüfen, dass der Ausgang nicht stumm ist (`pactl set-sink-mute @DEFAULT_SINK@ 0`).

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
| `zeitkritisch` | weckt, Popup mit gelbem Halo, einmal kurzer Ton; nachts nur Feed und Glocke | 120 min |
| `kritisch` | durchbricht Ruhe und Nacht, Popup mit rotem Halo; Ton bis zur Bestätigung (höchstens 3 × alle 20 s) | 240 min |

Alte Werte gelten weiter: `high` = kritisch, `normal` = aktiv, `low` = passiv; fehlt die Angabe, ist es aktiv. Der Ton
folgt der Einstellung „Ton bei hoher Priorität“ (`ton_hoch`) und `input_boolean.alles_stumm` (Sicherheitsmeldungen
ausgenommen). Der Klingelton der Haustür ist davon unabhängig (siehe „Gegensprechen an der Haustür“). Passive
Meldungen erscheinen jetzt auch als Karte im Feed (zuvor nur unter der Glocke).

Halo statt Rahmenglühen: Bei `kritisch` (rot) und `zeitkritisch` (gelb) laufen drei Wellen im Abstand von 0,8 s dreimal
aus dem Rand des Popups nach außen; das frühere Blinken des Bildschirmrands entfällt. Bei abgeschalteten Animationen
(Einstellung „Animationen“) und mit `prefers-reduced-motion` bleibt das Popup ruhig.

### Reihenfolge im Feed

Der Feed ist nach Relevanz (0–100) sortiert und rotiert wie zuvor; je höher die Relevanz, desto etwas länger die
Verweildauer (× 0,8 bis × 1,4). Beispiele: Eilmeldung und Warnung ab Stufe 2 100, kritische Meldung 100, zeitkritische 90,
Timer kurz vor Ende (unter 2 min) 95, sonst 70, Termin 60 + 35 · (1 − Rest/3 h), Müll am Vorabend ab 18 Uhr und morgens
vor der Abholung 80 (sonst 30), Lüften und Offen 55, Wetterwechsel 45, übrige Hinweise 40, „Alles in Ordnung“ 10.
Pakete (höchster Wert der aktiven Sendungen): in Zustellung 75, Problem 70, heute erwartet oder abholbereit 60, sonst 40,
nur noch heute Zugestelltes 30.

Termine: Die Karte „Morgen“ erscheint von 20 bis 1 Uhr (nach Mitternacht als „Heute“ mit dem gerade begonnenen Tag, Relevanz 50).
Kalender aus der Einstellung „Stundenplan“ (Editor → Wartung und Daten) erzeugen weder „Als Nächstes“ noch „Morgen“; sie
zeigen täglich von 5:30 bis 9 Uhr die Karte „Stundenplan“ mit den Einträgen des Tages (Relevanz 55, abschaltbar im Editor).

### Pakete

Die Karte „Pakete“ liest den Paket-Sensor aus der Einrichtung und erscheint, wenn der Zustand (aktive
Sendungen) größer als 0 ist oder das Attribut `zugestellt_heute` größer als 0. Der Ring zeigt die Stufe der ersten Sendung
von 4, die Zahl die aktiven Sendungen; die Liste nennt bis zu fünf Sendungen mit Versender, Titel, Status und Termin. Ein
Tipp öffnet das Popup mit allen Sendungen (Stufenleiste, Termin, letztes Ereignis, Sendungsnummer). Die Hinweiszeilen
`paket` (nur bei gesetzter Option) und `spueler` des Hinweis-Sensors werden im Feed nicht gezeigt, weil es dafür eigene
Karten gibt. Im Editor
lässt sich die Karte unter „Pakete“ abwählen.

## Hinweise

Die App berechnet diese Hinweise selbst aus Home Assistant, ohne Vorlage und ohne Helfer:

| Hinweis | Quelle | Einstellbar |
|---------|--------|-------------|
| Offen | `binary_sensor` mit Geräteklasse Fenster, Tür, Öffnung, Garagentor (ohne Gruppen) | Ausnahmen (Einrichtung) |
| Lüften | Luftfeuchte und CO₂ je Raum (nur Sensoren mit Bereich, ohne Außensensoren) | Grenzwerte, Vorgabe 65 % und 1.200 ppm |
| Müll | Kalender von Waste Collection Schedule oder mit Müll/Abfall im Namen; heute, morgen ab 16 Uhr | Uhrzeit |
| Pollen | DWD-Pollenflug, Polleninformation oder `pollen` im Namen; morgens ab „mäßig“ | Stufe, Uhrzeit |
| Gerät fertig | Waschmaschine und Spüler der Einrichtung, bis zur Quittung, höchstens 12 h | Dauer |
| Fahrten | bis zu drei Fahrzeit-Sensoren (Einrichtung → Hinweise und Fahrten) | Zeitfenster, Arbeitstage |
| Eilmeldung | Eilmeldungs-Sensor der Einrichtung, bis 2 h nach Erscheinen | – |

**Eigene Hinweise** aus Automationen:

```yaml
action: event.fire
data:
  event_type: pm_panel_studio_hinweis
  event_data:
    titel: Besuch
    text: Oma kommt um 15 Uhr
    dauer_min: 120
```

Weitere Felder: `id` (zum gezielten Ersetzen), `wert`, `art` (Symbol, etwa `muell`, `offen`) und `loeschen: true`.

Ein eigener **Hinweis-Sensor** (Einrichtung → Karten im Karussell → Weitere Zuordnungen) ergänzt das: Er liefert im
Attribut `zeilen` je Zeile `schluessel|Titel|Wert|Hinweis`. Für Arten, die die App selbst kennt, gilt die App.
Einzelne Kartentypen lassen sich unter „Startseite und Leiste“ ausblenden.

## Klingel und Türdienst

Der **Klingeldienst** (Einrichtung → Haustür und Klingel) legt fest, was beim Klingeln geschieht:

| Klingeldienst | Verhalten |
|---------------|-----------|
| Keine Klingel | Kein Haustür-Overlay, kein Klingelbuch, kein Türdienst |
| Jede Klingel | Jede Klingel aus Home Assistant: `binary_sensor` (Wechsel auf „an“), `event` (z. B. `event.tuerklingel`), `button` oder `input_button` (jeder neue Zeitstempel). Overlay „Haustür“ mit Kamera und Türöffner, Klingelbuch, Türdienst über einen Lautsprecher |
| Ring Intercom | Zusätzlich **Sprechen** am Panel und der Türdienst mit eigener Sprechleitung (Anrufbeantworter mit Abschrift, optional KI-Gespräch). Voraussetzung ist die Integration **PM Ring Intercom** |

Klingelt es, zeigt das Panel das Overlay „Haustür“: Schließen, Tür öffnen (2 Sekunden halten) und mit Ring Intercom
**Sprechen**. Test ohne Klingeln: im Editor „Haustür testen“ (spielt auch den Klingelton).

Gegensprechen mit Ring Intercom: Das Mikrofon des Panels geht an die Haustür, der Ton der Haustür kommt aus dem
Lautsprecher des Panels. Die App vermittelt nur den Verbindungsaufbau (WebRTC über Home Assistant). Ohne freigegebenes
Mikrofon meldet das Panel „Mikrofon gesperrt“; dann fehlen die Chromium-Parameter oben.

### Türdienst

Der Türdienst ist ab Werk aus und wird im Editor unter „Türdienst“ eingeschaltet. Ist niemand aus den Personen zu
Hause, meldet er sich sofort, sonst nach der eingestellten Zeit ohne Öffnen.

**Mit jeder Klingel:** Die App spricht die Warteansage (Gruß nach Tageszeit) über den **Lautsprecher an der Tür**
(`media_player`, Einrichtung) und nach der Frist eine Abwesenheitsansage. Dann geht eine Push „Klingeln an der Haustür“
mit dem Kamerabild der Haustür an die eingestellten notify-Dienste. Ohne Lautsprecher entfällt die Ansage, die Push
bleibt.

**Mit Ring Intercom:** Die App nimmt das Gespräch selbst an (WebRTC mit aiortc, Signalisierung über PM Ring Intercom).

0. **Vorlauf:** Ring schaltet die Sprechleitung an der Tür erst einige Sekunden nach dem Verbindungsaufbau durch.
   Bis dahin läuft Stille (`pforte_vorlauf_s`, Vorgabe 3 s). Das Protokoll nennt bei jedem Klingeln die gemessenen
   Zeiten („verbunden …, erster Ton …“), danach lässt sich der Wert anpassen.
1. **Warteansage:** Gruß nach Tageszeit und eine Warteformel, etwa „Einen schönen guten Morgen. Einen Moment bitte,
   ich melde Sie im Haus an.“, danach die Wartemelodie „Abendglocke“ in Schleife. Grüße: Morgen 5–10 Uhr, Mittag
   11–13, Nachmittag 14–17, Abend 18–21, Nacht 22–4 Uhr. Die Formeln wechseln, nie zweimal hintereinander gleich.
2. **Anrufbeantworter:** Ansage mit Hinweis auf den Signalton, Signalton, Aufnahme. Sie endet nach 3 Sekunden Stille,
   nach 8 Sekunden ohne Sprache oder spätestens nach der längsten Nachricht.
3. **Auswertung:** Die Aufnahme liegt als WAV im Ordner `pforte_ordner` unter `/media` (z. B. ein Netzlaufwerk mit
   Verwendung „Medien“; leer = lokal unter `/media/pm_panel_studio/haustuer`; die letzten 60 bleiben). Je Tag ein
   Ordner, darin getrennt `wav` und `json` (Zeit, Länge, Abschrift). Ist die Freigabe nicht eingehängt, bleibt die
   Aufnahme lokal. Die Spracherkennung (Editor; leer = die erste in Home Assistant) schreibt sie ab. Die Abschrift
   geht per Push an die eingestellten notify-Dienste und erscheint als Meldung am Panel. Zusätzlich feuert das
   Ereignis `pm_panel_studio_haustuer` (`text`, `datei`, `dauer_s`, `nachricht`).

**Lautstärke und Test:** „Lautstärke an der Tür“ (0–100 %, Vorgabe 100 %) skaliert die Sprechleitung (100 % =
unverändert) bzw. setzt die Lautstärke des Lautsprechers an der Tür; dessen vorige Lautstärke stellt die App danach
wieder her. „An der Tür testen“ spielt eine Testansage und die Wartemelodie mit dem Wert des Reglers, auch
ungespeichert; „Hier anhören“ spielt dieselbe Probe im Browser des Editors. Die Stimme für Ansagen (Sprachausgabe,
Sprache, Stimme) steht im selben Reiter.

**Übernehmen:** „Sprechen“ am Panel beendet die Sitzung der App sofort, das Panel verbindet sich danach selbst (auch
während Ansage, Melodie oder Aufnahme; eine begonnene Nachricht wird trotzdem ausgewertet). Nimmt jemand den Anruf in
der Ring-App an, beendet Ring die Sitzung der App, und der Türdienst hört auf. Ob Ring dabei die Sitzung der App
tatsächlich beendet oder beide parallel zulässt, zeigt der erste Versuch im Protokoll („Ring hat die Sitzung beendet“).
Wird die Haustür geöffnet (Türöffner oder Schloss der Haustür aus der Einrichtung), endet der Türdienst sofort und ohne
Push, auch wenn niemand das Gespräch angenommen hat. Bei bereiter Klingelöffnung klingelt der Panel-Auslöser
nicht, der Türdienst bleibt dann aus.

**Nachrichten anhören:** In der Meldung „Nachricht an der Haustür“ über „Anhören“, außerdem auf der Seite Sicherheit
unter „Zugang“ in der Liste „Nachrichten an der Haustür“ (die letzten 10). Ältere Aufnahmen bleiben im Medienbrowser.

Einstellungen im Editor unter „Türdienst“: an/aus, Lautstärke und Test, Stimme, Wartezeit, längste Nachricht, beide
Ansagetexte (leer = abwechselnde Formeln), Push-Empfänger (notify-Dienste) und Spracherkennung.

### Klingelton

Zusammen mit dem Overlay „Haustür“ spielt das Panel ein zweitöniges „Ding-Dong“, das es selbst erzeugt (Web Audio,
keine Datei). Es unterscheidet sich vom dreistimmigen Hinweiston bei Meldungen.

- Der Ton erklingt einmal und nach etwa 4,5 Sekunden ein zweites Mal, solange das Overlay offen ist und kein Gespräch
  läuft. Klingelt es bei offenem Overlay erneut, klingelt auch das Panel erneut (mindestens 3 Sekunden Abstand). Der
  Server zählt dazu im Ereignis das Feld `klingel` hoch; Overlays für Person und Ereignis klingeln nicht.
- Er endet sofort, wenn das Overlay schließt oder ein Gespräch beginnt, damit das Mikrofon ihn nicht aufnimmt.
- Nach einem Neuladen oder einer neuen Verbindung (etwa nach einem Update der App) bleibt das Panel stumm, auch wenn das
  Overlay gerade offen ist.
- Der Ton ist immer voll: der Schalter „Alles stumm“, Haus-Modi und die Nachtabsenkung gelten für ihn nicht.
  Im Editor lassen sich „Lautstärke Klingelton“ (`klingel_lautstaerke`, 5–100 %, Standard 100) und der Schalter
  „Klingelton beim Haustür-Overlay“ (`ton_klingel`) einstellen; die Lautstärke des Hinweistons gilt hier nicht.

### Lautstärke und Verstärkung aller Töne

Alle Töne des Panels laufen zentral über `static/audio.js` (`PS.audio`): Pegel je Art mit Verstärkung, eine weiche
Sättigung (macht laute Töne dichter und damit hörbar lauter), ein Begrenzer kurz unter 0 dBFS gegen Übersteuern,
dann die Lautsprecher. Sprache (Gegensprechen, Telefon) wird vor der Verstärkung ausgeglichen. Lauter als der volle
Ausschlag geht digital nicht; reicht das nicht, die Lautstärke des Systems am Wandpanel prüfen (siehe Kiosk). Die Lautsprecher des Panels sind
sehr leise; ein Audio-Element käme nicht über 100 %. Änderungen im Editor wirken sofort, auch bei laufendem Ton.

- „Verstärkung aller Töne“ (`ton_verstaerkung`, 100–800 %, Standard 300) wird mit dem Pegel von Hinweiston
  (`ton_lautstaerke`) und Klingelton (`klingel_lautstaerke`) malgenommen.
- „Lautstärke Gegensprechen“ (`intercom_lautstaerke`) und „Lautstärke Telefon“ (`telefon_lautstaerke`), je 100–800 %,
  Standard 400, verstärken den Ton der Haustür bzw. des Telefons und enthalten die Verstärkung bereits.
- Ohne `--autoplay-policy=no-user-gesture-required` (siehe Kiosk) spielt Chromium nach einem Neuladen erst nach der
  ersten Berührung des Panels Ton ab.

## Telefon

Das Panel kann als eigenes Telefon an der FRITZ!Box arbeiten: Kontakte, Wähltastatur, Anrufliste, Anrufe annehmen und
führen. Die App meldet sich als IP-Telefon an der FRITZ!Box an (SIP im LAN, G.711) und reicht den Gesprächston über
die bestehende Panel-Verbindung (WebSocket) an das Panel weiter, das den Anruf führt. ha-sip bleibt davon unberührt und kann weiter für
Alarm- und Notrufanrufe dienen.

### Einrichtung

1. FRITZ!Box → Telefonie → Telefoniegeräte → Neues Gerät einrichten → Telefon (mit und ohne Anrufbeantworter) →
   LAN/WLAN (IP-Telefon), Name z. B. „Panel Flur“. Benutzername und Kennwort notieren, ausgehende Rufnummer und die
   Rufnummern wählen, auf die das Panel reagieren soll.
2. App-Optionen: `telefon_server` (Adresse der FRITZ!Box, z. B. `192.168.178.1`), `telefon_benutzer`,
   `telefon_passwort`. Leerer Server schaltet das Telefon ab.
3. Für Kontakte und Anrufliste (optional): FRITZ!Box → System → FRITZ!Box-Benutzer → Benutzer mit dem Recht
   „Sprachnachrichten, Faxnachrichten, FRITZ!App Fon und Anrufliste“; in `fritz_benutzer` und `fritz_passwort`
   eintragen. TR-064 muss aktiv sein (Heimnetz → Netzwerk → Netzwerkeinstellungen → „Zugriff für Anwendungen zulassen“).
4. Die App nutzt die UDP-Ports 5062 (SIP) und 40000–40003 (Ton) des Home-Assistant-Hosts; sie sind in der App
   freigegeben. Ihre Adresse im LAN ermittelt die App aus der Antwort der FRITZ!Box. Gelingt das nicht (Anrufe
   klingeln nicht oder bleiben stumm), `telefon_externe_adresse` auf die LAN-Adresse des Home-Assistant-Hosts setzen.
5. Favoriten pflegt der Editor unter „Telefon-Favoriten“ (je Zeile „Name = Nummer“). Das Modul „Telefon“ erscheint im
   Dock, sobald das Telefon eingerichtet ist; seine Position bestimmt die Modulreihenfolge im Editor.

### Bedienung

- Seite „Telefon“ mit Favoriten, Kontakten (FRITZ!Box-Telefonbuch, Suche; beim Öffnen der Kontakte holt die App das
  Telefonbuch neu, höchstens alle 30 Sekunden, sonst alle 5 Minuten), Tastatur und Verlauf (Anrufliste der
  FRITZ!Box, verpasste Anrufe rot, Tipp ruft zurück).
- Eingehender Anruf: Die Anrufkarte erscheint mit Name aus dem Telefonbuch, ruhigem Klingelton („Marimba und Harfe“, C–E–G–E alle 3,5 s) und den Knöpfen Ablehnen,
  Minimieren und Annehmen. Solange es klingelt, laufen drei grüne Wellen vom Kartenrand nach außen (Halo, dazu ein
  weiches Glühen); sie enden mit dem Annehmen, Ablehnen oder Auflegen und entfallen bei abgeschalteten Animationen.
  Ein Anruf weckt das Panel und hält es wach, solange er läuft.
- Verpasste Anrufe: Ein eingehender Anruf, der am Panel nicht angenommen wird und mit dem Auflegen des Anrufers endet,
  gilt als verpasst. Nicht verpasst sind am Panel abgelehnte Anrufe und Anrufe, die an einem anderen Telefon
  angenommen wurden (die FRITZ!Box sendet dann ein CANCEL mit `Reason: SIP;cause=200`, Grund „Woanders angenommen“).
  Die App fasst verpasste Anrufe je Nummer zusammen (Name, Anzahl, erster und letzter Anruf) und speichert sie in
  `/data/telefon_verpasst.json`; sie überleben einen Neustart, Einträge früherer Tage (Ortszeit von Home Assistant)
  fallen weg. Der Feed zeigt je Nummer eine Karte „Verpasster Anruf“ (Relevanz 80, nach 2 Stunden 50; der Ring läuft über
  2 Stunden seit dem letzten Anruf leer) mit den Knöpfen *Zurückrufen* und *Erledigt*. Der Rückruf entfernt den Eintrag
  sofort beim Wählen, *Erledigt* sendet `telefon_verpasst_erledigt`. Abschaltbar im Editor („Verpasster Anruf“,
  Schlüssel `verpasst`); die Karte erscheint nur bei aktivem Telefon.
- Gespräch: Dauer, Stumm, Tastatur (Tastentöne), Minimieren, Auflegen. *Minimieren* legt den Anruf als grüne Zeile in
  die Live-Kapsel, auch auf der Startseite; ein Tipp darauf holt die Karte zurück.
- Klingelt die Haustür während eines Anrufs, hat das Overlay „Haustür“ Vorrang und die Anrufkarte wird minimiert.
  *Sprechen* an der Haustür schaltet das Mikrofon des Telefons so lange stumm.
- Trennt sich das Panel, das den Anruf führt (Neuladen, Netz weg), wird der Anruf beendet.
- Lautstärke: „Lautstärke Telefon“ (`telefon_lautstaerke`) im Editor.

### Ereignis für Automationen

Jeder Wechsel eines Anrufs erzeugt in Home Assistant das Ereignis `pm_panel_studio_anruf` mit `richtung`
(`ein`/`aus`), `nummer`, `name`, `zustand` (`klingelt`, `waehlt`, `verbunden`, `beendet`), `grund` (z. B. „Verpasst“, „Abgelehnt“, „Woanders angenommen“) und bei `beendet`
nach einem Gespräch `dauer_s`. Damit lassen sich z. B. Musik leiser stellen oder verpasste Anrufe melden.

## Ansagen und Sprachassistent

**Ansagen.** Das Skript „Panel-Ansage sprechen“ (`script.panel_ansage`) spricht einen Text über die Wandpanels:

```yaml
action: script.panel_ansage
data:
  text: "Die Waschmaschine ist fertig, Sir."
  titel: Waschmaschine   # optional, für die Einblendung
  # engine: tts.piper     # optional, Vorgabe: Stimme für Ansagen im Editor
  # stimme: de_DE-thorsten-medium
```

Die App erkennt den Aufruf (wie bei `script.panel_meldung`), lässt Home Assistant den Ton erzeugen
(`/api/tts_get_url`) und schickt ihn an alle verbundenen Panels. Wichtig: als Aktion `script.panel_ansage` aufrufen,
nicht über `script.turn_on`. Stummregeln („Alles stumm“, Nacht) prüft der Aufrufer. Lautstärke im Editor unter
„Lautstärke Ansagen und Assistent“.

**Sprachassistent.** Der Mikrofon-Knopf neben der Glocke startet Assist mit der im Editor gewählten Pipeline
(leer = bevorzugte Pipeline). Für den Mikrofonzugriff braucht der Kiosk dieselben Chromium-Parameter wie das
Gegensprechen (`--unsafely-treat-insecure-origin-as-secure` und `--use-fake-ui-for-media-stream`).

**Weckwort.** Mit „Weckwort“ im Editor (Vorgabe an, „Hey Jarvis“) schicken die Wandpanels ihr Mikrofon dauerhaft an
die App (16 kHz, etwa 32 kB/s im Heimnetz). Die App startet die Pipeline mit der Stufe `wake_word`; openWakeWord in
Home Assistant erkennt das Wort. Vorher verlässt kein Ton Home Assistant, auch bei der Cloud-Pipeline nicht. Danach
folgen ein kurzer Doppelton, Spracherkennung und Antwort wie beim Knopf.

- In der gewählten Pipeline müssen „Weckwort-Engine“ (`wake_word.openwakeword`) und dasselbe Weckwort wie im Editor
  eingestellt sein; meldet die Engine ein anderes Wort, verwirft die App den Lauf.
- Ruhezeit in vollen Stunden, z. B. 23 bis 6 Uhr (Vorgabe: gleiche Zahl = keine Ruhezeit). Während eines Anrufs ruht das
  Lauschen. Die Vorschau im Editor hört nie dauerhaft mit.
- Ein kleiner Punkt am Mikrofon-Knopf zeigt, dass das Panel lauscht.

**Lautstärke.** Die Grundlautstärke kommt von der Systemlautstärke des Panels. Die Verstärkungen im Editor
(25–400 %, 100 % = unverändert) gleichen nur leise Quellen aus; über etwa 200 % beginnt es zu klirren.
