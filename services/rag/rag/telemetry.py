"""SPEC6-TC08: construct metadata; never serialize arbitrary exception/payloads."""
import math
import re
from uuid import UUID

_REVISION = re.compile(r"^[a-f0-9]{40}$|^[a-f0-9]{64}$")
_ERRORS = {"CAPACITY_BUSY", "REQUEST_TIMEOUT", "MODEL_UNAVAILABLE", "DATA_UNAVAILABLE", "KNOWLEDGE_CHANGED",
           "INVALID_CAPABILITY", "AUTH_REQUIRED", "FORBIDDEN", "INVALID_REQUEST", "PARSER_FAILED",
           "STORAGE_FAILED", "EMBEDDING_FAILED", "MANIFEST_INVALID", "RESOURCE_LIMIT"}
_STAGES = {"VALIDATE", "CONVERT", "EXTRACT", "OCR", "NORMALIZE", "CHUNK", "EMBED", "VERIFY", "NOTIFY", "PURGE"}
_COUNTS = {"duration_ms", "queue_ms", "token_count", "chunk_count", "queue_depth", "peak_memory_bytes"}


def metadata(**values) -> dict:
    result = {}
    for key, value in values.items():
        if key in {"request_id", "job_id"} and isinstance(value, str):
            try:
                result[key] = str(UUID(value))
            except ValueError:
                pass
        elif key in {"model_revision", "config_revision"} and isinstance(value, str) and _REVISION.fullmatch(value):
            result[key] = value
        elif key == "error_code" and isinstance(value, str) and value in _ERRORS:
            result[key] = value
        elif key == "stage" and isinstance(value, str) and value in _STAGES:
            result[key] = value
        elif key in _COUNTS and type(value) in {int, float} and math.isfinite(value) and value >= 0:
            result[key] = value
        elif key == "role" and isinstance(value, str) and value in {"ADMIN", "STAFF"}:
            result[key] = value
        elif key == "status" and isinstance(value, str) and value in {"SUCCEEDED", "FAILED", "CANCELLED", "CAPACITY_BUSY"}:
            result[key] = value
    return result
