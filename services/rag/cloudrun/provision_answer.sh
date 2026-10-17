#!/bin/sh
# SPEC6-TC01: preserve the existing approved candidate's complete manifest digest.
set -eu
ollama serve >/tmp/ollama-provision.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
attempt=0
until ollama list >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
        echo 'OLLAMA_BUILD_STARTUP_FAILED' >&2
        exit 1
    fi
    sleep 1
done
ollama pull qwen3:4b
# Ollama can wrap the registry manifest. A separate Python stage verifies the
# original digest, wrapper relationship and every downloaded blob.
rm -f /tmp/ollama-provision.log
