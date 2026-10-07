from panelstudio.popups import PopupSpeicher

PANEL_KOHLE = {
    "tag": "kohle_fertig",
    "titel": "Kohle fertig",
    "text": "Die Kohle ist fertig und kann geholt werden.",
    "icon": "kohle",
    "prioritaet": "high",
    "panels": ["buero", "bad"],
    "bestaetigen_entity": "input_button.confirm_coal",
    "laufzeit_min": 240,
}
POPUP_KOHLE = {
    "title": "Kohle fertig",
    "content": "Die Kohle ist fertig und kann geholt werden.",
    "right_button": "Kohle bestätigen",
    "right_button_action": {"service": "input_button.press", "data": {"entity_id": "input_button.confirm_coal"}},
    "tag": "kohle_fertig",
    "timeout": 14400000,
}


def test_panel_meldung_gegliedert():
    sp = PopupSpeicher()
    mid = sp.verarbeiten("script", "panel_meldung", PANEL_KOHLE, jetzt=0)
    assert mid == "msg:kohle_fertig"
    m = sp.meldungen[mid]
    assert (m["icon"], m["prio"], m["bestaetigen"], m["bis"]) == ("kohle", "high", "input_button.confirm_coal", 240 * 60)


def test_popup_ergaenzt_panel_meldung_gleicher_kennung():
    sp = PopupSpeicher()
    sp.verarbeiten("script", "panel_meldung", PANEL_KOHLE, jetzt=0)
    sp.verarbeiten("browser_mod", "popup", POPUP_KOHLE, jetzt=5)
    (m,) = sp.liste()
    assert m["prio"] == "high" and m["titel"] == "Kohle fertig"
    assert m["details"].startswith("Die Kohle")
    assert m["knoepfe"][0]["domain"] == "input_button"
    assert sp.verarbeiten("script", "panel_meldung_schliessen", {"tag": "kohle_fertig"}) == ""
    assert sp.liste() == []


def test_briefing_markdown_und_turn_on_variante():
    sp = PopupSpeicher()
    sp.verarbeiten(
        "script",
        "turn_on",
        {
            "entity_id": "script.panel_meldung",
            "variables": {"tag": "morgen_briefing", "titel": "Morgen-Briefing", "text": "Mi · sonnig"},
        },
        jetzt=0,
    )
    sp.verarbeiten(
        "browser_mod",
        "popup",
        {"title": "☀️", "content": {"type": "markdown", "content": "**Mi** · frei"}, "tag": "morgen_briefing"},
        jetzt=1,
    )
    (m,) = sp.liste()
    assert m["text"] == "Mi · sonnig" and m["details"] == "**Mi** · frei" and m["titel"] == "Morgen-Briefing"


def test_popup_ohne_panel_und_kamera_tap_action():
    sp = PopupSpeicher()
    sp.verarbeiten(
        "browser_mod",
        "popup",
        {
            "title": "Tür",
            "content": {"type": "picture-entity", "entity": "camera.tuer"},
            "right_button": "Öffnen",
            "right_button_action": {
                "action": "perform-action",
                "perform_action": "button.press",
                "target": {"entity_id": "button.x"},
            },
            "timeout": 1000,
        },
        jetzt=0,
    )
    (m,) = sp.liste()
    assert m["kamera"] == "camera.tuer" and m["prio"] == "normal"
    assert m["knoepfe"][0]["data"] == {"entity_id": "button.x"}
    assert sp.aufraeumen(jetzt=5)


def test_niedrig_ist_passiv_und_reihenfolge():
    sp = PopupSpeicher()
    sp.verarbeiten("script", "panel_meldung", {"tag": "a", "text": "a", "prioritaet": "low"}, jetzt=0)
    sp.verarbeiten("script", "panel_meldung", {"tag": "b", "text": "b"}, jetzt=1)
    sp.verarbeiten("script", "panel_meldung", {"tag": "c", "text": "c", "prioritaet": "high"}, jetzt=0)
    assert [m["tag"] for m in sp.liste()] == ["c", "b", "a"]
    assert [k["id"] for k in sp.karten()] == ["msg:c", "msg:b", "msg:a"]  # passiv: Karte und Glocke
    assert [k["relevanz"] for k in sp.karten()] == [100, 65, 35]
    assert sp.verarbeiten("light", "turn_on", {}) is None
    assert sp.verarbeiten("script", "panel_meldung", {"text": "ohne Kennung"}) is None


def test_sicherheitsmeldung_merkmal():
    sp = PopupSpeicher()
    sp.verarbeiten(
        "script", "panel_meldung", {"tag": "rauch", "text": "Rauch", "prioritaet": "high", "sicherheit": True}, jetzt=0
    )
    sp.verarbeiten("script", "panel_meldung", {"tag": "kohle", "text": "Kohle", "prioritaet": "high"}, jetzt=0)
    assert sp.meldungen["msg:rauch"]["sicherheit"] is True
    assert sp.meldungen["msg:kohle"]["sicherheit"] is False


def test_stufen_und_rueckwaertskompatibilitaet():
    sp = PopupSpeicher()
    for tag, extra in [("a", {"prioritaet": "high"}), ("b", {"prioritaet": "normal"}), ("c", {}), ("d", {"prioritaet": "low"}),
                       ("e", {"prioritaet": "zeitkritisch"}), ("f", {"stufe": "passiv"}), ("g", {"stufe": "kritisch", "prioritaet": "low"}),
                       ("h", {"stufe": "unsinn"})]:
        sp.verarbeiten("script", "panel_meldung", {"tag": tag, "text": tag, **extra}, jetzt=0)
    stufe = {m["tag"]: m["stufe"] for m in sp.meldungen.values()}
    assert stufe == {"a": "kritisch", "b": "aktiv", "c": "aktiv", "d": "passiv", "e": "zeitkritisch", "f": "passiv", "g": "kritisch", "h": "aktiv"}
    assert sp.meldungen["msg:a"]["prio"] == "high" and sp.meldungen["msg:e"]["prio"] == "normal"
    assert sp.meldungen["msg:e"]["bis"] == 120 * 60 and sp.meldungen["msg:a"]["bis"] == 240 * 60
    assert [m["tag"] for m in sp.liste()][:3] == ["a", "g", "e"]


def test_wecken_je_stufe():
    from panelstudio.popups import weckt

    assert [weckt(s, False) for s in ("passiv", "aktiv", "zeitkritisch", "kritisch")] == [False, True, True, True]
    assert [weckt(s, True) for s in ("passiv", "aktiv", "zeitkritisch", "kritisch")] == [False, False, False, True]
