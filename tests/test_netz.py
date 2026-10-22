import aiohttp
from aiohttp import web

from panelstudio import netz

HEALTH = [
    {
        "subsystem": "wan",
        "status": "ok",
        "wan_ip": "203.0.113.7",
        "isp_name": "Telekom",
        "rx_bytes-r": 125000,
        "tx_bytes-r": 25000,
    },
    {
        "subsystem": "www",
        "status": "ok",
        "latency": 12,
        "xput_down": 487.3,
        "xput_up": 41.9,
        "speedtest_ping": 9,
        "speedtest_lastrun": 1792600000,
        "uptime": 86400,
        "drops": 1,
    },
    {"subsystem": "lan", "num_user": 12, "num_guest": 0},
    {"subsystem": "wlan", "num_user": 25, "num_guest": 2},
]
GERAETE = [
    {
        "name": "USW Flex",
        "type": "usw",
        "model": "USF8",
        "state": 1,
        "uptime": 3600,
        "system-stats": {"cpu": "7.5", "mem": "41"},
        "num_sta": 6,
        "port_table": [{"up": True}, {"up": False}, {"up": True}],
        "upgradable": True,
        "version": "7.1",
    },
    {
        "name": "PMNetwork_Gateway",
        "type": "udm",
        "model_name": "Cloud Gateway Ultra",
        "state": 1,
        "temperatures": [{"name": "CPU", "value": 54.0}],
        "system-stats": {"cpu": "12", "mem": "63"},
    },
    {"name": "AP Flur", "type": "uap", "state": 0},
]


def test_auswerten():
    s = netz.auswerten(HEALTH, GERAETE)
    i = s["internet"]
    assert (
        i["status"] == "ok"
        and i["isp"] == "Telekom"
        and i["latenz_ms"] == 12
        and i["down_mbit"] == 487.3
        and i["up_mbit"] == 41.9
    )
    assert i["rx_bps"] == 125000 and i["speedtest_zeit"] == 1792600000
    assert s["clients"] == {"lan": 12, "wlan": 25, "gast": 2}
    assert [g["typ"] for g in s["geraete"]] == ["gateway", "switch", "ap"]
    gw, sw, ap = s["geraete"]
    assert gw["temp"] == 54.0 and gw["cpu"] == 12.0 and gw["modell"] == "Cloud Gateway Ultra" and gw["online"]
    assert sw["ports"] == 3 and sw["ports_aktiv"] == 2 and sw["update"] and sw["clients"] == 6
    assert not ap["online"]


async def test_abfrage_mit_schluessel_und_speedtest(aiohttp_server):
    gesehen = []

    async def health(request):
        gesehen.append(request.headers.get("X-API-Key"))
        return web.json_response({"data": HEALTH})

    async def device(request):
        return web.json_response({"data": GERAETE})

    async def devmgr(request):
        gesehen.append((await request.json())["cmd"])
        return web.json_response({"data": []})

    app = web.Application()
    app.router.add_get("/proxy/network/api/s/default/stat/health", health)
    app.router.add_get("/proxy/network/api/s/default/stat/device", device)
    app.router.add_post("/proxy/network/api/s/default/cmd/devmgr", devmgr)
    server = await aiohttp_server(app)
    async with aiohttp.ClientSession() as s:
        u = netz.Unifi(s, str(server.make_url("")), schluessel="geheim")
        st = await u.stand()
        assert st["quelle"] == "unifi" and not st["fehler"] and st["internet"]["down_mbit"] == 487.3
        await u.stand()  # aus dem Zwischenspeicher
        assert gesehen == ["geheim"]
        await u.speedtest()
        assert gesehen[-1] == "speedtest"
        # Ohne Zugangsdaten nichts abfragen
        assert (await netz.Unifi(s, str(server.make_url(""))).stand()) == {"quelle": None, "fehler": None}


async def test_abgewiesen_meldet_fehler(aiohttp_server):
    async def nein(_request):
        return web.Response(status=401)

    app = web.Application()
    app.router.add_get("/proxy/network/api/s/default/stat/{x}", nein)
    server = await aiohttp_server(app)
    async with aiohttp.ClientSession() as s:
        st = await netz.Unifi(s, str(server.make_url("")), schluessel="falsch").stand()
        assert st["quelle"] is None and "verweigert" in st["fehler"]


async def test_live_ping_misst_verbindungsaufbau(aiohttp_server):
    server = await aiohttp_server(web.Application())
    ping = netz.Ping((("Eins", "127.0.0.1", server.port), ("Zwei", "localhost", server.port), ("Tot", "127.0.0.1", 1)))
    w = await ping.messen()
    eins, zwei, tot = w["ziele"]
    assert eins["name"] == "Eins" and 0 <= eins["ms"] < 2000 and zwei["ms"] is not None and tot["ms"] is None
    assert w["ms"] == round((eins["ms"] + zwei["ms"]) / 2, 1)
    assert await ping.messen() is w  # aus dem Zwischenspeicher
    assert (await netz.Ping((("Tot", "127.0.0.1", 1),)).messen())["ms"] is None


def test_durchsatz_aus_den_wan_schnittstellen_des_gateways():
    gw = {
        "type": "udm",
        "wan1": {"up": True, "rx_bytes-r": 2_587_500, "tx_bytes-r": 39_875},
        "wan2": {"up": False, "rx_bytes-r": 999, "tx_bytes-r": 999},
        "uplink": {"rx_bytes-r": 1, "tx_bytes-r": 1},
    }
    assert netz.durchsatz(gw) == (2_587_500, 39_875, "wan")
    assert netz.durchsatz({"type": "udm", "uplink": {"rx_bytes-r": 5, "tx_bytes-r": 6}}) == (5, 6, "uplink")
    assert netz.durchsatz({"type": "udm"}) is None
    # Gerät schlägt den trägen Mittelwert im Gesundheitsbericht
    i = netz.auswerten(HEALTH, [GERAETE[0], gw])["internet"]
    assert i["rx_bps"] == 2_587_500 and i["durchsatz_quelle"] == "wan"
    assert netz.auswerten(HEALTH, GERAETE)["internet"]["durchsatz_quelle"] == "health"


async def test_gateway_wird_bei_jeder_abfrage_frisch_geholt(aiohttp_server):
    abrufe = {"liste": 0, "gateway": 0}
    gw = {"name": "GW", "type": "udm", "mac": "aa:bb", "state": 1, "wan1": {"up": True, "rx_bytes-r": 100, "tx_bytes-r": 10}}

    async def health(_r):
        return web.json_response({"data": HEALTH})

    async def liste(_r):
        abrufe["liste"] += 1
        return web.json_response({"data": [gw]})

    async def einzeln(r):
        abrufe["gateway"] += 1
        assert r.match_info["mac"] == "aa:bb"
        return web.json_response({"data": [{**gw, "wan1": {"up": True, "rx_bytes-r": 5000, "tx_bytes-r": 70}}]})

    app = web.Application()
    app.router.add_get("/proxy/network/api/s/default/stat/health", health)
    app.router.add_get("/proxy/network/api/s/default/stat/device", liste)
    app.router.add_get("/proxy/network/api/s/default/stat/device/{mac}", einzeln)
    server = await aiohttp_server(app)
    async with aiohttp.ClientSession() as s:
        u = netz.Unifi(s, str(server.make_url("")), schluessel="x")
        assert (await u.stand())["internet"]["rx_bps"] == 100  # frische Liste, kein Einzelabruf
        u._zeit = 0.0
        st = await u.stand()
        assert st["internet"]["rx_bps"] == 5000 and st["internet"]["tx_bps"] == 70
        assert abrufe == {"liste": 1, "gateway": 1}


def test_rate_aus_den_byte_zaehlern_ueber_ein_fenster():
    def gw(zeit, rx, tx):
        return {"type": "udm", "last_seen": zeit, "wan1": {"up": True, "rx_bytes": rx, "tx_bytes": tx}}

    r = netz.Zaehlerrate()
    assert r.neu(netz.zaehler(gw(100, 0, 0))) is None
    assert r.neu(netz.zaehler(gw(104, 4_000_000, 40_000))) is None  # Fenster noch zu kurz
    assert r.neu(netz.zaehler(gw(110, 27_500_000, 170_000))) == (2_750_000, 17_000)  # 22 Mbit/s, 136 kbit/s
    # Gleicher Bericht noch einmal: keine neue Probe, gleicher Wert
    assert r.neu(netz.zaehler(gw(110, 27_500_000, 170_000))) == (2_750_000, 17_000)
    # Ältere Proben fallen aus dem Fenster (20 s): gerechnet ab 110
    assert r.neu(netz.zaehler(gw(125, 42_500_000, 170_000))) == (1_000_000, 0)
    # Zähler zurückgesetzt: neu beginnen
    assert r.neu(netz.zaehler(gw(130, 10, 10))) is None
    assert netz.zaehler({"type": "udm", "wan1": {"up": True}}) is None
