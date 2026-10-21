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
    "telefon",
    "suche",
)
# Verstärkerlogik: Stand 2 = saubere Kette ohne Sättigung, Verstärkungen um 100 %
TON_STAND = 2
# Feste Ansagetexte von 2026.10.36; gespeichert gelten sie als leer (abwechselnde Formeln)
PFORTE_ALTE_TEXTE = (
    "Guten Tag. Bitte warten Sie, Sie werden verbunden.",
    "Leider ist gerade niemand erreichbar. Bitte hinterlassen Sie nach dem Signalton eine Nachricht.",
)

# Weckwort: Stand 2 = Ruhezeit standardmäßig aus
WECK_STAND = 2
VERSTAERKUNGEN = ("intercom_lautstaerke", "ton_verstaerkung", "telefon_lautstaerke", "ansage_lautstaerke")

# Module, die nach dem ersten Release hinzukamen: gespeicherte Einstellungen ohne „module_bekannt“ kennen sie noch nicht
MODULE_NACHTRAG = ("shisha", "studio", "musik", "haushalt", "telefon")


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


TEXT_OPTIONEN = (
    "telefon_server",
    "telefon_benutzer",
    "telefon_passwort",
    "telefon_externe_adresse",
    "fritz_benutzer",
    "fritz_passwort",
)


@dataclass
class Options:
    """Feste Zuordnungen aus den App-Optionen. Leere Felder schalten die jeweilige Funktion ab."""

    hinweise_entitaet: str = "sensor.panel_bad_hinweise"
    # Paket-Sensor für die Feed-Karte „Pakete“ (Zustand = aktive Sendungen); leer = keine Paketkarte
    pakete_entitaet: str = "sensor.pakete"
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
    intercom_ausloeser: list[str] = field(default_factory=lambda: ["binary_sensor.haustur_klingelt_panel"])
    klima_praefix: str = "climate.pm_"
    # PM Klima Studio im Panel: interne Adresse der App und derselbe Schlüssel wie dort (panel_schluessel)
    klima_studio_url: str = "http://bdf1cc64-pm-klima-studio:8099"
    klima_studio_schluessel: str = ""
    # Telefon: eigenes IP-Telefon an der FRITZ!Box (leerer Server = aus) und optional TR-064 für Telefonbuch/Anrufliste
    telefon_server: str = ""
    telefon_benutzer: str = ""
    telefon_passwort: str = ""
    telefon_externe_adresse: str = ""  # Adresse des Home-Assistant-Hosts im LAN; leer = automatisch
    fritz_benutzer: str = ""
    fritz_passwort: str = ""
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
            elif f.name in ("log_level", "klima_praefix", "klima_studio_url", "klima_studio_schluessel", *TEXT_OPTIONEN):
                setattr(opts, f.name, str(val or "").strip())
            else:
                setattr(opts, f.name, _entity(val))
        return opts

    @property
    def telefon(self) -> bool:
        return bool(self.telefon_server and self.telefon_benutzer and self.telefon_passwort)

    @property
    def klima_studio(self) -> bool:
        return len(self.klima_studio_schluessel) >= 16 and self.klima_studio_url.startswith(("http://", "https://"))

    def public(self) -> dict[str, Any]:
        """Für Panels und Editor: ohne Schlüssel, dafür nur die Angabe, ob Klima Studio eingebunden ist."""
        d = asdict(self)
        d.pop("klima_studio_schluessel", None)
        d.pop("klima_studio_url", None)
        for k in TEXT_OPTIONEN:
            d.pop(k, None)
        d["klima_studio"] = self.klima_studio
        d["telefon"] = self.telefon
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
STANDARD_STATUS_MODI = [
    "input_boolean.finn_ist_da",
    "input_boolean.alles_stumm",
    "input_boolean.gina_lernt",
    "input_boolean.kohle_stumm",
    "input_boolean.wohnung_ist_leer",
]

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
# Büro-Strom: Hauptschalter und die Steckdosen Schreibtisch und Serverschrank nur mit der gemeinsamen 30-s-Freigabe.
# Diese Sicherungen gelten immer, auch wenn gespeicherte Einstellungen sie (noch) nicht enthalten.
STANDARD_FREIGABEN = {
    "switch.buro_buro": "input_boolean.burostrom_schaltfreigabe",
    "switch.schreibtisch": "input_boolean.burostrom_schaltfreigabe",
    "switch.serverschrank": "input_boolean.burostrom_schaltfreigabe",
    "switch.wohnzimmer_wohnzimmer": "input_boolean.wohnzimmerstrom_schaltfreigabe",
}

# Außenluftfeuchte: der erste verfügbare Sensor gilt (lokale Wetterstation, DWD als Rückfall)
STANDARD_AUSSEN_FEUCHTE = ["sensor.wetter_outdoor_module_luftfeuchtigkeit", "sensor.zuhause_relative_luftfeuchtigkeit"]

# Ginas Stundenplan (Kalender „Universität“)
STANDARD_STUNDENPLAN = ["calendar.universitat"]


# Blöcke der Admin-Startseite mit ihrer Standardbreite in Spalten (die Oberfläche kennt dieselben Schlüssel)
ADMIN_BLOECKE = {
    "aufmerksamkeit": 3,
    "hinweise": 1,
    "tueren": 1,
    "klima": 1,
    "raeume": 2,
    "schnellzugriff": 1,
    "energie": 1,
    "pakete": 1,
    "medien": 1,
    "termine": 1,
    "einkauf": 1,
    "angebote": 1,
    "sicherheit": 1,
}
ADMIN_START = [
    f"{b}:{ADMIN_BLOECKE[b]}"
    for b in ("aufmerksamkeit", "hinweise", "tueren", "klima", "raeume", "schnellzugriff", "energie", "pakete", "medien")
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
    module_bekannt: list[str] = field(default_factory=lambda: list(MODULE))  # neue Module erscheinen einmalig im Dock
    bereiche_reihenfolge: list[str] = field(default_factory=list)
    bereiche_ausblenden: list[str] = field(default_factory=list)
    start_raeume: list[str] = field(default_factory=lambda: ["wohnzimmer", "badezimmer", "schlafzimmer"])
    karten_aus: list[str] = field(default_factory=list)  # Kartenschlüssel, die der Flur nicht zeigt
    # Startseite der Admin-Ansicht am PC: Blöcke in Reihenfolge, „block:breite“ (1–3 Spalten); fehlende sind aus
    admin_start: list[str] = field(default_factory=lambda: list(ADMIN_START))
    # Stundenpläne (Kalender): keine „Als Nächstes“-Karten, nicht in der Abendvorschau, dafür morgens eine Tageskarte
    stundenplan_kalender: list[str] = field(default_factory=lambda: list(STANDARD_STUNDENPLAN))
    dock_anzahl: int = 6  # so viele Module stehen direkt im Dock, die übrigen hinter „Mehr“
    szenen_angeheftet: list[str] = field(default_factory=list)  # stehen in der Raumansicht immer vorn
    szenen_aus: list[str] = field(default_factory=list)  # erscheinen nicht unter den Lieblingsszenen
    animationen: bool = True
    zugaenglich: bool = False  # Lesbarkeit: mehr Kontrast, größere Tippflächen, Zustand auch als Form
    raum_schalter: dict[str, list[str]] = field(default_factory=lambda: {k: list(v) for k, v in STANDARD_RAUM_SCHALTER.items()})
    wartung_ignorieren: list[str] = field(default_factory=list)  # Entitäten, deren Gerät der Systemzustand nicht prüft
    material_modus: str = "auto"  # Verbrauchsmaterial: "auto" (erkannt) oder "manuell" (nur material_fest)
    # Sprachassistent am Panel: Assist-Pipeline (leer = bevorzugte Pipeline); Vorgabe „Home Assistant Cloud“
    assist_pipeline: str = "01k8y1dbxge6tn0b42ydq60n8w"
    assist_aktiv: bool = True
    # Weckwort (openWakeWord in Home Assistant): nur Wandpanels, nicht die Vorschau im Editor; Ruhezeit in vollen Stunden
    weckwort_aktiv: bool = True
    weckwort: str = "hey_jarvis"
    weckwort_ruhe_von: int = 0
    weckwort_ruhe_bis: int = 0  # gleich „von“: keine Ruhezeit (Vorgabe)
    weck_stand: int = WECK_STAND  # ältere Stände übernehmen die Ruhezeit nicht (Vorgabe war 23–6 Uhr)
    # Türdienst an der Haustür (pforte.py): Warteansage und -melodie, Anrufbeantworter mit Abschrift
    pforte_aktiv: bool = True
    pforte_ab_s: int = 30  # Anrufbeantworter nach so vielen Sekunden ohne Annahme (niemand zu Hause: sofort)
    pforte_max_s: int = 60  # längste Nachricht
    pforte_vorlauf_s: int = 3  # Stille nach dem Verbindungsaufbau, bis Ring die Sprechleitung an der Tür durchschaltet
    # Leer = abwechselnde förmliche Formeln, die Warteansage mit Gruß nach Tageszeit (pforte.py)
    pforte_warte_text: str = ""
    pforte_ab_text: str = ""
    pforte_push: list[str] = field(default_factory=lambda: ["notify.mobile_app_dominiks_iphone", "notify.mobile_app_iphone_gina"])
    pforte_stt: str = "stt.home_assistant_cloud"
    # Ablage der Nachrichten; Netzlaufwerk „Fileshare_Media“ (HA-Speicher, Verwendung Medien) unter /media
    pforte_ordner: str = "/media/Fileshare_Media/Haustüraufnahme"
    material_fest: list[str] = field(default_factory=list)
    aussen_feuchte: list[str] = field(default_factory=lambda: list(STANDARD_AUSSEN_FEUCHTE))
    # Haus-Modi, die als Pillen in der Statuszeile des Flurs erscheinen, solange sie „on“ sind
    status_modi: list[str] = field(default_factory=lambda: list(STANDARD_STATUS_MODI))
    freigaben: dict[str, str] = field(default_factory=lambda: dict(STANDARD_FREIGABEN))
    gruss: bool = True  # Begrüßung unten links (Ankunft, Morgen, Nacht)
    gruss_anrede: dict[str, str] = field(default_factory=lambda: {"person.dominik": "Sir"})
    ton_hoch: bool = True  # Hinweiston bei Meldungen mit Priorität hoch (Lautsprecher des Panels)
    ton_lautstaerke: int = 70
    ton_klingel: bool = True  # Klingelton beim Haustür-Overlay; bewusst unabhängig von ton_hoch und „alles_stumm“
    klingel_lautstaerke: int = 100
    # Verstärkung je Art in Prozent (100 = unverändert); Kette und Begrenzer: static/audio.js. Die Grundlautstärke
    # kommt von der Systemlautstärke des Panels; die Verstärkung gleicht nur leise Quellen aus (z. B. die Intercom).
    intercom_lautstaerke: int = 150
    ton_verstaerkung: int = 100  # Hinweis- und Klingelton
    telefon_lautstaerke: int = 100
    ansage_lautstaerke: int = 100  # Ansagen (Piper) und Antworten des Assistenten
    ton_stand: int = TON_STAND  # Stand der Verstärkerlogik; ältere Stände setzen die Verstärkungen einmalig zurück
    telefon_favoriten: list[dict[str, str]] = field(default_factory=list)  # [{name, nummer}] für die Telefon-Seite

    GRENZEN = {  # noqa: RUF012
        "verweildauer_s": (3, 60),
        "ruhe_nach_s": (10, 3600),
        "bedienung_zurueck_s": (15, 600),
        "ruhe_helligkeit": (0, 90),
        "nacht_helligkeit": (0, 95),
        "ereignis_dauer_s": (15, 600),
        "ton_lautstaerke": (5, 100),
        "klingel_lautstaerke": (5, 100),
        "intercom_lautstaerke": (25, 400),
        "ton_verstaerkung": (25, 400),
        "telefon_lautstaerke": (25, 400),
        "ansage_lautstaerke": (25, 400),
        "dock_anzahl": (3, 12),
        "pforte_ab_s": (10, 120),
        "pforte_max_s": (15, 180),
        "pforte_vorlauf_s": (0, 8),
        "weckwort_ruhe_von": (0, 23),
        "weckwort_ruhe_bis": (0, 23),
    }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> Einstellungen:
        e = cls()
        raw = dict(raw or {})
        if raw.pop("ton_stand", 0) != TON_STAND:
            # Frühere Verstärkungen (bis 800 %) glichen eine zu niedrige Systemlautstärke aus und übersteuern jetzt
            for k in VERSTAERKUNGEN:
                raw.pop(k, None)
        if raw.pop("weck_stand", 0) != WECK_STAND:
            raw.pop("weckwort_ruhe_von", None)
            raw.pop("weckwort_ruhe_bis", None)
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
            elif key == "status_modi":
                erlaubt = ("input_boolean.", "switch.", "binary_sensor.")
                self.status_modi = [e for e in _entities(val) if e.startswith(erlaubt)][:20]
            elif key == "stundenplan_kalender":
                self.stundenplan_kalender = [e for e in _entities(val) if e.startswith("calendar.")][:20]
            elif key == "telefon_favoriten":
                vals = val if isinstance(val, list) else []
                favoriten = []
                for v in vals:
                    if not isinstance(v, dict):
                        continue
                    name = str(v.get("name") or "").strip()[:40]
                    nummer = re.sub(r"[\s/()-]", "", str(v.get("nummer") or ""))
                    if name and re.match(r"^\+?[0-9*#]{2,32}$", nummer):
                        favoriten.append({"name": name, "nummer": nummer})
                self.telefon_favoriten = favoriten[:24]
            elif key == "assist_pipeline":
                if not isinstance(val, str) or not re.match(r"^[A-Za-z0-9_-]{0,64}$", val):
                    abgewiesen.append(key)
                    continue
                self.assist_pipeline = val
            elif key in ("pforte_warte_text", "pforte_ab_text"):
                text = re.sub(r"\s+", " ", str(val or "")).strip()[:240]
                # Die festen Texte von 2026.10.36 gelten als „nicht eingestellt“: dann abwechselnd mit Gruß
                setattr(self, key, "" if text in PFORTE_ALTE_TEXTE else text)
            elif key == "pforte_push":
                vals = val if isinstance(val, list) else str(val or "").split(",")
                dienste = dict.fromkeys(str(x).strip() for x in vals)
                self.pforte_push = [v for v in dienste if re.match(r"^notify\.[a-z0-9_]+$", v)][:6]
            elif key == "pforte_ordner":
                pfad = str(val or "").strip().rstrip("/")
                # nur unter /media (dort hängen die Netzlaufwerke), ohne „..“
                if pfad and (not re.match(r"^/media/[^/].*$", pfad) or ".." in pfad.split("/") or len(pfad) > 200):
                    abgewiesen.append(key)
                    continue
                self.pforte_ordner = pfad
            elif key == "pforte_stt":
                if not isinstance(val, str) or not re.match(r"^stt\.[a-z0-9_]+$", val):
                    abgewiesen.append(key)
                    continue
                self.pforte_stt = val
            elif key == "weckwort":
                if not isinstance(val, str) or not re.match(r"^[a-z0-9_]{1,40}$", val):
                    abgewiesen.append(key)
                    continue
                self.weckwort = val
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
                    **STANDARD_FREIGABEN,
                    **{
                        str(k): str(v)
                        for k, v in val.items()
                        if _entities([k]) and re.match(r"^input_boolean\.[a-z0-9_]+$", str(v))
                    },
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
            elif key in ("module_bekannt", "ton_stand", "weck_stand"):
                pass  # wird beim Laden gesetzt
            elif key == "module":
                vals = val if isinstance(val, list) else []
                self.module = [m for m in dict.fromkeys(str(v) for v in vals) if m in MODULE and m != "start"]
            elif key == "admin_start":
                vals = val if isinstance(val, list) else []
                gesehen: set[str] = set()
                bloecke = []
                for v in vals:
                    m = re.match(r"^([a-z_]{2,32})(?::([1-3]))?$", str(v).strip())
                    if m and m.group(1) in ADMIN_BLOECKE and m.group(1) not in gesehen:
                        gesehen.add(m.group(1))
                        bloecke.append(f"{m.group(1)}:{m.group(2) or ADMIN_BLOECKE[m.group(1)]}")
                self.admin_start = bloecke
            elif key in ("bereiche_reihenfolge", "bereiche_ausblenden", "start_raeume", "karten_aus"):
                vals = val if isinstance(val, list) else []
                setattr(self, key, [s for s in dict.fromkeys(str(v).strip() for v in vals) if re.match(r"^[a-z0-9_]{1,64}$", s)])
            elif key in (
                "animationen",
                "ton_hoch",
                "ton_klingel",
                "gruss",
                "zugaenglich",
                "assist_aktiv",
                "weckwort_aktiv",
                "pforte_aktiv",
            ):
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
