"""Zentraler Zustand: Verbindung zu Home Assistant, Zustandsspiegel, Karten, Ruhe/Wach, Ereignisse.

Die Panels erhalten über ihren WebSocket nur fertige Daten:
  init        vollständiger Stand (Zustände kompakt, Bereiche, Registry, Einstellungen, Karten, Modus)
  diff        geänderte Zustände (gebündelt, höchstens alle 250 ms)
  karten      Karussell-Inhalt, wenn er sich ändert
  modus       wach / ruhe, nacht, Verbindungsstatus
  ereignis    Klingel bzw. Person an der Tür (Kamera-Overlay)
  einstellungen  nach Änderung im Editor
  registry    nach Änderung von Bereichen oder Entitäten
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
from datetime import UTC, datetime
from typing import Any

from aiohttp import web

from . import karten as kt
from .config import Einstellungen, EinstellungsSpeicher, Options
from .ha_client import HAClient, HAError

_LOGGER = logging.getLogger(__name__)

ATTR_MAX = 6000  # Attribute größer als das werden nicht an die Panels gesendet (Abruf bei Bedarf)
FLUSH_S = 0.25
RETRY = (2, 5, 10, 20, 30)

# Dienste, die ein Wand-Panel nicht auslösen darf
DOMAINS_GESPERRT = {
    "hassio",
    "recorder",
    "system_log",
    "logger",
    "backup",
    "shell_command",
    "rest_command",
    "python_script",
    "pyscript",
    "frontend",
    "lovelace",
    "cloud",
    "ffmpeg",
}
HOMEASSISTANT_ERLAUBT = {"turn_on", "turn_off", "toggle", "update_entity"}

# Nur lesende WebSocket-Befehle, die ein Panel durchreichen darf
WS_ERLAUBT = {
    "todo/item/list",
    "history/history_during_period",
    "logbook/get_events",
    "recorder/statistics_during_period",
    "weather/subscribe_forecast",
}
REST_ERLAUBT = ("calendars/", "logbook/", "history/period/")
BILD_ERLAUBT = ("/api/camera_proxy/", "/api/media_player_proxy/", "/api/image_proxy/", "/api/image/serve/")


def kompakt(st: dict[str, Any]) -> dict[str, Any]:
    attrs = st.get("attributes") or {}
    roh = json.dumps(attrs, ensure_ascii=False, default=str)
    if len(roh) > ATTR_MAX:
        klein = {}
        for k, v in attrs.items():
            if len(json.dumps(v, ensure_ascii=False, default=str)) <= 600:
                klein[k] = v
        klein["_gross"] = True
        attrs = klein
    return {"s": st.get("state"), "a": attrs, "lc": st.get("last_changed")}


def _slug(text: str) -> str:
    t = text.lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


def dienst_erlaubt(domain: str, service: str) -> bool:
    if domain in DOMAINS_GESPERRT:
        return False
    if domain == "homeassistant":
        return service in HOMEASSISTANT_ERLAUBT
    return True


class Hub:
    def __init__(self, opts: Options, client: HAClient, speicher: EinstellungsSpeicher) -> None:
        self.opts = opts
        self.client = client
        self.speicher = speicher
        self.einstellungen: Einstellungen = speicher.laden()
        self.states: dict[str, dict[str, Any]] = {}
        self.registry: dict[str, dict[str, Any]] = {}
        self.bereiche: list[dict[str, Any]] = []
        self.ha_config: dict[str, Any] = {}
        self.clients: set[web.WebSocketResponse] = set()
        self.verbunden = False
        self.karten: list[dict] = []
        self._karten_json = ""
        self._diff: dict[str, Any] = {}
        self._flush_task: asyncio.Task | None = None
        self._tasks: list[asyncio.Task] = []
        self._hintergrund: set[asyncio.Task] = set()
        self._registry_neu = asyncio.Event()
        self._relevant = kt.relevante_entitaeten(opts.hinweise_entitaet)
        # Ruhe/Wach
        self.letzte_bewegung = time.monotonic()
        self.letzte_beruehrung = 0.0
        self.modus = "wach"
        # Music-Assistant-Player (für das Karussell) und HA-Benachrichtigungen (Glocke)
        self.musik: list[str] = []
        self.meldungen: dict[str, dict[str, Any]] = {}
        # Ereignis
        self.ereignis: dict[str, Any] | None = None
        self._ereignis_bis = 0.0

    # ------------------------------------------------------------ Lebenszyklus

    def spawn(self, coro: Any) -> asyncio.Task:
        """Hintergrundaufgabe mit gehaltener Referenz (sonst kann sie vorzeitig eingesammelt werden)."""
        task = asyncio.create_task(coro)
        self._hintergrund.add(task)
        task.add_done_callback(self._hintergrund.discard)
        return task

    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._verbindung_loop(), name="ha-verbindung"),
            asyncio.create_task(self._takt_loop(), name="takt"),
            asyncio.create_task(self._registry_loop(), name="registry"),
        ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        for ws in list(self.clients):
            with contextlib.suppress(Exception):
                await ws.close()

    async def _verbindung_loop(self) -> None:
        versuch = 0
        while True:
            try:
                await self._verbinden()
                versuch = 0
                await self.client.wait_closed()
                _LOGGER.warning("Verbindung zu Home Assistant getrennt")
            except HAError as err:
                _LOGGER.warning("Home Assistant nicht erreichbar: %s", err)
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOGGER.exception("Unerwarteter Fehler in der Verbindung")
            if self.verbunden:
                self.verbunden = False
                await self.senden_alle({"typ": "modus", **self.modus_daten()})
            await asyncio.sleep(RETRY[min(versuch, len(RETRY) - 1)])
            versuch += 1

    async def _verbinden(self) -> None:
        # Erst abonnieren, dann den Gesamtstand holen: so geht zwischen beiden keine Änderung verloren.
        await self.client.subscribe({"type": "subscribe_events", "event_type": "state_changed"}, self._on_state_changed)
        for ev in ("entity_registry_updated", "area_registry_updated", "device_registry_updated"):
            await self.client.subscribe({"type": "subscribe_events", "event_type": ev}, lambda _e: self._registry_neu.set())
        try:
            await self.client.subscribe({"type": "persistent_notification/subscribe"}, self._on_meldung)
        except HAError as err:
            _LOGGER.warning("Benachrichtigungen nicht abonniert: %s", err)
        states = await self.client.get_states()
        self.states = {s["entity_id"]: s for s in states if isinstance(s, dict) and "entity_id" in s}
        with contextlib.suppress(HAError):
            self.ha_config = await self.client.get_config()
        await self._registry_laden()
        self.verbunden = True
        _LOGGER.info("Mit Home Assistant verbunden (%d Entitäten, %d Bereiche)", len(self.states), len(self.bereiche))
        self._karten_neu(senden=False)
        for ws in list(self.clients):
            await self.init_senden(ws)

    async def _registry_laden(self) -> None:
        areas = await self.client.area_registry_list()
        try:
            floors = await self.client.ws_command({"type": "config/floor_registry/list"})
        except HAError:
            floors = []
        etagen = {f.get("floor_id"): f for f in floors or [] if isinstance(f, dict)}
        devices = await self.client.device_registry_list()
        entities = await self.client.entity_registry_list_for_display()
        dev_area = {d.get("id"): d.get("area_id") for d in devices if isinstance(d, dict)}
        self.bereiche = [
            {
                "id": a.get("area_id"),
                "name": a.get("name"),
                "icon": a.get("icon"),
                "etage": (etagen.get(a.get("floor_id")) or {}).get("name"),
                "etage_level": (etagen.get(a.get("floor_id")) or {}).get("level"),
            }
            for a in areas
            if isinstance(a, dict) and a.get("area_id")
        ]
        reg: dict[str, dict[str, Any]] = {}
        for e in entities:
            eid = e["entity_id"]
            reg[eid] = {
                "b": e.get("area_id") or dev_area.get(e.get("device_id")),
                "d": e.get("device_id"),
                "ec": e.get("entity_category"),
                "h": e.get("hidden"),
                "n": e.get("name"),
                "i": e.get("icon"),
                "l": e.get("labels") or [],
                "p": e.get("platform"),
            }
        self._klima_zuordnen(reg)
        self.registry = reg
        self.musik = sorted(eid for eid, r in reg.items() if r.get("p") == "music_assistant" and eid.startswith("media_player."))
        self._relevant = kt.relevante_entitaeten(self.opts.hinweise_entitaet) | set(self.musik)

    def _klima_zuordnen(self, reg: dict[str, dict[str, Any]]) -> None:
        """PM-Klima-Thermostate ohne Bereich über ihren Namen zuordnen (climate.pm_kuche -> Bereich kuche)."""
        praefix = self.opts.klima_praefix
        if not praefix:
            return
        nach_slug: dict[str, str] = {}
        for b in self.bereiche:
            nach_slug[str(b["id"])] = b["id"]
            nach_slug[_slug(str(b.get("name") or ""))] = b["id"]
        for eid, r in reg.items():
            if eid.startswith(praefix) and not r.get("b"):
                r["b"] = nach_slug.get(eid[len(praefix) :])

    def _on_meldung(self, event: dict[str, Any]) -> None:
        typ = event.get("type")
        eintraege = event.get("notifications") or {}
        if typ == "current":
            self.meldungen = dict(eintraege)
        elif typ == "removed":
            for nid in eintraege:
                self.meldungen.pop(nid, None)
        else:
            self.meldungen.update(eintraege)
        self.spawn(self.senden_alle({"typ": "meldungen", "liste": self.meldungen_liste()}))

    def meldungen_liste(self) -> list[dict[str, Any]]:
        return sorted(self.meldungen.values(), key=lambda m: str(m.get("created_at") or ""), reverse=True)

    async def _registry_loop(self) -> None:
        while True:
            await self._registry_neu.wait()
            await asyncio.sleep(3)  # Änderungen bündeln
            self._registry_neu.clear()
            try:
                await self._registry_laden()
            except HAError as err:
                _LOGGER.warning("Registry nicht geladen: %s", err)
                continue
            await self.senden_alle({"typ": "registry", "bereiche": self.bereiche, "registry": self.registry})

    # ------------------------------------------------------------ Zustände

    def _on_state_changed(self, event: dict[str, Any]) -> None:
        data = event.get("data") or {}
        eid = data.get("entity_id")
        if not eid:
            return
        neu = data.get("new_state")
        alt = self.states.get(eid)
        if neu is None:
            self.states.pop(eid, None)
            self._diff[eid] = None
        else:
            self.states[eid] = neu
            self._diff[eid] = kompakt(neu)
        if self._flush_task is None or self._flush_task.done():
            self._flush_task = self.spawn(self._flush())
        if eid in self._relevant:
            self._karten_neu()
        if eid in self.opts.bewegung and neu and neu.get("state") == "on":
            self.letzte_bewegung = time.monotonic()
            self._modus_pruefen()
        if eid == "sun.sun":
            self.spawn(self.senden_alle({"typ": "modus", **self.modus_daten()}))
        if eid in self.opts.ereignis_ausloeser and neu and neu.get("state") == "on" and (alt or {}).get("state") != "on":
            self.ereignis_starten(eid)

    async def _flush(self) -> None:
        await asyncio.sleep(FLUSH_S)
        diff, self._diff = self._diff, {}
        if diff:
            await self.senden_alle({"typ": "diff", "zustaende": diff})

    def _karten_neu(self, senden: bool = True) -> None:
        karten = kt.berechne(
            self.states, self.opts.hinweise_entitaet, datetime.now(UTC), self.einstellungen.karten_aus, self.musik
        )
        roh = json.dumps(karten, ensure_ascii=False, sort_keys=True)
        if roh == self._karten_json:
            return
        self._karten_json = roh
        self.karten = karten
        if senden:
            self.spawn(self.senden_alle({"typ": "karten", "karten": karten}))

    # ------------------------------------------------------------ Ruhe / Wach / Ereignis

    def bewegung_aktiv(self) -> bool:
        return any((self.states.get(e) or {}).get("state") == "on" for e in self.opts.bewegung)

    def nacht(self) -> bool:
        return (self.states.get("sun.sun") or {}).get("state") == "below_horizon"

    def modus_daten(self) -> dict[str, Any]:
        return {"modus": self.modus, "nacht": self.nacht(), "verbunden": self.verbunden}

    def _modus_pruefen(self) -> None:
        jetzt = time.monotonic()
        if self.bewegung_aktiv():
            self.letzte_bewegung = jetzt
        letzte = max(self.letzte_bewegung, self.letzte_beruehrung)
        neu = "ruhe" if (jetzt - letzte) > self.einstellungen.ruhe_nach_s else "wach"
        if neu != self.modus:
            self.modus = neu
            self.spawn(self.senden_alle({"typ": "modus", **self.modus_daten()}))

    def beruehrt(self) -> None:
        self.letzte_beruehrung = time.monotonic()
        self._modus_pruefen()

    def ereignis_starten(self, ausloeser: str) -> None:
        st = self.states.get(ausloeser) or {}
        name = (st.get("attributes") or {}).get("friendly_name") or ausloeser
        self.ereignis = {
            "aktiv": True,
            "ausloeser": ausloeser,
            "titel": name,
            "kamera": self.opts.ereignis_kamera or None,
            "tueroeffner": self.opts.tueroeffner or None,
            "seit": datetime.now(UTC).isoformat(),
        }
        self._ereignis_bis = time.monotonic() + self.einstellungen.ereignis_dauer_s
        self.letzte_bewegung = time.monotonic()
        self._modus_pruefen()
        self.spawn(self.senden_alle({"typ": "ereignis", **self.ereignis}))

    def ereignis_beenden(self) -> None:
        if self.ereignis is None:
            return
        self.ereignis = None
        self.spawn(self.senden_alle({"typ": "ereignis", "aktiv": False}))

    async def _takt_loop(self) -> None:
        zaehler = 0
        while True:
            await asyncio.sleep(1)
            zaehler += 1
            self._modus_pruefen()
            if self.ereignis and time.monotonic() > self._ereignis_bis:
                self.ereignis_beenden()
            if zaehler % 15 == 0 and self.verbunden:
                self._karten_neu()  # Restzeiten ohne Zustandsänderung (Timer) nachführen

    # ------------------------------------------------------------ Panels

    def init_daten(self) -> dict[str, Any]:
        return {
            "typ": "init",
            "zustaende": {eid: kompakt(st) for eid, st in self.states.items()},
            "bereiche": self.bereiche,
            "registry": self.registry,
            "einstellungen": self.einstellungen.to_dict(),
            "optionen": self.opts.public(),
            "karten": self.karten,
            "meldungen": self.meldungen_liste(),
            "ereignis": self.ereignis or {"aktiv": False},
            "ha": {
                "standort": self.ha_config.get("location_name"),
                "zeitzone": self.ha_config.get("time_zone"),
                "einheit_temp": (self.ha_config.get("unit_system") or {}).get("temperature", "°C"),
            },
            **self.modus_daten(),
        }

    async def init_senden(self, ws: web.WebSocketResponse) -> None:
        with contextlib.suppress(Exception):
            await ws.send_str(json.dumps(self.init_daten(), ensure_ascii=False, default=str))

    async def senden_alle(self, msg: dict[str, Any]) -> None:
        if not self.clients:
            return
        roh = json.dumps(msg, ensure_ascii=False, default=str)
        tot = []
        for ws in list(self.clients):
            try:
                await ws.send_str(roh)
            except Exception:
                tot.append(ws)
        for ws in tot:
            self.clients.discard(ws)

    def einstellungen_setzen(self, raw: dict[str, Any]) -> list[str]:
        abgewiesen = self.einstellungen.aktualisieren(raw)
        self.speicher.speichern(self.einstellungen)
        self._karten_json = ""
        self._karten_neu()
        self.spawn(self.senden_alle({"typ": "einstellungen", "einstellungen": self.einstellungen.to_dict()}))
        return abgewiesen

    # ------------------------------------------------------------ Anfragen der Panels

    async def anfrage(self, msg: dict[str, Any]) -> Any:
        """Bearbeitet eine Anfrage mit ``id``; Rückgabe ist das Ergebnis, Fehler als HAError/ValueError."""
        typ = msg.get("typ")
        if typ == "dienst":
            domain, service = str(msg.get("domain", "")), str(msg.get("service", ""))
            if not dienst_erlaubt(domain, service):
                raise ValueError(f"Dienst {domain}.{service} ist am Panel nicht erlaubt")
            data = msg.get("data") if isinstance(msg.get("data"), dict) else {}
            return await self.client.call_service(domain, service, data, return_response=bool(msg.get("antwort")))
        if typ == "ws":
            befehl = msg.get("befehl") if isinstance(msg.get("befehl"), dict) else {}
            if befehl.get("type") not in WS_ERLAUBT:
                raise ValueError(f"Befehl {befehl.get('type')} ist nicht erlaubt")
            return await self.client.ws_command(befehl, timeout=60)
        if typ == "rest":
            pfad = str(msg.get("pfad", ""))
            if not pfad.startswith(REST_ERLAUBT) or ".." in pfad:
                raise ValueError("Pfad nicht erlaubt")
            return await self.client.rest("GET", pfad)
        if typ == "attribute":
            eid = str(msg.get("entity_id", ""))
            st = self.states.get(eid)
            return (st or {}).get("attributes") or {}
        if typ == "ereignis_ende":
            self.ereignis_beenden()
            return True
        if typ == "ereignis_test":
            self.ereignis_starten((self.opts.ereignis_ausloeser or ["test"])[0])
            return True
        raise ValueError(f"Unbekannte Anfrage {typ}")
