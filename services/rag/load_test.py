"""Local synthetic gateway load, with bearer token supplied only via environment."""
import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4
import httpx
from rag.load import Outcome, measure_load


async def run(url: str, cases: list[dict], requests: int):
    tokens = json.loads(os.environ.get("RAG_BENCHMARK_AUTHORIZATIONS", "[]"))
    if (not isinstance(tokens, list) or len(tokens) != 5 or any(not isinstance(token, str)
            or not token.startswith("Bearer ") for token in tokens) or len(set(tokens)) != 5):
        raise ValueError("FIVE_DISTINCT_TEST_ACTORS_REQUIRED")
    # No redirects or environment proxy credentials; only the explicitly configured origin.
    async with httpx.AsyncClient(follow_redirects=False, trust_env=False, timeout=30) as client:
        async def execute(index):
            case = cases[index % len(cases)]
            response = await client.post(url, headers={"Authorization": tokens[index % 5],
                                          "Origin": f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"},
                                         json={"session_id": str(uuid4()), "request_id": str(uuid4()),
                                               "message": case["question"]})
            if response.status_code != 200:
                return Outcome(False, None)
            data = response.json().get("data", {})
            correct = data.get("kind") == case["expected_behavior"]
            if "expected_table" in case:
                correct = correct and data.get("tables") == case["expected_table"]
            queue_header = response.headers.get("x-rag-queue-ms")
            queue_ms = float(queue_header) if queue_header is not None else None
            return Outcome(correct, queue_ms)

        # Warm-up is explicit and excluded from the measured warm workload.
        await asyncio.gather(*(execute(index) for index in range(5)))
        return await measure_load(execute, requests=requests)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:3000/api/assistant/query")
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--requests", type=int, default=100)
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        parser.error("Only an explicit local gateway URL without credentials/query is permitted")
    try:
        cases = json.loads(args.cases.read_text(encoding="utf-8"))
        if not cases or any(case.get("synthetic") is not True for case in cases):
            raise ValueError("SYNTHETIC_CASES_REQUIRED")
        result = asyncio.run(run(args.url, cases, args.requests))
    except Exception:
        print(json.dumps({"status": "FAILED", "error_code": "LOAD_TEST_FAILED"}))
        return 1
    print(json.dumps({**result, "release_evidence": False, "identity_verified": False}, allow_nan=False))
    return 0 if result["failures"] == 0 and result["queue_measurements_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
