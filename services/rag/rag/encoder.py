"""SPEC6-TC01: pinned offline Qwen encoder, never silently truncate input."""
import math
import importlib.metadata
from pathlib import Path
from .artifacts import verify_weights


def preload_runtime():
    # Windows native imports must complete before the serving event loop starts.
    # Module caching reuses these approved dependencies inside Encoder.
    import torch
    from sentence_transformers import SentenceTransformer
    return torch, SentenceTransformer


def validate_vectors(vectors: list[list[float]]) -> None:
    if not vectors:
        raise ValueError("EMPTY_EMBEDDING_RESULT")
    for vector in vectors:
        if len(vector) != 1024 or not all(math.isfinite(value) for value in vector):
            raise ValueError("INVALID_EMBEDDING_VECTOR")
        if abs(math.sqrt(sum(value * value for value in vector)) - 1) > 0.001:
            raise ValueError("INVALID_EMBEDDING_NORM")


class Encoder:
    def __init__(self, manifest: dict, cache: Path):
        model = manifest["embedding"]
        for name, expected in model["runtime_versions"].items():
            if importlib.metadata.version(name.replace("_", "-")).split("+")[0] != expected:
                raise ValueError("ENCODER_RUNTIME_MISMATCH")
        if (model["tokenizer_revision"] != model["revision"] or model["dimensions"] != 1024
                or model["normalization"] != "l2" or model["representation"] != "float32-cpu"):
            raise ValueError("ENCODER_CONFIGURATION_MISMATCH")
        torch, SentenceTransformer = preload_runtime()
        from huggingface_hub import snapshot_download
        local = snapshot_download(model["id"], revision=model["revision"],
                                  cache_dir=str(cache), local_files_only=True)
        verify_weights(Path(local), model["weights_sha256"])
        self._model = SentenceTransformer(local, device="cpu", local_files_only=True,
                                          trust_remote_code=False, model_kwargs={"dtype": torch.float32})
        self._instruction = model["query_instruction"]
        self._model.max_seq_length = model["max_input_tokens"]

    def encode(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        if not texts or any(not text.strip() for text in texts):
            raise ValueError("EMPTY_EMBEDDING_INPUT")
        prompt = self._instruction if query else ""
        for text in texts:
            if len(self._model.tokenizer.encode(prompt + text, add_special_tokens=True)) > self._model.max_seq_length:
                raise ValueError("EMBEDDING_INPUT_TOO_LONG")
        vectors = self._model.encode(texts, prompt=prompt, normalize_embeddings=True,
                                     batch_size=1, show_progress_bar=False).tolist()
        validate_vectors(vectors)
        return vectors
