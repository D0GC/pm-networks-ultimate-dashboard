"""Ansagen (Piper) und Sprachassistent: Ablauf mit nachgebautem Home-Assistant-Client."""

import asyncio

from panelstudio.sprache import Sprache, _tts_pfad


class Client:
    def __init__(self):
        self.rest_aufrufe, self.binaer, self.abos, self.entfernt = [], [], {}, []

    async def rest(self, method, path, timeout=None, **kw):
        self.rest_aufrufe.append((method, path, kw.get("json")))
        return {"url": "http://ha:8123/api/tts_proxy/abc.mp3", "path": "/api/tts_proxy/abc.mp3"}

    async def rest_raw(self, path, timeout=15):
        assert path == "tts_proxy/abc.mp3"
        return b"ID3-ton", "audio/mpeg"

    async def subscribe(self, payload, callback):
        self.abos[7] = (payload, callback)
        return 7

    def abo_entfernen(self, sub_id):
        self.entfernt.append(sub_id)

    async def send_bytes(self, daten):
        self.binaer.append(daten)


def test_tts_pfad():
    assert _tts_pfad("/api/tts_proxy/x.mp3") == "tts_proxy/x.mp3"
    assert _tts_pfad("http://h:8123/api/tts_proxy/x.wav?t=1") == "tts_proxy/x.wav"
    for falsch in ("/api/states", "/api/tts_proxy/../x"):
        try:
            _tts_pfad(falsch)
        except ValueError:
            continue
        raise AssertionError(falsch)


async def test_ansage_piper_jarvis_und_panel_meldung():
    gesendet = []

    async def alle(m):
        gesendet.append(m)

    c = Client()
    sp = Sprache(c, alle)
    tid = await sp.ansage({"text": "Willkommen zurück, Sir.", "titel": "Heimkomm"})
    method, path, body = c.rest_aufrufe[0]
    assert (method, path) == ("POST", "tts_get_url")
    assert body == {"engine_id": "tts.piper", "message": "Willkommen zurück, Sir.", "language": "de_DE", "options": {"voice": "de_DE-jarvis-medium"}}
    assert gesendet == [{"typ": "ansage", "id": tid, "text": "Willkommen zurück, Sir.", "titel": "Heimkomm"}]
    assert sp.ton(tid) == (b"ID3-ton", "audio/mpeg")
    assert await sp.ansage({"text": "  "}) is None


async def test_assist_ablauf():
    an_panel = []

    async def senden(m):
        an_panel.append(m)

    async def alle(_m):
        pass

    c = Client()
    sp = Sprache(c, alle)
    ws = object()
    await sp.assist_start(ws, senden, "pipe1")
    payload, cb = c.abos[7]
    assert payload["type"] == "assist_pipeline/run" and payload["pipeline"] == "pipe1" and payload["input"] == {"sample_rate": 16000}
    # Ton vor „run-start“ wird gepuffert und nachgereicht, mit der Binär-Kennung davor
    assert sp.assist_ton(ws, b"\x01\x02")
    assert not sp.assist_ton(object(), b"\x00")  # fremdes Panel: nicht für den Assistenten
    cb({"type": "run-start", "data": {"runner_data": {"stt_binary_handler_id": 5}}})
    sp.assist_ton(ws, b"\x03\x04")
    await asyncio.sleep(0)
    assert c.binaer == [b"\x05\x01\x02", b"\x05\x03\x04"]
    cb({"type": "stt-vad-end", "data": {}})
    cb({"type": "stt-end", "data": {"stt_output": {"text": "Mach das Licht an"}}})
    cb({"type": "intent-end", "data": {"intent_output": {"response": {"speech": {"plain": {"speech": "Erledigt."}}}}}})
    cb({"type": "tts-end", "data": {"tts_output": {"url": "/api/tts_proxy/abc.mp3"}}})
    cb({"type": "run-end", "data": {}})
    for _ in range(5):
        await asyncio.sleep(0)
    assert c.binaer[-1] == b"\x05"  # Ende der Spracheingabe
    phasen = [m["phase"] for m in an_panel]
    assert phasen[:4] == ["hoert", "versteht", "denkt", "antwortet"] and "spricht" in phasen and "ende" in phasen
    assert next(m for m in an_panel if m["phase"] == "denkt")["text"] == "Mach das Licht an"
    assert next(m for m in an_panel if m["phase"] == "antwortet")["antwort"] == "Erledigt."
    assert sp.ton(next(m for m in an_panel if m["phase"] == "spricht")["ton"])
    assert c.entfernt == [7]
