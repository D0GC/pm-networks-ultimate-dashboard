import aiohttp
from aiohttp import web

from panelstudio import proxmox

RESSOURCEN = [
    {
        "vmid": 100,
        "name": "docker",
        "type": "qemu",
        "node": "prx",
        "status": "running",
        "cpu": 0.0123,
        "maxcpu": 4,
        "mem": 2 * 2**30,
        "maxmem": 4 * 2**30,
        "maxdisk": 32 * 2**30,
        "netin": 1000,
        "netout": 500,
        "uptime": 3600,
    },
    {
        "vmid": 106,
        "name": "adguard",
        "type": "lxc",
        "node": "prx",
        "status": "running",
        "cpu": 0.001,
        "maxcpu": 1,
        "mem": 2**28,
        "maxmem": 2**30,
        "uptime": 60,
    },
    {"vmid": 104, "name": "Kali-linux", "type": "qemu", "node": "prx", "status": "stopped", "maxmem": 4 * 2**30},
    {"vmid": 9000, "name": "vorlage", "type": "qemu", "node": "prx", "status": "stopped", "template": 1},
]
AGENT = {
    "result": [
        {"name": "lo", "ip-addresses": [{"ip-address-type": "ipv4", "ip-address": "127.0.0.1"}]},
        {
            "name": "ens18",
            "ip-addresses": [
                {"ip-address-type": "ipv4", "ip-address": "192.168.5.132"},
                {"ip-address-type": "ipv6", "ip-address": "fe80::1"},
            ],
        },
        {"name": "docker0", "ip-addresses": [{"ip-address-type": "ipv4", "ip-address": "172.17.0.1"}]},
    ]
}
LXC = [{"name": "lo", "inet": "127.0.0.1/8"}, {"name": "eth0", "inet": "192.168.5.55/24", "inet6": "fe80::2/64"}]


def test_adressen_lesen():
    assert proxmox.adressen_lesen("qemu", AGENT) == ["192.168.5.132"]
    assert proxmox.adressen_lesen("lxc", LXC) == ["192.168.5.55"]
    assert proxmox.adressen_lesen("qemu", None) == []


async def test_stand_mit_token(aiohttp_server):
    koepfe = []

    async def ressourcen(request):
        koepfe.append(request.headers.get("Authorization"))
        assert request.query.get("type") == "vm"
        return web.json_response({"data": RESSOURCEN})

    async def agent(_r):
        return web.json_response({"data": AGENT})

    async def lxc(_r):
        return web.json_response({"data": LXC})

    app = web.Application()
    app.router.add_get("/api2/json/cluster/resources", ressourcen)
    app.router.add_get("/api2/json/nodes/prx/qemu/100/agent/network-get-interfaces", agent)
    app.router.add_get("/api2/json/nodes/prx/lxc/106/interfaces", lxc)
    server = await aiohttp_server(app)
    async with aiohttp.ClientSession() as s:
        p = proxmox.Proxmox(s, str(server.make_url("")), "ha@pve!panel=geheim")
        st = await p.stand()
        assert st["quelle"] == "proxmox" and not st["fehler"]
        g = {x["name"]: x for x in st["gaeste"]}
        assert set(g) == {"docker", "adguard", "Kali-linux"}  # ohne Vorlage
        assert g["docker"]["ips"] == ["192.168.5.132"] and g["docker"]["cpu"] == 1.23 and g["docker"]["ram"] == 50.0
        assert g["adguard"]["art"] == "lxc" and g["adguard"]["ips"] == ["192.168.5.55"]
        assert g["Kali-linux"]["ips"] == [] and g["Kali-linux"]["status"] == "stopped"
        assert koepfe == ["PVEAPIToken=ha@pve!panel=geheim"]
        await p.stand()  # Zwischenspeicher
        assert len(koepfe) == 1
        # Ohne gültiges Token nichts abfragen
        assert await proxmox.Proxmox(s, str(server.make_url("")), "").stand() == {"quelle": None, "fehler": None}


async def test_abgewiesen(aiohttp_server):
    async def nein(_r):
        return web.Response(status=401)

    app = web.Application()
    app.router.add_get("/api2/json/cluster/resources", nein)
    server = await aiohttp_server(app)
    async with aiohttp.ClientSession() as s:
        st = await proxmox.Proxmox(s, str(server.make_url("")), "a@pve!b=c").stand()
        assert st["quelle"] is None and "verweigert" in st["fehler"]
