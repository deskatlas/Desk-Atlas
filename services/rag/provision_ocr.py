"""SPEC6-TC01: immutable eng/fil language files with SHA-256 verification."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent


def main():
    manifest = json.loads((ROOT / "ocr-artifacts.json").read_text(encoding="utf-8"))
    for item in manifest["artifacts"]:
        target = ROOT / ".cache/tessdata" / (item["language"] + ".traineddata")
        if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == item["sha256"]:
            continue
        with urlopen(item["url"], timeout=60) as response:
            data = response.read()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("OCR_ARTIFACT_HASH_MISMATCH")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(json.dumps({"status": "PROVISIONED", "languages": ["eng", "fil"]}))


if __name__ == "__main__":
    main()
