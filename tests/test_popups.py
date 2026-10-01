from panelstudio.popups import PopupSpeicher, aus_aufruf

KOHLE = {
    "title": "Kohle fertig",
    "content": "Die Kohle ist fertig und kann geholt werden.",
    "right_button": "Kohle bestätigen",
    "right_button_action": {"service": "input_button.press", "data": {"entity_id": "input_button.confirm_coal"}},
    "tag": "kohle_fertig",
    "timeout": 14400000,
}


def test_kohle_popup_mit_knopf():
    m = aus_aufruf(KOHLE, jetzt=1000)
    assert m["id"] == "pop:kohle_fertig"
    assert m["text"].startswith("Die Kohle")
    (k,) = m["knoepfe"]
    assert (k["domain"], k["service"], k["data"]) == ("input_button", "press", {"entity_id": "input_button.confirm_coal"})
    assert m["bis"] == 1000 + 14400


def test_markdown_karte_und_kamera():
    m = aus_aufruf({"title": "Briefing", "content": {"type": "markdown", "content": "**Mo** · frei"}})
    assert m["text"] == "**Mo** · frei"
    m = aus_aufruf({"title": "Tür", "content": {"type": "picture-entity", "entity": "camera.tuer"}})
    assert m["kamera"] == "camera.tuer"


def test_speicher_schliessen_ablauf_und_karten():
    sp = PopupSpeicher()
    assert sp.verarbeiten("browser_mod", "popup", KOHLE, jetzt=0)
    assert sp.verarbeiten("browser_mod", "popup", {"title": "B", "content": "**x**\n- y", "tag": "b", "timeout": 1000}, jetzt=0)
    assert [k["titel"] for k in sp.karten()] == ["Kohle fertig", "B"] or len(sp.karten()) == 2
    assert sp.karten()[0]["art"] == "meldung"
    assert sp.aufraeumen(jetzt=5)  # B nach 1 s abgelaufen
    assert [m["tag"] for m in sp.liste()] == ["kohle_fertig"]
    assert sp.verarbeiten("browser_mod", "close_popup", {"tag": "kohle_fertig"})
    assert sp.liste() == []
    assert not sp.verarbeiten("light", "turn_on", {})
