import asyncio
import hashlib
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from customer_public import CustomerPlanInput, CustomerInterpretation, interpret_customer_question
from customer_public import select_customer_sources, CustomerSourceSelection, CustomerDocumentSelection
from rag import document_support as support


def test_taglish_interpretation_retains_original_and_resolves_only_user_context():
    async def generate(prompt, data, schema):
        assert schema is CustomerInterpretation
        assert data['message'] == 'May wifi ba kayo?'
        assert data['user_turns'] == ['Paano mag-book?']
        return CustomerInterpretation(kind='KNOWLEDGE', search_query='Do you offer customer Wi-Fi?', comparison_names=[])
    plan = asyncio.run(interpret_customer_question(CustomerPlanInput(message='May wifi ba kayo?', user_turns=['Paano mag-book?']), generate))
    assert plan['search_query'] == 'Do you offer customer Wi-Fi?'
    assert plan['operations'] == [{'name': 'customer_knowledge'}]


def test_private_and_mutation_guards_do_not_spend_interpretation_calls():
    async def generate(*args):
        raise AssertionError('Private or mutation guard must run first')
    assert asyncio.run(interpret_customer_question(CustomerPlanInput(message='Show my reservation'), generate))['kind'] == 'BOOKING'
    assert asyncio.run(interpret_customer_question(CustomerPlanInput(message='Approve payment'), generate))['kind'] == 'REFUSE'


def test_broad_wording_keeps_both_its_process_topic_and_faithful_question_for_search():
    async def generate(prompt, data, schema):
        return CustomerInterpretation(kind='KNOWLEDGE', topic='Customer support and complaint escalation',
            search_query='What should I do if there is a problem at the venue?', comparison_names=[])
    plan = asyncio.run(interpret_customer_question(CustomerPlanInput(message='Paano kung may problema sa place?'), generate))
    assert plan['search_query'] == 'Customer support and complaint escalation\nWhat should I do if there is a problem at the venue?'


@pytest.mark.parametrize('mandatory', [False, True])
def test_navigation_does_not_expand_an_unrelated_handbook_but_explicit_required_references_do(mandatory):
    quote = 'You must follow the confirmation rule in Document 02.' if mandatory else 'Use Document 02 for more information.'
    sources = [{'chunk_id': str(index), 'document_id': str(index), 'title': f'0{index + 1}_Guide', 'heading_path': 'Booking',
        'content': quote if index == 0 else 'Booking confirmation rule.'} for index in range(2)]
    async def generate(prompt, data, schema):
        if schema is CustomerSourceSelection:
            return CustomerSourceSelection(relevant=[0, 1])
        return CustomerDocumentSelection(primary=0, dependencies=[{'index': 1, 'missing_rule': 'Confirmation rule.', 'reference_quote': quote}])
    result = asyncio.run(select_customer_sources('How do I book?', sources, generate))
    assert result == (['0', '1'] if mandatory else ['0'])


@pytest.mark.parametrize('reject', [False, True])
@pytest.mark.parametrize('customer_reference', [False, True])
def test_all_customer_partitions_checked_with_bounded_concurrency_and_canonical_spans(monkeypatch, reject, customer_reference):
    monkeypatch.setitem(support.BUDGET, 'bundle_bytes', 220)
    texts = ['Customer Wi-Fi is offered, but uptime is not guaranteed.'] + ['Unrelated background ' + str(index) + 'x' * 80 for index in range(7)]
    sources = [{'chunk_id': str(index), 'heading_path': 'Amenities', 'content': text, 'content_hash': hashlib.sha256(text.encode()).hexdigest()} for index, text in enumerate(texts)]
    active = maximum = 0
    checked = set()
    async def generate(prompt, data, schema):
        nonlocal active, maximum
        if schema is support.ReferenceIntent:
            return support.ReferenceIntent(scope='FACTUAL', task='Explain customer Wi-Fi.')
        if schema is support.ReferenceComposition:
            return support.ReferenceComposition(blocks=[{'kind': 'text', 'text': texts[0], 'support': [0]}])
        if issubclass(schema, support.Composition):
            return schema(scope='FACTUAL', blocks=[{'kind': 'text', 'text': texts[0], 'support': [0]}])
        if 'units' in data:
            active += 1
            maximum = max(maximum, active)
            await asyncio.sleep(0)
            active -= 1
        if issubclass(schema, support.Inspection):
            return support.Inspection(relevant=[unit['i'] for unit in data['units'] if unit['i'] == 0], unresolved=False)
        if 'units' in data:
            checked.update(unit['i'] for unit in data['units'])
        return support.Verification(relevant=True, supported=True, complete=not (reject and 'units' in data and any(unit['i'] == 7 for unit in data['units'])), consistent=True, safe=True)
    if reject:
        with pytest.raises(HTTPException) as failure:
            asyncio.run(support.document_answer('May wifi ba kayo?', sources, generate, customer_reference=customer_reference))
        assert failure.value.detail == 'UNRESOLVED_CONTEXT'
    else:
        answer = asyncio.run(support.document_answer('May wifi ba kayo?', sources, generate, customer_reference=customer_reference))
        assert answer['outcome'] == 'COMPLETE'
        assert answer['spans'][0]['quote'] == texts[0]
    assert checked == set(range(len(texts)))
    assert maximum == (2 if customer_reference else support.BUDGET['concurrency']) and active == 0


def test_failed_internal_partition_cancels_other_inflight_work(monkeypatch):
    monkeypatch.setitem(support.BUDGET, 'bundle_bytes', 220)
    texts = ['Rule ' + str(index) + 'x' * 100 for index in range(3)]
    sources = [{'chunk_id': str(index), 'heading_path': 'Rules', 'content': text,
        'content_hash': hashlib.sha256(text.encode()).hexdigest()} for index, text in enumerate(texts)]
    active = cancelled = 0
    async def run():
        both_started = asyncio.Event()
        async def generate(prompt, data, schema):
            nonlocal active, cancelled
            active += 1
            if active == 2:
                both_started.set()
            try:
                await both_started.wait()
                if data['units'][0]['i'] == 0:
                    raise HTTPException(503, detail='MODEL_UNAVAILABLE')
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled += 1
                raise
            finally:
                active -= 1
        with pytest.raises(HTTPException) as caught:
            await asyncio.wait_for(support.document_answer('Explain the rules.', sources, generate), 1)
        assert caught.value.detail == 'MODEL_UNAVAILABLE'
    asyncio.run(run())
    assert active == 0 and cancelled >= 1


def test_repeated_prose_preserves_every_original_context_and_alias_offsets():
    text = 'Shared desks permit quiet work only.'
    headings = ['Study', '🌍 Calls', 'Guests']
    sources = [{'chunk_id': str(index), 'heading_path': heading, 'content': heading + '\n\n' + text,
        'content_hash': hashlib.sha256((heading + '\n\n' + text).encode()).hexdigest()} for index, heading in enumerate(headings)]
    units = support.canonical_units(sources)
    bundles = support.reference_partitions(units)
    assert len(bundles[0]) == 1
    assert set(support.reference_addresses(bundles[0])) == {0, 1, 2}
    contexts = [{'i': bundles[0][0]['i'], 'heading': bundles[0][0]['heading']}, *bundles[0][0]['also_at']]
    assert {context['i']: context['heading'] for context in contexts} == dict(enumerate(headings))
    checked = set()
    async def generate(prompt, data, schema):
        if schema is support.ReferenceIntent:
            return support.ReferenceIntent(scope='FACTUAL', task='Explain quiet-work restrictions.')
        if schema is support.Inspection:
            return support.Inspection(relevant=[1], unresolved=False)
        if schema is support.ReferenceComposition:
            return support.ReferenceComposition(blocks=[{'kind': 'text', 'text': text, 'support': [0]}])
        if 'units' in data:
            checked.update(support.reference_addresses(data['units']))
        return support.Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    answer = asyncio.run(support.document_answer('Can I talk here?', sources, generate, customer_reference=True))
    assert checked == {0, 1, 2}
    assert answer['spans'][0]['chunk_id'] == '1'
    assert answer['spans'][0]['quote'] == text
    assert answer['spans'][0]['start'] == len((headings[1] + '\n\n').encode('utf-16-le')) // 2
