"""Gegensprechen mit der Ring Intercom: Overlay „Haustür“ und Signalisierung über die App."""

import asyncio
import json


async def _init(ws):
    while True:
        m = json.loads((await ws.receive()).data)
        if m["typ"] == "init":
            return m


async def _warte_auf(ws, bedingung):
    for _ in range(50):
        m = json.loads((await asyncio.wait_for(ws.receive(), 3)).data)
        if bedingung(m):
            return m
    raise AssertionError("Nachricht nicht erhalten")


async def test_klingel_startet_haustuer_overlay(ingress, hub, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    fake.set_state("binary_sensor.haustur_klingelt", "off")
    fake.set_state("binary_sensor.haustur_klingelt", "on")
    m = await _warte_auf(ws, lambda m: m["typ"] == "ereignis" and m.get("aktiv"))
    assert m["intercom"] is True
    assert m["titel"] == "Haustür"
    assert m["tueroeffner"] == "button.haustur_tur_offnen"
    assert m["kamera"] is None  # an der Haustür gibt es keine Kamera
    await ws.close()


async def test_klingel_zaehler_steigt_bei_jedem_klingeln(ingress, hub, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    ziel = "binary_sensor.haustur_klingelt"
    fake.set_state(ziel, "off")
    fake.set_state(ziel, "on")
    m = await _warte_auf(ws, lambda m: m["typ"] == "ereignis" and m.get("aktiv"))
    assert m["intercom"] is True and m["klingel"] == 1
    seit = m["seit"]
    # aus -> an bei offenem Overlay: erneutes Klingeln, gleiche Startzeit
    fake.set_state(ziel, "off")
    fake.set_state(ziel, "on")
    m = await _warte_auf(ws, lambda m: m["typ"] == "ereignis" and m.get("aktiv") and m.get("klingel") == 2)
    assert m["seit"] == seit
    assert hub.ereignis["klingel"] == 2
    # Nach dem Ende des Overlays beginnt der Zähler wieder bei 1
    hub.ereignis_beenden()
    await _warte_auf(ws, lambda m: m["typ"] == "ereignis" and not m.get("aktiv"))
    fake.set_state(ziel, "off")
    fake.set_state(ziel, "on")
    m = await _warte_auf(ws, lambda m: m["typ"] == "ereignis" and m.get("aktiv"))
    assert m["klingel"] == 1
    await ws.close()


async def test_klingel_zaehler_im_init_paket(ingress, hub, fake):
    hub.ereignis_starten("binary_sensor.haustur_klingelt", "Haustür", intercom=True)
    hub.ereignis_starten("binary_sensor.haustur_klingelt", "Haustür", intercom=True)
    ws = await ingress.ws_connect("/api/ws")
    init = await _init(ws)
    assert init["ereignis"]["aktiv"] is True and init["ereignis"]["klingel"] == 2
    await ws.close()


async def test_editor_haustuer_test_klingelt(ingress, hub):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    await ws.send_json({"typ": "ereignis_test", "intercom": True, "id": 1})
    m = await _warte_auf(ws, lambda m: m["typ"] == "ereignis" and m.get("aktiv"))
    assert m["intercom"] is True and m["klingel"] == 1
    await ws.close()


async def test_ereignis_ohne_intercom_hat_keinen_klingel_zaehler(ingress, hub):
    hub.ereignis_starten("binary_sensor.wohnungstuer_person")
    hub.ereignis_starten("binary_sensor.wohnungstuer_person")
    assert hub.ereignis["intercom"] is False
    assert "klingel" not in hub.ereignis


async def test_person_overlay_ohne_gegensprechen(ingress, fake):
    ws = await ingress.ws_connect("/api/ws")
    init = await _init(ws)
    assert init["version"]
    fake.set_state("binary_sensor.wohnungstuer_person", "off")
    fake.set_state("binary_sensor.wohnungstuer_person", "on")
    m = await _warte_auf(ws, lambda m: m["typ"] == "ereignis" and m.get("aktiv"))
    assert m["intercom"] is False
    assert "klingel" not in m
    assert m["kamera"] == "camera.wohnungstuer_standardauflosung"
    await ws.close()


async def test_gespraech_signalisierung(ingress, hub, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    await ws.send_json({"typ": "intercom_start", "angebot": "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111", "id": 1})
    antwort = await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 1)
    assert antwort["ok"], antwort
    kennung = antwort["ergebnis"]
    sitzung = await _warte_auf(ws, lambda m: m["typ"] == "intercom" and m["type"] == "session")
    assert sitzung["gespraech"] == kennung
    sdp = await _warte_auf(ws, lambda m: m["typ"] == "intercom" and m["type"] == "answer")
    assert sdp["answer"] == "v=0 antwort"
    assert fake.intercom[0][0] == "start"

    await ws.send_json({"typ": "intercom_kandidat", "gespraech": kennung, "kandidat": "candidate:1 1 udp", "index": 0, "id": 2})
    assert (await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 2))["ok"]
    assert ("kandidat", "s1", "candidate:1 1 udp", 0) in fake.intercom

    await ws.send_json({"typ": "intercom_ende", "gespraech": kennung, "id": 3})
    assert (await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 3))["ok"]
    assert any(e[0] == "abbestellt" for e in fake.intercom)
    assert not hub.gespraeche
    await ws.close()


async def test_gespraech_endet_wenn_panel_trennt(ingress, hub, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    await ws.send_json({"typ": "intercom_start", "angebot": "v=0\r\nm=audio", "id": 1})
    await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 1)
    assert len(hub.gespraeche) == 1
    await ws.close()
    for _ in range(50):
        if not hub.gespraeche and any(e[0] == "abbestellt" for e in fake.intercom):
            break
        await asyncio.sleep(0.05)
    assert not hub.gespraeche
    assert any(e[0] == "abbestellt" for e in fake.intercom)


async def test_ungueltiges_angebot(ingress):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    await ws.send_json({"typ": "intercom_start", "angebot": "kein sdp", "id": 1})
    m = await _warte_auf(ws, lambda m: m["typ"] == "antwort" and m["id"] == 1)
    assert not m["ok"]
    await ws.close()
