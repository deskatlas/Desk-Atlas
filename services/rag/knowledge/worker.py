"""SPEC5-TC06..08,13,16,19: polling durable jobs through a narrow TS gateway.

Parser containers have no network, credentials, or model access. This process
owns a worker gateway token and optional hosted encoder key. Supabase service-role
keys stay in TypeScript. The parser receives neither credential.
"""
import hashlib
import json
import os
import signal
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from knowledge.chunk import chunk_sections
from knowledge.preparation import verify_preparation, verify_support_preparation
from knowledge.structure import manifest_hash
from rag.encoder import Encoder
from rag.embedding_provider import embedding_provider, embedding_fingerprint, HostedEncoder

ROOT = Path(__file__).resolve().parents[1]
SAFE_ERRORS = {"TYPE_MISMATCH", "UNSAFE_FILE", "ENCRYPTED_FILE", "MALFORMED_FILE", "EMPTY_TEXT", "PARSER_FAILED", "PARSER_REVISION_MISMATCH", "STORAGE_FAILED", "EMBEDDING_FAILED", "RESOURCE_LIMIT", "MANIFEST_INVALID", "CONTENT_LIMIT", "UNREADABLE_PAGE"}


class LazyEncoder:
    """Cleanup remains available even when model weights cannot be loaded."""
    def __init__(self, manifest, cache):
        self.manifest, self.cache, self.encoder = manifest, cache, None
    def load(self):
        if self.encoder is None:
            try:
                import torch
                torch.set_num_threads(int(os.environ.get('KB_EMBEDDING_THREADS', '2')))
                self.encoder = Encoder(self.manifest, self.cache)
            except Exception:
                raise ValueError('EMBEDDING_FAILED') from None
        return self.encoder
    @property
    def _model(self):
        return self.load()._model
    def encode(self, texts):
        try:
            return self.load().encode(texts)
        except Exception:
            raise ValueError('EMBEDDING_FAILED') from None


class GatewayError(ValueError):
    pass


class Gateway:
    def __init__(self, url: str, token: str):
        parsed = urlparse(url)
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}):
            raise ValueError("PRIVATE_HTTPS_GATEWAY_REQUIRED")
        if len(token) < 32:
            raise ValueError("WORKER_TOKEN_REQUIRED")
        self.url = url.rstrip("/")
        self.token = token

    def call(self, path: str, data: dict):
        request = Request(self.url + "/api/internal/knowledge/jobs/" + path, json.dumps(data).encode(), {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=45) as response:
                return json.load(response)["data"]
        except HTTPError as exc:
            # Read only the safe error code; never print response bodies or URLs.
            try:
                code = json.load(exc)["error"]["code"]
            except Exception:
                code = "GATEWAY_UNAVAILABLE"
            raise GatewayError(code) from None
        except (URLError, TimeoutError):
            raise GatewayError("GATEWAY_UNAVAILABLE") from None


def process_claim(gateway: Gateway, claim: dict, encoder: Encoder, fingerprint: str):
    job, version = claim["job"], claim["version"]
    lease = {"lease_token": job["lease_token"], "generation": job["generation"]}
    path = job["id"]
    stopped = threading.Event()
    lost = threading.Event()
    def heartbeat():
        while not stopped.wait(25):
            try:
                gateway.call(path + "/heartbeat", lease)
            except GatewayError:
                lost.set()
                return
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    def checkpoint(stage, chunks=None):
        if lost.is_set():
            raise GatewayError("LEASE_LOST")
        gateway.call(path + "/checkpoint", {**lease, "stage": stage, "chunks": chunks or []})
    try:
        if job["kind"] == "PURGE":
            gateway.call(path + "/complete", lease)
            return
        checkpoint("VALIDATING")
        with tempfile.TemporaryDirectory(prefix="kb-") as directory:
            source = Path(directory) / "source"
            source_url = claim["source_url"]
            parsed = urlparse(source_url)
            if parsed.scheme not in {"https", "http"}:
                raise ValueError("STORAGE_FAILED")
            with urlopen(source_url, timeout=60) as response, source.open("wb") as target:
                while True:
                    data = response.read(1024 * 1024)
                    if not data:
                        break
                    target.write(data)
                    if target.tell() > version["source_bytes"]:
                        raise ValueError("MANIFEST_INVALID")
            if source.stat().st_size != version["source_bytes"] or hashlib.sha256(source.read_bytes()).hexdigest() != version["source_sha256"]:
                raise ValueError("MANIFEST_INVALID")
            # The parser runs as UID 65534. The host directory stays private;
            # only this read-only bind-mounted file is readable in the sandbox.
            if os.name != 'nt':
                source.chmod(0o444)
            checkpoint("CONVERTING" if version["detected_type"] == "DOC" else "OCR" if version["detected_type"] == "PDF" else "EXTRACTING")
            image = os.environ.get("KB_PARSER_IMAGE", "deskatlas-knowledge-parser:local")
            if not image or image.startswith("-"):
                raise ValueError("PARSER_FAILED")
            # UUID-only temporary source path, argument array, no user filename interpolation.
            container = 'kb-' + job['id'] + '-' + job['lease_token']
            command = ["docker", "run", "--rm", "--name", container, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", os.environ.get("KB_PARSER_MEMORY", "2g"), "--cpus", "2", "--tmpfs", "/tmp:rw,noexec,nosuid,size=1073741824", "--mount", f"type=bind,source={source.resolve()},target=/input/source,readonly", image, "--source", "/input/source", "--type", version["detected_type"]]
            try:
                parsed_result = subprocess.run(command, capture_output=True, timeout=int(os.environ.get("KB_PARSER_TIMEOUT_SECONDS", "900")), check=False)
            finally:
                # A killed Docker CLI does not guarantee its container stopped.
                subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=30, check=False)
            if parsed_result.returncode:
                raise ValueError("PARSER_FAILED")
            result = json.loads(parsed_result.stdout)
            if "error" in result:
                raise ValueError(result["error"]["code"])
            extraction = result["data"]
            # MS48-TC13: stale Docker images must not create another generation
            # that appears ready but lacks the deployed structural contract.
            if not extraction.get('parser_fingerprint', '').startswith('kb-parser-v5:'):
                raise ValueError('PARSER_REVISION_MISMATCH')
            if extraction["source_sha256"] != version["source_sha256"]:
                raise ValueError("MANIFEST_INVALID")
            checkpoint("NORMALIZING")
            checkpoint("CHUNKING")
            chunks = chunk_sections(extraction["sections"], encoder.tokenizer if isinstance(encoder, HostedEncoder) else encoder._model.tokenizer)
            extraction['warning_codes'].append('SECTION_SCOPE_REVIEW')
            if any(chunk['section_context']['unresolved'] for chunk in chunks):
                extraction['warning_codes'].append('SECTION_CONTEXT_UNRESOLVED')
            preparation = {'preparation_policy': verify_preparation(extraction, chunks),
                           'support_contract': verify_support_preparation(extraction, chunks)} if version.get('upload_intent') else {}
            for offset in range(0, len(chunks), 4):
                batch = chunks[offset:offset + 4]
                vectors = encoder.encode([chunk["content"] for chunk in batch])
                for chunk, vector in zip(batch, vectors, strict=True):
                    chunk["embedding"] = vector
                checkpoint("EMBEDDING", batch)
            checkpoint("VERIFYING")
            if lost.is_set():
                raise GatewayError("LEASE_LOST")
            gateway.call(path + "/complete", {**lease, **preparation, "expected_chunk_count": len(chunks), "structure_manifest_sha256": manifest_hash(chunks), "content_sha256": extraction["content_sha256"], "manifest_sha256": hashlib.sha256("".join(chunk["content_sha256"] for chunk in chunks).encode()).hexdigest(), "parser_fingerprint": extraction["parser_fingerprint"], "embedding_fingerprint": fingerprint, "warning_codes": extraction["warning_codes"], "extraction_manifest": [{"heading": section["heading"], "page": section["page"], "method": section["method"], "outcome": section.get("outcome", "EXTRACTED"), **{key: section[key] for key in ("normalized_start", "normalized_end", "section_id") if key in section}} for section in extraction["sections"]]})
    except GatewayError:
        # Retry/reclaim is durable; a lost lease cannot emit completion or notices.
        pass
    except Exception as exc:
        code = str(exc) if isinstance(exc, ValueError) and str(exc) in SAFE_ERRORS else "PARSER_FAILED"
        try:
            gateway.call(path + "/complete", {**lease, "error_code": code, "retryable": code in {"STORAGE_FAILED", "EMBEDDING_FAILED", "RESOURCE_LIMIT"}})
        except GatewayError:
            pass
    finally:
        stopped.set()
        thread.join(timeout=50)


def run_lane(gateway, kind, encoder=None, fingerprint='', stop=None):
    """MS52-TC02: a blocked ingestion lane cannot block eligible cleanup."""
    stop = stop or threading.Event()
    while not stop.is_set():
        try:
            claim = gateway.call("claim", {"kind": kind})
            if claim:
                started = time.monotonic()
                process_claim(gateway, claim, encoder, fingerprint)
                # Content-free service time; job timestamps carry queue/eligibility.
                print(json.dumps({"event": "kb_worker_service", "kind": kind,
                                  "duration_ms": round((time.monotonic() - started) * 1000)}), flush=True)
            else:
                stop.wait(1)
        except GatewayError:
            stop.wait(5)


def run_lanes(gateway, encoder, fingerprint, stop=None):
    stop = stop or threading.Event()
    cleanup = threading.Thread(target=run_lane, args=(gateway, 'PURGE', None, '', stop), daemon=True)
    cleanup.start()
    try:
        run_lane(gateway, 'INGEST', encoder, fingerprint, stop)
    finally:
        stop.set()
        cleanup.join(timeout=50)


def main():
    if os.environ.get("KB_ENABLED") != "true":
        raise SystemExit("KB_DISABLED")
    gateway = Gateway(os.environ.get("KB_GATEWAY_URL", "http://127.0.0.1:3000"), os.environ.get("KB_WORKER_TOKEN", ""))
    # A standalone purge process requires neither manifests nor model weights.
    if os.environ.get('KB_WORKER_MODE', 'all') == 'purge':
        run_lane(gateway, 'PURGE')
        return
    if os.environ.get('KB_WORKER_MODE', 'all') not in {'all', 'ingest'}:
        raise SystemExit('INVALID_WORKER_MODE')
    manifest = json.loads((ROOT / "models.json").read_text())
    fingerprint = embedding_fingerprint(manifest)
    encoder = HostedEncoder() if embedding_provider() == 'deepinfra' else LazyEncoder(manifest, ROOT / '.cache' / 'models')
    if os.environ.get('KB_WORKER_MODE') == 'ingest':
        run_lane(gateway, 'INGEST', encoder, fingerprint)
    else:
        run_lanes(gateway, encoder, fingerprint)


if __name__ == "__main__":
    # A VM service stop must execute the parser's owned-container cleanup.
    # The default SIGTERM action would exit without running its finally block.
    def terminate(_signal, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, terminate)
    try:
        main()
    except KeyboardInterrupt:
        pass
