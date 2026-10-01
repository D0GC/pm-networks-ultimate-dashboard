# Änderungen

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
