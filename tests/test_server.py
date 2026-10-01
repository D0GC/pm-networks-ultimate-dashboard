import asyncio
import json

from panelstudio.hub import dienst_erlaubt


async def _init(ws):
    while True:
        m = json.loads((await ws.receive()).data)
        if m["typ"] == "init":
            return m


async def _warte_auf(ws, typ, bedingung=lambda m: True):
    for _ in range(50):
        m = json.loads((await asyncio.wait_for(ws.receive(), 3)).data)
        if m["typ"] == typ and bedingung(m):
            return m
    raise AssertionError(f"{typ} nicht erhalten")


async def test_panel_braucht_zugangsschluessel(panel, token):
    r = await panel.get("/")
    assert r.status == 403
    r = await panel.get("/?token=falsch")
    assert r.status == 403
    r = await panel.get(f"/?token={token[0]}", allow_redirects=False)
    assert r.status == 302 and "pmps_zugang" in r.cookies
    panel.session.cookie_jar.update_cookies({"pmps_zugang": token[0]})
    r = await panel.get("/")
    assert r.status == 200 and "PM Panel" in await r.text()
    assert (await panel.get("/api/health")).status == 200


async def test_editor_und_einstellungen(ingress, hub):
    r = await ingress.get("/")
    assert r.status == 200 and "Panel einrichten" in await r.text()
    d = await (await ingress.get("/api/einstellungen")).json()
    assert d["verbunden"] and d["port"] == 8098 and len(d["token"]) > 10
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    r = await ingress.post("/api/einstellungen", json={"verweildauer_s": 15})
    assert (await r.json())["einstellungen"]["verweildauer_s"] == 15
    m = await _warte_auf(ws, "einstellungen")
    assert m["einstellungen"]["verweildauer_s"] == 15
    await ws.close()


async def test_init_enthaelt_zustaende_und_karten(ingress):
    ws = await ingress.ws_connect("/api/ws")
    m = await _init(ws)
    assert m["zustaende"]["light.flur_deckenlampe_flur"]["s"] == "on"
    assert m["registry"]["light.flur_deckenlampe_flur"]["b"] == "flur"
    schluessel = [k["schluessel"] for k in m["karten"]]
    assert schluessel[:2] == ["kohle", "waesche"]
    assert "muell" in schluessel
    await ws.close()


async def test_dienst_und_diff(ingress, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    await ws.send_json(
        {"typ": "dienst", "id": 1, "domain": "light", "service": "toggle", "data": {"entity_id": "light.lichterkette"}}
    )
    a = await _warte_auf(ws, "antwort")
    assert a["ok"]
    d = await _warte_auf(ws, "diff", lambda m: "light.lichterkette" in m["zustaende"])
    assert d["zustaende"]["light.lichterkette"]["s"] == "on"
    await ws.send_json({"typ": "dienst", "id": 2, "domain": "hassio", "service": "host_reboot", "data": {}})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 2)
    assert not a["ok"] and "nicht erlaubt" in a["fehler"]
    await ws.send_json({"typ": "ws", "id": 3, "befehl": {"type": "config/auth/delete"}})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 3)
    assert not a["ok"]
    await ws.close()


def test_dienst_sperrliste():
    assert dienst_erlaubt("light", "turn_on")
    assert dienst_erlaubt("homeassistant", "toggle")
    assert not dienst_erlaubt("homeassistant", "restart")
    assert not dienst_erlaubt("shell_command", "x")


async def test_bild_nur_erlaubte_pfade(ingress):
    r = await ingress.get("/api/bild", params={"pfad": "/api/states"})
    assert r.status == 400
    r = await ingress.get("/api/bild", params={"pfad": "/api/camera_proxy/camera.wohnungstuer_standardauflosung"})
    assert r.status == 200 and r.content_type == "image/png"


async def test_ereignis_bei_person_an_der_tuer(ingress, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    fake.set_state("binary_sensor.wohnungstuer_person", "on")
    m = await _warte_auf(ws, "ereignis")
    assert m["aktiv"] and m["kamera"] == "camera.wohnungstuer_standardauflosung"
    await ws.send_json({"typ": "ereignis_ende", "id": 9})
    m = await _warte_auf(ws, "ereignis", lambda m: not m["aktiv"])
    await ws.close()


async def test_bewegung_weckt(hub, fake):
    hub.modus = "ruhe"
    hub.letzte_bewegung = 0
    fake.set_state("binary_sensor.bewegungsmelder_flur_1_bewegung", "on")
    for _ in range(40):
        if hub.modus == "wach":
            break
        await asyncio.sleep(0.05)
    assert hub.modus == "wach"


async def test_pm_klima_zugeordnet_und_musik_und_meldungen(ingress, hub):
    ws = await ingress.ws_connect("/api/ws")
    m = await _init(ws)
    assert m["registry"]["climate.pm_wohnzimmer"]["b"] == "wohnzimmer"
    assert "musik" in [k["schluessel"] for k in m["karten"]]
    if not m["meldungen"]:
        m = await _warte_auf(ws, "meldungen")
        assert m["liste"][0]["notification_id"] == "n1"
    else:
        assert m["meldungen"][0]["notification_id"] == "n1"
    await ws.close()


async def test_kamera_stream(ingress):
    r = await ingress.get("/api/kamera", params={"eid": "camera.wohnungstuer_standardauflosung"})
    assert r.status == 200
    assert r.headers["Content-Type"].startswith("multipart/x-mixed-replace")
    assert b"--frame" in await r.read()
    r = await ingress.get("/api/kamera", params={"eid": "light.flur"})
    assert r.status == 400


async def test_browser_mod_popup_kommt_im_panel_an(ingress, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    fake.service("browser_mod", "popup", {"title": "Kohle fertig", "content": "Fertig.", "tag": "kohle_fertig"})
    m = await _warte_auf(ws, "popups")
    assert m["neu"] == "pop:kohle_fertig"
    k = await _warte_auf(ws, "karten", lambda m: m["karten"][0]["art"] == "meldung")
    assert k["karten"][0]["titel"] == "Kohle fertig"
    fake.service("browser_mod", "close_popup", {"tag": "kohle_fertig"})
    m = await _warte_auf(ws, "popups", lambda m: not m["liste"])
    await ws.close()
