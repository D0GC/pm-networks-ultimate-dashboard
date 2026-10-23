# Piper nachtrainieren (rhasspy/piper, piper_train): Python 3.10, PyTorch 1.13 mit CUDA 11.7 (läuft auf RTX 30xx)
FROM nvidia/cuda:11.7.1-cudnn8-devel-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-dev git build-essential curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir "torch==1.13.1+cu117" --extra-index-url https://download.pytorch.org/whl/cu117
RUN git clone --depth 1 https://github.com/rhasspy/piper.git /opt/piper \
    && cd /opt/piper/src/python \
    && pip3 install --no-cache-dir "cython>=0.29,<1" "numpy<1.24" "torchmetrics==0.11.4" "pytorch-lightning==1.7.7" \
    && pip3 install --no-cache-dir -e . \
    && bash build_monotonic_align.sh
# Zum Probehören des fertigen Modells
RUN pip3 install --no-cache-dir "piper-tts==1.2.0" requests
