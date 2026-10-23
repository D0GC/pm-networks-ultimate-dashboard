# Änderungen

## 2026.10.81 – 2026-10-23

- Energie: Verlauf und Energiefluss haben Vorrang. Die obere Reihe nimmt höchstens 44 % der Höhe ein; der Verlauf
  füllt seine Box, die Geräteliste scrollt in sich, Wasser und Gas bleiben klein. Der Energiefluss bekommt den Rest.
  Bisher wuchs die obere Reihe mit langen Gerätelisten und drückte den Energiefluss zusammen.
- Raumseiten nach dem Schema Security: links Klima, Zustand als kompakte Melderliste (Offenes und Bewegung zuerst,
  sonst „vor …“), Modi und Luftqualität; Mitte Licht und Geräte (mit „n an“), rechts Medien und Szenen. Leere Boxen
  wie „Keine Szenen“ entfallen; ohne Medien und Szenen werden es zwei breitere Spalten.

## 2026.10.80 – 2026-10-23

- Admin-Startseite: „Inhalt anordnen“ und „Anpassen“ stehen in einer Fußzeile ganz unten statt neben der Begrüßung.
  Beim Anpassen bleibt die Fußzeile mit Format, Standard, Abbrechen und Speichern am unteren Bildrand stehen.

## 2026.10.79 – 2026-10-23

- Alle Unterseiten im Raster der Sicherheitsseite (neu `seitenraster.css`): drei Spalten 31 % · Mitte · 30 %, die
  letzte Box jeder Spalte reicht bis zum unteren Rand und scrollt bei Bedarf in sich, Boxen erscheinen gestaffelt.
  Listen (Termine, Einkaufsliste, Aufnahmen, Systemzustand, Protokoll …) als einzelne Karten mit farbigem Rand und
  Symbol im Kreis, Balkenzeilen (Energie, Batterien, Verbrauchsmaterial, Luft) als Karten mit wachsenden Balken,
  Zeitraum- und Filterknöpfe als kleine Chips.
- Ohne Scrollen auf dem Panel (1280 × 800): Energie (Energiefluss füllt den Platz unter den Spalten), Listen,
  Haushalt und die Raumseiten passen jetzt; Cover in schmalen Spalten flacher.
- Seiten ohne Inhalt in der rechten Spalte (z. B. Licht, Listen) zeigen zwei breitere Spalten statt einer leeren.

## 2026.10.78 – 2026-10-23

- Admin-Startseite: Hochformat und Querformat sind zwei eigene Seiten mit eigener Reihenfolge, eigenen Blöcken und
  eigenen Größen. „Anpassen“ bearbeitet das Format, in dem das Fenster gerade steht (angezeigt neben den Knöpfen);
  gespeichert wird nur dieses. Ohne eigene Hochformat-Seite wird sie wie bisher aus dem Querformat abgeleitet. Beim
  Drehen oder Verkleinern des Fensters wechselt die Seite sofort.

## 2026.10.77 – 2026-10-23

- Admin-Startseite im Hochformat und in schmalen Fenstern: Im Anpassen-Modus gibt es auch dort den Größengriff.
  Waagerecht ziehen wählt halbe oder volle Breite, senkrecht die Höhe in Zeilen; Doppelklick auf den Griff stellt
  die Höhe wieder auf „nach Inhalt“. Die Größen gelten nur für dieses Format, die Anordnung im Querformat bleibt
  unberührt (Eintrag `id:Breite:Höhe:Hoch-Breite:Hoch-Höhe`).

## 2026.10.76 – 2026-10-23

- Haustür-Verlauf: Aus dem Verlauf nachgetragene Klingeln mit „angenommen“ gelten als am Panel angenommen, nicht
  mehr als Ring-App (Ring meldet nur ob, nicht wo). Bereits gespeicherte Einträge werden beim Start korrigiert.
  Kein doppeltes „Tür geöffnet“ mehr unter „Haustür geöffnet“.
- Alarmanlage: Beschriftungen nach der tatsächlichen Überwachung. Zuhause: Kamera-Erkennung (Personen und Bewegung);
  Nacht: Außenhaut gesichert.
- Ein- und Ausgangsverzögerung: Die Sekunden im Countdown rollen wie bei den anderen Timern, der Ring gleitet weiter,
  auf der Sicherheitsseite und in der Meldung am Panel.

## 2026.10.75 – 2026-10-23

- Haustür-Verlauf vollständig: Die App trägt beim Start die Klingeln der letzten sieben Tage aus dem Verlauf von
  Home Assistant nach (Klingelsensor, Türöffner, Ring-Aktivität „angenommen“, Nachrichten des Anrufbeantworters).
  Bisher standen nur Klingeln seit dem ersten Start mit Klingelbuch darin.
- Das Klingelbuch hört jetzt auf den Klingelsensor der Haustür (`binary_sensor.haustur_ding`), nicht nur auf das
  Panel-Signal. Das Panel-Signal bleibt bei der Klingelöffnung bewusst stumm, solche Klingeln fehlten deshalb.
- Neuer Ausgang „Ring to Open“: Geht die Tür binnen fünf Sekunden nach dem Klingeln auf (Automation
  „Klingelöffnung“), steht das Klingeln mit eigenem Filter, grünem Türsymbol und „Tür beim Klingeln automatisch
  geöffnet“ im Verlauf.

## 2026.10.74 – 2026-10-23

- Dock und Chips wieder mittig: Die Grundregel der Symbol-Animationen richtete Symbole überall oben bzw. links aus
  (Admin-Leiste, Chips der Raumkarten, Symbole in Feed-Ringen). Sie setzt jetzt nur noch die Größe.
- Hüpfer der Dock-Symbole entfernt (Admin und Panels).
- Admin-Ringe (Proxmox, HA-Host, Netzwerk): die Spur ist sichtbarer, damit kurze Bögen wie „27 % Speicher“ den Ring
  nicht seitlich versetzt wirken lassen.

## 2026.10.73 – 2026-10-23

- Animierte Symbole drehen und schwingen um die eigene Achse: In Kacheln war das Symbol auf die volle Breite
  gestreckt und kreiste um die Kachelmitte (sichtbar beim Luftreiniger).
- Eigene Drehpunkte greifen wieder (Glocke oben, Tür an der Angel, Flamme unten); eine zu starke Grundregel hatte sie
  überschrieben.
- Luftreiniger, Luftfilter und Klimagerät drehen sich nicht mehr, sondern zeigen einen sanften Luftstrom;
  Deckenventilator pendelt, Lüfterstufen pulsieren; gedreht werden nur runde Ventilatorsymbole und Schneeflocken.
- Ausgeschaltete Varianten („bell-off“, „fan-off“ …) bewegen sich nie, etwa bei „Nicht stören“.

## 2026.10.72 – 2026-10-23

- Proxmox-Kachel der Admin-Startseite: Der dritte Ring heißt wieder „Speicher“ und zeigt den am stärksten belegten
  Speicher (statt des Namens einer Statusentität wie „(local) Speicher aktiv“). Geräte ohne Namen im Geräteregister
  heißen nach dem gemeinsamen Anfang ihrer Entitätsnamen, etwa „Storage (local)“.

## 2026.10.71 – 2026-10-22

- Sicherheit: Wohnungstür-Verlauf wie bei der Haustür. Kamerabild bleibt oben, darunter die Aufnahmen von heute und
  gestern mit Filtern (Person, Bewegung, Fahrzeug …), Tagesgruppen und animierten Symbolen. Erkennt die Kamera gerade
  eine Person oder Bewegung, steht oben ein pulsierender Live-Eintrag; danach wird die neue Aufnahme nachgeladen.
- PC und andere Rechner: Beim Hochfahren glimmt das Symbol auf und ein Ladebalken läuft, beim Herunterfahren wird das
  Bild dunkel. Läuft der Rechner, flimmert der Bildschirm leicht.
- Klingel-Pop-up mit bewegten Bildern: Glocke mit Schallwellen beim Klingeln, beim Sprechen erst der Verbindungsaufbau,
  dann ein Mikrofon mit Pegel, beim Öffnen springt das Schloss auf, die Tür schwingt, Licht fällt herein, ein Haken
  bestätigt. Mit Kamera erscheinen Sprechen und Öffnen als Einblendung über dem Livebild.

## 2026.10.70 – 2026-10-22

- Codetafel wie die iPhone-Sperre: sechs Punkte statt Kästen, runde Tasten, Prüfung startet automatisch nach der
  sechsten Ziffer. Falscher Code schüttelt die Punkte rot, richtiger färbt sie nacheinander grün und zeigt einen Haken.
- Meldung am Panel bei Eingangsverzögerung: Panel wacht auf, mittig die Codetafel mit ablaufendem Countdown-Symbol
  und Restzeit. Bei Auslösung dieselbe Tafel rot mit pulsierendem Hintergrund und Alarmsymbol. Richtiger Code schaltet
  unscharf; „Ausblenden“ gilt bis zum nächsten Zustandswechsel. Nur an den Panels, nicht in der Admin-Ansicht.

## 2026.10.69 – 2026-10-22

- Feed der Startseite: neue Karten für die Alarmanlage und die Haustür mit denselben animierten Symbolen wie auf der
  Sicherheitsseite. Alarm ausgelöst und Vorlauf mit Countdown stehen ganz vorn, scharf läuft ruhig mit, nach dem
  Entschärfen bestätigt eine Karte zehn Minuten lang. Haustür: „Es klingelt“ mit läutender Glocke (Ring läuft bis zum
  Verpasst ab), ungehörte Nachrichten mit Abschrift, „Anhören“ und „Erledigt“, verpasstes Klingeln mit „Erledigt“.
  Antippen öffnet die Sicherheitsseite. Beide Karten lassen sich in den Einstellungen ausblenden.
- Animierte Symbole auf allen Seiten, nur solange etwas aktiv ist: Licht glimmt, Ventilator dreht, Waschmaschine und
  Spüler ruckeln, Saugroboter fährt, Heizung und Thermostat flackern, Medien im Takt, offene Türen und Fenster schwingen,
  offenes Schloss rüttelt, Bewegung pulsiert, Klingel läutet, Alarmanlage atmet, Kamera schwenkt. Dazu die Symbole der
  Feed-Karten, die Chips der Raumkarten und ein Hüpfer im Dock. „Animationen aus“ und reduzierte Bewegung schalten alles ab.

## 2026.10.68 – 2026-10-22

- Sicherheit neu aufgebaut: passt ohne Scrollen auf das Panel. Links Alarmanlage, Zugang und Melder kompakt, in der
  Mitte der Haustür-Verlauf (scrollt in sich), rechts Kamera und die letzten Aufnahmen.
- Alarmanlage: aktiver Modus immer sichtbar, animierte Zustandssymbole (Unscharf, Zuhause, Abwesend, Nacht, Countdown
  beim Scharfschalten, Alarm). Modi daneben; Scharfschalten per Tippen, „Unscharf“ muss gehalten werden. Danach
  erscheint mittig eine Codetafel: Ziffern blitzen kurz auf, falscher Code schüttelt die Felder, richtiger Code zeigt
  einen Haken und schließt die Tafel.
- Haustür-Verlauf: jedes Klingeln mit Ausgang (angenommen am Panel oder in der Ring-App, Nachricht, ohne Nachricht,
  verpasst), Nachrichten mit Abspielen, animierter Wellenform und Abschrift. Filter mit Anzahl, Gruppen nach Tag,
  Hinweise „Tür geöffnet“ und „n× geklingelt“, live bei jedem Klingeln.
- Neues Klingelbuch in der App (`klingeln.json`, Schnittstelle `api/klingeln`).

## 2026.10.67 – 2026-10-22

- Proxmox: Kachel je VM und Container mit Zustand, IP-Adresse (Tippen kopiert sie), Ringen für CPU und RAM,
  CPU- und RAM-Verlauf, Laufzeit, Arbeitsspeicher und Kernen. Starten per Tippen, Neustart und Herunterfahren per
  Halten; hinter „…“ Hart stoppen, Zurücksetzen (beide halten), Anhalten, Ruhezustand, Snapshot und „In Proxmox
  öffnen“.
- IP-Adressen kommen aus Proxmox (Container-Schnittstellen, Gast-Agent der VMs), sonst aus UniFi über den Hostnamen.
- Neue App-Optionen „Proxmox: Adresse“ und „Proxmox: API-Token“ (nur lesend, Rolle PVEAuditor; für VM-Adressen
  zusätzlich das Recht für den Gast-Agenten). Mit Token kommen Werte und Netzrate alle fünf Sekunden direkt von
  Proxmox; ohne Token bleibt alles bei den Daten aus Home Assistant. Das Token verlässt die App nicht.

## 2026.10.66 – 2026-10-22

- Neue Seiten „Proxmox“ und „HA-Host“ in der Admin-Ansicht, dazu je ein Block für die Startseite. Quelle sind die
  Integrationen Proxmox VE und System Monitor in Home Assistant.
  - Proxmox: Knoten mit CPU- und RAM-Ring, Laufzeit, Update, Neustart und Herunterfahren (halten); Speicher mit
    Belegung; VMs und Container mit Zustand, CPU- und RAM-Balken, Laufzeit und Start, Neustart, Herunterfahren.
  - HA-Host (Raspberry Pi): Ringe für CPU, RAM, Temperatur und Speicher; Last, Swap, freier Speicher, Laufzeit,
    Netzteilprüfung und anstehende Updates.
  - Lebendig wie das Netzwerk: Ringe gleiten auf neue Werte, Zahlen rollen, Kurven der letzten Stunden laufen stetig
    nach links, ein Puls zeigt jede neue Messung. Neue Werte kommen im Takt der Integrationen.
- Die Startseite bekommt beide Blöcke einmalig dazu; sie lassen sich wie alle Blöcke verschieben oder ausblenden.

## 2026.10.65 – 2026-10-22

- Startseite im Flur frei anordnen: neue Seite „Flur-Startseite“ in der Admin-Ansicht zeigt das Flur-Panel in seiner
  Größe. Teile (Uhr, Datum, Wetter, Vorschau, Personen, Status, Begrüßung, Karten, Glocke, Schnellzugriff, Räume)
  lassen sich zwischen und in den Spalten ziehen und ausblenden, die Spaltenbreiten an den Trennlinien ziehen. Gilt
  sofort im Flur; „Standard“ stellt die Vorgabe wieder her. Im eingebetteten Panel startet kein Weckwort und kein
  Mikrofon.
- Anordnen: „Rückgängig“ (bis 40 Schritte), „Sichern“ (Datei mit allen Anordnungen) und „Laden“ (wiederherstellen).
- Boxen mit Obergrenze (Geräte und Zustand der Raumansicht, Szenen, Automatik, Updates): Anzahl im Anordnen-Modus
  einstellbar; die eigene Reihenfolge und entfernte Geräte zählen schon vor dem Kürzen.
- Netzwerk: Ereignisverbindung zum UniFi-Controller. Meldet das Gateway seinen Stand selbst, kommt der Durchsatz
  von dort und die Seite aktualisiert sich jede Sekunde; sonst wie bisher alle drei Sekunden. Die Diagnose zeigt
  Verbindung, Meldungen und Felder der Live-Daten.
- Telefon: Die Tonbrücke konnte beim Auflegen hängen bleiben, wenn ein Abbruch genau beim Senden eintraf (asyncio
  unter Python 3.11); der Takt endet jetzt zusätzlich über eine Marke. Die zugehörigen Tests laufen damit stabil.
- Zeitangaben: „vor einem Tag“ statt „vor 1 Tagen“.

## 2026.10.64 – 2026-10-22

- Freie Plätze in Kachelrastern: Im Anordnen-Modus landet eine gezogene Kachel genau in der Zelle unter dem Zeiger,
  auch in einer leeren; liegt dort eine andere, tauschen beide die Plätze.
- Geräte hinzufügen und entfernen: Jedes Kachelraster hat im Anordnen-Modus „Gerät hinzufügen“ (Suche über alle
  Entitäten), jede Kachel ein ×. Gilt auf allen Panels, auch im Flur.
- Startseite der Admin-Ansicht: „Inhalt anordnen“ ordnet den Inhalt der Blöcke (Räume, Schnellzugriff, Klima …) wie
  auf den Modulseiten, samt Kachelplätzen, Breiten und Geräteauswahl.
- Raumkarten: „Karteninhalt“ (im Anordnen-Modus, wo Räume zu sehen sind) legt fest, welche Teile eine Raumkarte zeigt
  und in welcher Folge: Temperatur, Luftfeuchte, Geräteanzahl, Licht, offene Fenster, Heizt, Wiedergabe, Bewegung.
  Gilt für Räume-Seite, Startseiten-Block und die Raumübersicht im Flur.

## 2026.10.63 – 2026-10-22

- Freies Raster: Im Anordnen-Modus wandelt „Freies Raster“ eine Seite im Drei-Spalten-Muster (Raumansicht, Klima,
  Licht, Sicherheit, Energie …) in ein Raster aus zwölf Spalten. Jedes Teil lässt sich am Griff oben verschieben und
  unten rechts in Breite und Höhe ziehen (Doppelklick: Höhe wieder nach Inhalt). Gilt sofort auf allen Panels;
  schmale Anzeigen ordnen in zwei Spalten oder einer.
- Kachelbreite: Kacheln in Rastern lassen sich im Anordnen-Modus über mehrere Spalten ziehen.
- „Seite zurücksetzen“ stellt auch Raster und Kachelbreiten der Seite zurück.

## 2026.10.62 – 2026-10-22

- Anordnen auf allen Seiten (Admin-Ansicht): Knopf „Anordnen“ unten rechts auf jeder Modul- und Unterseite. Kacheln,
  Räume und Thermostate lassen sich in ihrer Liste ziehen, Boxen und Gruppen an der Überschrift. Die Reihenfolge gilt
  sofort auf allen Panels, auch im Flur; Räume nutzen die gemeinsame Raumreihenfolge. „Seite zurücksetzen“ stellt die
  automatische Reihenfolge der Seite wieder her. Bearbeiten nur in der Admin-Ansicht.
- Startseite der Admin-Ansicht: Blöcke lassen sich im Anpassen-Modus per Ziehen sortieren, in jeder Fensterbreite. Im
  Hochformat (zwei Spalten) lässt sich die Breite (halb oder voll) ziehen; die Höhe folgt dort dem Inhalt.

## 2026.10.61 – 2026-10-22

- Admin-Ansicht: Personen und Statuspillen in der Kopfzeile laufen als Band durch wie eine Bauchbinde, sobald sie
  nicht hineinpassen; nach dem letzten Eintrag folgt nahtlos wieder der erste. Beim Zeigen hält das Band an, Klicks
  wirken auch auf die durchlaufende Kopie, bei reduzierter Bewegung lässt es sich von Hand schieben.
- Platz dafür: Die Wetterdetails weichen unter 1400 px Breite, auf dem Telefon das Wetter ganz; dort ist das Band
  nun ebenfalls zu sehen.

## 2026.10.60 – 2026-10-22

- Netzwerk: Laufleiste wie unter „Throughput“ in UniFi, im Startblock und auf der Seite. Je Abfrage ein
  Download-Balken, Upload als Linie darüber; die Leiste gleitet stetig nach links, die Skala folgt weich der Spitze.
  Auf der Seite ersetzt sie die bisherige Verlaufskurve und zeigt weiterhin den Ping gestrichelt.

## 2026.10.59 – 2026-10-22

- Netzwerk: Durchsatz-Diagnose (Knopf am Ende der Netzwerkseite, nur Administratoren). Zeigt alle Durchsatz- und
  Zählerfelder des Gateways und des Gesundheitsberichts, dazu eine aus den Byte-Zählern über 20 s berechnete Rate,
  alle drei Sekunden erneuert. Dient dem Abgleich mit der UniFi-Oberfläche; die Anzeige selbst bleibt unverändert,
  bis feststeht, welches Feld deren Wert trägt.

## 2026.10.58 – 2026-10-22

- Netzwerk: Download und Upload kommen jetzt aus den WAN-Schnittstellen des Gateways (wie in der UniFi-Oberfläche),
  das Gateway wird dafür bei jeder Abfrage einzeln geholt. Der Gesundheitsbericht lieferte nur einen trägen
  Mittelwert, der weit unter dem tatsächlichen Durchsatz lag und oft 0 zeigte.
- Raten unter 1 Mbit/s erscheinen in kbit/s statt als 0.

## 2026.10.57 – 2026-10-22

- Live-Ping wie bei UniFi zu Microsoft, Google und Cloudflare (TCP-Verbindungsaufbau auf Port 443, Namen vorab
  aufgelöst). Die Netzwerkseite zeigt alle drei einzeln, Startblock und großes Feld den Durchschnitt der erreichten.

## 2026.10.56 – 2026-10-22

- Live-Ping: Die App misst den Ping selbst alle drei Sekunden (Dauer des TCP-Verbindungsaufbaus zu 1.1.1.1 und
  8.8.8.8, der schnellere zählt), solange Netzwerkseite oder Startblock zu sehen sind. Die Latenz des Gateways, die
  UniFi nur in längeren Abständen erneuert, steht auf der Seite zum Vergleich.
- Durchsatzverlauf zeigt den Ping als gestrichelte Linie auf eigener Skala.

## 2026.10.55 – 2026-10-22

- Netzwerk live: Seite und Startblock fragen alle drei Sekunden beim Gateway nach, solange sie zu sehen sind. Ping,
  Download und Upload rollen als Zahlenwalze an Ort und Stelle; der Block wird nicht mehr neu aufgebaut.
- Netzfluss wie im Energiefluss: Lichtpunkte zwischen Internet und Zuhause, unten Download, oben Upload; Dichte und
  Tempo folgen dem Durchsatz. Ohne Verbindung und bei reduzierter Bewegung ruhen sie.
- Netzwerkseite: Verlauf des Durchsatzes der letzten zehn Minuten. Übrige Bereiche (Clients, Zustand, Geräte) werden
  nur neu gefüllt, wenn sich dort etwas ändert.
- Backend: Gesundheitsbericht höchstens alle 2,5 s, Geräteliste alle 20 s vom Gateway.

## 2026.10.54 – 2026-10-22

- Netzwerk (Seite und Startblock): Die großen Felder zeigen die Live-Werte (Ping, Download und Upload jetzt); das
  letzte Speedtest-Ergebnis steht darunter.

## 2026.10.53 – 2026-10-21

- Neu: Seite „Netzwerk“ und Block „Netzwerk“ auf der Startseite (wird einmalig angehängt). Direkt vom UniFi-Gateway:
  Internet verbunden oder gestört, Anbieter und WAN-Adresse, Latenz, Ping, Download und Upload des letzten
  Speedtests, Speedtest starten, Durchsatz jetzt, Verbindungsdauer, Ausfälle; Clients gesamt, LAN, WLAN, Gäste;
  alle UniFi-Geräte (Gateway, Switches, Access Points) mit Zustand, CPU, RAM, Temperatur, Laufzeit, Clients, Ports
  und Firmware-Updates. Zugang über die neuen App-Optionen „UniFi: API-Schlüssel“ (oder Benutzer und Kennwort),
  Adresse vorbelegt mit https://192.168.3.1. Ohne Zugang zeigt die Seite, was die UniFi-Integration von Home
  Assistant liefert (Geräte, Clients je WLAN).
- Admin-Ansicht: Im Hochformat und auf den Admin-Seiten füllen beide Spalten sich unabhängig (Mauerwerk), ohne
  Leerraum neben kürzeren Blöcken.
- Modulseiten des Panels behalten zwei Spalten bis zur Telefonbreite; der Inhalt passt sich der Spalte an.

## 2026.10.52 – 2026-10-21

- Admin-Ansicht, Startseite: kein ständiges Neuzeichnen mehr. Räume, Aufmerksamkeit, Sicherheit, Hinweise und
  Pakete werden nur neu aufgebaut, wenn sich ihr sichtbarer Inhalt ändert; Energie führt Werte und Balken an Ort
  und Stelle nach. Vorher bauten sich diese Blöcke bei jeder Sensoränderung im Sekundentakt neu auf.
- Laufschrift ruhiger: steht zunächst, gleitet sanft bis zum Ende, hält, blendet aus und am Anfang wieder ein; die
  Namen laufen versetzt. Schon ein Pixel Überlänge löst sie aus (vorher fehlte z. B. das „r“ bei „Schlafzimmer“).
  Behoben: Die Thermostat-Namen wurden endlos neu eingepackt.
- Klima-Block: in schmaler Breite steht der Raumname in einer eigenen Zeile.

## 2026.10.51 – 2026-10-21

- Admin-Ansicht: Klima Studio läuft über seinen eigenen Ingress-Zugang (der Weg über die App funktioniert nur am
  Wandpanel und zeigte am PC nichts).
- Admin-Ansicht, Modulseiten (Klima, Licht, Wartung, Sicherheit …) in schmaleren Fenstern: zwei Spalten mit der
  Bedienung oben, hochkant eine Spalte; die Seite scrollt als Ganzes. Thermostate stehen nicht mehr übereinander,
  kleine Kachelraster füllen die Breite.
- Admin-Ansicht: Zu lange Namen auf Kacheln, Raum- und Thermostatkarten und in Kartentiteln laufen als Laufschrift
  durch (kurze Pause, dann von vorn), statt abgeschnitten zu werden; bei reduzierter Bewegung „…“.
- Raumkacheln: der Lichtschalter steht rechts neben der Temperatur, der Name hat die volle Breite. Zähler in der
  Modulleiste werden nicht mehr abgeschnitten.

## 2026.10.50 – 2026-10-21

- Admin-Ansicht passt sich dem Fenster an: unter rund 1100 Pixel Breite (schmales Fenster, Hochformat) stehen die
  Blöcke halb oder voll breit nebeneinander, ihre Höhe richtet sich nach dem Inhalt; sehr schmal eine Spalte. Die
  gezogenen Größen gelten im breiten Fenster. Kopfzeile und Ränder werden schmaler, Datum und Statuspillen weichen
  bei Platzmangel, die Mindestschrift ist etwas größer.

## 2026.10.49 – 2026-10-21

- Admin-Ansicht: Eingebettete Seiten von Home Assistant mit eigenem Zurück-Pfeil (Editoren, Verlauf von
  Automationen, Geräteseiten) ohne zusätzliche Kopfzeile; der Pfeil von Home Assistant führt zurück ins Dashboard.
  Seiten ohne eigenen Pfeil (z. B. Verlauf einer Entität) behalten die Kopfzeile mit Zurück.

## 2026.10.48 – 2026-10-21

- Admin-Ansicht: Seiten von Home Assistant, die aus einer Seite des Dashboards geöffnet werden (Editor und Verlauf
  einer Automation, Skript, Gerät, Verlauf einer Entität), erscheinen als Unterseite mit Zurück-Knopf und Titel.
  Der Zurück-Pfeil von Home Assistant im Editor führt jetzt ebenfalls zurück auf die Seite des Dashboards statt in
  die Übersicht von Home Assistant.

## 2026.10.47 – 2026-10-21

- Admin-Ansicht: Schnellsuche wie in Home Assistant. Strg+K oder „e“ sucht über Seiten des Dashboards, Seiten von
  Home Assistant, Bereiche, Geräte, Automationen, Skripte und alle Entitäten; „c“ (oder „>“ vor dem Suchbegriff)
  zeigt Befehle: Automationen, Skripte, Szenen, Vorlagen und Gruppen neu laden, alle YAML neu laden, Home Assistant
  neu starten (mit zweitem Enter zur Bestätigung). Der Suchknopf in der Kopfzeile öffnet sie ebenfalls.
- Neue Seite „Automationen“: nach Kategorien gruppiert mit Labels, Suche, Filter aktiv/deaktiviert; je Automation
  ein- und ausschalten, jetzt ausführen, Verlauf der Ausführungen, bearbeiten (Editor von Home Assistant im
  Dashboard), „Neue Automation“.
- Neue Seite „Entitäten und Geräte“: Entitäten suchen und nach Domäne oder Status filtern, ausblenden oder
  einblenden, deaktivieren oder aktivieren, zum Gerät springen; Geräte suchen, deaktivieren, öffnen.
- Entitäten-Dialog in der Admin-Ansicht: Zeile „Verwaltung“ mit Ausblenden, Deaktivieren, Gerät, Verlauf und bei
  Automationen und Skripten „Bearbeiten“.

## 2026.10.46 – 2026-10-21

- Admin-Ansicht und eigene App: Eingebettete Seiten von Home Assistant (Einstellungen, Karte, Energie …) laufen im
  Modus „Seitenleiste immer ausblenden“; der leere Streifen, wo sonst die Seitenleiste steht, entfällt. Home Assistant
  im normalen Browserfenster bleibt unverändert.

## 2026.10.45 – 2026-10-21

- Eigene App: Ingress-Sitzung über die WebSocket-Verbindung wie im Frontend von Home Assistant; der REST-Weg ergab
  „Ingress-Sitzung nicht erhalten (HTTP 401)“. Die Startseite lädt ihr Skript mit Versionsnummer, damit der Browser
  nach einem Update nicht die alte Fassung verwendet.

## 2026.10.44 – 2026-10-21

- Eigene App: Adresse ist `/local/pm-dashboard/index.html` (Home Assistant liefert unter `/local/` keine
  Ordneransicht, `/local/pm-dashboard/` ergab „403: Forbidden“). Link in „System“ und Startadresse der App angepasst.

## 2026.10.43 – 2026-10-21

- Neu: PM Dashboard als eigene App unter `http://<Home-Assistant>/local/pm-dashboard/` (die App legt die Startseite
  beim Start dort ab). Vollbild ohne Oberfläche von Home Assistant, als App installierbar (bei HTTPS), Anmeldung mit
  dem Konto von Home Assistant (dieselbe Anmeldung wie im Browser), hält den Ingress-Zugang selbst offen. Nur für
  Administratoren. In der Seite „System“: „Als eigene App öffnen“.
- Admin-Ansicht: Einstellungen, Karte und Energie von Home Assistant sowie Music Assistant als eigene Seiten in der
  Modulleiste, eingebettet ohne die Seitenleiste von Home Assistant; auch die Sprünge aus „System“ öffnen jetzt im
  Dashboard. Das Terminal nutzt denselben Weg und läuft auch in der eigenen App.
- Admin-Ansicht, Räume: neue Raumkacheln (Startseite und Seite „Räume“) mit Temperatur, Feuchte, Zuständen
  (offen, heizt, Medien, Bewegung) und einem Schalter für alle Lichter des Raums; Namen werden nicht mehr abgeschnitten.

## 2026.10.42 – 2026-10-21

- Admin-Ansicht, Startseite: Raster aus 12 Spalten; im Modus „Anpassen“ lässt sich jeder Block am Griff unten rechts
  frei in Breite und Höhe ziehen (rastet ein, Größe als „Spalten × Zeilen“). Der Inhalt richtet sich nach der
  Blockgröße: Klima als kompakte Zeilen (Ist, Zustand, Soll mit − und +), Räume zu zweit nebeneinander, Kacheln und
  Listen passen sich an, zu viel Inhalt scrollt im Block. Lücken füllen sich automatisch. Gespeichert als
  `block:breite:höhe`; Anordnungen aus 2026.10.41 werden übernommen.
- Admin-Ansicht: Modulseiten ohne eigene Kopfzeile (die Modulleiste zeigt, wo man ist); die Kopfzeile erscheint nur
  noch mit Reitern oder Zurück-Knopf.
- Neu: Dateimanager in der Admin-Ansicht (Seite „Dateien“). Ordner: Home Assistant (Konfiguration), share, media,
  App-Konfigurationen, ssl und backup, alle mit Schreibrecht. Ordner durchsuchen, Dateien hochladen (mehrere, auch
  per Ziehen und Ablegen, mit Fortschritt), herunterladen (Ordner als ZIP), Textdateien bearbeiten (Strg+S speichert,
  Schutz vor Überschreiben fremder Änderungen), Ordner und Dateien anlegen, umbenennen, löschen (mit Bestätigung).
  Nur für Administratoren: Die App prüft bei jeder Anfrage den angemeldeten Benutzer über Home Assistant; über den
  Panel-Port ist der Dateimanager nicht erreichbar.
- Eilmeldung am Wandpanel: Karte und Dialog zeigen die volle Schlagzeile statt der auf 34 Zeichen gekürzten Zeile
  der Hinweisvorlage; der Dialog zeigt zusätzlich den ganzen Artikeltext der Tagesschau (lädt die App nach).

## 2026.10.41 – 2026-10-21

- Neu: Admin-Ansicht am PC. Der Eintrag in der Seitenleiste von Home Assistant heißt jetzt „PM Dashboard“ und
  öffnet statt des Editors eine eingebettete Ansicht (Seitenleiste bleibt sichtbar): links alle Module des Panels,
  oben Uhr, Wetter, Anwesenheit, Status, Suche (Taste /) und Meldungen, darunter eine anpassbare Startseite.
- Startseite aus Blöcken: Aufmerksamkeit, Hinweise, Türen, Klima, Räume, Schnellzugriff, Energie, Pakete, Medien,
  Termine, Einkauf, Angebote, Sicherheit. „Anpassen“ ordnet, verbreitert (1–3 Spalten), blendet aus und ein;
  gespeichert in `admin_start`.
- Admin-Seiten: Türdienst (alle Nachrichten mit Abschrift und Wiedergabe, Einstellungen, Haustür öffnen), System
  (Systemzustand, Verbindungen, Meldungen, Sprünge in die Einstellungen von Home Assistant), Terminal (App „Advanced
  SSH & Web Terminal“ eingebettet) und Editor (bisheriger Editor, auch unter `…/editor`).
- Am PC kein Ruhezustand, keine Rückkehr zur Startseite nach Zeit; Klicks am PC wecken das Wandpanel nicht mehr.
  Klingeln erscheint als Hinweis unten rechts statt als Vollbild.

## 2026.10.40 – 2026-10-21

- Türdienst: Ablage nach Tagen, je Tag ein Ordner mit `wav` und `json` getrennt
  (`Haustüraufnahme/2026-10-21/wav/…`, `…/json/…`). Vorhandene Aufnahmen werden beim Start einsortiert, leere
  Ordner beim Aufräumen der ältesten Nachrichten entfernt.

## 2026.10.39 – 2026-10-21

- Türdienst: Vorlauf vor der Begrüßung (Vorgabe 3 s, im Editor einstellbar). Ring schaltet die Leitung an der Tür erst
  nach dem Verbindungsaufbau durch; bisher ging der Anfang der Begrüßung verloren. Das Protokoll nennt die gemessenen
  Zeiten bis zur Verbindung und zum ersten Ton von der Tür.
- Türdienst: Nachrichten liegen jetzt auf dem Netzlaufwerk unter `/media/Fileshare_Media/Haustüraufnahme`
  (`pforte_ordner`, im Editor einstellbar). Ohne eingehängte Freigabe bleibt es beim lokalen Ordner; vorhandene lokale
  Aufnahmen werden beim Start verschoben.

## 2026.10.38 – 2026-10-21

- Türdienst: moderne Grußformeln ohne „Grüß Gott“ (Guten Morgen/Tag/Abend, „… und herzlich willkommen“), modernere
  Warteformeln mit „Einen Moment bitte, ich melde Sie im Haus an.“; der Anrufbeantworter hat eine feste Ansage.

## 2026.10.37 – 2026-10-21

- Türdienst: Wird die Haustür geöffnet (`button.haustur_tur_offnen` oder `lock.haustur_lock`), endet er sofort, auch
  ohne angenommenes Gespräch: Melodie aus, kein Anrufbeantworter, kein Push.
- Nachrichten am Panel anhören: Die Meldung „Nachricht an der Haustür“ hat einen Knopf „Anhören“; auf der Seite
  Sicherheit steht unter „Zugang“ die Liste „Nachrichten an der Haustür“ (die letzten 10 mit Zeit, Länge, Abschrift).
- Förmliche, abwechselnde Ansagen: Gruß nach Tageszeit (Morgen, Mittag, Nachmittag, Abend, Nacht; „Grüß Gott“ wie in
  Bayern und Franken üblich), dazu wechselnde Warte- und Anrufbeantworter-Formeln, nie zweimal hintereinander gleich.
  Eigene Texte im Editor haben weiter Vorrang; die festen Texte von 2026.10.36 gelten als nicht eingestellt.

## 2026.10.36 – 2026-10-21

- Türdienst an der Haustür: Klingelt es, nimmt die App das Gespräch selbst an (eigene WebRTC-Gegenstelle über
  PM Ring Intercom). Der Besucher hört „Guten Tag. Bitte warten Sie, Sie werden verbunden.“ (Piper, Jarvis), danach
  die Wartemelodie „Abendglocke“. Nach 30 Sekunden ohne Annahme – sofort, wenn niemand zu Hause ist – übernimmt der
  Anrufbeantworter: Ansage, Signalton, Aufnahme bis Stille oder 60 Sekunden. Die Aufnahme liegt unter
  `/media/pm_panel_studio/haustuer`, die Spracherkennung schreibt sie ab, die Abschrift kommt per Push und als
  Meldung am Panel; zusätzlich das Ereignis `pm_panel_studio_haustuer`.
- Übernahme jederzeit: „Sprechen“ am Panel beendet die Sitzung der App sofort und verbindet das Panel; nimmt jemand
  in der Ring-App an, beendet Ring die Sitzung der App, der Türdienst hört auf. Öffnen der Haustür beendet ihn still.
- Auslöser ist `binary_sensor.haustur_klingelt_panel` (folgt dem ring-mqtt-Sensor `binary_sensor.haustur_ding`, rund
  0,4 s statt 30–120 s; nicht bei bereiter Klingelöffnung).
- Einstellungen im Editor: Türdienst an/aus, Wartezeit bis zum Anrufbeantworter, längste Nachricht, beide Ansagetexte,
  Push-Empfänger und Spracherkennung.
- Neu im Image: aiortc und PyAV (WebRTC, Tonumwandlung); die App bindet `/media` ein.

## 2026.10.35 – 2026-10-18

- Medien: Fernseher mit Bildschirmbild (Android-TV-Integration) erscheinen unter „Läuft gerade“ auch dann, wenn sie
  nur „Bereit“ melden – der Fire TV Stick mit Fire OS 8 meldet beim Schauen kein „Spielt“. Kompakte Medienkarten
  zeigen das Bild ebenfalls.
- Räume, Geräte: Der Schalter zu einem Wake-on-LAN-Knopf (z. B. „Main PC“ zu „Main PC starten“) steht direkt daneben;
  Einstellungen der Echos (Amazon Kids, Bitte nicht stören) erscheinen dort nicht mehr.
- Rechner-Schalter: Nach dem Tippen „Fährt hoch …“ bzw. „Fährt herunter …“ bis zu 4 Minuten, statt nach 8 Sekunden
  „reagiert nicht“ und Zurückspringen. Der Zustand kommt erst über den Ping-Sensor (rund 1–2 Minuten).

## 2026.10.34 – 2026-10-17

- Meldungen: „Bestätigen“ und die Knöpfe eines Popups nehmen die Meldung jetzt sofort aus Glocke und Feed. Bisher
  wurde nur der Knopf in Home Assistant gedrückt; die Meldung blieb stehen, bis die Automation sie schloss (Kohle bis
  zu 60 s später, andere Automationen teils gar nicht).

## 2026.10.33 – 2026-10-17

- Meldungen ließen sich teilweise nicht mit „OK“ schließen: Das ausgeblendete Overlay des Sprachassistenten lag
  unsichtbar über dem unteren Bildschirmbereich (seit 2026.10.29) und fing die Tipps ab. Es ist jetzt wirklich
  ausgeblendet und nimmt ohne Anzeige keine Berührungen mehr an.

## 2026.10.32 – 2026-10-14

- Sprachassistent: Die Antwort wird jetzt vorgelesen. Home Assistant meldet Antwortton und Laufende gleichzeitig; das
  Panel verwarf den Ton, weil der Lauf schon beendet war.
- Weckwort: Die letzte halbe Sekunde vor der Erkennung geht mit an die Spracherkennung, damit der Satzanfang direkt
  nach „Hey Jarvis“ nicht verloren geht.

## 2026.10.31 – 2026-10-14

- Weckwort: Ruhezeit standardmäßig aus (bisher 23–6 Uhr); eine gespeicherte Ruhezeit wird einmalig zurückgesetzt.
  Die Einstellung bleibt im Editor erhalten.

## 2026.10.30 – 2026-10-14

- Tonkette überarbeitet (Kratzen behoben): Die tanh-Sättigung entfällt, Verstärkungen gehen nur noch von 25 bis 400 %
  (100 % = unverändert). Die hohen Werte bis 800 % glichen eine zu niedrige Systemlautstärke des Panels aus und
  übersteuerten, sobald diese wieder normal stand. Gespeicherte Verstärkungen werden einmalig auf die neuen Vorgaben
  zurückgesetzt (Gegensprechen 150 %, alles andere 100 %). Piper-Ansagen laufen ohne Ausgleich; beim Gegensprechen und
  Telefon wird der automatische Aufholpegel des Ausgleichs wieder abgezogen. Präsenzanhebung +3 statt +6 dB, Begrenzer
  bei −3 dBFS.
- Weckwort für den Sprachassistenten: Wandpanels hören dauerhaft mit, die Erkennung übernimmt openWakeWord in Home
  Assistant (Vorgabe „Hey Jarvis“). Nach dem Weckwort ein kurzer Doppelton, dann wie beim Mikrofon-Knopf. Ein Punkt
  am Knopf zeigt, dass gelauscht wird. Ruhezeit (Vorgabe 23–6 Uhr), Pause während Anrufen, nie in der Vorschau im
  Editor. Andere Weckwörter der Engine (etwa „Alexa“) werden verworfen.

## 2026.10.29 – 2026-10-14

- Ansagen über das Panel: Neues Skript „Panel-Ansage sprechen“ (`script.panel_ansage`, Felder `text`, optional
  `titel`, `engine`, `stimme`). Die App lässt Home Assistant den Text sprechen – Vorgabe Piper mit der Stimme Jarvis
  (`tts.piper`, `de_DE-jarvis-medium`) – und spielt den Ton über die Lautsprecher und die Tonkette des Panels ab; der
  Text erscheint kurz als Einblendung. Neuer Pegel „Lautstärke Ansagen und Assistent“ im Editor; abschaltbar über den
  Kartentyp `ansage` in „Karten aus“.
- Heimkomm-Briefing (Dominik und Gina) spricht jetzt über das Panel im Flur statt über die Echos. „Alles stumm“
  unterdrückt die Ansage weiterhin; Popup, Push und Panel-Meldungen bleiben unverändert.
- Sprachassistent am Panel: Mikrofon-Knopf neben der Glocke. Antippen startet eine Assist-Pipeline (Vorgabe
  „Home Assistant Cloud“, wählbar im Editor, z. B. „Nur Lokal“ mit faster-whisper); das Panel schickt 16-kHz-Ton,
  Home Assistant erkennt das Sprechende selbst. Erkannter Text und Antwort erscheinen unten im Overlay, die Antwort wird
  gesprochen. Erneutes Tippen beendet die Eingabe oder schließt das Overlay. Während eines Telefonats gesperrt.

## 2026.10.29 – 2026-10-14

- Ruhigerer Telefon-Klingelton „Marimba und Harfe“: vier weiche Töne C–E–G–E in mittlerer Tonlage mit
  Marimba-Anschlag und Harfenausklang, alle 3,5 Sekunden (bisher ein hohes „Ti-ta“ bei 1,4–1,9 kHz).

## 2026.10.28 – 2026-10-14

- Verpasste Anrufe: Ein eingehender Anruf, den niemand am Panel annimmt, erscheint als Feed-Karte „Verpasster Anruf“
  (je Nummer eine Karte mit „n×“, Ring über 2 Stunden, Knöpfe „Zurückrufen“ und „Erledigt“). Nicht gezählt werden am
  Panel abgelehnte und an einem anderen Telefon angenommene Anrufe (CANCEL mit `Reason: SIP;cause=200` der FRITZ!Box).
  Die Liste liegt in `/data/telefon_verpasst.json` und gilt nur für den laufenden Tag. Neue Panel-Anfrage
  `telefon_verpasst_erledigt`; der Editor kann die Karte abschalten (`verpasst`). Feed-Karten können jetzt Knöpfe tragen.
- Halo beim Klingeln: Drei grüne Wellen laufen vom Rand der Anrufkarte nach außen, solange es klingelt.
- Halo statt Randblinken bei kritischen Meldungen: Das Blinken des Bildschirmrands entfällt. Stattdessen sendet das
  Popup bei `kritisch` (rot) und `zeitkritisch` (gelb) drei Wellen aus seinem Rand. Beides entfällt bei abgeschalteten
  Animationen und mit `prefers-reduced-motion`.

## 2026.10.27 – 2026-10-14

- Lauter auf den Lautsprechern des Panels: Die Tonkette schneidet Tiefen unter 300 Hz ab (die kleinen Lautsprecher
  geben sie kaum wieder, sie kosten aber Aussteuerung) und hebt den Bereich um 2,8 kHz um 6 dB an. Haustür-Gong eine
  Oktave höher mit kräftigeren Obertönen und kurz stehendem Ton, Telefon-Klingelton bei 1,4–1,9 kHz, ebenfalls mit
  stehendem Ton. Hinweis in DOCS (Kiosk), wie sich die Systemlautstärke des Surface über 100 % anheben lässt.
- Telefonbuch aktuell: Das Panel lud die Kontakte bisher nur einmal nach dem Start. Jetzt holt die App das
  FRITZ!Box-Telefonbuch bei jedem Öffnen der Kontakte neu (höchstens alle 30 Sekunden), sonst alle 5 Minuten
  (bisher 15).

## 2026.10.26 – 2026-10-14

- Alle Töne deutlich lauter: Die Verstärkung saß bisher vor einem Kompressor mit -30 dB Schwelle, der sie fast
  vollständig wieder wegnahm (Klingelton bei 300 % nur rund 2 dB lauter als ohne Verstärkung). Neue Kette: Pegel je Art
  mit Verstärkung, weiche Sättigung, Begrenzer kurz unter 0 dBFS. Sprache (Gegensprechen, Telefon) wird vorher
  ausgeglichen. Gemessen: Klingelton rund 7 dB, Telefon rund 9 dB lauter. Der Klingelton des Telefons läuft mit
  höherem Grundpegel über dieselbe Kette.

## 2026.10.25 – 2026-10-14

- Ruhezustand wieder erreichbar: Blieb die Entfernung einer Heimfahrt länger als zehn Minuten gleich, warf die
  Heimweg-Karte einen Fehler, der den Takt der App beendete. Danach wechselte das Panel nie mehr in Ruhe oder
  Nachtabdunklung. Die Karte ist korrigiert; Fehler im Takt werden protokolliert und beenden ihn nicht mehr, die
  Ruhe-Prüfung läuft unabhängig weiter.
- Telefon: Das Panel arbeitet als eigenes IP-Telefon an der FRITZ!Box (neue App-Optionen `telefon_server`,
  `telefon_benutzer`, `telefon_passwort`, optional `telefon_externe_adresse`, `fritz_benutzer`, `fritz_passwort`;
  UDP-Ports 5062 und 40000–40003). Neues Modul „Telefon“ mit Favoriten (Editor), Kontakten aus dem FRITZ!Box-
  Telefonbuch, Tastatur und Anrufliste. Eingehende Anrufe zeigen eine Anrufkarte mit Klingelton (Ablehnen,
  Minimieren, Annehmen); im Gespräch Dauer, Stumm, Tastentöne, Minimieren und Auflegen. Minimiert liegt der Anruf als
  grüne Zeile in der Live-Kapsel, auch auf der Startseite. Die Haustür hat Vorrang; *Sprechen* schaltet das Telefon
  stumm. Der Gesprächston läuft über die bestehende Panel-Verbindung. Home Assistant erhält bei jedem Wechsel das
  Ereignis `pm_panel_studio_anruf`. Einrichtung: DOCS, Abschnitt „Telefon“.
- Verstärker für alle Töne: Hinweis-, Alarm- und Klingelton laufen über eine gemeinsame Kette mit Kompressor. Neue
  Einstellungen „Verstärkung aller Töne“ (`ton_verstaerkung`, 100–800 %, Standard 300) und „Lautstärke Telefon“
  (`telefon_lautstaerke`, Standard 400). Das Gegensprechen nutzt dieselbe Kette mit eigenem Regler.
- Stundenplan: Einträge aus den Kalendern in `stundenplan_kalender` (Standard `calendar.universitat`) erzeugen keine
  „Als Nächstes“-Karten und stehen nicht im Vorausblick. Stattdessen zeigt von 5:30 bis 9:00 Uhr eine eigene Feed-Karte
  die Einträge des Tages (im Editor abwählbar).
- Vorausblick „Morgen“ von 20:00 bis 01:00 Uhr (bisher 21–24 Uhr); nach Mitternacht als „Heute“.
- Schlankere Menüleiste: nur Symbole, beschriftet ist der geöffnete Eintrag. Direkt sichtbar sind „Start“ und die
  ersten `dock_anzahl` Module (Standard 6, Editor 3–12), die übrigen hinter „Mehr“.
- Status-Pillen für Haus-Modi: Solange „Finn ist da“, „Alles stumm“, „Gina lernt“, „Kohle stumm“ oder „Wohnung leer“
  an sind, erscheinen sie als Pille in der Statuszeile; ein Tipp öffnet die Details. Liste im Editor (`status_modi`).
- Rams-Karte: Der Spielstand passt in den Ring (Teamlogos darüber), Hinweise wie Verlängerung stehen darunter. Ring
  bei Sieg grün, bei Niederlage rot, live in Rams-Gold mit dem Spielfortschritt (führend hell, zurück gedämpft).

## 2026.10.24 – 2026-10-13

- Gegensprechen lauter: Der Ton von der Haustür läuft jetzt über einen Verstärker mit Kompressor, der Spitzen
  abfängt. Neue Einstellung „Lautstärke Gegensprechen“ im Editor (100–800 %, Standard 400 %); sie wirkt auch
  während eines laufenden Gesprächs. Mikrofon- und Sprachlautstärke der Intercom stehen bereits auf dem Maximum.

## 2026.10.23 – 2026-10-09

- Müll-Karte ohne Sondermüll: Sondermüll- und Schadstoffabholungen erscheinen nicht mehr im Feed. Stehen am selben
  Tag weitere Tonnen an, bleibt die Karte mit diesen; ist es nur der Sondermüll, entfällt sie.

## 2026.10.22 – 2026-10-09

- Neue Feed-Karte „Pakete“: Sie zeigt die Sendungen aus `sensor.pakete` (normalisierter Paket-Sensor aus der Integration
  Parcel). Die Karte erscheint, solange Sendungen aktiv sind oder heute etwas zugestellt wurde. Der Ring zeigt die
  Stufe der ersten Sendung (angekündigt, unterwegs, in Zustellung, zugestellt; Anteil Stufe von 4), die Zahl darin die
  aktiven Sendungen. Darunter stehen bis zu fünf Zeilen mit Versender und „Titel · Status, Tag Zeitfenster“
  (heute, morgen, sonst „Mo 12.10.“), der Rest als „+n weitere“. Relevanz: in Zustellung 75, Problem (Zustellversuch,
  Problem) 70, heute erwartet oder abholbereit 60, sonst 40, nur noch heute Zugestelltes 30. Ein Tipp öffnet ein
  Popup mit allen Sendungen: Versender, Titel, Stufenleiste mit vier Schritten (ein Problem färbt den Schritt rot),
  erwarteter Tag und Zeitfenster, letztes Ereignis mit Ort und Zeit sowie die Sendungsnummer. Das Popup folgt dem Sensor
  und schließt, sobald die Karte verschwindet. Die Attribute des Sensors kommen je nach Auswertung der Vorlage als
  Liste oder als Text an; beides wird gelesen. Im Editor unter „Pakete“ abwählbar.
- Neue App-Option `pakete_entitaet` (Standard `sensor.pakete`, leer = keine Paketkarte). Der Standard gilt auch, wenn die
  gespeicherten App-Optionen die Option noch nicht enthalten.
- Die Hinweiszeilen `paket` (Paket heute) und `spueler` (Geschirrspüler läuft) aus dem Hinweis-Sensor erscheinen nicht
  mehr als Karte, weil es dafür eigene Karten gibt („Pakete“ und „Spülmaschine“). `paket` wird nur unterdrückt, solange
  `pakete_entitaet` gesetzt ist; bei leerer Option bleibt die Hinweiszeile. „Fertig“ bleibt unverändert.
- Die Karte „Spülmaschine“ zeigt jetzt auch den Zustand „Eingriff nötig“ (ActionRequired), den bisher nur die
  Hinweiszeile meldete.
- Fehlerhafte Fremddaten im Paket-Sensor (unlesbare Attribute, unmögliche Zeitangaben) lassen den Feed nie ausfallen;
  im Zweifel fehlt nur die Paketkarte, der Fehler steht im Protokoll.

## 2026.10.21 – 2026-10-09

- Neue Feed-Karte „Heimweg“: Ist Dominik oder Gina auf dem Weg nach Hause (Proximity-Integration meldet „towards“,
  Start mindestens 1 km entfernt), zeigt die Karte die verbleibenden Kilometer im Ring und eine geschätzte
  Ankunftszeit. Der Ring füllt sich mit der zurückgelegten Strecke und ist bei 0 km voll. Die Ankunftszeit folgt
  aus der gemessenen Annäherung der letzten Minuten (ohne Messung: 50 km/h auf der Straße). An der Ampel bleibt die
  Karte stehen, bei einem Umweg ruht sie, bei Ankunft verschwindet sie. Relevanz 65, in den letzten 5 Minuten 90.
  Im Editor unter „Heimweg“ abwählbar.

## 2026.10.20 – 2026-10-09

- Klingelton am Haustür-Overlay: Sobald das Overlay „Haustür“ wegen eines Klingelns erscheint, spielt das Panel ein
  zweitöniges „Ding-Dong“ (eigene Web-Audio-Synthese, keine Datei; klar vom dreistimmigen Alarm-Gong unterscheidbar).
  Er klingelt einmal und nach etwa 4,5 Sekunden ein zweites Mal, solange das Overlay offen ist und kein Gespräch läuft.
  Ein erneutes Klingeln bei offenem Overlay klingelt erneut (mindestens 3 Sekunden Abstand); dafür zählt der Server
  im Ereignis ein neues Feld `klingel` hoch. Nach einem Neuladen oder Reconnect merkt sich das Panel nur den Zähler und
  bleibt stumm, damit ein App-Update nicht klingelt.
- Der Klingelton ist bewusst „immer voll“: `alles_stumm`, Finn, Gina lernt und die Nacht unterdrücken ihn nicht.
  Neue Einstellungen im Editor: „Lautstärke Klingelton“ (`klingel_lautstaerke`, 5–100, Standard 100) und ein Schalter
  „Klingelton beim Haustür-Overlay“ (`ton_klingel`, Standard an), damit er abschaltbar bleibt.
- Der Ton endet sofort, wenn das Overlay schließt oder ein Gespräch beginnt, damit das Mikrofon ihn nicht aufnimmt.
  „Haustür testen“ im Editor spielt den Klingelton ebenfalls. Alarmton, Meldungen und das übrige Overlay bleiben
  unverändert; Overlays für Person und Ereignis klingeln nicht.

## 2026.10.19 – 2026-10-09

- Termine im Feed ohne Müllabfuhr: Die Einträge des Abfuhrkalenders (Waste Collection Schedule) erscheinen nicht mehr
  in den Terminkarten und in der Karte „Morgen“; die Müllabfuhr hat ihre eigene Karte. Im Kalender-Modul bleiben sie.

## 2026.10.18 – 2026-10-09

- Wetterwarnungen: je Wettergefahr nur noch eine Karte. Der DWD meldet dieselbe Lage oft mehrfach – gestaffelt
  (Windböen, Sturmböen), zugleich als aktuelle Warnung und als Vorabinformation oder für mehrere Regionen; das ergab
  zwei oder drei fast gleiche Karten. Jetzt fasst das Panel Gewitter, Wind, Regen, Schnee, Glätte, Frost, Nebel, Hitze
  und Tauwetter zusammen: höchste aktive Stufe als Titel, Zeitraum bis zum spätesten Ende, weitere Stufen als
  „zeitweise …“ und eine höhere Vorabinformation als „später möglich: … (Stufe n)“. Eine reine Vorabinformation
  erscheint nur, wenn zur selben Gefahr nichts Aktives vorliegt.
- Die Karte „Wetterwechsel“ entfällt, solange der DWD vor Gewitter, Regen oder Schnee warnt.

## 2026.10.17 – 2026-10-09

- Musik-Karte: Sie erschien, obwohl in Music Assistant nichts lief. Alexa-Geräte melden dort oft dauerhaft „playing“,
  entweder ganz ohne Titel oder mit einem Titel, der nach dem Start auf 0:00 stehen bleibt. Solche Player zeigen
  keine Karte mehr (ohne Titel sofort, bei stehender Position nach 90 Sekunden).

## 2026.10.16 – 2026-10-08

- Räume: Die Geräte-Box zeigt höchstens sechs Einträge; Schreibtisch und Serverschrank fielen im Büro hinten heraus.
  Gesicherte Hauptschalter stehen jetzt direkt nach „PC starten“ vorn. Die Relais der NS-Panels Bad und Büro sind in
  Home Assistant ausgeblendet und erscheinen nicht mehr.
- Wohnzimmer: Der Hauptschalter „Wohnzimmer“ (`switch.wohnzimmer_wohnzimmer`) ist gesichert wie die Büro-Schalter,
  mit eigener Freigabe `input_boolean.wohnzimmerstrom_schaltfreigabe`.
- Wetter auf der Startseite: Regnet es gerade, steht hinter der Regenwahrscheinlichkeit die gemessene Menge des
  Regenradars (`sensor.niederschlag_lokal`, z. B. „Regen 70 % · 0,2 mm“). Bei 0 mm entfällt sie.
- Live-Kapsel: Beim Rams-Spiel stand der Spielstand doppelt; rechts stehen jetzt Viertel und Spieluhr.

## 2026.10.15 – 2026-10-07

- Kamera: Das Livebild blieb in Detailansicht und Benachrichtigungs-Popup leer. Die Kamerafläche trägt die Klasse
  „live“, und die Regeln der Live-Kapsel galten für jedes Element mit dieser Klasse (ausgeblendet, fixiert). Die
  Kapsel-Regeln gelten jetzt nur noch für die Kapsel selbst (`#live`); damit kann die Klasse nirgends mehr
  kollidieren.
- Termine: Der Kalender der Workday-Integration (Arbeitstage) erscheint nicht mehr als Termin, weder in den
  Terminkarten noch in der Vorschau für morgen oder im Kalender-Modul.

## 2026.10.14 – 2026-10-07

- Haustür-Overlay ohne Kamerabild: An der Haustür gibt es keine Kamera, die Ereignis-Kamera hängt an der
  Wohnungstür. Das Overlay zeigt dort jetzt „Es klingelt an der Haustür“ statt einer leeren Fläche.
- Das Panel lädt sich nach einem Update der App selbst neu. Bisher lief im offenen Browser der alte Code weiter;
  beim ersten Klingeln nach 2026.10.12 fehlte deshalb „Sprechen“, und „Tür öffnen“ öffnete den allgemeinen
  Türöffner (Wohnungsschloss) statt der Haustür.
- Energiefluss: Der Fluss verschwand nach der ersten Live-Aktualisierung (nach etwa 2 Sekunden). Er setzte dabei die
  Klasse „live“, die seit 2026.10.x der Live-Kapsel gehört und Elemente ohne „sichtbar“ ausblendet und verkleinert.
  Der Energiefluss nutzt jetzt „fluss-live“.

## 2026.10.13 – 2026-10-07

- Rams-Aktivität aus dem Lovelace-Dashboard: Der Feed zeigt eine Spielkarte nach `sensor.la_rams` (TeamTracker/ESPN),
  sichtbar am Spieltag (`binary_sensor.rams_spieltag`), während des Spiels und bis 12 Stunden nach Spielende.
  Vorschau („Rams vs Bills“, Anpfiff in Ortszeit, TV), live („Rams 21 : 17 Bills“, Viertel, Uhr, Down & Distance) und
  Endstand (Sieg/Niederlage/Unentschieden) mit Badge UPCOMING, ● LIVE und FINAL. Relevanz: live 85, am Spieltag 50,
  danach 20. Antippen öffnet die Spieldetails (Logos, Kickoff, Stadion, Ort, TV, Bilanz, Saison, letzter Spielzug).
  Während des Spiels steht der Spielstand zusätzlich in der Live-Kapsel auf den Unterseiten. Mit
  „karten_aus: rams“ lässt sich die Karte ausblenden.
- Die Teamlogos kommen direkt von ESPN: Die Content-Security-Policy erlaubt Bilder jetzt zusätzlich von
  `https://a.espncdn.com` (sonst nichts). Ohne Logo zeigt die Karte das Teamkürzel in Teamfarbe.
- Büro: Die neuen Steckdosen „Schreibtisch“ (`switch.schreibtisch`) und „Serverschrank“ (`switch.serverschrank`)
  stehen unter derselben Schaltfreigabe wie der Büro-Hauptschalter (`input_boolean.burostrom_schaltfreigabe`).
  Die Standard-Freigaben gelten jetzt auch dann, wenn gespeicherte Einstellungen eigene Freigaben enthalten.

## 2026.10.12 – 2026-10-07

- Gegensprechen an der Haustür: Klingelt die Ring Intercom (Integration PM Ring Intercom, neue Option
  `intercom_ausloeser`, Standard `binary_sensor.haustur_klingelt`), zeigt das Panel das Overlay „Haustür“ mit
  „Sprechen“. Das Gespräch läuft über WebRTC direkt zwischen Panel und Ring; die App vermittelt nur den Aufbau.
  „Tür öffnen“ öffnet dort die Haustür (`haustueroeffner`). Während des Gesprächs bleibt das Overlay offen.
- Editor: Knopf „Haustür testen“.
- Kiosk-Anleitung: Chromium-Parameter für das Mikrofon über `http://…:8098`.

## 2026.10.11 – 2026-10-07

- Haushaltsgeräte: Zimmerreinigung für den Roborock. Unter der Karte die Zimmer antippen; die Nummer zeigt die
  Reihenfolge, „n Zimmer reinigen“ startet `vacuum.clean_area` mit genau dieser Reihenfolge. Grundlage ist die
  Bereichszuordnung des Roboters in Home Assistant (Küche, Flur, Badezimmer, Büro, Schlafzimmer, Wohnzimmer).

## 2026.10.10 – 2026-10-07

- Haushaltsgeräte: Die Restzeit des Geschirrspülers stimmt wieder. Seine Restzeit kommt als reine Sekundenzahl (z. B.
  „7500“); das Panel las sie als Jahreszahl und zeigte Millionen Stunden. Unplausible Restzeiten über zwei Tage
  werden nicht mehr angezeigt.
- Haushaltsgeräte: Die Roborock-Karte füllt die Kachel aus. Das Panel schneidet den leeren Rand des Kartenbilds ab und
  zeichnet die Wohnung so groß wie möglich; die Kachel selbst bleibt gleich groß.

## 2026.10.9 – 2026-10-07

- Neuer Reiter „Haushaltsgeräte“: Waschmaschine und Geschirrspüler mit Fortschrittsring, rollender Restzeit, Phase,
  „fertig um“ und Quittieren; Live-Karte des Roborock mit seiner Position (während der Reinigung alle 5 s neu, weich
  überblendet), Status, Raum, Akku, Steuerung, Programme und Verbrauchsmaterial; weitere Geräte als Kacheln.
- Waschmaschine: Die Restzeit kommt aus „sensor.waschmaschine_programmende“ (Programmstart plus Gesamtdauer). Die
  LG-Integration meldet nach dem Start nur die Restzeit der aktuellen Phase; ohne den Sensor gilt der alte Wert.
- Reiterleiste: Passen nicht alle Reiter, blendet der Rand weich aus und der aktive Reiter bleibt sichtbar. Module
  können einen kurzen Reiternamen haben („Haushalt“).
- Releases: Ein GitHub-Workflow legt zu jeder neuen Version Tag und Release an und hat die fehlenden nachgetragen.

## 2026.10.8 – 2026-10-07

Konzept Stufe 4 nach den Apple Human Interface Guidelines, aufbauend auf dem Bewegungskonzept. Der Feed sieht aus
wie bisher.

- Meldungen in vier Stufen (`stufe`: passiv, aktiv, zeitkritisch, kritisch; `prioritaet` high/normal/low bleibt
  gültig). Passiv (auch `low`) nur unter der Glocke; aktiv weckt tagsüber; zeitkritisch weckt tagsüber mit kurzem Ton und gelbem
  Rahmenglühen; kritisch durchbricht Ruhe und Nacht. Nachts (Sonne unter dem Horizont) weckt nur kritisch.
- Feed nach Relevanz sortiert, Rotation bleibt; wichtigere Karten stehen etwas länger.
- Feed-Karten lassen sich wischen; das Sheet folgt beim Herunterziehen dem Finger und federt zurück oder schließt.
- Ein Raum schließt so, wie er aufgeht: zurück in seine Zeile bzw. Kachel.
- Live-Kapsel für laufende Timer auf Unterseiten (nicht auf der Startseite): Ecke unten rechts, frei verschiebbar,
  schwebt beim Loslassen in die nächste Ecke und merkt sich diese.
- Optimistisches Schalten: Kacheln springen sofort um, zeigen bei Verzögerung einen Warte-Kreis und kehren bei Fehler
  mit Hinweis zurück.
- Glas für Dock und Seitenkopf, konzentrische Radien, feste Schriftrollen.
- Neue Option „Lesbarkeit“: mehr Kontrast, Tippflächen ab 64 px, Zustände zusätzlich als Form.
- Lange Eilmeldungen werden auf der Karte nach vier Zeilen gekürzt.
- Entfernt: Lichtstrahl beim Aufwecken.

## 2026.10.7 – 2026-10-07

- Energie: Die Geräteliste zeigt die Leistung jedes Geräts live; sie ändert sich mit dem Leistungssensor, ohne dass
  die Seite neu aufgebaut wird. Der Verbrauch in kWh stammt weiter aus der Statistik.
- Feed: Eilmeldungen lassen sich antippen und öffnen einen Dialog mit der ganzen Meldung; solange er offen ist,
  dreht das Karussell nicht weiter.
- Feed: Termine erscheinen frühestens 3 Stunden vor Beginn als eigene Karte mit ablaufendem Countdown im Ring
  (h:mm:ss, unter einer Stunde mm:ss); mit Beginn verschwindet die Karte. Ganztägige Termine haben keinen Countdown.
- Feed: Von 21 bis 24 Uhr listet die Karte „Morgen“ die Termine des nächsten Tages (höchstens fünf, dann
  „+n weitere“), nur wenn es welche gibt.

## 2026.10.6 – 2026-10-07

- Neue Sektion „Musik“ für Music Assistant: Player-Liste (nur Music-Assistant-Player, keine Alexa-Zwillinge),
  „Läuft gerade“ mit Cover, Fortschritt, Steuerung und Lautstärke, Suche (Titel, Alben, Playlists, Interpreten,
  Radio; Antippen spielt, „Als Nächstes“ reiht ein) und Bibliothek (Zuletzt, Playlists, Radio). Erscheint nur, wenn
  Music-Assistant-Player vorhanden sind, und einmalig automatisch im Dock.
- Zähler und Timer: Kurze Zahlen stehen mittig im Ring, auch wenn die Beschriftung darunter breiter ist.
- Energiefluss: Die Lichtteilchen laufen bei Live-Aktualisierungen weiter, statt alle 2 s kurz zu verschwinden und
  neu zu starten.

## 2026.10.5 – 2026-10-07

- Wettersymbole: Kein Sprung mehr in der Animation. Das Symbol links, die Vorschau und das Symbol in Wetter- und
  Warnkarten wurden bei fast jeder Zustandsänderung neu aufgebaut und starteten dabei von vorn. Jetzt wird ein
  Symbol nur ausgetauscht, wenn sich das Wetter tatsächlich ändert; Temperatur und Texte ändern sich an Ort und Stelle.
- Regen, Schnee und Hagel: Tropfen und Flocken haben leicht unterschiedliche Laufzeiten, damit kein gleichmäßiger
  Takt erkennbar ist.

## 2026.10.4 – 2026-10-07

- Zugang: Das Schloss öffnet nicht mehr direkt. Halten mit Ring um den Finger (1 s) öffnet den Schloss-Dialog mit
  Verriegeln, Entriegeln und Öffnen; Entriegeln und Öffnen verlangen dort erneut 2 s Halten. Halten bricht beim
  Wischen nicht mehr ab (kein Verschieben der Seite während des Haltens).
- Zugang: Neue Option `haustueroeffner` (Standard `button.haustur_tur_offnen`). Die Gruppe zeigt Schlösser und
  Haustür-Öffner, jede Entität nur einmal; ist `tueroeffner` das Schloss selbst, erscheint es nicht mehr doppelt.
- Energie: Der Energiefluss zeigt die Live-Leistung in Watt aus den Leistungssensoren des Energie-Dashboards und
  nur die Geräte, die gerade verbrauchen (über 1 W). Er aktualisiert sich bei jeder Änderung, höchstens alle 2 s.
- Feed: „Als Nächstes“ (Termin in den nächsten 24 h) steht immer zusätzlich zu den übrigen Karten, auch neben einem
  laufenden Timer. „Alles in Ordnung“ erscheint, wenn sonst nichts läuft, jetzt auch im Ruhemodus.

## 2026.10.3 – 2026-10-07

- Energie: Geräte und Kaskaden folgen dem Energie-Dashboard von Home Assistant ohne Neustart. Ist die Seite offen,
  prüft sie jede Minute, ob dort etwas geändert wurde (neues Gerät, anderes vorgelagertes Gerät), und baut sich dann
  neu auf; die Verbrauchswerte erneuert sie alle 5 Minuten.
- Energie: Der Energiefluss steht über die ganze Breite unter den drei Spalten; die Seite scrollt.
- Laufende Timer (Kohle, Duschmodus, Spa, Geräte) rollen wie ein Zählwerk herunter, immer auf dem kürzeren Weg
  (0 → 9 rollt einen Schritt zurück). Die Zahl pulsiert dabei nicht mehr; nur der Kopfpunkt glimmt im Sekundentakt.

## 2026.10.2 – 2026-10-07

Bewegungskonzept vollständig umgesetzt (Stufen 1–3), dazu Unwetterwarnung, neue Feed-Regeln und animierte
Wettersymbole. Alle Animationen nutzen gemeinsame Tokens (`static/bewegung.css`) und folgen dem Schalter
„Animationen“ sowie `prefers-reduced-motion`.

- Stufe 1: Komet-Ring für alle Ringe (Verlauf in der Ringfarbe, leuchtender Kopfpunkt). Zahlenwalze statt
  Hochzählen, auch über die Tausenderstelle (999 → 1.000 rollt die neue Stelle herein, der Punkt blendet ein).
  Kacheln geben beim Tippen nach, Licht blüht vom Finger aus, beim Einschalten streicht ein Glanz darüber.
- Laufende Timer atmen im Sekundentakt: Die Zahl hebt und senkt sich, Ring und Kopfpunkt glimmen mit.
- Stufe 2: Kartenwechsel „Schichtwechsel“ (alte Karte tritt unscharf in die Tiefe, neue wird aufgedeckt; Kopf,
  Ring, Überschrift und Zeile folgen im Abstand von 80 ms). Halten mit Ring um den Finger und Federimpuls zur
  Bestätigung. Meldungen mit Priorität hoch fallen mit Feder herein und lassen den Bildschirmrand dreimal glühen.
- Stufe 3: Räume öffnen sich aus ihrer Kachel (View Transitions), Inhalte gestaffelt. Polarlicht im Ruhezustand
  (nachts aus), Weckstrahl beim Aufwachen. Lichtteilchen im Energiefluss, ihre Dichte folgt der aktuellen Leistung.
- Unwetterwarnung des DWD als eigene Feed-Karte vorn: Farbe nach Stufe (gelb, orange, rot, violett), Ring = Stufe
  von 4, im Ring das animierte Warnsymbol, ab Stufe 3 glüht der Kartenrand. Vorabinformationen folgen den aktiven
  Warnungen. Die knappe Warnzeile der Hinweisvorlage entfällt dafür.
- Feed-Regeln: Das Wetter erscheint nur noch vor einem Wechsel in den nächsten 3 Stunden („Regen ab 15 Uhr“,
  „Regen hört gegen 16 Uhr auf“). Ohne Hinweise bleibt der Feed im Ruhezustand leer; wach zeigt er „Alles in
  Ordnung“ und, falls vorhanden, den nächsten Termin der kommenden 24 Stunden.
- Wettersymbole links animiert: Regen fällt, Sonne pulsiert, Wolken ziehen, Nebelstriche wandern, Blitz schlägt ein.

## 2026.10.1 – 2026-10-07

Erste stabile Version (nicht mehr als experimentell gekennzeichnet). Versionen folgen ab jetzt dem Schema
Jahr.Monat.Nummer.

- Eigenes App-Symbol und Logo (Wandpanel mit Ringtimer) statt der Bilder von Klima Studio.
- Energie: neuer Energiefluss wie im Energie-Dashboard von Home Assistant. Gesamtverbrauch → Geräte → enthaltene
  Geräte, je Ebene mit „Nicht erfasst“; mit Netz, Solar oder Batterie im Energie-Dashboard zählt der Hausverbrauch.
  Grundlage sind allein die Energie-Einstellungen von Home Assistant; neue Zähler und Kaskaden („Vorgelagertes Gerät“)
  erscheinen ohne Änderung am Panel.
- PM Klima Studio als eigene Seite (Modulleiste und Knopf auf der Seite Klima). Die App reicht Klima Studio über das
  interne App-Netz durch; nötig ist derselbe Schlüssel in beiden Apps (`klima_studio_schluessel` hier,
  `panel_schluessel` in Klima Studio ab 1.2.2).
- Shisha: Shishas und Kohlezähler stehen jetzt beide als waagerechte Reihe rechts neben der Kohle.
- Behoben: Bei Halte-Knöpfen (z. B. Schloss auf der Startseite) öffnete ein langes Drücken auf dem Touchscreen nach
  etwa 0,6 s den Dialog, bevor der Balken voll war. Halten löst jetzt erst mit vollem Balken aus; kurzes Antippen
  öffnet die Mehr-Infos.
- Behoben: Aufnahmen der Reolink-Kamera ließen sich nicht abspielen. Die App lädt die Aufnahme jetzt vollständig
  und liefert sie selbst mit Länge und Spulen (Range) aus; die letzten vier bleiben im Speicher.
- Editor: Speichern prüft das Ergebnis durch erneutes Lesen und meldet Fehler sichtbar; das Protokoll der App nennt
  bei jedem Speichern die geänderten Felder.

## 0.1.14 – 2026-10-02

- Neue Seite „Shisha“ (Dock und Modulband, vor „Wartung“; bestehende Einstellungen nehmen sie einmalig auf):
  - Kohle: Ring mit sekundengenauer Restzeit des Kohle-Timers, Knopf „Kohle einschalten/ausschalten“, Kohle stumm.
  - Shishas: Zähler „Diese Woche“ und „Dieses Jahr“ als sich füllende Ringe; gedachte Marke 20 bzw. 1000 nur für
    den Füllstand, die Zähler laufen darüber hinaus weiter.
  - Kohlezähler: Vorrat (Marke = Zähler-Maximum 54, Farbe wird bei wenig Vorrat gelb bzw. rot, Zurücksetzen =
    neue Packung) und Kohle gesamt (Ring bis zur nächsten 500er-Marke).
  - Je Zähler Minus, Plus (Schrittweite des Zählers, z. B. ±3 bei Kohle) und Zurücksetzen (2 s halten).

## 0.1.13 – 2026-10-02

- Raumansicht: Die Raumreiter unter dem Modulband entfallen; Räume wählen Sie über die Übersicht „Räume“.
- Raumansicht: neue Box „Luftqualität“ unter dem Licht. Oben das Urteil von PM Klima (gut, mittel, schlecht) mit
  den Gründen und dem Taupunkt, darunter je Messwert eine Skala mit Eskalationsfarben von Grün bis Rot und
  Einstufung: CO₂ (ppm), Feinstaub PM2,5 und PM10, VOC, AQI, Allergen-Index und Luftfeuchte. Antippen zeigt den
  Verlauf. Die Luftwerte stehen nicht mehr unter „Zustand“.

## 0.1.12 – 2026-10-02

- Karussell: Kohle, Duschmodus und Spa zählen wie an den Panels Bad und Büro sekundengenau („7:12 min“); Geräte mit
  geschätzter Restzeit (Waschmaschine, Spüler) bleiben bei Minuten.

## 0.1.11 – 2026-10-02

- Büro: Server-Hauptschalter (`switch.buro_buro`, in HA jetzt „Main Switch Server“ mit Symbol Server) nur mit
  Freigabe schaltbar. Antippen öffnet den Dialog: erst „Freigabe erteilen“ (2 s halten, setzt
  `input_boolean.burostrom_schaltfreigabe`), dann Ein- bzw. Ausschalten (2 s halten). Das Backend weist Schaltbefehle
  ohne Freigabe ab. Der Freigabe-Helfer erscheint nicht mehr als eigene Kachel. Zuordnung im Editor-Feld `freigaben`.
- Büro: Wake on LAN („Main PC starten“, `button.buro_wol_main_pc`) als erste Kachel unter „Geräte“.
- Thermostat-Dialog: Heizphasen (hvac_action „heizt“) als Bänder im 24-h-Verlauf, darunter Gesamtdauer und Zeiten.
  Ohne Raumsensor zeigt der Verlauf die Isttemperatur des Thermostats.

## 0.1.10 – 2026-10-02

- Pollen-Karte mit Ring: Stufe 0–4 des Österreichischen Pollenwarndienstes („3 von 4“ bei „hoch“).
- Der Feed (Karussell): leichter Halo um den Ring, sonst unverändert.
- Begrüßung unten links, höchstens zwei Sätze: nach dem Heimkommen („Willkommen zuhause, Sir.“, „Willkommen daheim,
  Gina.“), morgens 6–10 Uhr mit Termin oder Wetter, nachts 0–1:30 Uhr mit kurzem Abschluss (offene Fenster, Müll,
  Alarmanlage). Abschaltbar im Editor.
- Modulband auch auf der Seite Räume; die Raumreiter stehen als eigene Zeile darunter.
- Klima → Luft: ein einziger Außenwert (lokale Wetterstation, DWD als Rückfall), innen ein Wert je Raum.
- Sicherheit → Aufnahmen der Reolink-Kamera: die letzten fünf von heute und gestern, „Alle Aufnahmen“ mit
  Tagesauswahl (14 Tage). Antippen spielt die Aufnahme im Dialog ab, Spulen eingeschlossen.
- Wartung → Systemzustand ohne Jarvis-Liste: geprüft werden automatisch alle Geräte; eines gilt als nicht
  erreichbar, wenn alle seine Entitäten „nicht verfügbar“ sind. Ausnahmen im Editor.
- Wartung → Verbrauchsmaterial: nur echtes Material (Filter des Luftreinigers, Bürsten, Filter und Sensoren des
  Roborock) mit Restanteil; Roborock-Stunden gemessen an den Herstellerwerten (Hauptbürste 300 h, Seitenbürste 200 h,
  Filter 150 h, Sensoren 30 h). Im Editor umschaltbar zwischen automatischer Auswahl und festen Einträgen.

## 0.1.9 – 2026-10-01

- Karussell 1:1 nach dem Konzept: Kopf mit Punkt und Kategorie, Ring mit Zahl und Einheit (Stärke, Größe und
  Schrift wie im Konzept), Überschrift und eine Textzeile, Einblendung mit leichter Drehung, Zahl zählt hoch.
- Ringe mit Bedeutung je Karte: Müll (Stunden bis zur Abholung), Termin (Minuten bis), Fahrt (Minuten), Wetter
  (Regenwahrscheinlichkeit bzw. Höchsttemperatur), Offen (Anzahl), Lüften (Luftfeuchte), Geräte (Restzeit mit
  „fertig gegen …“), Musik (Restzeit des Titels).

## 0.1.8 – 2026-10-01

- Lüften-Karte wie im Konzept: Ring mit der Luftfeuchte („71 % rF“), Überschrift „Bad lüften“, darunter
  „Luftfeuchte 71 % · Fenster 10 Minuten öffnen“. Der Wert stammt aus der Hinweiszeile (Bad-Regel); Hinweise ohne
  Feuchtewert (Büro-Regel) behalten die bisherige Darstellung.

## 0.1.7 – 2026-10-01

- Modulseiten Klima, Licht, Sicherheit, Energie, Medien, Listen und Wartung im Drei-Spalten-Muster der Raumansicht,
  mit Reitern oben; die bisherigen Listen bleiben unter „Alle …“.
- Energie nach dem eingebauten Energie-Dashboard: Geräte und Wasser aus `energy/get_prefs`, Verbrauch aus der
  Statistik (Heute, Gestern, Woche, Monat), gestapeltes Diagramm, enthaltene Geräte eingerückt, Leistung live.
- Wartung: Systemzustand mit derselben Entitätenliste wie das Jarvis-Dashboard.
- Modi je Raum: Helfer wie „Gina lernt“, „Kohle stumm“, Duschmodus, Spa-Modus und Bewegungsmelder Bad erscheinen in
  der Raumansicht (Zuordnung in der App, im Editor änderbar, nicht in der HA-Registry).
- Kompakte Thermostat-Karte: Ringe immer kreisrund, Sollwert mit Plus und Minus vollständig in der Karte.

## 0.1.6 – 2026-10-01

- Glocke oben rechts; sie zählt und listet nur echte Meldungen (Panel-Meldungen, Popups, HA-Benachrichtigungen).
  Hinweise und Status (Offen, Scharf …) bleiben im Karussell und in der Statuszeile.
- Hinweiston bei Meldungen mit Priorität hoch über die Lautsprecher des Panels (dreistimmiger Gong, höchstens
  dreimal im Abstand von 20 s, endet mit OK, Bestätigen oder Später). Stumm bei „Alles stumm“, außer bei
  Sicherheitsmeldungen. Ton und Lautstärke im Editor. Kiosk-Parameter siehe Dokumentation.

## 0.1.5 – 2026-10-01

- Neue Raumansicht auf einem Bildschirm in drei Spalten: links PM-Klima kompakt und Lieblingsszenen, Mitte Licht
  („Alle Lichter“ mit Helligkeitsregler, Lampen nebeneinander), rechts Medien, Zustand und Geräte. Der Rest unter
  „Alle Geräte im Raum“. Raumwechsel über Reiter in der Kopfzeile.
- Lieblingsszenen: die sechs häufigsten der letzten 30 Tage, gewichtet nach Tageszeit; im Editor anheften oder
  ausblenden. Farben aus den Lichtfarben der Szene (nur in HA angelegte Szenen), sonst neutral.
- Namen ohne Raumnamen am Ende („Deckenlampe Wohnzimmer“ → „Deckenlampe“).

## 0.1.4 – 2026-10-01

- Kamera-Livestream (HLS, hls.js lokal eingebunden) beim Antippen einer Kamera und im Tür-Overlay; zuerst das
  letzte Standbild, dann das Video, sobald die Kamera wach ist. Ohne Stream Rückfall auf Einzelbilder.
- Kamerakacheln zeigen nur noch ein Standbild, alle 30 s erneuert (schont Akkukameras).
- Kamera-Popups (z. B. „Wohnungstür Personenerkennung Popup“) öffnen das Vollbild-Overlay wie früher das Popup;
  `browser_mod.close_popup` derselben Kennung schließt es.

## 0.1.3 – 2026-10-01

- Meldungen gegliedert wie an den Panels Büro und Bad: Die App hört `script.panel_meldung` und
  `script.panel_meldung_schliessen` mit (Kennung, Titel, Text, Symbol, Priorität, Bestätigen-Knopf, Laufzeit).
  Ein Browser-Mod-Popup mit gleicher Kennung ergänzt die Meldung um den ausführlichen Text und ggf. eine Kamera.
- Priorität wie am Panel: niedrig nur Glocke, normal Karte und sofort offen, wenn jemand am Panel ist,
  hoch weckt das Panel und öffnet sofort. Knöpfe „Bestätigen“ und „Später“ bzw. „OK“.
- Automationen bleiben unverändert; der Flur zeigt alle Panel-Meldungen.

## 0.1.2 – 2026-10-01

- Browser-Mod-Popups erscheinen im Panel: Die App hört `browser_mod.popup` und `browser_mod.close_popup` mit.
  Jedes Popup wird zur Karte vorn im Karussell und zum Eintrag unter der Glocke; antippen zeigt Text (Markdown),
  Kamera und die Knöpfe des Popups. Ist das Panel wach, öffnet es sich sofort. Ablauf über `timeout`, spätestens
  nach 4 Stunden. Abwählbar im Editor („Popups (Browser Mod)“).

## 0.1.1 – 2026-10-01

- Klima: nur noch PM-Klima-Thermostate (`klima_praefix`); Thermostate ohne Bereich werden über den Namen zugeordnet.
  Schalter von PM Klima im Klima-Modul.
- Licht: Lichtgruppen-Helfer erscheinen in Räumen und im Licht-Modul („Alle Lichter“ je Raum, Untergruppen statt
  Einzellampen); Einzellampen im Dialog der Gruppe.
- Karussell: leichteres Design (dünnere Ringe, kleinere Symbole), Wiedergabe von Music Assistant als Karte.
- Glocke auf der Startseite: HA-Benachrichtigungen (verwerfbar) und aktuelle Hinweise.
- Kamera: Livebild (MJPEG) über die App, Rückfall auf Einzelbilder ohne Überlappung. Behebt das leere Bild.
- Räume: kein Neuaufbau alle paar Sekunden mehr; große Karten aktualisieren sich an Ort und Stelle.
- Szenen ohne bisherige Aktivierung gelten nicht mehr als nicht erreichbar. Rubrik „Ohne Bereich“ entfernt.

## 0.1.0 – 2026-10-01

Erste Ausgabe (Stufen 1 bis 3 des Konzepts).

- Startseite: Uhr, Wetter mit Dreitagesvorschau, Anwesenheit, Statuszeile (Alarm, offene Türen und Schlösser),
  Schnellzugriff, Kurzübersicht Räume, Modulleiste.
- Karussell mit rotierenden Karten wie an den Panels Bad und Büro: Hinweise aus `sensor.panel_*_hinweise`,
  Aktivitäten mit Ringtimer (Duschmodus/Spa, Kohle, Waschmaschine, Spülmaschine, Roborock), lokales Herunterzählen.
- Ruhe und Annäherung über die Bewegungsmelder im Flur, Abdunklung tagsüber und nachts.
- Ereignis-Overlay mit Kamerabild bei Person an der Tür, Türöffner nur nach 2 Sekunden Halten.
- Module: Räume, Klima (inkl. PM Klima Overlay/Boost), Licht, Sicherheit, Medien, Listen (To-dos, Kalender, Angebote),
  Energie, Wartung (Updates, Batterien, nicht erreichbar, Protokoll, Automationen), Suche über alle Entitäten.
- Bediendialog je Gerätetyp mit Verlauf und Attributen.
- Editor in der Seitenleiste (Ingress), Panel-Port 8098 mit Zugangsschlüssel.
