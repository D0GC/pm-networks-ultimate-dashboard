"""G.711-Kodierung: bekannte Werte und Rundlauf."""

from __future__ import annotations

import math
from array import array

import pytest

from panelstudio.telefon import g711


def pcm(werte: list[int]) -> bytes:
    return array("h", werte).tobytes()


def test_ulaw_bekannte_werte() -> None:
    assert g711.kodieren(pcm([0, 32767, -32768, -1]), g711.PT_PCMU) == bytes([0xFF, 0x80, 0x00, 0x7F])
    assert g711.dekodieren(bytes([0xFF, 0x7F, 0x80, 0x00]), g711.PT_PCMU) == pcm([0, 0, 32124, -32124])


def test_alaw_bekannte_werte() -> None:
    assert g711.kodieren(pcm([0, 32767, -32768]), g711.PT_PCMA) == bytes([0xD5, 0xAA, 0x2A])
    assert g711.dekodieren(bytes([0xD5, 0x55, 0xAA, 0x2A]), g711.PT_PCMA) == pcm([8, -8, 32256, -32256])


@pytest.mark.parametrize("pt", [g711.PT_PCMU, g711.PT_PCMA])
def test_rundlauf_alle_codes(pt: int) -> None:
    """Jeder G.711-Code muss nach Dekodieren → Kodieren wieder derselbe Code sein (bis auf µ-law ±0)."""
    codes = bytes(range(256))
    neu = g711.kodieren(g711.dekodieren(codes, pt), pt)
    abweichend = [i for i in range(256) if neu[i] != codes[i]]
    assert abweichend == ([0x7F] if pt == g711.PT_PCMU else [])


@pytest.mark.parametrize("pt", [g711.PT_PCMU, g711.PT_PCMA])
def test_sinus_rundlauf_fehlerarm(pt: int) -> None:
    quelle = [int(12000 * math.sin(2 * math.pi * 440 * i / 8000)) for i in range(800)]
    zurueck = array("h")
    zurueck.frombytes(g711.dekodieren(g711.kodieren(pcm(quelle), pt), pt))
    fehler = max(abs(a - b) for a, b in zip(quelle, zurueck, strict=True))
    assert fehler < 600  # Quantisierung bei 12000 Amplitude: Schrittweite max. 512


def test_laengen_und_stille() -> None:
    assert len(g711.kodieren(bytes(320))) == 160
    assert g711.kodieren(bytes(321)) == g711.kodieren(bytes(320))  # halbes Sample am Ende wird ignoriert
    assert g711.stille(g711.PT_PCMU) == g711.kodieren(bytes(320), g711.PT_PCMU)
    assert g711.stille(g711.PT_PCMA) == g711.kodieren(bytes(320), g711.PT_PCMA)
    assert g711.dekodieren(g711.stille(g711.PT_PCMU)) == bytes(320)


def test_unbekannter_typ() -> None:
    with pytest.raises(ValueError, match="Payload-Typ"):
        g711.kodieren(bytes(4), 99)
    with pytest.raises(ValueError, match="Payload-Typ"):
        g711.dekodieren(bytes(4), 99)
