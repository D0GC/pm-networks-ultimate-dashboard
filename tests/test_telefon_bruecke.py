"""Tonbrücke (Panel-Rahmen ↔ RTP) und Telefon-Fassade mit Fake-FRITZ!Box; das Panel ist ein Sammel-Rückruf."""

from __future__ import annotations

import asyncio
import math
import time
from array import array
from itertools import pairwise

import pytest

import panelstudio.telefon as telefon_paket
from panelstudio.telefon import Telefon, TelefonConfig, TelefonFehler, g711, rtp, sip
from panelstudio.telefon.bruecke import PUFFER_MAX, TonBruecke
from telefon_fake import SDP_FAKE, FakeAudio, FakeFritz, bis


def sinus_pcm(n: int, f: int = 440, amp: int = 8000) -> bytes:
    return array("h", (int(amp * math.sin(2 * math.pi * f * (n * 160 + i) / 8000)) for i in range(160))).tobytes()


def pcm_spitze(payload: bytes, pt: int = 0) -> int:
    a = array("h")
    a.frombytes(g711.dekodieren(payload, pt))
    return max(map(abs, a))


class Panel:
    """Das Panel: sammelt die Rahmen, die der Server sendet."""

    def __init__(self) -> None:
        self.rahmen: list[tuple[float, bytes]] = []

    async def senden(self, daten: bytes) -> None:
        self.rahmen.append((time.monotonic(), daten))


async def sende_sinus(audio: FakeAudio, ziel_port: int, stop: asyncio.Event) -> None:
    """Fake-FRITZ!Box schickt 440 Hz als PCMU an die RTP-Seite des Telefons."""
    seq, ts, n = 100, 5000, 0
    loop = asyncio.get_running_loop()
    start = loop.time()
    while not stop.is_set():
        audio.transport.sendto(rtp.paket_bauen(0, seq, ts, 4242, g711.kodieren(sinus_pcm(n))), ("127.0.0.1", ziel_port))
        seq, ts, n = seq + 1, ts + 160, n + 1
        await asyncio.sleep(max(0.0, start + n * 0.02 - loop.time()))


@pytest.fixture
async def strecke():
    audio = await FakeAudio().starten()
    sitzung = rtp.RtpSitzung(0, "127.0.0.1")
    await sitzung.oeffnen()
    sitzung.ziel_setzen("127.0.0.1", audio.port, g711.PT_PCMU, 101)
    panel = Panel()
    bruecke = TonBruecke(sitzung, panel.senden)
    yield bruecke, sitzung, audio, panel
    await bruecke.schliessen()
    sitzung.schliessen()
    audio.schliessen()


async def test_takt_ausgang_gleichmaessig_und_stille(strecke) -> None:
    bruecke, _sitzung, _audio, panel = strecke
    bruecke.starten()
    await bis(lambda: len(panel.rahmen) >= 31, timeout=3)
    assert all(len(d) == 320 and d == bytes(320) for _, d in panel.rahmen)  # keine RTP-Daten: Stille
    # Absolute Zeitplanung: 25 Abstände dauern ~500 ms, ohne Drift. Gemessen nach fünf Rahmen Anlauf; der erste
    # Takt fällt beim ersten Test eines Laufs mit dem Aufwärmen der Ereignisschleife zusammen und streut.
    zeiten = [t for t, _ in panel.rahmen][5:31]
    assert 0.46 < zeiten[25] - zeiten[0] < 0.56
    assert max(b - a for a, b in pairwise(zeiten)) < 0.06


async def test_ausgang_liefert_rtp_audio(strecke) -> None:
    bruecke, sitzung, audio, panel = strecke
    bruecke.starten()
    stop = asyncio.Event()
    sender = asyncio.create_task(sende_sinus(audio, sitzung.port, stop))
    try:
        await bis(lambda: any(max(array("h", d)) > 4000 for _, d in panel.rahmen), timeout=3)
    finally:
        stop.set()
        await sender


async def test_eingang_wird_im_takt_gesendet(strecke) -> None:
    bruecke, _sitzung, audio, _panel = strecke
    bruecke.eingang(sinus_pcm(0))  # vor dem Start: ignoriert
    bruecke.starten()
    bruecke.eingang(b"kurz")  # falsche Länge
    bruecke.eingang(bytes(640))
    assert bruecke.rahmen_eingang == 0
    for n in range(5):  # Burst
        bruecke.eingang(sinus_pcm(n))
    assert bruecke.rahmen_eingang == 5
    await bis(lambda: len(audio.pakete) >= 5)
    zeiten_ok = [rtp.paket_parsen(d) for d, _ in audio.pakete]
    assert [t[1] for t in zeiten_ok] == [(zeiten_ok[0][1] + i) & 0xFFFF for i in range(5)]
    assert all(pcm_spitze(t[5]) > 1000 for t in zeiten_ok)
    # Pakete kamen nicht als Stoß: Burst von 5 Rahmen braucht rund 100 ms
    await asyncio.sleep(0.1)
    assert len(audio.pakete) == 5


async def test_puffer_verwirft_aelteste(strecke) -> None:
    bruecke, _sitzung, audio, _panel = strecke
    bruecke.starten()
    n = PUFFER_MAX + 8
    for i in range(n):
        bruecke.eingang(array("h", [(i + 1) * 1000] * 160).tobytes())  # Pegel erkennt den Rahmen wieder
    await bis(lambda: len(audio.pakete) >= PUFFER_MAX)
    await asyncio.sleep(0.1)
    werte = []
    for d, _ in audio.pakete:
        a = array("h")
        a.frombytes(g711.dekodieren(rtp.paket_parsen(d)[5]))
        werte.append(round(a[0] / 1000))
    assert len(werte) == PUFFER_MAX and werte == list(range(n - PUFFER_MAX + 1, n + 1))  # nur die neuesten


async def test_stumm_sendet_stille(strecke) -> None:
    bruecke, _sitzung, audio, _panel = strecke
    bruecke.starten()
    bruecke.stumm = True
    for n in range(5):
        bruecke.eingang(sinus_pcm(n))
    await bis(lambda: len(audio.pakete) >= 5)
    assert all(pcm_spitze(rtp.paket_parsen(d)[5]) == 0 for d, _ in audio.pakete)
    bruecke.stumm = False
    anzahl = len(audio.pakete)
    for n in range(3):
        bruecke.eingang(sinus_pcm(n))
    await bis(lambda: len(audio.pakete) >= anzahl + 3)
    assert pcm_spitze(rtp.paket_parsen(audio.pakete[-1][0])[5]) > 1000


async def test_schliessen_idempotent_und_stoppt_takt(strecke) -> None:
    bruecke, _sitzung, _audio, panel = strecke
    bruecke.starten()
    await bis(lambda: len(panel.rahmen) >= 3)
    await bruecke.schliessen()
    await bruecke.schliessen()
    assert not bruecke.laeuft
    anzahl = len(panel.rahmen)
    await asyncio.sleep(0.1)
    assert len(panel.rahmen) == anzahl
    bruecke.starten()  # nach dem Schließen kein Neustart
    assert not bruecke.laeuft
    bruecke.eingang(bytes(320))
    assert bruecke.rahmen_eingang == 0


async def test_fehler_beim_senden_beendet_takt_nicht() -> None:
    sitzung = rtp.RtpSitzung(0, "127.0.0.1")
    aufrufe = []

    async def kaputt(_daten: bytes) -> None:
        aufrufe.append(1)
        raise ConnectionResetError

    bruecke = TonBruecke(sitzung, kaputt)
    bruecke.starten()
    try:
        await bis(lambda: len(aufrufe) >= 3)
        assert bruecke.laeuft
    finally:
        await bruecke.schliessen()


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
    yield t, fake, audio, Panel(), meldungen
    await t.stop()
    audio.schliessen()
    fake.schliessen()


async def test_telefon_eingehender_anruf_komplett(aufbau) -> None:
    t, fake, audio, panel, meldungen = aufbau
    assert t.status()["aktiv"] and t.status()["fehler"] is None
    fake.sende_roh(
        fake.anfrage(
            "INVITE",
            f"sip:620@127.0.0.1:{fake.client[1]}",
            von='"Max Muster" <sip:0301234567@fritz.box>;tag=ft1',
            an="<sip:620@fritz.box>",
            call_id="e1@fritz",
            cseq=1,
            branch="z9hG4bKe1",
            body=SDP_FAKE.format(port=audio.port),
        )
    )
    await bis(lambda: t.status()["anruf"] is not None)
    a = t.status()["anruf"]
    assert (a["richtung"], a["nummer"], a["name"], a["zustand"]) == ("ein", "0301234567", "Max Muster", "klingelt")
    assert a["verbunden_seit"] is None and a["grund"] is None and a["stumm"] is False and a["seit"].endswith("+00:00")
    t.ton(bytes(320))  # vor dem Annehmen: ignoriert

    assert await t.annehmen(a["id"], panel.senden) is True
    assert t.status()["anruf"]["zustand"] == "verbunden" and t.status()["anruf"]["verbunden_seit"]
    await bis(lambda: any(m.status == 200 and m.cseq()[1] == "INVITE" for m in fake.alle))
    r200 = next(m for m in fake.alle if m.status == 200 and m.cseq()[1] == "INVITE")
    medien_port = sip.sdp_parsen(r200.body.decode()).port
    assert medien_port > 0
    with pytest.raises(TelefonFehler):
        await t.annehmen(a["id"], panel.senden)

    # Panel -> FRITZ!Box
    for n in range(10):
        t.ton(sinus_pcm(n))
    await bis(lambda: len(audio.pakete) >= 10, timeout=3)
    assert all(addr[1] == medien_port for _, addr in audio.pakete)
    assert max(pcm_spitze(rtp.paket_parsen(d)[5]) for d, _ in audio.pakete) > 4000

    # FRITZ!Box -> Panel
    stop = asyncio.Event()
    sender = asyncio.create_task(sende_sinus(audio, medien_port, stop))
    try:
        await bis(lambda: any(max(array("h", d)) > 4000 for _, d in panel.rahmen), timeout=3)
    finally:
        stop.set()
        await sender

    # DTMF als telephone-event
    n = len(audio.pakete)
    assert await t.dtmf(a["id"], "5") is True
    await bis(lambda: any(rtp.paket_parsen(d)[0] == 101 for d, _ in audio.pakete[n:]))

    # Stumm
    assert await t.stumm(a["id"], True) is True and t.status()["anruf"]["stumm"] is True
    await asyncio.sleep(0.3)
    n = len(audio.pakete)
    for i in range(5):
        t.ton(sinus_pcm(i))
    await bis(lambda: len([1 for d, _ in audio.pakete[n:] if rtp.paket_parsen(d)[0] == 0]) >= 5)
    assert all(pcm_spitze(rtp.paket_parsen(d)[5]) == 0 for d, _ in audio.pakete[n:] if rtp.paket_parsen(d)[0] == 0)

    # Auflegen: BYE, Status "beendet", danach leer; der Takt endet
    assert await t.auflegen(a["id"]) is True
    assert (await fake.warte(lambda m: m.methode == "BYE")).call_id == "e1@fritz"
    assert t.status()["anruf"]["zustand"] == "beendet" and t.status()["anruf"]["grund"] == "Aufgelegt"
    await bis(lambda: t.status()["anruf"] is None)
    assert next(m["anruf"]["zustand"] for m in meldungen if m["anruf"]) == "klingelt"
    assert meldungen[-1]["anruf"] is None
    with pytest.raises(ValueError, match="Unbekannter Anruf"):
        await t.auflegen(a["id"])
    anzahl = len(panel.rahmen)
    await asyncio.sleep(0.1)
    assert len(panel.rahmen) == anzahl and t._belegt == set()


async def test_telefon_anruf_ablehnen_und_cancel(aufbau) -> None:
    t, fake, audio, _panel, _m = aufbau

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
    t, fake, audio, panel, _meldungen = aufbau
    with pytest.raises(ValueError, match="Rufnummer"):
        await t.waehlen("12 34", panel.senden)
    ergebnis = await t.waehlen("0301234567", panel.senden)
    assert set(ergebnis) == {"anruf"}
    a = t.status()["anruf"]
    assert a["id"] == ergebnis["anruf"] and a["richtung"] == "aus" and a["nummer"] == "0301234567"
    await bis(lambda: t.status()["anruf"]["zustand"] == "verbunden")
    inv = next(m for m in fake.alle if m.methode == "INVITE")
    assert sip.sdp_parsen(inv.body.decode()).port > 0
    with pytest.raises(TelefonFehler, match="Gespräch"):
        await t.waehlen("111", panel.senden)

    for n in range(10):
        t.ton(sinus_pcm(n))
    await bis(lambda: len(audio.pakete) >= 10, timeout=3)
    assert max(pcm_spitze(rtp.paket_parsen(d)[5]) for d, _ in audio.pakete) > 4000
    await bis(lambda: len(panel.rahmen) >= 3)  # Ton zum Panel läuft ab "verbunden"
    assert await t.auflegen(ergebnis["anruf"]) is True
    assert (await fake.warte(lambda m: m.methode == "BYE")).call_id == inv.call_id
    await bis(lambda: t.status()["anruf"] is None)
    assert t._belegt == set()


async def test_rahmen_vor_verbunden_werden_verworfen(aufbau) -> None:
    t, fake, audio, panel, _meldungen = aufbau
    fake.auto_invite = False
    ergebnis = await t.waehlen("0301234567", panel.senden)
    inv = await fake.warte(lambda m: m.methode == "INVITE")
    fake._senden(fake.antwort(inv, 180))
    await bis(lambda: t._v.sip.vorlaeufig_gesehen)
    for n in range(20):  # das Panel sendet schon beim Wählen
        t.ton(sinus_pcm(n))
    await asyncio.sleep(0.2)
    assert t.status()["anruf"]["zustand"] == "waehlt"
    assert t._v.bruecke.rahmen_eingang == 0 and not audio.pakete and not panel.rahmen
    # Nach dem Verbinden erscheint kein verspäteter Stau
    fake._senden(fake.antwort(inv, 200, body=SDP_FAKE.format(port=audio.port)))
    await bis(lambda: t.status()["anruf"]["zustand"] == "verbunden")
    await asyncio.sleep(0.2)
    assert not audio.pakete
    await t.auflegen(ergebnis["anruf"])


async def test_telefon_meldet_nur_unbeantwortete_anrufe_als_verpasst(aufbau) -> None:
    t, fake, audio, _panel, _m = aufbau
    verpasst: list[tuple[str, str]] = []
    t._verpasst = lambda nummer, name: verpasst.append((nummer, name))

    def invite(cid: str, br: str) -> bytes:
        return fake.anfrage(
            "INVITE", "sip:620@127.0.0.1", von='"Max" <sip:555@fritz.box>;tag=t', an="<sip:620@fritz.box>", call_id=cid, cseq=1, branch=br,
            body=SDP_FAKE.format(port=audio.port),
        )  # fmt: skip

    def cancel(cid: str, br: str, reason: str | None = None) -> bytes:
        return fake.anfrage(
            "CANCEL", "sip:620@127.0.0.1", von='"Max" <sip:555@fritz.box>;tag=t', an="<sip:620@fritz.box>", call_id=cid, cseq=1, branch=br,
            koepfe=[("reason", reason)] if reason else None,
        )  # fmt: skip

    # am Panel abgelehnt: nicht verpasst
    fake.sende_roh(invite("a@f", "z9hG4bKa"))
    await bis(lambda: t.status()["anruf"] is not None)
    await t.ablehnen(t.status()["anruf"]["id"])
    await bis(lambda: t.status()["anruf"] is None)

    # an einem anderen Telefon angenommen (Reason cause=200): nicht verpasst
    fake.sende_roh(invite("b@f", "z9hG4bKb"))
    await bis(lambda: t.status()["anruf"] is not None)
    fake.sende_roh(cancel("b@f", "z9hG4bKb", 'SIP;cause=200;text="Call completed elsewhere"'))
    await bis(lambda: t.status()["anruf"]["zustand"] == "beendet")
    assert t.status()["anruf"]["grund"] == "Woanders angenommen"
    await bis(lambda: t.status()["anruf"] is None)
    assert verpasst == []

    # Anrufer legt vor dem Annehmen auf: verpasst, mit Name
    fake.sende_roh(invite("c@f", "z9hG4bKc"))
    await bis(lambda: t.status()["anruf"] is not None)
    fake.sende_roh(cancel("c@f", "z9hG4bKc"))
    await bis(lambda: verpasst == [("555", "Max")])
