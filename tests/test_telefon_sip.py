"""SIP-Agent gegen eine Fake-FRITZ!Box auf 127.0.0.1 (UDP) und Validierung der Telefon-Fassade."""

from __future__ import annotations

import asyncio

import pytest

from panelstudio.telefon import Telefon, TelefonConfig, TelefonFehler, sip
from panelstudio.telefon.sip import SipAgent, SipConfig, SipNachricht
from telefon_fake import SDP_FAKE, FakeFritz, bis


@pytest.fixture
async def fake():
    f = await FakeFritz().starten()
    yield f
    f.schliessen()


def _cfg(fake: FakeFritz, passwort: str = "geheim") -> SipConfig:
    return SipConfig(
        server="127.0.0.1",
        port=fake.port,
        benutzer="620",
        passwort=passwort,
        lokaler_port=0,
        bind="127.0.0.1",
        t1=0.05,
        wiederholung_s=0.2,
    )


@pytest.fixture
async def agent(fake):
    ereignisse: list[tuple[str, str]] = []
    a = SipAgent(
        _cfg(fake),
        auf_status=lambda: ereignisse.append(("status", "")),
        auf_anruf=lambda c: ereignisse.append(("anruf", c.id)),
        auf_aenderung=lambda c: ereignisse.append(("aenderung", c.zustand)),
    )
    a.ereignisse = ereignisse  # type: ignore[attr-defined]
    await a.start()
    await bis(lambda: a.registriert)
    yield a
    await a.stop()


def _invite(fake: FakeFritz, call_id: str = "ein-1@fritz", branch: str = "z9hG4bKein1") -> bytes:
    return fake.anfrage(
        "INVITE",
        f"sip:620@127.0.0.1:{fake.client[1]}",
        von='"Max Muster" <sip:0301234567@fritz.box>;tag=ft1',
        an="<sip:620@fritz.box>",
        call_id=call_id,
        cseq=1,
        branch=branch,
        body=SDP_FAKE.format(port=40500),
    )


async def test_register_mit_digest_und_abmeldung(fake) -> None:
    a = SipAgent(_cfg(fake))
    await a.start()
    try:
        await bis(lambda: a.registriert)
        assert fake.registrierungen == 1 and fake.auth_ok == [True]
        regs = [m for m in fake.alle if m.methode == "REGISTER"]
        assert len(regs) == 2  # 401-Challenge + Wiederholung mit Authorization
        assert regs[0].kopf("authorization") is None and regs[1].kopf("authorization")
        assert regs[1].cseq()[0] == regs[0].cseq()[0] + 1 and regs[1].call_id == regs[0].call_id
        assert regs[1].branch != regs[0].branch
        assert a.fehler is None
    finally:
        await a.stop()
    abmeldung = [m for m in fake.alle if m.methode == "REGISTER" and m.kopf("expires") == "0"]
    assert abmeldung and not a.registriert


async def test_register_falsches_passwort(fake) -> None:
    a = SipAgent(_cfg(fake, passwort="falsch"))
    await a.start()
    try:
        await bis(lambda: a.fehler is not None)
        assert not a.registriert and "Passwort" in a.fehler
        assert fake.registrierungen == 0
    finally:
        await a.stop()


async def test_register_ohne_antwort_meldet_fehler() -> None:
    f = await FakeFritz().starten()
    port = f.port
    f.schliessen()  # niemand hört mehr zu
    cfg = SipConfig(server="127.0.0.1", port=port, benutzer="u", passwort="p", lokaler_port=0, bind="127.0.0.1", t1=0.005)
    a = SipAgent(cfg)
    await a.start()
    try:
        await bis(lambda: a.fehler is not None, timeout=8)
        assert not a.registriert
    finally:
        await a.stop()


async def test_options_wird_beantwortet(agent, fake) -> None:
    fake.sende_roh(
        fake.anfrage(
            "OPTIONS", "sip:620@127.0.0.1", von="<sip:fritz@x>;tag=1", an="<sip:620@x>", call_id="o1", cseq=1, branch="z9hG4bKo1"
        )
    )
    antwort = await fake.warte(lambda m: not m.ist_anfrage and m.call_id == "o1")
    assert antwort.status == 200


async def test_eingehender_anruf_annehmen_und_bye(agent, fake) -> None:
    fake.sende_roh(_invite(fake))
    r180 = await fake.warte(lambda m: m.status == 180)
    assert tag_vorhanden(r180)
    assert [m.status for m in fake.alle if not m.ist_anfrage and m.call_id == "ein-1@fritz"][:2] == [100, 180]
    anruf = agent.anruf
    assert anruf and anruf.richtung == "ein" and anruf.zustand == "klingelt"
    assert (anruf.nummer, anruf.anzeigename) == ("0301234567", "Max Muster")
    assert anruf.remote_sdp.port == 40500 and anruf.codec == 0 and anruf.dtmf_pt == 101

    await agent.annehmen(anruf, 40001)
    r200 = await fake.warte(lambda m: m.status == 200 and m.cseq()[1] == "INVITE")
    sdp = sip.sdp_parsen(r200.body.decode())
    assert sdp.port == 40001 and sdp.codecs == [0] and sdp.dtmf_pt == 101
    assert r200.kopf("contact") and sip.tag_von(r200.kopf("to")) == anruf.lokal_tag
    assert anruf.zustand == "verbunden"

    # ACK der Gegenstelle stoppt die Wiederholung des 200
    ack = fake.anfrage(
        "ACK",
        r200.kopf("contact").strip("<>"),
        von='"Max Muster" <sip:0301234567@fritz.box>;tag=ft1',
        an=r200.kopf("to"),
        call_id="ein-1@fritz",
        cseq=1,
        branch="z9hG4bKack1",
    )
    fake.sende_roh(ack)
    await asyncio.sleep(0.3)
    zaehler = len([m for m in fake.alle if m.status == 200 and m.cseq()[1] == "INVITE"])
    await asyncio.sleep(0.4)
    assert len([m for m in fake.alle if m.status == 200 and m.cseq()[1] == "INVITE"]) == zaehler

    fake.sende_roh(
        fake.anfrage(
            "BYE",
            r200.kopf("contact").strip("<>"),
            von='"Max Muster" <sip:0301234567@fritz.box>;tag=ft1',
            an=r200.kopf("to"),
            call_id="ein-1@fritz",
            cseq=2,
            branch="z9hG4bKbye1",
        )
    )
    bye_ok = await fake.warte(lambda m: not m.ist_anfrage and m.cseq()[1] == "BYE")
    assert bye_ok.status == 200
    await bis(lambda: agent.anruf is None)
    assert anruf.zustand == "beendet" and anruf.grund == "Gegenstelle hat aufgelegt"


def tag_vorhanden(m: SipNachricht) -> bool:
    return bool(sip.tag_von(m.kopf("to")))


async def test_invite_wiederholung_wird_nicht_doppelt_angelegt(agent, fake) -> None:
    fake.sende_roh(_invite(fake))
    fake.sende_roh(_invite(fake))
    await bis(lambda: len([m for m in fake.alle if m.status == 180]) >= 2)
    assert [e for e in agent.ereignisse if e[0] == "anruf"] == [("anruf", agent.anruf.id)]


async def test_cancel_waehrend_klingeln_liefert_487(agent, fake) -> None:
    fake.sende_roh(_invite(fake))
    await fake.warte(lambda m: m.status == 180)
    fake.sende_roh(
        fake.anfrage(
            "CANCEL",
            f"sip:620@127.0.0.1:{fake.client[1]}",
            von='"Max Muster" <sip:0301234567@fritz.box>;tag=ft1',
            an="<sip:620@fritz.box>",
            call_id="ein-1@fritz",
            cseq=1,
            branch="z9hG4bKein1",
        )
    )
    await bis(lambda: any(m.status == 487 and m.cseq()[1] == "INVITE" for m in fake.alle))
    await bis(lambda: any(m.status == 200 and m.cseq()[1] == "CANCEL" and m.call_id == "ein-1@fritz" for m in fake.alle))
    assert agent.anruf is None
    assert ("aenderung", "beendet") in agent.ereignisse


async def test_ablehnen_und_zweiter_anruf_besetzt(agent, fake) -> None:
    fake.sende_roh(_invite(fake))
    await fake.warte(lambda m: m.status == 180)
    fake.sende_roh(_invite(fake, call_id="ein-2@fritz", branch="z9hG4bKein2"))
    r486 = await fake.warte(lambda m: m.status == 486)
    assert r486.call_id == "ein-2@fritz"
    anruf = agent.anruf
    agent.ablehnen(anruf)
    r603 = await fake.warte(lambda m: m.status == 603)
    assert r603.call_id == "ein-1@fritz" and agent.anruf is None and anruf.grund == "Abgelehnt"
    with pytest.raises(sip.SipFehler):
        agent.ablehnen(anruf)


async def test_invite_ohne_unterstuetzten_codec_wird_488(agent, fake) -> None:
    sdp = "v=0\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio 4000 RTP/AVP 9\r\na=rtpmap:9 G722/8000\r\n"
    fake.client = fake.client
    fake.sende_roh(
        fake.anfrage(
            "INVITE",
            "sip:620@127.0.0.1",
            von="<sip:1@x>;tag=1",
            an="<sip:620@x>",
            call_id="g722",
            cseq=1,
            branch="z9hG4bKg722",
            body=sdp,
        )
    )
    assert (await fake.warte(lambda m: m.status == 488)).call_id == "g722"
    assert agent.anruf is None


async def test_ausgehender_anruf_mit_407_challenge(agent, fake) -> None:
    fake.proxy_auth_fuer_invite = True
    fake.rtp_port = 40600
    anruf = agent.anrufen("0301234567", 40002)
    assert anruf.zustand == "waehlt" and anruf.richtung == "aus"
    await bis(lambda: anruf.zustand == "verbunden")
    invites = [m for m in fake.alle if m.methode == "INVITE"]
    assert len(invites) == 2 and invites[1].kopf("proxy-authorization") and fake.auth_ok[-1]
    assert invites[1].cseq()[0] == invites[0].cseq()[0] + 1 and invites[0].call_id == invites[1].call_id
    assert invites[0].uri == f"sip:0301234567@127.0.0.1:{fake.port}"
    sdp = sip.sdp_parsen(invites[0].body.decode())
    assert sdp.port == 40002 and sdp.codecs == [0, 8]
    # ACK auf die 407 (gleicher Branch wie der erste INVITE) und ACK auf das 200 (neuer Branch)
    acks = [m for m in fake.alle if m.methode == "ACK"]
    await bis(lambda: len([m for m in fake.alle if m.methode == "ACK"]) >= 2)
    acks = [m for m in fake.alle if m.methode == "ACK"]
    assert acks[0].branch == invites[0].branch and acks[0].cseq()[0] == 1
    assert acks[1].cseq()[0] == 2 and acks[1].branch not in (invites[0].branch, invites[1].branch)
    assert anruf.remote_sdp.port == 40600 and anruf.codec == 0 and anruf.dtmf_pt == 101

    await agent.auflegen(anruf)
    bye = await fake.warte(lambda m: m.methode == "BYE")
    assert bye.call_id == anruf.call_id and sip.tag_von(bye.kopf("to")) == "fritz1"
    await bis(lambda: agent.anruf is None)
    assert anruf.zustand == "beendet"


async def test_ausgehender_anruf_abgelehnt(agent, fake) -> None:
    fake.auto_invite = False
    anruf = agent.anrufen("999", 40002)
    inv = await fake.warte(lambda m: m.methode == "INVITE")
    fake._senden(fake.antwort(inv, 486))
    await bis(lambda: anruf.zustand == "beendet")
    assert anruf.grund == "Besetzt" and agent.anruf is None
    ack = await fake.warte(lambda m: m.methode == "ACK")
    assert ack.branch == inv.branch


async def test_ausgehender_anruf_cancel_waehrend_klingeln(agent, fake) -> None:
    fake.auto_invite = False
    anruf = agent.anrufen("0301", 40002)
    inv = await fake.warte(lambda m: m.methode == "INVITE")
    fake._senden(fake.antwort(inv, 180))
    await bis(lambda: anruf.vorlaeufig_gesehen)
    await agent.auflegen(anruf)
    cancel = await fake.warte(lambda m: m.methode == "CANCEL")
    assert cancel.branch == inv.branch and cancel.cseq() == (1, "CANCEL")
    fake._senden(fake.antwort(cancel, 200))
    fake._senden(fake.antwort(inv, 487))
    await bis(lambda: anruf.zustand == "beendet")
    assert anruf.grund == "Abgebrochen" and agent.anruf is None
    assert (await fake.warte(lambda m: m.methode == "ACK")).branch == inv.branch


async def test_zweiter_ausgehender_anruf_wird_abgelehnt(agent, fake) -> None:
    fake.auto_invite = False
    agent.anrufen("1", 40002)
    with pytest.raises(sip.SipFehler):
        agent.anrufen("2", 40003)


# --------------------------------------------------------------------------- Fassade (ohne Netzwerk)


async def test_telefon_config_aktiv() -> None:
    assert not TelefonConfig().aktiv
    assert not TelefonConfig(server="fritz.box", benutzer="620").aktiv
    assert TelefonConfig(server="fritz.box", benutzer="620", passwort="x").aktiv


async def test_telefon_deaktiviert_status_und_leere_listen() -> None:
    meldungen: list[dict] = []
    t = Telefon(TelefonConfig(), meldungen.append)
    await t.start()
    assert t.status() == {"aktiv": False, "registriert": False, "fehler": None, "anruf": None}
    assert await t.kontakte() == [] and await t.verlauf() == []
    await t.stop()


async def test_telefon_unvollstaendige_zugangsdaten_melden_fehler() -> None:
    meldungen: list[dict] = []
    t = Telefon(TelefonConfig(server="fritz.box"), meldungen.append)
    await t.start()
    assert t.status()["fehler"] and meldungen
    await t.stop()


@pytest.mark.parametrize("nummer", ["", "abc", "0301 234", "1" * 33, "0301;x", "+49-30", "٣"])
async def test_waehlen_ungueltige_nummer(nummer: str) -> None:
    t = Telefon(TelefonConfig(), lambda s: None)
    with pytest.raises(ValueError, match="Rufnummer"):
        await t.waehlen(nummer, None)


async def test_waehlen_gueltig_aber_telefon_nicht_aktiv() -> None:
    t = Telefon(TelefonConfig(), lambda s: None)
    with pytest.raises(TelefonFehler):
        await t.waehlen("+4930123", None)


async def test_unbekannte_anruf_id() -> None:
    t = Telefon(TelefonConfig(), lambda s: None)
    for aufruf in (
        t.annehmen("x", None),
        t.ablehnen("x"),
        t.auflegen("x"),
        t.dtmf("x", "1"),
        t.stumm("x", True),
    ):
        with pytest.raises(ValueError, match="Unbekannter Anruf"):
            await aufruf


async def test_dtmf_ungueltige_ziffern() -> None:
    t = Telefon(TelefonConfig(), lambda s: None)
    for z in ("", "x", "1" * 33, "12 3"):
        with pytest.raises(ValueError, match="Wählzeichen"):
            await t.dtmf("x", z)
