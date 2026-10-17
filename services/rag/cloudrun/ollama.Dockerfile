# SPEC-6 / SDD-C21: existing Ollama 0.40.5 runtime, Linux amd64 digest.
FROM ollama/ollama:0.40.5@sha256:0e8ff22ff86b4718cfa886844062117af13b50eb5689cca78279778e15744980 AS provisioned
ENV OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=/models OLLAMA_DEBUG=false \
    OLLAMA_KEEP_ALIVE=-1 OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1
COPY cloudrun/provision_answer.sh /provision_answer.sh
# Download during build, then refuse a moved model tag. No runtime pull.
RUN sh /provision_answer.sh && chmod -R a+rX /models

# Verification uses the existing Python base and standard library only.
FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e AS verified
COPY --from=provisioned /models /models
COPY answer-model.json /answer-model.json
COPY cloudrun/verify_answer.py /verify_answer.py
RUN python /verify_answer.py /models /answer-model.json > /verified-answer.txt

FROM provisioned
# This dependency ensures failed verification cannot produce a runtime image.
COPY --from=verified /verified-answer.txt /verified-answer.txt
ENV HOME=/tmp
USER 65534:65534
ENTRYPOINT ["/bin/ollama"]
CMD ["serve"]
