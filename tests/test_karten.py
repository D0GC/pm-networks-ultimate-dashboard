import json
from datetime import UTC, date, datetime, timedelta
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


def _heimweg_states(d_m, richtung="towards", person_state="not_home"):
    return {
        "person.gina_perina": st(person_state, friendly_name="Gina Perina"),
        "sensor.zuhause_entfernung_von_gina_perina": st(str(d_m), device_class="distance", unit_of_measurement="m"),
        "sensor.zuhause_bewegung_von_gina_perina": st(richtung, device_class="enum", options=["arrived", "away_from", "stationary", "towards"]),
    }


def test_heimweg_karte_ring_und_ankunft():
    hw = kt.Heimweg()
    lokal = datetime(2026, 10, 1, 18, 0)
    p = ["person.gina_perina"]
    # Start bei 20 km
    (k,) = hw.karten(_heimweg_states(20000), JETZT, lokal, p)
    assert k["titel"] == "Gina ist auf dem Heimweg" and k["wert"] == "20" and k["ring"] == 0
    # 5 min später 15 km: 5 km in 300 s → 16,7 m/s, Rest 900 s
    (k,) = hw.karten(_heimweg_states(15000), JETZT + timedelta(minutes=5), lokal + timedelta(minutes=5), p)
    assert abs(k["ring"] - 0.25) < 1e-9 and k["rest_min"] == 15 and k["hinweis"] == "Ankunft gegen 18:20"
    # an der Ampel bleibt die Karte, bei Ankunft verschwindet sie
    assert hw.karten(_heimweg_states(15000, "stationary"), JETZT + timedelta(minutes=6), lokal, p)
    assert hw.karten(_heimweg_states(8000, "away_from"), JETZT + timedelta(minutes=7), lokal, p) == []
    (k,) = hw.karten(_heimweg_states(5000), JETZT + timedelta(minutes=8), lokal, p)
    assert k["ring"] == 0.75 and k["wert"] == "5,0"  # Fahrt (Start 20 km) blieb gemerkt
    assert hw.karten(_heimweg_states(100, "arrived"), JETZT + timedelta(minutes=12), lokal, p) == []
    assert not hw.fahrten


def test_heimweg_ohne_fahrt_keine_karte():
    hw = kt.Heimweg()
    lokal = datetime(2026, 10, 1, 18, 0)
    p = ["person.gina_perina"]
    assert hw.karten(_heimweg_states(500), JETZT, lokal, p) == []  # zu nah für eine Heimfahrt
    assert hw.karten(_heimweg_states(20000, "away_from"), JETZT, lokal, p) == []
    assert hw.karten(_heimweg_states(20000, person_state="home"), JETZT, lokal, p) == []
    # Relevanz: kurz vor der Ankunft vorn
    states = _heimweg_states(20000)
    karten = kt.berechne(states, "", JETZT, lokal=lokal, heimweg=hw, personen=p)
    assert [k["relevanz"] for k in karten if k["schluessel"] == "heimweg"] == [65]


# ------------------------------------------------------------ Pakete (sensor.pakete)
BERLIN = ZoneInfo("Europe/Berlin")
LOKAL_PAKETE = JETZT.astimezone(BERLIN)  # Do 01.10.2026, 16:00
PAKET = "sensor.pakete"


def _sendung(versender="DHL", titel="Kopfhörer", sc=2, stufe=None, erwartet="", von="", bis="", heute=False, zug_heute=False, **extra):
    stufen = {8: 1, 2: 2, 1: 2, 5: 2, 6: 2, 7: 2, 3: 3, 4: 3, 0: 4}
    status = {8: "angekündigt", 2: "unterwegs", 6: "Zustellversuch", 7: "Problem", 3: "abholbereit", 4: "in Zustellung", 0: "zugestellt"}
    return {
        "nummer": "NR" + titel[:3], "titel": titel, "versender": versender, "code": versender.lower(), "status_code": sc,
        "status": status.get(sc, "unterwegs"), "stufe": stufe or stufen[sc], "problem": sc in (6, 7), "erwartet": erwartet,
        "fenster_von": von, "fenster_bis": bis, "heute": heute, "zugestellt_heute": zug_heute, "ereignis": "", "ort": "",
        "ereignis_zeit": "", **extra,
    }


def _pakete(sendungen, state=None, zugestellt=0, **attrs):
    aktiv = sum(s["status_code"] != 0 for s in sendungen)
    a = {"verfuegbar": True, "heute": 0, "zugestellt_heute": zugestellt, "sendungen": sendungen, **attrs}
    return {PAKET: st(str(aktiv if state is None else state), **a)}


def _karte(states, lokal=LOKAL_PAKETE):
    return kt.pakete_karte(states, PAKET, JETZT, lokal)


def test_pakete_erscheint_nur_mit_aktiven_oder_heute_zugestellten():
    assert _karte({}) is None
    assert _karte({PAKET: st("unavailable")}) is None and _karte({PAKET: st("unknown")}) is None
    assert _karte(_pakete([])) is None  # Zustand 0, nichts zugestellt: keine Karte
    assert _karte({PAKET: st("0", zugestellt_heute=0, sendungen=[])}) is None
    assert _karte(_pakete([_sendung()]))["id"] == "akt:pakete"
    # nur Zugestelltes von heute genügt
    assert _karte(_pakete([_sendung(sc=0, zug_heute=True)], zugestellt=1)) is not None
    # fehlende Zahlen im Sensor (Vorlage noch nicht fertig) ergeben keine Karte
    assert _karte({PAKET: st("0", zugestellt_heute="abc")}) is None


def test_pakete_karte_ring_zahl_titel_wert_hinweis():
    k = _karte(_pakete([_sendung(sc=4, erwartet="2026-10-01", von="14:00", bis="18:00", heute=True)]))
    assert (k["art"], k["schluessel"], k["id"]) == ("pakete", "pakete", "akt:pakete")
    assert (k["titel"], k["wert"], k["hinweis"]) == ("Paket", "in Zustellung", "DHL · 14–18 Uhr")
    assert (k["anzahl"], k["stufe"], k["ring"], k["relevanz"], k["problem"]) == (1, 3, 0.75, 75, False)
    assert k["ende"] is None and k["dauer_s"] is None
    zwei = _karte(_pakete([_sendung(sc=2, stufe=2, erwartet="2026-10-01", heute=True), _sendung("Amazon", "Buch", sc=8)]))
    assert (zwei["titel"], zwei["anzahl"], zwei["ring"], zwei["wert"], zwei["hinweis"]) == ("Pakete", 2, 0.5, "heute", "DHL, Amazon")
    drei = _karte(_pakete([_sendung(erwartet="2026-10-01"), _sendung("Amazon", "Buch", erwartet="2026-10-01"), _sendung("GLS", "X")]))
    assert drei["wert"] == "2 heute"
    # Ring folgt der ersten Sendung, die Zahl zählt die aktiven
    erste = _karte(_pakete([_sendung(sc=8), _sendung(sc=4)]))
    assert erste["ring"] == 0.25 and erste["anzahl"] == 2
    assert _karte(_pakete([_sendung(erwartet="2026-10-02")]))["wert"] == "unterwegs"
    assert _karte(_pakete([_sendung(sc=3)]))["wert"] == "abholbereit"
    assert _karte(_pakete([_sendung(sc=7), _sendung(sc=6)]))["wert"] == "2 Probleme"
    assert _karte(_pakete([_sendung(sc=4), _sendung(sc=4)]))["wert"] == "2 in Zustellung"
    # eine Sendung ohne Zeitfenster: Hinweis mit Tag
    assert _karte(_pakete([_sendung(erwartet="2026-10-02")]))["hinweis"] == "DHL · morgen"
    assert _karte(_pakete([_sendung()]))["hinweis"] == "DHL"


def test_pakete_relevanz_stufen():
    def rel(*sendungen, **kw):
        return _karte(_pakete(list(sendungen), **kw))["relevanz"]

    assert rel(_sendung(sc=4)) == 75
    assert rel(_sendung(sc=7)) == 70 and rel(_sendung(sc=6)) == 70
    assert rel(_sendung(erwartet="2026-10-01")) == 60 and rel(_sendung(heute=True)) == 60
    assert rel(_sendung(erwartet="2026-10-02")) == 40 and rel(_sendung(sc=8)) == 40
    # höchster Wert der Sendungen gewinnt
    assert rel(_sendung(sc=8), _sendung(sc=7), _sendung(erwartet="2026-10-01")) == 70
    assert rel(_sendung(sc=8), _sendung(sc=4)) == 75
    # nur noch heute Zugestelltes
    assert rel(_sendung(sc=0, zug_heute=True), zugestellt=1) == 30
    # Problem färbt die Karte rot, wenn die erste Sendung ein Problem hat
    assert _karte(_pakete([_sendung(sc=7), _sendung(sc=4)]))["problem"] is True
    assert _karte(_pakete([_sendung(sc=4), _sendung(sc=7)]))["problem"] is False


def test_pakete_im_feed_sortiert_nach_relevanz():
    live = {"sensor.la_rams": {"state": "IN", "attributes": RAMS_ATTR}, "switch.balkon_kohlegrill": st("on")}

    def feed(sendungen):
        s = {**live, **_pakete(sendungen)}
        return [k["schluessel"] for k in kt.berechne(s, "", JETZT, lokal=LOKAL_PAKETE, pakete_entitaet=PAKET)]

    assert feed([_sendung(sc=4)]) == ["rams", "pakete", "kohle"]  # 85 > 75 > 70
    assert feed([_sendung(sc=7)]) == ["rams", "kohle", "pakete"]  # 70 gleich: Aktivitäten zuerst
    assert feed([_sendung(erwartet="2026-10-01")]) == ["rams", "kohle", "pakete"]  # 60
    # ohne Option oder Quelle keine Karte
    assert "pakete" not in [k["schluessel"] for k in kt.berechne({**live, **_pakete([_sendung()])}, "", JETZT, lokal=LOKAL_PAKETE)]
    assert kt.berechne(live, "", JETZT, lokal=LOKAL_PAKETE, pakete_entitaet=PAKET)[-1]["schluessel"] == "kohle"
    # im Editor abwählbar
    s = {**live, **_pakete([_sendung(sc=4)])}
    assert "pakete" not in [k["schluessel"] for k in kt.berechne(s, "", JETZT, ["pakete"], lokal=LOKAL_PAKETE, pakete_entitaet=PAKET)]


def test_pakete_liste_zeilen_und_weitere():
    s = [
        _sendung("Amazon", "Kopfhörer", sc=4, erwartet="2026-10-01", von="14:00", bis="18:30", heute=True),
        _sendung("DHL", "Amazon-Sendung", erwartet="2026-10-02"),  # Titel nur Platzhalter: nicht wiederholen
        _sendung("Deutsche Post", "Ein sehr langer Titel einer Sendung aus dem Netz", erwartet="2026-10-04"),
        _sendung("Hermes", "Schuhe", sc=6, erwartet="2026-09-30"),
        _sendung("DPD", "Kabel", sc=8),
        _sendung("GLS", "Lampe"),
        _sendung("UPS", "Stuhl"),
    ]
    k = _karte(_pakete(s))
    assert k["liste"][0] == ["Amazon", "Kopfhörer · in Zustellung, heute 14–18:30 Uhr"]
    assert k["liste"][1] == ["DHL", "Amazon-Sendung · unterwegs, morgen"]
    assert k["liste"][2][0] == "Deutsche Post" and k["liste"][2][1].endswith("unterwegs, So 04.10.") and "…" in k["liste"][2][1]
    assert k["liste"][3] == ["Hermes", "Schuhe · Zustellversuch, Mi 30.09."]
    assert k["liste"][4] == ["DPD", "Kabel · angekündigt"]
    assert k["liste"][5] == ["", "+2 weitere"] and len(k["liste"]) == 6
    assert len(k["sendungen"]) == 7 and k["anzahl"] == 7
    assert _karte(_pakete(s[:5]))["liste"][-1][0] == "DPD"  # genau fünf: kein „weitere“
    # generischer Titel entfällt in der Zeile
    assert _karte(_pakete([_sendung("Amazon", "Amazon-Sendung")]))["liste"] == [["Amazon", "unterwegs"]]


def test_pakete_attribute_als_text_robust():
    s = [_sendung(sc=4, erwartet="2026-10-01", von="09:00", bis="12:00", heute=True)]
    erwartet = _karte(_pakete(s))
    # JSON-Text und Python-Schreibweise (HA gibt Attribute je nach Vorlage als Text aus)
    for text in (json.dumps(s, ensure_ascii=False), str(s)):
        k = _karte({PAKET: st("1", zugestellt_heute="0", sendungen=text)})
        assert k["liste"] == erwartet["liste"] and k["ring"] == 0.75 and k["hinweis"] == "DHL · 9–12 Uhr"
    # Zahlen und Wahrheitswerte als Text
    t = [{**s[0], "stufe": "3", "problem": "false", "heute": "true", "status_code": "4"}]
    k = _karte({PAKET: st("1", zugestellt_heute="0", sendungen=t)})
    assert k["ring"] == 0.75 and k["problem"] is False and k["sendungen"][0]["heute"] is True
    # unlesbar oder falscher Typ: Karte bleibt (Zähler stimmt), nur ohne Liste
    for kaputt in ("{kaputt", "", None, 5, {"x": 1}, ["x", 3, None]):
        k = _karte({PAKET: st("2", zugestellt_heute=0, sendungen=kaputt)})
        assert k["anzahl"] == 2 and k["liste"] == [] and k["sendungen"] == [] and k["ring"] is None and k["wert"] == "unterwegs"
    # ein einzelnes Dict statt Liste
    assert _karte({PAKET: st("1", sendungen=s[0])})["liste"] == erwartet["liste"]
    # fehlende Felder in der Sendung
    k = _karte({PAKET: st("1", sendungen=[{"status_code": 2}])})
    assert k["liste"] == [["Paket", "unterwegs"]] and k["ring"] == 0.5


def test_pakete_nur_zugestellt_heute():
    s = [_sendung(sc=0, zug_heute=True, ereignis_zeit="01.10.2026 11:05"), _sendung("Amazon", "Alt", sc=0, zug_heute=False)]
    k = _karte(_pakete(s, zugestellt=1))
    assert (k["titel"], k["wert"], k["anzahl"], k["ring"], k["relevanz"], k["stufe"]) == ("Paket", "zugestellt", 1, 1.0, 30, 4)
    assert len(k["sendungen"]) == 1 and k["liste"] == [["DHL", "Kopfhörer · zugestellt"]] and k["hinweis"] == "DHL"
    assert k["sendungen"][0]["ereignis_zeit"] == "heute 11:05"
    # Zustand 0 und nur ältere Zustellungen: nichts anzeigen
    assert _karte(_pakete([_sendung(sc=0)], zugestellt=0)) is None
    # aktiv und zugestellt gemischt: Zahl = aktive, Zugestelltes steht hinten in der Liste
    gemischt = _karte(_pakete([_sendung(sc=2), _sendung("Amazon", "Buch", sc=0, zug_heute=True)], zugestellt=1))
    assert gemischt["anzahl"] == 1 and gemischt["titel"] == "Paket" and gemischt["relevanz"] == 40 and gemischt["wert"] == "unterwegs"
    assert [z[0] for z in gemischt["liste"]] == ["DHL", "Amazon"] and gemischt["zugestellt_heute"] == 1


def test_pakete_tag_fenster_und_ereigniszeit():
    heute = date(2026, 10, 1)
    assert [kt._tag_text(date(2026, 10, d), heute) for d in (1, 2, 5, 12)] == ["heute", "morgen", "Mo 05.10.", "Mo 12.10."]
    assert kt._fenster("14:00", "18:00") == "14–18 Uhr" and kt._fenster("08:30", "10:00") == "8:30–10 Uhr"
    assert kt._fenster("14:00", "") == "ab 14 Uhr" and kt._fenster("", "18:00") == "bis 18 Uhr" and kt._fenster("", "") == ""
    assert kt._fenster("14:00", "14:00") == "14 Uhr" and kt._fenster("x", "y") == ""
    z = lambda t: kt._ereignis_zeit(t, heute, BERLIN)  # noqa: E731
    assert z("01.10.2026 08:15") == "heute 08:15" and z("2026-09-30 14:32:00") == "gestern 14:32"
    assert z("03.10.2026, 9:05") == "Sa 03.10. 09:05" and z("2026-10-01") == "heute"
    assert z("2026-10-01T10:00:00Z") == "heute 12:00"  # Zone wird nach lokal umgerechnet
    assert z("gestern Abend") == "gestern Abend" and z("") == "" and z("31.02.2026 10:00") == "31.02.2026 10:00"
    # Ereignis, Ort und Nummer bleiben erhalten und werden begrenzt
    k = _karte(_pakete([_sendung(ereignis="E" * 200, ort="Kulmbach", nummer="0034")]))
    assert len(k["sendungen"][0]["ereignis"]) == 80 and k["sendungen"][0]["ort"] == "Kulmbach" and k["sendungen"][0]["nummer"] == "0034"


def test_hinweise_paket_und_spueler_werden_unterdrueckt():
    zeilen = "paket|Paket|heute|DHL, Amazon\nspueler|Spüler|läuft|noch 45 min\nfertig|Fertig|Wäsche|Waschmaschine\nmuell|Müll|morgen|Bio"
    k = kt.berechne({"sensor.h": st("4", zeilen=zeilen)}, "sensor.h", JETZT, lokal=LOKAL_ABEND, pakete_entitaet=PAKET)
    assert sorted(x["schluessel"] for x in k) == ["fertig", "muell"]  # fertig bleibt unverändert
    # auch mit Paketkarte: eine Karte, keine Doppelung
    s = {"sensor.h": st("4", zeilen=zeilen), **_pakete([_sendung(sc=4)])}
    k = kt.berechne(s, "sensor.h", JETZT, lokal=LOKAL_ABEND, pakete_entitaet=PAKET)
    assert [x["schluessel"] for x in k].count("pakete") == 1 and not {"paket", "spueler"} & {x["schluessel"] for x in k}


def test_hinweis_paket_bleibt_bei_abgeschalteter_paketkarte():
    zeilen = "paket|Paket|heute|DHL\nspueler|Spüler|läuft|noch 45 min"
    states = {"sensor.h": st("2", zeilen=zeilen), **_pakete([_sendung(sc=4)])}
    # Option leer: keine Paketkarte, die Hinweiszeile „Paket heute“ bleibt; der Spüler ist immer ersetzt
    k = kt.berechne(states, "sensor.h", JETZT, lokal=LOKAL_PAKETE, pakete_entitaet="")
    assert [x["schluessel"] for x in k] == ["paket"]
    k = kt.berechne(states, "sensor.h", JETZT, lokal=LOKAL_PAKETE, pakete_entitaet=PAKET)
    assert [x["schluessel"] for x in k] == ["pakete"]


def test_pakete_fremddaten_brechen_den_feed_nicht_ab(monkeypatch):
    # Überlauf bei der Zeitumrechnung
    heute = date(2026, 10, 1)
    assert kt._ereignis_zeit("9999-12-31T23:59:59Z", heute, BERLIN) == "9999-12-31T23:59:59Z"
    assert kt._ereignis_zeit("0001-01-01T00:00:00+02:00", heute, BERLIN) == "0001-01-01T00:00:00+02:00"
    # Text-Attribute, die json oder literal_eval überfordern (TypeError, RecursionError)
    assert kt._struktur("{[1]:2}") is None
    assert kt._struktur("[" * 100_000 + "]" * 100_000) is None
    assert kt._struktur('{"a": ' * 50_000) is None
    k = _karte({PAKET: st("1", sendungen="[" * 100_000, zugestellt_heute=0)})
    assert k["anzahl"] == 1 and k["sendungen"] == []
    # Eine kaputte Paketkarte blockiert die übrigen Karten nicht
    def kaputt(*_a):
        raise RuntimeError("kaputt")

    monkeypatch.setattr(kt, "_sendung", kaputt)
    states = {"switch.balkon_kohlegrill": st("on"), **_pakete([_sendung()])}
    assert [x["schluessel"] for x in kt.berechne(states, "", JETZT, lokal=LOKAL_PAKETE, pakete_entitaet=PAKET)] == ["kohle"]
    monkeypatch.undo()
    # Status wird wie die übrigen Felder gekürzt
    assert len(_karte(_pakete([_sendung(status="S" * 100)]))["sendungen"][0]["status"]) == 30


def test_spuelmaschine_eingriff_noetig():
    prefix = "BSH.Common.EnumType.OperationState."
    k = kt.akt_spueler({kt.QUELLEN["spueler_status"]: st(prefix + "ActionRequired")}, JETZT)
    assert k["id"] == "akt:spueler" and k["hinweis"] == "Eingriff nötig" and k["wert"] == "–"
    # bestehendes Verhalten bleibt
    assert kt.akt_spueler({kt.QUELLEN["spueler_status"]: st(prefix + "Run"), kt.QUELLEN["spueler_fortschritt"]: st("40")}, JETZT)["hinweis"] == "läuft 40 %"
    assert kt.akt_spueler({kt.QUELLEN["spueler_status"]: st(prefix + "Pause")}, JETZT)["hinweis"] == "pausiert"
    assert kt.akt_spueler({kt.QUELLEN["spueler_status"]: st(prefix + "Ready")}, JETZT) is None
    assert kt.akt_spueler({}, JETZT) is None


def test_pakete_entitaet_loest_neuberechnung_aus():
    assert PAKET in kt.relevante_entitaeten("sensor.h", PAKET) and PAKET not in kt.relevante_entitaeten("sensor.h")
    assert "sensor.h" in kt.relevante_entitaeten("sensor.h", PAKET) and kt.relevante_entitaeten("", "") == kt.relevante_entitaeten("")
