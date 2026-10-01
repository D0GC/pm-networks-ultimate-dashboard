from datetime import UTC, datetime, timedelta

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
