"""Türdienst an der Haustür: Warteansage, Wartemelodie und Anrufbeantworter über die Ring Intercom.

Klingelt es (``intercom_ausloeser``, z. B. ``binary_sensor.haustur_klingelt_panel`` aus ring-mqtt), nimmt die App das
Gespräch selbst an. Sie ist dafür eine eigene WebRTC-Gegenstelle (aiortc) und baut die Sitzung über dieselbe
Integration auf wie das Panel (``pm_ring_intercom/audio/start``):

1. Ansage „Bitte warten Sie, Sie werden verbunden“ (Piper, Stimme Jarvis), danach die Wartemelodie „Abendglocke“
   in Schleife.
2. Nach ``pforte_ab_s`` Sekunden ohne Annahme, sofort, wenn niemand zu Hause ist: Anrufbeantworter. Ansage, Signalton,
   Aufnahme bis Stille oder ``pforte_max_s``. Die Aufnahme liegt als WAV unter ``/media/pm_panel_studio/haustuer``,
   die Spracherkennung von Home Assistant schreibt sie ab, die Abschrift geht per Push und als Meldung ans Panel.

Übernahme: Tippt jemand am Panel auf „Sprechen“, beendet die App ihre Sitzung sofort und das Panel verbindet sich.
Nimmt jemand den Anruf in der Ring-App an, beendet Ring die Sitzung der App; auch dann hört die App sofort auf.

aiortc und PyAV werden erst beim ersten Klingeln geladen, damit die App ohne sie startet (z. B. in Tests).
"""

from __future__ import annotations

import array
import asyncio
import contextlib
import fractions
import functools
import io
import logging
import math
import re
import time
import wave
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from .ha_client import HAClient, HAError

_LOGGER = logging.getLogger(__name__)

RATE = 16000  # Abtastrate innen (Sprechanlage ist ohnehin schmalbandig); der Opus-Kodierer rechnet selbst um
RAHMEN = 320  # 20 ms
AUFNAHME_DIR = Path("/media/pm_panel_studio/haustuer")
AUFNAHME_RESERVE = Path("/data/haustuer")
MAX_AUFNAHMEN = 60
INTERCOM_DOMAIN = "pm_ring_intercom"
STUN = "stun:stun.l.google.com:19302"


# ------------------------------------------------------------------ Klänge (reines Python, einmal berechnet)


def _note(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


NOTEN = {"D3": 50, "A4": 69, "B4": 71, "D5": 74, "E5": 76, "F#5": 78, "A5": 81, "B5": 83}


@functools.cache
def abendglocke(rate: int = RATE) -> bytes:
    """Wartemelodie Nr. 1 „Abendglocke“: weiche Glocken, D-Dur pentatonisch, 72 bpm, 16 Achtel (≈ 6,7 s).

    Der Nachklang am Ende wird an den Anfang gefaltet, damit die Schleife ohne Sprung läuft."""
    s = 60 / 72 / 2
    folge = ["D5", "F#5", "A5", "B5", "A5", "F#5", "E5", "D5", "A4", "B4", "D5", "E5", "F#5", "E5", "D5", None]
    noten: list[tuple[float, int, float]] = [(i * s, NOTEN[n], 0.17 if i % 4 == 0 else 0.12) for i, n in enumerate(folge) if n]
    noten += [(0.0, NOTEN["D3"], 0.08), (8 * s, NOTEN["D3"], 0.08)]
    laenge = int(len(folge) * s * rate)
    ausklang = 2.8
    puffer = [0.0] * (laenge + int(ausklang * rate) + 1)
    # Teiltöne einer weichen Glocke: (Faktor, Anteil, Abklingzeit)
    teile = ((1.0, 1.0, ausklang), (2.76, 0.32, 1.2), (5.4, 0.12, 0.5), (0.5, 0.18, ausklang))
    zwei_pi = 2 * math.pi
    for start, midi, pegel in noten:
        f = _note(midi)
        a = int(start * rate)
        n = int(ausklang * rate)
        k_ges = math.log(0.0001 / pegel) / ausklang
        for faktor, anteil, zerfall in teile:
            w = zwei_pi * f * faktor / rate
            k = math.log(0.0001) / zerfall
            for i in range(n):
                t = i / rate
                env = pegel * math.exp(k_ges * t) * (min(1.0, t / 0.006)) * anteil * math.exp(k * t)
                puffer[a + i] += env * math.sin(w * i)
    # Nachklang falten
    for i in range(laenge, len(puffer)):
        puffer[i - laenge] += puffer[i]
    puffer = puffer[:laenge]
    spitze = max(abs(x) for x in puffer) or 1.0
    return _pcm(puffer, 0.55 / spitze)


def signalton(rate: int = RATE, dauer: float = 0.45, f: float = 1000.0) -> bytes:
    n = int(dauer * rate)
    werte = [math.sin(2 * math.pi * f * i / rate) * min(1.0, i / 160, (n - i) / 160) for i in range(n)]
    return _pcm(werte, 0.45)


def stille(sek: float, rate: int = RATE) -> bytes:
    return bytes(2 * int(sek * rate))


def _pcm(werte: list[float], faktor: float) -> bytes:
    a = array.array("h", (max(-32767, min(32767, int(x * faktor * 32767))) for x in werte))
    return a.tobytes()


def pegel(pcm: bytes) -> float:
    """RMS eines Int16-Rahmens."""
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if not a:
        return 0.0
    return math.sqrt(sum(x * x for x in a) / len(a))


def normalisieren(pcm: bytes, ziel: float = 0.8) -> bytes:
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    spitze = max((abs(x) for x in a), default=0)
    if not spitze:
        return pcm
    f = ziel * 32767 / spitze
    return array.array("h", (max(-32767, min(32767, int(x * f))) for x in a)).tobytes()


def dekodieren(daten: bytes, rate: int = RATE) -> bytes:
    """Beliebige Tondatei (MP3, WAV …) → Int16 mono mit ``rate`` (PyAV)."""
    import av

    out = bytearray()
    with av.open(io.BytesIO(daten)) as c:
        r = av.AudioResampler(format="s16", layout="mono", rate=rate)
        for frame in c.decode(audio=0):
            for f in r.resample(frame):
                out += bytes(f.planes[0])[: f.samples * 2]
        for f in r.resample(None):
            out += bytes(f.planes[0])[: f.samples * 2]
    return bytes(out)


def wav(pcm: bytes, rate: int = RATE) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return b.getvalue()


# ------------------------------------------------------------------ Sprache erkennen (Anrufbeantworter)


class Stimmerkennung:
    """Erkennt Sprechen und Stille in 20-ms-Rahmen. Die Schwelle passt sich dem Grundrauschen der Leitung an."""

    def __init__(self, ende_nach_s: float = 3.0, nichts_nach_s: float = 8.0) -> None:
        self.ende_nach = ende_nach_s
        self.nichts_nach = nichts_nach_s
        self.boden: float | None = None
        self.gesprochen_s = 0.0
        self.still_s = 0.0
        self.zeit_s = 0.0

    def rahmen(self, rms: float, dauer: float = RAHMEN / RATE) -> None:
        self.zeit_s += dauer
        if self.boden is None:
            self.boden = rms
        schwelle = max(500.0, 3.0 * (self.boden or 0.0))
        if rms > schwelle:
            self.gesprochen_s += dauer
            self.still_s = 0.0
        else:
            self.still_s += dauer
            # Grundrauschen nur in Pausen nachführen
            self.boden = 0.95 * (self.boden or rms) + 0.05 * rms

    @property
    def hat_gesprochen(self) -> bool:
        return self.gesprochen_s >= 0.6

    @property
    def fertig(self) -> bool:
        if self.hat_gesprochen:
            return self.still_s >= self.ende_nach
        return self.zeit_s >= self.nichts_nach


# ------------------------------------------------------------------ WebRTC-Gegenstelle


def _spur_klasse() -> type:
    from aiortc.mediastreams import MediaStreamTrack

    class Spieler(MediaStreamTrack):
        """Ausgehender Ton: spielt Abschnitte nacheinander, danach optional eine Schleife, sonst Stille."""

        kind = "audio"

        def __init__(self) -> None:
            super().__init__()
            self._puffer = bytearray()
            self._schleife = b""
            self._pos = 0
            self._start: float | None = None
            self._pts = 0
            self.leer = asyncio.Event()
            self.leer.set()

        def spielen(self, pcm: bytes) -> None:
            self._puffer += pcm
            self.leer.clear()

        def schleife(self, pcm: bytes) -> None:
            self._schleife, self._pos = pcm, 0

        def leeren(self) -> None:
            self._puffer.clear()
            self._schleife = b""
            self.leer.set()

        def _naechster(self) -> bytes:
            n = RAHMEN * 2
            if self._puffer:
                teil = bytes(self._puffer[:n])
                del self._puffer[:n]
                if not self._puffer:
                    self.leer.set()
                return teil.ljust(n, b"\0")
            if self._schleife:
                teil = b""
                while len(teil) < n:
                    rest = self._schleife[self._pos : self._pos + n - len(teil)]
                    teil += rest
                    self._pos = (self._pos + len(rest)) % len(self._schleife)
                return teil
            return bytes(n)

        async def recv(self) -> Any:
            import av

            if self._start is None:
                self._start = time.monotonic()
            warten = self._start + self._pts / RATE - time.monotonic()
            if warten > 0:
                await asyncio.sleep(warten)
            frame = av.AudioFrame(format="s16", layout="mono", samples=RAHMEN)
            frame.planes[0].update(self._naechster())
            frame.sample_rate = RATE
            frame.pts = self._pts
            frame.time_base = fractions.Fraction(1, RATE)
            self._pts += RAHMEN
            return frame

    return Spieler


class Leitung:
    """Eine Live-Sitzung der App mit der Ring Intercom (aiortc ↔ pm_ring_intercom)."""

    def __init__(self, client: HAClient, stun: str | None = STUN) -> None:
        self.client = client
        self.stun = stun
        self.pc: Any = None
        self.spieler: Any = None
        self.sub: int | None = None
        self.sitzung: str | None = None
        self.verbunden = asyncio.Event()
        self.ende = asyncio.Event()
        self.grund = ""
        self._kandidaten: list[tuple[str, int]] = []
        self._aufnahme: bytearray | None = None
        self.stimme: Stimmerkennung | None = None
        self._leser: asyncio.Task | None = None

    async def aufbauen(self, frist: float = 10.0) -> None:
        from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection

        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=[RTCIceServer(urls=self.stun)] if self.stun else []))
        self.spieler = _spur_klasse()()
        self.pc.addTransceiver(self.spieler, direction="sendrecv")

        @self.pc.on("track")
        def _spur(track: Any) -> None:
            if track.kind == "audio":
                self._leser = asyncio.get_running_loop().create_task(self._lesen(track))

        @self.pc.on("connectionstatechange")
        async def _zustand() -> None:
            s = self.pc.connectionState if self.pc else "closed"
            if s == "connected":
                self.verbunden.set()
            elif s in ("failed", "closed"):
                self._beendet(f"Verbindung {s}")

        angebot = await self.pc.createOffer()
        await self.pc.setLocalDescription(angebot)  # sammelt alle eigenen Kandidaten ins Angebot
        self.sub = await self.client.subscribe(
            {"type": f"{INTERCOM_DOMAIN}/audio/start", "offer": self.pc.localDescription.sdp}, self._signal
        )
        try:
            await asyncio.wait_for(self._warten_verbunden(), frist)
        except TimeoutError:
            await self.schliessen()
            raise HAError("Haustür: keine Verbindung innerhalb der Frist") from None

    async def _warten_verbunden(self) -> None:
        verbunden = asyncio.ensure_future(self.verbunden.wait())
        ende = asyncio.ensure_future(self.ende.wait())
        await asyncio.wait({verbunden, ende}, return_when=asyncio.FIRST_COMPLETED)
        for t in (verbunden, ende):
            t.cancel()
        if self.ende.is_set():
            raise HAError(f"Haustür: {self.grund or 'Sitzung abgelehnt'}")

    def _signal(self, ev: dict[str, Any]) -> None:
        art = ev.get("type")
        if art == "session":
            self.sitzung = ev.get("session_id")
        elif art == "answer":
            asyncio.get_running_loop().create_task(self._antwort(str(ev.get("answer") or "")))
        elif art == "candidate":
            c = ev.get("candidate") or {}
            asyncio.get_running_loop().create_task(
                self._kandidat(str(c.get("candidate") or ""), int(c.get("sdpMLineIndex") or 0))
            )
        elif art in ("error", "closed"):
            self._beendet(str(ev.get("message") or ev.get("code") or art))

    async def _antwort(self, sdp: str) -> None:
        from aiortc import RTCSessionDescription

        try:
            await self.pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="answer"))
            for c, i in self._kandidaten:
                await self._kandidat(c, i)
            self._kandidaten.clear()
        except Exception as err:
            _LOGGER.warning("Haustür: Antwort von Ring nicht verwendbar: %s", err)
            self._beendet("Antwort unbrauchbar")

    async def _kandidat(self, text: str, index: int) -> None:
        from aiortc.sdp import candidate_from_sdp

        if not text:
            return
        if self.pc is None or self.pc.remoteDescription is None:
            self._kandidaten.append((text, index))
            return
        with contextlib.suppress(Exception):
            c = candidate_from_sdp(text.split(":", 1)[1] if text.startswith("candidate:") else text)
            c.sdpMLineIndex = index
            c.sdpMid = self.pc.getTransceivers()[0].mid if self.pc.getTransceivers() else "0"
            await self.pc.addIceCandidate(c)

    def _beendet(self, grund: str) -> None:
        if not self.ende.is_set():
            self.grund = grund
            self.ende.set()

    async def _lesen(self, track: Any) -> None:
        import av
        from aiortc.mediastreams import MediaStreamError

        r = av.AudioResampler(format="s16", layout="mono", rate=RATE)
        rest = b""
        while True:
            try:
                frame = await track.recv()
            except MediaStreamError:
                return
            for f in r.resample(frame):
                pcm = rest + bytes(f.planes[0])[: f.samples * 2]
                n = len(pcm) - len(pcm) % (RAHMEN * 2)
                rest = pcm[n:]
                for i in range(0, n, RAHMEN * 2):
                    teil = pcm[i : i + RAHMEN * 2]
                    if self._aufnahme is not None:
                        self._aufnahme += teil
                        if self.stimme is not None:
                            self.stimme.rahmen(pegel(teil))

    def aufnahme_starten(self, stimme: Stimmerkennung) -> None:
        self._aufnahme = bytearray()
        self.stimme = stimme

    def aufnahme(self) -> bytes:
        return bytes(self._aufnahme or b"")

    async def schliessen(self) -> None:
        self._beendet("geschlossen")
        sub, self.sub = self.sub, None
        if sub is not None:
            await self.client.unsubscribe(sub)
        if self.spieler is not None:
            self.spieler.leeren()
        if self._leser is not None:
            self._leser.cancel()
        if self.pc is not None:
            with contextlib.suppress(Exception):
                await self.pc.close()


# ------------------------------------------------------------------ Ablauf


class Pforte:
    """Türdienst. ``einst`` liefert die aktuellen Einstellungen, ``anwesend`` ob jemand zu Hause ist."""

    def __init__(
        self,
        client: HAClient,
        einst: Callable[[], Any],
        anwesend: Callable[[], bool],
        tts: Callable[[str], Awaitable[bytes]],
        melden: Callable[[dict[str, Any]], Awaitable[None]],
        meldung: Callable[[str, str], None],
        jetzt: Callable[[], datetime],
    ) -> None:
        self.client = client
        self.einst = einst
        self.anwesend = anwesend
        self.tts = tts
        self.melden = melden
        self.meldung = meldung
        self.jetzt = jetzt
        self.leitung: Leitung | None = None
        self._task: asyncio.Task | None = None
        self._klaenge: dict[str, bytes] = {}
        self.uebernommen = False
        self.verzeichnis = AUFNAHME_DIR
        self.stun: str | None = STUN

    @property
    def laeuft(self) -> bool:
        return self._task is not None and not self._task.done()

    async def vorbereiten(self) -> None:
        """Melodie und Ansagen vorab erzeugen, damit nach dem Klingeln nichts gerechnet werden muss."""
        loop = asyncio.get_running_loop()
        if "melodie" not in self._klaenge:
            self._klaenge["melodie"] = await loop.run_in_executor(None, abendglocke)
            self._klaenge["signal"] = signalton()
        e = self.einst()
        for text in (e.pforte_warte_text, e.pforte_ab_text):
            with contextlib.suppress(Exception):
                await self._ansage(text)

    async def _ansage(self, text: str) -> bytes:
        schluessel = "tts:" + text
        if schluessel not in self._klaenge:
            daten = await self.tts(text)
            pcm = await asyncio.get_running_loop().run_in_executor(None, dekodieren, daten)
            self._klaenge[schluessel] = normalisieren(pcm, 0.8)
        return self._klaenge[schluessel]

    def klingeln(self) -> None:
        e = self.einst()
        if not e.pforte_aktiv or self.laeuft:
            return
        self.uebernommen = False
        self._task = asyncio.get_running_loop().create_task(self._ablauf())

    async def uebergeben(self, grund: str = "Panel übernimmt das Gespräch") -> None:
        """Panel übernimmt („Sprechen“) oder die Haustür wurde geöffnet: eigene Sitzung sofort beenden."""
        if not self.laeuft:
            return
        self.uebernommen = True
        _LOGGER.info("Haustür: %s", grund)
        task = self._task
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        await asyncio.sleep(0.3)  # Ring die alte Sitzung abbauen lassen

    async def _ablauf(self) -> None:
        e = self.einst()
        beginn = time.monotonic()
        leitung = self.leitung = Leitung(self.client, self.stun)
        aufnahme = b""
        ab = False
        try:
            await self.melden({"phase": "verbinden"})
            warte = await self._ansage(e.pforte_warte_text)
            if "melodie" not in self._klaenge:
                await self.vorbereiten()
            await leitung.aufbauen()
            _LOGGER.info("Haustür: Gespräch angenommen, Warteansage läuft")
            leitung.spieler.spielen(stille(0.4) + warte + stille(0.6))
            leitung.spieler.schleife(self._klaenge["melodie"])
            await self.melden({"phase": "warten"})
            # Niemand zu Hause: Anrufbeantworter gleich nach der Warteansage
            frist = max(0.0, e.pforte_ab_s - (time.monotonic() - beginn)) if self.anwesend() else len(warte) / 2 / RATE + 1.0
            if await self._warten(leitung, frist):
                return self._uebernommen_durch_ring(leitung)
            # Anrufbeantworter
            ab = True
            leitung.spieler.leeren()
            text = await self._ansage(e.pforte_ab_text)
            leitung.spieler.spielen(stille(0.3) + text + stille(0.3) + self._klaenge["signal"])
            await self.melden({"phase": "anrufbeantworter"})
            await self._spielen_bis_leer(leitung)
            if leitung.ende.is_set():
                return self._uebernommen_durch_ring(leitung)
            stimme = Stimmerkennung()
            leitung.aufnahme_starten(stimme)
            await self.melden({"phase": "aufnahme"})
            ende = time.monotonic() + e.pforte_max_s
            while time.monotonic() < ende and not stimme.fertig and not leitung.ende.is_set():  # noqa: ASYNC110
                await asyncio.sleep(0.1)
            aufnahme = leitung.aufnahme()
            if leitung.ende.is_set() and not stimme.hat_gesprochen:
                return self._uebernommen_durch_ring(leitung)
            await leitung.schliessen()
            await self.melden({"phase": "auswerten"})
            await self._auswerten(aufnahme if stimme.hat_gesprochen else b"")
        except asyncio.CancelledError:
            # Panel übernimmt: eine schon begonnene Nachricht trotzdem auswerten
            aufnahme = leitung.aufnahme()
            if ab and aufnahme and pegel(aufnahme) > 0:
                asyncio.get_running_loop().create_task(self._auswerten(aufnahme))
            raise
        except HAError as err:
            _LOGGER.warning("Haustür: %s", err)
        except Exception:
            _LOGGER.exception("Haustür: Türdienst abgebrochen")
        finally:
            await leitung.schliessen()
            self.leitung = None
            with contextlib.suppress(Exception):
                await self.melden({"phase": "ende", "uebernommen": self.uebernommen})

    async def _warten(self, leitung: Leitung, sek: float) -> bool:
        """Wartet ``sek`` Sekunden; True, wenn Ring die Sitzung vorher beendet (Ring-App hat angenommen)."""
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(leitung.ende.wait(), sek)
            return True
        return False

    async def _spielen_bis_leer(self, leitung: Leitung) -> None:
        leer = asyncio.ensure_future(leitung.spieler.leer.wait())
        ende = asyncio.ensure_future(leitung.ende.wait())
        await asyncio.wait({leer, ende}, timeout=30, return_when=asyncio.FIRST_COMPLETED)
        leer.cancel()
        ende.cancel()

    def _uebernommen_durch_ring(self, leitung: Leitung) -> None:
        self.uebernommen = True
        _LOGGER.info("Haustür: Ring hat die Sitzung beendet (%s) – vermutlich in der Ring-App angenommen", leitung.grund)

    # ------------------------------------------------------------ Nachricht auswerten

    async def _auswerten(self, aufnahme: bytes) -> None:
        e = self.einst()
        zeit = self.jetzt()
        uhr = zeit.strftime("%H:%M")
        datei: str | None = None
        text = ""
        if aufnahme:
            daten = wav(aufnahme)
            datei = self._speichern(daten, zeit)
            text = await self._abschrift(daten, e.pforte_stt)
        dauer = round(len(aufnahme) / 2 / RATE)
        if aufnahme:
            titel = "Nachricht an der Haustür"
            nachricht = f"{uhr} Uhr: „{text}“" if text else f"{uhr} Uhr: Nachricht ({dauer} s), Abschrift nicht möglich."
        else:
            titel = "Klingeln an der Haustür"
            nachricht = f"{uhr} Uhr: Es hat geklingelt, eine Nachricht wurde nicht hinterlassen."
        _LOGGER.info("Haustür: %s (%s)", titel, f"{dauer} s" if aufnahme else "ohne Nachricht")
        for dienst in e.pforte_push:
            domain, service = dienst.split(".", 1)
            with contextlib.suppress(HAError):
                await self.client.call_service(
                    domain, service, {"title": titel, "message": nachricht, "data": {"group": "haustuer"}}
                )
        self.meldung(titel, nachricht)
        with contextlib.suppress(HAError):
            await self.client.rest(
                "POST",
                "events/pm_panel_studio_haustuer",
                json={"text": text, "datei": datei, "dauer_s": dauer, "nachricht": bool(aufnahme)},
            )

    def _speichern(self, daten: bytes, zeit: datetime) -> str | None:
        for ordner in (self.verzeichnis, AUFNAHME_RESERVE):
            try:
                ordner.mkdir(parents=True, exist_ok=True)
                pfad = ordner / f"{zeit:%Y-%m-%d_%H-%M-%S}.wav"
                pfad.write_bytes(daten)
                alte = sorted(ordner.glob("*.wav"))
                for p in alte[:-MAX_AUFNAHMEN]:
                    p.unlink(missing_ok=True)
                return str(pfad)
            except OSError as err:
                _LOGGER.warning("Haustür: Aufnahme nicht in %s gespeichert: %s", ordner, err)
        return None

    async def _abschrift(self, daten: bytes, engine: str) -> str:
        try:
            res = await self.client.rest_post_bytes(
                f"stt/{engine}",
                daten,
                {
                    "X-Speech-Content": f"format=wav; codec=pcm; sample_rate={RATE}; bit_rate=16; channel=1; language=de-DE",
                    "Content-Type": "audio/wav",
                },
                timeout=60,
            )
        except HAError as err:
            _LOGGER.warning("Haustür: Abschrift fehlgeschlagen: %s", err)
            return ""
        if isinstance(res, dict) and res.get("result") == "success":
            return str(res.get("text") or "").strip()
        return ""


NOTIFY_RE = re.compile(r"^notify\.[a-z0-9_]+$")
STT_RE = re.compile(r"^stt\.[a-z0-9_]+$")
