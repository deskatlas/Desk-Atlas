import pytest
from pydantic import ValidationError
from customer_booking_evidence import BookingFacts, BookingClaim, DocumentClaim, validate_mixed_claims


def facts():
    return BookingFacts(status='CONFIRMED', tracking_status='CONFIRMED', channel='WEB', start_at=None, end_at=None,
        workspace=None, payment_status='APPROVED', cancel=False, reschedule='UNKNOWN',
        relocation=False, cancel_reason='NOT_ELIGIBLE', reschedule_reason='UNAVAILABLE',
        cancellation_cutoff_at=None, reschedule_cutoff_at=None, recovery='UNKNOWN')


def test_mixed_evidence_has_separate_exact_fact_and_document_handles():
    claims = [BookingClaim(kind='BOOKING_FACT', handle='status', value='CONFIRMED'),
              DocumentClaim(kind='DOCUMENT', handle='source-1', quote='Review the booking first.')]
    assert validate_mixed_claims(facts(), claims, {'source-1': 'Review the booking first.'})
    assert not validate_mixed_claims(facts(), claims, {})


@pytest.mark.parametrize('handle,value', [('cancel', True), ('reschedule', True),
    ('payment_status', 'REFUNDED'), ('status', 'CANCELLED'), ('email', 'guest@example.test')])
def test_policy_or_model_cannot_override_backend_permissions(handle, value):
    assert not validate_mixed_claims(facts(), [BookingClaim(kind='BOOKING_FACT', handle=handle, value=value)], {})


def test_private_fields_and_fake_refund_enums_are_not_valid_facts():
    with pytest.raises(ValidationError):
        BookingFacts.model_validate({**facts().model_dump(), 'access_token': 'private'})
    with pytest.raises(ValidationError):
        BookingFacts.model_validate({**facts().model_dump(), 'payment_status': 'PROCESSING'})
    with pytest.raises(ValidationError):
        BookingFacts.model_validate({**facts().model_dump(), 'cancel': 1})


def test_unpublished_or_foreign_policy_handles_and_changed_quotes_are_rejected():
    claim = DocumentClaim(kind='DOCUMENT', handle='foreign', quote='Approved immediately')
    assert not validate_mixed_claims(facts(), [claim], {'public': 'Review required'})
    assert not validate_mixed_claims(facts(), [claim], {'foreign': 'Review required'})
