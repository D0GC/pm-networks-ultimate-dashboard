"""Türdienst an der Haustür: Warteansage, Wartemelodie und Anrufbeantworter über die Ring Intercom.

Klingelt es (``intercom_ausloeser``, z. B. ``binary_sensor.haustur_klingelt_panel`` aus ring-mqtt), nimmt die App das
Gespräch selbst an. Sie ist dafür eine eigene WebRTC-Gegenstelle (aiortc) und baut die Sitzung über dieselbe
Integration auf wie das Panel (``pm_ring_intercom/audio/start``):

1. Ansage „Bitte warten Sie, Sie werden verbunden“ (Piper, Stimme Jarvis), danach die Wartemelodie „Abendglocke“
   in Schleife.
2. Nach ``pforte_ab_s`` Sekunden ohne Annahme, sofort, wenn niemand zu Hause ist: Anrufbeantworter. Ansage, Signalton,
   Aufnahme bis Stille oder ``pforte_max_s``. Die Aufnahme liegt als WAV in ``pforte_ordner``
   (Vorgabe ``/media/Fileshare_Media/Haustüraufnahme`` auf dem Netzlaufwerk),
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
import json
import logging
import math
import random
import re
import shutil
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
# Bisheriger Ort auf der lokalen Platte; bleibt Ausweichziel, wenn das Netzlaufwerk nicht eingehängt ist
AUFNAHME_LOKAL = Path("/media/pm_panel_studio/haustuer")
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


# ------------------------------------------------------------------ Ansagen: förmlich, Gruß nach Tageszeit

# Modern und förmlich: Gruß nach Tageszeit, dazu eine Warteformel. Nicht verwendet: „Grüß Gott“ (zu altmodisch),
# „Servus“ (vertraulich), „Mahlzeit“ (unter Kollegen), „Gute Nacht“ (Abschied).
GRUESSE = {
    "morgen": ("Guten Morgen.", "Einen schönen guten Morgen."),
    "mittag": ("Guten Tag.", "Einen schönen guten Tag.", "Guten Tag und herzlich willkommen."),
    "nachmittag": ("Guten Tag.", "Einen schönen guten Tag.", "Guten Tag und herzlich willkommen."),
    "abend": ("Guten Abend.", "Einen schönen guten Abend.", "Guten Abend und herzlich willkommen."),
    "nacht": ("Guten Abend.",),
}
# Das Haus spricht als sein Angestellter: höflich, zurückhaltend, ohne Namen der Bewohner an der Tür
WARTE = (
    "Einen Moment bitte, Sie werden gleich verbunden.",
    "Bitte haben Sie einen Moment Geduld, ich verbinde Sie.",
    "Vielen Dank für Ihr Klingeln. Einen Moment bitte, ich verbinde Sie.",
    "Einen Moment bitte, ich melde Sie im Haus an.",
    "Bitte warten Sie einen Moment, Sie werden verbunden.",
)
WARTE_NACHT = (
    "Um diese Uhrzeit bitte ich um einen Moment Geduld, ich verbinde Sie.",
    "Einen Moment bitte, ich melde Sie im Haus an.",
)
AB = (
    "Leider ist gerade niemand erreichbar. Bitte hinterlassen Sie nach dem Signalton eine Nachricht, ich gebe sie "
    "umgehend weiter.",
)


def tageszeit(stunde: int) -> str:
    """Morgen 5–10, Mittag 11–13, Nachmittag 14–17, Abend 18–21, Nacht 22–4 Uhr."""
    if 5 <= stunde < 11:
        return "morgen"
    if 11 <= stunde < 14:
        return "mittag"
    if 14 <= stunde < 18:
        return "nachmittag"
    if 18 <= stunde < 22:
        return "abend"
    return "nacht"


def waehlen(texte: tuple[str, ...], zuletzt: str | None) -> str:
    """Zufällig, aber nicht zweimal hintereinander dasselbe."""
    auswahl = [t for t in texte if t != zuletzt] or list(texte)
    return random.choice(auswahl)


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
        # Zeitpunkte zur Diagnose: Verbindung, erster Tonrahmen von Ring, erster hörbarer Rahmen (Leitung an der Tür offen)
        self.t_verbunden: float | None = None
        self.t_erster_rahmen: float | None = None
        self.t_erster_ton: float | None = None

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
                self.t_verbunden = time.monotonic()
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
                    if self.t_erster_rahmen is None:
                        self.t_erster_rahmen = time.monotonic()
                    if self.t_erster_ton is None and pegel(teil) > 300:
                        self.t_erster_ton = time.monotonic()
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


# ------------------------------------------------------------ Ablage
# <Ordner>/<Tag>/wav/<Tag>_<Uhrzeit>.wav und <Ordner>/<Tag>/json/<Tag>_<Uhrzeit>.json; Dateien aus Versionen bis
# 2026.10.39 liegen flach in <Ordner> und werden beim Start einsortiert.


def _wav_pfad(ordner: Path, name: str) -> Path:
    return ordner / name[:10] / "wav" / name


def _json_pfad(wav_pfad: Path) -> Path:
    if wav_pfad.parent.name == "wav":
        return wav_pfad.parent.parent / "json" / f"{wav_pfad.stem}.json"
    return wav_pfad.with_suffix(".json")


def _alle(ordner: Path) -> list[Path]:
    """Alle Aufnahmen eines Ordners, älteste zuerst (Tagesordner und flach abgelegte)."""
    dateien = [*ordner.glob("*/wav/*.wav"), *ordner.glob("*.wav")]
    return sorted((p for p in dateien if DATEI_RE.match(p.name)), key=lambda p: p.name)


def _aufraeumen(ordner: Path) -> None:
    """Leere ``wav``/``json``- und Tagesordner entfernen."""
    if ordner.name in ("wav", "json"):
        for leer in (ordner.parent / "wav", ordner.parent / "json", ordner.parent):
            with contextlib.suppress(OSError):
                leer.rmdir()


def _loeschen(wav_pfad: Path) -> None:
    wav_pfad.unlink(missing_ok=True)
    _json_pfad(wav_pfad).unlink(missing_ok=True)
    _aufraeumen(wav_pfad.parent)


class Pforte:
    """Türdienst. ``einst`` liefert die aktuellen Einstellungen, ``anwesend`` ob jemand zu Hause ist."""

    def __init__(
        self,
        client: HAClient,
        einst: Callable[[], Any],
        anwesend: Callable[[], bool],
        tts: Callable[[str], Awaitable[bytes]],
        melden: Callable[[dict[str, Any]], Awaitable[None]],
        meldung: Callable[[str, str, str | None], None],
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
        self._zuletzt: dict[str, str] = {}
        self.uebernommen = False
        self.verzeichnis: Path | None = None  # fest gesetzt nur in Tests; sonst aus pforte_ordner
        # Ausgang des Klingelns fürs Klingelbuch (Hub): ``ausgang("app" | "panel" | "nachricht" | "ohne", **daten)``
        self.ausgang: Callable[..., None] | None = None
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
        texte = [e.pforte_warte_text, e.pforte_ab_text] if e.pforte_warte_text or e.pforte_ab_text else []
        if not e.pforte_warte_text:
            texte += [g for gs in GRUESSE.values() for g in gs] + list(WARTE) + list(WARTE_NACHT)
        if not e.pforte_ab_text:
            texte += list(AB)
        with contextlib.suppress(Exception):
            await asyncio.to_thread(self.umziehen)
        for text in dict.fromkeys(t for t in texte if t):
            with contextlib.suppress(Exception):
                await self._ansage(text)

    async def _ansage(self, text: str) -> bytes:
        schluessel = "tts:" + text
        if schluessel not in self._klaenge:
            daten = await self.tts(text)
            pcm = await asyncio.get_running_loop().run_in_executor(None, dekodieren, daten)
            self._klaenge[schluessel] = normalisieren(pcm, 0.8)
        return self._klaenge[schluessel]

    def _wahl(self, art: str, texte: tuple[str, ...]) -> str:
        text = waehlen(texte, self._zuletzt.get(art))
        self._zuletzt[art] = text
        return text

    async def _warteansage(self, e: Any) -> bytes:
        """Eigener Text aus den Einstellungen, sonst Gruß nach Tageszeit und eine der Warteformeln."""
        if e.pforte_warte_text:
            return await self._ansage(e.pforte_warte_text)
        zeit = tageszeit(self.jetzt().hour)
        gruss = await self._ansage(self._wahl("gruss", GRUESSE[zeit]))
        satz = await self._ansage(self._wahl("warte", WARTE_NACHT if zeit == "nacht" else WARTE))
        return gruss + stille(0.25) + satz

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
        self._ausgang("panel")
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
            warte = await self._warteansage(e)
            if "melodie" not in self._klaenge:
                await self.vorbereiten()
            await leitung.aufbauen()
            # Vorlauf: Ring schaltet die Sprechleitung an der Tür erst einige Sekunden nach dem Verbindungsaufbau
            # durch (Test 21.10.: rund 2,5 s); vorher Gesprochenes hört niemand. Bis dahin läuft Stille.
            vorlauf = float(getattr(e, "pforte_vorlauf_s", 3))
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(leitung.ende.wait(), max(0.0, vorlauf - (time.monotonic() - (leitung.t_verbunden or 0))))
            if leitung.ende.is_set():
                return self._uebernommen_durch_ring(leitung)
            _LOGGER.info("Haustür: Gespräch angenommen, Warteansage läuft (%s)", self._zeiten(leitung, beginn))
            leitung.spieler.spielen(warte + stille(0.6))
            leitung.spieler.schleife(self._klaenge["melodie"])
            await self.melden({"phase": "warten"})
            # Niemand zu Hause: Anrufbeantworter gleich nach der Warteansage
            frist = max(0.0, e.pforte_ab_s - (time.monotonic() - beginn)) if self.anwesend() else len(warte) / 2 / RATE + 1.0
            if await self._warten(leitung, frist):
                return self._uebernommen_durch_ring(leitung)
            # Anrufbeantworter
            ab = True
            leitung.spieler.leeren()
            text = await self._ansage(e.pforte_ab_text or self._wahl("ab", AB))
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

    @staticmethod
    def _zeiten(leitung: Leitung, beginn: float) -> str:
        """Diagnose: Sekunden ab Klingeln bis Verbindung, erstem Rahmen und erstem hörbaren Ton von der Tür."""

        def ab(t: float | None) -> str:
            return f"{t - beginn:.1f} s" if t else "–"

        return (
            f"verbunden {ab(leitung.t_verbunden)}, erster Rahmen {ab(leitung.t_erster_rahmen)}, "
            f"erster Ton {ab(leitung.t_erster_ton)}, Ansage {ab(time.monotonic())}"
        )

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

    def _ausgang(self, art: str, **daten: Any) -> None:
        if self.ausgang is not None:
            with contextlib.suppress(Exception):
                self.ausgang(art, **daten)

    def _uebernommen_durch_ring(self, leitung: Leitung) -> None:
        self.uebernommen = True
        self._ausgang("app")
        _LOGGER.info("Haustür: Ring hat die Sitzung beendet (%s) – vermutlich in der Ring-App angenommen", leitung.grund)

    # ------------------------------------------------------------ Nachricht auswerten

    async def _auswerten(self, aufnahme: bytes) -> None:
        e = self.einst()
        zeit = self.jetzt()
        uhr = zeit.strftime("%H:%M")
        datei: str | None = None
        text = ""
        dauer = round(len(aufnahme) / 2 / RATE)
        if aufnahme:
            daten = wav(aufnahme)
            datei = self._speichern(daten, zeit)
            text = await self._abschrift(daten, e.pforte_stt)
            if datei:
                # Begleitdatei für die Liste am Panel (Zeit, Länge, Abschrift)
                with contextlib.suppress(OSError):
                    begleit = _json_pfad(Path(datei))
                    begleit.parent.mkdir(parents=True, exist_ok=True)
                    begleit.write_text(
                        json.dumps({"zeit": zeit.isoformat(), "dauer_s": dauer, "text": text}, ensure_ascii=False),
                        encoding="utf-8",
                    )
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
        self.meldung(titel, nachricht, Path(datei).name if datei else None)
        if aufnahme:
            self._ausgang("nachricht", datei=Path(datei).name if datei else None, dauer_s=dauer, text=text)
        else:
            self._ausgang("ohne")
        with contextlib.suppress(HAError):
            await self.client.rest(
                "POST",
                "events/pm_panel_studio_haustuer",
                json={"text": text, "datei": datei, "dauer_s": dauer, "nachricht": bool(aufnahme)},
            )

    def _speichern(self, daten: bytes, zeit: datetime) -> str | None:
        ziele = self._ziele()
        if self.verzeichnis is None and ziele[0] == AUFNAHME_LOKAL and self.einst().pforte_ordner:
            _LOGGER.warning("Haustür: %s nicht erreichbar, Aufnahme bleibt lokal", Path(self.einst().pforte_ordner).parent)
        for ordner in ziele:
            try:
                pfad = _wav_pfad(ordner, f"{zeit:%Y-%m-%d_%H-%M-%S}.wav")
                pfad.parent.mkdir(parents=True, exist_ok=True)
                pfad.write_bytes(daten)
                for p in _alle(ordner)[:-MAX_AUFNAHMEN]:
                    _loeschen(p)
                return str(pfad)
            except OSError as err:
                _LOGGER.warning("Haustür: Aufnahme nicht in %s gespeichert: %s", ordner, err)
        return None

    # ------------------------------------------------------------ Aufnahmen am Panel

    def _ziele(self) -> list[Path]:
        """Speicherorte in Reihenfolge: Netzlaufwerk, lokal, App-Daten.

        Der Ordner auf dem Netzlaufwerk wird nur angelegt, wenn dessen Freigabe selbst da ist (z. B.
        ``/media/Fileshare_Media``); sonst landete die Aufnahme unbemerkt auf der lokalen Platte unter dem Einhängepunkt.
        """
        if self.verzeichnis is not None:
            return [self.verzeichnis, AUFNAHME_RESERVE]
        haupt = Path(getattr(self.einst(), "pforte_ordner", "") or AUFNAHME_LOKAL)
        ziele = [haupt] if haupt.parent.is_dir() else []
        return [*dict.fromkeys([*ziele, AUFNAHME_LOKAL, AUFNAHME_RESERVE])]

    def _ordner(self) -> list[Path]:
        return [o for o in self._ziele() if o.is_dir()]

    def umziehen(self) -> int:
        """Aufnahmen in die Ablage nach Tagen bringen (``2026-10-21/wav``, ``2026-10-21/json``).

        Zieht ältere Aufnahmen aus den lokalen Ordnern auf das Netzlaufwerk (entlastet die lokale Platte) und sortiert
        flach abgelegte Dateien aus früheren Versionen ein.
        """
        ziel = self._ziele()[0]
        quellen = [ziel] if ziel in (AUFNAHME_LOKAL, AUFNAHME_RESERVE) else [AUFNAHME_LOKAL, AUFNAHME_RESERVE, ziel]
        n = 0
        for alt in quellen:
            if not alt.is_dir():
                continue
            for p in _alle(alt):
                neu = _wav_pfad(ziel, p.name)
                if p == neu:
                    continue
                try:
                    for q, z in ((p, neu), (_json_pfad(p), _json_pfad(neu))):
                        if q.is_file():
                            z.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copyfile(q, z)
                            q.unlink()
                    _aufraeumen(p.parent)
                    n += 1
                except OSError as err:
                    _LOGGER.warning("Haustür: Umzug von %s nach %s gescheitert: %s", p.name, ziel, err)
                    return n
        if n:
            _LOGGER.info("Haustür: %d Aufnahmen nach %s einsortiert", n, ziel)
        return n

    def aufnahmen(self, anzahl: int = 10) -> list[dict[str, Any]]:
        """Die neuesten Nachrichten: Dateiname, Zeit, Länge und Abschrift."""
        dateien = sorted((p for o in self._ordner() for p in _alle(o)), key=lambda p: p.name, reverse=True)
        out = []
        for p in dateien[:anzahl]:
            info: dict[str, Any] = {}
            with contextlib.suppress(OSError, ValueError):
                info = json.loads(_json_pfad(p).read_text(encoding="utf-8"))
            if not info.get("dauer_s"):
                with contextlib.suppress(OSError, EOFError, wave.Error), wave.open(str(p)) as w:
                    info["dauer_s"] = round(w.getnframes() / w.getframerate())
            zeit = info.get("zeit")
            if not zeit:
                with contextlib.suppress(ValueError):
                    zeit = datetime.strptime(p.stem, "%Y-%m-%d_%H-%M-%S").isoformat()
            out.append({"datei": p.name, "zeit": zeit, "dauer_s": info.get("dauer_s"), "text": info.get("text") or ""})
        return out

    def aufnahme_pfad(self, name: str) -> Path | None:
        """Pfad einer Aufnahme; nur Dateinamen, wie sie der Türdienst selbst vergibt."""
        if not DATEI_RE.match(name or ""):
            return None
        for o in self._ordner():
            for p in (_wav_pfad(o, name), o / name):
                if p.is_file():
                    return p
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


DATEI_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.wav$")
NOTIFY_RE = re.compile(r"^notify\.[a-z0-9_]+$")
STT_RE = re.compile(r"^stt\.[a-z0-9_]+$")
