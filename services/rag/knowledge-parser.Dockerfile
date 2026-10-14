# SPEC-5: untrusted parsers run with --network none and no gateway credentials.
FROM python:3.10-slim-bookworm@sha256:5be5aaecb962a41567bc8041f1e9e3432cb085b037fe057f9a562630b2e4b370
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer tesseract-ocr tesseract-ocr-eng tesseract-ocr-fil \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir python-docx==1.2.0 pypdf==6.0.0 pypdfium2==4.30.0 olefile==0.47
WORKDIR /app
COPY knowledge/ /app/knowledge/
ENV PYTHONDONTWRITEBYTECODE=1 HOME=/tmp
USER 65534:65534
ENTRYPOINT ["python", "-m", "knowledge.extract"]
