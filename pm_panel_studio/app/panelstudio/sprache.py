"""Sprachausgabe und Sprachassistent über das Panel.

Ansagen: ``script.panel_ansage`` (Felder ``text``, optional ``engine``, ``sprache``, ``stimme``) wird wie
``script.panel_meldung`` über das Ereignis ``call_service`` erkannt. Die App lässt Home Assistant den Text mit der
TTS-Engine (Vorgabe Piper, Stimme Jarvis) sprechen (``/api/tts_get_url``), holt die Tondatei und schickt den Panels
eine Kennung; die Panels laden den Ton über ``/api/ansage?id=…`` und spielen ihn über ihre Tonkette.

Assistent: Das Panel schickt 16-kHz-Mono-PCM (Int16, 20-ms-Rahmen) als Binärrahmen. Die App startet dafür eine
Assist-Pipeline (``assist_pipeline/run`` von STT bis TTS) und reicht die Rahmen mit der Binär-Kennung der Pipeline an
Home Assistant weiter. Erkannter Text, Antwort und Antwortton gehen an das Panel zurück.

Weckwort: Das Panel hört dauerhaft mit; die Pipeline beginnt dann mit der Stufe ``wake_word`` (openWakeWord in Home
Assistant). Erst nach dem Weckwort folgen Spracherkennung und Antwort; vorher verlässt kein Ton Home Assistant.
Erkennt die Engine ein anderes Weckwort als das eingestellte, endet der Lauf ohne Antwort und das Panel lauscht neu.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import logging
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from typing import Any

from .ha_client import HAClient, HAError

_LOGGER = logging.getLogger(__name__)

ANSAGE_ENGINE = "tts.piper"
ANSAGE_SPRACHE = "de_DE"
ANSAGE_STIMME = "de_DE-jarvis-medium"
MAX_TEXT = 4000
MAX_TOENE = 12  # zuletzt erzeugte Tondateien im Speicher (Ansagen und Antworten)
ASSIST_MAX_S = 15  # längste Aufnahme; danach endet die Spracheingabe von selbst
WECK_LAUF_S = 3600  # ein Lausch-Lauf; danach beginnt das Panel einen neuen

Senden = Callable[[dict[str, Any]], Awaitable[None]]


def _tts_pfad(url_oder_pfad: str) -> str:
    """``/api/tts_proxy/x.mp3`` oder volle URL → Pfad relativ zur HA-API (``tts_proxy/x.mp3``)."""
    p = str(url_oder_pfad or "")
    if "://" in p:
        p = "/" + p.split("://", 1)[1].split("/", 1)[-1]
    p = p.split("?", 1)[0]
    if not p.startswith("/api/tts_proxy/") or ".." in p:
        raise ValueError(f"Unerwarteter TTS-Pfad: {p[:80]}")
    return p.removeprefix("/api/")


class Sitzung:
    """Ein Assist-Lauf eines Panels (Knopf oder Weckwort)."""

    def __init__(self, ws: Any, senden: Senden, weckwort: str | None) -> None:
        self.ws, self.senden, self.weckwort = ws, senden, weckwort
        self.sub: int | None = None
        self.handler: int | None = None
        self.puffer: list[bytes] = []
        self.beendet = False  # Spracheingabe abgeschlossen: weitere Rahmen verwerfen
        self.geweckt = weckwort is None
        # Knopf: höchstens ASSIST_MAX_S Aufnahme; Weckwort: Frist beginnt erst mit dem Weckwort
        self.bis = time.monotonic() + ASSIST_MAX_S if weckwort is None else float("inf")


class Sprache:
    def __init__(self, client: HAClient, senden_alle: Senden) -> None:
        self.client = client
        self.senden_alle = senden_alle
        self.toene: OrderedDict[str, tuple[bytes, str]] = OrderedDict()
        self._zaehler = itertools.count(1)
        self.sitzungen: dict[Any, Sitzung] = {}  # laufender Assist-Lauf je Panel

    # ------------------------------------------------------------ Tondateien
    async def _ton_holen(self, url_oder_pfad: str) -> str:
        daten, ctype = await self.client.rest_raw(_tts_pfad(url_oder_pfad), timeout=60)
        if not ctype.startswith("audio/"):
            raise HAError(f"Keine Tondaten ({ctype})")
        tid = f"t{next(self._zaehler)}"
        self.toene[tid] = (daten, ctype)
        while len(self.toene) > MAX_TOENE:
            self.toene.popitem(last=False)
        return tid

    def ton(self, tid: str) -> tuple[bytes, str] | None:
        return self.toene.get(tid)

    # ------------------------------------------------------------ Ansagen
    async def ansage(self, daten: dict[str, Any]) -> str | None:
        text = str(daten.get("text") or daten.get("message") or "").strip()[:MAX_TEXT]
        if not text:
            return None
        engine = str(daten.get("engine") or ANSAGE_ENGINE)
        stimme = daten.get("stimme", ANSAGE_STIMME if engine == ANSAGE_ENGINE else None)
        anfrage: dict[str, Any] = {"engine_id": engine, "message": text, "language": str(daten.get("sprache") or ANSAGE_SPRACHE)}
        if stimme:
            anfrage["options"] = {"voice": str(stimme)}
        try:
            res = await self.client.rest("POST", "tts_get_url", json=anfrage, timeout=90)
            tid = await self._ton_holen((res or {}).get("path") or (res or {}).get("url") or "")
        except (HAError, ValueError) as err:
            _LOGGER.warning("Ansage nicht erzeugt: %s", err)
            return None
        _LOGGER.info("Ansage %s (%d Zeichen)", tid, len(text))
        await self.senden_alle({"typ": "ansage", "id": tid, "text": text, "titel": str(daten.get("titel") or "")})
        return tid

    # ------------------------------------------------------------ Assistent
    async def assist_start(self, ws: Any, senden: Senden, pipeline: str | None, weckwort: str | None = None) -> dict[str, Any]:
        await self.assist_stopp(ws)
        sitzung = Sitzung(ws, senden, weckwort)
        self.sitzungen[ws] = sitzung
        anfrage: dict[str, Any] = {
            "type": "assist_pipeline/run",
            "start_stage": "wake_word" if weckwort else "stt",
            "end_stage": "tts",
            "input": {"sample_rate": 16000},
            "timeout": WECK_LAUF_S if weckwort else 60,
        }
        if weckwort:
            # Lauschen bis höchstens WECK_LAUF_S; danach beginnt das Panel einfach einen neuen Lauf
            anfrage["input"]["timeout"] = WECK_LAUF_S
        if pipeline:
            anfrage["pipeline"] = pipeline
        try:
            sitzung.sub = await self.client.subscribe(anfrage, lambda ev: self._assist_ereignis(sitzung, ev))
        except HAError:
            self.sitzungen.pop(ws, None)
            raise
        return {"ok": True}

    def assist_ton(self, ws: Any, daten: bytes) -> bool:
        """Binärrahmen eines Panels; True, wenn er dem Assistenten gehört."""
        s = self.sitzungen.get(ws)
        if s is None:
            return False
        if s.beendet:
            return True
        if time.monotonic() > s.bis:
            asyncio.get_running_loop().create_task(self._ende_senden(s))
            return True
        if s.handler is None:
            if len(s.puffer) < 100:  # höchstens 2 s vor „run-start“
                s.puffer.append(bytes(daten))
            return True
        asyncio.get_running_loop().create_task(self.client.send_bytes(bytes([s.handler]) + bytes(daten)))
        return True

    async def _ende_senden(self, s: Sitzung) -> None:
        """Spracheingabe beenden (leerer Rahmen mit der Binär-Kennung); die Pipeline läuft weiter bis zur Antwort."""
        if s.beendet:
            return
        s.beendet = True
        if s.handler is not None:
            with contextlib.suppress(Exception):
                await self.client.send_bytes(bytes([s.handler]))

    async def assist_ende_senden(self, ws: Any = None) -> None:
        s = self.sitzungen.get(ws) if ws is not None else None
        if s is not None:
            await self._ende_senden(s)

    async def assist_stopp(self, ws: Any = None) -> None:
        """Lauf eines Panels abbrechen (ohne ws: alle Läufe)."""
        for s in [s for s in self.sitzungen.values() if ws is None or s.ws is ws]:
            await self._stoppen(s)

    async def _stoppen(self, s: Sitzung) -> None:
        await self._ende_senden(s)
        self._abschliessen(s)

    def _abschliessen(self, s: Sitzung) -> None:
        if self.sitzungen.get(s.ws) is s:
            del self.sitzungen[s.ws]
        sub, s.sub = s.sub, None
        if sub is not None:
            self.client.abo_entfernen(sub)

    def _an_panel(self, s: Sitzung, nachricht: dict[str, Any]) -> None:
        asyncio.get_running_loop().create_task(s.senden({"typ": "assist", **nachricht}))

    def _assist_ereignis(self, s: Sitzung, ev: dict[str, Any]) -> None:
        art, daten = ev.get("type"), ev.get("data") or {}
        if art == "run-start":
            s.handler = (daten.get("runner_data") or {}).get("stt_binary_handler_id")
            if s.handler is not None:
                puffer, s.puffer = s.puffer, []
                for rahmen in puffer:
                    asyncio.get_running_loop().create_task(self.client.send_bytes(bytes([s.handler]) + rahmen))
            self._an_panel(s, {"phase": "lauscht" if s.weckwort else "hoert"})
        elif art == "wake_word-end":
            erkannt = (daten.get("wake_word_output") or {}).get("wake_word_id")
            if not erkannt:
                return  # nichts erkannt (Strom zu Ende); „run-end“ folgt
            if erkannt != s.weckwort:
                # anderes Weckwort der Engine (z. B. „Alexa“): Lauf abbrechen, das Panel lauscht neu
                _LOGGER.debug("Weckwort %s ignoriert (erwartet %s)", erkannt, s.weckwort)
                self._an_panel(s, {"phase": "ende"})
                asyncio.get_running_loop().create_task(self._stoppen(s))
                return
            s.geweckt = True
            s.bis = time.monotonic() + ASSIST_MAX_S
            _LOGGER.info("Weckwort erkannt (%s)", erkannt)
            self._an_panel(s, {"phase": "geweckt"})
        elif art == "stt-vad-end":
            asyncio.get_running_loop().create_task(self._ende_senden(s))
            self._an_panel(s, {"phase": "versteht"})
        elif art == "stt-end":
            self._an_panel(s, {"phase": "denkt", "text": ((daten.get("stt_output") or {}).get("text") or "").strip()})
        elif art == "intent-end":
            antwort = (((daten.get("intent_output") or {}).get("response") or {}).get("speech") or {}).get("plain") or {}
            self._an_panel(s, {"phase": "antwortet", "antwort": str(antwort.get("speech") or "").strip()})
        elif art == "tts-end":
            url = (daten.get("tts_output") or {}).get("url") or (daten.get("tts_output") or {}).get("path")
            if url:
                asyncio.get_running_loop().create_task(self._antwort_ton(s, url))
        elif art == "error":
            code = str(daten.get("code") or "")
            if s.weckwort and not s.geweckt:
                # Fehler beim Lauschen (z. B. Zeitgrenze): still neu beginnen, kein Fehler-Overlay
                self._an_panel(s, {"phase": "ende", "code": code})
            else:
                self._an_panel(s, {"phase": "fehler", "fehler": str(daten.get("message") or code or "Fehler")})
            asyncio.get_running_loop().create_task(self._stoppen(s))
        elif art == "run-end":
            self._an_panel(s, {"phase": "ende"})
            self._abschliessen(s)

    async def _antwort_ton(self, s: Sitzung, url: str) -> None:
        senden = s.senden
        try:
            tid = await self._ton_holen(url)
        except (HAError, ValueError) as err:
            _LOGGER.warning("Antwortton nicht geladen: %s", err)
            return
        await senden({"typ": "assist", "phase": "spricht", "ton": tid})
