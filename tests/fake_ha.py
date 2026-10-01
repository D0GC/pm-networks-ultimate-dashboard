"""Nachbildung der benötigten Home-Assistant-Schnittstellen für Tests und Vorschau.

Pfade wie hinter dem Supervisor-Proxy:
  REST  /core/api/states, /core/api/config, /core/api/services/<domain>/<service>, /core/api/camera_proxy/<eid>,
        /core/api/calendars/<eid>, /core/api/logbook/<start>
  WS    /core/websocket  (auth_required -> auth -> auth_ok), subscribe_events, call_service, Registry-Listen,
        todo/item/list, history/history_during_period

Start eigenständig (Vorschau):  python tests/fake_ha.py --port 8123
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import math
from datetime import UTC, datetime, timedelta
from typing import Any

from aiohttp import WSMsgType, web

TOKEN = "test-token"

AREAS = [
    ("flur", "Flur", "mdi:door"),
    ("wohnzimmer", "Wohnzimmer", "mdi:sofa"),
    ("kuche", "Küche", "mdi:countertop"),
    ("badezimmer", "Badezimmer", "mdi:shower"),
    ("schlafzimmer", "Schlafzimmer", "mdi:bed"),
    ("buro", "Büro", "mdi:desk"),
]

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2b3a8b10000000049454e44ae426082"
)


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def default_states(jetzt: datetime) -> list[dict[str, Any]]:
    def s(eid, state, area=None, **attrs):
        return {"entity_id": eid, "state": state, "attributes": attrs, "_area": area}

    return [
        s("sun.sun", "above_horizon", friendly_name="Sonne"),
        s(
            "weather.dwd_zuhause",
            "partlycloudy",
            friendly_name="DWD Zuhause",
            temperature=17.4,
            temperature_unit="°C",
            humidity=62,
        ),
        s(
            "sensor.aussentemperatur",
            "16.8",
            None,
            friendly_name="Außentemperatur",
            device_class="temperature",
            unit_of_measurement="°C",
        ),
        s("person.dominik", "home", None, friendly_name="Dominik"),
        s("person.gina_perina", "not_home", None, friendly_name="Gina Perina"),
        s("alarm_control_panel.alarmo", "armed_home", None, friendly_name="Alarmsystem", code_format="number"),
        s(
            "binary_sensor.bewegungsmelder_flur_1_bewegung",
            "off",
            "flur",
            friendly_name="Bewegungsmelder Flur 1 Bewegung",
            device_class="motion",
        ),
        s(
            "binary_sensor.bewegungsmelder_flur_2_bewegung",
            "off",
            "flur",
            friendly_name="Bewegungsmelder Flur 2 Bewegung",
            device_class="motion",
        ),
        s("binary_sensor.wohnungstuer_person", "off", "flur", friendly_name="Wohnungstür Person", device_class="occupancy"),
        s("binary_sensor.tur_wohnung", "off", "flur", friendly_name="Wohnungstür", device_class="door"),
        s("binary_sensor.buro_balkontur_tur", "on", "buro", friendly_name="Büro Balkontür", device_class="door"),
        s("binary_sensor.fenster_kuche", "off", "kuche", friendly_name="Fenster Küche", device_class="window"),
        s("lock.eingangstur", "locked", "flur", friendly_name="Schloss Wohnungstür", supported_features=1),
        s("button.haustur_tur_offnen", "2026-10-01T13:42:12+00:00", "flur", friendly_name="Haustür Tür öffnen"),
        s("camera.wohnungstuer_standardauflosung", "idle", "flur", friendly_name="Wohnungstür Kamera"),
        s(
            "light.flur_deckenlampe_flur",
            "on",
            "flur",
            friendly_name="Flur Deckenlampe",
            brightness=153,
            supported_color_modes=["brightness"],
        ),
        s(
            "light.deckenlampe_wohnzimmer",
            "on",
            "wohnzimmer",
            friendly_name="Deckenlampe Wohnzimmer",
            brightness=204,
            supported_color_modes=["color_temp", "hs"],
            color_temp_kelvin=3000,
            min_color_temp_kelvin=2200,
            max_color_temp_kelvin=6500,
        ),
        s("light.lowboard", "on", "wohnzimmer", friendly_name="Lowboard", brightness=90, supported_color_modes=["hs"]),
        s("light.lichterkette", "off", "wohnzimmer", friendly_name="Lichterkette", supported_color_modes=["onoff"]),
        s(
            "light.kuche_deckenlampe_kuche",
            "off",
            "kuche",
            friendly_name="Küche Deckenlampe",
            supported_color_modes=["brightness"],
        ),
        s("light.badezimmer", "off", "badezimmer", friendly_name="Badezimmer", supported_color_modes=["brightness"]),
        s(
            "light.deckenlampe_schlafzimmer",
            "off",
            "schlafzimmer",
            friendly_name="Deckenlampe Schlafzimmer",
            supported_color_modes=["brightness"],
        ),
        s("light.deckenlampe_buro", "off", "buro", friendly_name="Deckenlampe Büro", supported_color_modes=["brightness"]),
        s("scene.wohnzimmer_ambiente", "2026-09-30T19:00:00+00:00", "wohnzimmer", friendly_name="Wohnzimmer Ambiente"),
        s(
            "climate.pm_wohnzimmer",
            "heat",
            None,
            friendly_name="PM Wohnzimmer",
            current_temperature=21.4,
            temperature=21.0,
            current_humidity=48,
            min_temp=5,
            max_temp=25,
            hvac_action="idle",
            preset_mode="zeitplan",
            preset_modes=["zeitplan", "manuell", "komfort", "eco", "frostschutz"],
            hvac_modes=["heat", "off"],
        ),
        s(
            "climate.pm_badezimmer",
            "heat",
            "badezimmer",
            friendly_name="PM Badezimmer",
            current_temperature=22.8,
            temperature=23.0,
            current_humidity=71,
            min_temp=5,
            max_temp=25,
            hvac_action="heating",
            preset_mode="zeitplan",
            preset_modes=["zeitplan", "manuell", "komfort", "eco", "frostschutz"],
            hvac_modes=["heat", "off"],
        ),
        s(
            "sensor.schlafzimmertemperatur",
            "18.9",
            "schlafzimmer",
            friendly_name="Schlafzimmer Temperatur",
            device_class="temperature",
            unit_of_measurement="°C",
        ),
        s(
            "sensor.schlafzimmerluftfeuchte",
            "55",
            "schlafzimmer",
            friendly_name="Schlafzimmer Luftfeuchte",
            device_class="humidity",
            unit_of_measurement="%",
        ),
        s(
            "sensor.kuchentemperatur",
            "20.8",
            "kuche",
            friendly_name="Küche Temperatur",
            device_class="temperature",
            unit_of_measurement="°C",
        ),
        s(
            "sensor.buro_buro_leistung",
            "312",
            "buro",
            friendly_name="Büro Leistung",
            device_class="power",
            unit_of_measurement="W",
        ),
        s(
            "sensor.balkon_kohlegrill_derzeitiger_verbrauch",
            "0",
            None,
            friendly_name="Kohlegrill Verbrauch",
            device_class="power",
            unit_of_measurement="W",
        ),
        s(
            "sensor.schloss_batterie",
            "18",
            "flur",
            friendly_name="Schloss Batterie",
            device_class="battery",
            unit_of_measurement="%",
        ),
        s(
            "sensor.wohnungstuer_batterie",
            "48",
            "flur",
            friendly_name="Kamera Wohnungstür",
            device_class="battery",
            unit_of_measurement="%",
        ),
        s(
            "media_player.wohnzimmer",
            "playing",
            "wohnzimmer",
            friendly_name="Wohnzimmer",
            media_title="Nightcall",
            media_artist="Kavinsky",
            volume_level=0.32,
            source_list=["Spotify", "Radio"],
            source="Spotify",
        ),
        s("vacuum.roborock_s8", "docked", "flur", friendly_name="Roborock S8"),
        s("input_boolean.alles_stumm", "off", None, friendly_name="Alles stumm"),
        s("script.morgen_briefing", "off", None, friendly_name="Morgen-Briefing"),
        s("todo.einkaufsliste", "2", None, friendly_name="Einkaufsliste"),
        s("calendar.privat", "off", None, friendly_name="Privat"),
        s(
            "update.home_assistant_core_update",
            "on",
            None,
            friendly_name="Home Assistant Core",
            latest_version="2026.10.1",
            installed_version="2026.9.3",
        ),
        s(
            "climate.wohnzimmer_lokal",
            "heat",
            "wohnzimmer",
            friendly_name="Wohnzimmer lokal",
            current_temperature=21.2,
            temperature=21.0,
        ),
        s("scene.wohnzimmer_fairfax", "unknown", "wohnzimmer", friendly_name="Wohnzimmer Fairfax"),
        s(
            "media_player.wohnung_3",
            "playing",
            None,
            friendly_name="Wohnung",
            media_title="Midnight City",
            media_artist="M83",
            media_duration=244,
            media_position=60,
            media_position_updated_at=_iso(jetzt),
        ),
        s(
            "sensor.panel_bad_hinweise",
            "3",
            None,
            friendly_name="Panel Bad Hinweise",
            zeilen="offen|Offen|1 offen|Büro Balkontür\nmuell|Müll|morgen|Biotonne, Gelber Sack\nwetter|Wetter|12–18°|Regen ab 17 Uhr",
        ),
        s(
            "timer.kohle_timer",
            "active",
            None,
            friendly_name="Kohle Timer",
            duration="0:15:00",
            finishes_at=_iso(jetzt + timedelta(minutes=9, seconds=20)),
            remaining="0:15:00",
        ),
        s("switch.balkon_kohlegrill", "on", None, friendly_name="Balkon Kohlegrill"),
        s("sensor.karl_die_waschmaschine_aktueller_status", "running", None, friendly_name="Karl Status"),
        s("sensor.waschmaschine_phase", "Waschen", None, friendly_name="Waschmaschine Phase"),
        s("sensor.waschmaschine_fortschritt", "35", None, friendly_name="Waschmaschine Fortschritt", unit_of_measurement="%"),
        s(
            "sensor.karl_die_waschmaschine_verbleibende_zeit",
            "74",
            None,
            friendly_name="Karl Restzeit",
            unit_of_measurement="min",
        ),
        s("sensor.roborock_s8_status", "charging", "flur", friendly_name="Roborock Status"),
    ]


class FakeHA:
    def __init__(self) -> None:
        jetzt = datetime.now(UTC)
        self.states: dict[str, dict[str, Any]] = {}
        self.area_of: dict[str, str | None] = {}
        for st in default_states(jetzt):
            area = st.pop("_area")
            st["last_changed"] = st["last_updated"] = _iso(jetzt - timedelta(minutes=12))
            self.states[st["entity_id"]] = st
            self.area_of[st["entity_id"]] = area
        self.calls: list[tuple[str, str, dict]] = []
        self._tasks: set = set()
        self.meldungen = {
            "n1": {
                "notification_id": "n1",
                "title": "Neue Geräte gefunden",
                "message": "2 neue Geräte",
                "created_at": _iso(jetzt),
            }
        }
        self.subs: list[tuple[web.WebSocketResponse, int, str]] = []
        self.todo = {
            "todo.einkaufsliste": [
                {"uid": "1", "summary": "Kaffee", "status": "needs_action"},
                {"uid": "2", "summary": "Milch", "status": "needs_action"},
            ]
        }
        self.app = web.Application()
        r = self.app.router
        r.add_get("/core/api/states", self.rest_states)
        r.add_get("/core/api/config", self.rest_config)
        r.add_post("/core/api/services/{domain}/{service}", self.rest_service)
        r.add_get("/core/api/camera_proxy/{eid}", self.rest_camera)
        r.add_get("/core/api/camera_proxy_stream/{eid}", self.rest_camera_stream)
        r.add_get("/core/api/calendars/{eid}", self.rest_calendar)
        r.add_get("/core/api/logbook/{start}", self.rest_logbook)
        r.add_get("/core/websocket", self.ws)

    def _auth(self, request: web.Request) -> None:
        if request.headers.get("Authorization") != f"Bearer {TOKEN}":
            raise web.HTTPUnauthorized()

    async def rest_states(self, request):
        self._auth(request)
        return web.json_response(list(self.states.values()))

    async def rest_config(self, request):
        self._auth(request)
        return web.json_response({"location_name": "Zuhause", "time_zone": "Europe/Berlin", "unit_system": {"temperature": "°C"}})

    async def rest_camera(self, request):
        self._auth(request)
        return web.Response(body=PNG_1PX, content_type="image/png")

    async def rest_camera_stream(self, request):
        self._auth(request)
        resp = web.StreamResponse(headers={"Content-Type": "multipart/x-mixed-replace;boundary=frame"})
        await resp.prepare(request)
        for _ in range(3):
            await resp.write(b"--frame\r\nContent-Type: image/png\r\n\r\n" + PNG_1PX + b"\r\n")
            await asyncio.sleep(0.05)
        return resp

    async def rest_calendar(self, request):
        self._auth(request)
        heute = datetime.now(UTC).replace(hour=16, minute=30, second=0, microsecond=0)
        return web.json_response(
            [
                {
                    "summary": "Zahnarzt",
                    "start": {"dateTime": heute.isoformat()},
                    "end": {"dateTime": (heute + timedelta(hours=1)).isoformat()},
                }
            ]
        )

    async def rest_logbook(self, request):
        self._auth(request)
        return web.json_response(
            [
                {
                    "when": _iso(datetime.now(UTC) - timedelta(minutes=5)),
                    "name": "Flur Deckenlampe",
                    "message": "eingeschaltet",
                    "entity_id": "light.flur_deckenlampe_flur",
                }
            ]
        )

    async def rest_service(self, request):
        self._auth(request)
        data = await request.json()
        self.service(request.match_info["domain"], request.match_info["service"], data)
        return web.json_response([])

    # ------------------------------------------------------------------ Zustände ändern
    def set_state(self, eid: str, state: str, **attrs) -> None:
        alt = copy.deepcopy(self.states.get(eid))
        neu = copy.deepcopy(alt) if alt else {"entity_id": eid, "attributes": {}}
        neu["state"] = state
        neu["attributes"].update(attrs)
        neu["last_changed"] = neu["last_updated"] = _iso(datetime.now(UTC))
        self.states[eid] = neu
        event = {"event_type": "state_changed", "data": {"entity_id": eid, "old_state": alt, "new_state": neu}}
        for ws, sid, typ in list(self.subs):
            if typ == "state_changed" and not ws.closed:
                self._tasks.add(asyncio.ensure_future(ws.send_json({"id": sid, "type": "event", "event": event})))

    def service(self, domain: str, service: str, data: dict) -> Any:
        self.calls.append((domain, service, data))
        event = {"event_type": "call_service", "data": {"domain": domain, "service": service, "service_data": data}}
        for ws, sid, typ in list(self.subs):
            if typ == "call_service" and not ws.closed:
                self._tasks.add(asyncio.ensure_future(ws.send_json({"id": sid, "type": "event", "event": event})))
        ids = data.get("entity_id") or []
        ids = [ids] if isinstance(ids, str) else ids
        for eid in ids:
            st = self.states.get(eid)
            if not st:
                continue
            if service == "toggle":
                self.set_state(eid, "off" if st["state"] == "on" else "on")
            elif service == "turn_on":
                attrs = {}
                if "brightness_pct" in data:
                    attrs["brightness"] = round(data["brightness_pct"] * 2.55)
                self.set_state(eid, "on", **attrs)
            elif service == "turn_off":
                self.set_state(eid, "off")
            elif domain == "lock" and service in ("lock", "unlock", "open"):
                self.set_state(eid, "locked" if service == "lock" else "unlocked")
        if domain == "weather" and service == "get_forecasts":
            heute = datetime.now(UTC)
            return {
                "weather.dwd_zuhause": {
                    "forecast": [
                        {
                            "datetime": _iso(heute + timedelta(days=i)),
                            "condition": c,
                            "temperature": t,
                            "templow": t - 7,
                            "precipitation_probability": p,
                        }
                        for i, (c, t, p) in enumerate(
                            [("rainy", 18, 70), ("partlycloudy", 19, 20), ("sunny", 21, 5), ("cloudy", 16, 40)]
                        )
                    ]
                }
            }
        return None

    # ------------------------------------------------------------------ WebSocket
    async def ws(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required"})
        msg = await ws.receive_json()
        if msg.get("access_token") != TOKEN:
            await ws.send_json({"type": "auth_invalid"})
            await ws.close()
            return ws
        await ws.send_json({"type": "auth_ok", "ha_version": "2026.9.3"})
        async for m in ws:
            if m.type != WSMsgType.TEXT:
                continue
            req = json.loads(m.data)
            await ws.send_json(self.ws_antwort(ws, req))
        self.subs = [s for s in self.subs if s[0] is not ws]
        return ws

    def ws_antwort(self, ws, req: dict) -> dict:
        typ, mid = req.get("type"), req.get("id")
        ok = lambda result: {"id": mid, "type": "result", "success": True, "result": result}  # noqa: E731
        if typ == "subscribe_events":
            self.subs.append((ws, mid, req.get("event_type")))
            return ok(None)
        if typ == "config/area_registry/list":
            return ok([{"area_id": a, "name": n, "icon": i, "floor_id": "eg"} for a, n, i in AREAS])
        if typ == "config/floor_registry/list":
            return ok([{"floor_id": "eg", "name": "Erdgeschoss", "level": 0}])
        if typ == "config/device_registry/list":
            return ok([])
        if typ == "config/entity_registry/list_for_display":
            ents = [
                {"ei": e, "ai": a, **({"pl": "music_assistant"} if e == "media_player.wohnung_3" else {})}
                for e, a in self.area_of.items()
            ]
            return ok({"entities": ents, "entity_categories": {}})
        if typ == "persistent_notification/subscribe":
            event = {"type": "current", "notifications": self.meldungen}
            loop = asyncio.get_running_loop()
            loop.call_soon(
                lambda: self._tasks.add(asyncio.ensure_future(ws.send_json({"id": mid, "type": "event", "event": event})))
            )
            return ok(None)
        if typ == "call_service":
            res = self.service(req["domain"], req["service"], req.get("service_data") or {})
            return ok({"context": {}, "response": res})
        if typ == "todo/item/list":
            return ok({"items": self.todo.get(req.get("entity_id"), [])})
        if typ == "history/history_during_period":
            eid = req["entity_ids"][0]
            start = datetime.fromisoformat(req["start_time"]).timestamp()
            return ok({eid: [{"s": str(round(300 + 120 * math.sin(i / 6), 1)), "lu": start + i * 1800} for i in range(48)]})
        return {
            "id": mid,
            "type": "result",
            "success": False,
            "error": {"code": "unknown_command", "message": f"Unbekannt: {typ}"},
        }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8123)
    args = ap.parse_args()
    web.run_app(FakeHA().app, port=args.port)


if __name__ == "__main__":
    main()
