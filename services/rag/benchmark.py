"""SPEC6-TC01/02: CPU model microbenchmark; not end-to-end release evidence."""
import argparse
import json
import os
from pathlib import Path
import platform
from time import perf_counter

# Prevent runtime downloads, hosted inference, and telemetry; provisioning is separate.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from rag.encoder import Encoder
from rag.evaluation import percentile
from rag.resources import peak_memory_bytes
from rag.artifacts import verify_weights

ROOT = Path(__file__).resolve().parent
QUESTIONS = [
    "Explain why selecting a desk does not hold inventory.",
    "Bakit hindi naka-hold ang desk habang naghihintay ng bayad?",
    "Can staff approve online payment proofs, o admin lang?",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--embedding-only", action="store_true")
    parser.add_argument("--threads", type=int, default=6)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("threads must be positive")
    import torch
    torch.set_num_threads(args.threads)
    manifest = json.loads((ROOT / "models.json").read_text(encoding="utf-8"))
    start = perf_counter()
    encoder = Encoder(manifest, ROOT / ".cache" / "models")
    cold_ms = (perf_counter() - start) * 1000
    encoder.encode(["Desk selection never holds inventory."])
    durations = []
    for index in range(5):
        start = perf_counter()
        encoder.encode([QUESTIONS[index % len(QUESTIONS)]], query=True)
        durations.append((perf_counter() - start) * 1000)
    print(json.dumps({"profile": "embedding_microbenchmark", "hardware": platform.machine(),
                      "threads": args.threads, "model_revision": manifest["embedding"]["revision"],
                      "dimensions": 1024, "normalization": "l2", "cold_load_ms": cold_ms,
                      "peak_memory_bytes": peak_memory_bytes(),
                      "samples": 5, "p50_ms": percentile(durations, .5), "p95_ms": percentile(durations, .95),
                      "release_evidence": False}))
    if args.embedding_only:
        return
    del encoder
    import gc
    gc.collect()
    from huggingface_hub import snapshot_download
    from transformers import AutoModelForCausalLM, AutoTokenizer
    for candidate in manifest["answer_candidates"]:
        start = perf_counter()
        local = snapshot_download(candidate["id"], revision=candidate["revision"],
                                  cache_dir=str(ROOT / ".cache" / "models"), local_files_only=True)
        verify_weights(Path(local), candidate["weights_sha256"])
        tokenizer = AutoTokenizer.from_pretrained(local, local_files_only=True, trust_remote_code=False)
        model = AutoModelForCausalLM.from_pretrained(local, local_files_only=True, trust_remote_code=False,
                                                   dtype=torch.float32).eval()
        cold_ms = (perf_counter() - start) * 1000
        durations, counts = [], []
        for question in [QUESTIONS[0], *QUESTIONS]:
            prompt = tokenizer.apply_chat_template([
                {"role": "system", "content": "Use only this evidence: Selecting a desk never holds inventory. Only admins approve online payment proofs. Answer briefly in the user's language."},
                {"role": "user", "content": question}], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            inputs = tokenizer(prompt, return_tensors="pt")
            start = perf_counter()
            with torch.inference_mode():
                generated = model.generate(**inputs, max_new_tokens=96, do_sample=False,
                                           pad_token_id=tokenizer.eos_token_id)
            durations.append((perf_counter() - start) * 1000)
            counts.append(generated.shape[-1] - inputs["input_ids"].shape[-1])
            # Generated text is held in memory only. A human quality run is still required.
            del generated, inputs
        print(json.dumps({"profile": "answer_model_microbenchmark", "model_id": candidate["id"],
                          "model_revision": candidate["revision"], "license": candidate["license"],
                          "runtime": candidate["runtime"], "cold_load_ms": cold_ms,
                          "peak_memory_bytes": peak_memory_bytes(),
                          "parameter_bytes": sum(p.numel() * p.element_size() for p in model.parameters()),
                          "languages": ["en", "tl", "taglish"], "generated_tokens": counts[1:],
                          "p50_ms": percentile(durations[1:], .5), "p95_ms": percentile(durations[1:], .95),
                          "quality": "NOT_REVIEWED", "release_evidence": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No exception message/traceback: model/library errors may contain input paths or text.
        print(json.dumps({"status": "FAILED", "error_code": "LOCAL_BENCHMARK_FAILED", "release_evidence": False}))
        raise SystemExit(1) from None
