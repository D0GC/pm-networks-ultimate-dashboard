"""FRITZ!Box-Anbindung: Fake-TR-064-Server mit Digest-Anmeldung, Telefonbuch und Anrufliste."""

from __future__ import annotations

import hashlib
import re

import aiohttp
import pytest
from aiohttp import web

from panelstudio.telefon import fritz
from panelstudio.telefon.fritz import FritzBox, anrufe_parsen, kontakte_parsen, normalisiere

USER = "dashboard"
PASSWORT = "geheim"
REALM = "F!Box SOAP-Auth"
NONCE = "abc123nonce"

TELEFONBUCH = """<?xml version="1.0" encoding="utf-8"?>
<phonebooks><phonebook name="Telefonbuch">
<contact><person><realName>Zeller, Anna</realName></person><telephony>
<number type="home" prio="1">0711 123-456</number><number type="mobile">+49 170 111 222</number></telephony></contact>
<contact><person><realName>Ärzte Notdienst</realName></person><telephony><number type="work">0049 711 99999</number></telephony></contact>
<contact><person><realName>Bauer</realName></person><telephony><number type="fax_work">**610</number></telephony></contact>
<contact><person><realName>Leer</realName></person><telephony></telephony></contact>
<contact><person><realName></realName></person><telephony><number type="home">123</number></telephony></contact>
</phonebook></phonebooks>"""

ANRUFE = """<?xml version="1.0" encoding="utf-8"?>
<root><timestamp>1</timestamp>
<Call><Id>1</Id><Type>1</Type><Caller>0711 123456</Caller><Called>0711 555</Called><CalledNumber>555</CalledNumber>
<Name>Zeller, Anna</Name><Date>13.10.26 21:05</Date><Duration>0:03</Duration></Call>
<Call><Id>2</Id><Type>2</Type><Caller>0301234</Caller><Called>0711 555</Called><Name></Name>
<Date>12.10.26 08:00</Date><Duration>0:00</Duration></Call>
<Call><Id>3</Id><Type>3</Type><Caller>0711 555</Caller><Called>0170 111222</Called><CalledNumber>0170111222</CalledNumber>
<Name>Mobil</Name><Date>14.10.26 07:30</Date><Duration>1:20</Duration></Call>
<Call><Id>4</Id><Type>10</Type><Caller>089 1</Caller><Called>0711 555</Called><Date>13.07.26 12:00</Date><Duration>0:00</Duration></Call>
<Call><Id>5</Id><Type>9</Type><Caller>089 2</Caller><Called>0711 555</Called><Date>kaputt</Date><Duration>0:01</Duration></Call>
<Call><Id>6</Id><Type>99</Type><Caller>089 3</Caller><Date>13.10.26 10:00</Date><Duration>0:01</Duration></Call>
</root>"""


def _soap_antwort(aktion: str, werte: dict[str, str]) -> str:
    inner = "".join(f"<{k}>{v}</{k}>" for k, v in werte.items())
    return (
        '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
        f'<u:{aktion}Response xmlns:u="{fritz.DIENST}">{inner}</u:{aktion}Response></s:Body></s:Envelope>'
    )


def _digest_ok(request: web.Request, passwort: str) -> bool:
    kopf = request.headers.get("Authorization", "")
    if not kopf.startswith("Digest "):
        return False
    felder = {m[0]: m[1] or m[2] for m in re.findall(r'(\w+)=(?:"([^"]*)"|([^\s,]+))', kopf)}
    if felder.get("username") != USER or felder.get("realm") != REALM or felder.get("nonce") != NONCE:
        return False
    if felder.get("uri") != request.path_qs or felder.get("qop") != "auth":
        return False
    ha1 = hashlib.md5(f"{USER}:{REALM}:{passwort}".encode()).hexdigest()
    ha2 = hashlib.md5(f"{request.method}:{felder['uri']}".encode()).hexdigest()
    erwartet = hashlib.md5(f"{ha1}:{NONCE}:{felder['nc']}:{felder['cnonce']}:auth:{ha2}".encode()).hexdigest()
    return felder.get("response") == erwartet


class FakeFritz:
    def __init__(self) -> None:
        self.passwort = PASSWORT
        self.telefonbuch = TELEFONBUCH
        self.anrufe = ANRUFE
        self.zugriffe: list[str] = []
        self.aktionen: list[str] = []
        self.call_urls: list[str] = []
        self.fremder_host = False
        self.app = web.Application()
        self.app.router.add_post("/upnp/control/x_contact", self.steuern)
        self.app.router.add_get("/phonebook.xml", self.buch)
        self.app.router.add_get("/calls.xml", self.liste)

    async def steuern(self, request: web.Request) -> web.Response:
        if not _digest_ok(request, self.passwort):
            return web.Response(
                status=401,
                headers={"WWW-Authenticate": f'Digest realm="{REALM}", nonce="{NONCE}", qop="auth", algorithm=MD5'},
            )
        aktion = request.headers["SOAPACTION"].strip('"').split("#")[1]
        self.aktionen.append(aktion)
        basis = f"http://{'evil.example' if self.fremder_host else request.host}"
        if aktion == "GetPhonebookList":
            antwort = {"NewPhonebookList": "0"}
        elif aktion == "GetPhonebook":
            body = await request.text()
            assert "<NewPhonebookID>0</NewPhonebookID>" in body
            antwort = {"NewPhonebookURL": f"{basis}/phonebook.xml?sid=1234&amp;pbid=0"}
        elif aktion == "GetCallList":
            antwort = {"NewCallListURL": f"{basis}/calls.xml?sid=1234"}
        else:
            return web.Response(status=500)
        return web.Response(text=_soap_antwort(aktion, antwort), content_type="text/xml")

    async def buch(self, request: web.Request) -> web.Response:
        self.zugriffe.append(request.path_qs)
        return web.Response(text=self.telefonbuch, content_type="text/xml")

    async def liste(self, request: web.Request) -> web.Response:
        self.zugriffe.append(request.path_qs)
        self.call_urls.append(request.path_qs)
        return web.Response(text=self.anrufe, content_type="text/xml")


@pytest.fixture
def ff() -> FakeFritz:
    return FakeFritz()


@pytest.fixture
async def box(aiohttp_server, ff):
    server = await aiohttp_server(ff.app)
    async with aiohttp.ClientSession() as session:
        yield FritzBox(session, server.host, USER, PASSWORT, port=server.port)


# --- Normalisierung -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("roh", "erwartet"),
    [
        ("0711 123-456", "0711123456"),
        ("+49 711 123456", "0711123456"),
        ("0049 (711) 123/456", "0711123456"),
        ("**610", "**610"),
        ("", ""),
    ],
)
def test_normalisiere(roh, erwartet):
    assert normalisiere(roh) == erwartet


# --- Parser -------------------------------------------------------------------------------------------


def test_kontakte_parsen_ueberspringt_leere():
    k = kontakte_parsen(TELEFONBUCH.encode())
    assert [x["name"] for x in k] == ["Zeller, Anna", "Ärzte Notdienst", "Bauer"]
    assert k[0]["nummern"] == [{"nummer": "0711 123-456", "typ": "home"}, {"nummer": "+49 170 111 222", "typ": "mobile"}]


def test_anrufe_parsen_mapping_und_reihenfolge():
    a = anrufe_parsen(ANRUFE.encode())
    assert [x["richtung"] for x in a] == ["aus", "ein", "verpasst", "verpasst"]
    aus, ein, verpasst, sommer = a
    assert aus["nummer"] == "0170 111222" and aus["dauer_s"] == 80 * 60 and aus["name"] == "Mobil"
    assert ein["nummer"] == "0711 123456" and ein["dauer_s"] == 180
    assert ein["zeit"] == "2026-10-13T21:05:00+02:00"
    assert verpasst["zeit"] == "2026-10-12T08:00:00+02:00" and verpasst["name"] == ""
    assert sommer["zeit"].endswith("+02:00")


def test_anrufe_winterzeit():
    xml = "<root><Call><Type>1</Type><Caller>1</Caller><Date>05.01.27 10:00</Date><Duration>0:01</Duration></Call></root>"
    assert anrufe_parsen(xml.encode())[0]["zeit"] == "2027-01-05T10:00:00+01:00"


@pytest.mark.parametrize("marker", ["<!DOCTYPE foo>", "<!doctype foo>", '<!DOCTYPE x [<!ENTITY a "b">]>', '<!ENTITY a "b">'])
def test_doctype_abgelehnt(marker):
    with pytest.raises(fritz.FritzFehler):
        kontakte_parsen(f"<?xml version='1.0'?>{marker}<phonebooks/>".encode())


def test_zu_gross_und_kaputt():
    with pytest.raises(fritz.FritzFehler):
        anrufe_parsen(b"<root>" + b" " * (fritz.MAX_BYTES + 1) + b"</root>")
    with pytest.raises(fritz.FritzFehler):
        anrufe_parsen(b"<root><Call>")


# --- Gesamtablauf mit Digest ----------------------------------------------------------------------------


async def test_kontakte_sortiert_und_name_fuer(box, ff):
    kontakte = await box.kontakte()
    assert box.fehler is None
    assert [k["name"] for k in kontakte] == ["Ärzte Notdienst", "Bauer", "Zeller, Anna"]
    assert box.name_fuer("+49 711 123456") == "Zeller, Anna"
    assert box.name_fuer("0711/123456") == "Zeller, Anna"
    assert box.name_fuer("0170111222") == "Zeller, Anna"
    assert box.name_fuer("0711 99999") == "Ärzte Notdienst"
    assert box.name_fuer("**610") == "Bauer"
    assert box.name_fuer("0999") is None
    assert box.name_fuer("") is None


async def test_verlauf(box, ff):
    v = await box.verlauf(2)
    assert box.fehler is None
    assert len(v) == 2 and v[0]["richtung"] == "aus"
    assert ff.call_urls == ["/calls.xml?sid=1234&max=2"]


async def test_cache_und_erzwingen(box, ff):
    await box.kontakte()
    await box.verlauf()
    n = len(ff.aktionen)
    await box.kontakte()
    await box.verlauf()
    assert len(ff.aktionen) == n
    await box.aktualisieren(erzwingen=True)
    assert len(ff.aktionen) == n + 3


async def test_ttl_laeuft_ab(box, ff):
    await box.verlauf()
    box._verlauf_faellig = 0.0
    n = len(ff.aktionen)
    await box.verlauf()
    assert ff.aktionen[n:] == ["GetCallList"]


async def test_falsches_passwort(box, ff):
    ff.passwort = "anders"
    assert await box.kontakte() == []
    assert await box.verlauf() == []
    assert box.fehler == "FRITZ!Box: Anmeldung abgelehnt"


async def test_fehler_behaelt_cache_und_heilt(box, ff):
    await box.kontakte()
    ff.passwort = "anders"
    await box.aktualisieren(erzwingen=True)
    assert box.fehler == "FRITZ!Box: Anmeldung abgelehnt"
    assert len(await box.kontakte()) == 3
    assert box.name_fuer("**610") == "Bauer"
    ff.passwort = PASSWORT
    await box.aktualisieren(erzwingen=True)
    assert box.fehler is None


async def test_fremder_host_wird_nicht_abgerufen(box, ff):
    # Die Adresse aus der Antwort zeigt auf einen fremden Host: abgerufen wird trotzdem nur die konfigurierte Box
    ff.fremder_host = True
    assert await box.kontakte() != []
    assert box.fehler is None


async def test_doctype_in_telefonbuch(box, ff):
    ff.telefonbuch = '<!DOCTYPE x [<!ENTITY a "b">]><phonebooks/>'
    assert await box.kontakte() == []
    assert box.fehler is not None and "DOCTYPE" in box.fehler


async def test_nicht_erreichbar(aiohttp_server, ff):
    server = await aiohttp_server(ff.app)
    port = server.port
    await server.close()
    async with aiohttp.ClientSession() as session:
        b = FritzBox(session, "127.0.0.1", USER, PASSWORT, port=port)
        assert await b.kontakte() == []
        assert await b.verlauf() == []
        assert b.fehler == "FRITZ!Box: Nicht erreichbar"
