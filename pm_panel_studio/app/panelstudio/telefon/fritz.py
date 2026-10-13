"""FRITZ!Box-Anbindung per TR-064 (SOAP, HTTP-Digest): Telefonbuch und Anrufliste.

Es werden nur lesende Aktionen des Dienstes X_AVM-DE_OnTel genutzt. Die Daten werden zwischengespeichert
(Telefonbuch 15 Minuten, Anrufliste 2 Minuten); Fehler werfen nie aus kontakte()/verlauf(), sondern setzen
`fehler` und lassen den alten Zwischenspeicher bestehen.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import aiohttp

_LOGGER = logging.getLogger(__name__)

DIENST = "urn:dslforum-org:service:X_AVM-DE_OnTel:1"
STEUER_URL = "/upnp/control/x_contact"
TIMEOUT_S = 10
MAX_BYTES = 5 * 1024 * 1024
KONTAKTE_TTL_S = 15 * 60
VERLAUF_TTL_S = 2 * 60
MAX_ANRUFE = 500
FEHLER_PAUSE_S = 30

# Anruftyp der FRITZ!Box -> Richtung (1/2/3 = ein/verpasst/aus, 9/10/11 = dasselbe über Rufnummernblock)
_RICHTUNG = {"1": "ein", "9": "ein", "2": "verpasst", "10": "verpasst", "3": "aus", "11": "aus"}
_UMLAUTE = str.maketrans({"ä": "a", "ö": "o", "ü": "u", "ß": "ss"})


class FritzFehler(Exception):
    """Fehler mit deutscher Meldung für die Anzeige."""


def _zone() -> timezone | ZoneInfo:
    try:
        return ZoneInfo("Europe/Berlin")
    except ZoneInfoNotFoundError:  # pragma: no cover - nur ohne tzdata
        return timezone(timedelta(hours=1))


def normalisiere(nummer: str) -> str:
    """Rufnummer vergleichbar machen: Trennzeichen weg, +49/0049 -> 0. Interne Nummern (**610) bleiben."""
    n = re.sub(r"[\s\-/().]", "", nummer or "")
    if n.startswith("+49"):
        n = "0" + n[3:]
    elif n.startswith("0049"):
        n = "0" + n[4:]
    return n


def _sortschluessel(name: str) -> tuple[str, str]:
    return (name.casefold().translate(_UMLAUTE), name)


def _xml_parsen(daten: bytes) -> ET.Element:
    """XML nur parsen, wenn weder DOCTYPE noch ENTITY enthalten sind (Schutz vor Entity-Angriffen)."""
    if len(daten) > MAX_BYTES:
        raise FritzFehler("FRITZ!Box: Antwort zu groß")
    kopf = daten.upper()
    if b"<!DOCTYPE" in kopf or b"<!ENTITY" in kopf:
        raise FritzFehler("FRITZ!Box: Ungültige Antwort (DOCTYPE nicht erlaubt)")
    try:
        return ET.fromstring(daten)  # noqa: S314 - oben geprüft
    except ET.ParseError as exc:
        raise FritzFehler("FRITZ!Box: Antwort nicht lesbar") from exc


def _lokal(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _kind_text(el: ET.Element, name: str) -> str:
    for k in el:
        if _lokal(k.tag) == name:
            return (k.text or "").strip()
    return ""


def kontakte_parsen(daten: bytes) -> list[dict]:
    """Telefonbuch-XML -> [{"name", "nummern": [{"nummer", "typ"}]}] (Kontakte ohne Namen/Nummern entfallen)."""
    wurzel = _xml_parsen(daten)
    ergebnis: list[dict] = []
    for kontakt in wurzel.iter("contact"):
        name = ""
        for person in kontakt.iter("person"):
            name = _kind_text(person, "realName")
            if name:
                break
        nummern: list[dict] = []
        gesehen: set[str] = set()
        for num in kontakt.iter("number"):
            text = (num.text or "").strip()
            if not text or normalisiere(text) in gesehen:
                continue
            gesehen.add(normalisiere(text))
            nummern.append({"nummer": text, "typ": (num.get("type") or "").strip() or "home"})
        if name and nummern:
            ergebnis.append({"name": name, "nummern": nummern})
    return ergebnis


def _dauer_s(text: str) -> int:
    """'h:mm' (Minutenauflösung) -> Sekunden."""
    try:
        h, _, m = text.strip().partition(":")
        return (int(h) * 60 + int(m or 0)) * 60
    except ValueError:
        return 0


def anrufe_parsen(daten: bytes) -> list[dict]:
    """Anruflisten-XML -> [{"richtung", "nummer", "name", "zeit", "dauer_s"}], neueste zuerst."""
    wurzel = _xml_parsen(daten)
    zone = _zone()
    eintraege: list[tuple[datetime, dict]] = []
    for call in wurzel.iter("Call"):
        richtung = _RICHTUNG.get(_kind_text(call, "Type"))
        if richtung is None:
            continue
        nummer = _kind_text(call, "Called" if richtung == "aus" else "Caller")
        if richtung == "aus" and not nummer:
            nummer = _kind_text(call, "CalledNumber")
        try:
            zeit = datetime.strptime(_kind_text(call, "Date"), "%d.%m.%y %H:%M").replace(tzinfo=zone)
        except ValueError:
            continue
        eintraege.append(
            (
                zeit,
                {
                    "richtung": richtung,
                    "nummer": nummer,
                    "name": _kind_text(call, "Name"),
                    "zeit": zeit.isoformat(),
                    "dauer_s": _dauer_s(_kind_text(call, "Duration")),
                },
            )
        )
    eintraege.sort(key=lambda e: e[0], reverse=True)
    return [e[1] for e in eintraege]


class FritzBox:
    def __init__(self, session: aiohttp.ClientSession, host: str, benutzer: str, passwort: str, port: int = 49000) -> None:
        self._session = session
        self._host = host
        self._port = port
        self._auth = aiohttp.DigestAuthMiddleware(benutzer, passwort)
        self._lock = asyncio.Lock()
        self._kontakte: list[dict] = []
        self._anrufe: list[dict] = []
        self._index: dict[str, str] = {}
        self._kontakte_faellig = 0.0
        self._verlauf_faellig = 0.0
        self._verlauf_anzahl = 0
        self.fehler: str | None = None

    # --- Netzwerk ---------------------------------------------------------------------------------

    async def _lesen(self, resp: aiohttp.ClientResponse) -> bytes:
        teile: list[bytes] = []
        gesamt = 0
        async for chunk in resp.content.iter_chunked(64 * 1024):
            gesamt += len(chunk)
            if gesamt > MAX_BYTES:
                raise FritzFehler("FRITZ!Box: Antwort zu groß")
            teile.append(chunk)
        return b"".join(teile)

    def _pruefe_status(self, status: int) -> None:
        if status in (401, 403):
            raise FritzFehler("FRITZ!Box: Anmeldung abgelehnt")
        if status != 200:
            raise FritzFehler(f"FRITZ!Box: Unerwartete Antwort (HTTP {status})")

    async def _soap(self, aktion: str, argumente: dict[str, str] | None = None) -> dict[str, str]:
        args = "".join(f"<{k}>{v}</{k}>" for k, v in (argumente or {}).items())
        body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
            's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
            f'<s:Body><u:{aktion} xmlns:u="{DIENST}">{args}</u:{aktion}></s:Body></s:Envelope>'
        )
        url = f"http://{self._host}:{self._port}{STEUER_URL}"
        headers = {"Content-Type": 'text/xml; charset="utf-8"', "SOAPACTION": f'"{DIENST}#{aktion}"'}
        async with self._session.post(
            url, data=body.encode(), headers=headers, middlewares=(self._auth,), timeout=aiohttp.ClientTimeout(total=TIMEOUT_S)
        ) as resp:
            daten = await self._lesen(resp)
            if resp.status == 500:  # SOAP-Fault (z. B. unbekannte Aktion, fehlende Berechtigung)
                raise FritzFehler("FRITZ!Box: Aktion nicht möglich (Berechtigung für Telefonie prüfen)")
            self._pruefe_status(resp.status)
        wurzel = _xml_parsen(daten)
        return {_lokal(el.tag): (el.text or "").strip() for el in wurzel.iter() if len(el) == 0}

    async def _hole(self, url: str, anhang: str = "") -> bytes:
        """Von der Box gelieferte Adresse (mit sid) abrufen. Nur Pfad und Abfrage werden übernommen, Host und Port
        sind immer die konfigurierten: Die Box nennt sich je nach Firmware „fritz.box“ oder per IP, und eine fremde
        Adresse in der Antwort darf nie abgerufen werden."""
        teile = urlsplit(url)
        if teile.scheme not in ("http", "https") or not teile.path.startswith("/"):
            raise FritzFehler("FRITZ!Box: Unerwartete Adresse in der Antwort")
        ziel = f"http://{self._host}:{self._port}{teile.path}{'?' + teile.query if teile.query else ''}{anhang}"
        async with self._session.get(ziel, timeout=aiohttp.ClientTimeout(total=TIMEOUT_S), allow_redirects=False) as resp:
            daten = await self._lesen(resp)
            self._pruefe_status(resp.status)
        return daten

    # --- Aktualisieren ----------------------------------------------------------------------------

    async def _kontakte_laden(self) -> None:
        liste = (await self._soap("GetPhonebookList")).get("NewPhonebookList", "")
        ids = [i.strip() for i in liste.split(",") if i.strip()] or ["0"]
        alle: list[dict] = []
        for pid in ids:
            antwort = await self._soap("GetPhonebook", {"NewPhonebookID": pid})
            url = antwort.get("NewPhonebookURL", "")
            if url:
                alle.extend(kontakte_parsen(await self._hole(url)))
        # gleiche Namen zusammenführen
        nach_name: dict[str, dict] = {}
        for k in alle:
            ziel = nach_name.setdefault(k["name"], {"name": k["name"], "nummern": []})
            bekannt = {normalisiere(n["nummer"]) for n in ziel["nummern"]}
            ziel["nummern"].extend(n for n in k["nummern"] if normalisiere(n["nummer"]) not in bekannt)
        kontakte = sorted(nach_name.values(), key=lambda k: _sortschluessel(k["name"]))
        index: dict[str, str] = {}
        for k in kontakte:
            for n in k["nummern"]:
                index.setdefault(normalisiere(n["nummer"]), k["name"])
        self._kontakte, self._index = kontakte, index

    async def _verlauf_laden(self, anzahl: int) -> None:
        antwort = await self._soap("GetCallList")
        url = antwort.get("NewCallListURL", "")
        if not url:
            raise FritzFehler("FRITZ!Box: Keine Anrufliste erhalten")
        trenner = "&" if "?" in url else "?"
        self._anrufe = anrufe_parsen(await self._hole(url, f"{trenner}max={anzahl}"))
        self._verlauf_anzahl = anzahl

    async def aktualisieren(self, erzwingen: bool = False, anzahl: int = 50) -> None:
        """Zwischenspeicher auffrischen, wenn abgelaufen (oder erzwungen). Setzt `fehler`, wirft nie.

        Nach einem Fehler wird erst nach FEHLER_PAUSE_S erneut versucht (kein Dauerfeuer bei falschem Passwort).
        """
        async with self._lock:
            jetzt = time.monotonic()
            anzahl = min(max(anzahl, 1), MAX_ANRUFE)
            versucht = False
            fehler: str | None = None
            if erzwingen or jetzt >= self._kontakte_faellig:
                versucht = True
                fehler = await self._versuche(self._kontakte_laden())
                self._kontakte_faellig = time.monotonic() + (FEHLER_PAUSE_S if fehler else KONTAKTE_TTL_S)
            if fehler is None and (erzwingen or jetzt >= self._verlauf_faellig or anzahl > self._verlauf_anzahl):
                versucht = True
                fehler = await self._versuche(self._verlauf_laden(anzahl))
                self._verlauf_faellig = time.monotonic() + (FEHLER_PAUSE_S if fehler else VERLAUF_TTL_S)
            if fehler is not None:
                self.fehler = fehler
            elif versucht:
                self.fehler = None

    async def _versuche(self, aufgabe) -> str | None:
        try:
            await aufgabe
        except FritzFehler as exc:
            return str(exc)
        except TimeoutError:
            return "FRITZ!Box: Zeitüberschreitung"
        except aiohttp.ClientError as exc:
            _LOGGER.debug("FRITZ!Box nicht erreichbar: %s", exc)
            return "FRITZ!Box: Nicht erreichbar"
        except Exception:
            _LOGGER.exception("FRITZ!Box: unerwarteter Fehler")
            return "FRITZ!Box: Unerwarteter Fehler"
        return None

    # --- Abfragen ---------------------------------------------------------------------------------

    async def kontakte(self) -> list[dict]:
        await self.aktualisieren()
        return [{"name": k["name"], "nummern": [dict(n) for n in k["nummern"]]} for k in self._kontakte]

    async def verlauf(self, anzahl: int = 50) -> list[dict]:
        await self.aktualisieren(anzahl=anzahl)
        return [dict(a) for a in self._anrufe[: max(anzahl, 0)]]

    def name_fuer(self, nummer: str) -> str | None:
        n = normalisiere(nummer)
        return self._index.get(n) if n else None
