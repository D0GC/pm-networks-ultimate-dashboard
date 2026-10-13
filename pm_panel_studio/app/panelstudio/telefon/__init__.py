"""Telefon-Fassade: SIP-Anmeldung an der FRITZ!Box, ein Anruf zur Zeit, Audio über WebRTC zum Browser.

``Telefon`` verbindet ``SipAgent`` (Signalisierung), ``RtpSitzung`` (G.711-Audio), ``Bruecke`` (WebRTC) und
``FritzBox`` (Namen, Telefonbuch, Anrufliste). Jede Zustandsänderung geht als ``status()``-Wörterbuch an ``melden``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import aiohttp

from . import g711
from .rtp import RtpSitzung
from .sip import SipAgent, SipAnruf, SipConfig, SipFehler

try:  # fritz.py entsteht parallel
    from .fritz import FritzBox
except ImportError:  # pragma: no cover
    FritzBox = None  # type: ignore[assignment,misc]

_LOGGER = logging.getLogger(__name__)

NUMMER_MUSTER = re.compile(r"[0-9*#+]{1,32}")
SDP_MAX = 20000
BEENDET_ANZEIGE_S = 3.0  # so lange bleibt ein beendeter Anruf im Status sichtbar


class TelefonFehler(Exception):
    """Der Aufruf ist im aktuellen Zustand nicht möglich (Meldungstext ist für die Anzeige gedacht)."""


@dataclass
class TelefonConfig:
    server: str = ""  # leer = Telefon deaktiviert; zugleich FRITZ!Box-Adresse
    port: int = 5060
    benutzer: str = ""
    passwort: str = ""
    anzeigename: str = "Panel"
    lokaler_port: int = 5062
    rtp_ports: tuple[int, ...] = (40000, 40001, 40002, 40003)
    externe_adresse: str = ""
    fritz_benutzer: str = ""
    fritz_passwort: str = ""

    @property
    def aktiv(self) -> bool:
        return bool(self.server and self.benutzer and self.passwort)


class _Verbindung:
    """Alles, was zu einem Anruf gehört (SIP-Anruf, RTP, WebRTC-Brücke)."""

    def __init__(self, sip: SipAnruf, name: str) -> None:
        self.sip = sip
        self.id = sip.id
        self.name = name
        self.seit = _iso()
        self.verbunden_seit: str | None = None
        self.stumm = False
        self.rtp: RtpSitzung | None = None
        self.bruecke = None
        self.aufraeumen: asyncio.TimerHandle | None = None
        self.ressourcen_frei = False


def _iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _pruefe_sdp(sdp: str) -> str:
    if not isinstance(sdp, str) or not sdp.startswith("v=0") or len(sdp) > SDP_MAX:
        raise ValueError("Ungültiges SDP-Angebot")
    return sdp


class Telefon:
    def __init__(
        self,
        cfg: TelefonConfig,
        melden: Callable[[dict], None],
        session: aiohttp.ClientSession | None = None,
    ) -> None:
        self.cfg = cfg
        self._melden = melden
        self._session = session
        self._eigene_session = False
        self._sip: SipAgent | None = None
        self._fritz = None
        self._v: _Verbindung | None = None
        self._belegt: set[int] = set()
        self._tasks: set[asyncio.Task] = set()
        self._fehler: str | None = None

    # ------------------------------------------------------------------ Lebenszyklus

    async def start(self) -> None:
        if self._sip is not None:
            return
        if not self.cfg.aktiv:
            if self.cfg.server:
                self._fehler = "Zugangsdaten des Telefons sind unvollständig"
                self._senden()
            return
        await asyncio.to_thread(g711.vorbereiten)
        if self.cfg.fritz_benutzer and self.cfg.fritz_passwort and FritzBox is not None:
            if self._session is None:
                self._session = aiohttp.ClientSession()
                self._eigene_session = True
            self._fritz = FritzBox(self._session, self.cfg.server, self.cfg.fritz_benutzer, self.cfg.fritz_passwort)
            self._hintergrund(self._fritz_laden())
        c = self.cfg
        self._sip = SipAgent(
            SipConfig(
                server=c.server,
                port=c.port,
                benutzer=c.benutzer,
                passwort=c.passwort,
                anzeigename=c.anzeigename,
                lokaler_port=c.lokaler_port,
                externe_adresse=c.externe_adresse,
            ),
            auf_status=self._senden,
            auf_anruf=self._anruf_kommt,
            auf_aenderung=self._anruf_aenderung,
        )
        try:
            await self._sip.start()
        except OSError as exc:
            self._sip = None
            self._fehler = f"SIP-Port {c.lokaler_port} nicht verfügbar: {exc}"
            self._senden()
            return
        self._senden()

    async def stop(self) -> None:
        v = self._v
        if v is not None and v.aufraeumen:
            v.aufraeumen.cancel()
        sip, self._sip = self._sip, None
        if sip is not None:
            await sip.stop()
        if v is not None:
            await self._freigeben(v)
        self._v = None
        for t in list(self._tasks):
            t.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        if self._eigene_session and self._session is not None:
            await self._session.close()
            self._session = None
        self._fritz = None

    # ------------------------------------------------------------------ Status

    def status(self) -> dict:
        sip = self._sip
        v = self._v
        anruf = None
        if v is not None:
            anruf = {
                "id": v.id,
                "richtung": v.sip.richtung,
                "nummer": v.sip.nummer,
                "name": v.name,
                "zustand": v.sip.zustand,
                "seit": v.seit,
                "verbunden_seit": v.verbunden_seit,
                "grund": v.sip.grund,
                "stumm": v.stumm,
            }
        return {
            "aktiv": self.cfg.aktiv,
            "registriert": bool(sip and sip.registriert),
            "fehler": (sip.fehler if sip and sip.fehler else None) or self._fehler,
            "anruf": anruf,
        }

    def _senden(self, *_args) -> None:
        try:
            self._melden(self.status())
        except Exception:
            _LOGGER.exception("Telefon: Statusmeldung fehlgeschlagen")

    def _hintergrund(self, coro) -> asyncio.Task:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    async def _fritz_laden(self) -> None:
        try:
            await self._fritz.aktualisieren()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _LOGGER.warning("Telefon: FRITZ!Box-Daten nicht ladbar: %s", exc)

    def _name_fuer(self, nummer: str, anzeige: str = "") -> str:
        if self._fritz is not None and nummer:
            with contextlib.suppress(Exception):
                name = self._fritz.name_fuer(nummer)
                if name:
                    return name
        return anzeige

    # ------------------------------------------------------------------ SIP-Rückrufe

    def _anruf_kommt(self, anruf: SipAnruf) -> None:
        alt = self._v
        if alt is not None and alt.aufraeumen:
            alt.aufraeumen.cancel()
        self._v = _Verbindung(anruf, self._name_fuer(anruf.nummer, anruf.anzeigename))
        self._senden()

    def _anruf_aenderung(self, anruf: SipAnruf) -> None:
        v = self._v
        if v is None or v.sip is not anruf:
            return
        if anruf.zustand == "verbunden":
            if v.verbunden_seit is None:
                v.verbunden_seit = _iso()
            self._ziel_setzen(v)
        elif anruf.zustand == "beendet":
            if v.aufraeumen is None:
                v.aufraeumen = asyncio.get_running_loop().call_later(BEENDET_ANZEIGE_S, self._leeren, v)
            self._hintergrund(self._freigeben(v))
        self._senden()

    def _ziel_setzen(self, v: _Verbindung) -> None:
        sdp = v.sip.remote_sdp
        if v.rtp is not None and sdp is not None:
            v.rtp.ziel_setzen(sdp.adresse, sdp.port, v.sip.codec, v.sip.dtmf_pt)

    def _leeren(self, v: _Verbindung) -> None:
        if self._v is v:
            self._v = None
            self._senden()

    async def _freigeben(self, v: _Verbindung) -> None:
        """Schließt Brücke und RTP-Port des Anrufs (idempotent)."""
        if v.ressourcen_frei:
            return
        v.ressourcen_frei = True
        bruecke, v.bruecke = v.bruecke, None
        if bruecke is not None:
            await bruecke.schliessen()
        rtp, v.rtp = v.rtp, None
        if rtp is not None:
            self._rtp_freigeben(rtp)

    def _rtp_freigeben(self, rtp: RtpSitzung) -> None:
        rtp.schliessen()
        self._belegt.discard(rtp.port)

    def _webrtc_abbruch(self, v: _Verbindung) -> None:
        if v.sip.zustand != "beendet" and self._sip is not None:
            _LOGGER.warning("Telefon: WebRTC-Verbindung abgebrochen, Anruf wird beendet")
            v.sip.grund = "Audioverbindung zum Browser abgebrochen"
            self._hintergrund(self._sip.auflegen(v.sip))

    # ------------------------------------------------------------------ Hilfen für Aufrufe

    def _bereit(self) -> SipAgent:
        if self._sip is None:
            raise TelefonFehler("Telefon ist nicht aktiv")
        return self._sip

    def _anruf(self, anruf_id: str) -> _Verbindung:
        v = self._v
        if not isinstance(anruf_id, str) or v is None or v.id != anruf_id:
            raise ValueError("Unbekannter Anruf")
        return v

    async def _rtp_oeffnen(self) -> RtpSitzung:
        for port in self.cfg.rtp_ports:
            if port in self._belegt:
                continue
            rtp = RtpSitzung(port)
            try:
                await rtp.oeffnen()
            except OSError:
                continue
            self._belegt.add(rtp.port)
            return rtp
        raise TelefonFehler("Kein freier RTP-Port")

    async def _bruecke_aufbauen(self, v: _Verbindung, angebot: str) -> str:
        try:
            from .bruecke import Bruecke
        except ImportError as exc:
            raise TelefonFehler("WebRTC-Unterstützung (aiortc) ist nicht installiert") from exc
        v.rtp = await self._rtp_oeffnen()
        v.bruecke = Bruecke(v.rtp, bei_abbruch=lambda: self._webrtc_abbruch(v))
        try:
            return await v.bruecke.antworten(angebot)
        except ValueError:
            raise
        except Exception as exc:
            _LOGGER.exception("Telefon: WebRTC-Aufbau fehlgeschlagen")
            raise TelefonFehler(f"Audioverbindung konnte nicht aufgebaut werden: {exc}") from exc

    # ------------------------------------------------------------------ Aktionen

    async def waehlen(self, nummer: str, angebot: str) -> dict:
        if not isinstance(nummer, str) or not NUMMER_MUSTER.fullmatch(nummer):
            raise ValueError("Ungültige Rufnummer")
        _pruefe_sdp(angebot)
        sip = self._bereit()
        if not sip.registriert:
            raise TelefonFehler(sip.fehler or "Telefon ist nicht angemeldet")
        if sip.anruf is not None or (self._v is not None and self._v.sip.zustand != "beendet"):
            raise TelefonFehler("Es läuft bereits ein Gespräch")
        rtp = await self._rtp_oeffnen()
        try:
            from .bruecke import Bruecke
        except ImportError as exc:
            self._rtp_freigeben(rtp)
            raise TelefonFehler("WebRTC-Unterstützung (aiortc) ist nicht installiert") from exc
        bruecke = Bruecke(rtp, bei_abbruch=lambda: self._webrtc_abbruch(self._v) if self._v else None)
        try:
            antwort = await bruecke.antworten(angebot)
        except ValueError:
            self._rtp_freigeben(rtp)
            raise
        except Exception as exc:
            self._rtp_freigeben(rtp)
            _LOGGER.exception("Telefon: WebRTC-Aufbau fehlgeschlagen")
            raise TelefonFehler(f"Audioverbindung konnte nicht aufgebaut werden: {exc}") from exc
        try:
            call = sip.anrufen(nummer, rtp.port)
        except SipFehler as exc:
            await bruecke.schliessen()
            self._rtp_freigeben(rtp)
            raise TelefonFehler(str(exc)) from exc
        alt = self._v
        if alt is not None and alt.aufraeumen:
            alt.aufraeumen.cancel()
        v = _Verbindung(call, self._name_fuer(nummer))
        v.rtp = rtp
        v.bruecke = bruecke
        self._v = v
        self._senden()
        return {"anruf": v.id, "antwort": antwort}

    async def annehmen(self, anruf: str, angebot: str) -> str:
        v = self._anruf(anruf)
        _pruefe_sdp(angebot)
        sip = self._bereit()
        if v.sip.richtung != "ein" or v.sip.zustand != "klingelt":
            raise TelefonFehler("Kein klingelnder Anruf")
        if v.rtp is not None:
            raise TelefonFehler("Anruf wird bereits angenommen")
        try:
            antwort = await self._bruecke_aufbauen(v, angebot)
            if v.sip.zustand != "klingelt":  # während des Aufbaus aufgelegt/abgebrochen
                raise TelefonFehler("Der Anruf wurde inzwischen beendet")
            self._ziel_setzen(v)
            assert v.rtp is not None
            await sip.annehmen(v.sip, v.rtp.port)
        except (TelefonFehler, SipFehler, ValueError) as exc:
            await self._freigeben(v)
            v.ressourcen_frei = False
            if isinstance(exc, SipFehler):
                raise TelefonFehler(str(exc)) from exc
            raise
        return antwort

    async def ablehnen(self, anruf: str) -> bool:
        v = self._anruf(anruf)
        sip = self._bereit()
        if v.sip.richtung != "ein" or v.sip.zustand != "klingelt":
            return False
        sip.ablehnen(v.sip)
        return True

    async def auflegen(self, anruf: str) -> bool:
        v = self._anruf(anruf)
        sip = self._bereit()
        if v.sip.zustand == "beendet":
            return False
        await sip.auflegen(v.sip)
        return True

    async def dtmf(self, anruf: str, ziffern: str) -> bool:
        if not isinstance(ziffern, str) or not re.fullmatch(r"[0-9*#A-Da-d]{1,32}", ziffern):
            raise ValueError("Ungültige Wählzeichen")
        v = self._anruf(anruf)
        if v.sip.zustand != "verbunden" or v.rtp is None:
            return False
        await v.rtp.dtmf(ziffern)
        return True

    async def stumm(self, anruf: str, an: bool) -> bool:
        v = self._anruf(anruf)
        if v.sip.zustand == "beendet":
            return False
        v.stumm = bool(an)
        if v.bruecke is not None:
            v.bruecke.stumm = v.stumm
        self._senden()
        return True

    # ------------------------------------------------------------------ FRITZ!Box

    async def kontakte(self) -> list[dict]:
        if self._fritz is None:
            return []
        try:
            return await self._fritz.kontakte()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise TelefonFehler(f"Telefonbuch nicht abrufbar: {exc}") from exc

    async def verlauf(self) -> list[dict]:
        if self._fritz is None:
            return []
        try:
            return await self._fritz.verlauf()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise TelefonFehler(f"Anrufliste nicht abrufbar: {exc}") from exc


__all__ = ["Telefon", "TelefonConfig", "TelefonFehler"]
