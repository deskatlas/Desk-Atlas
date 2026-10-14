"""SPEC6-TC01/02: safe local readiness diagnostics, never expose configuration."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
from rag.config import load_configuration
from rag.artifacts import verify_weights

ROOT = Path(__file__).resolve().parent


def binary(name: str, windows_path: str):
    found = shutil.which(name)
    fallback = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / windows_path
    return found or (str(fallback) if fallback.is_file() else None)


def inspect(*, canary=False):
    checks = {}
    try:
        manifest = json.loads((ROOT / "models.json").read_text(encoding="utf-8"))
        load_configuration(os.environ, manifest)
        checks["configuration"] = "PASS"
    except (ValueError, KeyError, OSError):
        return {"ready": False, "checks": {"configuration": "FAILED"}}
    try:
        for line in (ROOT / "evaluation-requirements.txt").read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#"):
                continue
            name, version = line.split("==")
            actual = importlib.metadata.version(name)
            if actual.split("+")[0] != version:
                raise ValueError("DEPENDENCY_DRIFT")
        checks["dependencies"] = "PASS"
    except (ValueError, importlib.metadata.PackageNotFoundError):
        checks["dependencies"] = "FAILED"
    for key, model in [("embedding_artifact", manifest["embedding"]),
                       *[("answer_artifact_" + str(index), model) for index, model in enumerate(manifest["answer_candidates"])]]:
        try:
            from huggingface_hub import snapshot_download
            path = Path(snapshot_download(model["id"], revision=model["revision"],
                        cache_dir=str(ROOT / ".cache" / "models"), local_files_only=True))
            if not (path / "config.json").is_file() or not list(path.glob("*.safetensors")):
                raise ValueError("INCOMPLETE_MODEL")
            verify_weights(path, model["weights_sha256"])
            checks[key] = "PASS"
        except Exception:
            checks[key] = "FAILED"
    soffice = binary("soffice", "LibreOffice/program/soffice.com")
    tesseract = binary("tesseract", "Tesseract-OCR/tesseract.exe")
    for key, executable in [("converter", soffice), ("ocr_engine", tesseract)]:
        try:
            if not executable:
                raise ValueError("MISSING_BINARY")
            completed = subprocess.run([executable, "--version"], capture_output=True, timeout=20, check=True)
            # Never persist arbitrary converter stdout/stderr. Only verify the pinned banner.
            expected = b"26.8.1.1" if key == "converter" else b"5.4.0"
            if expected not in completed.stdout + completed.stderr:
                raise ValueError("BINARY_VERSION_DRIFT")
            checks[key] = "PASS"
        except (ValueError, OSError, subprocess.SubprocessError):
            checks[key] = "FAILED"
    try:
        if not tesseract:
            raise ValueError("MISSING_OCR")
        languages = subprocess.run([tesseract, "--tessdata-dir", str(ROOT / ".cache/tessdata"), "--list-langs"],
                                   capture_output=True, timeout=20, check=True).stdout.decode().splitlines()
        checks["ocr_languages"] = "PASS" if {"eng", "fil"}.issubset(set(languages)) else "FAILED"
    except (ValueError, OSError, subprocess.SubprocessError):
        checks["ocr_languages"] = "FAILED"
    if canary:
        try:
            from rag.encoder import Encoder
            encoder = Encoder(manifest, ROOT / ".cache" / "models")
            encoder.encode(["DeskAtlas synthetic readiness canary."], query=True)
            checks["canary_1024_normalized"] = "PASS"
        except Exception:
            checks["canary_1024_normalized"] = "FAILED"
    return {"ready": all(value == "PASS" for value in checks.values()), "checks": checks,
            "release_ready": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--canary", action="store_true")
    result = inspect(canary=parser.parse_args().canary)
    print(json.dumps(result))
    raise SystemExit(0 if result["ready"] else 1)
