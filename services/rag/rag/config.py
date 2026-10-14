"""SPEC-6 section 3: fail closed configuration, separate feature switches."""
from dataclasses import dataclass, field
import hashlib
import json
import re
from typing import Mapping

EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B"
REVISION = re.compile(r"^[a-f0-9]{40}$")


class ConfigurationError(ValueError):
    """Safe configuration code, never the rejected value or secret."""


def flag(env: Mapping[str, str], key: str) -> bool:
    value = env.get(key, "false")
    if value not in {"true", "false"}:
        raise ConfigurationError(f"INVALID_{key}")
    return value == "true"


def positive(env: Mapping[str, str], key: str, default: int) -> int:
    value = env.get(key, str(default))
    if not value.isascii() or not value.isdecimal() or int(value) < 1:
        raise ConfigurationError(f"INVALID_{key}")
    return int(value)


@dataclass(frozen=True)
class Configuration:
    enabled: bool
    knowledge_enabled: bool
    embedding_revision: str
    answer_model: str
    answer_revision: str
    signing_key: str = field(repr=False)
    service_key: str = field(repr=False)
    scope: str
    deadline_ms: int
    capacity: int
    queue_capacity: int
    context_budget: int
    fingerprint: str


def load_configuration(env: Mapping[str, str], manifest: dict) -> Configuration:
    enabled, knowledge = flag(env, "RAG_ENABLED"), flag(env, "KB_ENABLED")
    embedding = manifest["embedding"]
    if env.get("RAG_EMBEDDING_MODEL_ID", embedding["id"]) != EMBEDDING_MODEL or embedding["id"] != EMBEDDING_MODEL:
        raise ConfigurationError("INVALID_EMBEDDING_MODEL")
    if positive(env, "RAG_VECTOR_DIMENSIONS", 1024) != 1024 or embedding["dimensions"] != 1024:
        raise ConfigurationError("INVALID_VECTOR_DIMENSIONS")
    revision = env.get("RAG_EMBEDDING_REVISION", embedding["revision"])
    if not REVISION.fullmatch(revision) or revision != embedding["revision"]:
        raise ConfigurationError("INVALID_EMBEDDING_REVISION")
    fingerprint = hashlib.sha256(json.dumps(embedding, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if env.get("RAG_EMBEDDING_FINGERPRINT", fingerprint) != fingerprint:
        raise ConfigurationError("INVALID_EMBEDDING_FINGERPRINT")
    answer = env.get("RAG_ANSWER_MODEL_ID", "")
    answer_revision = env.get("RAG_ANSWER_REVISION", "")
    signing, service = env.get("RAG_CAPABILITY_SECRET", ""), env.get("RAG_SERVICE_TOKEN", "")
    scope = env.get("RAG_SCOPE_ID", "")
    if enabled or knowledge:
        if len(signing) < 32 or len(service) < 32 or signing == service:
            raise ConfigurationError("INVALID_SERVICE_CREDENTIALS")
        if not scope:
            raise ConfigurationError("MISSING_SERVER_SCOPE")
    if enabled:
        if not answer or not REVISION.fullmatch(answer_revision) or env.get("RAG_ANSWER_RUNTIME") != "transformers-cpu":
            raise ConfigurationError("MISSING_APPROVED_ANSWER_CONFIGURATION")
    # Limits below are engineering defaults for local evaluation, not product upload caps or an SLA.
    return Configuration(enabled, knowledge, revision, answer, answer_revision, signing, service, scope,
                         positive(env, "RAG_REQUEST_DEADLINE_MS", 15000),
                         positive(env, "RAG_CAPACITY", 1), positive(env, "RAG_QUEUE_CAPACITY", 5),
                         positive(env, "RAG_CONTEXT_BUDGET", 4096), fingerprint)
