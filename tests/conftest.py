"""Gemeinsame Fixtures: Fake-HA, HA-Client, Hub und beide App-Varianten."""

from __future__ import annotations

import asyncio
import ipaddress
import sys
from pathlib import Path

import aiohttp
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pm_panel_studio" / "app"))
sys.path.insert(0, str(Path(__file__).parent))

from fake_ha import TOKEN, FakeHA  # noqa: E402
from panelstudio.config import EinstellungsSpeicher, Options  # noqa: E402
from panelstudio.ha_client import HAClient  # noqa: E402
from panelstudio.hub import Hub  # noqa: E402
from panelstudio.server import create_ingress_app, create_panel_app  # noqa: E402

LOCAL = [ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("::1/128")]


@pytest.fixture
def fake() -> FakeHA:
    return FakeHA()


@pytest.fixture
async def hub(aiohttp_server, fake, tmp_path):
    server = await aiohttp_server(fake.app)
    async with aiohttp.ClientSession() as session:
        base = f"http://{server.host}:{server.port}/core"
        client = HAClient(session, api_url=f"{base}/api", ws_url=f"ws://{server.host}:{server.port}/core/websocket", token=TOKEN)
        h = Hub(Options(), client, EinstellungsSpeicher(tmp_path))
        h.start()
        for _ in range(100):
            if h.verbunden:
                break
            await asyncio.sleep(0.05)
        assert h.verbunden
        yield h
        await h.stop()
        await client.close()


@pytest.fixture
def token() -> list[str]:
    return ["geheimer-zugangsschluessel-123456"]


@pytest.fixture
async def ingress(aiohttp_client, hub, token):
    return await aiohttp_client(create_ingress_app(hub, token, LOCAL))


@pytest.fixture
async def panel(aiohttp_client, hub, token):
    return await aiohttp_client(create_panel_app(hub, token))
