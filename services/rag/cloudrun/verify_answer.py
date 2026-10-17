"""SPEC6-TC01: verify pinned registry manifests, Ollama wrappers and blob bytes."""
import hashlib
import json
from pathlib import Path
import re
import sys

MANIFEST_TYPE = "application/vnd.docker.distribution.manifest.v2+json"


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def blob_path(root, digest):
    if not isinstance(digest, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("INVALID_BLOB_DIGEST")
    return root / "blobs" / digest.replace(":", "-", 1)


def verify(root, expected):
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("INVALID_PINNED_DIGEST")
    named = root / "manifests/registry.ollama.ai/library/qwen3/4b"
    local = json.loads(named.read_bytes())
    if digest_file(named) == expected:
        original = local
    else:
        original_path = blob_path(root, "sha256:" + expected)
        if digest_file(original_path) != expected:
            raise ValueError("ORIGINAL_MANIFEST_DIGEST_MISMATCH")
        original = json.loads(original_path.read_bytes())
        reference = {"mediaType": MANIFEST_TYPE, "digest": "sha256:" + expected,
                     "size": original_path.stat().st_size}
        wrapper = {**original, "layers": [*original["layers"], reference]}
        if local != wrapper:
            raise ValueError("WRAPPER_MANIFEST_MISMATCH")
    for item in [original["config"], *original["layers"]]:
        path = blob_path(root, item["digest"])
        if path.stat().st_size != item["size"] or digest_file(path) != item["digest"][7:]:
            raise ValueError("MODEL_BLOB_MISMATCH")
    return expected


if __name__ == "__main__":
    root, manifest = map(Path, sys.argv[1:])
    config = json.loads(manifest.read_text(encoding="utf-8"))
    if config["model"] != "qwen3:4b":
        raise ValueError("UNEXPECTED_ANSWER_MODEL")
    print("VERIFIED_ANSWER_MANIFEST=" + verify(root, config["manifest_digest"]))
