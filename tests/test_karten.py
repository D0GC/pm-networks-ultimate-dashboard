from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from panelstudio import karten as kt

JETZT = datetime(2026, 10, 1, 14, 0, tzinfo=UTC)


def st(state, **attrs):
    return {"state": state, "attributes": attrs}


def test_hinweise_eil_zuerst_und_max_acht():
    zeilen = "muell|Müll|morgen|Bio\neil|ARD|Eilmeldung|Schlagzeile\n" + "\n".join(f"wetter|W{i}|x|y" for i in range(10))
    k = kt.parse_hinweise(zeilen)
    assert k[0]["schluessel"] == "eil"
    assert len(k) == 8
    assert k[1]["titel"] == "Müll"


def test_hinweis_felder_und_weitere_trenner():
    (k,) = kt.parse_hinweise("offen|Offen|2 offen|Tür | Fenster\r\n\n")
    assert (k["titel"], k["wert"], k["hinweis"]) == ("Offen", "2 offen", "Tür | Fenster")
    assert kt.parse_hinweise(None) == []


def test_kohle_timer_ring_und_restzeit():
    states = {
        "timer.kohle_timer": st("active", duration="0:15:00", finishes_at=(JETZT + timedelta(minutes=5)).isoformat()),
    }
    k = kt.akt_kohle(states, JETZT)
    assert k["wert"] == "5:00"
    assert abs(k["ring"] - 1 / 3) < 0.01
    assert k["dauer_s"] == 900


def test_kohle_bereit_ohne_timer():
    k = kt.akt_kohle({"switch.balkon_kohlegrill": st("on")}, JETZT)
    assert k["wert"] == "Bereit"


def test_dusche_hat_vorrang_vor_spa():
    states = {
        "timer.duschmodus_heizung": st("paused", duration="0:20:00", remaining="0:10:00"),
        "timer.spa_heizung_erinnerung": st("active", duration="1:00:00", finishes_at=(JETZT + timedelta(hours=1)).isoformat()),
    }
    k = kt.akt_dusche_spa(states, JETZT)
    assert k["schluessel"] == "dusche" and k["hinweis"] == "pausiert" and k["ring"] == 0.5


def test_waesche_laeuft_nach_phase():
    states = {
        "sensor.waschmaschine_phase": st("Spülen"),
        "sensor.waschmaschine_fortschritt": st("60"),
        "sensor.karl_die_waschmaschine_verbleibende_zeit": st("75", unit_of_measurement="min"),
    }
    k = kt.akt_waesche(states, JETZT)
    assert k["wert"] == "1:15 h" and k["ring"] == 0.6 and k["hinweis"] == "Spülen 60 %"
    assert kt.akt_waesche({"sensor.waschmaschine_phase": st("Aus")}, JETZT) is None


def test_waesche_programmende_vor_phasen_restzeit():
    # LG meldet nach dem Start nur die Restzeit der Phase (20 min); maßgeblich ist das Programmende (81 min)
    states = {
        "sensor.karl_die_waschmaschine_aktueller_status": st("running"),
        "sensor.karl_die_waschmaschine_verbleibende_zeit": st((JETZT + kt.timedelta(minutes=20)).isoformat()),
        "sensor.waschmaschine_programmende": st((JETZT + kt.timedelta(minutes=81)).isoformat()),
    }
    assert kt.akt_waesche(states, JETZT)["wert"] == "1:21 h"


def test_roborock_nur_beim_reinigen():
    assert kt.robo_aktiv("segment_cleaning")
    assert kt.robo_aktiv("cleaning")
    assert not kt.robo_aktiv("returning_home")
    assert not kt.robo_aktiv("charging")


def test_reihenfolge_und_ausblenden():
    states = {
        "sensor.h": st("2", zeilen="muell|Müll|morgen|Bio\nwarnung|DWD|Sturm|ab 18 Uhr"),
        "switch.balkon_kohlegrill": st("on"),
    }
    k = kt.berechne(states, "sensor.h", JETZT)
    assert [x["schluessel"] for x in k] == ["warnung", "kohle", "muell"]
    k = kt.berechne(states, "sensor.h", JETZT, aus=["muell"])
    assert [x["schluessel"] for x in k] == ["warnung", "kohle"]


def test_fmt_rest():
    assert kt.fmt_rest(59) == "0:59"
    assert kt.fmt_rest(3700) == "1:01 h"
    assert kt.fmt_rest(None) == "–"


def test_musik_karte_gruppen_einmal():
    a = {
        "media_title": "Song",
        "media_artist": "Band",
        "media_duration": 200,
        "media_position": 50,
        "media_position_updated_at": JETZT.isoformat(),
        "friendly_name": "Wohnung",
    }
    states = {"media_player.a": st("playing", **a), "media_player.b": st("playing", **a), "media_player.c": st("idle")}
    (k,) = kt.akt_musik(states, JETZT, ["media_player.a", "media_player.b", "media_player.c"])
    assert k["titel"] == "Song"
    assert k["wert"] == "2:30"
    assert k["unter"] == "Band · Wohnung"
    assert abs(k["ring"] - 0.75) < 0.01


def test_musik_haengende_player_ohne_karte():
    # Alexa-Geräte in Music Assistant: „playing“ ohne Titel, oder ein Titel, der seit Minuten auf 0:00 steht
    haengt = {
        "media_title": "Berlin",
        "media_duration": 178,
        "media_position": 0,
        "media_position_updated_at": JETZT.isoformat(),
    }
    states = {
        "media_player.leer": st("playing", media_content_type="music"),
        "media_player.dot": {**st("playing", **haengt), "last_changed": (JETZT - timedelta(minutes=2)).isoformat()},
        "media_player.neu": {**st("playing", **haengt), "last_changed": (JETZT - timedelta(seconds=20)).isoformat()},
    }
    karten = kt.akt_musik(states, JETZT, ["media_player.leer", "media_player.dot", "media_player.neu"])
    assert [k["id"] for k in karten] == ["akt:musik:media_player.neu"]


def test_unwetter_aus_dwd_sensoren_ersetzt_warnzeile():
    jetzt = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)
    states = {
        "sensor.kreis_x_aktuelle_warnstufe": {
            "state": "2",
            "attributes": {
                "region_name": "Kreis X",
                "warning_count": 2,
                "warning_1_name": "Windböen",
                "warning_1_level": 1,
                "warning_1_headline": "Amtliche Warnung vor Windböen",
                "warning_1_end": jetzt + timedelta(hours=6),
                "warning_2_name": "Sturmböen",
                "warning_2_level": 2,
                "warning_2_end": (jetzt + timedelta(hours=3)).isoformat(),
            },
        },
        "sensor.kreis_x_vorwarnstufe": {
            "state": "3",
            "attributes": {"region_name": "Kreis X", "warning_count": 1, "warning_1_name": "Orkanböen", "warning_1_level": 3},
        },
        "sensor.panel_bad_hinweise": {
            "state": "1",
            "attributes": {"zeilen": "warnung|Warnung|Sturm|DWD bis 18 Uhr\nwetter|Wetter|9–20°|sonnig"},
        },
    }
    karten = kt.berechne(states, "sensor.panel_bad_hinweise", jetzt)
    warn = [k for k in karten if k["art"] == "warnung"]
    # Windböen, Sturmböen und die Vorabinformation Orkanböen sind dieselbe Lage: eine Karte „Wind“
    (w,) = warn
    assert w["familie"] == "wind" and w["titel"] == "Sturmböen" and w["stufe"] == 2 and w["ring"] == 0.5 and not w["vorab"]
    assert w["hinweis"] == "zeitweise Windböen · später möglich: Orkanböen (Stufe 3)"
    assert w["bis"] == (jetzt + timedelta(hours=6)).isoformat()  # spätestes Ende der Lage
    assert all(k["schluessel"] != "warnung" for k in karten)  # Warnzeile der Vorlage entfällt
    assert karten[0]["art"] == "warnung"
    # abgelaufene Warnung entfällt; ausgeblendet über „warnung“
    states["sensor.kreis_x_aktuelle_warnstufe"]["attributes"]["warning_2_end"] = (jetzt - timedelta(minutes=1)).isoformat()
    (w,) = [k for k in kt.berechne(states, "sensor.panel_bad_hinweise", jetzt) if k["art"] == "warnung"]
    assert w["titel"] == "Windböen" and w["stufe"] == 1
    assert not [k for k in kt.berechne(states, "sensor.panel_bad_hinweise", jetzt, aus=["warnung"]) if k["art"] == "warnung"]


def test_unwetter_doppelt_gemeldet_eine_karte_je_gefahr():
    jetzt = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)

    def sensor(region, *warnungen):
        a = {"region_name": region, "warning_count": len(warnungen)}
        for i, (name, stufe) in enumerate(warnungen, 1):
            a |= {f"warning_{i}_name": name, f"warning_{i}_level": stufe, f"warning_{i}_headline": f"Amtliche Warnung vor {name}"}
        return {"state": "1", "attributes": a}

    states = {
        # dieselbe Gewitterwarnung aktuell und als Vorabinformation, dazu eine zweite Region
        "sensor.kreis_x_aktuelle_warnstufe": sensor("Kreis X", ("Gewitter", 1), ("Dauerregen", 2)),
        "sensor.kreis_x_vorwarnstufe": sensor("Kreis X", ("Gewitter", 1)),
        "sensor.stadt_y_aktuelle_warnstufe": sensor("Stadt Y", ("starkes Gewitter", 2)),
    }
    warn = kt.unwetter_karten(states, jetzt)
    assert [(k["familie"], k["titel"], k["stufe"]) for k in warn] == [("gewitter", "starkes Gewitter", 2), ("regen", "Dauerregen", 2)]
    assert warn[0]["hinweis"] == "zeitweise Gewitter"
    assert warn[1]["hinweis"] == ""  # Überschrift wiederholt nur den Namen
    # nur Vorabinformation: eine Karte als Vorab
    (v,) = kt.unwetter_karten({"sensor.kreis_x_vorwarnstufe": sensor("Kreis X", ("Orkanböen", 3))}, jetzt)
    assert v["vorab"] and v["familie"] == "wind"


LOKAL_ABEND = datetime(2026, 10, 1, 19, 0)
LOKAL_TAG = datetime(2026, 10, 1, 14, 0)


def _rel(zeilen, lokal=LOKAL_TAG, states=None):
    s = {"sensor.h": st("1", zeilen=zeilen), **(states or {})}
    return {k["schluessel"]: k["relevanz"] for k in kt.berechne(s, "sensor.h", JETZT, lokal=lokal)}


def test_relevanz_regeln():
    r = _rel("eil|ARD|Eil|x\nruhig|Ruhig|x|y\nlueften|Lüften|71 %|Fenster\noffen|Offen|1 offen|Tür\nwetter|W|x|y\nneutral|N|x|y")
    assert (r["eil"], r["ruhig"], r["lueften"], r["offen"], r["wetter"], r["neutral"]) == (100, 10, 55, 55, 45, 40)
    # Müll: Vorabend ab 18 Uhr hoch, tagsüber niedrig; morgens vor Abholung hoch
    assert _rel("muell|Müll|morgen|Bio", LOKAL_ABEND)["muell"] == 80
    assert _rel("muell|Müll|morgen|Bio", LOKAL_TAG)["muell"] == 30
    assert _rel("muell|Müll|heute|Bio", datetime(2026, 10, 2, 6, 0))["muell"] == 80
    assert _rel("muell|Müll|heute|Bio", LOKAL_TAG)["muell"] == 30
    # Termin: 60 + 35·(1 − Rest/3 h)
    assert _rel("termin|Termin|in 90 min|Arzt")["termin"] == 78
    assert _rel("termin|Termin|in 180 min|Arzt")["termin"] == 60
    assert kt.termin_relevanz(0) == 95 and kt.termin_relevanz(10 * 3600) == 60


def test_relevanz_timer_kurz_vor_ende():
    lang = {"timer.kohle_timer": st("active", duration="0:15:00", finishes_at=(JETZT + timedelta(minutes=5)).isoformat())}
    kurz = {"timer.kohle_timer": st("active", duration="0:15:00", finishes_at=(JETZT + timedelta(seconds=90)).isoformat())}
    assert _rel("", states=lang)["kohle"] == 70
    assert _rel("", states=kurz)["kohle"] == 95


def test_feed_sortiert_nach_relevanz_stabil():
    states = {"switch.balkon_kohlegrill": st("on"), "sensor.h": st("1", zeilen="ruhig|R|x|y\nneutral|N|a|b\nmuell|Müll|morgen|Bio\neil|E|x|y\nlueften|L|71 %|x")}
    k = kt.berechne(states, "sensor.h", JETZT, lokal=LOKAL_ABEND)
    assert [x["schluessel"] for x in k] == ["eil", "muell", "kohle", "lueften", "neutral", "ruhig"]
    # Gleichstand bleibt in Eingabereihenfolge
    gleich = [{"id": "a", "relevanz": 50}, {"id": "b", "relevanz": 50}, {"id": "c", "relevanz": 90}, {"id": "d"}]
    assert [x["id"] for x in kt.sortiere(gleich)] == ["c", "a", "b", "d"]


# ------------------------------------------------------------ Rams-Aktivität
RAMS_ATTR = {
    "team_name": "Rams", "opponent_name": "Bills", "team_abbr": "LAR", "opponent_abbr": "BUF",
    "team_logo": "https://a.espncdn.com/i/teamlogos/nfl/500/lar.png", "opponent_logo": "https://fremd.example/buf.png",
    "team_colors": ["#003594", "#ffd100"], "team_score": 21, "opponent_score": 17, "team_homeaway": "home",
    "date": "2026-10-13T00:15Z", "tv_network": "ESPN/ABC", "venue": "SoFi Stadium", "team_record": "5-1",
}


def _rams(zustand, spieltag="off", jetzt=JETZT, last_changed=None, **attrs):
    a = {**RAMS_ATTR, **attrs}
    s = {"sensor.la_rams": {"state": zustand, "attributes": a, "last_changed": last_changed}, "binary_sensor.rams_spieltag": st(spieltag)}
    lokal = jetzt.astimezone(ZoneInfo("Europe/Berlin"))  # wie im Hub: Zeitzone von Home Assistant
    return next((k for k in kt.berechne(s, "", jetzt, lokal=lokal) if k["schluessel"] == "rams"), None)


def test_rams_pre_titel_zeit_und_badge():
    k = _rams("PRE", "on", jetzt=datetime(2026, 10, 12, 12, 0, tzinfo=UTC))
    assert k["titel"] == "Rams vs Bills"
    assert k["hinweis"] == "Di 13.10. · 02:15 Uhr · ESPN/ABC"  # 00:15 UTC = 02:15 Europe/Berlin
    assert (k["badge"], k["badge_farbe"], k["relevanz"], k["art"]) == ("UPCOMING", "#003594", 50, "sport")
    assert _rams("PRE", "on", jetzt=datetime(2026, 10, 12, 12, 0, tzinfo=UTC), team_homeaway="away")["titel"] == "Rams @ Bills"
    # Logo nur von ESPN, sonst Kürzel im Frontend
    assert k["spiel"]["team"]["logo"].startswith("https://a.espncdn.com/") and k["spiel"]["gegner"]["logo"] is None


def test_rams_sichtbarkeit_pre():
    assert _rams("PRE", "off") is None
    assert _rams("PRE", "on") is not None
    assert _rams("NOT_FOUND", "on") is None and _rams("BYE", "on") is None


def test_rams_in_live_mit_stand_phase_und_hoher_relevanz():
    k = _rams("IN", "off", quarter=3, clock="8:42", down_distance_text="3rd & 5")
    assert k["titel"] == "Rams 21 : 17 Bills" and k["hinweis"] == "Q3 · 8:42 · 3rd & 5"
    assert (k["badge"], k["badge_farbe"], k["relevanz"], k["wert"]) == ("● LIVE", "#e2231a", 85, "21:17")
    assert _rams("IN", quarter=5, clock="3:00", down_distance_text="")["hinweis"] == "OT · 3:00"
    assert _rams("IN", quarter=0, clock="")["hinweis"] == "Kickoff"


def test_rams_post_ergebnis_und_zwoelf_stunden():
    ende = datetime(2026, 10, 13, 4, 0, tzinfo=UTC)  # Anpfiff 00:15 + 4 h
    k = _rams("POST", "off", jetzt=ende + timedelta(hours=11), team_winner=True)
    assert k["hinweis"] == "Sieg · Di 13.10." and (k["badge"], k["badge_farbe"], k["relevanz"]) == ("FINAL", "#2e7d32", 20)
    assert _rams("POST", "off", jetzt=ende + timedelta(hours=13), team_winner=True) is None
    # Niederlage: grau; Unentschieden ohne Sieger bei Gleichstand
    n = _rams("POST", "off", jetzt=ende + timedelta(hours=1), team_winner=False, team_score=10)
    assert n["hinweis"].startswith("Niederlage") and n["badge_farbe"] != "#2e7d32"
    assert _rams("POST", "off", jetzt=ende + timedelta(hours=1), team_winner=None, team_score=17)["hinweis"].startswith("Unentschieden")
    # Zustandswechsel früher als Anpfiff + 4 h zählt als Spielende
    frueh = (ende - timedelta(minutes=40)).isoformat()
    assert _rams("POST", "off", jetzt=ende + timedelta(hours=11, minutes=30), last_changed=frueh) is None
    # Am Spieltag bleibt die Karte, auch wenn das Spiel länger her ist
    assert _rams("POST", "on", jetzt=ende + timedelta(hours=20)) is not None


def test_rams_reihenfolge_im_feed():
    live = {"sensor.la_rams": {"state": "IN", "attributes": RAMS_ATTR}, "switch.balkon_kohlegrill": st("on"), "sensor.h": st("1", zeilen="neutral|N|a|b")}
    assert [k["schluessel"] for k in kt.berechne(live, "sensor.h", JETZT)] == ["rams", "kohle", "neutral"]
    assert "sensor.la_rams" in kt.relevante_entitaeten("") and "binary_sensor.rams_spieltag" in kt.relevante_entitaeten("")
    assert not [k for k in kt.berechne(live, "sensor.h", JETZT, aus=["rams"]) if k["schluessel"] == "rams"]
