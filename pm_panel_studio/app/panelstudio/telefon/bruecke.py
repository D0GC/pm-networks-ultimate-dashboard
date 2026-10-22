"""Tonbrücke: Panel-Verbindung (WebSocket, 8 kHz Int16) ↔ RTP-Strecke zur FRITZ!Box (G.711).

Das Panel schickt und empfängt Ton als binäre Rahmen zu je 320 Byte (160 Samples Int16 little endian, 8 kHz mono,
20 ms). Ein Takt-Task läuft alle 20 ms (absolute Zeitplanung, kein Drift):

* Telefon → Panel: ``rtp.lesen()`` (bei fehlenden Daten Stille) geht an den ``senden``-Rückruf.
* Panel → Telefon: eingehende Rahmen landen in einem kleinen Puffer (höchstens ``PUFFER_MAX``, ältere werden
  verworfen) und werden im Takt an ``rtp.senden`` weitergegeben, damit ein Burst der WebSocket-Verbindung nicht als
  Paketstoß bei der Gegenstelle ankommt. Bei ``stumm`` werden Nullen gesendet.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from collections.abc import Awaitable, Callable

from . import g711
from .rtp import RtpSitzung

_LOGGER = logging.getLogger(__name__)

TAKT = 0.02  # 20 ms je Rahmen
RAHMEN_BYTES = g711.RAHMEN_BYTES  # 320
PUFFER_MAX = 10  # Rahmen (200 ms) im Eingang
SENDE_TIMEOUT_S = 1.0


class TonBruecke:
    def __init__(self, rtp: RtpSitzung, senden: Callable[[bytes], Awaitable[None]]) -> None:
        self._rtp = rtp
        self._senden = senden
        self.stumm = False
        self.rahmen_eingang = 0  # angenommene Rahmen vom Panel (Diagnose/Tests)
        self.rahmen_ausgang = 0  # an das Panel gesendete Rahmen
        self._puffer: deque[bytes] = deque(maxlen=PUFFER_MAX)
        self._task: asyncio.Task | None = None
        self._geschlossen = False

    @property
    def laeuft(self) -> bool:
        return self._task is not None and not self._task.done()

    def starten(self) -> None:
        """Startet den Takt (Aufruf, sobald der Anruf verbunden ist)."""
        if self._task is None and not self._geschlossen:
            self._task = asyncio.create_task(self._lauf())

    def eingang(self, pcm: bytes) -> None:
        """Ein Rahmen vom Panel; falsche Längen und Rahmen vor dem Start werden ignoriert."""
        if len(pcm) != RAHMEN_BYTES or not self.laeuft:
            return
        self._puffer.append(bytes(pcm))
        self.rahmen_eingang += 1

    async def _lauf(self) -> None:
        loop = asyncio.get_running_loop()
        start = loop.time()
        n = 0
        # Abbruchmarke zusätzlich zum Cancel: asyncio.wait_for (Python 3.11) kann einen Cancel verschlucken, wenn er genau
        # beim Abschluss des Sendens eintrifft; ohne Marke liefe der Takt dann weiter und schliessen() wartete ewig.
        while not self._geschlossen:
            n += 1
            verzug = start + n * TAKT - loop.time()
            if verzug > 0:
                await asyncio.sleep(verzug)
            elif verzug < -1.0:  # lange Pause (blockierte Schleife): neu aufsetzen statt aufholen
                start = loop.time() - n * TAKT
            if self._puffer:
                rahmen = self._puffer.popleft()
                self._rtp.senden(bytes(RAHMEN_BYTES) if self.stumm else rahmen)
            try:
                await asyncio.wait_for(self._senden(self._rtp.lesen()), SENDE_TIMEOUT_S)
                self.rahmen_ausgang += 1
            except asyncio.CancelledError:
                raise
            except Exception as err:
                _LOGGER.debug("Ton an das Panel nicht gesendet: %s", err)

    async def schliessen(self) -> None:
        """Beendet den Takt (idempotent)."""
        self._geschlossen = True
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._puffer.clear()


__all__ = ["TonBruecke"]
