"""Panel-Meldungen wie an den Panels Büro und Bad.

Quelle 1: das zentrale Backend ``script.panel_meldung`` (Kennung, Titel, Text, Symbol, Priorität, Bestätigen-Knopf,
Laufzeit) und ``script.panel_meldung_schliessen``. Die App hört diese Aufrufe über das Ereignis ``call_service`` mit;
der Flur zeigt alle Meldungen, unabhängig vom Feld ``panels``.

Quelle 2: ``browser_mod.popup`` / ``close_popup``. Ein Popup mit derselben Kennung ergänzt die Panel-Meldung um den
ausführlichen Text (Markdown), eine Kamera und seine Knöpfe. Popups ohne passende Panel-Meldung erscheinen mit
Priorität normal und Symbol info.

Eine Meldung ist ein Dict:
  id, tag, titel, text, icon, stufe (passiv|aktiv|zeitkritisch|kritisch), prio (low|normal|high, Altfeld),
  bestaetigen (input_button oder None),
  details (Markdown oder ""), kamera, knoepfe [{text, domain, service, data, art}], seit, bis
"""

from __future__ import annotations

import re
import time
import uuid
from typing import Any

MAX_DAUER_S = 4 * 3600
MAX_MELDUNGEN = 10
# Mitteilungsstufen nach Apple-HIG („interruption levels“); die Laufzeit der alten Prioritäten bleibt erhalten
STUFEN = ("passiv", "aktiv", "zeitkritisch", "kritisch")
LAUFZEIT_MIN = {"passiv": 15, "aktiv": 60, "zeitkritisch": 120, "kritisch": 240}
STUFE_RANG = {s: i + 1 for i, s in enumerate(STUFEN)}
ALT_STUFE = {"low": "passiv", "normal": "aktiv", "high": "kritisch"}  # Rückwärtskompatibilität: prioritaet low|normal|high
STUFE_ALT = {"passiv": "low", "aktiv": "normal", "zeitkritisch": "normal", "kritisch": "high"}  # Altfeld ``prio``
RELEVANZ = {"passiv": 35, "aktiv": 65, "zeitkritisch": 90, "kritisch": 100}  # Sortierwert im Feed (0–100)


def stufe_aus(daten: dict[str, Any]) -> str:
    """Stufe aus ``stufe`` oder ``prioritaet``; ``low|normal|high`` gelten weiter, Fehlendes und Unbekanntes ist ``aktiv``."""
    for key in ("stufe", "prioritaet", "prio"):
        wert = str(daten.get(key) or "").strip().lower()
        if wert in STUFEN:
            return wert
        if wert in ALT_STUFE:
            return ALT_STUFE[wert]
    return "aktiv"


def weckt(stufe: str, nacht: bool) -> bool:
    """Weckt die Meldung ein ruhendes Panel? kritisch immer, aktiv und zeitkritisch nur am Tag, passiv nie."""
    return stufe == "kritisch" or (stufe in ("aktiv", "zeitkritisch") and not nacht)


SERVICE_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
KAMERA_RE = re.compile(r"^camera\.[a-z0-9_]+$")
ENTITY_RE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


def text_aus_inhalt(inhalt: Any) -> tuple[str, str | None]:
    """Markdown-Text und optionale Kamera aus ``content`` (Text oder Lovelace-Karte)."""
    if isinstance(inhalt, str):
        return inhalt, None
    if isinstance(inhalt, list):
        teile = [text_aus_inhalt(x) for x in inhalt]
        return "\n\n".join(t for t, _ in teile if t), next((k for _, k in teile if k), None)
    if not isinstance(inhalt, dict):
        return "", None
    kamera = None
    for key in ("camera_image", "entity"):
        val = inhalt.get(key)
        if isinstance(val, str) and KAMERA_RE.match(val):
            kamera = val
    if inhalt.get("type") == "markdown":
        return str(inhalt.get("content") or ""), kamera
    for key in ("cards", "card"):
        if isinstance(inhalt.get(key), (list, dict)):
            text, k2 = text_aus_inhalt(inhalt[key])
            return text, kamera or k2
    return str(inhalt.get("content") or ""), kamera


def _aktion(aktion: Any) -> dict[str, Any] | None:
    """Formate ``{service|action: d.s, data}`` und Tap-Action ``{action: perform-action, perform_action: d.s}``."""
    if isinstance(aktion, list):
        for a in aktion:
            if (r := _aktion(a)) is not None:
                return r
        return None
    if not isinstance(aktion, dict):
        return None
    dienst = str(aktion.get("perform_action") or aktion.get("service") or aktion.get("action") or "")
    if not SERVICE_RE.match(dienst):
        return None
    domain, service = dienst.split(".", 1)
    daten = aktion.get("data") or aktion.get("service_data") or {}
    daten = daten if isinstance(daten, dict) else {}
    if isinstance(aktion.get("target"), dict):
        daten = {**aktion["target"], **daten}
    return {"domain": domain, "service": service, "data": daten}


def _skript_daten(domain: str, service: str, daten: dict[str, Any], skript: str) -> dict[str, Any] | None:
    """Felder eines Skriptaufrufs, direkt (``script.x``) oder über ``script.turn_on`` mit ``variables``."""
    if domain != "script":
        return None
    if service == skript:
        return daten
    if service == "turn_on":
        ziel = daten.get("entity_id")
        ziele = [ziel] if isinstance(ziel, str) else ziel or []
        if f"script.{skript}" in ziele:
            return daten.get("variables") or {}
    return None


class PopupSpeicher:
    def __init__(self) -> None:
        self.meldungen: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------ Eingang

    def verarbeiten(self, domain: str, service: str, daten: dict[str, Any], jetzt: float | None = None) -> str | None:
        """Wertet einen Dienstaufruf aus. Rückgabe: ID einer neuen oder aktualisierten Meldung, ``""`` bei Entfernen,
        ``None`` ohne Änderung."""
        jetzt = time.time() if jetzt is None else jetzt
        if (d := _skript_daten(domain, service, daten, "panel_meldung")) is not None:
            return self._panel(d, jetzt)
        if (d := _skript_daten(domain, service, daten, "panel_meldung_schliessen")) is not None:
            return "" if self._schliessen(d.get("tag")) else None
        if domain == "browser_mod" and service == "popup":
            return self._popup(daten, jetzt)
        if domain == "browser_mod" and service == "close_popup":
            tag = daten.get("tag")
            if tag:
                return "" if self._schliessen(tag) else None
            weg = [k for k, m in self.meldungen.items() if m["quelle"] == "popup"]
            for k in weg:
                del self.meldungen[k]
            return "" if weg else None
        return None

    def _eintrag(self, tag: str | None, jetzt: float) -> dict[str, Any]:
        mid = f"msg:{tag}" if tag else f"msg:{uuid.uuid4().hex[:10]}"
        m = self.meldungen.get(mid)
        if m is None:
            m = {
                "id": mid,
                "tag": tag,
                "titel": "Hinweis",
                "text": "",
                "icon": "info",
                "stufe": "aktiv",
                "prio": "normal",
                "bestaetigen": None,
                "details": "",
                "kamera": None,
                "knoepfe": [],
                "quelle": "",
                "sicherheit": False,
                "seit": jetzt,
                "bis": jetzt + LAUFZEIT_MIN["aktiv"] * 60,
            }
            self.meldungen[mid] = m
        return m

    def _panel(self, d: dict[str, Any], jetzt: float) -> str | None:
        tag = str(d.get("tag") or "").replace("|", "/").strip()[:180]
        if not tag:
            return None
        m = self._eintrag(tag, jetzt)
        stufe = stufe_aus(d)
        try:
            laufzeit = int(d.get("laufzeit_min") or 0) or LAUFZEIT_MIN[stufe]
        except (TypeError, ValueError):
            laufzeit = LAUFZEIT_MIN[stufe]
        bestaetigen = str(d.get("bestaetigen_entity") or "")
        m.update(
            titel=str(d.get("titel") or "Hinweis"),
            text=str(d.get("text") or ""),
            icon=str(d.get("icon") or "info"),
            stufe=stufe,
            prio=STUFE_ALT[stufe],
            bestaetigen=bestaetigen if ENTITY_RE.match(bestaetigen) else None,
            quelle="panel",
            sicherheit=bool(d.get("sicherheit")),
            seit=jetzt,
            bis=jetzt + min(laufzeit * 60, 24 * 3600),
        )
        self._begrenzen()
        return m["id"]

    def _popup(self, d: dict[str, Any], jetzt: float) -> str:
        tag = str(d.get("tag") or "") or None
        m = self._eintrag(tag, jetzt)
        details, kamera = text_aus_inhalt(d.get("content"))
        knoepfe = []
        for seite, art in (("left", "neben"), ("right", "haupt")):
            if d.get(f"{seite}_button"):
                a = _aktion(d.get(f"{seite}_button_action")) or {"domain": None, "service": None, "data": {}}
                knoepfe.append({"text": str(d[f"{seite}_button"]), "art": art, **a})
        m.update(details=details, kamera=kamera, knoepfe=knoepfe)
        if m["quelle"] != "panel":  # Popup ohne Panel-Meldung: Titel und Laufzeit aus dem Popup
            m["titel"] = str(d.get("title") or "Meldung")
            m["quelle"] = "popup"
            m["seit"] = jetzt
            try:
                dauer = float(d["timeout"]) / 1000 if d.get("timeout") else MAX_DAUER_S
            except (TypeError, ValueError):
                dauer = MAX_DAUER_S
            m["bis"] = jetzt + min(dauer, MAX_DAUER_S)
        self._begrenzen()
        return m["id"]

    def _schliessen(self, tag: Any) -> bool:
        return self.meldungen.pop(f"msg:{str(tag or '').replace('|', '/').strip()}", None) is not None

    def _begrenzen(self) -> None:
        while len(self.meldungen) > MAX_MELDUNGEN:
            aelteste = min(self.meldungen.values(), key=lambda x: (STUFE_RANG[x["stufe"]], x["seit"]))
            self.meldungen.pop(aelteste["id"])

    # ------------------------------------------------------------ Pflege und Ausgabe

    def entfernen(self, mid: str) -> bool:
        return self.meldungen.pop(mid, None) is not None

    def aufraeumen(self, jetzt: float | None = None) -> bool:
        jetzt = time.time() if jetzt is None else jetzt
        weg = [k for k, m in self.meldungen.items() if m["bis"] < jetzt]
        for k in weg:
            del self.meldungen[k]
        return bool(weg)

    def liste(self) -> list[dict[str, Any]]:
        """Höchste Priorität zuerst, innerhalb davon die neueste."""
        return sorted(self.meldungen.values(), key=lambda m: (-STUFE_RANG[m["stufe"]], -m["seit"]))

    def karten(self) -> list[dict[str, Any]]:
        """Karussell-Karten, mit ``relevanz`` für die Sortierung im Feed. Passive Meldungen stehen nur unter der Glocke."""
        out = []
        for m in self.liste():
            if m["stufe"] == "passiv":
                continue
            text = m["text"] or re.sub(r"[*_#`>]", "", m["details"]).strip()
            text = " · ".join(z.strip(" -·") for z in text.splitlines() if z.strip(" -·"))[:140]
            out.append(
                {
                    "id": m["id"],
                    "art": "meldung",
                    "schluessel": "meldung",
                    "icon": m["icon"],
                    "stufe": m["stufe"],
                    "prio": m["prio"],
                    "relevanz": RELEVANZ[m["stufe"]],
                    "titel": m["titel"],
                    "wert": m["titel"],
                    "hinweis": text,
                    "ring": None,
                    "ende": None,
                    "dauer_s": None,
                }
            )
        return out
