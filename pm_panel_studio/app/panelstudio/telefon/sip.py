"""Minimaler SIP-Benutzeragent über UDP (RFC 3261, Teilmenge) für eine FRITZ!Box im LAN.

Umfang:
  * REGISTER mit Digest-Anmeldung (MD5, qop=auth), erneute Anmeldung vor Ablauf, Abmeldung beim Beenden
  * NAT-Erkennung über ``rport``/``received`` (Docker-Bridge mit 1:1 veröffentlichtem Port)
  * eingehender Anruf: 100/180, Annehmen (200 + SDP, Wiederholung bis ACK), Ablehnen, CANCEL, BYE, OPTIONS
  * ausgehender Anruf mit Digest-Anmeldung (401/407), ACK, CANCEL, BYE
  * SDP-Angebot/-Antwort mit PCMU (0), PCMA (8) und telephone-event

Es gibt höchstens einen Anruf gleichzeitig; ein zweiter INVITE wird mit 486 beantwortet. Alle Anfragen gehen an
den konfigurierten Server (die FRITZ!Box ist Registrar und Proxy zugleich), Antworten an die Absenderadresse der
Anfrage. Route-Sets werden bewusst nicht ausgewertet.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import re
import secrets
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import quote, unquote

from .g711 import PT_PCMA, PT_PCMU

_LOGGER = logging.getLogger(__name__)

USER_AGENT = "PM-Panel-Studio"
DTMF_PT = 101
ERLAUBT = "INVITE, ACK, CANCEL, BYE, OPTIONS, NOTIFY, INFO, UPDATE"
CRLF = "\r\n"
KOMPAKT = {
    "i": "call-id",
    "m": "contact",
    "v": "via",
    "f": "from",
    "t": "to",
    "l": "content-length",
    "c": "content-type",
    "k": "supported",
    "e": "content-encoding",
    "s": "subject",
}
SCHREIBWEISE = {
    "call-id": "Call-ID",
    "cseq": "CSeq",
    "www-authenticate": "WWW-Authenticate",
    "proxy-authenticate": "Proxy-Authenticate",
    "user-agent": "User-Agent",
    "www-authorization": "Authorization",
}
GRUENDE = {
    100: "Trying",
    180: "Ringing",
    200: "OK",
    400: "Bad Request",
    405: "Method Not Allowed",
    481: "Call/Transaction Does Not Exist",
    486: "Busy Here",
    487: "Request Terminated",
    488: "Not Acceptable Here",
    603: "Decline",
}


class SipFehler(Exception):
    """Fehler im SIP-Ablauf (Meldungstext ist für die Anzeige gedacht)."""


# --------------------------------------------------------------------------- Nachrichten


def neuer_branch() -> str:
    return "z9hG4bK" + secrets.token_hex(6)


def neuer_tag() -> str:
    return secrets.token_hex(5)


class SipNachricht:
    """Eine SIP-Anfrage oder -Antwort. Kopfnamen werden klein geschrieben gespeichert, Compact Forms aufgelöst."""

    def __init__(
        self,
        *,
        methode: str | None = None,
        uri: str = "",
        status: int | None = None,
        grund: str = "",
        koepfe: list[tuple[str, str]] | None = None,
        body: bytes = b"",
    ) -> None:
        self.methode = methode
        self.uri = uri
        self.status = status
        self.grund = grund
        self.koepfe: list[tuple[str, str]] = koepfe if koepfe is not None else []
        self.body = body

    @property
    def ist_anfrage(self) -> bool:
        return self.methode is not None

    # --- Zugriff

    def kopf(self, name: str) -> str | None:
        name = name.lower()
        for n, w in self.koepfe:
            if n == name:
                return w
        return None

    def alle(self, name: str) -> list[str]:
        """Alle Werte eines Kopfes; kommagetrennte Via-Zeilen werden aufgeteilt."""
        name = name.lower()
        werte = [w for n, w in self.koepfe if n == name]
        if name == "via":
            werte = [teil.strip() for w in werte for teil in w.split(",") if teil.strip()]
        return werte

    def hinzufuegen(self, name: str, wert: str) -> None:
        self.koepfe.append((name.lower(), wert))

    def vorne(self, name: str, wert: str) -> None:
        self.koepfe.insert(0, (name.lower(), wert))

    def setzen(self, name: str, wert: str) -> None:
        name = name.lower()
        self.entfernen(name)
        self.koepfe.append((name, wert))

    def entfernen(self, name: str) -> None:
        name = name.lower()
        self.koepfe = [(n, w) for n, w in self.koepfe if n != name]

    def kopie(self) -> SipNachricht:
        return SipNachricht(
            methode=self.methode, uri=self.uri, status=self.status, grund=self.grund, koepfe=list(self.koepfe), body=self.body
        )

    # --- häufige Köpfe

    @property
    def call_id(self) -> str:
        return (self.kopf("call-id") or "").strip()

    def cseq(self) -> tuple[int, str]:
        teile = (self.kopf("cseq") or "").split()
        if len(teile) != 2 or not teile[0].isdigit():
            raise SipFehler("Ungültiger CSeq")
        return int(teile[0]), teile[1].upper()

    def via_oben(self) -> dict[str, str]:
        """Parameter des obersten Via-Kopfes (branch, received, rport ...)."""
        vias = self.alle("via")
        if not vias:
            return {}
        return via_parameter(vias[0])

    @property
    def branch(self) -> str:
        return self.via_oben().get("branch", "")

    # --- Serialisierung

    def kodieren(self) -> bytes:
        start = f"{self.methode} {self.uri} SIP/2.0" if self.ist_anfrage else f"SIP/2.0 {self.status} {self.grund}"
        zeilen = [start]
        for n, w in self.koepfe:
            if n == "content-length":
                continue
            zeilen.append(f"{SCHREIBWEISE.get(n, '-'.join(t.capitalize() for t in n.split('-')))}: {w}")
        zeilen.append(f"Content-Length: {len(self.body)}")
        return (CRLF.join(zeilen) + CRLF + CRLF).encode("utf-8") + self.body

    @classmethod
    def parsen(cls, daten: bytes) -> SipNachricht:
        daten = daten.lstrip(b"\r\n")  # Keep-alive-CRLFs vor der Nachricht
        if not daten:
            raise SipFehler("Leere Nachricht")
        for trenner in (b"\r\n\r\n", b"\n\n"):
            if trenner in daten:
                kopf, _, body = daten.partition(trenner)
                break
        else:
            kopf, body = daten, b""
        text = kopf.decode("utf-8", errors="replace")
        zeilen: list[str] = []
        for z in text.replace("\r\n", "\n").split("\n"):
            if z[:1] in (" ", "\t") and zeilen:  # Zeilenfortsetzung
                zeilen[-1] += " " + z.strip()
            else:
                zeilen.append(z)
        if not zeilen or not zeilen[0].strip():
            raise SipFehler("Keine Startzeile")
        start = zeilen[0].strip()
        msg = cls()
        if start.upper().startswith("SIP/2.0"):
            teile = start.split(None, 2)
            if len(teile) < 2 or not teile[1].isdigit():
                raise SipFehler("Ungültige Statuszeile")
            msg.status = int(teile[1])
            msg.grund = teile[2] if len(teile) > 2 else ""
        else:
            teile = start.split()
            if len(teile) != 3 or not teile[2].upper().startswith("SIP/"):
                raise SipFehler("Ungültige Anfragezeile")
            msg.methode = teile[0].upper()
            msg.uri = teile[1]
        for z in zeilen[1:]:
            if not z.strip():
                continue
            name, doppelpunkt, wert = z.partition(":")
            if not doppelpunkt:
                raise SipFehler("Ungültiger Kopf")
            name = name.strip().lower()
            msg.koepfe.append((KOMPAKT.get(name, name), wert.strip()))
        laenge = msg.kopf("content-length")
        if laenge is not None and laenge.strip().isdigit():
            body = body[: int(laenge.strip())]
        msg.body = body
        return msg


def via_parameter(via: str) -> dict[str, str]:
    teile = via.split(";")
    params: dict[str, str] = {}
    for t in teile[1:]:
        k, _, v = t.strip().partition("=")
        params[k.lower()] = v.strip()
    return params


def adresse_parsen(wert: str) -> tuple[str, str, dict[str, str]]:
    """Zerlegt ``"Name" <sip:user@host>;tag=x`` in (Anzeigename, URI, Parameter)."""
    wert = wert.strip()
    anzeige = ""
    if "<" in wert and ">" in wert:
        vor, _, rest = wert.partition("<")
        uri, _, nach = rest.partition(">")
        anzeige = vor.strip().strip('"').strip()
        parameter = nach
    else:
        uri, _, parameter = wert.partition(";")
        parameter = ";" + parameter if parameter else ""
    params: dict[str, str] = {}
    for t in parameter.split(";"):
        if t.strip():
            k, _, v = t.strip().partition("=")
            params[k.lower()] = v.strip()
    return anzeige, uri.strip(), params


def uri_teile(uri: str) -> tuple[str, str, int | None]:
    """(Benutzer, Host, Port) einer SIP-URI."""
    uri = uri.strip()
    if ":" in uri and uri.split(":", 1)[0].lower() in ("sip", "sips", "tel"):
        uri = uri.split(":", 1)[1]
    uri = uri.split(";", 1)[0].split("?", 1)[0]
    benutzer = ""
    if "@" in uri:
        benutzer, _, uri = uri.rpartition("@")
        benutzer = unquote(benutzer.split(":", 1)[0])
    host, port = uri, None
    if uri.startswith("["):
        host, _, rest = uri[1:].partition("]")
        if rest.startswith(":") and rest[1:].isdigit():
            port = int(rest[1:])
    elif ":" in uri:
        host, _, p = uri.partition(":")
        port = int(p) if p.isdigit() else None
    return benutzer, host, port


def tag_von(wert: str | None) -> str:
    return adresse_parsen(wert)[2].get("tag", "") if wert else ""


# --------------------------------------------------------------------------- Digest


def challenge_parsen(wert: str) -> dict[str, str]:
    """``Digest realm="x", nonce="y", qop="auth"`` → Wörterbuch (Schlüssel klein)."""
    wert = wert.strip()
    if wert.lower().startswith("digest"):
        wert = wert[6:]
    erg: dict[str, str] = {}
    for m in re.finditer(r'(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]*))', wert):
        erg[m.group(1).lower()] = m.group(2) if m.group(2) is not None else m.group(3)
    return erg


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8"), usedforsecurity=False).hexdigest()


def digest_antwort(
    *, benutzer: str, passwort: str, methode: str, uri: str, challenge: dict[str, str], nc: int = 1, cnonce: str | None = None
) -> str:
    """Wert für den Authorization-/Proxy-Authorization-Kopf (MD5, optional qop=auth)."""
    realm = challenge.get("realm", "")
    nonce = challenge.get("nonce", "")
    algo = challenge.get("algorithm", "MD5").upper()
    if algo not in ("MD5", "MD5-SESS"):
        raise SipFehler(f"Digest-Algorithmus {algo} wird nicht unterstützt")
    qops = [q.strip().lower() for q in challenge.get("qop", "").split(",") if q.strip()]
    cnonce = cnonce or secrets.token_hex(8)
    ha1 = _md5(f"{benutzer}:{realm}:{passwort}")
    if algo == "MD5-SESS":
        ha1 = _md5(f"{ha1}:{nonce}:{cnonce}")
    ha2 = _md5(f"{methode}:{uri}")
    teile = [f'username="{benutzer}"', f'realm="{realm}"', f'nonce="{nonce}"', f'uri="{uri}"']
    if "auth" in qops:
        ncs = f"{nc:08x}"
        antwort = _md5(f"{ha1}:{nonce}:{ncs}:{cnonce}:auth:{ha2}")
        teile += [f'response="{antwort}"', f"algorithm={algo}", "qop=auth", f"nc={ncs}", f'cnonce="{cnonce}"']
    else:
        teile += [f'response="{_md5(f"{ha1}:{nonce}:{ha2}")}"', f"algorithm={algo}"]
    if "opaque" in challenge:
        teile.append(f'opaque="{challenge["opaque"]}"')
    return "Digest " + ", ".join(teile)


# --------------------------------------------------------------------------- SDP


@dataclass
class Sdp:
    adresse: str
    port: int
    codecs: list[int]  # nur PCMU (0) / PCMA (8), in der Reihenfolge des Angebots
    dtmf_pt: int | None = None


def sdp_parsen(text: str) -> Sdp:
    """Liest Adresse, Port und die brauchbaren Codecs aus dem ersten Audio-Abschnitt."""
    sitzung_c = ""
    medium_c = ""
    pts: list[int] = []
    rtpmap: dict[int, str] = {}
    port = 0
    im_audio = False
    gefunden = False
    for zeile in text.replace("\r\n", "\n").split("\n"):
        zeile = zeile.strip()
        if zeile.startswith("m="):
            if gefunden:
                break
            teile = zeile[2:].split()
            im_audio = len(teile) >= 4 and teile[0] == "audio"
            if im_audio:
                gefunden = True
                port = int(teile[1]) if teile[1].isdigit() else 0
                pts = [int(p) for p in teile[3:] if p.isdigit()]
        elif zeile.startswith("c=") and len(zeile.split()) >= 3:
            adr = zeile.split()[2].split("/")[0]
            if im_audio:
                medium_c = adr
            elif not gefunden:
                sitzung_c = adr
        elif zeile.startswith("a=rtpmap:") and im_audio:
            nr, _, name = zeile[9:].partition(" ")
            if nr.isdigit():
                rtpmap[int(nr)] = name.strip().lower()
    if not gefunden:
        raise SipFehler("Kein Audio im SDP")
    adresse = medium_c or sitzung_c
    if not adresse or port <= 0:
        raise SipFehler("Audio im SDP abgelehnt")
    codecs = [p for p in pts if p in (PT_PCMU, PT_PCMA)]
    dtmf = next((p for p in pts if rtpmap.get(p, "").startswith("telephone-event/8000")), None)
    return Sdp(adresse=adresse, port=port, codecs=codecs, dtmf_pt=dtmf)


def sdp_bauen(adresse: str, port: int, codecs: list[int], dtmf_pt: int | None = DTMF_PT) -> str:
    pts = list(codecs) + ([dtmf_pt] if dtmf_pt is not None else [])
    zeilen = [
        "v=0",
        f"o=- {int(time.time())} {int(time.time())} IN IP4 {adresse}",
        "s=PM Panel Studio",
        f"c=IN IP4 {adresse}",
        "t=0 0",
        f"m=audio {port} RTP/AVP {' '.join(str(p) for p in pts)}",
    ]
    namen = {PT_PCMU: "PCMU/8000", PT_PCMA: "PCMA/8000"}
    zeilen += [f"a=rtpmap:{p} {namen[p]}" for p in codecs]
    if dtmf_pt is not None:
        zeilen += [f"a=rtpmap:{dtmf_pt} telephone-event/8000", f"a=fmtp:{dtmf_pt} 0-16"]
    zeilen += ["a=ptime:20", "a=sendrecv"]
    return CRLF.join(zeilen) + CRLF


# --------------------------------------------------------------------------- Konfiguration und Anruf


@dataclass
class SipConfig:
    server: str
    port: int = 5060
    benutzer: str = ""
    passwort: str = ""
    anzeigename: str = "Panel"
    lokaler_port: int = 5062
    externe_adresse: str = ""
    bind: str = "0.0.0.0"  # noqa: S104 - im Container gewollt
    ablauf_s: int = 300  # angeforderte Registrierungsdauer
    t1: float = 0.5  # SIP-Timer T1
    klingel_timeout_s: float = 90.0  # ausgehend: so lange auf eine Antwort warten
    wiederholung_s: float = 10.0  # Pause nach fehlgeschlagener Anmeldung (verdoppelt sich bis 60 s)


class SipAnruf:
    """Zustand eines Anrufs (Dialog, SDP, RTP-Daten). Wird vom Agenten gepflegt, vom Aufrufer nur gelesen."""

    def __init__(self, richtung: str, call_id: str) -> None:
        self.id = secrets.token_hex(6)
        self.richtung = richtung  # "ein" | "aus"
        self.call_id = call_id
        self.nummer = ""
        self.anzeigename = ""
        self.zustand = "klingelt" if richtung == "ein" else "waehlt"
        self.grund: str | None = None
        self.lokal_tag = neuer_tag()
        self.peer: tuple[str, int] = ("", 0)
        self.remote_kontakt = ""
        self.remote_sdp: Sdp | None = None
        self.codec = PT_PCMU
        self.dtmf_pt: int | None = None
        self.rtp_port = 0
        self.dlg_von = ""  # From-Kopf unserer Anfragen im Dialog
        self.dlg_an = ""  # To-Kopf unserer Anfragen im Dialog
        self.cseq = 0
        self.angebot: SipNachricht | None = None  # eingehend: der INVITE
        self.invite: SipNachricht | None = None  # ausgehend: der aktuelle INVITE
        self.letzte_antwort: bytes | None = None
        self.vorlaeufig_gesehen = False
        self.abbruch = False
        self.cancel_gesendet = False
        self.task: asyncio.Task | None = None

    def naechste_cseq(self) -> int:
        self.cseq += 1
        return self.cseq


class _Protokoll(asyncio.DatagramProtocol):
    def __init__(self, agent: SipAgent) -> None:
        self.agent = agent

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        try:
            self.agent._empfangen(data, (addr[0], addr[1]))
        except Exception:
            _LOGGER.exception("SIP: Fehler bei der Verarbeitung einer Nachricht")

    def error_received(self, exc: Exception) -> None:
        _LOGGER.debug("SIP: UDP-Fehler: %s", exc)


@dataclass
class _Txn:
    roh: bytes
    ziel: tuple[str, int]
    invite: bool
    future: asyncio.Future
    auf_vorlaeufig: Callable[[SipNachricht], None] | None = None
    vorlaeufig: bool = False


def grund_fuer_status(status: int) -> str:
    """Kurzer deutscher Grund für das Ende eines ausgehenden Anrufs."""
    if status in (486, 600):
        return "Besetzt"
    if status in (603, 403):
        return "Abgelehnt"
    if status in (404, 410, 604, 484):
        return "Nummer nicht erreichbar"
    if status in (408, 480):
        return "Keine Antwort"
    if status == 487:
        return "Abgebrochen"
    return f"SIP-Fehler {status}"


# --------------------------------------------------------------------------- Agent


class SipAgent:
    """SIP-Benutzeragent: Anmeldung am Server und höchstens ein Anruf."""

    def __init__(
        self,
        cfg: SipConfig,
        auf_status: Callable[[], None] | None = None,
        auf_anruf: Callable[[SipAnruf], None] | None = None,
        auf_aenderung: Callable[[SipAnruf], None] | None = None,
    ) -> None:
        self.cfg = cfg
        self._auf_status = auf_status or (lambda: None)
        self._auf_anruf = auf_anruf or (lambda _a: None)
        self._auf_aenderung = auf_aenderung or (lambda _a: None)
        self.registriert = False
        self.fehler: str | None = None
        self.anruf: SipAnruf | None = None
        self.lokaler_port = cfg.lokaler_port
        self._transport: asyncio.DatagramTransport | None = None
        self._server: tuple[str, int] = ("", 0)
        self._server_ips: set[str] = set()
        self._lokale_ip = "127.0.0.1"
        self._oeffentlich: tuple[str, int] | None = None
        self._reg_call_id = f"{secrets.token_hex(8)}@pmps"
        self._reg_cseq = 0
        self._reg_tag = neuer_tag()
        self._txns: dict[tuple[str, str], _Txn] = {}
        self._srv_cache: dict[tuple[str, str], tuple[bytes, tuple[str, int], float]] = {}
        self._acks: dict[str, bytes] = {}  # Call-ID -> letzter ACK (für Wiederholungen der Antwort)
        self._ack_ereignisse: dict[str, asyncio.Event] = {}
        self._tasks: set[asyncio.Task] = set()
        self._schleife: asyncio.Task | None = None
        self._neu_anmelden = asyncio.Event()
        self._laeuft = False

    # ------------------------------------------------------------------ Lebenszyklus

    async def start(self) -> None:
        loop = asyncio.get_running_loop()
        self._transport, _ = await loop.create_datagram_endpoint(
            lambda: _Protokoll(self), local_addr=(self.cfg.bind, self.cfg.lokaler_port)
        )
        self.lokaler_port = self._transport.get_extra_info("sockname")[1]
        self._laeuft = True
        self._schleife = asyncio.create_task(self._anmelde_schleife())

    async def stop(self) -> None:
        self._laeuft = False
        if self._schleife:
            self._schleife.cancel()
            await asyncio.gather(self._schleife, return_exceptions=True)
            self._schleife = None
        anruf = self.anruf
        if anruf and anruf.zustand != "beendet":
            with contextlib.suppress(Exception):
                await self.auflegen(anruf)
        if self._tasks:
            _fertig, offen = await asyncio.wait(list(self._tasks), timeout=3)
            for t in offen:
                t.cancel()
        if self.registriert and self._transport:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._registrieren(0), timeout=3)
        self._setze_status(False, self.fehler)
        if self._transport:
            self._transport.close()
            self._transport = None

    # ------------------------------------------------------------------ Hilfen

    def _setze_status(self, registriert: bool, fehler: str | None) -> None:
        if registriert != self.registriert or fehler != self.fehler:
            self.registriert = registriert
            self.fehler = fehler
            self._melde(self._auf_status)

    @staticmethod
    def _melde(f: Callable, *args) -> None:
        try:
            f(*args)
        except Exception:
            _LOGGER.exception("SIP: Rückruf fehlgeschlagen")

    def _hintergrund(self, coro) -> asyncio.Task:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    def _adresse(self) -> tuple[str, int]:
        """Adresse, die in Via, Contact und SDP angegeben wird."""
        if self.cfg.externe_adresse:
            return self.cfg.externe_adresse, self.lokaler_port
        if self._oeffentlich:
            return self._oeffentlich
        return self._lokale_ip, self.lokaler_port

    def _sdp_adresse(self) -> str:
        return self._adresse()[0]

    def _senden(self, roh: bytes, ziel: tuple[str, int]) -> None:
        if self._transport:
            self._transport.sendto(roh, ziel)

    async def _server_aufloesen(self) -> None:
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(self.cfg.server, self.cfg.port, family=socket.AF_INET, type=socket.SOCK_DGRAM)
        if not infos:
            raise SipFehler("Server nicht gefunden")
        self._server_ips = {i[4][0] for i in infos}
        self._server = (infos[0][4][0], self.cfg.port)
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(self._server)
                self._lokale_ip = s.getsockname()[0]
        except OSError:
            pass

    @property
    def _server_host(self) -> str:
        return self.cfg.server if self.cfg.port == 5060 else f"{self.cfg.server}:{self.cfg.port}"

    def _kontakt(self) -> str:
        ip, port = self._adresse()
        return f"<sip:{self.cfg.benutzer}@{ip}:{port}>"

    def _anfrage(
        self,
        methode: str,
        uri: str,
        *,
        von: str,
        an: str,
        call_id: str,
        cseq: int,
        branch: str | None = None,
        body: str = "",
        kontakt: bool = True,
    ) -> SipNachricht:
        ip, port = self._adresse()
        m = SipNachricht(methode=methode, uri=uri)
        m.hinzufuegen("via", f"SIP/2.0/UDP {ip}:{port};rport;branch={branch or neuer_branch()}")
        m.hinzufuegen("max-forwards", "70")
        m.hinzufuegen("from", von)
        m.hinzufuegen("to", an)
        m.hinzufuegen("call-id", call_id)
        m.hinzufuegen("cseq", f"{cseq} {methode}")
        if kontakt:
            m.hinzufuegen("contact", self._kontakt())
        m.hinzufuegen("allow", ERLAUBT)
        m.hinzufuegen("user-agent", USER_AGENT)
        if body:
            m.hinzufuegen("content-type", "application/sdp")
            m.body = body.encode("utf-8")
        return m

    def _antwort(
        self,
        anfrage: SipNachricht,
        status: int,
        *,
        an_tag: str | None = None,
        body: str = "",
        kontakt: bool = False,
    ) -> SipNachricht:
        r = SipNachricht(status=status, grund=GRUENDE.get(status, "Unknown"))
        for v in anfrage.alle("via"):
            r.hinzufuegen("via", v)
        r.hinzufuegen("from", anfrage.kopf("from") or "")
        an = anfrage.kopf("to") or ""
        if status != 100 and not tag_von(an):
            an += f";tag={an_tag or neuer_tag()}"
        r.hinzufuegen("to", an)
        r.hinzufuegen("call-id", anfrage.call_id)
        r.hinzufuegen("cseq", anfrage.kopf("cseq") or "")
        if kontakt:
            r.hinzufuegen("contact", self._kontakt())
        r.hinzufuegen("allow", ERLAUBT)
        r.hinzufuegen("user-agent", USER_AGENT)
        if body:
            r.hinzufuegen("content-type", "application/sdp")
            r.body = body.encode("utf-8")
        return r

    # ------------------------------------------------------------------ Transaktionen (Client)

    async def _transaktion(
        self,
        msg: SipNachricht,
        ziel: tuple[str, int],
        auf_vorlaeufig: Callable[[SipNachricht], None] | None = None,
        gesamt_timeout: float = 0.0,
    ) -> SipNachricht:
        """Sendet eine Anfrage mit Wiederholungen (Timer A/E) und liefert die Schlussantwort."""
        t1 = self.cfg.t1
        loop = asyncio.get_running_loop()
        invite = msg.methode == "INVITE"
        txn = _Txn(roh=msg.kodieren(), ziel=ziel, invite=invite, future=loop.create_future(), auf_vorlaeufig=auf_vorlaeufig)
        key = (msg.branch, msg.methode or "")
        self._txns[key] = txn
        beginn = loop.time()
        intervall = t1
        try:
            self._senden(txn.roh, ziel)
            while True:
                jetzt = loop.time()
                if invite and txn.vorlaeufig:
                    warte = beginn + max(gesamt_timeout, 64 * t1) - jetzt
                else:
                    warte = min(intervall, beginn + 64 * t1 - jetzt)
                if warte <= 0:
                    raise TimeoutError("Keine Antwort vom SIP-Server")
                fertig, _ = await asyncio.wait({txn.future}, timeout=warte)
                if fertig:
                    return txn.future.result()
                if invite and txn.vorlaeufig:
                    continue
                if loop.time() >= beginn + 64 * t1:
                    raise TimeoutError("Keine Antwort vom SIP-Server")
                self._senden(txn.roh, ziel)
                intervall = min(intervall * 2, 8 * t1)
        finally:
            self._txns.pop(key, None)

    async def _anfrage_mit_auth(self, msg: SipNachricht, ziel: tuple[str, int], *, versuche: int = 3) -> SipNachricht:
        """Sendet eine Anfrage und wiederholt sie einmal mit Digest-Anmeldung, falls 401/407 kommt."""
        for runde in range(versuche):
            antwort = await self._transaktion(msg, ziel)
            if antwort.status in (401, 407) and runde < versuche - 1:
                msg = self._mit_auth(msg, antwort)
                continue
            return antwort
        raise SipFehler("Anmeldung fehlgeschlagen")  # pragma: no cover

    def _mit_auth(self, msg: SipNachricht, antwort: SipNachricht) -> SipNachricht:
        """Kopie der Anfrage mit Authorization-Kopf, neuem Branch und erhöhtem CSeq."""
        proxy = antwort.status == 407
        roh = antwort.kopf("proxy-authenticate" if proxy else "www-authenticate")
        if not roh:
            raise SipFehler("Anmeldeaufforderung ohne Challenge")
        challenge = challenge_parsen(roh)
        neu = msg.kopie()
        neu.entfernen("authorization")
        neu.entfernen("proxy-authorization")
        nr, methode = neu.cseq()
        neu.setzen("cseq", f"{nr + 1} {methode}")
        vias = neu.alle("via")
        if vias:
            start, _, params = vias[0].partition(";")
            teile = [p for p in params.split(";") if p and not p.lower().startswith("branch=")]
            neu.entfernen("via")
            neu.hinzufuegen("via", ";".join([start, *teile, f"branch={neuer_branch()}"]))
        neu.hinzufuegen(
            "proxy-authorization" if proxy else "authorization",
            digest_antwort(
                benutzer=self.cfg.benutzer, passwort=self.cfg.passwort, methode=methode, uri=neu.uri, challenge=challenge
            ),
        )
        return neu

    # ------------------------------------------------------------------ Registrierung

    def _reg_nachricht(self, ablauf: int) -> SipNachricht:
        self._reg_cseq += 1
        uri = f"sip:{self._server_host}"
        eigene = f"sip:{self.cfg.benutzer}@{self.cfg.server}"
        anzeige = self.cfg.anzeigename.replace('"', "")
        m = self._anfrage(
            "REGISTER",
            uri,
            von=f'"{anzeige}" <{eigene}>;tag={self._reg_tag}',
            an=f"<{eigene}>",
            call_id=self._reg_call_id,
            cseq=self._reg_cseq,
            kontakt=False,
        )
        m.hinzufuegen("contact", f"{self._kontakt()};expires={ablauf}")
        m.hinzufuegen("expires", str(ablauf))
        return m

    async def _registrieren(self, ablauf: int) -> int:
        """Ein REGISTER-Durchlauf. Rückgabe: gewährte Dauer in Sekunden, ``-1`` = Adresse gelernt, sofort neu anmelden."""
        msg = self._reg_nachricht(ablauf)
        antwort = await self._anfrage_mit_auth(msg, self._server, versuche=3)
        self._reg_cseq = max(self._reg_cseq, antwort.cseq()[0] if antwort.kopf("cseq") else 0)
        if antwort.status in (401, 403, 407):
            raise SipFehler("Anmeldung abgelehnt (Benutzer oder Passwort falsch?)")
        if antwort.status != 200:
            raise SipFehler(f"Anmeldung fehlgeschlagen: SIP {antwort.status} {antwort.grund}")
        if ablauf == 0:
            return 0
        gewaehrt = ablauf
        for c in antwort.alle("contact"):
            _, uri, params = adresse_parsen(c)
            if uri_teile(uri)[0] == self.cfg.benutzer and params.get("expires", "").isdigit():
                gewaehrt = int(params["expires"])
                break
        else:
            exp = (antwort.kopf("expires") or "").strip()
            if exp.isdigit():
                gewaehrt = int(exp)
        # Öffentliche Adresse aus received/rport lernen
        if not self.cfg.externe_adresse:
            via = antwort.via_oben()
            ip = via.get("received") or self._adresse()[0]
            port = int(via["rport"]) if via.get("rport", "").isdigit() else self._adresse()[1]
            if (ip, port) != self._adresse():
                _LOGGER.info("SIP: öffentliche Adresse erkannt: %s:%s", ip, port)
                self._oeffentlich = (ip, port)
                return -1
        return max(gewaehrt, 1)

    async def _anmelde_schleife(self) -> None:
        pause = self.cfg.wiederholung_s
        sofort = 0
        while True:
            try:
                await self._server_aufloesen()
                gewaehrt = await self._registrieren(self.cfg.ablauf_s)
                if gewaehrt == -1 and sofort < 3:
                    sofort += 1
                    continue
                sofort = 0
                self._setze_status(True, None)
                pause = self.cfg.wiederholung_s
                warte = max(1.0, (gewaehrt if gewaehrt > 0 else self.cfg.ablauf_s) * 0.8)
            except asyncio.CancelledError:
                raise
            except TimeoutError:
                self._setze_status(False, "Keine Antwort vom SIP-Server")
                warte, pause = pause, min(pause * 2, 60)
            except (SipFehler, OSError) as exc:
                self._setze_status(False, str(exc))
                warte, pause = pause, min(pause * 2, 60)
            except Exception as exc:
                _LOGGER.exception("SIP: unerwarteter Fehler bei der Anmeldung")
                self._setze_status(False, f"Fehler: {exc}")
                warte, pause = pause, min(pause * 2, 60)
            self._neu_anmelden.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._neu_anmelden.wait(), timeout=warte)

    # ------------------------------------------------------------------ Empfang

    def _empfangen(self, daten: bytes, addr: tuple[str, int]) -> None:
        if self._server_ips and addr[0] not in self._server_ips:
            _LOGGER.debug("SIP: Paket von fremder Adresse %s verworfen", addr[0])
            return
        try:
            msg = SipNachricht.parsen(daten)
        except SipFehler as exc:
            _LOGGER.debug("SIP: ungültige Nachricht verworfen: %s", exc)
            return
        if msg.ist_anfrage:
            self._anfrage_behandeln(msg, addr)
        else:
            self._antwort_behandeln(msg)

    def _antwort_behandeln(self, msg: SipNachricht) -> None:
        try:
            _nr, methode = msg.cseq()
        except SipFehler:
            return
        txn = self._txns.get((msg.branch, methode))
        status = msg.status or 0
        if txn is None:
            # Wiederholte Schlussantwort auf einen INVITE: erneut bestätigen
            if methode == "INVITE" and status >= 200:
                ack = self._acks.get(msg.call_id)
                if ack:
                    self._senden(ack, self._server)
            return
        if status < 200:
            txn.vorlaeufig = True
            if txn.auf_vorlaeufig:
                self._melde(txn.auf_vorlaeufig, msg)
        elif not txn.future.done():
            txn.future.set_result(msg)

    def _antworten(self, anfrage: SipNachricht, addr: tuple[str, int], status: int, **kw) -> SipNachricht:
        r = self._antwort(anfrage, status, **kw)
        roh = r.kodieren()
        self._senden(roh, addr)
        if anfrage.methode not in ("ACK",) and status >= 200:
            self._cache_merken((anfrage.branch, anfrage.methode or ""), roh, addr)
        return r

    def _cache_merken(self, key: tuple[str, str], roh: bytes, addr: tuple[str, int]) -> None:
        jetzt = time.monotonic()
        self._srv_cache[key] = (roh, addr, jetzt)
        if len(self._srv_cache) > 50:
            for k in [k for k, v in self._srv_cache.items() if jetzt - v[2] > 40]:
                del self._srv_cache[k]

    def _anfrage_behandeln(self, msg: SipNachricht, addr: tuple[str, int]) -> None:
        methode = msg.methode
        if methode == "ACK":
            self._ack_empfangen(msg)
            return
        if methode != "INVITE":
            gemerkt = self._srv_cache.get((msg.branch, methode or ""))
            if gemerkt:  # Wiederholung einer bereits beantworteten Anfrage
                self._senden(gemerkt[0], gemerkt[1])
                return
        try:
            msg.cseq()
        except SipFehler:
            self._antworten(msg, addr, 400)
            return
        if methode == "INVITE":
            self._invite_empfangen(msg, addr)
        elif methode == "CANCEL":
            self._cancel_empfangen(msg, addr)
        elif methode == "BYE":
            self._bye_empfangen(msg, addr)
        elif methode in ("OPTIONS", "NOTIFY", "INFO", "MESSAGE", "UPDATE"):
            self._antworten(msg, addr, 200)
        else:
            self._antworten(msg, addr, 405)

    # ------------------------------------------------------------------ Anruf-Zustand

    def _zustand(self, anruf: SipAnruf, zustand: str, grund: str | None = None) -> None:
        if anruf.zustand == "beendet":
            return
        anruf.zustand = zustand
        if grund is not None:
            anruf.grund = grund
        self._melde(self._auf_aenderung, anruf)

    def _ende(self, anruf: SipAnruf, grund: str) -> None:
        """Beendet den Anruf lokal (idempotent) und gibt den Agenten frei."""
        if anruf.zustand == "beendet":
            return
        if anruf.task and anruf.task is not asyncio.current_task():
            anruf.task.cancel()
        if self.anruf is anruf:
            self.anruf = None
        self._zustand(anruf, "beendet", grund)

    # ------------------------------------------------------------------ Eingehender Anruf

    def _invite_empfangen(self, msg: SipNachricht, addr: tuple[str, int]) -> None:
        anruf = self.anruf
        branch = msg.branch
        if anruf and anruf.angebot is not None and anruf.angebot.branch == branch:
            if anruf.letzte_antwort:  # Wiederholung des INVITE
                self._senden(anruf.letzte_antwort, addr)
            return
        gemerkt = self._srv_cache.get((branch, "INVITE"))
        if gemerkt:
            self._senden(gemerkt[0], gemerkt[1])
            return
        if tag_von(msg.kopf("to")):  # Re-INVITE innerhalb eines Dialogs
            if anruf and anruf.call_id == msg.call_id and anruf.zustand == "verbunden":
                self._reinvite(anruf, msg, addr)
            else:
                self._antworten(msg, addr, 481)
            return
        if anruf is not None:
            self._antworten(msg, addr, 486)
            return
        sdp: Sdp | None = None
        if msg.body.strip():
            try:
                sdp = sdp_parsen(msg.body.decode("utf-8", errors="replace"))
                if not sdp.codecs:
                    raise SipFehler("Kein unterstützter Codec")
            except SipFehler as exc:
                _LOGGER.info("SIP: INVITE abgelehnt: %s", exc)
                self._antworten(msg, addr, 488)
                return
        call = SipAnruf("ein", msg.call_id)
        call.peer = addr
        call.angebot = msg
        call.remote_sdp = sdp
        if sdp:
            call.codec = sdp.codecs[0]
            call.dtmf_pt = sdp.dtmf_pt
        anzeige, von_uri, _ = adresse_parsen(msg.kopf("from") or "")
        call.nummer = uri_teile(von_uri)[0]
        call.anzeigename = anzeige
        kontakt = msg.kopf("contact")
        call.remote_kontakt = adresse_parsen(kontakt)[1] if kontakt else von_uri
        call.dlg_von = f"{msg.kopf('to')};tag={call.lokal_tag}"
        call.dlg_an = msg.kopf("from") or ""
        self.anruf = call
        self._senden(self._antwort(msg, 100).kodieren(), addr)
        klingeln = self._antwort(msg, 180, an_tag=call.lokal_tag, kontakt=True)
        call.letzte_antwort = klingeln.kodieren()
        self._senden(call.letzte_antwort, addr)
        self._melde(self._auf_anruf, call)

    def _reinvite(self, anruf: SipAnruf, msg: SipNachricht, addr: tuple[str, int]) -> None:
        if msg.body.strip():
            with contextlib.suppress(SipFehler):
                sdp = sdp_parsen(msg.body.decode("utf-8", errors="replace"))
                if sdp.codecs:
                    anruf.remote_sdp = sdp
                    anruf.codec = sdp.codecs[0]
                    self._melde(self._auf_aenderung, anruf)
        body = sdp_bauen(self._sdp_adresse(), anruf.rtp_port, [anruf.codec], anruf.dtmf_pt)
        self._antworten(msg, addr, 200, an_tag=anruf.lokal_tag, body=body, kontakt=True)

    def _cancel_empfangen(self, msg: SipNachricht, addr: tuple[str, int]) -> None:
        anruf = self.anruf
        if not (anruf and anruf.richtung == "ein" and anruf.angebot and anruf.angebot.branch == msg.branch):
            self._antworten(msg, addr, 481)
            return
        self._antworten(msg, addr, 200)
        if anruf.zustand == "klingelt":
            self._final_senden(anruf, 487)
            self._ende(anruf, "Verpasst")

    def _bye_empfangen(self, msg: SipNachricht, addr: tuple[str, int]) -> None:
        anruf = self.anruf
        if not (anruf and anruf.call_id == msg.call_id and anruf.zustand in ("verbunden", "waehlt")):
            self._antworten(msg, addr, 481)
            return
        self._antworten(msg, addr, 200)
        self._ende(anruf, "Gegenstelle hat aufgelegt")

    def _ack_empfangen(self, msg: SipNachricht) -> None:
        ereignis = self._ack_ereignisse.get(msg.call_id)
        if ereignis:
            ereignis.set()
        anruf = self.anruf
        if anruf and anruf.call_id == msg.call_id and msg.body.strip() and anruf.remote_sdp is None:
            # Angebot kam erst im 200 (INVITE ohne SDP): die Antwort steht im ACK
            try:
                sdp = sdp_parsen(msg.body.decode("utf-8", errors="replace"))
            except SipFehler:
                return
            if sdp.codecs:
                anruf.remote_sdp = sdp
                anruf.codec = sdp.codecs[0]
                anruf.dtmf_pt = sdp.dtmf_pt
                self._melde(self._auf_aenderung, anruf)

    def _final_senden(self, anruf: SipAnruf, status: int, body: str = "") -> None:
        """Schlussantwort auf den eingehenden INVITE; wird bis zum ACK wiederholt (Timer G/H bzw. RFC 6026)."""
        assert anruf.angebot is not None
        r = self._antwort(anruf.angebot, status, an_tag=anruf.lokal_tag, body=body, kontakt=status < 300)
        roh = r.kodieren()
        anruf.letzte_antwort = roh
        self._cache_merken((anruf.angebot.branch, "INVITE"), roh, anruf.peer)
        ereignis = asyncio.Event()
        self._ack_ereignisse[anruf.call_id] = ereignis
        self._senden(roh, anruf.peer)
        self._hintergrund(self._final_wiederholen(anruf, roh, ereignis))

    async def _final_wiederholen(self, anruf: SipAnruf, roh: bytes, ereignis: asyncio.Event) -> None:
        t1 = self.cfg.t1
        intervall = t1
        ende = time.monotonic() + 64 * t1
        try:
            while time.monotonic() < ende:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(ereignis.wait(), timeout=intervall)
                if ereignis.is_set():
                    return
                self._senden(roh, anruf.peer)
                intervall = min(intervall * 2, 8 * t1)
            # Kein ACK: Anruf war angenommen -> beenden
            if anruf.zustand == "verbunden":
                _LOGGER.warning("SIP: kein ACK auf 200 OK, Anruf wird beendet")
                self._ende(anruf, "Kein ACK von der Gegenstelle")
                await self._bye(anruf)
        finally:
            if self._ack_ereignisse.get(anruf.call_id) is ereignis:
                del self._ack_ereignisse[anruf.call_id]

    async def annehmen(self, anruf: SipAnruf, rtp_port: int) -> None:
        """Nimmt den klingelnden eingehenden Anruf an (200 OK mit SDP, Wiederholung bis ACK)."""
        if anruf is not self.anruf or anruf.richtung != "ein" or anruf.zustand != "klingelt":
            raise SipFehler("Kein klingelnder Anruf")
        anruf.rtp_port = rtp_port
        offerte = anruf.remote_sdp is None  # INVITE ohne SDP: wir machen das Angebot
        codecs = [PT_PCMU, PT_PCMA] if offerte else [anruf.codec]
        dtmf = DTMF_PT if offerte else anruf.dtmf_pt
        if offerte:
            anruf.dtmf_pt = DTMF_PT
        body = sdp_bauen(self._sdp_adresse(), rtp_port, codecs, dtmf)
        self._final_senden(anruf, 200, body)
        self._zustand(anruf, "verbunden")

    def ablehnen(self, anruf: SipAnruf, status: int = 603) -> None:
        """Weist den klingelnden Anruf ab (603 Decline bzw. 486 Busy)."""
        if anruf is not self.anruf or anruf.richtung != "ein" or anruf.zustand != "klingelt":
            raise SipFehler("Kein klingelnder Anruf")
        self._final_senden(anruf, status)
        self._ende(anruf, "Abgelehnt")

    # ------------------------------------------------------------------ Ausgehender Anruf

    def anrufen(self, nummer: str, rtp_port: int) -> SipAnruf:
        """Startet einen ausgehenden Anruf; der Fortschritt kommt über ``auf_aenderung``."""
        if self.anruf is not None:
            raise SipFehler("Es läuft bereits ein Gespräch")
        call = SipAnruf("aus", f"{secrets.token_hex(8)}@pmps")
        call.nummer = nummer
        call.rtp_port = rtp_port
        call.peer = self._server
        call.codec = PT_PCMU
        eigene = f"sip:{self.cfg.benutzer}@{self.cfg.server}"
        anzeige = self.cfg.anzeigename.replace('"', "")
        ziel = f"sip:{quote(nummer, safe='*+')}@{self._server_host}"
        call.dlg_von = f'"{anzeige}" <{eigene}>;tag={call.lokal_tag}'
        call.dlg_an = f"<{ziel}>"
        call.cseq = 1
        body = sdp_bauen(self._sdp_adresse(), rtp_port, [PT_PCMU, PT_PCMA], DTMF_PT)
        call.invite = self._anfrage("INVITE", ziel, von=call.dlg_von, an=call.dlg_an, call_id=call.call_id, cseq=1, body=body)
        self.anruf = call
        call.task = asyncio.create_task(self._invite_ablauf(call))
        return call

    def _vorlaeufig(self, anruf: SipAnruf, antwort: SipNachricht) -> None:
        anruf.vorlaeufig_gesehen = True
        if antwort.body.strip():
            try:
                sdp = sdp_parsen(antwort.body.decode("utf-8", errors="replace"))
            except SipFehler:
                sdp = None
            if sdp and sdp.codecs and anruf.remote_sdp is None:  # Early Media
                anruf.remote_sdp = sdp
                anruf.codec = sdp.codecs[0]
                anruf.dtmf_pt = sdp.dtmf_pt
                self._melde(self._auf_aenderung, anruf)
        if anruf.abbruch and not anruf.cancel_gesendet:
            self._hintergrund(self._cancel_senden(anruf))

    async def _cancel_senden(self, anruf: SipAnruf) -> None:
        if anruf.cancel_gesendet or anruf.invite is None:
            return
        anruf.cancel_gesendet = True
        inv = anruf.invite
        nr, _ = inv.cseq()
        m = SipNachricht(methode="CANCEL", uri=inv.uri)
        m.hinzufuegen("via", inv.alle("via")[0])
        m.hinzufuegen("max-forwards", "70")
        m.hinzufuegen("from", inv.kopf("from") or "")
        m.hinzufuegen("to", inv.kopf("to") or "")
        m.hinzufuegen("call-id", inv.call_id)
        m.hinzufuegen("cseq", f"{nr} CANCEL")
        m.hinzufuegen("user-agent", USER_AGENT)
        with contextlib.suppress(TimeoutError, OSError):
            await self._transaktion(m, anruf.peer)

    def _ack_senden(self, anruf: SipAnruf, antwort: SipNachricht, *, zweixx: bool) -> None:
        inv = anruf.invite
        assert inv is not None
        nr, _ = inv.cseq()
        if zweixx:
            uri, via_branch = anruf.remote_kontakt or inv.uri, None
        else:
            uri, via_branch = inv.uri, inv.branch
        m = self._anfrage(
            "ACK",
            uri,
            von=anruf.dlg_von,
            an=antwort.kopf("to") or anruf.dlg_an,
            call_id=anruf.call_id,
            cseq=nr,
            branch=via_branch,
            kontakt=False,
        )
        for k in ("authorization", "proxy-authorization"):
            if (w := inv.kopf(k)) and not zweixx:
                m.hinzufuegen(k, w)
        roh = m.kodieren()
        self._acks[anruf.call_id] = roh
        if len(self._acks) > 20:
            del self._acks[next(iter(self._acks))]
        self._senden(roh, anruf.peer)

    async def _invite_ablauf(self, anruf: SipAnruf) -> None:
        try:
            antwort: SipNachricht | None = None
            for _runde in range(3):
                assert anruf.invite is not None
                antwort = await self._transaktion(
                    anruf.invite,
                    anruf.peer,
                    auf_vorlaeufig=lambda r: self._vorlaeufig(anruf, r),
                    gesamt_timeout=self.cfg.klingel_timeout_s,
                )
                if antwort.status in (401, 407):
                    self._ack_senden(anruf, antwort, zweixx=False)
                    if _runde == 2 or anruf.invite.kopf("authorization") or anruf.invite.kopf("proxy-authorization"):
                        self._ende(anruf, "Anmeldung abgelehnt")
                        return
                    anruf.invite = self._mit_auth(anruf.invite, antwort)
                    anruf.cseq = anruf.invite.cseq()[0]
                    continue
                break
            assert antwort is not None
            status = antwort.status or 0
            if 200 <= status < 300:
                await self._invite_erfolg(anruf, antwort)
            else:
                self._ack_senden(anruf, antwort, zweixx=False)
                self._ende(anruf, "Abgebrochen" if anruf.abbruch and status == 487 else grund_fuer_status(status))
        except TimeoutError:
            if anruf.zustand != "beendet":
                if anruf.vorlaeufig_gesehen:
                    anruf.abbruch = True
                    await self._cancel_senden(anruf)
                self._ende(anruf, "Keine Antwort")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _LOGGER.exception("SIP: Fehler im ausgehenden Anruf")
            self._ende(anruf, f"Fehler: {exc}")

    async def _invite_erfolg(self, anruf: SipAnruf, antwort: SipNachricht) -> None:
        anruf.dlg_an = antwort.kopf("to") or anruf.dlg_an
        kontakt = antwort.kopf("contact")
        if kontakt:
            anruf.remote_kontakt = adresse_parsen(kontakt)[1]
        try:
            sdp = sdp_parsen(antwort.body.decode("utf-8", errors="replace")) if antwort.body.strip() else anruf.remote_sdp
            if sdp is None or not sdp.codecs:
                raise SipFehler("Kein unterstützter Codec in der Antwort")
        except SipFehler as exc:
            self._ack_senden(anruf, antwort, zweixx=True)
            self._ende(anruf, str(exc))
            await self._bye(anruf)
            return
        anruf.remote_sdp = sdp
        anruf.codec = sdp.codecs[0]
        anruf.dtmf_pt = sdp.dtmf_pt
        self._ack_senden(anruf, antwort, zweixx=True)
        if anruf.abbruch:  # CANCEL hat den 200 überholt
            self._ende(anruf, "Abgebrochen")
            await self._bye(anruf)
            return
        self._zustand(anruf, "verbunden")

    # ------------------------------------------------------------------ Beenden

    async def auflegen(self, anruf: SipAnruf) -> None:
        """Beendet den Anruf je nach Zustand mit BYE, CANCEL oder Ablehnung."""
        if anruf.zustand == "beendet":
            return
        if anruf.richtung == "ein" and anruf.zustand == "klingelt":
            self.ablehnen(anruf)
        elif anruf.zustand == "waehlt":
            anruf.abbruch = True
            if anruf.vorlaeufig_gesehen:
                self._hintergrund(self._cancel_senden(anruf))
            self._hintergrund(self._abbruch_absichern(anruf))
        else:
            self._ende(anruf, "Aufgelegt")
            self._hintergrund(self._bye(anruf))

    async def _abbruch_absichern(self, anruf: SipAnruf) -> None:
        """CANCEL ohne vorherige Antwort: kurz warten, dann trotzdem senden; ohne 487 lokal beenden."""
        for _ in range(30):
            if anruf.vorlaeufig_gesehen or anruf.zustand == "beendet":
                break
            await asyncio.sleep(0.1)
        if anruf.zustand == "beendet":
            return
        await self._cancel_senden(anruf)
        for _ in range(40):
            if anruf.zustand != "waehlt":
                return
            await asyncio.sleep(0.1)
        self._ende(anruf, "Abgebrochen")

    async def _bye(self, anruf: SipAnruf) -> None:
        uri = anruf.remote_kontakt or f"sip:{anruf.nummer}@{self._server_host}"
        m = self._anfrage(
            "BYE", uri, von=anruf.dlg_von, an=anruf.dlg_an, call_id=anruf.call_id, cseq=anruf.naechste_cseq(), kontakt=False
        )
        try:
            await self._anfrage_mit_auth(m, anruf.peer, versuche=2)
        except (TimeoutError, SipFehler, OSError) as exc:
            _LOGGER.debug("SIP: BYE ohne Antwort: %s", exc)
