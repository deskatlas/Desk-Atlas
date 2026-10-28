"""SDD-C21 / QAD-TC44/46: compact provisional output, unchanged verification."""
from typing import Annotated, get_args
import copy
import re

from pydantic import Field, create_model

from .document_support import Strict, DraftFragment, Composition, BUDGET


class StableCustomerClaim(Strict):
    t: str = Field(min_length=1, max_length=1800)
    p: list[Annotated[int, Field(ge=0, lt=BUDGET['units'])]] = Field(min_length=1, max_length=3)


StableCustomerDraft = create_model('CompactDraft', __base__=Strict,
    s=(Composition.model_fields['scope'].annotation, ...),
    b=(list[StableCustomerClaim], Field(max_length=12)))


def compact_draft_schema(schema, *, customer=False):
    if customer:
        # Customer-only candidate; restore_draft still applies the actual
        # source bounds before any proposed claim reaches verification/release.
        return StableCustomerDraft
    # Keep the original source-specific numeric bounds in the provider grammar
    # as well as canonical validation. Large generic bounds can let the model
    # confuse printed FAQ numbers with valid canonical evidence addresses.
    claim = get_args(schema.model_fields['blocks'].annotation)[0]
    compact_claim = create_model('CompactClaim', __base__=Strict,
        t=(str, Field(min_length=1, max_length=1800)),
        p=(claim.model_fields['support'].annotation, copy.deepcopy(claim.model_fields['support'])))
    return create_model('CompactDraft', __base__=Strict,
        s=(schema.model_fields['scope'].annotation, ...),
        b=(list[compact_claim], Field(max_length=12)))


def restore_draft(value, schema):
    return schema(scope=value.s, blocks=[{'kind': 'text', 'text': block.t, 'support': block.p}
                                       for block in value.b])


NO_HOLD = re.compile(r"\b(?:(?:does|do|will|can)(?: not|n['’]t)\s+(?:hold|reserve|secure)|never\s+(?:hold|reserve|secure)|no inventory holds?)\b", re.I)


def preserve_booking_boundary(query, fragments, units):
    """Add an omitted exact original rule BEFORE independent verification."""
    flow = re.search(r'\b(?:how (?:do|can|should) (?:i|we|you) (?:book|reserve)|how to (?:book|reserve)|booking process|make (?:a )?reservation|paano.{0,50}(?:book|reserba))\b', query, re.I)
    if not flow or NO_HOLD.search('\n'.join(block.text for block in fragments)):
        return fragments
    for unit in units:
        if NO_HOLD.search(unit['text']) and re.search(r'\b(inventory|workspace|desk|unit|spot|reservation)s?\b', unit['text'], re.I):
            return [*fragments, DraftFragment(text=unit['text'], support=[unit['i']])]
    return fragments
