from panelstudio.klingeln import OFFEN_S, ZUSAMMEN_S, Klingelbuch


class Uhr:
    def __init__(self) -> None:
        self.t = 1_800_000_000.0

    def __call__(self) -> float:
        return self.t


def test_klingeln_und_ausgaenge(tmp_path):
    uhr = Uhr()
    b = Klingelbuch(tmp_path / "klingeln.json", uhr)
    kid, neu = b.klingeln()
    assert neu and b.liste()[0]["ausgang"] == "laeuft"
    # erneutes Drücken zählt zum selben Eintrag
    uhr.t += ZUSAMMEN_S - 5
    assert b.klingeln() == (kid, False) and b.liste()[0]["mal"] == 2
    assert b.ausgang("app")
    assert not b.ausgang("panel")  # festgelegt bleibt festgelegt
    # eine Nachricht überschreibt (Aufnahme nach Übernahme ausgewertet)
    assert b.ausgang("nachricht", kid, datei="2026-10-23_10-00-00.wav", dauer_s=12, text="Hallo")
    e = b.liste()[0]
    assert e["ausgang"] == "nachricht" and e["dauer_s"] == 12 and e["text"] == "Hallo"
    # gespeichert und wieder geladen
    assert Klingelbuch(tmp_path / "klingeln.json", uhr).liste()[0]["id"] == kid


def test_offen_wird_verpasst_und_tuer(tmp_path):
    uhr = Uhr()
    b = Klingelbuch(tmp_path / "k.json", uhr)
    b.klingeln()
    uhr.t += OFFEN_S + 1
    assert b.liste()[0]["ausgang"] == "verpasst"
    # Tür kurz danach geöffnet: vermerkt, als am Panel angenommen gewertet
    assert b.tuer_geoeffnet()
    e = b.liste()[0]
    assert e["tuer"] and e["ausgang"] == "panel"
    assert not b.tuer_geoeffnet()  # nur einmal
    # ein neues Klingeln später ist ein neuer Eintrag
    uhr.t += 3600
    _, neu = b.klingeln()
    assert neu and len(b.liste()) == 2
    assert not b.tuer_geoeffnet() or b.liste()[0]["tuer"]


def test_ohne_datei(tmp_path):
    b = Klingelbuch(None)
    b.klingeln()
    assert b.ausgang("ohne") and b.liste()[0]["ausgang"] == "ohne"


def test_klingeloeffnung_live(tmp_path):
    uhr = Uhr()
    b = Klingelbuch(tmp_path / "k.json", uhr)
    b.klingeln()
    uhr.t += 0.1  # Automation öffnet sofort
    assert b.tuer_geoeffnet()
    assert b.liste()[0]["ausgang"] == "klingeloeffnung"
    # zweite Quelle (Panel-Signal) zählt nicht mit
    uhr.t += 10
    b.klingeln(zaehlen=False)
    assert b.liste()[0]["mal"] == 1


def test_nachtragen_aus_verlauf(tmp_path):
    # Klingeln vom 22.10.2026 (Ortszeit, als Sekunden ab 12:00): Klingelöffnung, angenommen, Tür später geöffnet
    t0 = 1_792_576_800.0
    s = lambda h, m, sek: t0 + (h - 12) * 3600 + m * 60 + sek  # noqa: E731
    klingeln = [s(12, 25, 7.7), s(17, 34, 19.4), s(18, 36, 27.1), s(19, 57, 16.6), s(20, 19, 35.4), s(20, 54, 53.0), s(20, 55, 5)]
    tueren = [s(12, 25, 7.7), s(17, 34, 19.4), s(19, 57, 51.3), s(20, 55, 19.4)]
    angenommen = {s(18, 36, 27.1): True, s(20, 19, 35.4): False}
    nachrichten = [{"t": s(20, 20, 30), "datei": "2026-10-22_20-20-30.wav", "dauer_s": 9, "text": "Hallo"}]
    uhr = Uhr()
    uhr.t = t0 + 86400
    b = Klingelbuch(tmp_path / "k.json", uhr)
    assert b.nachtragen(klingeln, tueren, angenommen, nachrichten) == 6
    alt = list(reversed(b.liste()))
    assert [e["ausgang"] for e in alt] == ["klingeloeffnung", "klingeloeffnung", "panel", "panel", "nachricht", "panel"]
    assert alt[3]["tuer"] and alt[5]["mal"] == 2 and alt[4]["datei"] == "2026-10-22_20-20-30.wav"
    assert all(e["nachgetragen"] for e in alt)
    # zweimal nachtragen ergänzt nichts doppelt
    assert b.nachtragen(klingeln, tueren, angenommen, nachrichten) == 0
