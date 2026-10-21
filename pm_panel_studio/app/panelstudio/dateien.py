"""Dateimanager der Admin-Ansicht: Ordner der Home-Assistant-Installation ansehen, Dateien hoch- und herunterladen,
Textdateien bearbeiten, umbenennen, löschen.

Nur über Ingress erreichbar (Admin-Eintrag in der Seitenleiste), nie über den Panel-Port. Zusätzlich prüft jede
Anfrage den angemeldeten Benutzer (Kopfzeile ``X-Remote-User-Id`` von Supervisor): nur Administratoren von Home
Assistant. Ändernde Anfragen brauchen die Kopfzeile ``X-PMPS-Aktion`` (fremde Seiten können sie ohne Rückfrage des
Browsers nicht setzen). Pfade haben die Form
``<wurzel>/<relativer/pfad>``; jede Wurzel ist ein von Supervisor eingehängter Ordner (siehe ``map`` in config.yaml).
Nach dem Auflösen von ``..`` und Verknüpfungen muss ein Pfad in seiner Wurzel liegen, sonst wird er abgewiesen.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import mimetypes
import os
import shutil
import stat
import tempfile
import time
import zipfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aiohttp import web

_LOGGER = logging.getLogger(__name__)

TEXT_MAX = 2 * 1024 * 1024  # größere Dateien nur herunterladen, nicht im Editor öffnen
NAME_VERBOTEN = set('/\\:*?"<>|\0')


@dataclass(frozen=True)
class Wurzel:
    name: str
    titel: str
    pfad: Path
    schreiben: bool


def _wurzeln() -> dict[str, Wurzel]:
    basis = os.environ.get("PMPS_DATEI_BASIS", "")  # nur für Tests: alle Wurzeln unter einem Ordner
    roh = [
        ("config", "Home Assistant", "/homeassistant", True),
        ("share", "Freigabe (share)", "/share", True),
        ("media", "Medien", "/media", True),
        ("addon_configs", "App-Konfigurationen", "/addon_configs", True),
        ("ssl", "Zertifikate (ssl)", "/ssl", True),
        ("backup", "Sicherungen", "/backup", True),
    ]
    return {n: Wurzel(n, t, Path(basis + p) if basis else Path(p), w) for n, t, p, w in roh}


WURZELN = _wurzeln()


class PfadFehler(web.HTTPBadRequest):
    pass


def aufloesen(pfad: str, *, schreiben: bool = False) -> tuple[Wurzel, Path]:
    """``config/x/y.yaml`` → (Wurzel, absoluter Pfad); prüft, dass der Pfad in der Wurzel bleibt."""
    teile = [t for t in str(pfad or "").replace("\\", "/").split("/") if t not in ("", ".")]
    if not teile or teile[0] not in WURZELN:
        raise PfadFehler(text="Unbekannter Ordner")
    w = WURZELN[teile[0]]
    if not w.pfad.is_dir():
        raise web.HTTPNotFound(text=f"{w.titel} ist nicht eingehängt")
    if any(t == ".." for t in teile):
        raise PfadFehler(text="Pfad verlässt den Ordner")
    basis = w.pfad.resolve()
    ziel = basis.joinpath(*teile[1:])
    # Verknüpfungen auflösen; der Elternordner muss existieren und in der Wurzel liegen
    echt = ziel.resolve() if ziel.exists() or ziel.is_symlink() else ziel.parent.resolve() / ziel.name
    if echt != basis and not echt.is_relative_to(basis):
        raise PfadFehler(text="Pfad verlässt den Ordner")
    if schreiben and not w.schreiben:
        raise web.HTTPForbidden(text=f"{w.titel} ist schreibgeschützt")
    return w, echt


def _name_ok(name: str) -> str:
    name = str(name or "").strip()
    if not name or name in (".", "..") or any(c in NAME_VERBOTEN for c in name) or len(name) > 255:
        raise PfadFehler(text="Ungültiger Name")
    return name


def _eintrag(p: Path) -> dict[str, Any] | None:
    try:
        st = p.lstat()
    except OSError:
        return None
    ordner = stat.S_ISDIR(st.st_mode) or (stat.S_ISLNK(st.st_mode) and p.is_dir())
    return {"name": p.name, "ordner": ordner, "groesse": None if ordner else st.st_size, "geaendert": int(st.st_mtime)}


def liste(pfad: str) -> dict[str, Any]:
    if not str(pfad or "").strip("/"):
        return {
            "pfad": "",
            "eintraege": [
                {"name": w.name, "titel": w.titel, "ordner": True, "schreibgeschuetzt": not w.schreiben}
                for w in WURZELN.values()
                if w.pfad.is_dir()
            ],
        }
    w, p = aufloesen(pfad)
    if not p.is_dir():
        raise web.HTTPNotFound(text="Ordner nicht gefunden")
    eintraege = [e for e in (_eintrag(c) for c in p.iterdir()) if e]
    eintraege.sort(key=lambda e: (not e["ordner"], e["name"].lower()))
    return {"pfad": pfad.strip("/"), "eintraege": eintraege, "schreibgeschuetzt": not w.schreiben}


def text_lesen(pfad: str) -> dict[str, Any]:
    _w, p = aufloesen(pfad)
    if not p.is_file():
        raise web.HTTPNotFound(text="Datei nicht gefunden")
    if p.stat().st_size > TEXT_MAX:
        raise web.HTTPRequestEntityTooLarge(max_size=TEXT_MAX, actual_size=p.stat().st_size, text="Datei zu groß für den Editor")
    roh = p.read_bytes()
    if b"\0" in roh[:8192]:
        raise web.HTTPUnsupportedMediaType(text="Keine Textdatei")
    try:
        text = roh.decode("utf-8")
    except UnicodeDecodeError as err:
        raise web.HTTPUnsupportedMediaType(text="Keine UTF-8-Textdatei") from err
    return {"pfad": pfad, "text": text, "geaendert": int(p.stat().st_mtime)}


def text_speichern(pfad: str, text: str, geaendert: int | None) -> dict[str, Any]:
    _w, p = aufloesen(pfad, schreiben=True)
    if p.is_dir():
        raise PfadFehler(text="Ist ein Ordner")
    # Hat jemand anderes die Datei inzwischen geändert, nicht überschreiben
    if geaendert is not None and p.exists() and int(p.stat().st_mtime) != int(geaendert):
        raise web.HTTPConflict(text="Die Datei wurde inzwischen geändert. Bitte neu laden.")
    daten = str(text).encode("utf-8")
    if len(daten) > TEXT_MAX:
        raise web.HTTPRequestEntityTooLarge(max_size=TEXT_MAX, actual_size=len(daten))
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=f".{p.name}.")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(daten)
        if p.exists():
            with contextlib.suppress(OSError):
                shutil.copymode(p, tmp)
        os.replace(tmp, p)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    _LOGGER.info("Datei gespeichert: %s", pfad)
    return {"pfad": pfad, "geaendert": int(p.stat().st_mtime)}


def ordner_anlegen(pfad: str, name: str) -> None:
    _w, p = aufloesen(pfad, schreiben=True)
    (p / _name_ok(name)).mkdir()
    _LOGGER.info("Ordner angelegt: %s/%s", pfad, name)


def umbenennen(pfad: str, neu: str) -> str:
    w, p = aufloesen(pfad, schreiben=True)
    if p == w.pfad.resolve():
        raise PfadFehler(text="Wurzelordner lässt sich nicht umbenennen")
    ziel = p.with_name(_name_ok(neu))
    if ziel.exists():
        raise web.HTTPConflict(text="Name bereits vergeben")
    p.rename(ziel)
    _LOGGER.info("Umbenannt: %s → %s", pfad, neu)
    return str(Path(pfad).with_name(ziel.name))


def loeschen(pfad: str) -> None:
    w, p = aufloesen(pfad, schreiben=True)
    if p == w.pfad.resolve():
        raise PfadFehler(text="Wurzelordner lässt sich nicht löschen")
    if p.is_dir() and not p.is_symlink():
        shutil.rmtree(p)
    else:
        p.unlink()
    _LOGGER.info("Gelöscht: %s", pfad)


def _zip_bauen(quelle: Path) -> str:
    fd, tmp = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        for wurzel, _ordner, dateien in os.walk(quelle):
            for d in dateien:
                p = Path(wurzel) / d
                with contextlib.suppress(OSError):
                    z.write(p, Path(quelle.name) / p.relative_to(quelle))
    return tmp


# ------------------------------------------------------------------ HTTP


async def _json(request: web.Request) -> dict[str, Any]:
    try:
        d = await request.json()
    except ValueError as err:
        raise web.HTTPBadRequest(text="JSON erwartet") from err
    if not isinstance(d, dict):
        raise web.HTTPBadRequest(text="Objekt erwartet")
    return d


def _os_fehler(err: OSError) -> web.HTTPException:
    return web.HTTPBadRequest(text=f"{err.strerror or err}")


async def api_liste(request: web.Request) -> web.Response:
    try:
        return web.json_response(await asyncio.to_thread(liste, request.query.get("pfad", "")))
    except OSError as err:
        raise _os_fehler(err) from err


async def api_text(request: web.Request) -> web.Response:
    return web.json_response(await asyncio.to_thread(text_lesen, request.query.get("pfad", "")))


async def api_speichern(request: web.Request) -> web.Response:
    d = await _json(request)
    try:
        g = d.get("geaendert")
        return web.json_response(
            await asyncio.to_thread(text_speichern, str(d.get("pfad", "")), str(d.get("text", "")), int(g) if g else None)
        )
    except OSError as err:
        raise _os_fehler(err) from err


async def api_aktion(request: web.Request) -> web.Response:
    d = await _json(request)
    art, pfad = d.get("art"), str(d.get("pfad", ""))
    try:
        if art == "ordner":
            await asyncio.to_thread(ordner_anlegen, pfad, str(d.get("name", "")))
        elif art == "datei":
            ziel = f"{pfad.rstrip('/')}/{_name_ok(str(d.get('name', '')))}"
            if aufloesen(ziel)[1].exists():
                raise web.HTTPConflict(text="Name bereits vergeben")
            await asyncio.to_thread(text_speichern, ziel, "", None)
        elif art == "umbenennen":
            return web.json_response({"pfad": await asyncio.to_thread(umbenennen, pfad, str(d.get("name", "")))})
        elif art == "loeschen":
            await asyncio.to_thread(loeschen, pfad)
        else:
            raise web.HTTPBadRequest(text="Unbekannte Aktion")
    except FileExistsError as err:
        raise web.HTTPConflict(text="Name bereits vergeben") from err
    except OSError as err:
        raise _os_fehler(err) from err
    return web.json_response({"ok": True})


async def api_laden(request: web.Request) -> web.StreamResponse:
    """Datei herunterladen; ein Ordner kommt als ZIP."""
    pfad = request.query.get("pfad", "")
    _w, p = aufloesen(pfad)
    if p.is_dir():
        tmp = await asyncio.to_thread(_zip_bauen, p)
        try:
            resp = web.StreamResponse(
                headers={"Content-Type": "application/zip", "Content-Disposition": _anhang(p.name + ".zip")}
            )
            await resp.prepare(request)
            with open(tmp, "rb") as f:  # noqa: ASYNC230 - kleine Blöcke, blockiert nicht nennenswert
                while block := f.read(256 * 1024):
                    await resp.write(block)
            await resp.write_eof()
            return resp
        finally:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
    if not p.is_file():
        raise web.HTTPNotFound(text="Datei nicht gefunden")
    resp = web.FileResponse(p)
    art = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    resp.content_type = art
    if request.query.get("ansehen") != "1":
        resp.headers["Content-Disposition"] = _anhang(p.name)
    return resp


def _anhang(name: str) -> str:
    from urllib.parse import quote

    sicher = "".join(c if c.isascii() and c.isprintable() and c not in '"\\' else "_" for c in name)
    return f"attachment; filename=\"{sicher}\"; filename*=UTF-8''{quote(name)}"


async def api_hochladen(request: web.Request) -> web.Response:
    """Mehrteiliges Formular, Felder ``datei``; schreibt blockweise (auch große Dateien ohne Speicherspitze)."""
    pfad = request.query.get("pfad", "")
    _w, ordner = aufloesen(pfad, schreiben=True)
    if not ordner.is_dir():
        raise web.HTTPNotFound(text="Ordner nicht gefunden")
    ueberschreiben = request.query.get("ueberschreiben") == "1"
    reader = await request.multipart()
    gespeichert = []
    while (teil := await reader.next()) is not None:
        if getattr(teil, "name", None) != "datei" or not getattr(teil, "filename", None):
            continue
        name = _name_ok(Path(str(teil.filename).replace("\\", "/")).name)
        ziel = ordner / name
        if ziel.exists() and not ueberschreiben:
            raise web.HTTPConflict(text=f"{name} existiert bereits")
        fd, tmp = tempfile.mkstemp(dir=ordner, prefix=f".{name}.")
        try:
            with os.fdopen(fd, "wb") as f:
                while block := await teil.read_chunk(256 * 1024):
                    f.write(block)
            os.replace(tmp, ziel)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise
        gespeichert.append(name)
        _LOGGER.info("Hochgeladen: %s/%s", pfad, name)
    return web.json_response({"dateien": gespeichert})


class AdminPruefung:
    """Ist der Benutzer hinter einer Ingress-Anfrage Administrator in Home Assistant? Ergebnis 60 s zwischengespeichert."""

    def __init__(self, benutzer_laden: Callable[[], Awaitable[list[dict[str, Any]]]]) -> None:
        self._laden = benutzer_laden
        self._cache: dict[str, tuple[float, bool]] = {}

    async def __call__(self, request: web.Request) -> bool:
        uid = request.headers.get("X-Remote-User-Id", "")
        if not uid:
            return False
        jetzt = time.monotonic()
        treffer = self._cache.get(uid)
        if treffer and jetzt - treffer[0] < 60:
            return treffer[1]
        try:
            benutzer = await self._laden()
        except Exception as err:
            _LOGGER.warning("Dateien: Benutzer nicht prüfbar: %s", err)
            return False
        admin = any(
            b.get("id") == uid and b.get("is_active", True) and "system-admin" in (b.get("group_ids") or []) for b in benutzer
        )
        self._cache[uid] = (jetzt, admin)
        return admin


def routen(app: web.Application, ist_admin: Callable[[web.Request], Awaitable[bool]]) -> None:
    def geschuetzt(handler, aendernd: bool):
        async def h(request: web.Request) -> web.StreamResponse:
            if not await ist_admin(request):
                _LOGGER.warning(
                    "Dateien: Zugriff ohne Administratorrechte abgewiesen (%s)", request.headers.get("X-Remote-User-Name", "?")
                )
                raise web.HTTPForbidden(text="Nur für Administratoren.")
            if aendernd and request.headers.get("X-PMPS-Aktion") != "1":
                raise web.HTTPForbidden(text="Kopfzeile X-PMPS-Aktion fehlt.")
            return await handler(request)

        return h

    app.router.add_get("/api/dateien/liste", geschuetzt(api_liste, False))
    app.router.add_get("/api/dateien/text", geschuetzt(api_text, False))
    app.router.add_get("/api/dateien/laden", geschuetzt(api_laden, False))
    app.router.add_post("/api/dateien/speichern", geschuetzt(api_speichern, True))
    app.router.add_post("/api/dateien/aktion", geschuetzt(api_aktion, True))
    app.router.add_post("/api/dateien/hochladen", geschuetzt(api_hochladen, True))
