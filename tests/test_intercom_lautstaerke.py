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
