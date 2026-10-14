"""Verify immutable model weight bytes before local inference."""
import hashlib
from pathlib import Path


def verify_weights(snapshot: Path, expected: dict[str, str]):
    if not expected:
        raise ValueError("MODEL_WEIGHT_MANIFEST_MISSING")
    for filename, sha256 in expected.items():
        if Path(filename).name != filename:
            raise ValueError("INVALID_MODEL_ARTIFACT")
        digest = hashlib.sha256()
        with (snapshot / filename).open("rb") as stream:
            for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != sha256:
            raise ValueError("MODEL_WEIGHT_HASH_MISMATCH")
