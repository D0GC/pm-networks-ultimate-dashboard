from panelstudio.config import Einstellungen, EinstellungsSpeicher, Options


def test_optionen_filtern_ungueltige_entitaeten():
    o = Options.from_dict({"bewegung": ["binary_sensor.a", "kein text", "binary_sensor.a"], "ereignis_kamera": "x"})
    assert o.bewegung == ["binary_sensor.a"]
    assert o.ereignis_kamera == ""


def test_einstellungen_grenzen_und_abweisung():
    e = Einstellungen()
    ab = e.aktualisieren(
        {"verweildauer_s": 1, "ruhe_nach_s": "abc", "module": ["suche", "start", "quatsch", "licht"], "unbekannt": 1}
    )
    assert e.verweildauer_s == 3
    assert e.module == ["suche", "licht"]
    assert set(ab) == {"ruhe_nach_s", "unbekannt"}


def test_speicher_und_token(tmp_path):
    sp = EinstellungsSpeicher(tmp_path)
    e = sp.laden()
    e.verweildauer_s = 12
    sp.speichern(e)
    assert sp.laden().verweildauer_s == 12
    t1 = sp.token()
    assert len(t1) >= 24 and sp.token() == t1
    assert sp.token(neu=True) != t1
