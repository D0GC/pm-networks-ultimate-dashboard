"""Telefon im Hub: Optionen, Favoriten, Anfragen der Panels und Zustandsmeldungen (Telefon selbst als Attrappe)."""

import asyncio
import json
import time
from datetime import UTC, datetime, timedelta

import aiohttp
import pytest

from panelstudio.config import Einstellungen, Options


class TelefonAttrappe:
    def __init__(self) -> None:
        self.aufrufe: list[tuple] = []
        self.toene: list[bytes] = []
        self.senden = None

    async def waehlen(self, nummer, panel_senden):
        self.aufrufe.append(("waehlen", nummer))
        self.senden = panel_senden
        return {"anruf": "a1"}

    async def annehmen(self, anruf, panel_senden):
        self.aufrufe.append(("annehmen", anruf))
        self.senden = panel_senden
        return True

    def ton(self, pcm):
        self.toene.append(pcm)

    async def ablehnen(self, anruf):
        self.aufrufe.append(("ablehnen", anruf))
        return True

    async def auflegen(self, anruf):
        self.aufrufe.append(("auflegen", anruf))
        return True

    async def dtmf(self, anruf, ziffern):
        self.aufrufe.append(("dtmf", anruf, ziffern))
        return True

    async def stumm(self, anruf, an):
        self.aufrufe.append(("stumm", anruf, an))
        return True

    async def kontakte(self, frisch=False):
        return [{"name": "Anna", "nummern": [{"nummer": "0921123", "typ": "home"}]}]

    async def verlauf(self):
        return []

    async def stop(self):
        pass


def _anruf(zustand, **extra):
    return {
        "aktiv": True,
        "registriert": True,
        "fehler": None,
        "anruf": {"id": "a1", "richtung": "ein", "nummer": "0921123", "name": "Anna", "zustand": zustand, **extra},
    }


async def _warte_auf(ws, bedingung):
    for _ in range(50):
        m = json.loads((await asyncio.wait_for(ws.receive(), 3)).data)
        if bedingung(m):
            return m
    raise AssertionError("Nachricht nicht erhalten")


def test_optionen_telefon_und_geheimnisse():
    o = Options.from_dict(
        {
            "telefon_server": " 192.168.178.1 ",
            "telefon_benutzer": "panelflur",
            "telefon_passwort": "geheim123",
            "fritz_passwort": "x",
        }
    )
    assert o.telefon and o.telefon_server == "192.168.178.1"
    oeffentlich = o.public()
    assert oeffentlich["telefon"] is True
    for k in ("telefon_passwort", "fritz_passwort", "telefon_benutzer", "telefon_server"):
        assert k not in oeffentlich
    assert not Options().telefon


def test_favoriten_werden_geprueft():
    e = Einstellungen()
    e.aktualisieren(
        {
            "telefon_favoriten": [
                {"name": "Mama", "nummer": "0921 / 12 34-56"},
                {"name": "", "nummer": "123"},
                {"name": "Böse", "nummer": "<script>"},
                "kein Eintrag",
                {"name": "Notruf", "nummer": "+49112"},
            ]
        }
    )
    assert e.telefon_favoriten == [{"name": "Mama", "nummer": "0921123456"}, {"name": "Notruf", "nummer": "+49112"}]
    assert "telefon" in Einstellungen().module


async def test_ohne_telefon_leere_listen_und_fehler(hub):
    assert await hub.anfrage({"typ": "telefon_kontakte"}) == []
    with pytest.raises(ValueError, match="nicht eingerichtet"):
        await hub.anfrage({"typ": "telefon_auflegen", "anruf": "a1"})
    assert hub.init_daten()["telefon"] == {"aktiv": False, "verpasst": []}


async def test_anfragen_und_meldungen(ingress, hub):
    tel = TelefonAttrappe()
    hub.telefon = tel
    ws = await ingress.ws_connect("/api/ws")
    await _warte_auf(ws, lambda m: m["typ"] == "init")

    # Eingehender Anruf: alle Panels erfahren es, das Panel wird wach
    hub.letzte_bewegung = time.monotonic() - 10_000
    hub._telefon_melden(_anruf("klingelt"))
    m = await _warte_auf(ws, lambda m: m["typ"] == "telefon")
    assert m["anruf"]["zustand"] == "klingelt"
    assert hub.modus == "wach"

    await ws.send_str(json.dumps({"typ": "telefon_annehmen", "id": 7, "anruf": "a1"}))
    m = await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 7)
    assert m["ok"] and m["ergebnis"] is True
    assert hub._telefon_panel is not None

    # Ton: Rahmen des Besitzers kommen an, Ausgangsrahmen landen beim Besitzer
    rahmen = bytes(range(160)) * 2
    await ws.send_bytes(rahmen)
    fremd = await ingress.ws_connect("/api/ws")
    await _warte_auf(fremd, lambda m: m["typ"] == "init")
    await fremd.send_bytes(b"\x01" * 320)
    await ws.send_bytes(rahmen)  # Synchronisationspunkt: zweiter Rahmen des Besitzers
    for _ in range(40):
        if len(tel.toene) >= 2:
            break
        await asyncio.sleep(0.05)
    assert tel.toene == [rahmen, rahmen]
    await tel.senden(b"\x07" * 320)
    m = await asyncio.wait_for(ws.receive(), 3)
    while m.type == aiohttp.WSMsgType.TEXT:  # Statusmeldungen überspringen
        m = await asyncio.wait_for(ws.receive(), 3)
    assert m.type == aiohttp.WSMsgType.BINARY and m.data == b"\x07" * 320
    await fremd.close()

    # waehlen: ebenfalls ohne Angebot
    await ws.send_str(json.dumps({"typ": "telefon_waehlen", "id": 6, "nummer": "0921123"}))
    m = await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 6)
    assert m["ergebnis"] == {"anruf": "a1"} and ("waehlen", "0921123") in tel.aufrufe

    await ws.send_str(json.dumps({"typ": "telefon_dtmf", "id": 8, "anruf": "a1", "ziffern": "12#"}))
    await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 8)
    await ws.send_str(json.dumps({"typ": "telefon_kontakte", "id": 9}))
    m = await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 9)
    assert m["ergebnis"][0]["name"] == "Anna"
    assert ("dtmf", "a1", "12#") in tel.aufrufe

    # Das Panel mit dem Ton trennt sich: der Anruf wird aufgelegt
    hub._telefon_melden(_anruf("verbunden"))
    await ws.close()
    for _ in range(40):
        if ("auflegen", "a1") in tel.aufrufe:
            break
        await asyncio.sleep(0.05)
    assert ("auflegen", "a1") in tel.aufrufe


async def test_anruf_haelt_panel_wach(hub):
    hub.telefon_stand = _anruf("verbunden")
    hub.letzte_bewegung = time.monotonic() - 10_000
    hub.letzte_beruehrung = 0
    hub._takt(1)
    assert hub.modus == "wach"


# ---------------------------------------------------------------- Verpasste Anrufe


def _gespeichert(hub) -> list[dict]:
    return json.loads(hub.verpasst_pfad.read_text(encoding="utf-8"))


async def test_verpasste_anrufe_werden_je_nummer_gezaehlt_und_gesendet(ingress, hub):
    ws = await ingress.ws_connect("/api/ws")
    m = await _warte_auf(ws, lambda m: m["typ"] == "init")
    assert m["telefon"]["verpasst"] == []

    hub.telefon_verpasst("0921123", "")
    m = await _warte_auf(ws, lambda m: m["typ"] == "telefon")
    (e,) = m["verpasst"]
    assert e["nummer"] == "0921123" and e["anzahl"] == 1 and e["name"] == "" and e["zuletzt"] == e["erste"]

    hub.telefon_verpasst("0921123", "Anna")  # zweiter Anruf derselben Nummer: eine Karte, Name nachgeführt
    hub.telefon_verpasst("555", "Max")
    m = await _warte_auf(ws, lambda m: m["typ"] == "telefon" and len(m["verpasst"]) == 2)
    anna = next(x for x in m["verpasst"] if x["nummer"] == "0921123")
    assert anna["anzahl"] == 2 and anna["name"] == "Anna"
    assert _gespeichert(hub) == hub.verpasst
    assert hub.init_daten()["telefon"]["verpasst"] == hub.verpasst
    # ein Statuswechsel des Telefons behält die Liste
    hub._telefon_melden(_anruf("klingelt"))
    m = await _warte_auf(ws, lambda m: m["typ"] == "telefon" and m.get("anruf"))
    assert len(m["verpasst"]) == 2


async def test_verpasst_erledigt_und_rueckruf_entfernen_den_eintrag(ingress, hub):
    tel = TelefonAttrappe()
    hub.telefon = tel
    hub.telefon_verpasst("0921123", "Anna")
    hub.telefon_verpasst("555", "Max")
    ws = await ingress.ws_connect("/api/ws")
    await _warte_auf(ws, lambda m: m["typ"] == "init")

    await ws.send_str(json.dumps({"typ": "telefon_verpasst_erledigt", "id": 1, "nummer": "555"}))
    m = await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 1)
    assert m["ok"] and m["ergebnis"] is True
    assert [e["nummer"] for e in hub.verpasst] == ["0921123"]
    assert [e["nummer"] for e in _gespeichert(hub)] == ["0921123"]

    # Rückruf: der Eintrag verschwindet, sobald der Anruf gestartet ist
    await ws.send_str(json.dumps({"typ": "telefon_waehlen", "id": 2, "nummer": "0921123"}))
    m = await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 2)
    assert m["ok"] and ("waehlen", "0921123") in tel.aufrufe
    assert hub.verpasst == [] and _gespeichert(hub) == []

    # unbekannte Nummer: nichts zu tun
    assert hub.verpasst_erledigt("999") is False


async def test_verpasst_wird_geladen_und_alte_tage_fallen_weg(hub):
    jetzt = datetime.now(UTC)
    gestern = jetzt - timedelta(days=2)
    hub.verpasst_pfad.write_text(
        json.dumps(
            [
                {"nummer": "1", "name": "Heute", "anzahl": 3, "zuletzt": jetzt.isoformat(), "erste": jetzt.isoformat()},
                {"nummer": "2", "name": "Alt", "anzahl": 1, "zuletzt": gestern.isoformat(), "erste": gestern.isoformat()},
                {"nummer": "3", "kaputt": True},
                "quatsch",
            ]
        ),
        encoding="utf-8",
    )
    assert [e["nummer"] for e in hub._verpasst_laden()] == ["1"]

    # Tageswechsel im laufenden Betrieb
    hub.verpasst = [
        {"nummer": "1", "name": "", "anzahl": 1, "zuletzt": jetzt.isoformat(), "erste": jetzt.isoformat()},
        {"nummer": "2", "name": "", "anzahl": 1, "zuletzt": gestern.isoformat(), "erste": gestern.isoformat()},
    ]
    assert hub._verpasst_tagesende() is True
    assert [e["nummer"] for e in hub.verpasst] == ["1"]
    assert hub._verpasst_tagesende() is False
    hub.telefon_verpasst("4", "")  # auch beim Eintragen wird aufgeräumt und gespeichert
    assert [e["nummer"] for e in _gespeichert(hub)] == ["1", "4"]


async def test_verpasst_datei_kaputt_beginnt_leer(hub):
    hub.verpasst_pfad.write_text("{nicht json", encoding="utf-8")
    assert hub._verpasst_laden() == []
    hub.verpasst_pfad.write_text('{"a": 1}', encoding="utf-8")
    assert hub._verpasst_laden() == []
    hub.verpasst_pfad.unlink()
    assert hub._verpasst_laden() == []
