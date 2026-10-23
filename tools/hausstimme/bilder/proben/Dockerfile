# Stimme entwerfen mit Parler-TTS (Apache 2.0): Stimme aus einer Beschreibung, mehrsprachig (auch Deutsch)
FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "git+https://github.com/huggingface/parler-tts.git" soundfile
