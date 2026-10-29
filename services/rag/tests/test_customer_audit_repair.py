"""PRD-F26 / SDD-C21 / QAD-TC44/46: October 29 customer audit regressions."""
import asyncio
import hashlib

import pytest
from pydantic import ValidationError
from rag.document_support import composition_schema, Verification
from rag.draft_transport import compact_draft_schema
from rag.batched_support import batched_document_answer


def test_product_introduction_is_an_overview_without_narrowing_joint_policy_questions():
    from customer_public import product_orientation, catalog_interpretation_schema
    from rag.draft_transport import overview_requested
    question = 'Hi! I have never been here before. What is DeskAtlas and how does it work?'
    assert product_orientation(question)
    assert overview_requested(question)
    assert not product_orientation('What is DeskAtlas and what are the cancellation rules and prices?')
    schema = catalog_interpretation_schema(3, 1)
    with pytest.raises(ValidationError):
        schema(kind='KNOWLEDGE', search_query=question, comparison_names=[], primaries=[0, 1], dependencies=[])


def test_website_booking_scope_keeps_one_workflow_but_preserves_joint_requests():
    from customer_public import website_booking_task
    assert website_booking_task('How do I book and pay? Do I need an account, and when is my desk actually confirmed?')
    assert not website_booking_task('How do I book and cancel or request a refund?')
    assert not website_booking_task('How do I book at the kiosk?')


def test_customer_wire_schema_rejects_nonexistent_source_addresses_before_generation():
    schema = compact_draft_schema(composition_schema(2, 3), customer=True)
    with pytest.raises(ValidationError):
        schema(s='FACTUAL', b=[{'t': 'Use the kiosk.', 'p': [2]}])
    assert schema(s='FACTUAL', b=[{'t': 'Use the kiosk.', 'p': [1]}]).b[0].p == [1]


def test_current_catalog_is_separate_from_original_policy_and_seen_by_both_passes(monkeypatch):
    monkeypatch.setattr('rag.batched_support.token_count', lambda text: len(text.encode()))
    text = 'Sky Booth is advertised as soundproof. Reference capacity: two people.'
    source = {'chunk_id': 'one', 'heading_path': 'Workspace', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    facts = [{'template_id': 'unit', 'name': 'Sky Booth', 'capacity': 1, 'hourly_rate': 100}]
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data)
        assert 'Reference capacity: two people.' in str(data['units'])
        if 'answer' not in data:
            assert data['workspace_catalog'] == facts
            return schema(scope='RECOMMENDATION', blocks=[{'kind': 'text',
                'text': 'Sky Booth (two people) is advertised as soundproof.', 'support': [0]}])
        assert 'workspace_catalog' not in data
        assert data['answer']['blocks'][0]['text'] == 'Sky Booth is advertised as soundproof.'
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(batched_document_answer('A video call room?', [source], generate,
        actor_role='PUBLIC_VISITOR', customer_reference=True, workspace_catalog=facts))
    assert result['outcome'] == 'COMPLETE'
    assert len(seen) == 2


def test_capacity_reconciliation_changes_only_named_positive_capacity_labels():
    from rag.draft_transport import reconcile_catalog_capacities
    facts = [{'name': 'Sky Booth', 'capacity': 1}]
    assert reconcile_catalog_capacities('Sky Booth (two people) is soundproof.', facts) == 'Sky Booth is soundproof.'
    assert reconcile_catalog_capacities('Sky Booth is a private two-person room.', facts) == 'Sky Booth is a private room.'
    text = 'Sky Booth is not suitable for two people. Quiet desks prohibit calls.'
    assert reconcile_catalog_capacities(text, facts) == text


@pytest.mark.parametrize('text', ['QR Payment confirms your booking.', 'Choose QR Payment. It grants access.',
    'Use QR Payment as a booking QR.', 'Scan QR Payment to check in.'])
def test_payment_method_exception_cannot_change_qr_access_roles(text):
    from rag.draft_transport import source_backed_payment_method_only
    assert not source_backed_payment_method_only(text, [{'text': 'Choose Cash or QR Payment.'}])


def test_payment_method_mention_does_not_expand_an_entire_kiosk_manual(monkeypatch):
    monkeypatch.setattr('rag.batched_support.token_count', lambda text: len(text.encode()))
    paragraphs = [('Kiosk details ' + str(i) + ': ' + 'Original instructions. ' * 60 + 'Choose Cash or QR Payment.') for i in range(3)]
    text = '\n\n'.join(paragraphs)
    source = {'chunk_id': 'kiosk', 'heading_path': 'Walk-in', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'Choose Cash or QR Payment.', 'support': [0, 1, 2]}])
        assert data['answer']['blocks'][0]['text'] == 'Choose Cash or QR Payment.'
        assert len(data['units']) == 3
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(batched_document_answer('How can I pay at the kiosk?', [source], generate,
        actor_role='PUBLIC_VISITOR', customer_reference=True))
    assert result['outcome'] == 'COMPLETE'
    assert len(calls) == 2


def test_mixed_channel_introduction_does_not_apply_a_website_link_to_kiosk(monkeypatch):
    monkeypatch.setattr('rag.batched_support.token_count', lambda text: len(text.encode()))
    text = 'Use the website for online reservations or the kiosk for walk-ins.\n\nWebsite customers receive a private payment link.'
    source = {'chunk_id': 'channels', 'heading_path': 'Booking', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if 'answer' not in data:
            return schema(scope='MULTI_PART', blocks=[
                {'kind': 'text', 'text': 'Use the website or the on-site kiosk.', 'support': [0]},
                {'kind': 'text', 'text': 'After submission, pay via the official private link.', 'support': [1]},
            ])
        assert data['answer']['blocks'][1]['text'] == 'For website reservations, after submission, pay via the official private link.'
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(batched_document_answer('How does it work?', [source], generate,
        actor_role='PUBLIC_VISITOR', customer_reference=True))
    assert result['outcome'] == 'COMPLETE'
    assert len(calls) == 2


@pytest.mark.parametrize('safe', [True, False])
def test_only_safe_incomplete_customer_answers_receive_one_exact_rule_repair(monkeypatch, safe):
    from fastapi import HTTPException
    monkeypatch.setattr('rag.batched_support.token_count', lambda text: len(text.encode()))
    text = 'Provide guest details.\n\nOnly an administrator reviews payment proof.\n\nSelection does not hold inventory.'
    source = {'chunk_id': 'booking', 'heading_path': 'Booking', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if 'answer' not in data:
            return schema(scope='COMPLETE_PROCEDURE', blocks=[{'kind': 'text', 'text': 'Provide guest details.', 'support': [0]}])
        complete = any('Only an administrator reviews payment proof.' in block['text'] for block in data['answer']['blocks'])
        return schema(relevant=True, supported=True, complete=complete, consistent=True, safe=safe,
            reason_code='NONE' if complete else 'MISSING_STEP', missing_originals=[] if complete else [1])
    if safe:
        result = asyncio.run(batched_document_answer('How do I book?', [source], generate,
            actor_role='PUBLIC_VISITOR', customer_reference=True))
        assert result['outcome'] == 'COMPLETE'
        assert len(calls) == 3
        assert any(span['quote'] == 'Only an administrator reviews payment proof.' for span in result['spans'])
    else:
        with pytest.raises(HTTPException, match='UNRESOLVED_CONTEXT'):
            asyncio.run(batched_document_answer('How do I book?', [source], generate,
                actor_role='PUBLIC_VISITOR', customer_reference=True))
        assert len(calls) == 2


def test_exact_customer_repair_closes_an_obligation_across_source_chunks(monkeypatch):
    monkeypatch.setattr('rag.batched_support.token_count', lambda text: len(text.encode()))
    sources = []
    for index, (heading, text) in enumerate([
        ('Booking', 'Provide guest details.\n\nAfter payment verification, final allocation must'),
        ('Allocation', 'follow Main, then Alt 1, then Alt 2, otherwise manual resolution.'),
    ]):
        sources.append({'chunk_id': str(index), 'version_id': 'same-generation', 'heading_path': heading,
                        'content': text, 'content_hash': hashlib.sha256(text.encode()).hexdigest()})
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if 'answer' not in data:
            return schema(scope='COMPLETE_PROCEDURE', blocks=[{'kind': 'text', 'text': 'Provide guest details.', 'support': [0]}])
        complete = any('follow Main, then Alt 1, then Alt 2' in block['text'] for block in data['answer']['blocks'])
        return schema(relevant=True, supported=True, complete=complete, consistent=True, safe=True,
            reason_code='NONE' if complete else 'MISSING_STEP', missing_originals=[] if complete else [1])
    result = asyncio.run(batched_document_answer('How do I book?', sources, generate,
        actor_role='PUBLIC_VISITOR', customer_reference=True))
    assert result['outcome'] == 'COMPLETE'
    assert result['synthesis']['blocks'][-1]['text'].endswith('manual resolution.')
    assert len(calls) == 3


def test_customer_recovery_discards_unsupported_definition_and_reverifies_exact_original(monkeypatch):
    monkeypatch.setattr('rag.batched_support.token_count', lambda text: len(text.encode()))
    text = 'DeskAtlas supports guest workspace reservation requests without a personal account.'
    source = {'chunk_id': 'intro', 'heading_path': 'Guest booking', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': 'DeskAtlas is the physical coworking venue.', 'support': [0]}])
        supported = data['answer']['blocks'][0]['text'] == text
        return schema(relevant=True, supported=supported, complete=True, consistent=True, safe=True,
            reason_code='NONE' if supported else 'UNSUPPORTED_CLAIM', missing_originals=[])
    result = asyncio.run(batched_document_answer('What is DeskAtlas?', [source], generate,
        actor_role='PUBLIC_VISITOR', customer_reference=True))
    assert result['outcome'] == 'COMPLETE'
    assert result['synthesis']['blocks'][0]['text'] == text
    assert len(calls) == 3


def test_mixed_channel_overview_keeps_capabilities_without_a_physical_venue_definition():
    from rag.draft_transport import qualify_customer_payment_channel
    blocks = [{'text': 'DeskAtlas is a coworking space where you can book on the website or kiosk.', 'support': [0]},
              {'text': 'Pay through the private payment page.', 'support': [1]}]
    result = qualify_customer_payment_channel(blocks)
    assert result[0]['text'] == 'With DeskAtlas, you can book on the website or kiosk.'
    assert result[1]['text'] == 'For website reservations, pay through the private payment page.'


def test_product_overview_omits_optional_qr_rewards_but_checks_all_original_units(monkeypatch):
    monkeypatch.setattr('rag.batched_support.token_count', lambda text: len(text.encode()))
    text = 'Guest requests do not require an account and do not hold inventory.\n\nA booking QR is not a payment QR.\n\nRewards are optional.'
    source = {'chunk_id': 'overview', 'heading_path': 'Booking', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[
                {'kind': 'text', 'text': 'Guest requests do not require an account and do not hold inventory.', 'support': [0]},
                {'kind': 'text', 'text': 'A booking QR is not a payment QR.', 'support': [1]},
                {'kind': 'text', 'text': 'Rewards are optional.', 'support': [2]},
            ])
        assert len(data['units']) == 3
        assert len(data['answer']['blocks']) == 1
        assert data['answer']['blocks'][0]['support'] == [0]
        return schema(relevant=True, supported=True, complete=True, consistent=True, safe=True,
            reason_code='NONE', missing_originals=[])
    result = asyncio.run(batched_document_answer('What is DeskAtlas and how does it work?', [source], generate,
        actor_role='PUBLIC_VISITOR', customer_reference=True))
    assert result['outcome'] == 'COMPLETE'
    assert len(calls) == 2

