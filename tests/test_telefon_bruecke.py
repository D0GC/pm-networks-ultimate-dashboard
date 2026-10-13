"""WebRTC-Brücke und Telefon-Fassade mit echtem Audio: ein zweiter aiortc-Peer spielt den Browser."""

from __future__ import annotations

import asyncio
import contextlib
import math
from array import array
from fractions import Fraction

import pytest

pytest.importorskip("aiortc")
import av
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamError, MediaStreamTrack

import panelstudio.telefon as telefon_paket
from panelstudio.telefon import Telefon, TelefonConfig, TelefonFehler, g711, rtp, sip
from panelstudio.telefon.bruecke import Bruecke
from telefon_fake import SDP_FAKE, FakeAudio, FakeFritz, bis


class Sinus(MediaStreamTrack):
    """440-Hz-Ton, 48 kHz mono, 20-ms-Rahmen in Echtzeit (das Mikrofon des „Browsers“)."""

    kind = "audio"

    def __init__(self) -> None:
        super().__init__()
        self.n = 0
        self.start: float | None = None

    async def recv(self) -> av.AudioFrame:
        if self.readyState != "live":
            raise MediaStreamError
        loop = asyncio.get_running_loop()
        self.start = self.start or loop.time()
        await asyncio.sleep(max(0.0, self.start + self.n * 0.02 - loop.time()))
        werte = array("h", (int(8000 * math.sin(2 * math.pi * 440 * (self.n * 960 + i) / 48000)) for i in range(960)))
        f = av.AudioFrame(format="s16", layout="mono", samples=960)
        f.sample_rate = 48000
        f.pts = self.n * 960
        f.time_base = Fraction(1, 48000)
        f.planes[0].update(werte.tobytes())
        self.n += 1
        return f


class Browser:
    def __init__(self) -> None:
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        self.pc.addTrack(Sinus())
        self.frames: list[av.AudioFrame] = []
        self.aufgaben: list[asyncio.Task] = []

        @self.pc.on("track")
        def _spur(track):
            async def lauf():
                with contextlib.suppress(MediaStreamError):
                    while True:
                        self.frames.append(await track.recv())

            self.aufgaben.append(asyncio.create_task(lauf()))

    async def angebot(self) -> str:
        await self.pc.setLocalDescription(await self.pc.createOffer())
        return self.pc.localDescription.sdp

    async def antwort(self, sdp: str) -> None:
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="answer"))

    def energie(self) -> int:
        spitze = 0
        for f in self.frames[-25:]:
            a = array("h")
            a.frombytes(bytes(f.planes[0])[: f.samples * f.layout.nb_channels * 2])
            spitze = max(spitze, max(map(abs, a), default=0))
        return spitze

    async def schliessen(self) -> None:
        for t in self.aufgaben:
            t.cancel()
        await self.pc.close()


def pcm_spitze(payload: bytes, pt: int = 0) -> int:
    a = array("h")
    a.frombytes(g711.dekodieren(payload, pt))
    return max(map(abs, a))


async def sende_sinus(audio: FakeAudio, ziel_port: int, stop: asyncio.Event) -> None:
    """Fake-FRITZ!Box schickt 440 Hz als PCMU an die RTP-Seite des Telefons."""
    seq, ts, n = 100, 5000, 0
    loop = asyncio.get_running_loop()
    start = loop.time()
    while not stop.is_set():
        pcm = array("h", (int(8000 * math.sin(2 * math.pi * 440 * (n * 160 + i) / 8000)) for i in range(160))).tobytes()
        audio.transport.sendto(rtp.paket_bauen(0, seq, ts, 4242, g711.kodieren(pcm)), ("127.0.0.1", ziel_port))
        seq, ts, n = seq + 1, ts + 160, n + 1
        await asyncio.sleep(max(0.0, start + n * 0.02 - loop.time()))


async def test_bruecke_audio_in_beide_richtungen() -> None:
    audio = await FakeAudio().starten()
    sitzung = rtp.RtpSitzung(0, "127.0.0.1")
    await sitzung.oeffnen()
    sitzung.ziel_setzen("127.0.0.1", audio.port, g711.PT_PCMU, 101)
    bruecke = Bruecke(sitzung)
    browser = Browser()
    stop = asyncio.Event()
    sender = None
    try:
        antwort = await bruecke.antworten(await browser.angebot())
        assert antwort.startswith("v=0") and "m=audio" in antwort and "a=sendrecv" in antwort
        await browser.antwort(antwort)

        # Browser -> Telefon: Töne kommen als 20-ms-PCMU-Pakete an
        await bis(lambda: len(audio.pakete) >= 30, timeout=8)
        teile = [rtp.paket_parsen(d) for d, _ in audio.pakete]
        assert all(t[0] == 0 and len(t[5]) == 160 for t in teile)
        seqs = [t[1] for t in teile]
        assert seqs == [(seqs[0] + i) & 0xFFFF for i in range(len(seqs))]
        assert max(pcm_spitze(t[5]) for t in teile[-20:]) > 4000

        # Telefon -> Browser
        sender = asyncio.create_task(sende_sinus(audio, sitzung.port, stop))
        await bis(lambda: browser.energie() > 2000, timeout=8)
        assert browser.frames[-1].sample_rate == 48000

        # Stumm: es gehen nur noch Stille-Pakete raus
        bruecke.stumm = True
        await asyncio.sleep(0.2)
        n = len(audio.pakete)
        await bis(lambda: len(audio.pakete) >= n + 10)
        assert all(pcm_spitze(rtp.paket_parsen(d)[5]) == 0 for d, _ in audio.pakete[n:])
        bruecke.stumm = False
        n = len(audio.pakete)
        await bis(lambda: len(audio.pakete) >= n + 25)
        assert max(pcm_spitze(rtp.paket_parsen(d)[5]) for d, _ in audio.pakete[n:]) > 4000
    finally:
        stop.set()
        if sender:
            await sender
        await browser.schliessen()
        await bruecke.schliessen()
        await bruecke.schliessen()  # idempotent
        sitzung.schliessen()
        audio.schliessen()
    assert not bruecke._tasks


async def test_bruecke_ohne_audio_im_angebot_wirft() -> None:
    sitzung = rtp.RtpSitzung(0, "127.0.0.1")
    bruecke = Bruecke(sitzung)
    with pytest.raises(Exception, match=r"."):
        await bruecke.antworten("v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n")
    assert bruecke._pc is None


# --------------------------------------------------------------------------- Fassade komplett


@pytest.fixture
async def aufbau(monkeypatch):
    monkeypatch.setattr(telefon_paket, "BEENDET_ANZEIGE_S", 0.3)
    fake = await FakeFritz().starten()
    audio = await FakeAudio().starten()
    fake.rtp_port = audio.port
    meldungen: list[dict] = []
    t = Telefon(
        TelefonConfig(server="127.0.0.1", port=fake.port, benutzer="620", passwort="geheim", lokaler_port=0, rtp_ports=(0,)),
        lambda s: meldungen.append(s),
    )
    await t.start()
    await bis(lambda: t.status()["registriert"])
    browser = Browser()
    yield t, fake, audio, browser, meldungen
    await browser.schliessen()
    await t.stop()
    audio.schliessen()
    fake.schliessen()


async def test_telefon_eingehender_anruf_komplett(aufbau) -> None:
    t, fake, audio, browser, meldungen = aufbau
    assert t.status()["aktiv"] and t.status()["fehler"] is None
    invite = fake.anfrage(
        "INVITE",
        f"sip:620@127.0.0.1:{fake.client[1]}",
        von='"Max Muster" <sip:0301234567@fritz.box>;tag=ft1',
        an="<sip:620@fritz.box>",
        call_id="e1@fritz",
        cseq=1,
        branch="z9hG4bKe1",
        body=SDP_FAKE.format(port=audio.port),
    )
    fake.sende_roh(invite)
    await bis(lambda: t.status()["anruf"] is not None)
    a = t.status()["anruf"]
    assert (a["richtung"], a["nummer"], a["name"], a["zustand"]) == ("ein", "0301234567", "Max Muster", "klingelt")
    assert a["verbunden_seit"] is None and a["grund"] is None and a["stumm"] is False and a["seit"].endswith("+00:00")

    with pytest.raises(ValueError, match="SDP"):
        await t.annehmen(a["id"], "kaputt")
    antwort = await t.annehmen(a["id"], await browser.angebot())
    await browser.antwort(antwort)
    assert t.status()["anruf"]["zustand"] == "verbunden" and t.status()["anruf"]["verbunden_seit"]
    r200 = next(m for m in fake.alle if m.status == 200 and m.cseq()[1] == "INVITE")
    medien_port = sip.sdp_parsen(r200.body.decode()).port
    assert medien_port > 0

    # Audio vom Browser erreicht die Fake-FRITZ!Box
    await bis(lambda: len(audio.pakete) >= 20, timeout=8)
    assert all(addr[1] == medien_port for _, addr in audio.pakete)
    assert max(pcm_spitze(rtp.paket_parsen(d)[5]) for d, _ in audio.pakete[-10:]) > 4000

    # ... und umgekehrt
    stop = asyncio.Event()
    sender = asyncio.create_task(sende_sinus(audio, medien_port, stop))
    try:
        await bis(lambda: browser.energie() > 2000, timeout=8)
    finally:
        stop.set()
        await sender

    # DTMF als telephone-event
    n = len(audio.pakete)
    assert await t.dtmf(a["id"], "5") is True
    await bis(lambda: any(rtp.paket_parsen(d)[0] == 101 for d, _ in audio.pakete[n:]))
    ereignisse = [rtp.paket_parsen(d) for d, _ in audio.pakete[n:] if rtp.paket_parsen(d)[0] == 101]
    assert ereignisse[0][5][0] == 5 and any(e[5][1] & 0x80 for e in ereignisse)

    # Stumm
    assert await t.stumm(a["id"], True) is True and t.status()["anruf"]["stumm"] is True
    await asyncio.sleep(0.2)
    n = len(audio.pakete)
    await bis(lambda: len(audio.pakete) >= n + 10)
    assert all(pcm_spitze(rtp.paket_parsen(d)[5]) == 0 for d, _ in audio.pakete[n:] if rtp.paket_parsen(d)[0] == 0)

    # Auflegen: BYE an die Gegenstelle, Status "beendet", nach kurzer Zeit leer
    assert await t.auflegen(a["id"]) is True
    bye = await fake.warte(lambda m: m.methode == "BYE")
    assert bye.call_id == "e1@fritz"
    assert t.status()["anruf"]["zustand"] == "beendet" and t.status()["anruf"]["grund"] == "Aufgelegt"
    await bis(lambda: t.status()["anruf"] is None)
    assert next(m["anruf"]["zustand"] for m in meldungen if m["anruf"]) == "klingelt"
    assert meldungen[-1]["anruf"] is None
    with pytest.raises(ValueError, match="Unbekannter Anruf"):
        await t.auflegen(a["id"])
    assert t._belegt == set()


async def test_telefon_anruf_ablehnen_und_cancel(aufbau) -> None:
    t, fake, audio, _browser, _m = aufbau

    def invite(cid: str, br: str) -> bytes:
        return fake.anfrage(
            "INVITE", "sip:620@127.0.0.1", von="<sip:555@fritz.box>;tag=t", an="<sip:620@fritz.box>", call_id=cid, cseq=1, branch=br,
            body=SDP_FAKE.format(port=audio.port),
        )  # fmt: skip

    fake.sende_roh(invite("a@f", "z9hG4bKa"))
    await bis(lambda: t.status()["anruf"] is not None)
    aid = t.status()["anruf"]["id"]
    assert await t.ablehnen(aid) is True
    assert (await fake.warte(lambda m: m.status == 603)).call_id == "a@f"
    assert t.status()["anruf"]["zustand"] == "beendet" and t.status()["anruf"]["grund"] == "Abgelehnt"
    assert await t.ablehnen(aid) is False
    await bis(lambda: t.status()["anruf"] is None)
    with pytest.raises(ValueError, match="Unbekannter Anruf"):
        await t.ablehnen(aid)

    fake.sende_roh(invite("b@f", "z9hG4bKb"))
    await bis(lambda: t.status()["anruf"] is not None)
    fake.sende_roh(
        fake.anfrage(
            "CANCEL",
            "sip:620@127.0.0.1",
            von="<sip:555@fritz.box>;tag=t",
            an="<sip:620@fritz.box>",
            call_id="b@f",
            cseq=1,
            branch="z9hG4bKb",
        )
    )
    await bis(lambda: t.status()["anruf"]["zustand"] == "beendet")
    assert t.status()["anruf"]["grund"] == "Verpasst"


async def test_telefon_ausgehender_anruf_komplett(aufbau) -> None:
    t, fake, audio, browser, _meldungen = aufbau
    with pytest.raises(ValueError, match="Rufnummer"):
        await t.waehlen("12 34", "v=0\r\n")
    ergebnis = await t.waehlen("0301234567", await browser.angebot())
    assert set(ergebnis) == {"anruf", "antwort"} and ergebnis["antwort"].startswith("v=0")
    await browser.antwort(ergebnis["antwort"])
    a = t.status()["anruf"]
    assert a["id"] == ergebnis["anruf"] and a["richtung"] == "aus" and a["nummer"] == "0301234567"
    await bis(lambda: t.status()["anruf"]["zustand"] == "verbunden")
    inv = next(m for m in fake.alle if m.methode == "INVITE")
    assert sip.sdp_parsen(inv.body.decode()).port > 0
    zweiter = Browser()
    with pytest.raises(TelefonFehler, match="Gespräch"):
        await t.waehlen("111", await zweiter.angebot())
    await zweiter.schliessen()

    await bis(lambda: len(audio.pakete) >= 20, timeout=8)
    assert max(pcm_spitze(rtp.paket_parsen(d)[5]) for d, _ in audio.pakete[-10:]) > 4000
    assert await t.auflegen(ergebnis["anruf"]) is True
    assert (await fake.warte(lambda m: m.methode == "BYE")).call_id == inv.call_id
    await bis(lambda: t.status()["anruf"] is None)
    assert t._belegt == set()
