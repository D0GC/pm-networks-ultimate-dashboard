"""Telefon im Hub: Optionen, Favoriten, Anfragen der Panels und Zustandsmeldungen (Telefon selbst als Attrappe)."""

import asyncio
import json
import time

from panelstudio.config import Einstellungen, Options


class TelefonAttrappe:
    def __init__(self) -> None:
        self.aufrufe: list[tuple] = []

    async def waehlen(self, nummer, angebot):
        self.aufrufe.append(("waehlen", nummer, angebot))
        return {"anruf": "a1", "antwort": "v=0 antwort"}

    async def annehmen(self, anruf, angebot):
        self.aufrufe.append(("annehmen", anruf, angebot))
        return "v=0 antwort"

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

    async def kontakte(self):
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
    try:
        await hub.anfrage({"typ": "telefon_auflegen", "anruf": "a1"})
    except ValueError as err:
        assert "nicht eingerichtet" in str(err)
    else:
        raise AssertionError("Fehler erwartet")
    assert hub.init_daten()["telefon"] == {"aktiv": False}


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

    await ws.send_str(json.dumps({"typ": "telefon_annehmen", "id": 7, "anruf": "a1", "angebot": "v=0 x"}))
    m = await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 7)
    assert m["ok"] and m["ergebnis"] == "v=0 antwort"
    assert hub._telefon_panel is not None

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
