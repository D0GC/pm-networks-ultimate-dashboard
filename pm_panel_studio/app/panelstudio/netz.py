"""Netzwerkstatus direkt vom UniFi-Gateway (UniFi OS, z. B. Cloud Gateway oder UDM).

Die UniFi-Integration von Home Assistant liefert Gerätezustände und Clients, aber weder Latenz noch Speedtest oder
WAN-Durchsatz. Diese stehen im Gesundheitsbericht des Controllers (``stat/health``: Subsysteme wan, www, lan, wlan);
die Geräte in ``stat/device``. Anmeldung mit API-Schlüssel (``X-API-Key``) oder Benutzer und Kennwort
(``/api/auth/login``, Cookie und CSRF-Kopfzeile). Das Gateway hat ein selbst signiertes Zertifikat; geprüft wird
deshalb nur bei dieser einen, fest eingestellten Adresse nicht.

Abgefragt wird nur auf Anfrage der Admin-Ansicht: Gesundheitsbericht und Gateway höchstens alle 2,5 Sekunden, die
übrige Geräteliste alle 20 Sekunden (Zwischenspeicher). Der Live-Durchsatz kommt aus den WAN-Schnittstellen des
Gateways, nicht aus dem Gesundheitsbericht (dort nur ein träger Mittelwert).

Den Ping misst die App selbst (``Ping``): Die Latenz im Gesundheitsbericht erneuert das Gateway nur in eigenen, längeren
Abständen. Gemessen wird wie bei UniFi zu Microsoft, Google und Cloudflare, jeweils die Dauer eines
TCP-Verbindungsaufbaus auf Port 443 (ICMP bräuchte im Container Sonderrechte); dazu der Durchschnitt der erreichten.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import socket
import time
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

FRISCH_S = 2.5  # Gesundheitsbericht (Live-Durchsatz, Latenz)
LIVE_FRISCH_S = 6.0  # so lange gilt ein Gateway-Stand aus der Ereignisverbindung als aktuell
LIVE_RUHE_S = 60.0  # ohne Abfrage der Admin-Ansicht schließt die Ereignisverbindung nach dieser Zeit
GERAETE_S = 20  # Geräteliste ändert sich selten
# Wie UniFi: Microsoft, Google und Cloudflare
PING_ZIELE = (("Microsoft", "www.microsoft.com", 443), ("Google", "www.google.com", 443), ("Cloudflare", "1.1.1.1", 443))
ADRESSE_S = 600
PING_FRIST_S = 2.0
TYPEN = {"ugw": "gateway", "udm": "gateway", "uxg": "gateway", "usw": "switch", "uap": "ap"}


class UnifiFehler(Exception):
    pass


def _zahl(v: Any) -> float | None:
    try:
        return None if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        return None


def geraet(d: dict[str, Any]) -> dict[str, Any]:
    """Ein Gerät aus ``stat/device`` auf das, was die Oberfläche zeigt."""
    stats = d.get("system-stats") or {}
    temps = [t.get("value") for t in d.get("temperatures") or [] if isinstance(t, dict) and t.get("value") is not None]
    temp = max(temps) if temps else d.get("general_temperature")
    ports = [p for p in d.get("port_table") or [] if isinstance(p, dict)]
    return {
        "name": d.get("name") or d.get("model") or d.get("mac"),
        "typ": TYPEN.get(str(d.get("type")), "sonst"),
        "modell": d.get("model_name") or d.get("model"),
        "online": d.get("state") == 1,
        "zustand": d.get("state"),
        "cpu": _zahl(stats.get("cpu")),
        "ram": _zahl(stats.get("mem")),
        "temp": _zahl(temp),
        "uptime": _zahl(d.get("uptime")),
        "clients": d.get("num_sta") if d.get("num_sta") is not None else d.get("user-num_sta"),
        "update": bool(d.get("upgradable")),
        "version": d.get("version"),
        "ip": d.get("ip"),
        "ports": len(ports) or None,
        "ports_aktiv": sum(1 for p in ports if p.get("up")) if ports else None,
    }


def ist_gateway(d: Any) -> bool:
    return isinstance(d, dict) and TYPEN.get(str(d.get("type"))) == "gateway"


def durchsatz(gw: dict[str, Any] | None) -> tuple[float, float, str] | None:
    """Aktueller WAN-Durchsatz in Byte/s aus dem Gateway-Gerät (wie die UniFi-Oberfläche).

    Die Raten im Gesundheitsbericht sind Mittelwerte über einen längeren Zeitraum und liegen bei kurzen Lastspitzen
    weit darunter, oft bei 0. Die WAN-Schnittstellen des Gateways (``wan1``, ``wan2`` …) führen die laufende Rate; ohne
    sie der Uplink.
    """
    if not isinstance(gw, dict):
        return None
    wans = [
        w
        for k, w in sorted(gw.items())
        if k.startswith("wan") and k[3:].isdigit() and isinstance(w, dict) and w.get("up", True)
        if _zahl(w.get("rx_bytes-r")) is not None
    ]
    if wans:
        return (
            sum(_zahl(w.get("rx_bytes-r")) or 0 for w in wans),
            sum(_zahl(w.get("tx_bytes-r")) or 0 for w in wans),
            "wan",
        )
    up = gw.get("uplink")
    if isinstance(up, dict) and _zahl(up.get("rx_bytes-r")) is not None:
        return _zahl(up.get("rx_bytes-r")) or 0, _zahl(up.get("tx_bytes-r")) or 0, "uplink"
    return None


def zaehler(gw: dict[str, Any] | None) -> tuple[float, float, float] | None:
    """Byte-Zähler der aktiven WAN-Schnittstellen (Summe) und ihr Zeitstempel (``last_seen`` des Gateways)."""
    if not isinstance(gw, dict):
        return None
    wans = [
        w
        for k, w in gw.items()
        if k.startswith("wan") and k[3:].isdigit() and isinstance(w, dict) and w.get("up", True)
        if _zahl(w.get("rx_bytes")) is not None and _zahl(w.get("tx_bytes")) is not None
    ]
    if not wans:
        return None
    zeit = _zahl(gw.get("last_seen")) or time.time()
    return zeit, sum(_zahl(w.get("rx_bytes")) or 0 for w in wans), sum(_zahl(w.get("tx_bytes")) or 0 for w in wans)


class Zaehlerrate:
    """Durchsatz aus der Änderung der Byte-Zähler über ein gleitendes Fenster.

    Die Momentrate des Gateways (``rx_bytes-r``) springt mit jedem Statusbericht und fällt zwischendurch weit ab; die
    UniFi-Oberfläche zeigt einen geglätteten Verlauf. Gerechnet wird über mindestens ``MIN_S`` und höchstens
    ``FENSTER_S`` Sekunden; sinkt ein Zähler (Neustart), beginnt die Messung neu.
    """

    FENSTER_S = 20.0
    MIN_S = 8.0

    def __init__(self) -> None:
        self._proben: list[tuple[float, float, float]] = []

    def neu(self, probe: tuple[float, float, float] | None) -> tuple[float, float] | None:
        if probe is None:
            return None
        if self._proben and (probe[1] < self._proben[-1][1] or probe[2] < self._proben[-1][2]):
            self._proben.clear()
        if not self._proben or probe[0] > self._proben[-1][0]:
            self._proben.append(probe)
        self._proben = [p for p in self._proben if probe[0] - p[0] <= self.FENSTER_S]
        alt = self._proben[0]
        dauer = probe[0] - alt[0]
        if dauer < self.MIN_S:
            return None
        return (probe[1] - alt[1]) / dauer, (probe[2] - alt[2]) / dauer


def durchsatzfelder(d: dict[str, Any], pfad: str = "", tiefe: int = 0) -> list[tuple[str, Any]]:
    """Felder, die nach Durchsatz oder Byte-Zählern aussehen (``bytes``, ``-r``, ``rate``, ``xput``), rekursiv."""
    aus: list[tuple[str, Any]] = []
    for k, v in d.items():
        name = f"{pfad}{k}"
        if isinstance(v, dict) and tiefe < 2:
            aus += durchsatzfelder(v, name + ".", tiefe + 1)
        elif isinstance(v, list) and tiefe < 2 and k in ("port_table", "uplink_table", "wan_table"):
            for n, e in enumerate(v):
                if isinstance(e, dict):
                    aus += durchsatzfelder(e, f"{name}[{n}].", tiefe + 1)
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            kl = k.lower()
            if "bytes" in kl or kl.endswith("-r") or "rate" in kl or "xput" in kl:
                aus.append((name, v))
    return aus


def auswerten(
    health: list[dict[str, Any]], geraete: list[dict[str, Any]], gateway: dict[str, Any] | None = None
) -> dict[str, Any]:
    sub = {h.get("subsystem"): h for h in health if isinstance(h, dict)}
    wan, www, lan, wlan = (sub.get(k) or {} for k in ("wan", "www", "lan", "wlan"))
    gw_stats = wan.get("gw_system-stats") or {}
    lastrun = _zahl(www.get("speedtest_lastrun"))
    rate = durchsatz(gateway or next((d for d in geraete if ist_gateway(d)), None))
    return {
        "internet": {
            "status": www.get("status") or wan.get("status"),
            "wan_status": wan.get("status"),
            "isp": wan.get("isp_name")
            or ((wan.get("isp_info") or {}).get("name") if isinstance(wan.get("isp_info"), dict) else None),
            "wan_ip": wan.get("wan_ip"),
            "latenz_ms": _zahl(www.get("latency")),
            "ping_ms": _zahl(www.get("speedtest_ping")),
            "down_mbit": _zahl(www.get("xput_down")),
            "up_mbit": _zahl(www.get("xput_up")),
            "speedtest_zeit": int(lastrun) if lastrun else None,
            "speedtest_status": www.get("speedtest_status"),
            "rx_bps": rate[0] if rate else _zahl(wan.get("rx_bytes-r")),
            "tx_bps": rate[1] if rate else _zahl(wan.get("tx_bytes-r")),
            "durchsatz_quelle": rate[2] if rate else "health",
            "uptime": _zahl(www.get("uptime")) or _zahl(gw_stats.get("uptime")),
            "ausfaelle": _zahl(www.get("drops")),
        },
        "clients": {
            "lan": lan.get("num_user"),
            "wlan": wlan.get("num_user"),
            "gast": (lan.get("num_guest") or 0) + (wlan.get("num_guest") or 0) if (lan or wlan) else None,
        },
        "geraete": sorted(
            (geraet(d) for d in geraete if isinstance(d, dict)),
            key=lambda g: (["gateway", "switch", "ap", "sonst"].index(g["typ"]), str(g["name"])),
        ),
    }


class Unifi:
    def __init__(
        self,
        session: aiohttp.ClientSession,
        adresse: str,
        schluessel: str = "",
        benutzer: str = "",
        kennwort: str = "",
        site: str = "default",
    ) -> None:
        self.session = session
        self.adresse = adresse.rstrip("/")
        self.schluessel, self.benutzer, self.kennwort, self.site = schluessel, benutzer, kennwort, site or "default"
        self._csrf: str | None = None
        self._angemeldet = False
        self._stand: dict[str, Any] | None = None
        self._geraete: list[dict[str, Any]] | None = None
        self._geraete_zeit = 0.0
        self._rate = Zaehlerrate()
        self._roh_gw: dict[str, Any] | None = None
        self._roh_health: list[dict[str, Any]] = []
        self._zaehler_rate: tuple[float, float] | None = None
        # Ereignisverbindung (WebSocket) zum Controller: das Gateway meldet seinen Stand selbst, wie in der UniFi-Oberfläche
        self._ws_task: asyncio.Task | None = None
        self._ws_gw: dict[str, Any] | None = None
        self._ws_zeit = 0.0
        self._ws_verbunden = False
        self._ws_fehler: str | None = None
        self._ws_typen: dict[str, int] = {}
        self._abgefragt = 0.0
        self._zeit = 0.0
        self._sperre = asyncio.Lock()

    @property
    def eingerichtet(self) -> bool:
        return bool(self.adresse and (self.schluessel or (self.benutzer and self.kennwort)))

    def _koepfe(self) -> dict[str, str]:
        k = {"Accept": "application/json"}
        if self.schluessel:
            k["X-API-Key"] = self.schluessel
        elif self._csrf:
            k["X-CSRF-Token"] = self._csrf
        return k

    async def _anmelden(self) -> None:
        async with self.session.post(
            f"{self.adresse}/api/auth/login",
            json={"username": self.benutzer, "password": self.kennwort, "remember": True},
            ssl=False,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as r:
            if r.status != 200:
                raise UnifiFehler(f"Anmeldung am Gateway abgelehnt (HTTP {r.status})")
            self._csrf = r.headers.get("X-CSRF-Token") or r.headers.get("x-updated-csrf-token")
            self._angemeldet = True

    async def _api(
        self, methode: str, pfad: str, daten: dict[str, Any] | None = None, wieder: bool = True
    ) -> list[dict[str, Any]]:
        if not self.schluessel and not self._angemeldet:
            await self._anmelden()
        url = f"{self.adresse}/proxy/network/api/s/{self.site}/{pfad}"
        async with self.session.request(
            methode, url, json=daten, headers=self._koepfe(), ssl=False, timeout=aiohttp.ClientTimeout(total=15)
        ) as r:
            if r.status == 401 and not self.schluessel and wieder:
                self._angemeldet = False
                return await self._api(methode, pfad, daten, wieder=False)
            if r.status in (401, 403):
                raise UnifiFehler("Gateway verweigert den Zugriff: API-Schlüssel oder Benutzer prüfen")
            if r.status != 200:
                raise UnifiFehler(f"Gateway antwortet mit HTTP {r.status}")
            if neu := r.headers.get("x-updated-csrf-token"):
                self._csrf = neu
            return (await r.json(content_type=None)).get("data") or []

    async def stand(self, neu: bool = False) -> dict[str, Any]:
        if not self.eingerichtet:
            return {"quelle": None, "fehler": None}
        self._abgefragt = time.monotonic()
        self._ws_starten()
        async with self._sperre:
            if self._stand and not neu and time.monotonic() - self._zeit < FRISCH_S:
                return self._mit_live(self._stand)
            try:
                if neu or self._geraete is None or time.monotonic() - self._geraete_zeit >= GERAETE_S:
                    health, geraete = await asyncio.gather(self._api("GET", "stat/health"), self._api("GET", "stat/device"))
                    self._geraete, self._geraete_zeit = geraete, time.monotonic()
                    gateway = None  # steckt frisch in der Liste
                else:
                    geraete = self._geraete
                    health, gateway = await asyncio.gather(self._api("GET", "stat/health"), self._gateway(geraete))
                stand = {"quelle": "unifi", "fehler": None, "zeit": int(time.time()), **auswerten(health, geraete, gateway)}
                # Für die Diagnose: Rohdaten und die aus den Zählern berechnete Rate (noch nicht angezeigt, bis am
                # echten Gateway geklärt ist, welches Feld dem Wert der UniFi-Oberfläche entspricht)
                self._roh_gw = gateway or next((d for d in geraete if ist_gateway(d)), None)
                self._roh_health = health
                self._zaehler_rate = self._rate.neu(zaehler(self._roh_gw))
            except (aiohttp.ClientError, TimeoutError, UnifiFehler, ValueError) as err:
                _LOGGER.warning("UniFi: %s", err)
                stand = {
                    **(self._stand or {}),
                    "quelle": "unifi" if self._stand else None,
                    "fehler": str(err) or type(err).__name__,
                }
            self._stand, self._zeit = stand, time.monotonic()
            return self._mit_live(stand)

    # ------------------------------------------------------------ Ereignisverbindung
    def _mit_live(self, stand: dict[str, Any]) -> dict[str, Any]:
        """Durchsatz aus dem jüngsten Gateway-Ereignis, solange es frisch ist; sonst der abgefragte Stand."""
        live = self._ws_gw is not None and time.monotonic() - self._ws_zeit < LIVE_FRISCH_S
        rate = durchsatz(self._ws_gw) if live else None
        if not rate or not isinstance(stand.get("internet"), dict):
            return {**stand, "live": False}
        return {
            **stand,
            "live": True,
            "zeit": int(time.time()),
            "internet": {**stand["internet"], "rx_bps": rate[0], "tx_bps": rate[1], "durchsatz_quelle": "live-" + rate[2]},
        }

    def _ws_starten(self) -> None:
        if self._ws_task is None or self._ws_task.done():
            self._ws_task = asyncio.create_task(self._ws_lauf())

    async def _ws_lauf(self) -> None:
        """Verbindet sich mit den Ereignissen des Controllers, solange die Admin-Ansicht abfragt; bei Fehlern mit
        wachsender Pause neu. Gateway-Meldungen (device:sync, device:update) ergänzen den zuletzt bekannten Stand."""
        url = self.adresse.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        url += f"/proxy/network/wss/s/{self.site}/events?clients=v2"
        pause = 5.0
        while time.monotonic() - self._abgefragt < LIVE_RUHE_S:
            try:
                if not self.schluessel and not self._angemeldet:
                    await self._anmelden()
                async with self.session.ws_connect(url, headers=self._koepfe(), ssl=False, heartbeat=30) as ws:
                    self._ws_verbunden, self._ws_fehler, pause = True, None, 5.0
                    while time.monotonic() - self._abgefragt < LIVE_RUHE_S:
                        try:
                            nachricht = await ws.receive(timeout=10)
                        except TimeoutError:
                            continue
                        if nachricht.type != aiohttp.WSMsgType.TEXT:
                            if nachricht.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.ERROR):
                                break
                            continue
                        self._ws_nachricht(nachricht.data)
            except asyncio.CancelledError:
                raise
            except (aiohttp.ClientError, TimeoutError, UnifiFehler, ValueError) as err:
                self._ws_fehler = str(err) or type(err).__name__
                _LOGGER.debug("UniFi-Ereignisse: %s", err)
            self._ws_verbunden = False
            await asyncio.sleep(pause)
            pause = min(60.0, pause * 2)
        self._ws_verbunden = False

    def _ws_nachricht(self, text: str) -> None:
        try:
            daten = json.loads(text)
        except ValueError:
            return
        if not isinstance(daten, dict):
            return
        art = str((daten.get("meta") or {}).get("message") or "?")
        self._ws_typen[art] = self._ws_typen.get(art, 0) + 1
        if art not in ("device:sync", "device:update"):
            return
        for d in daten.get("data") or []:
            if ist_gateway(d):
                self._ws_gw = {**(self._ws_gw or {}), **d}
                self._ws_zeit = time.monotonic()

    async def schliessen(self) -> None:
        if self._ws_task is not None:
            self._ws_task.cancel()
            await asyncio.gather(self._ws_task, return_exceptions=True)
            self._ws_task = None

    async def _gateway(self, geraete: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Das Gateway bei jeder Abfrage frisch (laufender WAN-Durchsatz); die übrige Geräteliste ruht 20 s."""
        gw = next((d for d in geraete if ist_gateway(d)), None)
        if not gw or not gw.get("mac"):
            return gw
        try:
            frisch = await self._api("GET", f"stat/device/{gw['mac']}")
        except (aiohttp.ClientError, TimeoutError, UnifiFehler, ValueError) as err:
            _LOGGER.debug("UniFi: Gateway nicht einzeln abrufbar: %s", err)
            return gw
        return next((d for d in frisch if ist_gateway(d)), gw)

    async def diagnose(self) -> dict[str, Any]:
        """Alle Durchsatz- und Zählerfelder von Gateway und Gesundheitsbericht, frisch abgefragt (nur Administratoren)."""
        await self.stand(neu=False)
        gw = self._roh_gw or {}
        felder = [{"pfad": f"gateway.{p}", "wert": w} for p, w in durchsatzfelder(gw)]
        for h in self._roh_health:
            if isinstance(h, dict) and h.get("subsystem") in ("wan", "www", "lan", "wlan"):
                felder += [{"pfad": f"health.{h['subsystem']}.{p}", "wert": w} for p, w in durchsatzfelder(h)]
        z = self._zaehler_rate
        live_gw = self._ws_gw or {}
        return {
            "live": {
                "verbunden": self._ws_verbunden,
                "fehler": self._ws_fehler,
                "letzte_s": round(time.monotonic() - self._ws_zeit, 1) if self._ws_gw else None,
                "nachrichten": dict(sorted(self._ws_typen.items(), key=lambda x: -x[1])[:12]),
                "felder": [{"pfad": f"live.{p}", "wert": w} for p, w in durchsatzfelder(live_gw)],
            },
            "zeit": int(time.time()),
            "gateway": gw.get("name") or gw.get("model"),
            "last_seen": gw.get("last_seen"),
            "abschnitte": sorted(k for k, v in gw.items() if isinstance(v, dict)),
            "zaehler_rate": {"rx": z[0], "tx": z[1]} if z else None,
            "felder": felder,
        }

    async def speedtest(self) -> None:
        """Speedtest am Gateway starten; das Ergebnis erscheint nach etwa einer Minute im Gesundheitsbericht."""
        await self._api("POST", "cmd/devmgr", {"cmd": "speedtest"})
        self._zeit = 0.0


async def _verbindungszeit(host: str, port: int) -> float | None:
    anfang = time.perf_counter()
    try:
        _, schreiber = await asyncio.wait_for(asyncio.open_connection(host, port), PING_FRIST_S)
    except (OSError, TimeoutError):
        return None
    dauer = (time.perf_counter() - anfang) * 1000
    schreiber.close()
    with contextlib.suppress(OSError):
        await schreiber.wait_closed()
    return dauer


class Ping:
    """Live-Ping zu mehreren Zielen: höchstens alle 2,5 Sekunden eine Messung, sonst der letzte Wert.

    Namen werden vorab aufgelöst und zehn Minuten behalten, damit die Namensauflösung nicht mitgemessen wird.
    """

    def __init__(self, ziele: tuple[tuple[str, str, int], ...] = PING_ZIELE) -> None:
        self.ziele = ziele
        self._adressen: dict[str, tuple[str, float]] = {}
        self._wert: dict[str, Any] | None = None
        self._zeit = 0.0
        self._sperre = asyncio.Lock()

    async def _adresse(self, host: str, port: int) -> str | None:
        bekannt = self._adressen.get(host)
        if bekannt and time.monotonic() - bekannt[1] < ADRESSE_S:
            return bekannt[0]
        try:
            info = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), 3)
        except (OSError, TimeoutError):
            return bekannt[0] if bekannt else None
        self._adressen[host] = (info[0][4][0], time.monotonic())
        return info[0][4][0]

    async def _ziel(self, name: str, host: str, port: int) -> dict[str, Any]:
        adresse = await self._adresse(host, port)
        ms = await _verbindungszeit(adresse, port) if adresse else None
        return {"name": name, "ms": None if ms is None else round(ms, 1)}

    async def messen(self) -> dict[str, Any]:
        async with self._sperre:
            if self._wert is not None and time.monotonic() - self._zeit < FRISCH_S:
                return self._wert
            ziele = await asyncio.gather(*(self._ziel(*z) for z in self.ziele))
            treffer = [z["ms"] for z in ziele if z["ms"] is not None]
            self._wert = {"ms": round(sum(treffer) / len(treffer), 1) if treffer else None, "ziele": list(ziele)}
            self._zeit = time.monotonic()
            return self._wert
