"""QAD-TC46 / SPEC6-TC11: fail closed release evidence and stratified metrics."""
import math
import json
from .identity import canonical_digest, valid_identity

LANGUAGES = {"en", "tl", "taglish"}
DOCUMENT_TYPES = {"MD", "DOC", "DOCX", "PDF_TEXT", "PDF_SCAN", "PDF_MIXED"}
OPERATIONAL_CASES = {f"SPEC6-TC{index:02d}" for index in range(1, 13)}


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    if any(type(value) not in {int, float} or not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("INVALID_MEASUREMENT")
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def retrieval_scores(cases: list[dict], observations: list[dict]) -> dict:
    indexed = {}
    for observation in observations:
        if observation["id"] in indexed:
            raise ValueError("DUPLICATE_OBSERVATION")
        indexed[observation["id"]] = observation
    groups: dict[str, list[float]] = {}
    for case in cases:
        if not case["expected_sources"]:
            continue
        expected = set(case["expected_sources"])
        observed = indexed.get(case["id"], {})
        # A missing result is zero recall, never excluded from the denominator.
        found = set(observed.get("retrieved_sources", [])[:6])
        score = len(expected & found) / len(expected)
        for group in ["overall", "language:" + case["language"], "type:" + case["document_type"]]:
            groups.setdefault(group, []).append(score)
    return {key: {"count": len(scores), "recall_at_6": sum(scores) / len(scores)}
            for key, scores in groups.items()}


def evaluate_release(evidence: dict, cases: list[dict], observations: list[dict]) -> dict:
    """Evidence must be from one candidate revision; synthetic harness tests cannot stand in for it."""
    reasons = []
    identity = evidence.get("identity")
    identity_ok = valid_identity(identity)
    if not identity_ok:
        reasons.append("MISSING_RUN_IDENTITY")
    elif identity["case_set_digest"] != canonical_digest(cases) or identity["candidate_revision"] != evidence.get("candidate_revision"):
        reasons.append("RUN_IDENTITY_MISMATCH")
    for observed in observations:
        if not identity_ok or observed.get("identity") != identity:
            reasons.append("OBSERVATION_IDENTITY_MISMATCH")
    records_by_id = {}
    for record in evidence.get("gate_records", []):
        if not isinstance(record, dict) or not isinstance(record.get("id"), str) or record["id"] in records_by_id:
            reasons.append("INVALID_GATE_RECORDS")
            continue
        records_by_id[record["id"]] = record
    def verified_gate(gate, gate_id):
        refs = gate.get("record_ids", [])
        return (identity_ok and gate.get("identity") == identity and isinstance(refs, list) and bool(refs)
                and all(isinstance(ref, str) for ref in refs) and len(set(refs)) == len(refs)
                and all(ref in records_by_id and records_by_id[ref].get("identity") == identity
                        and records_by_id[ref].get("status") == "PASS" and records_by_id[ref].get("gate") == gate_id for ref in refs))
    if evidence.get("semantic_review", {}).get("complete") is not True or not verified_gate(evidence.get("semantic_review", {}), "semantic_review"):
        reasons.append("SEMANTIC_REVIEW_PENDING")
    for key in ("runtime_identity", "real_pgvector", "private_storage", "parser_container", "topology", "cancellation_recovery", "privacy", "rollback", "substantive_lint"):
        if not verified_gate(evidence.get(key, {}), key):
            reasons.append(key.upper() + "_NOT_VERIFIED")
    profile_results, profile_reasons = evaluate_profiles(evidence.get("profiles", {}), identity, cases)
    reasons.extend(profile_reasons)
    for profile, maximum in (("repeat", 10000), ("five", 15000), ("ingestion", 15000)):
        if profile_results[profile]["valid_p95_ms"] is None or profile_results[profile]["valid_p95_ms"] > maximum:
            reasons.append(profile.upper() + "_LATENCY_NOT_VERIFIED")
    revision = evidence.get("candidate_revision")
    if not isinstance(revision, str) or len(revision) != 40 or any(ch not in "0123456789abcdef" for ch in revision):
        reasons.append("MISSING_CANDIDATE_REVISION")
    thresholds = evidence.get("thresholds", {})
    if thresholds.get("ratified") is not True:
        reasons.append("THRESHOLDS_NOT_RATIFIED")
    minimum_recall = thresholds.get("recall_at_6", 0.95)
    minimum_acceptance = thresholds.get("reviewer_acceptance", 0.90)
    maximum_latency = thresholds.get("warm_p95_ms", 15000)
    if (type(minimum_recall) not in {int, float} or not math.isfinite(minimum_recall) or not 0 < minimum_recall <= 1
            or type(minimum_acceptance) not in {int, float} or not math.isfinite(minimum_acceptance)
            or not 0 < minimum_acceptance <= 1 or type(maximum_latency) not in {int, float}
            or not math.isfinite(maximum_latency) or maximum_latency <= 0):
        raise ValueError("INVALID_THRESHOLDS")
    records = evidence.get("operational_cases", [])
    for case_id in sorted(OPERATIONAL_CASES):
        matches = [record for record in records if record.get("id") == case_id]
        if len(matches) != 1 or matches[0].get("status") != "PASS" or matches[0].get("candidate_revision") != revision or not verified_gate(matches[0], case_id):
            reasons.append(case_id + "_NOT_VERIFIED")
    for key in ["security", "reporting", "source_lifecycle", "session_only", "unsupported"]:
        gate = evidence.get(key, {})
        if (type(gate.get("executed")) is not int or gate["executed"] <= 0
                or type(gate.get("failures")) is not int or gate["failures"] != 0
                or gate.get("candidate_revision") != revision or not verified_gate(gate, key)):
            reasons.append(key.upper() + "_NOT_VERIFIED")
    if not cases or len({case["id"] for case in cases}) != len(cases):
        raise ValueError("INVALID_EVALUATION_SET")
    if any(case.get("split") != "held_out" for case in cases):
        reasons.append("HELD_OUT_SET_REQUIRED")
    if not LANGUAGES.issubset({case["language"] for case in cases}):
        reasons.append("MISSING_LANGUAGE_COVERAGE")
    if not DOCUMENT_TYPES.issubset({case["document_type"] for case in cases if case["expected_sources"]}):
        reasons.append("MISSING_DOCUMENT_TYPE_COVERAGE")
    scores = retrieval_scores(cases, observations)
    if not scores or any(group["recall_at_6"] < minimum_recall for group in scores.values()):
        reasons.append("RETRIEVAL_BELOW_TARGET")
    observed_ids = [result["id"] for result in observations]
    if set(observed_ids) != {case["id"] for case in cases} or len(observed_ids) != len(set(observed_ids)):
        reasons.append("INCOMPLETE_OBSERVATIONS")
    observations_by_id = {result["id"]: result for result in observations}
    accepted = 0
    attempts = set()
    acceptance_groups = {}
    for case in cases:
        observed = observations_by_id.get(case["id"], {})
        attempt = observed.get("attempt_id")
        if not isinstance(attempt, str) or not attempt or attempt in attempts or observed.get("language") != case["language"] or observed.get("profile") != "held_out":
            reasons.append("INVALID_OBSERVATION_CONTEXT")
        if isinstance(attempt, str):
            attempts.add(attempt)
        if observed.get("dangerous_instruction") is not False or observed.get("unsupported_claim") is not False:
            reasons.append("UNSAFE_OR_UNREVIEWED_ANSWER")
        if "expected_outcome" in case and observed.get("outcome") != case["expected_outcome"]:
            reasons.append("EXPECTED_OUTCOME_MISMATCH")
        if observed.get("behavior") != case["expected_behavior"]:
            reasons.append("BEHAVIOR_MISMATCH")
        if observed.get("tool") != case.get("expected_tool") or observed.get("filters") != case.get("filters"):
            reasons.append("TOOL_FILTER_MISMATCH")
        if observed.get("role") != case.get("role"):
            reasons.append("ROLE_MISMATCH")
        if "expected_table" in case and json.dumps(observed.get("table"), sort_keys=True) != json.dumps(case["expected_table"], sort_keys=True):
            reasons.append("REPORT_CELL_MISMATCH")
        if observed.get("procedure_complete") is not True or observed.get("language_reviewed") is not True:
            reasons.append("INCOMPLETE_OR_UNREVIEWED_PROCEDURE")
        approved = (observed.get("reviewer_accepted") is True and observed.get("citations_valid") is True
                    and observed.get("procedure_complete") is True and observed.get("language_reviewed") is True)
        accepted += int(approved)
        for group in ("language:" + case["language"], "type:" + case["document_type"]):
            acceptance_groups.setdefault(group, []).append(int(approved))
    acceptance = accepted / len(cases)
    if acceptance < minimum_acceptance or any(sum(values) / len(values) < minimum_acceptance for values in acceptance_groups.values()):
        reasons.append("ANSWER_QUALITY_BELOW_TARGET")
    load = evidence.get("load", {})
    samples = load.get("latencies_ms", [])
    queue = load.get("queue_ms", [])
    five = evidence.get("profiles", {}).get("five", [])
    if (samples != [record.get("duration_ms") for record in five if isinstance(record, dict)]
            or queue != [record.get("queue_ms") for record in five if isinstance(record, dict)]):
        reasons.append("LOAD_AGGREGATE_RECORD_MISMATCH")
    p95 = percentile(samples, 0.95)
    if (load.get("candidate_revision") != revision or load.get("concurrency") != 5
            or load.get("profile") != "warm_end_to_end" or load.get("failures") != 0
            or not verified_gate(load, "load") or len(samples) < 100 or len(queue) != len(samples) or p95 is None or p95 > maximum_latency):
        reasons.append("FIVE_USER_LOAD_NOT_VERIFIED")
    return {"release_ready": not reasons, "reasons": sorted(set(reasons)), "retrieval": scores,
            "reviewer_acceptance": acceptance, "p50_ms": percentile(samples, 0.50), "p95_ms": p95,
            "queue_p95_ms": percentile(queue, 0.95), "profiles": profile_results,
            "quality_strata": {key: {"count": len(values), "acceptance": sum(values) / len(values)} for key, values in acceptance_groups.items()}}


OUTCOMES = {"valid_answer", "valid_expected_outcome", "expected_gap", "expected_refusal", "conflict", "schema_failure", "quality_failure",
            "timeout", "cancelled", "unavailable", "capacity_rejection", "auth_failure", "transport_failure"}


def evaluate_profiles(profiles, identity, cases):
    case_index = {case["id"]: case for case in cases}
    """MS46-TC12/18: attempted outcomes retained; only valid answers improve latency."""
    reasons, summaries = [], {}
    for profile in ("repeat", "representative", "cold", "five", "ingestion"):
        records = profiles.get(profile, [])
        valid = isinstance(records, list) and bool(records) and valid_identity(identity)
        ids = set()
        batches = {}
        languages = {language: 0 for language in LANGUAGES}
        durations, successful, queue = [], [], []
        if not isinstance(records, list):
            records = []
        for record in records:
            if not isinstance(record, dict):
                valid = False
                continue
            key = record.get("attempt_id")
            if not isinstance(key, str) or key in ids:
                valid = False
            ids.add(key) if isinstance(key, str) else None
            elapsed, waiting = record.get("duration_ms"), record.get("queue_ms")
            if (record.get("identity") != identity or record.get("profile") != profile
                    or record.get("language") not in LANGUAGES or record.get("role") not in {"ADMIN", "STAFF"}
                    or record.get("outcome") not in OUTCOMES or not isinstance(record.get("case_id"), str)
                    or type(elapsed) not in {int, float} or not math.isfinite(elapsed) or elapsed < 0
                    or type(waiting) not in {int, float} or not math.isfinite(waiting) or waiting < 0):
                valid = False
                continue
            case = case_index.get(record['case_id'])
            if not case or record['role'] != case['role'] or record['language'] != case['language']:
                valid = False
            durations.append(elapsed)
            queue.append(waiting)
            languages[record["language"]] += 1
            if record["outcome"] == "valid_answer":
                successful.append(elapsed)
            if profile in {"five", "ingestion"}:
                batch, slot = record.get("batch_id"), record.get("actor_slot")
                if type(batch) is not int or batch < 0 or type(slot) is not int or not 0 <= slot < 5:
                    valid = False
                else:
                    batches.setdefault(batch, []).append(slot)
                if profile == "ingestion" and record.get("ingestion_active") is not True:
                    valid = False
        if profile in {"five", "ingestion"} and (len(records) < 100 or len(batches) < 20 or any(sorted(slots) != list(range(5)) for slots in batches.values())):
            valid = False
        if profile == "representative" and any(count < 30 for count in languages.values()):
            valid = False
        if profile == "repeat" and (len(records) < 30 or len({r.get("case_id") for r in records if isinstance(r, dict)}) != 1):
            valid = False
        if profile == "cold" and (len(records) < 5 or any(not r.get("reset_id") for r in records if isinstance(r, dict))
                                  or len({r.get("reset_id") for r in records if isinstance(r, dict)}) != len(records)):
            valid = False
        if any(record.get("outcome") not in {"valid_answer", "valid_expected_outcome", "expected_gap", "expected_refusal", "conflict"} for record in records if isinstance(record, dict)):
            reasons.append(profile.upper() + "_PROFILE_HAS_FAILURES")
        if profile == "repeat" and len(successful) < 30:
            valid = False
        if profile == "representative" and any(not any(record.get("language") == language and record.get("outcome") == "valid_answer" for record in records if isinstance(record, dict)) for language in LANGUAGES):
            valid = False
        if not valid:
            reasons.append(profile.upper() + "_PROFILE_INCOMPLETE")
        summaries[profile] = {"attempts": len(records), "valid_answers": len(successful),
                              "valid_p50_ms": percentile(successful, .5), "valid_p95_ms": percentile(successful, .95),
                              "all_p95_ms": percentile(durations, .95), "queue_p95_ms": percentile(queue, .95)}
    return summaries, reasons
