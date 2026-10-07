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

MODULE = (
    "start",
    "raeume",
    "klima",
    "studio",
    "licht",
    "sicherheit",
    "medien",
    "musik",
    "haushalt",
    "listen",
    "energie",
    "shisha",
    "wartung",
    "suche",
)
# Module, die nach dem ersten Release hinzukamen: gespeicherte Einstellungen ohne „module_bekannt“ kennen sie noch nicht
MODULE_NACHTRAG = ("shisha", "studio", "musik", "haushalt")


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
    # Haustür-Öffner für die Zugang-Gruppe, zusätzlich zum Türöffner im Overlay (dort oft das Wohnungsschloss)
    haustueroeffner: str = "button.haustur_tur_offnen"
    # Klingeln an der Ring Intercom (Integration PM Ring Intercom): Overlay „Haustür“ mit Gegensprechen und Haustür-Öffner
    intercom_ausloeser: list[str] = field(default_factory=lambda: ["binary_sensor.haustur_klingelt"])
    klima_praefix: str = "climate.pm_"
    # PM Klima Studio im Panel: interne Adresse der App und derselbe Schlüssel wie dort (panel_schluessel)
    klima_studio_url: str = "http://bdf1cc64-pm-klima-studio:8099"
    klima_studio_schluessel: str = ""
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
            elif f.name in ("log_level", "klima_praefix", "klima_studio_url", "klima_studio_schluessel"):
                setattr(opts, f.name, str(val or "").strip())
            else:
                setattr(opts, f.name, _entity(val))
        return opts

    @property
    def klima_studio(self) -> bool:
        return len(self.klima_studio_schluessel) >= 16 and self.klima_studio_url.startswith(("http://", "https://"))

    def public(self) -> dict[str, Any]:
        """Für Panels und Editor: ohne Schlüssel, dafür nur die Angabe, ob Klima Studio eingebunden ist."""
        d = asdict(self)
        d.pop("klima_studio_schluessel", None)
        d.pop("klima_studio_url", None)
        d["klima_studio"] = self.klima_studio
        return d


# ---------------------------------------------------------------- Einstellungen

STANDARD_SCHNELLZUGRIFF = [
    "light.flur_deckenlampe_flur",
    "lock.eingangstur",
    "alarm_control_panel.alarmo",
    "vacuum.roborock_s8",
    "input_boolean.alles_stumm",
    "script.morgen_briefing",
]


# Modus-Schalter und Helfer ohne Bereich, die in Räumen erscheinen sollen (Zuordnung nur in der App, nicht in der
# HA-Registry, damit Sprachbefehle wie „alles im Wohnzimmer aus“ sie nicht mitschalten)
STANDARD_RAUM_SCHALTER: dict[str, list[str]] = {
    "wohnzimmer": ["input_boolean.gina_lernt", "input_boolean.kohle_stumm"],
    "buro": ["input_boolean.kohle_stumm", "input_boolean.finn_ist_da"],
    "badezimmer": [
        "input_button.shower_mode",
        "input_button.spa_modus",
        "input_boolean.bewegungsmelder_badezimmer",
        "input_boolean.bewegungslicht_bad_ubernahme",
    ],
    "schlafzimmer": ["input_button.schlafmodus"],
    "kuche": ["input_button.geschirr_ausgeraumt"],
    "flur": ["input_boolean.alles_stumm", "input_boolean.bewegungsmelder_gesamt"],
    "balkon": ["input_boolean.bewegungslicht_balkon_ubernahme"],
}


# Schalter, die nur mit Freigabe schaltbar sind: Entität -> Freigabe-Helfer (input_boolean, setzt sich per Timer zurück)
STANDARD_FREIGABEN = {"switch.buro_buro": "input_boolean.burostrom_schaltfreigabe"}

# Außenluftfeuchte: der erste verfügbare Sensor gilt (lokale Wetterstation, DWD als Rückfall)
STANDARD_AUSSEN_FEUCHTE = ["sensor.wetter_outdoor_module_luftfeuchtigkeit", "sensor.zuhause_relative_luftfeuchtigkeit"]


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
    module_bekannt: list[str] = field(default_factory=lambda: list(MODULE))  # neue Module erscheinen einmalig im Dock
    bereiche_reihenfolge: list[str] = field(default_factory=list)
    bereiche_ausblenden: list[str] = field(default_factory=list)
    start_raeume: list[str] = field(default_factory=lambda: ["wohnzimmer", "badezimmer", "schlafzimmer"])
    karten_aus: list[str] = field(default_factory=list)  # Kartenschlüssel, die der Flur nicht zeigt
    szenen_angeheftet: list[str] = field(default_factory=list)  # stehen in der Raumansicht immer vorn
    szenen_aus: list[str] = field(default_factory=list)  # erscheinen nicht unter den Lieblingsszenen
    animationen: bool = True
    zugaenglich: bool = False  # Lesbarkeit: mehr Kontrast, größere Tippflächen, Zustand auch als Form
    raum_schalter: dict[str, list[str]] = field(default_factory=lambda: {k: list(v) for k, v in STANDARD_RAUM_SCHALTER.items()})
    wartung_ignorieren: list[str] = field(default_factory=list)  # Entitäten, deren Gerät der Systemzustand nicht prüft
    material_modus: str = "auto"  # Verbrauchsmaterial: "auto" (erkannt) oder "manuell" (nur material_fest)
    material_fest: list[str] = field(default_factory=list)
    aussen_feuchte: list[str] = field(default_factory=lambda: list(STANDARD_AUSSEN_FEUCHTE))
    freigaben: dict[str, str] = field(default_factory=lambda: dict(STANDARD_FREIGABEN))
    gruss: bool = True  # Begrüßung unten links (Ankunft, Morgen, Nacht)
    gruss_anrede: dict[str, str] = field(default_factory=lambda: {"person.dominik": "Sir"})
    ton_hoch: bool = True  # Hinweiston bei Meldungen mit Priorität hoch (Lautsprecher des Panels)
    ton_lautstaerke: int = 70

    GRENZEN = {  # noqa: RUF012
        "verweildauer_s": (3, 60),
        "ruhe_nach_s": (10, 3600),
        "bedienung_zurueck_s": (15, 600),
        "ruhe_helligkeit": (0, 90),
        "nacht_helligkeit": (0, 95),
        "ereignis_dauer_s": (15, 600),
        "ton_lautstaerke": (5, 100),
    }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> Einstellungen:
        e = cls()
        e.aktualisieren(raw)
        if isinstance((raw or {}).get("module"), list):
            # Neue Module, die der gespeicherte Stand noch nicht kannte, einmalig einreihen (vor „Suche“)
            bekannt = raw.get("module_bekannt")
            bekannt = set(bekannt) if isinstance(bekannt, list) else set(MODULE) - set(MODULE_NACHTRAG)
            for m in MODULE:
                if m != "start" and m not in bekannt and m not in e.module:
                    pos = e.module.index("suche") if "suche" in e.module else len(e.module)
                    e.module.insert(pos, m)
        e.module_bekannt = list(MODULE)
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
            elif key == "raum_schalter":
                if not isinstance(val, dict):
                    abgewiesen.append(key)
                    continue
                self.raum_schalter = {
                    str(b): _entities(ids)[:12]
                    for b, ids in val.items()
                    if re.match(r"^[a-z0-9_]{1,64}$", str(b)) and _entities(ids)
                }
            elif key == "wartung_entitaeten":
                pass  # frühere Jarvis-Liste, ersetzt durch die automatische Geräteprüfung
            elif key in ("wartung_ignorieren", "material_fest", "aussen_feuchte"):
                setattr(self, key, _entities(val)[:60])
            elif key == "material_modus":
                if val not in ("auto", "manuell"):
                    abgewiesen.append(key)
                    continue
                self.material_modus = val
            elif key == "freigaben":
                if not isinstance(val, dict):
                    abgewiesen.append(key)
                    continue
                self.freigaben = {
                    str(k): str(v) for k, v in val.items() if _entities([k]) and re.match(r"^input_boolean\.[a-z0-9_]+$", str(v))
                }
            elif key == "gruss_anrede":
                if not isinstance(val, dict):
                    abgewiesen.append(key)
                    continue
                self.gruss_anrede = {
                    str(p): str(n).strip()[:24]
                    for p, n in val.items()
                    if re.match(r"^person\.[a-z0-9_]+$", str(p)) and str(n).strip()
                }
            elif key in ("szenen_angeheftet", "szenen_aus"):
                setattr(self, key, [e for e in _entities(val) if e.startswith("scene.")][:60])
            elif key == "schnellzugriff":
                self.schnellzugriff = _entities(val)[:8]
            elif key == "module_bekannt":
                pass  # wird beim Laden gesetzt
            elif key == "module":
                vals = val if isinstance(val, list) else []
                self.module = [m for m in dict.fromkeys(str(v) for v in vals) if m in MODULE and m != "start"]
            elif key in ("bereiche_reihenfolge", "bereiche_ausblenden", "start_raeume", "karten_aus"):
                vals = val if isinstance(val, list) else []
                setattr(self, key, [s for s in dict.fromkeys(str(v).strip() for v in vals) if re.match(r"^[a-z0-9_]{1,64}$", s)])
            elif key in ("animationen", "ton_hoch", "gruss", "zugaenglich"):
                setattr(self, key, bool(val))
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
