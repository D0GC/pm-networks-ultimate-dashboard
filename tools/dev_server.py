"""Vorschau ohne Home Assistant: startet das Test-HA (tests/fake_ha.py) und PM Panel Studio lokal.

python tools/dev_server.py            Ingress/Editor http://127.0.0.1:8099/, Panel http://127.0.0.1:8099/panel
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "pm_panel_studio" / "app"), str(ROOT / "tests")]

import aiohttp
from aiohttp import web

from fake_ha import TOKEN, FakeHA
from panelstudio.config import EinstellungsSpeicher, Options
from panelstudio.ha_client import HAClient
from panelstudio.hub import Hub
from panelstudio.server import create_ingress_app, create_panel_app


async def main() -> None:
    fake = FakeHA()
    r = web.AppRunner(fake.app)
    await r.setup()
    await web.TCPSite(r, "127.0.0.1", 8765).start()
    daten = Path(os.environ.get("PMPS_DATA_DIR") or tempfile.mkdtemp())
    async with aiohttp.ClientSession() as s:
        client = HAClient(s, api_url="http://127.0.0.1:8765/core/api", ws_url="ws://127.0.0.1:8765/core/websocket", token=TOKEN)
        hub = Hub(Options(), client, EinstellungsSpeicher(daten))
        token = ["vorschau-schluessel-0000000000"]
        lokal = [ipaddress.ip_network("127.0.0.0/8")]
        for app, port in ((create_ingress_app(hub, token, lokal), 8099), (create_panel_app(hub, token), 8098)):
            run = web.AppRunner(app)
            await run.setup()
            await web.TCPSite(run, "127.0.0.1", port).start()
        hub.start()
        print("Editor http://127.0.0.1:8099/  Panel http://127.0.0.1:8099/panel", flush=True)
        await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
