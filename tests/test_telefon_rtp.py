"""RTP: Pakete bauen/parsen, Paketierung, Jitter-Puffer und DTMF (RFC 4733)."""

from __future__ import annotations

import asyncio
import struct

from panelstudio.telefon import g711, rtp
from telefon_fake import FakeAudio, bis


def test_paket_rundlauf() -> None:
    roh = rtp.paket_bauen(0, 65535, 4294967295, 0xDEADBEEF, b"abc", marker=True)
    assert roh[:2] == bytes([0x80, 0x80])
    assert rtp.paket_parsen(roh) == (0, 65535, 4294967295, 0xDEADBEEF, True, b"abc")
    assert rtp.paket_parsen(rtp.paket_bauen(8, 1, 2, 3, b"")) == (8, 1, 2, 3, False, b"")


def test_paket_parsen_ungueltig_und_erweiterungen() -> None:
    assert rtp.paket_parsen(b"\x80\x00") is None
    assert rtp.paket_parsen(b"\x40" + bytes(20)) is None  # Version 1
    # Header-Erweiterung (X) und Padding (P)
    kopf = bytes([0x80 | 0x10 | 0x20, 0x00]) + struct.pack("!HII", 5, 6, 7)
    erweiterung = struct.pack("!HH", 0xBEDE, 1) + b"\0\0\0\0"
    p = rtp.paket_parsen(kopf + erweiterung + b"NUTZ\x00\x00\x03")
    assert p is not None and p[5] == b"NUTZ"


def test_dtmf_paket() -> None:
    assert rtp.dtmf_paket(11, True, 800) == struct.pack("!BBH", 11, 0x80 | 10, 800)
    assert rtp.dtmf_paket(1, False, 160) == struct.pack("!BBH", 1, 10, 160)


def test_dtmf_ton_laenge() -> None:
    assert len(rtp.dtmf_ton("5", 100)) == 800 * 2


async def _sitzung(audio: FakeAudio, **kw) -> rtp.RtpSitzung:
    s = rtp.RtpSitzung(0, "127.0.0.1", **kw)
    await s.oeffnen()
    s.ziel_setzen("127.0.0.1", audio.port, g711.PT_PCMU, 101)
    return s


async def test_senden_paketiert_in_20ms() -> None:
    audio = await FakeAudio().starten()
    s = await _sitzung(audio)
    try:
        s.senden(bytes(300))  # weniger als 20 ms: noch nichts
        assert s.pakete_gesendet == 0
        s.senden(bytes(700))  # 1000 Byte = 3 volle Pakete + 40 Byte Rest
        await bis(lambda: len(audio.pakete) >= 3)
        teile = [rtp.paket_parsen(d) for d, _ in audio.pakete]
        assert all(t and t[0] == 0 and len(t[5]) == 160 for t in teile)
        assert [t[1] for t in teile] == [(teile[0][1] + i) & 0xFFFF for i in range(3)]
        assert [t[2] for t in teile] == [(teile[0][2] + 160 * i) & 0xFFFFFFFF for i in range(3)]
        assert teile[0][4] and not teile[1][4]  # Marker nur am ersten Paket
        assert len({t[3] for t in teile}) == 1
    finally:
        s.schliessen()
        audio.schliessen()


async def test_dtmf_rfc4733() -> None:
    audio = await FakeAudio().starten()
    s = await _sitzung(audio, takt=0.001)
    try:
        await s.dtmf("5#")
        await bis(lambda: len(audio.pakete) >= 16)
        teile = [rtp.paket_parsen(d) for d, _ in audio.pakete]
        assert all(t[0] == 101 for t in teile)
        erste = [t for t in teile if t[5][0] == 5]
        # 100 ms = 5 laufende Pakete + 3 Ende-Pakete, alle mit demselben Zeitstempel
        assert len(erste) == 8 and len({t[2] for t in erste}) == 1
        assert erste[0][4] and not erste[1][4]  # Marker nur am Anfang
        assert [t[5][2] << 8 | t[5][3] for t in erste[:5]] == [160, 320, 480, 640, 800]
        assert [bool(t[5][1] & 0x80) for t in erste] == [False] * 5 + [True] * 3
        assert [t[5][0] for t in teile if t[5][0] != 5] == [11] * 8  # '#' = 11
        # Zeitstempel des zweiten Tons liegt hinter dem ersten
        assert [t for t in teile if t[5][0] == 11][0][2] == (erste[0][2] + 800) & 0xFFFFFFFF
    finally:
        s.schliessen()
        audio.schliessen()


async def test_dtmf_inband_ohne_telephone_event() -> None:
    audio = await FakeAudio().starten()
    s = await _sitzung(audio, takt=0.001)
    s.dtmf_pt = None
    try:
        await s.dtmf("1")
        await bis(lambda: len(audio.pakete) >= 5)
        teile = [rtp.paket_parsen(d) for d, _ in audio.pakete]
        assert all(t[0] == 0 and len(t[5]) == 160 for t in teile)
        assert any(b != 0xFF for t in teile for b in t[5])  # Ton, keine Stille
    finally:
        s.schliessen()
        audio.schliessen()


async def test_dtmf_ungueltig() -> None:
    s = rtp.RtpSitzung(0, "127.0.0.1")
    try:
        await s.dtmf("x")
    except ValueError:
        return
    raise AssertionError("ValueError erwartet")


async def test_empfang_jitter_puffer_und_symmetrisches_rtp() -> None:
    audio = await FakeAudio().starten()
    s = rtp.RtpSitzung(0, "127.0.0.1")
    await s.oeffnen()
    s.ziel_setzen("127.0.0.1", 9, g711.PT_PCMU, None)  # falsches Ziel: wird durch die Quelle ersetzt
    try:
        assert s.lesen() == bytes(320)  # nichts da -> Stille
        voll = g711.kodieren(bytes([1, 0]) * 160)  # PCM 1 -> µ-law-Code
        for seq in (10, 12, 11, 13):  # 12 und 11 vertauscht
            audio.transport.sendto(rtp.paket_bauen(0, seq, seq * 160, 77, voll), ("127.0.0.1", s.port))
            await asyncio.sleep(0)
        await bis(lambda: s.pakete_empfangen == 4)
        assert s.ziel == ("127.0.0.1", audio.port)
        erwartet = g711.dekodieren(voll)
        assert [s.lesen() for _ in range(4)] == [erwartet] * 4
        assert s.lesen() == bytes(320)
        # Paketverlust: 14 fehlt, 15/16 kommen
        for seq in (15, 16):
            audio.transport.sendto(rtp.paket_bauen(0, seq, seq * 160, 77, voll), ("127.0.0.1", s.port))
        await bis(lambda: s.pakete_empfangen == 6)
        assert s.lesen() == bytes(320) and s.lesen() == erwartet and s.lesen() == erwartet
    finally:
        s.schliessen()
        audio.schliessen()


async def test_fremde_payload_typen_werden_ignoriert() -> None:
    audio = await FakeAudio().starten()
    s = rtp.RtpSitzung(0, "127.0.0.1")
    await s.oeffnen()
    try:
        audio.transport.sendto(rtp.paket_bauen(101, 1, 0, 5, bytes(4)), ("127.0.0.1", s.port))
        audio.transport.sendto(b"muell", ("127.0.0.1", s.port))
        await asyncio.sleep(0.1)
        assert s.pakete_empfangen == 0 and s.ziel is None
    finally:
        s.schliessen()
        audio.schliessen()
