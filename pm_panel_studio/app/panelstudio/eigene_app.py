"""Startseite für das PM Dashboard als eigene App: legt sie unter ``/homeassistant/www/pm-dashboard`` ab, Home Assistant
liefert sie dann als ``/local/pm-dashboard/index.html`` aus (gleiche Herkunft wie das Frontend, daher Anmeldung und Ingress
wie dort). Die Seite enthält keine Geheimnisse; die Anmeldedaten bleiben im Browser.
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

_LOGGER = logging.getLogger(__name__)

QUELLE = Path(__file__).parent / "static" / "app-start"
ICON = Path(__file__).parent / "static" / "img" / "icon_lavender.svg"
ZIEL = Path("/homeassistant/www/pm-dashboard")


def eigener_slug() -> str:
    """Kennung der App aus dem Hostnamen (Supervisor: ``1150666e-pm-panel-studio``)."""
    return os.environ.get("HOSTNAME", "").strip().replace("-", "_")


def installieren(ziel: Path = ZIEL, slug: str | None = None) -> bool:
    """Startseite schreiben, nur geänderte Dateien. False, wenn die Konfiguration nicht eingehängt ist."""
    if not ziel.parent.parent.is_dir():
        return False
    neu_www = not ziel.parent.is_dir()
    ziel.mkdir(parents=True, exist_ok=True)
    slug = slug if slug is not None else eigener_slug()
    for name in ("index.html", "launcher.js", "manifest.webmanifest"):
        text = (QUELLE / name).read_text(encoding="utf-8").replace("__SLUG__", slug)
        datei = ziel / name
        if not datei.exists() or datei.read_text(encoding="utf-8") != text:
            datei.write_text(text, encoding="utf-8")
    if ICON.is_file() and (not (ziel / "icon.svg").exists() or (ziel / "icon.svg").read_bytes() != ICON.read_bytes()):
        shutil.copyfile(ICON, ziel / "icon.svg")
    if neu_www:
        _LOGGER.warning("Ordner www neu angelegt: /local/pm-dashboard/ steht erst nach einem Neustart von Home Assistant bereit")
    return True
