# Datensatz: Chatterbox Multilingual (MIT) spricht jeden Satz in der gewählten Stimme (aus referenz.wav), faster-whisper
# (MIT) prüft, ob gesprochen wurde, was dasteht
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "chatterbox-tts>=0.1.4" faster-whisper librosa soundfile num2words
