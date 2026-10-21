import io
import zipfile

import aiohttp
import pytest
from aiohttp import web

from panelstudio import dateien

ADMIN = {"X-Remote-User-Id": "admin1", "X-Remote-User-Name": "dominik"}
AKTION = {**ADMIN, "X-PMPS-Aktion": "1"}


@pytest.fixture
async def dm(tmp_path, monkeypatch, aiohttp_client):
    wurzeln = {}
    for name, schreiben in (("config", True), ("backup", True), ("nur", False)):
        (tmp_path / name).mkdir()
        wurzeln[name] = dateien.Wurzel(name, name.title(), tmp_path / name, schreiben)
    monkeypatch.setattr(dateien, "WURZELN", wurzeln)
    (tmp_path / "config" / "configuration.yaml").write_text("homeassistant:\n", encoding="utf-8")
    (tmp_path / "geheim.txt").write_text("nicht erreichbar")
    aufrufe = []

    async def benutzer():
        aufrufe.append(1)
        return [
            {"id": "admin1", "is_active": True, "group_ids": ["system-admin"]},
            {"id": "gast", "is_active": True, "group_ids": ["system-users"]},
        ]

    app = web.Application()
    dateien.routen(app, dateien.AdminPruefung(benutzer))
    c = await aiohttp_client(app)
    c.aufrufe = aufrufe
    c.basis = tmp_path
    return c


async def test_nur_administratoren(dm):
    assert (await dm.get("/api/dateien/liste?pfad=config")).status == 403
    assert (await dm.get("/api/dateien/liste?pfad=config", headers={"X-Remote-User-Id": "gast"})).status == 403
    r = await dm.get("/api/dateien/liste?pfad=config", headers=ADMIN)
    assert r.status == 200 and [e["name"] for e in (await r.json())["eintraege"]] == ["configuration.yaml"]
    await dm.get("/api/dateien/liste?pfad=config", headers=ADMIN)
    assert len(dm.aufrufe) == 2  # je einmal für gast und admin (dann zwischengespeichert), ohne Kopfzeile gar nicht
    # Ändernde Anfragen nur mit eigener Kopfzeile (Schutz gegen fremde Seiten)
    r = await dm.post("/api/dateien/aktion", json={"art": "ordner", "pfad": "config", "name": "x"}, headers=ADMIN)
    assert r.status == 403


async def test_wurzeln_und_pfade_bleiben_drin(dm):
    d = await (await dm.get("/api/dateien/liste?pfad=", headers=ADMIN)).json()
    assert {e["name"] for e in d["eintraege"]} == {"config", "backup", "nur"}
    for falsch in ("config/../geheim.txt", "../geheim.txt", "gibtsnicht/x", "config/../../etc/passwd"):
        r = await dm.get("/api/dateien/text?pfad=" + falsch, headers=ADMIN)
        assert r.status in (400, 404), falsch
    # Verknüpfung nach draußen wird abgewiesen
    (dm.basis / "config" / "link").symlink_to(dm.basis / "geheim.txt")
    assert (await dm.get("/api/dateien/text?pfad=config/link", headers=ADMIN)).status == 400


async def test_bearbeiten_mit_konfliktschutz(dm):
    d = await (await dm.get("/api/dateien/text?pfad=config/configuration.yaml", headers=ADMIN)).json()
    assert d["text"] == "homeassistant:\n"
    r = await dm.post(
        "/api/dateien/speichern",
        json={"pfad": "config/configuration.yaml", "text": "neu\n", "geaendert": d["geaendert"]},
        headers=AKTION,
    )
    assert r.status == 200
    assert (dm.basis / "config" / "configuration.yaml").read_text() == "neu\n"
    r = await dm.post(
        "/api/dateien/speichern", json={"pfad": "config/configuration.yaml", "text": "alt", "geaendert": 1}, headers=AKTION
    )
    assert r.status == 409
    assert (await dm.post("/api/dateien/speichern", json={"pfad": "nur/x.txt", "text": "x"}, headers=AKTION)).status == 403


async def test_hochladen_herunterladen_umbenennen_loeschen(dm):
    form = aiohttp.FormData()
    form.add_field("datei", io.BytesIO(b"\x00\x01binaer"), filename="bild.bin")
    r = await dm.post("/api/dateien/hochladen?pfad=backup", data=form, headers=AKTION)
    assert (await r.json())["dateien"] == ["bild.bin"]
    r = await dm.get("/api/dateien/laden?pfad=backup/bild.bin", headers=ADMIN)
    assert await r.read() == b"\x00\x01binaer" and "attachment" in r.headers["Content-Disposition"]
    assert (await dm.get("/api/dateien/text?pfad=backup/bild.bin", headers=ADMIN)).status == 415
    # Ordner als ZIP
    r = await dm.post("/api/dateien/aktion", json={"art": "ordner", "pfad": "config", "name": "pakete"}, headers=AKTION)
    assert r.status == 200
    r = await dm.post("/api/dateien/aktion", json={"art": "datei", "pfad": "config/pakete", "name": "a.yaml"}, headers=AKTION)
    assert r.status == 200
    z = zipfile.ZipFile(io.BytesIO(await (await dm.get("/api/dateien/laden?pfad=config/pakete", headers=ADMIN)).read()))
    assert z.namelist() == ["pakete/a.yaml"]
    r = await dm.post(
        "/api/dateien/aktion", json={"art": "umbenennen", "pfad": "config/pakete/a.yaml", "name": "b.yaml"}, headers=AKTION
    )
    assert (await r.json())["pfad"] == "config/pakete/b.yaml"
    assert (
        await dm.post(
            "/api/dateien/aktion", json={"art": "umbenennen", "pfad": "config/pakete/b.yaml", "name": "../x"}, headers=AKTION
        )
    ).status == 400
    assert (await dm.post("/api/dateien/aktion", json={"art": "loeschen", "pfad": "config"}, headers=AKTION)).status == 400
    assert (await dm.post("/api/dateien/aktion", json={"art": "loeschen", "pfad": "config/pakete"}, headers=AKTION)).status == 200
    assert not (dm.basis / "config" / "pakete").exists()


def test_eigene_app_ablegen(tmp_path):
    from panelstudio import eigene_app

    assert eigene_app.installieren(tmp_path / "fehlt" / "www" / "pm-dashboard", "x") is False
    (tmp_path / "homeassistant").mkdir()
    ziel = tmp_path / "homeassistant" / "www" / "pm-dashboard"
    assert eigene_app.installieren(ziel, "1150666e_pm_panel_studio")
    js = (ziel / "launcher.js").read_text(encoding="utf-8")
    assert 'const SLUG = "1150666e_pm_panel_studio";' in js and "__SLUG__" not in js
    assert {p.name for p in ziel.iterdir()} == {"index.html", "launcher.js", "manifest.webmanifest", "icon.svg"}
    assert eigene_app.installieren(ziel, "1150666e_pm_panel_studio")  # zweiter Lauf ändert nichts
