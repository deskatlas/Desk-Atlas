"""QAD-TC46 / SPEC6-TC11: fail closed release evidence and stratified metrics."""
import math
import json

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
        if len(matches) != 1 or matches[0].get("status") != "PASS" or matches[0].get("candidate_revision") != revision:
            reasons.append(case_id + "_NOT_VERIFIED")
    for key in ["security", "reporting", "source_lifecycle", "session_only", "unsupported"]:
        gate = evidence.get(key, {})
        if (type(gate.get("executed")) is not int or gate["executed"] <= 0
                or type(gate.get("failures")) is not int or gate["failures"] != 0
                or gate.get("candidate_revision") != revision):
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
    for case in cases:
        observed = observations_by_id.get(case["id"], {})
        if observed.get("dangerous_instruction") is not False or observed.get("unsupported_claim") is not False:
            reasons.append("UNSAFE_OR_UNREVIEWED_ANSWER")
        if observed.get("behavior") != case["expected_behavior"]:
            reasons.append("BEHAVIOR_MISMATCH")
        if observed.get("tool") != case.get("expected_tool") or observed.get("filters") != case.get("filters"):
            reasons.append("TOOL_FILTER_MISMATCH")
        if observed.get("role") != case.get("role"):
            reasons.append("ROLE_MISMATCH")
        if "expected_table" in case and json.dumps(observed.get("table"), sort_keys=True) != json.dumps(case["expected_table"], sort_keys=True):
            reasons.append("REPORT_CELL_MISMATCH")
        if observed.get("reviewer_accepted") is True and observed.get("citations_valid") is True:
            accepted += 1
    acceptance = accepted / len(cases)
    if acceptance < minimum_acceptance:
        reasons.append("ANSWER_QUALITY_BELOW_TARGET")
    load = evidence.get("load", {})
    samples = load.get("latencies_ms", [])
    queue = load.get("queue_ms", [])
    p95 = percentile(samples, 0.95)
    if (load.get("candidate_revision") != revision or load.get("concurrency") != 5
            or load.get("profile") != "warm_end_to_end" or load.get("failures") != 0
            or len(samples) < 5 or len(queue) != len(samples) or p95 is None or p95 > maximum_latency):
        reasons.append("FIVE_USER_LOAD_NOT_VERIFIED")
    return {"release_ready": not reasons, "reasons": sorted(set(reasons)), "retrieval": scores,
            "reviewer_acceptance": acceptance, "p50_ms": percentile(samples, 0.50), "p95_ms": p95,
            "queue_p95_ms": percentile(queue, 0.95)}
