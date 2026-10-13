"""G.711 (PCMU = µ-law, PCMA = A-law) in reinem Python.

``audioop`` gibt es ab Python 3.13 nicht mehr, numpy ist nicht verfügbar. Die Kodierung läuft deshalb über
Nachschlagetabellen: 64 KiB für PCM → G.711 (indiziert mit dem Sample als vorzeichenlose 16-Bit-Zahl) und
je 256 Einträge für G.711 → PCM. Ein 20-ms-Rahmen (160 Samples) kostet damit nur ein paar ``map``-Aufrufe.

PCM ist überall 16 Bit, signed, mono, little endian (8 kHz).
"""

from __future__ import annotations

import sys
from array import array

PT_PCMU = 0
PT_PCMA = 8
RATE = 8000
RAHMEN_SAMPLES = 160  # 20 ms
RAHMEN_BYTES = RAHMEN_SAMPLES * 2

_BIAS = 0x84
_CLIP = 32635


def _pcm_zu_ulaw(s: int) -> int:
    """Ein Sample (−32768..32767) nach µ-law (ITU-T G.711)."""
    maske = 0x00
    if s < 0:
        s = -s
        maske = 0x80
    s = min(s, _CLIP) + _BIAS
    exp = (s >> 7).bit_length() - 1
    mant = (s >> (exp + 3)) & 0x0F
    return ~(maske | (exp << 4) | mant) & 0xFF


def _ulaw_zu_pcm(u: int) -> int:
    u = ~u & 0xFF
    t = (((u & 0x0F) << 3) + _BIAS) << ((u & 0x70) >> 4)
    return _BIAS - t if u & 0x80 else t - _BIAS


_SEG_ENDE = (0x1F, 0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF)


def _pcm_zu_alaw(s: int) -> int:
    """Ein Sample nach A-law (ITU-T G.711, Sun-Referenz)."""
    s >>= 3  # 13 Bit
    if s >= 0:
        maske = 0xD5
    else:
        maske = 0x55
        s = -s - 1
    seg = 8
    for i, ende in enumerate(_SEG_ENDE):
        if s <= ende:
            seg = i
            break
    if seg >= 8:
        return 0x7F ^ maske
    aval = seg << 4
    aval |= (s >> 1) & 0x0F if seg < 2 else (s >> seg) & 0x0F
    return aval ^ maske


def _alaw_zu_pcm(a: int) -> int:
    a ^= 0x55
    t = (a & 0x0F) << 4
    seg = (a & 0x70) >> 4
    if seg == 0:
        t += 8
    else:
        t = (t + 0x108) << (seg - 1)
    return t if a & 0x80 else -t


def _enc_tabelle(f) -> bytes:
    # Index = Sample als vorzeichenlose 16-Bit-Zahl (negative Werte liegen oben)
    return bytes(f(i if i < 32768 else i - 65536) for i in range(65536))


_ENC_U: bytes | None = None
_ENC_A: bytes | None = None
_DEC_U = tuple(_ulaw_zu_pcm(i) for i in range(256))
_DEC_A = tuple(_alaw_zu_pcm(i) for i in range(256))
_BIG = sys.byteorder == "big"


def _enc_tab(pt: int) -> bytes:
    global _ENC_U, _ENC_A
    if pt == PT_PCMU:
        if _ENC_U is None:
            _ENC_U = _enc_tabelle(_pcm_zu_ulaw)
        return _ENC_U
    if pt == PT_PCMA:
        if _ENC_A is None:
            _ENC_A = _enc_tabelle(_pcm_zu_alaw)
        return _ENC_A
    raise ValueError(f"Unbekannter G.711-Payload-Typ: {pt}")


def vorbereiten() -> None:
    """Baut beide Kodiertabellen vorab (ca. 60 ms je Tabelle), damit der erste Anruf nicht ruckelt."""
    _enc_tab(PT_PCMU)
    _enc_tab(PT_PCMA)


def kodieren(pcm: bytes, pt: int = PT_PCMU) -> bytes:
    """PCM (s16le) → G.711 mit Payload-Typ ``pt`` (0 = PCMU, 8 = PCMA)."""
    tab = _enc_tab(pt)
    if len(pcm) % 2:
        pcm = pcm[:-1]
    werte = array("H")
    werte.frombytes(pcm)
    if _BIG:
        werte.byteswap()
    return bytes(map(tab.__getitem__, werte))


def dekodieren(daten: bytes, pt: int = PT_PCMU) -> bytes:
    """G.711 → PCM (s16le)."""
    if pt == PT_PCMU:
        tab = _DEC_U
    elif pt == PT_PCMA:
        tab = _DEC_A
    else:
        raise ValueError(f"Unbekannter G.711-Payload-Typ: {pt}")
    werte = array("h", map(tab.__getitem__, daten))
    if _BIG:
        werte.byteswap()
    return werte.tobytes()


def stille(pt: int = PT_PCMU, samples: int = RAHMEN_SAMPLES) -> bytes:
    """Ein G.711-Block Stille (0xFF bei µ-law, 0xD5 bei A-law)."""
    return bytes([0xFF if pt == PT_PCMU else 0xD5]) * samples
