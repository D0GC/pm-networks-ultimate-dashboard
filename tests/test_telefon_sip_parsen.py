"""SIP-Nachrichten, SDP und Digest ohne Netzwerk."""

from __future__ import annotations

import hashlib

import pytest

from panelstudio.telefon import sip
from panelstudio.telefon.sip import SipFehler, SipNachricht

INVITE = (
    "INVITE sip:620@192.168.178.20:5062 SIP/2.0\r\n"
    "Via: SIP/2.0/UDP 192.168.178.1:5060;branch=z9hG4bKabc;rport\r\n"
    'From: "Max Muster" <sip:030123@fritz.box>;tag=f1\r\n'
    "t: <sip:620@fritz.box>\r\n"
    "i: call-1@fritz.box\r\n"
    "CSeq: 7 INVITE\r\n"
    "m: <sip:030123@192.168.178.1:5060>\r\n"
    "Subject: Test\r\n  fortgesetzt\r\n"
    "Content-Type: application/sdp\r\n"
    "l: 4\r\n\r\nv=0\r\nREST"
)


def test_anfrage_parsen() -> None:
    m = SipNachricht.parsen(INVITE.encode())
    assert m.ist_anfrage and m.methode == "INVITE" and m.uri == "sip:620@192.168.178.20:5062"
    assert m.kopf("To") == "<sip:620@fritz.box>"  # kompakte Form aufgelöst
    assert m.call_id == "call-1@fritz.box"
    assert m.cseq() == (7, "INVITE")
    assert m.branch == "z9hG4bKabc"
    assert m.via_oben()["rport"] == ""
    assert m.kopf("subject") == "Test fortgesetzt"  # Zeilenfortsetzung
    assert m.body == b"v=0\r"  # Content-Length begrenzt den Body


def test_antwort_parsen_und_kodieren_rundlauf() -> None:
    roh = b"SIP/2.0 180 Ringing\r\nVia: SIP/2.0/UDP a:1;branch=x, SIP/2.0/UDP b:2;branch=y\r\nCSeq: 1 INVITE\r\n\r\n"
    m = SipNachricht.parsen(roh)
    assert (m.status, m.grund) == (180, "Ringing")
    assert m.alle("via") == ["SIP/2.0/UDP a:1;branch=x", "SIP/2.0/UDP b:2;branch=y"]
    neu = SipNachricht.parsen(m.kodieren())
    assert neu.status == 180 and neu.kopf("cseq") == "1 INVITE"
    assert b"Content-Length: 0" in m.kodieren() and b"CSeq: 1 INVITE" in m.kodieren()


def test_kodieren_schreibweise_und_body() -> None:
    m = SipNachricht(methode="MESSAGE", uri="sip:x@y", body="häh".encode())
    m.hinzufuegen("call-id", "c")
    m.hinzufuegen("www-authenticate", "Digest")
    roh = m.kodieren()
    assert roh.startswith(b"MESSAGE sip:x@y SIP/2.0\r\nCall-ID: c\r\nWWW-Authenticate: Digest\r\n")
    assert roh.endswith("\r\n\r\nhäh".encode()) and f"Content-Length: {len('häh'.encode())}".encode() in roh


@pytest.mark.parametrize(
    "roh", [b"", b"\r\n\r\n", b"Quatsch\r\n\r\n", b"SIP/2.0 abc X\r\n\r\n", b"INVITE x SIP/2.0\r\nOhneDoppelpunkt\r\n\r\n"]
)
def test_ungueltige_nachrichten(roh: bytes) -> None:
    with pytest.raises(SipFehler):
        SipNachricht.parsen(roh)


def test_cseq_ungueltig() -> None:
    m = SipNachricht.parsen(b"OPTIONS sip:x SIP/2.0\r\nCSeq: abc\r\n\r\n")
    with pytest.raises(SipFehler):
        m.cseq()


def test_adressen() -> None:
    anzeige, uri, params = sip.adresse_parsen('"Max Muster" <sip:030123@fritz.box>;tag=f1')
    assert (anzeige, uri, params) == ("Max Muster", "sip:030123@fritz.box", {"tag": "f1"})
    assert sip.adresse_parsen("sip:a@b;tag=z")[1:] == ("sip:a@b", {"tag": "z"})
    assert sip.uri_teile("sip:620@192.168.178.20:5062;transport=udp") == ("620", "192.168.178.20", 5062)
    assert sip.uri_teile("sip:fritz.box") == ("", "fritz.box", None)
    assert sip.uri_teile("sip:%2B49301@host") == ("+49301", "host", None)
    assert sip.tag_von("<sip:a@b>;tag=q") == "q" and sip.tag_von(None) == ""


def test_digest_rfc2617_beispiel() -> None:
    """Beispiel aus RFC 2617, Abschnitt 3.5."""
    challenge = sip.challenge_parsen(
        'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", '
        'opaque="5ccc069c403ebaf9f0171e9517f40e41"'
    )
    assert challenge["qop"] == "auth,auth-int" and challenge["realm"] == "testrealm@host.com"
    wert = sip.digest_antwort(
        benutzer="Mufasa",
        passwort="Circle Of Life",
        methode="GET",
        uri="/dir/index.html",
        challenge=challenge,
        nc=1,
        cnonce="0a4f113b",
    )
    p = sip.challenge_parsen(wert)
    assert p["response"] == "6629fae49393a05397450978507c4ef1"
    assert p["nc"] == "00000001" and p["qop"] == "auth" and p["opaque"] == "5ccc069c403ebaf9f0171e9517f40e41"


def test_digest_ohne_qop_rfc2069() -> None:
    ch = {"realm": "r", "nonce": "n"}
    ha1 = hashlib.md5(b"u:r:p", usedforsecurity=False).hexdigest()
    ha2 = hashlib.md5(b"REGISTER:sip:x", usedforsecurity=False).hexdigest()
    erwartet = hashlib.md5(f"{ha1}:n:{ha2}".encode(), usedforsecurity=False).hexdigest()
    wert = sip.digest_antwort(benutzer="u", passwort="p", methode="REGISTER", uri="sip:x", challenge=ch)
    assert sip.challenge_parsen(wert)["response"] == erwartet and "qop" not in sip.challenge_parsen(wert)


def test_digest_unbekannter_algorithmus() -> None:
    with pytest.raises(SipFehler):
        sip.digest_antwort(benutzer="u", passwort="p", methode="X", uri="u", challenge={"algorithm": "SHA-256"})


def test_sdp_rundlauf() -> None:
    text = sip.sdp_bauen("192.168.178.20", 40000, [0, 8], 101)
    s = sip.sdp_parsen(text)
    assert (s.adresse, s.port, s.codecs, s.dtmf_pt) == ("192.168.178.20", 40000, [0, 8], 101)
    assert text.startswith("v=0\r\n") and "a=rtpmap:101 telephone-event/8000" in text


def test_sdp_parsen_varianten() -> None:
    text = "v=0\r\nc=IN IP4 10.0.0.1\r\nm=video 5000 RTP/AVP 96\r\nm=audio 7078 RTP/AVP 9 8 0 96\r\na=rtpmap:96 telephone-event/8000\r\n"
    s = sip.sdp_parsen(text)
    assert (s.adresse, s.port, s.codecs, s.dtmf_pt) == ("10.0.0.1", 7078, [8, 0], 96)  # G.722 (9) wird ausgelassen
    with pytest.raises(SipFehler, match="Kein Audio"):
        sip.sdp_parsen("v=0\r\nc=IN IP4 1.2.3.4\r\nm=video 1 RTP/AVP 96\r\n")
    with pytest.raises(SipFehler, match="abgelehnt"):
        sip.sdp_parsen("v=0\r\nc=IN IP4 1.2.3.4\r\nm=audio 0 RTP/AVP 0\r\n")


def test_grund_fuer_status() -> None:
    assert sip.grund_fuer_status(486) == "Besetzt"
    assert sip.grund_fuer_status(603) == "Abgelehnt"
    assert sip.grund_fuer_status(404) == "Nummer nicht erreichbar"
    assert sip.grund_fuer_status(500) == "SIP-Fehler 500"
