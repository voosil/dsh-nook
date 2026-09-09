FROM debian:12-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

RUN apt-get update && apt-get install -y --no-install-recommends python3 apache2-bin apache2-utils openssl certbot ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 nook-sync \
    && useradd --uid 10001 --gid nook-sync --no-create-home --home-dir /var/lib/nook-sync/data --shell /usr/sbin/nologin nook-sync
WORKDIR /usr/local/lib/nook-sync
COPY setup.py container.py ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
LABEL org.opencontainers.image.title="Nook Sync" org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.source="https://github.com/voosil/dsh-nook"
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 CMD ["python3", "container.py", "health"]
ENTRYPOINT ["python3", "/usr/local/lib/nook-sync/container.py"]
CMD ["serve"]
