"""SPEC6-TC01: build-time provisioning of only the pinned serving encoder."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from huggingface_hub import snapshot_download
    from rag.artifacts import verify_weights

    model = json.loads((ROOT / "models.json").read_text(encoding="utf-8"))["embedding"]
    snapshot = snapshot_download(
        repo_id=model["id"], revision=model["revision"],
        cache_dir=str(ROOT / ".cache" / "models"),
        allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model", "LICENSE*", "README.md"],
    )
    verify_weights(Path(snapshot), model["weights_sha256"])
    print("PINNED_EMBEDDING_PROVISIONED")


if __name__ == "__main__":
    main()
