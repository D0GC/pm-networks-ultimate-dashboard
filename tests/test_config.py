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


def test_ton_einstellungen():
    e = Einstellungen()
    assert e.ton_hoch and e.ton_lautstaerke == 70
    e.aktualisieren({"ton_hoch": False, "ton_lautstaerke": 500})
    assert e.ton_hoch is False and e.ton_lautstaerke == 100


def test_klingel_einstellungen():
    e = Einstellungen()
    assert e.ton_klingel is True and e.klingel_lautstaerke == 100
    assert Einstellungen.from_dict({}).klingel_lautstaerke == 100
    assert e.aktualisieren({"ton_klingel": False, "klingel_lautstaerke": 40}) == []
    assert e.ton_klingel is False and e.klingel_lautstaerke == 40
    e.aktualisieren({"klingel_lautstaerke": 1})
    assert e.klingel_lautstaerke == 5
    e.aktualisieren({"klingel_lautstaerke": 500})
    assert e.klingel_lautstaerke == 100
    assert e.aktualisieren({"klingel_lautstaerke": "laut"}) == ["klingel_lautstaerke"]
    assert e.klingel_lautstaerke == 100
    # unabhängig vom Hinweiston
    e.aktualisieren({"ton_lautstaerke": 20, "ton_hoch": False, "ton_klingel": True})
    assert e.klingel_lautstaerke == 100 and e.ton_klingel is True and e.ton_lautstaerke == 20


def test_klingel_einstellungen_speichern(tmp_path):
    sp = EinstellungsSpeicher(tmp_path)
    e = Einstellungen()
    e.aktualisieren({"ton_klingel": False, "klingel_lautstaerke": 55})
    sp.speichern(e)
    geladen = sp.laden()
    assert geladen.ton_klingel is False and geladen.klingel_lautstaerke == 55
    assert geladen.to_dict()["klingel_lautstaerke"] == 55


def test_raum_schalter_und_wartung():
    e = Einstellungen()
    assert "input_button.shower_mode" in e.raum_schalter["badezimmer"]
    assert e.wartung_ignorieren == [] and e.material_modus == "auto"
    assert e.aussen_feuchte[0] == "sensor.wetter_outdoor_module_luftfeuchtigkeit"
    # Die frühere Jarvis-Liste in gespeicherten Einstellungen wird still übergangen
    assert e.aktualisieren({"wartung_entitaeten": ["binary_sensor.x"]}) == []
    assert e.aktualisieren({"material_modus": "egal"}) == ["material_modus"]
    e.aktualisieren({"material_modus": "manuell", "material_fest": ["sensor.filter", "kein text"]})
    assert e.material_modus == "manuell" and e.material_fest == ["sensor.filter"]
    e.aktualisieren({"gruss": False, "gruss_anrede": {"person.gina_perina": "Gina", "licht.x": "Nein"}})
    assert e.gruss is False and e.gruss_anrede == {"person.gina_perina": "Gina"}
    e.aktualisieren(
        {"raum_schalter": {"wohnzimmer": ["input_boolean.gina_lernt", "kein text"], "Ungültig!": ["input_boolean.x"]}}
    )
    assert e.raum_schalter == {"wohnzimmer": ["input_boolean.gina_lernt"]}
    assert e.aktualisieren({"raum_schalter": "falsch"}) == ["raum_schalter"]


def test_neues_modul_wird_einmalig_eingereiht():
    alt = Einstellungen.from_dict({"module": ["raeume", "klima", "wartung", "suche"]})
    assert alt.module == ["raeume", "klima", "wartung", "studio", "musik", "haushalt", "shisha", "suche"]
    # Nach dem Speichern kennt der Stand Shisha; abgewählt bleibt es abgewählt
    neu = Einstellungen.from_dict({**alt.to_dict(), "module": ["raeume", "suche"]})
    assert neu.module == ["raeume", "suche"]


def test_standard_freigaben_bleiben_bei_gespeicherten():
    from panelstudio.config import Einstellungen

    e = Einstellungen.from_dict({"freigaben": {"switch.x": "input_boolean.y"}})
    for eid in ("switch.buro_buro", "switch.schreibtisch", "switch.serverschrank"):
        assert e.freigaben[eid] == "input_boolean.burostrom_schaltfreigabe"
    assert e.freigaben["switch.wohnzimmer_wohnzimmer"] == "input_boolean.wohnzimmerstrom_schaltfreigabe"
    assert e.freigaben["switch.x"] == "input_boolean.y"
