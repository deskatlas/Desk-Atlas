"""QAD-TC46: control tests are not operational release acceptance evidence."""
import asyncio
import copy
import json
import math
from pathlib import Path
from time import monotonic
import pytest
from rag.capacity import Admission, CapacityBusy
from rag.config import ConfigurationError, load_configuration
from rag.encoder import validate_vectors
from rag.evaluation import DOCUMENT_TYPES, LANGUAGES, OPERATIONAL_CASES, evaluate_release, percentile, retrieval_scores
from rag.load import Outcome, measure_load
from rag.telemetry import metadata
from rag.artifacts import verify_weights

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "models.json").read_text(encoding="utf-8"))


def test_spec6_tc01_modified_weight_or_path_cannot_load(tmp_path):
    import hashlib
    path = tmp_path / "model.safetensors"
    path.write_bytes(b"synthetic model bytes")
    expected = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()}
    verify_weights(tmp_path, expected)
    path.write_bytes(b"modified bytes")
    with pytest.raises(ValueError, match="MODEL_WEIGHT_HASH_MISMATCH"):
        verify_weights(tmp_path, expected)
    with pytest.raises(ValueError, match="INVALID_MODEL_ARTIFACT"):
        verify_weights(tmp_path, {"../private": "0" * 64})


def test_spec6_tc01_configuration_is_disabled_and_reproducible():
    first = load_configuration({}, MANIFEST)
    assert not first.enabled and not first.knowledge_enabled
    assert len(first.fingerprint) == 64
    assert first.fingerprint == load_configuration({}, copy.deepcopy(MANIFEST)).fingerprint
    changed = copy.deepcopy(MANIFEST)
    changed["embedding"]["query_instruction_version"] += 1
    assert first.fingerprint != load_configuration({}, changed).fingerprint


@pytest.mark.parametrize("env", [
    {"RAG_ENABLED": "1"}, {"RAG_VECTOR_DIMENSIONS": "768"}, {"RAG_CAPACITY": "0"},
    {"RAG_CAPACITY": "NaN"}, {"RAG_EMBEDDING_REVISION": "main"},
    {"RAG_EMBEDDING_FINGERPRINT": "wrong"}, {"RAG_ENABLED": "true"}, {"KB_ENABLED": "true"},
])
def test_spec6_tc01_invalid_configuration_never_enables_runtime(env):
    with pytest.raises(ConfigurationError):
        load_configuration(env, MANIFEST)


def test_spec6_tc10_feature_switches_are_independent_without_answer_default():
    env = {"KB_ENABLED": "true", "RAG_CAPABILITY_SECRET": "s" * 32, "RAG_SERVICE_TOKEN": "k" * 32, "RAG_SCOPE_ID": "local"}
    settings = load_configuration(env, MANIFEST)
    assert settings.knowledge_enabled and not settings.enabled and not settings.answer_model
    assert "s" * 32 not in repr(settings)
    with pytest.raises(ConfigurationError, match="MISSING_APPROVED_ANSWER_CONFIGURATION"):
        load_configuration({**env, "RAG_ENABLED": "true"}, MANIFEST)


def test_spec6_tc01_vectors_require_complete_finite_normalized_dimensions():
    validate_vectors([[1.0] + [0.0] * 1023])
    for vector in [[1.0] * 1024, [0.0] * 1024, [1.0], [float("nan")] * 1024, [float("inf")] * 1024]:
        with pytest.raises(ValueError):
            validate_vectors([vector])


def test_spec6_tc03_deadline_cancel_and_capacity_recover_without_leaks():
    async def scenario():
        gate = Admission(1, 1)
        async with gate.acquire(monotonic() + 1):
            async def waiter():
                async with gate.acquire(monotonic() + 1):
                    pass
            waiting = asyncio.create_task(waiter())
            await asyncio.sleep(0)
            with pytest.raises(CapacityBusy):
                async with gate.acquire(monotonic() + 1):
                    pytest.fail("overflow accepted")
            waiting.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiting
            with pytest.raises(CapacityBusy):
                async with gate.acquire(monotonic() + 0.01):
                    pytest.fail("expired queue accepted")
        assert gate.admitted == 0
        async with gate.acquire(monotonic() + 1):
            assert gate.admitted == 1
    asyncio.run(scenario())


def test_spec6_tc04_ingestion_admission_is_separate():
    async def scenario():
        interactive, ingestion = Admission(1, 0), Admission(1, 0)
        async with ingestion.acquire(monotonic() + 1):
            async with interactive.acquire(monotonic() + 1):
                assert ingestion.admitted == interactive.admitted == 1
    asyncio.run(scenario())


def test_spec6_tc08_diagnostics_do_not_serialize_payload_or_exception():
    secret = "customer@example.com"
    request_id = "00000000-0000-4000-8000-000000000001"
    assert metadata(request_id=request_id, role="ADMIN", duration_ms=12, prompt=secret, response=secret,
                    signed_url="https://private/token", embedding=[1.0], error=Exception(secret),
                    error_code=secret, queue_ms=math.inf, status="FAILED") == {
        "request_id": request_id, "role": "ADMIN", "duration_ms": 12, "status": "FAILED"}
    assert metadata(error_code="ASecretToken", stage="CustomerName", role=["ADMIN"], status={"body": secret}) == {}


def complete_evidence(cases):
    revision = "a" * 40
    evidence = {"candidate_revision": revision, "thresholds": {"ratified": True},
                "operational_cases": [{"id": case, "status": "PASS", "candidate_revision": revision} for case in OPERATIONAL_CASES],
                "load": {"candidate_revision": revision, "profile": "warm_end_to_end", "concurrency": 5,
                         "failures": 0, "latencies_ms": [1000] * 5, "queue_ms": [1] * 5}}
    for key in ["security", "reporting", "source_lifecycle", "session_only", "unsupported"]:
        evidence[key] = {"candidate_revision": revision, "executed": 1, "failures": 0}
    observations = [{"id": case["id"], "retrieved_sources": case["expected_sources"],
                     "reviewer_accepted": True, "citations_valid": True, "dangerous_instruction": False,
                     "unsupported_claim": False, "behavior": case["expected_behavior"],
                     "tool": case.get("expected_tool"), "filters": case.get("filters"), "role": case.get("role"),
                     **({"table": case["expected_table"]} if "expected_table" in case else {})} for case in cases]
    return evidence, observations


def test_spec6_tc11_missing_evidence_fails_closed_and_does_not_expose_prompts():
    cases = json.loads((ROOT / "evaluation" / "held-out.json").read_text(encoding="utf-8"))
    result = evaluate_release({}, cases, [])
    assert not result["release_ready"] and "THRESHOLDS_NOT_RATIFIED" in result["reasons"]
    assert all(case["question"] not in json.dumps(result) for case in cases)
    evidence, observations = complete_evidence(cases)
    assert evaluate_release(evidence, cases, observations)["release_ready"]
    evidence["security"]["failures"] = 1
    assert "SECURITY_NOT_VERIFIED" in evaluate_release(evidence, cases, observations)["reasons"]


@pytest.mark.parametrize("fault", ["stale_revision", "unratified", "missing_case", "model_only", "slow", "unmeasured_queue", "unsafe", "incorrect_cell", "missing_observation"])
def test_spec6_tc11_no_silent_release_gate_relaxation(fault):
    cases = json.loads((ROOT / "evaluation" / "held-out.json").read_text(encoding="utf-8"))
    evidence, observations = complete_evidence(cases)
    if fault == "stale_revision": evidence["operational_cases"][0]["candidate_revision"] = "b" * 40
    if fault == "unratified": evidence["thresholds"]["ratified"] = False
    if fault == "missing_case": evidence["operational_cases"].pop()
    if fault == "model_only": evidence["load"]["profile"] = "answer_model_microbenchmark"
    if fault == "slow": evidence["load"]["latencies_ms"][-1] = 15001
    if fault == "unmeasured_queue": evidence["load"]["queue_ms"] = []
    if fault == "unsafe": observations[0]["dangerous_instruction"] = True
    if fault == "incorrect_cell":
        next(row for row in observations if "table" in row)["table"] = [["incorrect"]]
    if fault == "missing_observation": observations.pop()
    assert not evaluate_release(evidence, cases, observations)["release_ready"]


def test_spec6_tc11_recall_at_six_counts_missing_and_language_strata():
    cases = [{"id": "tl-1", "language": "tl", "document_type": "DOC", "expected_sources": ["correct"]},
             {"id": "en-1", "language": "en", "document_type": "MD", "expected_sources": ["correct"]}]
    scores = retrieval_scores(cases, [{"id": "en-1", "retrieved_sources": ["wrong"] * 6 + ["correct"]}])
    assert scores["overall"]["recall_at_6"] == 0
    assert scores["language:tl"]["count"] == 1


def test_spec6_tc03_real_parallel_harness_tracks_errors_and_missing_queue():
    async def scenario():
        active, peak = 0, 0
        async def execute(index):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            try:
                await asyncio.sleep(.01)
                if index == 3:
                    raise ValueError("private payload must not appear")
                return Outcome(index != 4, None if index == 5 else 2)
            finally:
                active -= 1
        report = await measure_load(execute, requests=10)
        assert peak == 5 and active == 0 and report["failures"] == 2
        assert len(report["latencies_ms"]) == 10 and len(report["queue_ms"]) == 8
        assert not report["queue_measurements_complete"] and "private" not in json.dumps(report)
    asyncio.run(scenario())


def test_spec6_tc11_nearest_rank_percentiles_and_invalid_measurements():
    assert percentile([1, 2, 3, 4, 100], .95) == 100
    assert percentile([], .95) is None
    for values in [[float("nan")], [-1], [float("inf")]]:
        with pytest.raises(ValueError): percentile(values, .95)
