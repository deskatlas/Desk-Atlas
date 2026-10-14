"""Synthetic held-out CPU retrieval baseline; never publishes a knowledge source."""
import json
import os
from pathlib import Path
from time import perf_counter

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from rag.encoder import Encoder
from rag.evaluation import retrieval_scores

ROOT = Path(__file__).resolve().parent


def main():
    import torch
    torch.set_num_threads(6)
    manifest = json.loads((ROOT / "models.json").read_text(encoding="utf-8"))
    cases = json.loads((ROOT / "evaluation/held-out.json").read_text(encoding="utf-8"))
    corpus = json.loads((ROOT / "evaluation/corpus.json").read_text(encoding="utf-8"))
    encoder = Encoder(manifest, ROOT / ".cache/models")
    vectors = encoder.encode([source["text"] for source in corpus])
    observations = []
    start = perf_counter()
    for case in cases:
        if not case["expected_sources"]:
            continue
        query = encoder.encode([case["question"]], query=True)[0]
        ranking = sorted(range(len(corpus)), key=lambda index: sum(a * b for a, b in zip(query, vectors[index])), reverse=True)
        observations.append({"id": case["id"], "retrieved_sources": [corpus[index]["id"] for index in ranking[:6]]})
    print(json.dumps({"profile": "synthetic_cpu_retrieval_smoke", "model_revision": manifest["embedding"]["revision"],
                      "duration_ms": (perf_counter() - start) * 1000,
                      "scores": retrieval_scores(cases, observations), "release_evidence": False,
                      "limitations": ["Tiny synthetic corpus; not production recall calibration", "Document-type labels do not verify extraction"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"status": "FAILED", "error_code": "RETRIEVAL_EVALUATION_FAILED"}))
        raise SystemExit(1) from None
