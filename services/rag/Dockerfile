FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1
COPY runtime-requirements.lock.txt .
RUN pip install --no-cache-dir pip==25.2 \
    && pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu --no-deps \
    && pip install --no-cache-dir -r runtime-requirements.lock.txt \
    && pip check \
    && useradd --create-home rag
COPY app.py .
COPY models.json .
COPY rag/ ./rag/
USER rag
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--log-level", "critical"]
