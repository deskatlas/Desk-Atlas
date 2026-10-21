"""MS78-R03 / QAD-TC44/46: live booking facts are distinct from document evidence.

Only request-local safe facts enter this contract. Ownership, expiry and current
publication are checked by the gateway before invocation and final emission.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BookingFacts(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    status: Literal['UNKNOWN', 'PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PENDING_COUNTER_CONFIRMATION', 'CHECKED_IN', 'CONFIRMED',
                    'NEEDS_MANUAL_RESOLUTION', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'REJECTED']
    tracking_status: Literal['UNKNOWN', 'PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'CONFIRMED',
                    'NEEDS_MANUAL_RESOLUTION', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'REJECTED']
    channel: Literal['WEB', 'KIOSK']
    start_at: str | None = Field(max_length=64)
    end_at: str | None = Field(max_length=64)
    workspace: str | None = Field(max_length=300)
    payment_status: Literal['UNKNOWN', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']
    cancel: bool | Literal['UNKNOWN']
    reschedule: bool | Literal['UNKNOWN']
    relocation: bool | Literal['UNKNOWN']
    cancel_reason: Literal['UNAVAILABLE', 'ELIGIBLE_FOR_REVIEW', 'NOT_ELIGIBLE', 'STATUS_NOT_CONFIRMED',
                           'ALREADY_CHECKED_IN', 'COMPLETED', 'NO_SCHEDULE', 'START_PASSED', 'CUTOFF_PASSED']
    reschedule_reason: Literal['UNAVAILABLE', 'ELIGIBLE_FOR_REVIEW', 'NOT_ELIGIBLE',
                               'STATUS_NOT_CONFIRMED', 'RESCHEDULE_USED', 'NO_SCHEDULE', 'CUTOFF_PASSED']
    cancellation_cutoff_at: str | None = Field(max_length=64)
    reschedule_cutoff_at: str | None = Field(max_length=64)
    recovery: Literal['REVIEW_REQUIRED', 'UNKNOWN']


class BookingClaim(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: Literal['BOOKING_FACT']
    handle: str = Field(min_length=1, max_length=64)
    value: str | bool | None


class DocumentClaim(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: Literal['DOCUMENT']
    handle: str = Field(min_length=1, max_length=100)
    quote: str = Field(min_length=1, max_length=1500)


def validate_mixed_claims(facts: BookingFacts, claims: list[BookingClaim | DocumentClaim],
                          admitted_documents: dict[str, str]) -> bool:
    """No model-authored permission, previous answer or document can replace a fact.

    Document handles must refer to the gateway's current audience-filtered exact
    excerpts. This predicate does not grant access to arbitrary source handles.
    """
    if not 1 <= len(claims) <= 30:
        return False
    values = facts.model_dump()
    for claim in claims:
        if isinstance(claim, BookingClaim):
            if claim.handle not in values:
                return False
            actual = values[claim.handle]
            if type(actual) is not type(claim.value) or actual != claim.value:
                return False
        elif claim.handle not in admitted_documents or claim.quote not in admitted_documents[claim.handle]:
            return False
    return True
