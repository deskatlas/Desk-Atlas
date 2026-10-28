"""SDD-C21 / QAD-TC44: source-first proposals remain independently verified."""
from typing import Annotated, Literal

from pydantic import Field, create_model

from rag.document_support import Composition, Strict


class SourceFirstDraft(Strict):
    # Planning addresses are proposals, not evidence of their own completeness.
    normal_modes: list[str] = Field(max_length=8)
    decision_rules: list[int] = Field(max_length=32)
    scope: Literal['FACTUAL', 'MULTI_PART', 'RECOMMENDATION', 'COMPLETE_PROCEDURE', 'DOCUMENT_WIDE']
    blocks: list[dict]


def draft_schema(unit_count):
    address = Annotated[int, Field(ge=0, lt=unit_count)]
    claim = create_model('OriginalFirstClaim', __base__=Strict,
        support=(list[address], Field(min_length=1, max_length=3)),
        kind=(Literal['text', 'bullet', 'step'], ...),
        text=(str, Field(min_length=1, max_length=1800)))
    return create_model('SourceFirstComposition', __base__=SourceFirstDraft,
        normal_modes=(list[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=8)),
        decision_rules=(list[address], Field(max_length=32)),
        blocks=(list[claim], Field(max_length=12)))


def composition(candidate):
    return Composition(scope=candidate.scope, blocks=[block.model_dump() for block in candidate.blocks])
