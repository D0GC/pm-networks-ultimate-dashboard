from pathlib import Path

from panelstudio.config import Einstellungen, EinstellungsSpeicher, Options


def test_optionen_filtern_ungueltige_entitaeten():
    o = Options.from_dict({"bewegung": ["binary_sensor.a", "kein text", "binary_sensor.a"], "ereignis_kamera": "x"})
    assert o.bewegung == ["binary_sensor.a"]
    assert o.ereignis_kamera == ""


def test_pakete_entitaet_vorgabe_und_abschalten(tmp_path):
    # Ohne Eintrag in den gespeicherten App-Optionen (Update von einer älteren Version) gilt die Vorgabe
    assert Options().pakete_entitaet == "sensor.pakete"
    assert Options.from_dict({}).pakete_entitaet == "sensor.pakete"
    assert Options.from_dict({"hinweise_entitaet": "sensor.x"}).pakete_entitaet == "sensor.pakete"
    pfad = tmp_path / "options.json"
    pfad.write_text('{"log_level": "info"}', encoding="utf-8")
    assert Options.load(pfad).pakete_entitaet == "sensor.pakete"
    assert Options.load(tmp_path / "fehlt.json").pakete_entitaet == "sensor.pakete"
    # eigene Entität, leer = Karte aus, ungültig = aus
    assert Options.from_dict({"pakete_entitaet": "sensor.sendungen"}).pakete_entitaet == "sensor.sendungen"
    assert Options.from_dict({"pakete_entitaet": ""}).pakete_entitaet == ""
    assert Options.from_dict({"pakete_entitaet": None}).pakete_entitaet == ""
    assert Options.from_dict({"pakete_entitaet": "kein text"}).pakete_entitaet == ""
    assert Options().public()["pakete_entitaet"] == "sensor.pakete"


def test_app_optionen_in_config_yaml_und_uebersetzungen():
    app = Path(__file__).resolve().parents[1] / "pm_panel_studio"
    yaml = (app / "config.yaml").read_text(encoding="utf-8")
    assert "  pakete_entitaet: sensor.pakete\n" in yaml and "  pakete_entitaet: str?\n" in yaml
    for sprache in ("de", "en"):
        assert "  pakete_entitaet:\n    name:" in (app / "translations" / f"{sprache}.yaml").read_text(encoding="utf-8")


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
    assert alt.module == ["raeume", "klima", "wartung", "studio", "musik", "haushalt", "shisha", "telefon", "suche"]
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


def test_stundenplan_und_dock_anzahl():
    e = Einstellungen()
    assert e.stundenplan_kalender == ["calendar.universitat"] and e.dock_anzahl == 6
    assert e.aktualisieren({"stundenplan_kalender": ["calendar.uni", "sensor.x", "kein text", "calendar.uni"]}) == []
    assert e.stundenplan_kalender == ["calendar.uni"]
    e.aktualisieren({"stundenplan_kalender": []})
    assert e.stundenplan_kalender == []
    e.aktualisieren({"dock_anzahl": 1})
    assert e.dock_anzahl == 3
    e.aktualisieren({"dock_anzahl": 99})
    assert e.dock_anzahl == 12
    assert e.aktualisieren({"dock_anzahl": "viele"}) == ["dock_anzahl"]


def test_status_modi():
    e = Einstellungen()
    assert "input_boolean.alles_stumm" in e.status_modi and len(e.status_modi) == 5
    e.aktualisieren(
        {"status_modi": ["input_boolean.a", "switch.b", "binary_sensor.c", "light.d", "kein text", "input_boolean.a"]}
    )
    assert e.status_modi == ["input_boolean.a", "switch.b", "binary_sensor.c"]
    e.aktualisieren({"status_modi": []})
    assert e.status_modi == []


def test_admin_startseite():
    from panelstudio.config import ADMIN_START, Einstellungen

    e = Einstellungen()
    assert e.admin_start == ADMIN_START and e.admin_start[0] == "aufmerksamkeit:12:2"
    # unbekannte Blöcke und Doppelte fallen weg; fehlende Größe aus der Vorgabe; altes Format „block:spalten“ (1–3)
    assert e.aktualisieren({"admin_start": ["klima:5:3", "klima:1", "gibtsnicht", "raeume", "termine:2", "pakete:40:99"]}) == []
    assert e.admin_start == ["klima:5:3", "raeume:6:7", "termine:8:6", "pakete:12:24"]
    e.aktualisieren({"admin_start": []})
    assert e.admin_start == []


def test_neuer_admin_block_wird_einmalig_angehaengt():
    from panelstudio.config import Einstellungen

    e = Einstellungen.from_dict({"admin_start": ["klima:4:5"]})
    assert e.admin_start == ["klima:4:5", "netzwerk:4:6"] and "netzwerk" in e.admin_bekannt
    # Wer den Block danach entfernt, bekommt ihn nicht wieder
    e2 = Einstellungen.from_dict({"admin_start": ["klima:4:5"], "admin_bekannt": e.admin_bekannt})
    assert e2.admin_start == ["klima:4:5"]


def test_unifi_optionen_bleiben_privat():
    from panelstudio.config import Options

    o = Options.from_dict({"unifi_api_schluessel": "geheim", "unifi_adresse": "https://192.168.3.1"})
    p = o.public()
    assert p["unifi"] is True and "unifi_api_schluessel" not in p and "unifi_kennwort" not in p


def test_reihenfolgen():
    e = Einstellungen()
    ab = e.aktualisieren(
        {
            "reihenfolgen": {
                "raeume/Büro|Geräte|raster0": ["switch.b", "switch.a", "switch.b", " ", "box:Licht\x00"],
                "leer": [],
                "kaputt": "switch.a",
            }
        }
    )
    assert not ab
    assert e.reihenfolgen == {"raeume/Büro|Geräte|raster0": ["switch.b", "switch.a", "box:Licht"]}
    assert Einstellungen.from_dict(e.to_dict()).reihenfolgen == e.reihenfolgen
    assert e.aktualisieren({"reihenfolgen": ["x"]}) == ["reihenfolgen"]
    viele = {f"s{i}": ["a"] for i in range(1000)}
    e.aktualisieren({"reihenfolgen": viele})
    assert len(e.reihenfolgen) == 400
