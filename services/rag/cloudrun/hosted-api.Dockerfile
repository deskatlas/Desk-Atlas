# PRD-F26/F27: HTTP-only serving, no local embedding weights or GPU runtime.
FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e
WORKDIR /app
COPY service-requirements.lock.txt .
RUN pip install --no-cache-dir -r service-requirements.lock.txt && useradd --create-home rag
COPY models.json app.py serve_local.py customer_access.py customer_public.py customer_booking_evidence.py ./
COPY rag/ ./rag/
COPY cloudrun/provision_answer_tokenizer.py ./cloudrun/provision_answer_tokenizer.py
RUN python cloudrun/provision_answer_tokenizer.py
ENV RAG_EMBEDDING_PROVIDER=deepinfra PYTHONDONTWRITEBYTECODE=1
USER rag
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--log-level", "critical"]
