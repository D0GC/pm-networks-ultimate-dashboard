"""Sprachausgabe und Sprachassistent über das Panel.

Ansagen: ``script.panel_ansage`` (Felder ``text``, optional ``engine``, ``sprache``, ``stimme``) wird wie
``script.panel_meldung`` über das Ereignis ``call_service`` erkannt. Die App lässt Home Assistant den Text mit der
TTS-Engine (Vorgabe Piper, Stimme Jarvis) sprechen (``/api/tts_get_url``), holt die Tondatei und schickt den Panels
eine Kennung; die Panels laden den Ton über ``/api/ansage?id=…`` und spielen ihn über ihre Tonkette.

Assistent: Das Panel schickt 16-kHz-Mono-PCM (Int16, 20-ms-Rahmen) als Binärrahmen. Die App startet dafür eine
Assist-Pipeline (``assist_pipeline/run`` von STT bis TTS) und reicht die Rahmen mit der Binär-Kennung der Pipeline an
Home Assistant weiter. Erkannter Text, Antwort und Antwortton gehen an das Panel zurück.
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


class Sprache:
    def __init__(self, client: HAClient, senden_alle: Senden) -> None:
        self.client = client
        self.senden_alle = senden_alle
        self.toene: OrderedDict[str, tuple[bytes, str]] = OrderedDict()
        self._zaehler = itertools.count(1)
        # laufender Assistent: Panel, Abo-Kennung, Binär-Kennung, Ende-Zeitpunkt
        self.assist_ws: Any = None
        self._assist_sub: int | None = None
        self._assist_handler: int | None = None
        self._assist_bis = 0.0
        self._assist_senden: Senden | None = None
        self._puffer: list[bytes] = []

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
    async def assist_start(self, ws: Any, senden: Senden, pipeline: str | None) -> dict[str, Any]:
        await self.assist_stopp()
        self.assist_ws, self._assist_senden = ws, senden
        self._assist_handler, self._puffer = None, []
        self._assist_bis = time.monotonic() + ASSIST_MAX_S
        anfrage: dict[str, Any] = {
            "type": "assist_pipeline/run",
            "start_stage": "stt",
            "end_stage": "tts",
            "input": {"sample_rate": 16000},
            "timeout": 60,
        }
        if pipeline:
            anfrage["pipeline"] = pipeline
        try:
            self._assist_sub = await self.client.subscribe(anfrage, self._assist_ereignis)
        except HAError:
            self.assist_ws = self._assist_senden = None
            raise
        return {"ok": True}

    def assist_ton(self, ws: Any, daten: bytes) -> bool:
        """Binärrahmen eines Panels; True, wenn er dem Assistenten gehört."""
        if ws is not self.assist_ws or self._assist_sub is None:
            return False
        if time.monotonic() > self._assist_bis:
            asyncio.get_running_loop().create_task(self.assist_ende_senden())
            return True
        if self._assist_handler is None:
            self._puffer.append(bytes(daten))  # kommt vor „run-start“, wird nachgereicht
            return True
        asyncio.get_running_loop().create_task(self.client.send_bytes(bytes([self._assist_handler]) + bytes(daten)))
        return True

    async def assist_ende_senden(self) -> None:
        """Spracheingabe beenden (leerer Rahmen mit der Binär-Kennung); die Pipeline läuft weiter bis zur Antwort."""
        h, self._assist_handler = self._assist_handler, None
        self._assist_bis = 0
        if h is not None:
            with contextlib.suppress(Exception):
                await self.client.send_bytes(bytes([h]))

    async def assist_stopp(self) -> None:
        await self.assist_ende_senden()
        if self._assist_sub is not None:
            self.client.abo_entfernen(self._assist_sub)
        self._assist_sub = None
        self.assist_ws = self._assist_senden = None

    def _an_panel(self, nachricht: dict[str, Any]) -> None:
        if self._assist_senden is not None:
            asyncio.get_running_loop().create_task(self._assist_senden({"typ": "assist", **nachricht}))

    def _assist_ereignis(self, ev: dict[str, Any]) -> None:
        art, daten = ev.get("type"), ev.get("data") or {}
        if art == "run-start":
            self._assist_handler = (daten.get("runner_data") or {}).get("stt_binary_handler_id")
            if self._assist_handler is not None:
                puffer, self._puffer = self._puffer, []
                for rahmen in puffer:
                    asyncio.get_running_loop().create_task(self.client.send_bytes(bytes([self._assist_handler]) + rahmen))
            self._an_panel({"phase": "hoert"})
        elif art == "stt-vad-end":
            asyncio.get_running_loop().create_task(self.assist_ende_senden())
            self._an_panel({"phase": "versteht"})
        elif art == "stt-end":
            self._an_panel({"phase": "denkt", "text": ((daten.get("stt_output") or {}).get("text") or "").strip()})
        elif art == "intent-end":
            antwort = (((daten.get("intent_output") or {}).get("response") or {}).get("speech") or {}).get("plain") or {}
            self._an_panel({"phase": "antwortet", "antwort": str(antwort.get("speech") or "").strip()})
        elif art == "tts-end":
            url = (daten.get("tts_output") or {}).get("url") or (daten.get("tts_output") or {}).get("path")
            if url:
                asyncio.get_running_loop().create_task(self._antwort_ton(url))
        elif art == "error":
            self._an_panel({"phase": "fehler", "fehler": str(daten.get("message") or daten.get("code") or "Fehler")})
            asyncio.get_running_loop().create_task(self.assist_stopp())
        elif art == "run-end":
            self._an_panel({"phase": "ende"})
            sub, self._assist_sub = self._assist_sub, None
            if sub is not None:
                self.client.abo_entfernen(sub)

    async def _antwort_ton(self, url: str) -> None:
        senden = self._assist_senden
        try:
            tid = await self._ton_holen(url)
        except (HAError, ValueError) as err:
            _LOGGER.warning("Antwortton nicht geladen: %s", err)
            return
        if senden is not None:
            await senden({"typ": "assist", "phase": "spricht", "ton": tid})
