"""Download only approved immutable artifacts into an ignored local cache."""
import json
from pathlib import Path
from huggingface_hub import snapshot_download
from rag.artifacts import verify_weights

ROOT = Path(__file__).resolve().parent


def main():
    manifest = json.loads((ROOT / "models.json").read_text(encoding="utf-8"))
    for model in [manifest["embedding"], *manifest["answer_candidates"]]:
        snapshot = snapshot_download(repo_id=model["id"], revision=model["revision"],
                          cache_dir=str(ROOT / ".cache" / "models"),
                          allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model", "LICENSE*", "README.md"])
        verify_weights(Path(snapshot), model["weights_sha256"])
        print(json.dumps({"model_id": model["id"], "revision": model["revision"], "status": "PROVISIONED"}))


if __name__ == "__main__":
    main()
