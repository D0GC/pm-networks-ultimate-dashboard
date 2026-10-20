"""Türdienst an der Haustür: Klänge, Spracherkennung und der ganze Ablauf gegen eine nachgebaute Ring Intercom."""

import asyncio
import fractions
import math
import time
import wave
from io import BytesIO
from types import SimpleNamespace

import pytest

from panelstudio import pforte as pf


def test_abendglocke_schleife():
    pcm = pf.abendglocke()
    sek = len(pcm) / 2 / pf.RATE
    assert 6.5 < sek < 6.8  # 16 Achtel bei 72 bpm
    assert pf.pegel(pcm) > 1000
    # Übergang Ende → Anfang ohne Sprung (der Nachklang ist an den Anfang gefaltet)
    import array

    a = array.array("h")
    a.frombytes(pcm)
    assert abs(a[-1] - a[0]) < 6000


def test_stimmerkennung():
    s = pf.Stimmerkennung(ende_nach_s=1.0, nichts_nach_s=2.0)
    for _ in range(50):
        s.rahmen(100)
    assert not s.fertig
    for _ in range(60):  # 1,2 s Sprache
        s.rahmen(5000)
    assert s.hat_gesprochen and not s.fertig
    for _ in range(55):  # 1,1 s Stille
        s.rahmen(100)
    assert s.fertig
    leer = pf.Stimmerkennung(ende_nach_s=1.0, nichts_nach_s=2.0)
    for _ in range(101):
        leer.rahmen(80)
    assert leer.fertig and not leer.hat_gesprochen


def _ton_wav(sek: float, f: float = 440.0) -> bytes:
    n = int(sek * 16000)
    werte = [0.5 * math.sin(2 * math.pi * f * i / 16000) for i in range(n)]
    return pf.wav(pf._pcm(werte, 1.0))


def test_dekodieren_wav():
    pytest.importorskip("av")
    pcm = pf.dekodieren(_ton_wav(0.5))
    assert abs(len(pcm) / 2 / 16000 - 0.5) < 0.05


# ------------------------------------------------------------------ Ablauf mit nachgebauter Ring Intercom


class Besucher:
    """Spur der Gegenstelle: Stille, ab ``ab_s`` für ``dauer_s`` ein Ton (der Besucher spricht)."""

    def __init__(self, ab_s: float, dauer_s: float) -> None:
        from aiortc.mediastreams import MediaStreamTrack

        aussen = self

        class Spur(MediaStreamTrack):
            kind = "audio"

            def __init__(self) -> None:
                super().__init__()
                self.pts = 0
                self.start = None

            async def recv(self):
                import av

                if self.start is None:
                    self.start = time.monotonic()
                warten = self.start + self.pts / 16000 - time.monotonic()
                if warten > 0:
                    await asyncio.sleep(warten)
                t = self.pts / 16000
                spricht = aussen.ab_s <= t < aussen.ab_s + aussen.dauer_s
                werte = [0.4 * math.sin(2 * math.pi * 300 * (self.pts + i) / 16000) if spricht else 0.0 for i in range(320)]
                f = av.AudioFrame(format="s16", layout="mono", samples=320)
                f.planes[0].update(pf._pcm(werte, 1.0))
                f.sample_rate = 16000
                f.pts = self.pts
                f.time_base = fractions.Fraction(1, 16000)
                self.pts += 320
                return f

        self.ab_s, self.dauer_s = ab_s, dauer_s
        self.spur = Spur()


class Ring:
    """Nachgebauter Home-Assistant-Client mit pm_ring_intercom als zweiter aiortc-Gegenstelle."""

    def __init__(self, besucher: Besucher, schliessen_nach: float | None = None) -> None:
        self.besucher = besucher
        self.schliessen_nach = schliessen_nach
        self.pc = None
        self.empfangen = 0  # hörbare Rahmen, die beim Besucher ankommen
        self.dienste: list[tuple[str, str, dict]] = []
        self.stt: list[bytes] = []
        self.ereignisse: list[dict] = []
        self.beendet = False

    async def subscribe(self, payload, cb):
        from aiortc import RTCPeerConnection, RTCSessionDescription

        assert payload["type"] == "pm_ring_intercom/audio/start"
        self.pc = RTCPeerConnection()
        self.pc.addTrack(self.besucher.spur)

        @self.pc.on("track")
        def _spur(track):
            async def lesen():
                while True:
                    try:
                        f = await track.recv()
                    except Exception:
                        return
                    if pf.pegel(bytes(f.planes[0])[: f.samples * 2 * len(f.layout.channels)]) > 300:
                        self.empfangen += 1

            asyncio.get_running_loop().create_task(lesen())

        cb({"type": "session", "session_id": "s1"})
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=payload["offer"], type="offer"))
        await self.pc.setLocalDescription(await self.pc.createAnswer())
        cb({"type": "answer", "answer": self.pc.localDescription.sdp})
        if self.schliessen_nach is not None:

            async def spaeter():
                await asyncio.sleep(self.schliessen_nach)
                cb({"type": "closed"})

            asyncio.get_running_loop().create_task(spaeter())
        return 9

    async def unsubscribe(self, sub_id):
        self.beendet = True
        if self.pc is not None:
            await self.pc.close()

    async def call_service(self, domain, service, data, **_kw):
        self.dienste.append((domain, service, data))

    async def rest(self, method, path, timeout=None, **kw):
        self.ereignisse.append({"path": path, **(kw.get("json") or {})})

    async def rest_post_bytes(self, path, daten, headers, timeout=30):
        assert path == "stt/stt.test" and "sample_rate=16000" in headers["X-Speech-Content"]
        self.stt.append(daten)
        return {"result": "success", "text": "Paket für Meisel"}


def _einst(ab_s=1, max_s=8):
    return SimpleNamespace(
        pforte_aktiv=True,
        pforte_ab_s=ab_s,
        pforte_max_s=max_s,
        pforte_warte_text="Bitte warten",
        pforte_ab_text="Nachricht bitte",
        pforte_push=["notify.test"],
        pforte_stt="stt.test",
    )


def _pforte(ring, einst, tmp_path, anwesend=True):
    meldungen = []
    phasen = []

    async def tts(text):
        return _ton_wav(0.3)

    async def melden(d):
        phasen.append(d["phase"])

    p = pf.Pforte(
        ring,
        lambda: einst,
        lambda: anwesend,
        tts,
        melden,
        lambda t, x, a=None: meldungen.append((t, x, a)),
        lambda: __import__("datetime").datetime(2026, 10, 21, 14, 5),
    )
    p.stun = None
    p.verzeichnis = tmp_path
    return p, meldungen, phasen


async def test_anrufbeantworter_nimmt_nachricht_auf(tmp_path):
    pytest.importorskip("aiortc")
    ring = Ring(Besucher(ab_s=3.2, dauer_s=1.5))
    p, meldungen, phasen = _pforte(ring, _einst(), tmp_path)
    p.klingeln()
    await asyncio.wait_for(p._task, 25)
    assert ring.empfangen > 20  # Warteansage, Melodie und AB-Ansage kamen beim Besucher an (≈ 2 s hörbar)
    assert phasen[:4] == ["verbinden", "warten", "anrufbeantworter", "aufnahme"] and phasen[-1] == "ende"
    assert len(ring.stt) == 1
    with wave.open(BytesIO(ring.stt[0])) as w:
        assert w.getframerate() == 16000 and 1.0 < w.getnframes() / 16000 < 8
    assert ring.dienste == [
        (
            "notify",
            "test",
            {"title": "Nachricht an der Haustür", "message": "14:05 Uhr: „Paket für Meisel“", "data": {"group": "haustuer"}},
        )
    ]
    assert meldungen and "Paket" in meldungen[0][1] and meldungen[0][2] == "2026-10-21_14-05-00.wav"
    assert list(tmp_path.glob("*.wav"))
    # Liste und Datei für das Panel
    liste = p.aufnahmen()
    assert liste[0]["datei"] == "2026-10-21_14-05-00.wav" and liste[0]["text"] == "Paket für Meisel" and liste[0]["dauer_s"] >= 1
    assert p.aufnahme_pfad("2026-10-21_14-05-00.wav") == tmp_path / "2026-10-21_14-05-00.wav"
    assert ring.beendet and not p.uebernommen


async def test_ring_app_nimmt_an(tmp_path):
    pytest.importorskip("aiortc")
    ring = Ring(Besucher(ab_s=99, dauer_s=1), schliessen_nach=1.0)
    p, meldungen, _ = _pforte(ring, _einst(ab_s=10), tmp_path)
    p.klingeln()
    await asyncio.wait_for(p._task, 15)
    assert p.uebernommen and not ring.dienste and not meldungen


async def test_panel_uebernimmt(tmp_path):
    pytest.importorskip("aiortc")
    ring = Ring(Besucher(ab_s=99, dauer_s=1))
    p, _meldungen, phasen = _pforte(ring, _einst(ab_s=10), tmp_path)
    p.klingeln()
    for _ in range(100):
        await asyncio.sleep(0.05)
        if "warten" in phasen:
            break
    await p.uebergeben()
    assert not p.laeuft and p.uebernommen and ring.beendet and not ring.dienste


def test_aufnahme_pfad_nur_eigene_dateinamen(tmp_path):
    p = pf.Pforte(None, lambda: None, lambda: True, None, None, None, None)
    p.verzeichnis = tmp_path
    (tmp_path / "2026-10-21_14-05-00.wav").write_bytes(pf.wav(pf.stille(0.1)))
    (tmp_path / "geheim.wav").write_bytes(b"x")
    assert p.aufnahme_pfad("2026-10-21_14-05-00.wav") is not None
    for falsch in ("geheim.wav", "../config.yaml", "2026-10-21_14-05-00.wav/..", ""):
        assert p.aufnahme_pfad(falsch) is None
    assert [x["datei"] for x in p.aufnahmen()] == ["2026-10-21_14-05-00.wav"]


def test_tageszeit_und_gruss():
    assert [pf.tageszeit(h) for h in (5, 10, 11, 13, 14, 17, 18, 21, 22, 0, 4)] == [
        "morgen",
        "morgen",
        "mittag",
        "mittag",
        "nachmittag",
        "nachmittag",
        "abend",
        "abend",
        "nacht",
        "nacht",
        "nacht",
    ]
    for gruesse in pf.GRUESSE.values():
        assert not any(w in g for g in gruesse for w in ("Servus", "Mahlzeit", "Gute Nacht"))
    assert all("Signalton" in t and "Nachricht" in t for t in pf.AB)  # Hinweis auf die Aufnahme bleibt


def test_waehlen_wiederholt_nicht():
    for _ in range(50):
        assert pf.waehlen(("a", "b"), "a") == "b"
    assert pf.waehlen(("a",), "a") == "a"


async def test_warteansage_mit_gruss_nach_tageszeit():
    pytest.importorskip("av")
    gesprochen = []

    async def tts(text):
        gesprochen.append(text)
        return _ton_wav(0.2)

    for stunde, gruesse in ((8, pf.GRUESSE["morgen"]), (19, pf.GRUESSE["abend"]), (23, pf.GRUESSE["nacht"])):
        gesprochen.clear()
        e = _einst()
        e.pforte_warte_text = ""
        p = pf.Pforte(
            None,
            lambda e=e: e,
            lambda: True,
            tts,
            None,
            None,
            lambda s=stunde: __import__("datetime").datetime(2026, 10, 21, s, 0),
        )
        pcm = await p._warteansage(e)
        assert gesprochen[0] in gruesse and gesprochen[1] in (pf.WARTE_NACHT if stunde == 23 else pf.WARTE)
        assert len(pcm) > 2 * 16000 * 0.5
    # Eigener Text aus den Einstellungen hat Vorrang
    gesprochen.clear()
    e = _einst()
    p = pf.Pforte(None, lambda: e, lambda: True, tts, None, None, lambda: __import__("datetime").datetime(2026, 10, 21, 8))
    await p._warteansage(e)
    assert gesprochen == ["Bitte warten"]


def test_alte_feste_texte_gelten_als_leer():
    from panelstudio.config import Einstellungen

    e = Einstellungen.from_dict(
        {
            "pforte_warte_text": "Guten Tag. Bitte warten Sie, Sie werden verbunden.",
            "pforte_ab_text": "Bitte sprechen Sie nach dem Ton.",
        }
    )
    assert e.pforte_warte_text == "" and e.pforte_ab_text == "Bitte sprechen Sie nach dem Ton."
