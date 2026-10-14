"""SPEC6-TC11 CLI: output aggregates only, nonzero exit with incomplete evidence."""
import argparse
import json
from pathlib import Path
from rag.evaluation import evaluate_release


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--observations", required=True, type=Path)
    parser.add_argument("--cases", type=Path, default=Path(__file__).parent / "evaluation" / "held-out.json")
    args = parser.parse_args()
    try:
        result = evaluate_release(json.loads(args.evidence.read_text(encoding="utf-8")),
                                  json.loads(args.cases.read_text(encoding="utf-8")),
                                  json.loads(args.observations.read_text(encoding="utf-8")))
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({"release_ready": False, "reasons": ["INVALID_EVIDENCE"]}))
        return 1
    print(json.dumps(result, allow_nan=False))
    return 0 if result["release_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
