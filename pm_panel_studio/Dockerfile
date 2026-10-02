# Offizielles Base-Image (s6-overlay v3, bashio, tzdata), wie PM Klima Studio.
FROM ghcr.io/home-assistant/base-python:3.13-alpine3.24-2026.08.0

ARG BUILD_VERSION=0.1.11
ARG BUILD_ARCH=amd64

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt /tmp/requirements.txt
RUN pip install --only-binary=:all: -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt

COPY app /opt/pm_panel_studio
COPY rootfs /
RUN chmod a+x /etc/s6-overlay/s6-rc.d/pm-panel-studio/run /etc/s6-overlay/s6-rc.d/pm-panel-studio/finish \
    && test -s /opt/pm_panel_studio/panelstudio/static/index.html \
    && python3 -m compileall -q /opt/pm_panel_studio

WORKDIR /opt/pm_panel_studio

LABEL \
  io.hass.name="PM Panel Studio" \
  io.hass.description="Wandpanel-Oberfläche für Home Assistant" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="aarch64|amd64" \
  org.opencontainers.image.title="PM Panel Studio" \
  org.opencontainers.image.licenses="MIT"
