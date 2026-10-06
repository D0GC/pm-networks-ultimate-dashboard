"""Erzeugt icon.png (128x128) und logo.png (250x100) für PM Panel Studio im Stil „Twilight Edition“.

Motiv: Wandpanel mit Ringtimer (wie die rotierenden Karten), angelehnt an die Bilder von PM Klima Studio.
Aufruf: python tools/make_images.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "pm_panel_studio"
FONTS = APP / "app" / "panelstudio" / "static" / "fonts"
sys.path.insert(0, str(ROOT / "tools"))
from twilight_bg import twilight_bg

LAVENDER = (197, 192, 211, 255)
CLOUD = (236, 235, 242, 255)
AKZENT = (184, 133, 214, 255)
RING = (240, 150, 76, 255)
SPUR = (236, 235, 242, 60)


def panel(bild: Image.Image, x: float, y: float, s: float) -> None:
    """Wandpanel (Querformat) mit Ringtimer links und zwei Textzeilen rechts; Breite ~ s."""
    lage = Image.new("RGBA", bild.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lage)
    w, h = s, s * 0.72
    rand = max(2, int(s * 0.04))
    d.rounded_rectangle([x, y, x + w, y + h], radius=s * 0.11, outline=CLOUD, width=rand)
    # Ring: Spur und Fortschritt (drei Viertel)
    r = h * 0.27
    cx, cy = x + w * 0.33, y + h * 0.5
    staerke = max(2, int(s * 0.055))
    box = [cx - r, cy - r, cx + r, cy + r]
    d.arc(box, 0, 360, fill=SPUR, width=staerke)
    d.arc(box, -90, 180, fill=RING, width=staerke)
    # Zeilen rechts
    lx = x + w * 0.62
    for i, (breite, farbe) in enumerate(((0.26, CLOUD), (0.18, AKZENT), (0.22, LAVENDER))):
        ly = y + h * (0.33 + i * 0.16)
        d.rounded_rectangle([lx, ly, lx + w * breite, ly + staerke * 0.9], radius=staerke, fill=farbe)
    # Standfuß-Andeutung: Wandhalter
    d.rounded_rectangle([x + w * 0.42, y + h + rand * 1.6, x + w * 0.58, y + h + rand * 2.8], radius=rand, fill=LAVENDER)
    bild.alpha_composite(lage)


def maske(size: tuple[int, int], radius: int) -> Image.Image:
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def icon(pfad: Path) -> None:
    n = 512
    bg = twilight_bg(n, n).convert("RGBA")
    panel(bg, n * 0.14, n * 0.22, n * 0.72)
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    out.paste(bg, (0, 0), maske((n, n), int(n * 0.22)))
    out.resize((128, 128), Image.LANCZOS).save(pfad, optimize=True)


def logo(pfad: Path) -> None:
    w, h = 1000, 400
    bg = twilight_bg(w, h).convert("RGBA")
    panel(bg, 50, 110, 220)
    d = ImageDraw.Draw(bg)
    klein = ImageFont.truetype(str(FONTS / "Montserrat-SemiBold.woff2"), 38)
    gross = ImageFont.truetype(str(FONTS / "Montserrat-Bold.woff2"), 90)
    d.text((310, 120), "P M   N E T W O R K S", font=klein, fill=AKZENT)
    d.text((306, 178), "Panel Studio", font=gross, fill=CLOUD)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(bg, (0, 0), maske((w, h), 60))
    out.resize((250, 100), Image.LANCZOS).save(pfad, optimize=True)


if __name__ == "__main__":
    icon(APP / "icon.png")
    logo(APP / "logo.png")
    print("icon.png und logo.png erstellt")
