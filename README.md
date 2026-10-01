# PM Networks Ultimate Dashboard

Home-Assistant-App **PM Panel Studio** für das Wandpanel im Flur (Surface Go 2). Aufbau und Installation wie
PM Klima Studio. Konzept: [`docs/konzept.html`](docs/konzept.html).

## Installation

1. Home Assistant → Einstellungen → Apps → App-Store → ⋮ → Repositories → diese Repository-Adresse hinzufügen.
2. „PM Panel Studio“ installieren und starten. Optionen prüfen (Bewegungsmelder, Personen, Kamera, Türöffner).
3. In der Seitenleiste „Panel Studio“ öffnen, die Panel-Adresse kopieren und einmal auf dem Surface öffnen.

Das Repository ist privat. Der App-Store von Home Assistant lädt Repositories ohne Anmeldung. Entweder das Repository
öffentlich schalten oder die Adresse mit einem GitHub-Token (nur Leserecht) eintragen:
`https://<Benutzer>:<Token>@github.com/D0GC/pm-networks-ultimate-dashboard`.

## Aufbau

| Pfad | Inhalt |
|------|--------|
| `pm_panel_studio/` | App (Dockerfile, `config.yaml`, s6-Dienst) |
| `pm_panel_studio/app/panelstudio/` | Python-Backend (aiohttp): HA-Anbindung, Hub, Karten-Engine, Server |
| `pm_panel_studio/app/panelstudio/static/` | Panel-Oberfläche und Editor (ohne Build-Schritt) |
| `tests/` | Tests mit nachgebautem Home Assistant (`fake_ha.py`) |
| `tools/dev_server.py` | Vorschau ohne Home Assistant: Editor `http://127.0.0.1:8099/`, Panel `…/panel` |

## Entwicklung

```sh
pip install aiohttp==3.13.3 pytest pytest-aiohttp ruff
ruff check . && ruff format --check . && pytest -q
python tools/dev_server.py
```
