"""Einstellung „Lautstärke Gegensprechen“."""

from panelstudio.config import Einstellungen


def test_standard_und_grenzen():
    e = Einstellungen()
    assert e.intercom_lautstaerke == 400
    e.aktualisieren({"intercom_lautstaerke": 2000})
    assert e.intercom_lautstaerke == 800
    e.aktualisieren({"intercom_lautstaerke": 20})
    assert e.intercom_lautstaerke == 100
    assert Einstellungen.from_dict(e.to_dict()).intercom_lautstaerke == 100


def test_ton_verstaerkung_und_telefon():
    e = Einstellungen()
    assert e.ton_verstaerkung == 300 and e.telefon_lautstaerke == 400
    e.aktualisieren({"ton_verstaerkung": 5000, "telefon_lautstaerke": 20})
    assert e.ton_verstaerkung == 800 and e.telefon_lautstaerke == 100
    e.aktualisieren({"ton_verstaerkung": 10})
    assert e.ton_verstaerkung == 100
    assert e.aktualisieren({"telefon_lautstaerke": "laut"}) == ["telefon_lautstaerke"]
    assert e.telefon_lautstaerke == 100
    geladen = Einstellungen.from_dict(e.to_dict())
    assert geladen.ton_verstaerkung == 100 and geladen.telefon_lautstaerke == 100
