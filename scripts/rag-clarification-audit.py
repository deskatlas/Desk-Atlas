"""QAD-TC44 / PRD-F26: clarification replay, no model or database calls.

Synthetic replay of the malformed clarification class observed in the browser.
Exit 1 while declarative model analysis can replace a supported answer.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "rag"))
from app import ApplicabilityDecision, RequestedSupport, ScopeDecision
from pydantic import ValidationError

try:
    decision = ApplicabilityDecision(
        conditions=["Staff asking about online payment approval"],
        direct_answer="Only administrators approve online payment proofs.",
        scope="FACTUAL",
        parts=[RequestedSupport(request="Permission to approve online payment", p=[0])],
        clarification="The user wants permission to confirm an online payment.",
        conflict=False,
    )
    selection = ScopeDecision(
        assessment="Original requested conditions reconciled.",
        scope=decision.scope,
        parts=decision.parts,
        clarification=decision.clarification,
        conflict=decision.conflict,
    ).selection()
    admitted = selection.ambiguous and not selection.passages
except ValidationError:
    admitted = False
print(json.dumps({"synthetic_replay": True,
                  "malformed_clarification_admitted": admitted,
                  "supported_passages_discarded": admitted,
                  "passed": not admitted}))
raise SystemExit(1 if admitted else 0)
