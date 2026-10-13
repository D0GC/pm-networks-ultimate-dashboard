"""WebRTC-Brücke: Browser (Opus über WebRTC) ↔ RTP-Strecke zur FRITZ!Box (G.711).

Pro Anruf gibt es eine ``RTCPeerConnection`` (aiortc) ohne ICE-Server. Der Browser schickt ein vollständiges
Angebot (kein Trickle-ICE), die Antwort wird nach dem Sammeln der Kandidaten zurückgegeben.

Browser → Telefon: eingehende Audio-Frames (meist 48 kHz) werden mit ``av.AudioResampler`` auf 8 kHz mono s16
gebracht, in 20-ms-Blöcke (160 Samples) zerlegt und über ``RtpSitzung.senden`` als G.711 verschickt.
Telefon → Browser: ``RtpSitzung.lesen`` liefert alle 20 ms genau einen Block PCM, den ``_AusgangsSpur`` als
``av.AudioFrame`` an aiortc übergibt (Stille, wenn nichts ankommt). aiortc resampelt für Opus selbst.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from fractions import Fraction

import av
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamError, MediaStreamTrack

from . import g711
from .rtp import RtpSitzung

_LOGGER = logging.getLogger(__name__)

TAKT = 0.02  # 20 ms je Rahmen
BLOCK = g711.RAHMEN_SAMPLES  # 160 Samples @ 8 kHz


class _AusgangsSpur(MediaStreamTrack):
    """Liefert das Telefon-Audio (8 kHz mono s16) im 20-ms-Takt an aiortc."""

    kind = "audio"

    def __init__(self, rtp: RtpSitzung) -> None:
        super().__init__()
        self._rtp = rtp
        self._start: float | None = None
        self._zaehler = 0

    async def recv(self) -> av.AudioFrame:
        if self.readyState != "live":
            raise MediaStreamError
        loop = asyncio.get_running_loop()
        if self._start is None:
            self._start = loop.time()
        # Absolute Zeitplanung: kein Auseinanderlaufen durch Verarbeitungszeit
        ziel = self._start + self._zaehler * TAKT
        verzug = ziel - loop.time()
        if verzug > 0:
            await asyncio.sleep(verzug)
        elif verzug < -1.0:  # lange Pause (z. B. blockierte Schleife): neu aufsetzen statt aufholen
            self._start = loop.time() - self._zaehler * TAKT
        frame = av.AudioFrame(format="s16", layout="mono", samples=BLOCK)
        frame.sample_rate = g711.RATE
        frame.pts = self._zaehler * BLOCK
        frame.time_base = Fraction(1, g711.RATE)
        frame.planes[0].update(self._rtp.lesen())
        self._zaehler += 1
        return frame


class Bruecke:
    """Eine WebRTC-Verbindung zum Browser, gekoppelt an eine ``RtpSitzung``."""

    def __init__(self, rtp: RtpSitzung, bei_abbruch: Callable[[], None] | None = None) -> None:
        self._rtp = rtp
        self._bei_abbruch = bei_abbruch
        self.stumm = False
        self.rahmen_empfangen = 0  # Audio-Frames vom Browser (Diagnose/Tests)
        self._pc: RTCPeerConnection | None = None
        self._aus: _AusgangsSpur | None = None
        self._tasks: set[asyncio.Task] = set()
        self._geschlossen = False

    # ------------------------------------------------------------------ Aushandlung

    async def antworten(self, angebot: str) -> str:
        """Nimmt das (vollständige) SDP-Angebot des Browsers an und liefert die SDP-Antwort."""
        if self._pc is not None:
            raise RuntimeError("Brücke ist bereits aufgebaut")
        pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        self._pc = pc

        @pc.on("track")
        def _spur(track: MediaStreamTrack) -> None:
            if track.kind == "audio":
                self._starte(self._eingang(track))

        @pc.on("connectionstatechange")
        def _zustand() -> None:
            _LOGGER.debug("WebRTC-Zustand: %s", pc.connectionState)
            if pc.connectionState in ("failed", "closed") and not self._geschlossen and self._bei_abbruch:
                try:
                    self._bei_abbruch()
                except Exception:
                    _LOGGER.exception("WebRTC: Abbruch-Rückruf fehlgeschlagen")

        try:
            await pc.setRemoteDescription(RTCSessionDescription(sdp=angebot, type="offer"))
            audio = [t for t in pc.getTransceivers() if t.kind == "audio"]
            if not audio:
                raise ValueError("Das Angebot enthält kein Audio")
            self._aus = _AusgangsSpur(self._rtp)
            pc.addTrack(self._aus)
            await pc.setLocalDescription(await pc.createAnswer())  # wartet, bis alle Kandidaten gesammelt sind
        except BaseException:
            await self.schliessen()
            raise
        return pc.localDescription.sdp

    # ------------------------------------------------------------------ Audio

    def _starte(self, coro) -> None:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def _eingang(self, track: MediaStreamTrack) -> None:
        """Browser-Audio → 8 kHz mono → 20-ms-Blöcke → RTP."""
        resampler = av.AudioResampler(format="s16", layout="mono", rate=g711.RATE)
        rest = bytearray()
        try:
            while True:
                frame = await track.recv()
                self.rahmen_empfangen += 1
                for r in resampler.resample(frame):
                    rest += bytes(r.planes[0])[: r.samples * 2]
                while len(rest) >= g711.RAHMEN_BYTES:
                    block = bytes(rest[: g711.RAHMEN_BYTES])
                    del rest[: g711.RAHMEN_BYTES]
                    self._rtp.senden(bytes(g711.RAHMEN_BYTES) if self.stumm else block)
        except MediaStreamError:
            pass  # Spur beendet
        except asyncio.CancelledError:
            raise
        except Exception:
            _LOGGER.exception("WebRTC: Fehler im Audio-Eingang")

    # ------------------------------------------------------------------ Ende

    async def schliessen(self) -> None:
        """Beendet Verbindung und Hintergrundaufgaben (idempotent)."""
        self._geschlossen = True
        tasks = list(self._tasks)
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if self._aus is not None:
            self._aus.stop()
        pc, self._pc = self._pc, None
        if pc is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(pc.close(), timeout=5)
