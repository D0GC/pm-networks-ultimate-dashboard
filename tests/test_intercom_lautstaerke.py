"""Verstärkungen: Gegensprechen, Telefon, Ansagen, Hinweis- und Klingelton (Prozent, 100 = unverändert)."""

from panelstudio.config import Einstellungen


def test_standard_und_grenzen():
    e = Einstellungen()
    assert e.intercom_lautstaerke == 150
    e.aktualisieren({"intercom_lautstaerke": 2000})
    assert e.intercom_lautstaerke == 400
    e.aktualisieren({"intercom_lautstaerke": 5})
    assert e.intercom_lautstaerke == 25
    assert Einstellungen.from_dict(e.to_dict()).intercom_lautstaerke == 25


def test_ton_verstaerkung_und_telefon():
    e = Einstellungen()
    assert e.ton_verstaerkung == 100 and e.telefon_lautstaerke == 100 and e.ansage_lautstaerke == 100
    e.aktualisieren({"ton_verstaerkung": 5000, "telefon_lautstaerke": 10})
    assert e.ton_verstaerkung == 400 and e.telefon_lautstaerke == 25
    assert e.aktualisieren({"telefon_lautstaerke": "laut"}) == ["telefon_lautstaerke"]
    geladen = Einstellungen.from_dict(e.to_dict())
    assert geladen.ton_verstaerkung == 400 and geladen.telefon_lautstaerke == 25
