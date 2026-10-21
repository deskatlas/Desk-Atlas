FROM us-central1-docker.pkg.dev/deskatlas-rag/deskatlas-rag/api-hosted@sha256:6c7480857546cf5033aa40fec929c6dcac30bddd69f442f1a44f7e904733dff2
USER root
COPY repair.py patches.json /tmp/upload-repair/
RUN python /tmp/upload-repair/repair.py /app api && rm -rf /tmp/upload-repair
USER rag
