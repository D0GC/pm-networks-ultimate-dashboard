"""RTP-Strecke eines Anrufs (RFC 3550 / 4733) auf einem festen UDP-Port.

Senden:   ``senden(pcm)`` nimmt 8-kHz-PCM (s16le), kodiert nach G.711 und verschickt je 20 ms ein Paket.
Empfang:  Pakete laufen durch einen kleinen Jitter-Puffer; ``lesen()`` liefert genau 20 ms PCM (bei Lücken Stille).
DTMF:     ``dtmf()`` sendet telephone-event-Pakete (RFC 4733, Ende-Bit, dreimal wiederholt). Hat die Gegenstelle
          kein telephone-event ausgehandelt, werden die Töne stattdessen als Audio erzeugt.
Symmetrisches RTP: Sobald Pakete eintreffen, geht der Rückweg an deren tatsächliche Absenderadresse.
"""

from __future__ import annotations

import asyncio
import logging
import math
import secrets
import struct
from array import array

from . import g711

_LOGGER = logging.getLogger(__name__)

PUFFER_VORLAUF = 2  # Pakete, die vor dem Abspielen gesammelt werden (40 ms)
PUFFER_MAX = 10  # darüber wird aufgeholt (200 ms)
SEQ_SPRUNG = 100  # größere Lücken führen zur Neusynchronisation
DTMF_EREIGNIS = {**{str(i): i for i in range(10)}, "*": 10, "#": 11, "A": 12, "B": 13, "C": 14, "D": 15}
DTMF_FREQ = {
    "1": (697, 1209), "2": (697, 1336), "3": (697, 1477), "A": (697, 1633),
    "4": (770, 1209), "5": (770, 1336), "6": (770, 1477), "B": (770, 1633),
    "7": (852, 1209), "8": (852, 1336), "9": (852, 1477), "C": (852, 1633),
    "*": (941, 1209), "0": (941, 1336), "#": (941, 1477), "D": (941, 1633),
}  # fmt: skip


def paket_bauen(pt: int, seq: int, ts: int, ssrc: int, payload: bytes, marker: bool = False) -> bytes:
    return struct.pack("!BBHII", 0x80, (0x80 if marker else 0) | (pt & 0x7F), seq & 0xFFFF, ts & 0xFFFFFFFF, ssrc) + payload


def paket_parsen(daten: bytes) -> tuple[int, int, int, int, bool, bytes] | None:
    """(Payload-Typ, Sequenz, Zeitstempel, SSRC, Marker, Nutzdaten) oder ``None`` bei ungültigen Paketen."""
    if len(daten) < 12 or daten[0] >> 6 != 2:
        return None
    cc = daten[0] & 0x0F
    kopf = 12 + 4 * cc
    if daten[0] & 0x10:  # Header-Erweiterung
        if len(daten) < kopf + 4:
            return None
        kopf += 4 + 4 * struct.unpack_from("!H", daten, kopf + 2)[0]
    ende = len(daten)
    if daten[0] & 0x20 and ende > kopf:  # Padding
        ende -= daten[-1]
    if kopf > ende:
        return None
    pt = daten[1] & 0x7F
    seq, ts, ssrc = struct.unpack_from("!HII", daten, 2)
    return pt, seq, ts, ssrc, bool(daten[1] & 0x80), daten[kopf:ende]


def dtmf_paket(ereignis: int, ende: bool, dauer: int, lautstaerke: int = 10) -> bytes:
    return struct.pack("!BBH", ereignis, (0x80 if ende else 0) | (lautstaerke & 0x3F), dauer)


def dtmf_ton(ziffer: str, dauer_ms: int = 100) -> bytes:
    """Zweiklang als PCM (8 kHz s16le) für die Übertragung im Audio-Kanal."""
    f1, f2 = DTMF_FREQ[ziffer]
    n = 8 * dauer_ms
    return array(
        "h", (int(6000 * (math.sin(2 * math.pi * f1 * i / 8000) + math.sin(2 * math.pi * f2 * i / 8000))) for i in range(n))
    ).tobytes()


class RtpSitzung(asyncio.DatagramProtocol):
    """Ein UDP-Port, eine Gegenstelle."""

    def __init__(self, port: int, host: str = "0.0.0.0", takt: float = 0.02) -> None:  # noqa: S104
        self.port = port
        self.host = host
        self.takt = takt  # Abstand der DTMF-Pakete (20 ms; in Tests verkürzbar)
        self.pt = g711.PT_PCMU
        self.dtmf_pt: int | None = None
        self.ziel: tuple[str, int] | None = None
        self.ssrc = secrets.randbits(32)
        self._seq = secrets.randbits(16)
        self._ts = secrets.randbits(32)
        self._transport: asyncio.DatagramTransport | None = None
        self._rest = bytearray()  # noch nicht verschickte Samples (< 20 ms)
        self._marker = True
        self._dtmf_aktiv = False
        self._dtmf_lock = asyncio.Lock()
        # Empfang
        self._puffer: dict[int, bytes] = {}
        self._naechste: int | None = None
        self._spielt = False
        self._lese_rest = bytearray()
        self._remote_ssrc: int | None = None
        self.pakete_gesendet = 0
        self.pakete_empfangen = 0

    # ------------------------------------------------------------------ Lebenszyklus

    async def oeffnen(self) -> None:
        loop = asyncio.get_running_loop()
        self._transport, _ = await loop.create_datagram_endpoint(lambda: self, local_addr=(self.host, self.port))
        self.port = self._transport.get_extra_info("sockname")[1]

    def schliessen(self) -> None:
        if self._transport:
            self._transport.close()
            self._transport = None

    def ziel_setzen(self, adresse: str, port: int, pt: int | None = None, dtmf_pt: int | None = None) -> None:
        self.ziel = (adresse, port)
        if pt is not None:
            self.pt = pt
        self.dtmf_pt = dtmf_pt

    # ------------------------------------------------------------------ Senden

    def _senden_roh(self, pt: int, ts: int, payload: bytes, marker: bool = False) -> None:
        if self._transport is None or self.ziel is None:
            return
        self._seq = (self._seq + 1) & 0xFFFF
        self._transport.sendto(paket_bauen(pt, self._seq, ts, self.ssrc, payload, marker), self.ziel)
        self.pakete_gesendet += 1

    def senden(self, pcm: bytes) -> None:
        """PCM (8 kHz, s16le) in 20-ms-Paketen versenden; Reste werden für den nächsten Aufruf gemerkt."""
        if self._dtmf_aktiv or self.ziel is None:
            return
        self._rest += pcm
        while len(self._rest) >= g711.RAHMEN_BYTES:
            rahmen = bytes(self._rest[: g711.RAHMEN_BYTES])
            del self._rest[: g711.RAHMEN_BYTES]
            self._senden_roh(self.pt, self._ts, g711.kodieren(rahmen, self.pt), self._marker)
            self._marker = False
            self._ts = (self._ts + g711.RAHMEN_SAMPLES) & 0xFFFFFFFF

    async def dtmf(self, ziffern: str, dauer_ms: int = 100, pause_ms: int = 60) -> None:
        """Sendet Wählzeichen nacheinander (0-9 * # A-D)."""
        ziffern = ziffern.upper()
        if any(z not in DTMF_EREIGNIS for z in ziffern):
            raise ValueError("Ungültige Wählzeichen")
        async with self._dtmf_lock:
            for z in ziffern:
                if self.dtmf_pt is None:
                    await self._dtmf_inband(z, dauer_ms)
                else:
                    await self._dtmf_rfc4733(z, dauer_ms)
                await asyncio.sleep(pause_ms / 1000 * (self.takt / 0.02))

    async def _dtmf_rfc4733(self, ziffer: str, dauer_ms: int) -> None:
        assert self.dtmf_pt is not None
        self._dtmf_aktiv = True
        try:
            ereignis = DTMF_EREIGNIS[ziffer]
            start = self._ts
            pakete = max(1, dauer_ms // 20)
            for i in range(pakete):
                self._senden_roh(self.dtmf_pt, start, dtmf_paket(ereignis, False, 160 * (i + 1)), marker=i == 0)
                await asyncio.sleep(self.takt)
            ende = dtmf_paket(ereignis, True, 160 * pakete)
            for _ in range(3):
                self._senden_roh(self.dtmf_pt, start, ende)
            self._ts = (start + 160 * pakete) & 0xFFFFFFFF
            self._marker = True
        finally:
            self._dtmf_aktiv = False

    async def _dtmf_inband(self, ziffer: str, dauer_ms: int) -> None:
        ton = dtmf_ton(ziffer, dauer_ms)
        for i in range(0, len(ton), g711.RAHMEN_BYTES):
            self.senden(ton[i : i + g711.RAHMEN_BYTES])
            await asyncio.sleep(self.takt)

    # ------------------------------------------------------------------ Empfang

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self._transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        p = paket_parsen(data)
        if p is None:
            return
        pt, seq, _ts, ssrc, _marker, payload = p
        if pt != self.pt:
            return  # telephone-event der Gegenseite, Comfort Noise u. a. werden ignoriert
        ziel = (addr[0], addr[1])
        if self.ziel != ziel:
            _LOGGER.debug("RTP: Ziel auf tatsächliche Quelle %s umgestellt", ziel)
            self.ziel = ziel  # symmetrisches RTP
        if self._remote_ssrc != ssrc:
            self._remote_ssrc = ssrc
            self._puffer.clear()
            self._naechste = None
            self._spielt = False
        self.pakete_empfangen += 1
        try:
            pcm = g711.dekodieren(payload, pt)
        except ValueError:
            return
        self._einsortieren(seq, pcm)

    def _einsortieren(self, seq: int, pcm: bytes) -> None:
        if self._naechste is None:
            self._naechste = seq
        abstand = (seq - self._naechste) & 0xFFFF
        if abstand >= 0x8000:
            return  # zu spät
        if abstand > SEQ_SPRUNG:
            self._puffer.clear()
            self._naechste = seq
            self._spielt = False
        self._puffer[seq] = pcm
        if len(self._puffer) > PUFFER_MAX:  # Rückstand abbauen: älteste Pakete verwerfen
            while len(self._puffer) > PUFFER_VORLAUF + 1:
                aelteste = min(self._puffer, key=lambda s: (s - self._naechste) & 0xFFFF)  # type: ignore[operator]
                del self._puffer[aelteste]
            self._naechste = min(self._puffer, key=lambda s: (s - self._naechste) & 0xFFFF)  # type: ignore[operator]

    def lesen(self) -> bytes:
        """Genau 20 ms PCM (320 Byte); Stille, wenn gerade nichts vorliegt."""
        while len(self._lese_rest) < g711.RAHMEN_BYTES:
            if not self._spielt:
                if len(self._puffer) < PUFFER_VORLAUF:
                    break
                self._spielt = True
            if not self._puffer:
                self._spielt = False
                break
            assert self._naechste is not None
            pcm = self._puffer.pop(self._naechste, None)
            self._naechste = (self._naechste + 1) & 0xFFFF
            self._lese_rest += pcm if pcm is not None else bytes(g711.RAHMEN_BYTES)  # Paketverlust: Stille
        if not self._lese_rest:
            return bytes(g711.RAHMEN_BYTES)
        rahmen = bytes(self._lese_rest[: g711.RAHMEN_BYTES])
        del self._lese_rest[: g711.RAHMEN_BYTES]
        return rahmen.ljust(g711.RAHMEN_BYTES, b"\0")
