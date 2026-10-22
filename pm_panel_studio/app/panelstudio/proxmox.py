"""Proxmox VE direkt (nur lesend): Gäste mit aktuellen Werten und IP-Adressen für die Proxmox-Seite der Admin-Ansicht.

Die Integration Proxmox VE von Home Assistant liefert Zustand, CPU und RAM je Gast, aber keine IP-Adressen und nur im
Takt ihrer Abfrage. Mit einem API-Token (``PVEAPIToken=benutzer@realm!name=geheimnis``) fragt die App selbst:

* ``cluster/resources?type=vm``: alle VMs und Container mit CPU, RAM, Platte, Netz-Zählern und Laufzeit,
* IP-Adressen: Container über ``lxc/<id>/interfaces``, VMs über den Gast-Agenten (``agent/network-get-interfaces``;
  ohne Agent oder Recht bleibt die Liste leer).

Werte werden höchstens alle 4 Sekunden geholt, Adressen alle 60 Sekunden. Proxmox hat meist ein selbst signiertes
Zertifikat; geprüft wird deshalb nur bei dieser einen, fest eingestellten Adresse nicht.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import time
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

FRISCH_S = 4.0
ADRESSEN_S = 60.0


class ProxmoxFehler(Exception):
    pass


def adressen_lesen(art: str, daten: Any) -> list[str]:
    """IPv4-Adressen aus der Antwort von ``interfaces`` (Container) bzw. des Gast-Agenten (VM), ohne Loopback,
    Link-Local und interne Brücken (docker0, br-…, veth…)."""
    roh: list[tuple[str, str]] = []
    if art == "lxc":
        for i in daten or []:
            if isinstance(i, dict) and i.get("inet"):
                roh.append((str(i.get("name") or ""), str(i["inet"]).split("/")[0]))
    else:
        liste = daten.get("result") if isinstance(daten, dict) else daten
        for i in liste or []:
            if not isinstance(i, dict):
                continue
            for a in i.get("ip-addresses") or []:
                if isinstance(a, dict) and a.get("ip-address-type") == "ipv4":
                    roh.append((str(i.get("name") or ""), str(a.get("ip-address") or "")))
    aus: list[str] = []
    for name, ip in roh:
        if name == "lo" or name.startswith(("docker", "br-", "veth", "virbr", "cni", "flannel")):
            continue
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if a.is_loopback or a.is_link_local or ip in aus:
            continue
        aus.append(ip)
    return aus


def gast(d: dict[str, Any]) -> dict[str, Any]:
    maxmem, maxdisk = d.get("maxmem") or 0, d.get("maxdisk") or 0
    return {
        "vmid": d.get("vmid"),
        "name": d.get("name") or f"{d.get('type')} {d.get('vmid')}",
        "art": "lxc" if d.get("type") == "lxc" else "qemu",
        "knoten": d.get("node"),
        "status": d.get("status"),
        "cpu": round((d.get("cpu") or 0) * 100, 2),
        "kerne": d.get("maxcpu"),
        "ram": round((d.get("mem") or 0) / maxmem * 100, 1) if maxmem else None,
        "ram_gib": round((d.get("mem") or 0) / 2**30, 2),
        "ram_max_gib": round(maxmem / 2**30, 2) if maxmem else None,
        "platte_max_gib": round(maxdisk / 2**30, 1) if maxdisk else None,
        "netin": d.get("netin"),
        "netout": d.get("netout"),
        "laufzeit": d.get("uptime"),
        "vorlage": bool(d.get("template")),
    }


class Proxmox:
    def __init__(self, session: aiohttp.ClientSession, adresse: str, token: str) -> None:
        self.session = session
        self.adresse = adresse.rstrip("/")
        self.token = token.strip()
        self._stand: dict[str, Any] | None = None
        self._zeit = 0.0
        self._adressen: dict[int, list[str]] = {}
        self._adressen_zeit = 0.0
        self._sperre = asyncio.Lock()

    @property
    def eingerichtet(self) -> bool:
        return bool(self.adresse and "!" in self.token and "=" in self.token)

    async def _api(self, pfad: str) -> Any:
        async with self.session.get(
            f"{self.adresse}/api2/json/{pfad}",
            headers={"Authorization": f"PVEAPIToken={self.token}", "Accept": "application/json"},
            ssl=False,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as r:
            if r.status in (401, 403):
                raise ProxmoxFehler("Proxmox verweigert den Zugriff: API-Token oder Rechte prüfen")
            if r.status != 200:
                raise ProxmoxFehler(f"Proxmox antwortet mit HTTP {r.status}")
            return (await r.json(content_type=None)).get("data")

    async def _adresse(self, g: dict[str, Any]) -> tuple[int, list[str]]:
        pfad = f"nodes/{g['knoten']}/{g['art']}/{g['vmid']}/" + (
            "interfaces" if g["art"] == "lxc" else "agent/network-get-interfaces"
        )
        try:
            return g["vmid"], adressen_lesen(g["art"], await self._api(pfad))
        except (aiohttp.ClientError, TimeoutError, ProxmoxFehler, ValueError) as err:
            _LOGGER.debug("Proxmox: keine Adressen für %s: %s", g["name"], err)
            return g["vmid"], self._adressen.get(g["vmid"], [])

    async def stand(self) -> dict[str, Any]:
        if not self.eingerichtet:
            return {"quelle": None, "fehler": None}
        async with self._sperre:
            if self._stand and time.monotonic() - self._zeit < FRISCH_S:
                return self._stand
            try:
                gaeste = [gast(d) for d in await self._api("cluster/resources?type=vm") or [] if isinstance(d, dict)]
                gaeste = [g for g in gaeste if not g["vorlage"]]
                if time.monotonic() - self._adressen_zeit >= ADRESSEN_S:
                    laufend = [g for g in gaeste if g["status"] == "running"]
                    self._adressen.update(dict(await asyncio.gather(*(self._adresse(g) for g in laufend))))
                    self._adressen_zeit = time.monotonic()
                for g in gaeste:
                    g["ips"] = self._adressen.get(g["vmid"], []) if g["status"] == "running" else []
                stand = {"quelle": "proxmox", "fehler": None, "zeit": int(time.time()), "gaeste": gaeste}
            except (aiohttp.ClientError, TimeoutError, ProxmoxFehler, ValueError) as err:
                _LOGGER.warning("Proxmox: %s", err)
                stand = {
                    **(self._stand or {}),
                    "quelle": "proxmox" if self._stand else None,
                    "fehler": str(err) or type(err).__name__,
                }
            self._stand, self._zeit = stand, time.monotonic()
            return stand
