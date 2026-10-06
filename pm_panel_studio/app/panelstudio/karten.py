"""Karten für das Karussell: Hinweise und laufende Aktivitäten (mit Ringtimer).

Die Regeln entsprechen den Wand-Panels Bad und Büro (Repository pm-networks-ns-panel, ``docs/ARCHITEKTUR.md``,
Abschnitte 7a und 7b). Hinweise kommen fertig aus Home Assistant (``sensor.panel_*_hinweise``, Attribut
``zeilen``), Aktivitäten werden hier aus den Gerätezuständen berechnet.

Eine Karte ist ein Dict:
  id         stabiler Schlüssel (Rotation hält die Position, solange die ID bleibt)
  art        ``hinweis`` | ``aktivitaet``
  schluessel Symbol- und Farbklasse (``eil``, ``warnung``, ``kohle``, ``waesche`` …)
  titel, wert, hinweis  Texte
  ring       Anteil 0..1 oder None (kein Ring)
  ende       ISO-Zeitpunkt, bis zu dem der Wert herunterzählt (der Client zählt lokal), sonst None
  dauer_s    Gesamtdauer in Sekunden für den Ring beim lokalen Herunterzählen, sonst None
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

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
    "waesche_rest": "sensor.karl_die_waschmaschine_verbleibende_zeit",
    "waesche_fortschritt": "sensor.waschmaschine_fortschritt",
    "spueler_status": "sensor.dishwasher_bsh_common_status_operationstate",
    "spueler_fortschritt": "sensor.dishwasher_bsh_common_option_programprogress",
    "spueler_rest": "sensor.dishwasher_bsh_common_option_remainingprogramtime",
    "robo_status": "sensor.roborock_s8_status",
    "robo_fortschritt": "sensor.roborock_s8_reinigungsfortschritt",
    "robo_raum": "sensor.roborock_s8_aktueller_raum",
}

VORRANG = ("eil", "warnung")
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
MAX_MUSIK = 2


def akt_musik(states: States, jetzt: datetime, player: list[str]) -> list[dict]:
    """Laufende Wiedergabe der Music-Assistant-Player; gleiche Titel (Gruppen) nur einmal."""
    out: list[dict] = []
    gesehen: set[tuple] = set()
    for eid in player:
        st = states.get(eid) or {}
        if st.get("state") != "playing":
            continue
        a = st.get("attributes") or {}
        titel = a.get("media_title") or "Wiedergabe"
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


def berechne(
    states: States, hinweise_entitaet: str, jetzt: datetime, aus: list[str] | None = None, musik: list[str] | None = None
) -> list[dict]:
    """Alle Karten in Anzeigereihenfolge: Eilmeldung und Warnung, dann Aktivitäten, dann übrige Hinweise."""
    aus = aus or []
    hinweise = parse_hinweise(_attr(states, hinweise_entitaet, "zeilen")) if hinweise_entitaet else []
    akt = [k for fn in AKTIVITAETEN if (k := fn(states, jetzt))] + akt_musik(states, jetzt, musik or [])
    unwetter = unwetter_karten(states, jetzt)
    if any(k["id"].startswith("warn:") for k in unwetter) or _dwd_vorhanden(states):
        # Die DWD-Sensoren ersetzen die knappe Warnzeile der Hinweisvorlage
        hinweise = [k for k in hinweise if k["schluessel"] != "warnung"]
    vorn = [k for k in hinweise if k["schluessel"] == "eil"] + unwetter + [k for k in hinweise if k["schluessel"] == "warnung"]
    rest = [k for k in hinweise if k["schluessel"] not in VORRANG]
    aus = [*aus, *(["unwetter"] if "warnung" in aus else [])]
    return [k for k in (*vorn, *akt, *rest) if k["schluessel"] not in aus]


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


def unwetter_karten(states: States, jetzt: datetime) -> list[dict]:
    """Amtliche Warnungen des DWD (Integration dwd_weather_warnings) als eigene Karten.

    Erkannt werden die Sensoren der Integration an ihren Attributen (``region_name``, ``warning_count``); der Sensor
    „Aktuelle Warnstufe“ liefert aktive Warnungen, „Vorwarnstufe“ die Vorabinformationen. Je Warnung eine Karte,
    höchste Stufe zuerst, höchstens drei."""
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
            stufe = int(_num(a.get(f"warning_{i}_level")) or 1)
            out.append(
                {
                    "id": f"warn:{'vorab' if vorab else 'aktiv'}:{name}",
                    "art": "warnung",
                    "schluessel": "unwetter",
                    "titel": str(name),
                    "wert": str(stufe),
                    "hinweis": str(a.get(f"warning_{i}_headline") or ""),
                    "stufe": max(1, min(4, stufe)),
                    "vorab": vorab,
                    "region": a.get("region_name"),
                    "start": _iso(a.get(f"warning_{i}_start")),
                    "bis": _iso(ende),
                    "ring": max(1, min(4, stufe)) / 4,
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


def relevante_entitaeten(hinweise_entitaet: str) -> set[str]:
    return {*QUELLEN.values(), *([hinweise_entitaet] if hinweise_entitaet else [])}
