"""Karten für das Karussell: Hinweise und laufende Aktivitäten (mit Ringtimer).

Die Regeln entsprechen den Wand-Panels Bad und Büro (Repository pm-networks-ns-panel, ``docs/ARCHITEKTUR.md``,
Abschnitte 7a und 7b). Hinweise kommen fertig aus Home Assistant (``sensor.panel_*_hinweise``, Attribut
``zeilen``), Aktivitäten werden hier aus den Gerätezuständen berechnet.

Eine Karte ist ein Dict:
  id         stabiler Schlüssel (Rotation hält die Position, solange die ID bleibt)
  art        ``hinweis`` | ``aktivitaet`` | ``sport`` (Rams, mit ``spiel``-Details für das Popup)
  schluessel Symbol- und Farbklasse (``eil``, ``warnung``, ``kohle``, ``waesche`` …)
  titel, wert, hinweis  Texte
  ring       Anteil 0..1 oder None (kein Ring)
  ende       ISO-Zeitpunkt, bis zu dem der Wert herunterzählt (der Client zählt lokal), sonst None
  dauer_s    Gesamtdauer in Sekunden für den Ring beim lokalen Herunterzählen, sonst None
  relevanz   0–100 aus Dringlichkeit und Zeitnähe; der Feed sortiert danach (stabil, Gleichstand: Reihenfolge unten)
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

State = dict[str, Any]
States = dict[str, State]

INAKTIV = ("unknown", "unavailable", "", None)

QUELLEN = {
    "dusche_timer": "timer.duschmodus_heizung",
    "spa_timer": "timer.spa_heizung_erinnerung",
    "kohle_schalter": "switch.balkon_kohlegrill",
    "kohle_timer": "timer.kohle_timer",
    "waesche_status": "sensor.karl_die_waschmaschine_aktueller_status",
    "waesche_phase": "sensor.waschmaschine_phase",
    # Programmende (Start + Gesamtdauer, Template-Helfer); der LG-Sensor zeigt nach dem Start nur die Phasen-Restzeit
    "waesche_ende": "sensor.waschmaschine_programmende",
    "waesche_rest": "sensor.karl_die_waschmaschine_verbleibende_zeit",
    "waesche_fortschritt": "sensor.waschmaschine_fortschritt",
    "spueler_status": "sensor.dishwasher_bsh_common_status_operationstate",
    "spueler_fortschritt": "sensor.dishwasher_bsh_common_option_programprogress",
    "spueler_rest": "sensor.dishwasher_bsh_common_option_remainingprogramtime",
    "robo_status": "sensor.roborock_s8_status",
    "robo_fortschritt": "sensor.roborock_s8_reinigungsfortschritt",
    "robo_raum": "sensor.roborock_s8_aktueller_raum",
    # Rams-Aktivität: TeamTracker (ESPN) und der Spieltag-Schalter aus dem Lovelace-Dashboard
    "rams": "sensor.la_rams",
    "rams_spieltag": "binary_sensor.rams_spieltag",
}

VORRANG = ("eil", "warnung")
RELEVANZ_STANDARD = 40  # Hinweise ohne eigene Regel
MAX_HINWEISE = 8


def _state(states: States, eid: str) -> str | None:
    st = states.get(eid)
    return None if st is None else st.get("state")


def _attr(states: States, eid: str, key: str) -> Any:
    st = states.get(eid)
    return None if st is None else (st.get("attributes") or {}).get(key)


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_dauer(text: Any) -> float | None:
    """``H:MM:SS`` (auch mit Tagen ``1 day, 0:10:00``) in Sekunden."""
    if not isinstance(text, str) or ":" not in text:
        return None
    tage = 0
    if "day" in text:
        vorn, _, text = text.partition(",")
        tage = int(_num(vorn.split()[0]) or 0)
    teile = text.strip().split(":")
    try:
        werte = [float(t) for t in teile]
    except ValueError:
        return None
    while len(werte) < 3:
        werte.insert(0, 0.0)
    h, m, s = werte[-3:]
    return tage * 86400 + h * 3600 + m * 60 + s


def _parse_zeit(text: Any) -> datetime | None:
    if not isinstance(text, str) or len(text) < 10:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else None


def fmt_rest(sek: float | None) -> str:
    """Restzeit wie am Panel: unter einer Stunde ``m:ss``, sonst ``h:mm h``."""
    if sek is None:
        return "–"
    sek = max(0, round(sek))
    h, rest = divmod(sek, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d} h" if h else f"{m}:{s:02d}"


def _timer_karte(states: States, eid: str, kid: str, schluessel: str, titel: str, jetzt: datetime, laeuft: str) -> dict | None:
    zustand = _state(states, eid)
    if zustand not in ("active", "paused"):
        return None
    dauer = _parse_dauer(_attr(states, eid, "duration"))
    if zustand == "active":
        ende = _parse_zeit(_attr(states, eid, "finishes_at"))
        rest = (ende - jetzt).total_seconds() if ende else _parse_dauer(_attr(states, eid, "remaining"))
    else:
        ende = None
        rest = _parse_dauer(_attr(states, eid, "remaining"))
    ring = max(0.0, min(1.0, rest / dauer)) if (rest is not None and dauer) else None
    return {
        "id": kid,
        "art": "aktivitaet",
        "schluessel": schluessel,
        "titel": titel,
        "wert": fmt_rest(rest),
        "hinweis": laeuft if zustand == "active" else "pausiert",
        "ring": ring,
        "ende": ende.isoformat() if ende else None,
        "dauer_s": dauer if ende else None,
    }


def akt_dusche_spa(states: States, jetzt: datetime) -> dict | None:
    # Laufen beide, gilt der Duschmodus (wie am Panel)
    return _timer_karte(states, QUELLEN["dusche_timer"], "akt:dusche", "dusche", "Duschmodus", jetzt, "Restzeit") or _timer_karte(
        states, QUELLEN["spa_timer"], "akt:spa", "spa", "Spa", jetzt, "Restzeit"
    )


def akt_kohle(states: States, jetzt: datetime) -> dict | None:
    karte = _timer_karte(states, QUELLEN["kohle_timer"], "akt:kohle", "kohle", "Kohle", jetzt, "bis fertig")
    if karte:
        return karte
    if _state(states, QUELLEN["kohle_schalter"]) == "on":
        return {
            "id": "akt:kohle",
            "art": "aktivitaet",
            "schluessel": "kohle",
            "titel": "Kohle",
            "wert": "Bereit",
            "hinweis": "Grill an",
            "ring": 1.0,
            "ende": None,
            "dauer_s": None,
        }
    return None


def _rest_aus_sensor(states: States, eid: str, jetzt: datetime) -> tuple[float | None, datetime | None]:
    """Restzeit aus einem Sensor: Zeitstempel (device_class timestamp) oder Minuten."""
    roh = _state(states, eid)
    if roh in INAKTIV:
        return None, None
    ende = _parse_zeit(roh)
    if ende:
        return (ende - jetzt).total_seconds(), ende
    num = _num(roh)
    if num is None:
        return None, None
    einheit = str(_attr(states, eid, "unit_of_measurement") or "min").lower()
    sek = num * (3600 if einheit in ("h", "std") else 1 if einheit == "s" else 60)
    return sek, jetzt + timedelta(seconds=sek)


def akt_waesche(states: States, jetzt: datetime) -> dict | None:
    status = _state(states, QUELLEN["waesche_status"])
    phase = _state(states, QUELLEN["waesche_phase"])
    laeuft = status == "running" or (phase not in INAKTIV and str(phase).lower() not in ("aus", "fertig"))
    if not laeuft:
        return None
    rest, _ende = _rest_aus_sensor(states, QUELLEN["waesche_ende"], jetzt)
    if rest is None:
        rest, _ende = _rest_aus_sensor(states, QUELLEN["waesche_rest"], jetzt)
    pct = _num(_state(states, QUELLEN["waesche_fortschritt"]))
    hinweis = str(phase) if phase not in INAKTIV else "läuft"
    if pct is not None:
        hinweis = f"{hinweis} {round(pct)} %"
    return {
        "id": "akt:waesche",
        "art": "aktivitaet",
        "schluessel": "waesche",
        "titel": "Waschmaschine",
        "wert": fmt_rest(rest),
        "hinweis": hinweis,
        "ring": (pct / 100) if pct is not None else None,
        "ende": None,  # Ring folgt dem Fortschritt, nicht der Zeit
        "dauer_s": None,
    }


def akt_spueler(states: States, jetzt: datetime) -> dict | None:
    status = str(_state(states, QUELLEN["spueler_status"]) or "")
    kurz = status.rsplit(".", 1)[-1].lower()
    if kurz not in ("run", "delayedstart", "pause"):
        return None
    rest, _ende = _rest_aus_sensor(states, QUELLEN["spueler_rest"], jetzt)
    pct = _num(_state(states, QUELLEN["spueler_fortschritt"]))
    hinweis = {"run": "läuft", "delayedstart": "Startzeit", "pause": "pausiert"}[kurz]
    if pct is not None and kurz == "run":
        hinweis = f"läuft {round(pct)} %"
    return {
        "id": "akt:spueler",
        "art": "aktivitaet",
        "schluessel": "spueler",
        "titel": "Spülmaschine",
        "wert": fmt_rest(rest),
        "hinweis": hinweis,
        "ring": (pct / 100) if pct is not None else None,
        "ende": None,
        "dauer_s": None,
    }


def robo_aktiv(status: str | None) -> bool:
    s = str(status or "")
    return s == "cleaning" or s.endswith(("_cleaning", "_mopping"))


def akt_robo(states: States, jetzt: datetime) -> dict | None:
    if not robo_aktiv(_state(states, QUELLEN["robo_status"])):
        return None
    pct = _num(_state(states, QUELLEN["robo_fortschritt"]))
    raum = _state(states, QUELLEN["robo_raum"])
    return {
        "id": "akt:robo",
        "art": "aktivitaet",
        "schluessel": "robo",
        "titel": "Roborock",
        "wert": f"{round(pct)} %" if pct is not None else "–",
        "hinweis": str(raum) if raum not in INAKTIV else "saugt",
        "ring": (pct / 100) if pct is not None else None,
        "ende": None,
        "dauer_s": None,
    }


AKTIVITAETEN = (akt_dusche_spa, akt_kohle, akt_waesche, akt_spueler, akt_robo)

# ------------------------------------------------------------ Rams-Aktivität (TeamTracker, ESPN)
RAMS_NACHLAUF = timedelta(hours=12)  # nach Spielende bleibt die Karte so lange sichtbar
RAMS_SPIELDAUER = timedelta(hours=4)  # Spielende ≈ Anpfiff + 4 h (TeamTracker liefert kein Endedatum)
RAMS_LOGO_HOST = "https://a.espncdn.com/"  # nur diese Quelle ist als Bild erlaubt (img-src), sonst Teamkürzel
WOCHENTAGE = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")
RAMS_RELEVANZ = {"IN": 85, "PRE": 50, "POST": 20}  # Live vorn, Vorschau am Spieltag mittel, Ergebnis niedrig


def _tz(lokal: datetime | None) -> Any:
    if lokal is not None and lokal.tzinfo is not None:
        return lokal.tzinfo
    try:
        return ZoneInfo("Europe/Berlin")
    except ZoneInfoNotFoundError:
        return UTC


def _logo(url: Any) -> str | None:
    return url if isinstance(url, str) and url.startswith(RAMS_LOGO_HOST) else None


def _text(value: Any) -> str:
    return "" if value in INAKTIV else str(value).strip()


def _punkte(value: Any) -> str:
    num = _num(value)
    return str(round(num)) if num is not None else "0"


def rams_anpfiff(a: dict, tz: Any) -> tuple[datetime | None, str, str]:
    """Anpfiff als Ortszeit: (Zeitpunkt, „Mo 13.10.“, „02:15 Uhr“)."""
    dt = _parse_zeit(a.get("date"))
    if not dt:
        return None, "", ""
    dt = dt.astimezone(tz)
    return dt, f"{WOCHENTAGE[dt.weekday()]} {dt.day:02d}.{dt.month:02d}.", f"{dt:%H:%M} Uhr"


def akt_rams(states: States, jetzt: datetime, lokal: datetime | None = None) -> dict | None:
    """Spielkarte der Rams: sichtbar am Spieltag, während des Spiels und bis 12 h nach Spielende."""
    st = states.get(QUELLEN["rams"])
    zustand = str((st or {}).get("state") or "").upper()
    if zustand not in RAMS_RELEVANZ:
        return None
    a = (st or {}).get("attributes") or {}
    anpfiff, tag, uhr = rams_anpfiff(a, _tz(lokal))
    spieltag = _state(states, QUELLEN["rams_spieltag"]) == "on"
    if zustand == "POST" and not spieltag:
        # Spielende: Anpfiff + 4 h, höchstens aber der Zeitpunkt des Zustandswechsels (nach einem HA-Neustart zählt der Anpfiff)
        enden = [e for e in (anpfiff + RAMS_SPIELDAUER if anpfiff else None, _parse_zeit(st.get("last_changed"))) if e]
        if not enden or jetzt - min(enden) >= RAMS_NACHLAUF:
            return None
    elif zustand != "IN" and not spieltag:
        return None

    team, gegner = _text(a.get("team_name")) or "Rams", _text(a.get("opponent_name")) or "Gegner"
    punkte, punkte_g = _punkte(a.get("team_score")), _punkte(a.get("opponent_score"))
    auswaerts = _text(a.get("team_homeaway")).lower() == "away"
    tv = _text(a.get("tv_network"))
    if zustand == "PRE":
        titel = f"{team} {'@' if auswaerts else 'vs'} {gegner}"
        zweit = " · ".join(x for x in (tag, uhr, tv) if x)
        badge, farbe, wert = "UPCOMING", "#003594", ""
    elif zustand == "IN":
        titel = f"{team} {punkte} : {punkte_g} {gegner}"
        viertel = _num(a.get("quarter"))
        phase = "Kickoff" if viertel is None or viertel <= 0 else "OT" if viertel > 4 else f"Q{round(viertel)}"
        zweit = " · ".join(x for x in (phase, _text(a.get("clock")), _text(a.get("down_distance_text"))) if x)
        badge, farbe, wert = "● LIVE", "#e2231a", f"{punkte}:{punkte_g}"
    else:
        titel = f"{team} {punkte} : {punkte_g} {gegner}"
        sieg = a.get("team_winner")
        if sieg is None:
            eigene, fremde = _num(a.get("team_score")), _num(a.get("opponent_score"))
            sieg = None if eigene is None or fremde is None or eigene == fremde else eigene > fremde
        ergebnis = "Unentschieden" if sieg is None else "Sieg" if sieg else "Niederlage"
        zweit = " · ".join(x for x in (ergebnis, tag) if x)
        badge, farbe, wert = "FINAL", "#2e7d32" if sieg else "#6b7280", f"{punkte}:{punkte_g}"

    def seite(praefix: str, name: str, punkte_text: str) -> dict:
        farben = a.get(f"{praefix}_colors")
        return {
            "name": name,
            "abk": _text(a.get(f"{praefix}_abbr")) or name[:3].upper(),
            "logo": _logo(a.get(f"{praefix}_logo")),
            "punkte": punkte_text,
            "bilanz": _text(a.get(f"{praefix}_record")),
            "farbe": farben[0] if isinstance(farben, list) and farben and isinstance(farben[0], str) else None,
            "farbe2": farben[1] if isinstance(farben, list) and len(farben) > 1 and isinstance(farben[1], str) else None,
        }

    return {
        "id": "akt:rams",
        "art": "sport",
        "schluessel": "rams",
        "titel": titel,
        "wert": wert,
        "hinweis": zweit,
        "ring": 1.0,
        "ende": None,
        "dauer_s": None,
        "relevanz": RAMS_RELEVANZ[zustand],
        "zustand": zustand,
        "badge": badge,
        "badge_farbe": farbe,
        "spiel": {
            "team": seite("team", team, punkte),
            "gegner": seite("opponent", gegner, punkte_g),
            "auswaerts": auswaerts,
            "anpfiff": " · ".join(x for x in (tag, uhr) if x),
            "stadion": _text(a.get("venue")),
            "ort": _text(a.get("location")),
            "tv": tv,
            "saison": _text(a.get("season")),
            "liga": _text(a.get("league")),
            "letzter_zug": _text(a.get("last_play")),
            "wahrscheinlichkeit": _num(a.get("team_win_probability")),
        },
    }
MAX_MUSIK = 2
MUSIK_STILL_S = 90  # so lange darf ein laufender Titel nach dem Start auf 0:00 stehen


def akt_musik(states: States, jetzt: datetime, player: list[str]) -> list[dict]:
    """Laufende Wiedergabe der Music-Assistant-Player; gleiche Titel (Gruppen) nur einmal."""
    out: list[dict] = []
    gesehen: set[tuple] = set()
    for eid in player:
        st = states.get(eid) or {}
        if st.get("state") != "playing":
            continue
        a = st.get("attributes") or {}
        # Music Assistant meldet bei Alexa-Geräten oft „playing“, obwohl nichts läuft: ohne Titel, oder der Titel
        # steht nach dem Start dauerhaft auf 0:00. Solche Player zeigen keine Karte.
        if not a.get("media_title"):
            continue
        seit = _parse_zeit(st.get("last_changed"))
        steht = _num(a.get("media_duration")) and not _num(a.get("media_position"))
        if steht and seit and (jetzt - seit).total_seconds() > MUSIK_STILL_S:
            continue
        titel = a.get("media_title")
        schluessel = (titel, a.get("media_artist"))
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        dauer, pos = _num(a.get("media_duration")), _num(a.get("media_position"))
        stand = _parse_zeit(a.get("media_position_updated_at"))
        ende = None
        if dauer and pos is not None and stand:
            ende = stand + timedelta(seconds=max(0.0, dauer - pos))
        rest = (ende - jetzt).total_seconds() if ende else None
        out.append(
            {
                "id": f"akt:musik:{eid}",
                "art": "aktivitaet",
                "schluessel": "musik",
                "titel": str(titel),
                "wert": fmt_rest(rest) if rest is not None else "♪",
                "hinweis": "noch" if rest is not None else "spielt",
                "unter": " · ".join(str(x) for x in (a.get("media_artist"), a.get("friendly_name")) if x),
                "ring": max(0.0, min(1.0, rest / dauer)) if (rest is not None and dauer) else None,
                "ende": ende.isoformat() if ende else None,
                "dauer_s": dauer if ende else None,
            }
        )
        if len(out) >= MAX_MUSIK:
            break
    return out


def parse_hinweise(zeilen: Any) -> list[dict]:
    """``schluessel|Titel|Wert|Hinweis`` je Zeile; weitere ``|`` gehören zum Hinweis; höchstens 8; ``eil`` zuerst."""
    if not isinstance(zeilen, str):
        return []
    out: list[dict] = []
    for i, zeile in enumerate(zeilen.replace("\r", "").split("\n")):
        if not zeile.strip():
            continue
        teile = zeile.split("|", 3)
        teile += [""] * (4 - len(teile))
        schluessel = teile[0].strip().lower() or "neutral"
        out.append(
            {
                "id": f"hin:{schluessel}:{teile[1].strip()}" if schluessel != "eil" else "hin:eil",
                "art": "hinweis",
                "schluessel": schluessel,
                "titel": teile[1].strip(),
                "wert": teile[2].strip(),
                "hinweis": teile[3].strip(),
                "ring": None,
                "ende": None,
                "dauer_s": None,
                "_pos": i,
            }
        )
        if len(out) >= MAX_HINWEISE:
            break
    out.sort(key=lambda k: (k["schluessel"] != "eil", k["_pos"]))
    for k in out:
        del k["_pos"]
    return out


# ------------------------------------------------------------ Relevanz (0–100)
# eil 100 · aktive Warnung 90–100 (Vorabinformation 55) · Timer: Restzeit < 2 min 95, sonst 70 (pausiert 50) ·
# Termin 60 + 35·(1 − Rest/3 h) · Müll am Vorabend ab 18 Uhr und morgens vor der Abholung 80, sonst 30 ·
# Lüften/Offen 55 · Wetter 45 · Fahrt 50 · Musik 45 · Roborock 60 · Heimweg 65 (≤ 5 min 90) ·
# Rams live 85, am Spieltag 50, nach dem Spiel 20 ·
# „Alles ruhig“ 10 · übrige Hinweise 40
def _rest_sek(k: dict, jetzt: datetime) -> float | None:
    ende = _parse_zeit(k.get("ende"))
    if ende:
        return (ende - jetzt).total_seconds()
    teile = str(k.get("wert") or "").split(":")  # Restzeit ``m:ss`` (Geräte ohne Zeitstempel)
    if len(teile) == 2 and all(t.isdigit() for t in teile):
        return int(teile[0]) * 60 + int(teile[1])
    return None


def termin_relevanz(rest_sek: float) -> int:
    """Countdown zu einem Termin: 60 bei 3 h Vorlauf, 95 bei Beginn."""
    return round(60 + 35 * (1 - max(0.0, min(1.0, rest_sek / (3 * 3600)))))


def relevanz(k: dict, jetzt: datetime, lokal: datetime) -> int:
    if k.get("relevanz") is not None:
        return int(k["relevanz"])
    schl = k.get("schluessel")
    if k.get("art") == "warnung":
        return 55 if k.get("vorab") else 100 if (k.get("stufe") or 1) >= 2 else 90
    if k.get("art") == "aktivitaet":
        if schl == "musik":
            return 45
        if schl == "robo":
            return 60
        if schl == "heimweg":
            return 90 if (k.get("rest_min") or 99) <= 5 else 65  # kurz vor der Ankunft nach vorn
        if k.get("hinweis") == "pausiert":
            return 50
        rest = _rest_sek(k, jetzt)
        return 95 if rest is not None and rest < 120 else 70
    wert = str(k.get("wert") or "").lower()
    if schl == "eil":
        return 100
    if schl == "warnung":
        return 90
    if schl == "muell":
        vorabend = "morgen" in wert and lokal.hour >= 18
        morgens = "heute" in wert and lokal.hour < 9
        return 80 if vorabend or morgens else 30
    if schl == "termin":
        if "jetzt" in wert:
            return 95
        num = _num("".join(c for c in wert if c.isdigit()) or None)
        return termin_relevanz(num * 60) if num is not None and "in" in wert else RELEVANZ_STANDARD
    if schl in ("lueften", "offen"):
        return 55
    if schl == "wetter":
        return 45
    if schl == "arbeit":
        return 50
    if schl == "ruhig":
        return 10
    return RELEVANZ_STANDARD


def sortiere(karten: list[dict]) -> list[dict]:
    """Höchste Relevanz zuerst; bei Gleichstand bleibt die Reihenfolge der Eingabe (stabil)."""
    return sorted(karten, key=lambda k: -(k.get("relevanz") if k.get("relevanz") is not None else RELEVANZ_STANDARD))


def berechne(
    states: States,
    hinweise_entitaet: str,
    jetzt: datetime,
    aus: list[str] | None = None,
    musik: list[str] | None = None,
    lokal: datetime | None = None,
    heimweg: Heimweg | None = None,
    personen: list[str] | None = None,
) -> list[dict]:
    """Alle Karten nach Relevanz sortiert. Gleichstand: Eilmeldung und Warnung, dann Aktivitäten, dann übrige Hinweise.

    ``lokal`` ist die Ortszeit (Vorgabe: Zeitzone des Systems) für Regeln wie „Müll ab 18 Uhr“."""
    aus = aus or []
    lokal = lokal or jetzt.astimezone()
    hinweise = parse_hinweise(_attr(states, hinweise_entitaet, "zeilen")) if hinweise_entitaet else []
    akt = [k for fn in AKTIVITAETEN if (k := fn(states, jetzt))] + akt_musik(states, jetzt, musik or [])
    if rams := akt_rams(states, jetzt, lokal):
        akt.append(rams)
    if heimweg is not None:
        akt += heimweg.karten(states, jetzt, lokal, personen or [])
    unwetter = unwetter_karten(states, jetzt)
    if any(k["id"].startswith("warn:") for k in unwetter) or _dwd_vorhanden(states):
        # Die DWD-Sensoren ersetzen die knappe Warnzeile der Hinweisvorlage
        hinweise = [k for k in hinweise if k["schluessel"] != "warnung"]
    vorn = [k for k in hinweise if k["schluessel"] == "eil"] + unwetter + [k for k in hinweise if k["schluessel"] == "warnung"]
    rest = [k for k in hinweise if k["schluessel"] not in VORRANG]
    aus = [*aus, *(["unwetter"] if "warnung" in aus else [])]
    karten = [k for k in (*vorn, *akt, *rest) if k["schluessel"] not in aus]
    for k in karten:
        k["relevanz"] = relevanz(k, jetzt, lokal)
    return sortiere(karten)


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value) if value not in INAKTIV else None


def _dwd_vorhanden(states: States) -> bool:
    return any(
        e.startswith("sensor.")
        and "region_name" in (st.get("attributes") or {})
        and "warning_count" in (st.get("attributes") or {})
        for e, st in states.items()
    )


# Wettergefahren für das Zusammenfassen der DWD-Warnungen; Reihenfolge zählt („starkes Gewitter mit Starkregen“
# ist ein Gewitter, „Sturmböen“ Wind)
FAMILIEN = (
    ("gewitter", ("gewitter",)),
    ("wind", ("böen", "boeen", "sturm", "orkan", "wind")),
    ("regen", ("regen",)),
    ("schnee", ("schnee",)),
    ("glaette", ("glätte", "glaette", "glatteis", "eisregen")),
    ("frost", ("frost",)),
    ("nebel", ("nebel",)),
    ("hitze", ("hitze", "uv-")),
    ("tauwetter", ("tauwetter",)),
)


def warn_familie(name: str) -> str:
    n = name.lower()
    return next((fam for fam, worte in FAMILIEN if any(w in n for w in worte)), n)


def _dwd_warnungen(states: States, jetzt: datetime) -> list[dict]:
    """Alle noch gültigen Einzelwarnungen aller DWD-Sensoren (aktuell und Vorabinformation, alle Regionen)."""
    out: list[dict] = []
    for eid, st in states.items():
        a = st.get("attributes") or {}
        if not eid.startswith("sensor.") or "region_name" not in a or "warning_count" not in a:
            continue
        vorab = "vorwarn" in eid
        for i in range(1, int(_num(a.get("warning_count")) or 0) + 1):
            name = a.get(f"warning_{i}_name")
            if not name:
                continue
            ende = a.get(f"warning_{i}_end")
            ende_dt = ende if isinstance(ende, datetime) else _zeit_oder_none(ende)
            if ende_dt and ende_dt < jetzt:
                continue
            start = a.get(f"warning_{i}_start")
            out.append(
                {
                    "name": str(name),
                    "stufe": max(1, min(4, int(_num(a.get(f"warning_{i}_level")) or 1))),
                    "vorab": vorab,
                    "headline": str(a.get(f"warning_{i}_headline") or ""),
                    "region": a.get("region_name"),
                    "start": start,
                    "start_dt": start if isinstance(start, datetime) else _zeit_oder_none(start),
                    "ende": ende,
                    "ende_dt": ende_dt,
                }
            )
    return out


def unwetter_karten(states: States, jetzt: datetime) -> list[dict]:
    """Amtliche Warnungen des DWD (Integration dwd_weather_warnings), je Wettergefahr EINE Karte.

    Erkannt werden die Sensoren der Integration an ihren Attributen (``region_name``, ``warning_count``); „Aktuelle
    Warnstufe“ liefert aktive Warnungen, „Vorwarnstufe“ die Vorabinformationen. Der DWD meldet dieselbe Lage oft
    mehrfach: als gestaffelte Einzelwarnungen (Windböen, Sturmböen …), in beiden Sensoren oder für mehrere Regionen.
    Daraus wird je Gefahr eine Karte: höchste aktive Stufe mit Namen und Überschrift, Zeitraum vom frühesten Beginn bis
    zum spätesten Ende; eine Vorabinformation zählt nur, wenn zur selben Gefahr keine aktive Warnung besteht, und steht
    sonst als Ausblick im Hinweis, wenn sie eine höhere Stufe erwarten lässt. Höchste Stufe zuerst, höchstens drei."""
    gruppen: dict[str, list[dict]] = {}
    for w in _dwd_warnungen(states, jetzt):
        gruppen.setdefault(warn_familie(w["name"]), []).append(w)
    out: list[dict] = []
    for fam, alle in gruppen.items():
        aktiv = [w for w in alle if not w["vorab"]]
        basis = aktiv or alle
        top = max(basis, key=lambda w: (w["stufe"], w["ende_dt"] or jetzt))
        starts = [w["start_dt"] for w in basis if w["start_dt"]]
        enden = [w["ende_dt"] for w in basis if w["ende_dt"]]
        teile = []
        # Überschrift nur, wenn sie mehr sagt als „Amtliche Warnung vor <Name>“
        if top["headline"] and top["name"].lower() not in top["headline"].lower():
            teile.append(top["headline"])
        andere = sorted({w["name"] for w in basis if w["name"] != top["name"]})
        if andere:
            teile.append("zeitweise " + ", ".join(andere))
        if aktiv:
            hoeher = [w for w in alle if w["vorab"] and w["stufe"] > top["stufe"]]
            if hoeher:
                v = max(hoeher, key=lambda w: w["stufe"])
                teile.append(f"später möglich: {v['name']} (Stufe {v['stufe']})")
        stufe = top["stufe"]
        out.append(
            {
                "id": f"warn:{fam}",
                "art": "warnung",
                "schluessel": "unwetter",
                "familie": fam,
                "titel": top["name"],
                "wert": str(stufe),
                "hinweis": " · ".join(teile),
                "stufe": stufe,
                "vorab": not aktiv,
                "region": top["region"],
                "start": min(starts).isoformat() if starts else _iso(top["start"]),
                "bis": max(enden).isoformat() if enden else _iso(top["ende"]),
                "ring": stufe / 4,
                "ende": None,
                "dauer_s": None,
            }
        )
    out.sort(key=lambda k: (k["vorab"], -k["stufe"]))
    return out[:3]


def _zeit_oder_none(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else None


# ------------------------------------------------------------ Heimweg (Proximity-Integration)
HEIMWEG_MIN_START_M = 1000  # kürzere Wege sind ein Spaziergang ums Haus, keine Heimfahrt
HEIMWEG_ANGEKOMMEN_M = 150
HEIMWEG_PAUSE = timedelta(minutes=20)  # so lange überlebt eine Fahrt ohne „towards“ (Umweg, Tankstelle)
HEIMWEG_FENSTER = timedelta(minutes=10)  # Messfenster für die Annäherungsgeschwindigkeit
HEIMWEG_V_ERSATZ = 50 / 3.6 / 1.3  # m/s Luftlinie: 50 km/h auf einer Straße, die rund 30 % länger als die Luftlinie ist


def _slug(text: str) -> str:
    t = text.lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


def heimweg_quelle(eid: str) -> bool:
    """Entitäten, deren Änderung die Heimweg-Karte neu berechnet (Personen und Proximity-Sensoren)."""
    return eid.startswith("person.") or (
        eid.startswith("sensor.") and any(w in eid for w in ("entfernung", "distance", "bewegung_von", "direction_of_travel"))
    )


def _proximity(states: States, person: str) -> tuple[str | None, str | None]:
    """Entfernungs- und Richtungssensor der Proximity-Integration zu einer Person (über den Namen gefunden)."""
    name = _slug(str(((states.get(person) or {}).get("attributes") or {}).get("friendly_name") or person.split(".", 1)[1]))
    dist = richt = None
    for eid, st in states.items():
        if not eid.startswith("sensor.") or not eid.endswith("_" + name):
            continue
        a = st.get("attributes") or {}
        if a.get("device_class") == "distance":
            dist = eid
        elif "towards" in (a.get("options") or []):
            richt = eid
    return dist, richt


class Heimweg:
    """Merkt sich je Person den Beginn der Heimfahrt und die letzten Entfernungen.

    Eine Fahrt beginnt, wenn die Proximity-Integration „towards“ meldet und die Person mindestens 1 km entfernt ist;
    der Ring füllt sich mit der zurückgelegten Strecke (bei 0 km voll). Die Ankunftszeit ergibt sich aus der Geschwindigkeit, mit
    der die Entfernung in den letzten Minuten abnimmt; ohne Messung gilt ein Ersatzwert."""

    def __init__(self) -> None:
        self.fahrten: dict[str, dict] = {}

    def karten(self, states: States, jetzt: datetime, lokal: datetime, personen: list[str]) -> list[dict]:
        out = []
        for person in personen:
            if k := self._karte(states, jetzt, lokal, person):
                out.append(k)
        return out

    def _karte(self, states: States, jetzt: datetime, lokal: datetime, person: str) -> dict | None:
        dist_eid, richt_eid = _proximity(states, person)
        d = _num(_state(states, dist_eid)) if dist_eid else None
        richtung = _state(states, richt_eid) if richt_eid else None
        if d is not None and str(_attr(states, dist_eid, "unit_of_measurement") or "m") == "km":
            d *= 1000
        f = self.fahrten.get(person)
        if d is None or _state(states, person) == "home" or richtung == "arrived" or d <= HEIMWEG_ANGEKOMMEN_M:
            self.fahrten.pop(person, None)
            return None
        if richtung == "towards":
            if f is None:
                if d < HEIMWEG_MIN_START_M:
                    return None
                f = self.fahrten[person] = {"start_m": d, "start_t": jetzt, "proben": []}
            f["zuletzt_hin"] = jetzt
        elif f is None:
            return None
        elif jetzt - f.get("zuletzt_hin", f["start_t"]) > HEIMWEG_PAUSE:
            self.fahrten.pop(person, None)
            return None
        if not f["proben"] or f["proben"][-1][1] != d:
            f["proben"].append((jetzt, d))
        f["proben"] = [p for p in f["proben"] if jetzt - p[0] <= HEIMWEG_FENSTER]
        if richtung not in ("towards", "stationary"):
            return None  # Umweg: Karte ruht, die Fahrt bleibt gemerkt (an der Ampel „stationary“ bleibt sie sichtbar)
        f["start_m"] = max(f["start_m"], d)
        # Annäherung aus dem ältesten Messpunkt im Fenster (mind. 2 min alt), sonst seit Fahrtbeginn, sonst Ersatzwert
        v = None
        alt = f["proben"][0]
        if (jetzt - alt[0]).total_seconds() >= 120:
            v = (alt[1] - d) / (jetzt - alt[0]).total_seconds()
        elif (jetzt - f["start_t"]).total_seconds() >= 120:
            v = (f["start_m"] - d) / (jetzt - f["start_t"]).total_seconds()
        if v is None or not 1.5 <= v <= 45:
            v = HEIMWEG_V_ERSATZ
        rest_s = d / v
        name = str(_attr(states, person, "friendly_name") or person.split(".", 1)[1]).split(" ")[0]
        ankunft = (lokal + timedelta(seconds=rest_s)).strftime("%H:%M") if rest_s < 3 * 3600 else None
        km = d / 1000
        return {
            "id": f"akt:heimweg:{person}",
            "art": "aktivitaet",
            "schluessel": "heimweg",
            "titel": f"{name} ist auf dem Heimweg",
            "wert": f"{km:.1f}".replace(".", ",") if km < 10 else str(round(km)),
            "hinweis": f"Ankunft gegen {ankunft}" if ankunft else "",
            "rest_min": round(rest_s / 60),
            "ring": max(0.0, min(1.0, 1 - d / f["start_m"])),
            "ende": None,
            "dauer_s": None,
        }


def relevante_entitaeten(hinweise_entitaet: str) -> set[str]:
    return {*QUELLEN.values(), *([hinweise_entitaet] if hinweise_entitaet else [])}
