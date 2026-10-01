"""Browser-Mod-Popups als Panel-Meldungen.

Die App hört die Dienstaufrufe ``browser_mod.popup`` und ``browser_mod.close_popup`` mit (Ereignis ``call_service``).
So erscheinen alle Popups, die bisher auf dem Dashboard aufgingen (Morgen-Briefing, Kohle, Waschmaschine …), auch
im Panel, ohne dass Automationen geändert werden müssen. Die Daten sind beim Aufruf bereits gerendert.

Eine Meldung ist ein Dict:
  id, tag, titel, text (Markdown), kamera (camera.* oder None), knoepfe [{text, domain, service, data, art}],
  seit (Unix-Zeit), bis (Unix-Zeit oder None)
"""

from __future__ import annotations

import re
import time
import uuid
from typing import Any

MAX_DAUER_S = 4 * 3600  # Popups ohne Ablauf verschwinden spätestens nach 4 Stunden
MAX_MELDUNGEN = 8
SERVICE_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
KAMERA_RE = re.compile(r"^camera\.[a-z0-9_]+$")


def _text_aus_inhalt(inhalt: Any) -> tuple[str, str | None]:
    """Markdown-Text und optionale Kamera aus ``content`` (Text oder Lovelace-Karte)."""
    if isinstance(inhalt, str):
        return inhalt, None
    if isinstance(inhalt, list):
        teile = [_text_aus_inhalt(x) for x in inhalt]
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
    if isinstance(inhalt.get("cards"), list):
        text, k2 = _text_aus_inhalt(inhalt["cards"])
        return text, kamera or k2
    if isinstance(inhalt.get("card"), dict):
        text, k2 = _text_aus_inhalt(inhalt["card"])
        return text, kamera or k2
    return str(inhalt.get("content") or inhalt.get("title") or ""), kamera


def _aktion(aktion: Any) -> dict[str, Any] | None:
    """``{service|action: "d.s", data: {...}}``; Listen: erste gültige Aktion."""
    if isinstance(aktion, list):
        for a in aktion:
            if (r := _aktion(a)) is not None:
                return r
        return None
    if not isinstance(aktion, dict):
        return None
    # Formate: {service: d.s}, {action: d.s} und Tap-Action {action: perform-action, perform_action: d.s}
    dienst = str(aktion.get("perform_action") or aktion.get("service") or aktion.get("action") or "")
    if not SERVICE_RE.match(dienst):
        return None
    domain, service = dienst.split(".", 1)
    daten = aktion.get("data") or aktion.get("service_data") or {}
    if not isinstance(daten, dict):
        daten = {}
    if aktion.get("target") and isinstance(aktion["target"], dict):
        daten = {**aktion["target"], **daten}
    return {"domain": domain, "service": service, "data": daten}


def aus_aufruf(daten: dict[str, Any], jetzt: float | None = None) -> dict[str, Any]:
    jetzt = time.time() if jetzt is None else jetzt
    text, kamera = _text_aus_inhalt(daten.get("content"))
    tag = str(daten.get("tag") or "") or None
    knoepfe = []
    for seite, art in (("left", "neben"), ("right", "haupt")):
        beschriftung = daten.get(f"{seite}_button")
        if not beschriftung:
            continue
        a = _aktion(daten.get(f"{seite}_button_action"))
        knoepfe.append({"text": str(beschriftung), "art": art, **(a or {"domain": None, "service": None, "data": {}})})
    timeout_ms = daten.get("timeout")
    try:
        dauer = float(timeout_ms) / 1000 if timeout_ms else MAX_DAUER_S
    except (TypeError, ValueError):
        dauer = MAX_DAUER_S
    return {
        "id": f"pop:{tag}" if tag else f"pop:{uuid.uuid4().hex[:10]}",
        "tag": tag,
        "titel": str(daten.get("title") or "Meldung"),
        "text": text,
        "kamera": kamera,
        "knoepfe": knoepfe,
        "seit": jetzt,
        "bis": jetzt + min(dauer, MAX_DAUER_S),
    }


class PopupSpeicher:
    def __init__(self) -> None:
        self.meldungen: dict[str, dict[str, Any]] = {}

    def verarbeiten(self, domain: str, service: str, daten: dict[str, Any], jetzt: float | None = None) -> bool:
        """Liefert True, wenn sich die Liste geändert hat."""
        if domain != "browser_mod":
            return False
        if service == "popup":
            m = aus_aufruf(daten, jetzt)
            self.meldungen[m["id"]] = m
            while len(self.meldungen) > MAX_MELDUNGEN:
                aeltester = min(self.meldungen.values(), key=lambda x: x["seit"])
                self.meldungen.pop(aeltester["id"])
            return True
        if service == "close_popup":
            tag = daten.get("tag")
            if tag:
                return self.meldungen.pop(f"pop:{tag}", None) is not None
            geaendert = bool(self.meldungen)
            self.meldungen.clear()
            return geaendert
        return False

    def entfernen(self, mid: str) -> bool:
        return self.meldungen.pop(mid, None) is not None

    def aufraeumen(self, jetzt: float | None = None) -> bool:
        jetzt = time.time() if jetzt is None else jetzt
        weg = [k for k, m in self.meldungen.items() if m["bis"] and m["bis"] < jetzt]
        for k in weg:
            del self.meldungen[k]
        return bool(weg)

    def liste(self) -> list[dict[str, Any]]:
        return sorted(self.meldungen.values(), key=lambda m: m["seit"], reverse=True)

    def karten(self) -> list[dict[str, Any]]:
        """Karussell-Karten (neueste zuerst), Text ohne Markdown und auf eine Vorschau gekürzt."""
        out = []
        for m in self.liste():
            vorschau = re.sub(r"[*_#`>]|\[([^\]]*)\]\([^)]*\)", r"\1", m["text"])
            vorschau = " · ".join(z.strip(" -·") for z in vorschau.splitlines() if z.strip(" -·"))[:140]
            out.append(
                {
                    "id": m["id"],
                    "art": "meldung",
                    "schluessel": "meldung",
                    "titel": m["titel"],
                    "wert": m["titel"],
                    "hinweis": vorschau,
                    "ring": None,
                    "ende": None,
                    "dauer_s": None,
                }
            )
        return out
