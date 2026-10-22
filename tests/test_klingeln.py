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
