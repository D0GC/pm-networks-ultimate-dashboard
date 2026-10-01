"""App-Optionen (Supervisor) und Panel-Einstellungen (im Editor gepflegt, ``/data/einstellungen.json``)."""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import secrets
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

_LOGGER = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("PMPS_DATA_DIR", "/data"))

ENTITY_RE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")

MODULE = ("start", "raeume", "klima", "licht", "sicherheit", "medien", "listen", "energie", "wartung", "suche")


def _entity(value: Any) -> str:
    v = str(value or "").strip()
    return v if ENTITY_RE.match(v) else ""


def _entities(values: Any) -> list[str]:
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return []
    out: list[str] = []
    for v in values:
        e = _entity(v)
        if e and e not in out:
            out.append(e)
    return out


@dataclass
class Options:
    """Feste Zuordnungen aus den App-Optionen. Leere Felder schalten die jeweilige Funktion ab."""

    hinweise_entitaet: str = "sensor.panel_bad_hinweise"
    bewegung: list[str] = field(
        default_factory=lambda: ["binary_sensor.bewegungsmelder_flur_1_bewegung", "binary_sensor.bewegungsmelder_flur_2_bewegung"]
    )
    personen: list[str] = field(default_factory=lambda: ["person.dominik", "person.gina_perina"])
    wetter_entitaet: str = "weather.dwd_zuhause"
    aussentemperatur: str = "sensor.aussentemperatur"
    alarm_entitaet: str = "alarm_control_panel.alarmo"
    ereignis_ausloeser: list[str] = field(default_factory=lambda: ["binary_sensor.wohnungstuer_person"])
    ereignis_kamera: str = "camera.wohnungstuer_standardauflosung"
    tueroeffner: str = "button.haustur_tur_offnen"
    klima_praefix: str = "climate.pm_"
    log_level: str = "info"

    @classmethod
    def load(cls, path: Path | None = None) -> Options:
        path = path or DATA_DIR / "options.json"
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            _LOGGER.warning("%s fehlt, verwende Standardwerte", path)
            raw = {}
        except (OSError, ValueError) as err:
            _LOGGER.error("%s nicht lesbar: %s", path, err)
            raw = {}
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> Options:
        opts = cls()
        for f in fields(cls):
            if f.name not in raw:
                continue
            val = raw[f.name]
            cur = getattr(opts, f.name)
            if isinstance(cur, list):
                setattr(opts, f.name, _entities(val))
            elif f.name in ("log_level", "klima_praefix"):
                setattr(opts, f.name, str(val or "").strip())
            else:
                setattr(opts, f.name, _entity(val))
        return opts

    def public(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------- Einstellungen

STANDARD_SCHNELLZUGRIFF = [
    "light.flur_deckenlampe_flur",
    "lock.eingangstur",
    "alarm_control_panel.alarmo",
    "vacuum.roborock_s8",
    "input_boolean.alles_stumm",
    "script.morgen_briefing",
]


@dataclass
class Einstellungen:
    """Im Editor einstellbar, wirkt sofort auf alle verbundenen Panels."""

    verweildauer_s: int = 8
    ruhe_nach_s: int = 90
    bedienung_zurueck_s: int = 60
    ruhe_helligkeit: int = 45  # Abdunklung im Ruhezustand in Prozent
    nacht_helligkeit: int = 75  # Abdunklung nachts (Sonne unter dem Horizont) in Prozent
    ereignis_dauer_s: int = 90
    schnellzugriff: list[str] = field(default_factory=lambda: list(STANDARD_SCHNELLZUGRIFF))
    module: list[str] = field(default_factory=lambda: [m for m in MODULE if m != "start"])
    bereiche_reihenfolge: list[str] = field(default_factory=list)
    bereiche_ausblenden: list[str] = field(default_factory=list)
    start_raeume: list[str] = field(default_factory=lambda: ["wohnzimmer", "badezimmer", "schlafzimmer"])
    karten_aus: list[str] = field(default_factory=list)  # Kartenschlüssel, die der Flur nicht zeigt
    animationen: bool = True

    GRENZEN = {  # noqa: RUF012
        "verweildauer_s": (3, 60),
        "ruhe_nach_s": (10, 3600),
        "bedienung_zurueck_s": (15, 600),
        "ruhe_helligkeit": (0, 90),
        "nacht_helligkeit": (0, 95),
        "ereignis_dauer_s": (15, 600),
    }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> Einstellungen:
        e = cls()
        e.aktualisieren(raw)
        return e

    def aktualisieren(self, raw: dict[str, Any]) -> list[str]:
        """Übernimmt gültige Felder; liefert die Liste der abgewiesenen Felder."""
        abgewiesen: list[str] = []
        for key, val in (raw or {}).items():
            if key in self.GRENZEN:
                lo, hi = self.GRENZEN[key]
                try:
                    num = int(val)
                except (TypeError, ValueError):
                    abgewiesen.append(key)
                    continue
                setattr(self, key, max(lo, min(hi, num)))
            elif key == "schnellzugriff":
                self.schnellzugriff = _entities(val)[:8]
            elif key == "module":
                vals = val if isinstance(val, list) else []
                self.module = [m for m in dict.fromkeys(str(v) for v in vals) if m in MODULE and m != "start"]
            elif key in ("bereiche_reihenfolge", "bereiche_ausblenden", "start_raeume", "karten_aus"):
                vals = val if isinstance(val, list) else []
                setattr(self, key, [s for s in dict.fromkeys(str(v).strip() for v in vals) if re.match(r"^[a-z0-9_]{1,64}$", s)])
            elif key == "animationen":
                self.animationen = bool(val)
            else:
                abgewiesen.append(key)
        return abgewiesen

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class EinstellungsSpeicher:
    def __init__(self, data_dir: Path = DATA_DIR) -> None:
        self.pfad = data_dir / "einstellungen.json"
        self.token_pfad = data_dir / "panel_token"

    def laden(self) -> Einstellungen:
        try:
            return Einstellungen.from_dict(json.loads(self.pfad.read_text(encoding="utf-8")))
        except FileNotFoundError:
            return Einstellungen()
        except (OSError, ValueError) as err:
            _LOGGER.error("%s nicht lesbar, verwende Standardwerte: %s", self.pfad, err)
            return Einstellungen()

    def speichern(self, e: Einstellungen) -> None:
        tmp = self.pfad.with_suffix(".tmp")
        tmp.write_text(json.dumps(e.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.pfad)

    def token(self, neu: bool = False) -> str:
        """Zugangsschlüssel für den Panel-Port. Wird beim ersten Start erzeugt und in ``/data`` abgelegt."""
        if not neu:
            try:
                tok = self.token_pfad.read_text(encoding="utf-8").strip()
                if len(tok) >= 24:
                    return tok
            except OSError:
                pass
        tok = secrets.token_urlsafe(24)
        self.token_pfad.write_text(tok, encoding="utf-8")
        with contextlib.suppress(OSError):
            self.token_pfad.chmod(0o600)
        return tok
