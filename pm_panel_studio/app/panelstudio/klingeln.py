"""Klingelbuch: jedes Klingeln an der Haustür mit seinem Ausgang, für den Haustür-Verlauf der Sicherheitsseite.

Ausgänge: ``laeuft`` (noch offen), ``panel`` (am Panel angenommen), ``app`` (in der Ring-App angenommen),
``nachricht`` (Anrufbeantworter mit Nachricht; Datei, Länge, Abschrift), ``ohne`` (Anrufbeantworter, nichts gesagt),
``verpasst`` (niemand hat angenommen). ``tuer`` markiert zusätzlich, dass die Haustür danach geöffnet wurde.

Ein Eintrag, der nach ``OFFEN_S`` Sekunden noch offen ist, gilt als verpasst. Ein zweites Klingeln innerhalb von
``ZUSAMMEN_S`` Sekunden zählt zum selben Eintrag (Besucher drückt mehrmals). Gespeichert in ``klingeln.json`` im
Datenordner der App, höchstens ``MAX`` Einträge.
"""

from __future__ import annotations

import contextlib
import json
import logging
import secrets
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

_LOGGER = logging.getLogger(__name__)

AUSGAENGE = ("laeuft", "panel", "app", "nachricht", "ohne", "verpasst")
OFFEN_S = 180
ZUSAMMEN_S = 45
TUER_S = 300  # so lange nach dem Klingeln zählt ein Öffnen der Haustür zum Eintrag
MAX = 300


class Klingelbuch:
    def __init__(self, pfad: Path | None, jetzt: Callable[[], float] = time.time) -> None:
        self.pfad = pfad
        self.jetzt = jetzt
        self.eintraege: list[dict[str, Any]] = []
        if pfad is not None:
            with contextlib.suppress(OSError, ValueError):
                daten = json.loads(pfad.read_text(encoding="utf-8"))
                if isinstance(daten, list):
                    self.eintraege = [e for e in daten if isinstance(e, dict) and e.get("id") and e.get("t")]

    def _speichern(self) -> None:
        if self.pfad is None:
            return
        try:
            self.pfad.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.pfad.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.eintraege[-MAX:], ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.pfad)
        except OSError as err:
            _LOGGER.warning("Klingelbuch nicht gespeichert: %s", err)

    def _abschliessen(self) -> bool:
        """Offene Einträge, die zu alt sind, als verpasst abschließen."""
        geaendert = False
        for e in self.eintraege:
            if e["ausgang"] == "laeuft" and self.jetzt() - e["t"] > OFFEN_S:
                e["ausgang"] = "verpasst"
                geaendert = True
        return geaendert

    def offen(self) -> dict[str, Any] | None:
        """Der jüngste noch offene Eintrag."""
        self._abschliessen()
        return next((e for e in reversed(self.eintraege) if e["ausgang"] == "laeuft"), None)

    def klingeln(self) -> tuple[str, bool]:
        """Neues Klingeln. Liefert die Kennung und ob es ein neuer Eintrag ist (sonst: erneutes Drücken)."""
        self._abschliessen()
        zuletzt = self.eintraege[-1] if self.eintraege else None
        if zuletzt and self.jetzt() - zuletzt["t"] < ZUSAMMEN_S:
            zuletzt["mal"] = int(zuletzt.get("mal", 1)) + 1
            self._speichern()
            return zuletzt["id"], False
        e = {"id": secrets.token_hex(6), "t": round(self.jetzt(), 1), "ausgang": "laeuft", "mal": 1}
        self.eintraege.append(e)
        self.eintraege = self.eintraege[-MAX:]
        self._speichern()
        return e["id"], True

    def ausgang(self, art: str, kennung: str | None = None, **daten: Any) -> bool:
        """Ausgang setzen: für ``kennung`` oder den jüngsten offenen Eintrag. Ein festgelegter Ausgang wird nur von
        einer Nachricht überschrieben (der Anrufbeantworter wertet eine begonnene Aufnahme auch nach der Übernahme)."""
        if art not in AUSGAENGE:
            raise ValueError(art)
        e = next((x for x in self.eintraege if x["id"] == kennung), None) if kennung else self.offen()
        if e is None or (e["ausgang"] not in ("laeuft", "verpasst") and art != "nachricht"):
            return False
        e["ausgang"] = art
        e["ende"] = round(self.jetzt(), 1)
        e.update({k: v for k, v in daten.items() if v is not None})
        self._speichern()
        return True

    def tuer_geoeffnet(self) -> bool:
        """Die Haustür wurde geöffnet: beim jüngsten Klingeln der letzten Minuten vermerken; noch offen heißt dann,
        jemand hat geöffnet (am Panel oder per Knopf): als am Panel angenommen werten."""
        zuletzt = self.eintraege[-1] if self.eintraege else None
        if not zuletzt or self.jetzt() - zuletzt["t"] > TUER_S or zuletzt.get("tuer"):
            return False
        zuletzt["tuer"] = True
        if zuletzt["ausgang"] in ("laeuft", "verpasst"):
            zuletzt["ausgang"] = "panel"
            zuletzt["ende"] = round(self.jetzt(), 1)
        self._speichern()
        return True

    def liste(self, anzahl: int = 50) -> list[dict[str, Any]]:
        if self._abschliessen():
            self._speichern()
        return [dict(e) for e in reversed(self.eintraege[-anzahl:])]
