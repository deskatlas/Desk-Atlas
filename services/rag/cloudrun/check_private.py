"""SPEC-6 / QAD-TC44/46: content-free hosted auth and embedding smoke check.

Reads credentials into memory through the signed-in operator's Google CLI.
Never prints credentials, HTTP bodies, vectors or exception diagnostics.
"""
import argparse
import base64
import hashlib
import hmac
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4


def google(cli, *args):
    result = subprocess.run([cli, *args], capture_output=True, text=True, check=False)
    if result.returncode:
        raise ValueError("GOOGLE_COMMAND_FAILED: check signed-in account and permissions")
    return result.stdout.strip()


def capability(secret):
    now = int(time.time())
    claims = {"iss": "deskatlas", "aud": "rag", "sub": str(uuid4()),
              "role": "ADMIN", "request_id": str(uuid4()), "scope": "deskatlas",
              "ops": ["search", "answer"], "iat": now, "exp": now + 60,
              "generation": str(uuid4())}
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(),
                                                 hashlib.sha256).digest()).decode().rstrip("=")
    return payload + "." + signature


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def call(url, headers, payload=None):
    encoded = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=encoded, headers=headers)
    started = time.monotonic()
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=300) as response:
            body = response.read(1024 * 1024)
            return response.status, json.loads(body), round(time.monotonic() - started, 2)
    except urllib.error.HTTPError as error:
        return error.code, {}, round(time.monotonic() - started, 2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gcloud")
    args = parser.parse_args()
    cli = args.gcloud or shutil.which("gcloud.cmd") or shutil.which("gcloud")
    if not cli:
        raise ValueError("GCLOUD_NOT_FOUND")
    common = ["--project=deskatlas-rag", "--region=us-central1"]
    service = "deskatlas-rag-chat-staging"
    url = google(cli, "run", "services", "describe", service, *common,
                 "--format=value(status.url)")
    if not url.startswith("https://") or not url.endswith(".run.app"):
        raise ValueError("UNEXPECTED_SERVICE_URL")
    policy = json.loads(google(cli, "run", "services", "get-iam-policy", service,
                               *common, "--format=json"))
    if any(member in {"allUsers", "allAuthenticatedUsers"}
           for binding in policy.get("bindings", []) for member in binding.get("members", [])):
        raise ValueError("UNEXPECTED_PUBLIC_IAM_BINDING")
    status, _, elapsed = call(url + "/health", {})
    print(f"No Google identity: HTTP {status}, {elapsed}s", flush=True)
    if status not in (401, 403):
        raise ValueError("GOOGLE_AUTH_NOT_ENFORCED")
    identity = google(cli, "auth", "print-identity-token")
    headers = {"X-Serverless-Authorization": "Bearer " + identity}
    status, _, elapsed = call(url + "/health", headers)
    print(f"Google identity only: HTTP {status}, {elapsed}s", flush=True)
    if status != 401:
        raise ValueError("SERVICE_AUTH_CHECK_FAILED")
    credentials = {}
    for name in ("rag-service-token", "rag-capability-secret"):
        credentials[name] = google(cli, "secrets", "versions", "access", "1",
                                   "--secret=" + name, "--project=deskatlas-rag")
    headers["Authorization"] = "Bearer " + credentials["rag-service-token"]
    headers["X-Request-Capability"] = "invalid"
    status, _, elapsed = call(url + "/health", headers)
    print(f"Invalid capability: HTTP {status}, {elapsed}s", flush=True)
    if status != 401:
        raise ValueError("CAPABILITY_CHECK_FAILED")
    headers["X-Request-Capability"] = capability(credentials["rag-capability-secret"])
    status, data, elapsed = call(url + "/health", headers)
    print(f"Authenticated health: HTTP {status}, {elapsed}s", flush=True)
    if status != 200 or data.get("ready") is not True:
        raise ValueError("HEALTH_CHECK_FAILED")
    # Match the imported serving code, not just a reachable older API.
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from rag.runtime_identity import implementation_fingerprint
    if data.get("implementation_fingerprint") != implementation_fingerprint():
        raise ValueError("SERVING_CODE_DIFFERS_FROM_WORKTREE")
    print("Serving implementation matches worktree", flush=True)
    print("PRIVATE_HEALTH_CHECK_PASSED", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, TimeoutError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        # Only our fixed messages may be displayed. Never emit remote bodies.
        message = str(error) if type(error) is ValueError else "CHECK_FAILED: transport or CLI unavailable"
        print(message, flush=True)
        raise SystemExit(1) from None
