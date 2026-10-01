# Änderungen

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
