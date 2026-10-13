"""Fake-FRITZ!Box für die Telefon-Tests: ein UDP-Socket auf 127.0.0.1, der als SIP-Registrar/-Gegenstelle auftritt."""

from __future__ import annotations

import asyncio
import contextlib
import socket
from collections.abc import Callable

from panelstudio.telefon import sip
from panelstudio.telefon.sip import SipNachricht

SDP_FAKE = (
    "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=fake\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\n"
    "m=audio {port} RTP/AVP 0 8 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\n"
    "a=rtpmap:101 telephone-event/8000\r\na=fmtp:101 0-16\r\na=sendrecv\r\n"
)


class FakeFritz(asyncio.DatagramProtocol):
    def __init__(self, passwort: str = "geheim", benutzer: str = "620") -> None:
        self.passwort = passwort
        self.benutzer = benutzer
        self.port = 0
        self.transport: asyncio.DatagramTransport | None = None
        self.client: tuple[str, int] | None = None
        self.eingang: asyncio.Queue[SipNachricht] = asyncio.Queue()
        self.alle: list[SipNachricht] = []
        self.registrierungen = 0
        self.proxy_auth_fuer_invite = False  # 407-Challenge für ausgehende INVITEs
        self.auto_invite = True  # ausgehenden INVITE automatisch mit 180/200 beantworten
        self.rtp_port = 0  # Port des Fake-Audio-Sockets, der im SDP steht
        self.auth_ok: list[bool] = []

    async def starten(self) -> FakeFritz:
        loop = asyncio.get_running_loop()
        self.transport, _ = await loop.create_datagram_endpoint(lambda: self, local_addr=("127.0.0.1", 0))
        self.port = self.transport.get_extra_info("sockname")[1]
        return self

    def schliessen(self) -> None:
        if self.transport:
            self.transport.close()

    # --- Empfang

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        msg = SipNachricht.parsen(data)
        self.alle.append(msg)
        if msg.ist_anfrage and msg.methode == "REGISTER":
            self.client = (addr[0], addr[1])
            self._register(msg, addr)
        elif msg.ist_anfrage and msg.methode == "INVITE" and self.auto_invite:
            self.client = (addr[0], addr[1])
            self._invite(msg, addr)
        elif msg.ist_anfrage and msg.methode in ("BYE", "CANCEL") and self.auto_invite:
            self._senden(self.antwort(msg, 200), addr)
        self.eingang.put_nowait(msg)

    async def warte(self, pred: Callable[[SipNachricht], bool], timeout: float = 5.0) -> SipNachricht:
        async def _lauf() -> SipNachricht:
            while True:
                m = await self.eingang.get()
                if pred(m):
                    return m

        return await asyncio.wait_for(_lauf(), timeout)

    def _senden(self, msg: SipNachricht, addr: tuple | None = None) -> None:
        assert self.transport
        self.transport.sendto(msg.kodieren(), addr or self.client)

    # --- Antworten bauen

    def antwort(
        self, anfrage: SipNachricht, status: int, *, body: str = "", tag: str = "fritz1", extra: dict | None = None
    ) -> SipNachricht:
        r = SipNachricht(status=status, grund=sip.GRUENDE.get(status, "X"))
        for v in anfrage.alle("via"):
            r.hinzufuegen("via", v)
        r.hinzufuegen("from", anfrage.kopf("from") or "")
        an = anfrage.kopf("to") or ""
        if not sip.tag_von(an) and status != 100:
            an += f";tag={tag}"
        r.hinzufuegen("to", an)
        r.hinzufuegen("call-id", anfrage.call_id)
        r.hinzufuegen("cseq", anfrage.kopf("cseq") or "")
        for k, w in (extra or {}).items():
            r.hinzufuegen(k, w)
        if body:
            r.hinzufuegen("contact", f"<sip:fritz@127.0.0.1:{self.port}>")
            r.hinzufuegen("content-type", "application/sdp")
            r.body = body.encode()
        return r

    def _pruefen(self, msg: SipNachricht, kopf: str) -> bool:
        wert = msg.kopf(kopf)
        if not wert:
            return False
        p = sip.challenge_parsen(wert)
        erwartet = sip.digest_antwort(
            benutzer=self.benutzer,
            passwort=self.passwort,
            methode=msg.methode or "",
            uri=p.get("uri", ""),
            challenge={"realm": "fritz.box", "nonce": "abc123", "qop": "auth"},
            nc=int(p.get("nc", "1"), 16),
            cnonce=p.get("cnonce"),
        )
        ok = sip.challenge_parsen(erwartet)["response"] == p.get("response") and p.get("username") == self.benutzer
        self.auth_ok.append(ok)
        return ok

    def _register(self, msg: SipNachricht, addr: tuple) -> None:
        if not self._pruefen(msg, "authorization"):
            ch = 'Digest realm="fritz.box", nonce="abc123", qop="auth", algorithm=MD5'
            self._senden(self.antwort(msg, 401, extra={"www-authenticate": ch}), addr)
            return
        self.registrierungen += 1
        exp = msg.kopf("expires") or "300"
        r = self.antwort(msg, 200, extra={"contact": f"<sip:{self.benutzer}@127.0.0.1:{addr[1]}>;expires={exp}"})
        # received/rport wie ein echter Registrar
        vias = r.alle("via")
        r.entfernen("via")
        r.hinzufuegen("via", f"{vias[0]};received={addr[0]};rport={addr[1]}")
        self._senden(r, addr)

    def _invite(self, msg: SipNachricht, addr: tuple) -> None:
        if self.proxy_auth_fuer_invite and not self._pruefen(msg, "proxy-authorization"):
            ch = 'Digest realm="fritz.box", nonce="abc123", qop="auth", algorithm=MD5'
            self._senden(self.antwort(msg, 407, extra={"proxy-authenticate": ch}), addr)
            return
        self._senden(self.antwort(msg, 100), addr)
        self._senden(self.antwort(msg, 180), addr)
        self._senden(self.antwort(msg, 200, body=SDP_FAKE.format(port=self.rtp_port)), addr)

    # --- Anfragen der Gegenstelle

    def anfrage(
        self, methode: str, uri: str, *, von: str, an: str, call_id: str, cseq: int, branch: str, body: str = "",
        koepfe: list[tuple[str, str]] | None = None,
    ) -> bytes:  # fmt: skip
        m = SipNachricht(methode=methode, uri=uri)
        m.hinzufuegen("via", f"SIP/2.0/UDP 127.0.0.1:{self.port};branch={branch}")
        m.hinzufuegen("max-forwards", "70")
        m.hinzufuegen("from", von)
        m.hinzufuegen("to", an)
        m.hinzufuegen("call-id", call_id)
        m.hinzufuegen("cseq", f"{cseq} {methode}")
        m.hinzufuegen("contact", f"<sip:anrufer@127.0.0.1:{self.port}>")
        for name, wert in koepfe or []:
            m.hinzufuegen(name, wert)
        if body:
            m.hinzufuegen("content-type", "application/sdp")
            m.body = body.encode()
        return m.kodieren()

    def sende_roh(self, roh: bytes) -> None:
        assert self.transport and self.client
        self.transport.sendto(roh, self.client)


class FakeAudio(asyncio.DatagramProtocol):
    """UDP-Socket, der RTP-Pakete der Telefon-Seite sammelt."""

    def __init__(self) -> None:
        self.pakete: list[tuple[bytes, tuple]] = []
        self.transport: asyncio.DatagramTransport | None = None
        self.port = 0

    async def starten(self) -> FakeAudio:
        loop = asyncio.get_running_loop()
        self.transport, _ = await loop.create_datagram_endpoint(lambda: self, local_addr=("127.0.0.1", 0))
        self.port = self.transport.get_extra_info("sockname")[1]
        return self

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        self.pakete.append((data, addr))

    def schliessen(self) -> None:
        if self.transport:
            self.transport.close()


def freier_udp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def bis(bedingung: Callable[[], bool], timeout: float = 5.0) -> None:
    async def _lauf() -> None:
        while not bedingung():  # noqa: ASYNC110
            await asyncio.sleep(0.02)

    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(_lauf(), timeout)
    assert bedingung(), "Bedingung nicht rechtzeitig erfüllt"
