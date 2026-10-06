# Änderungen

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
