"""QAD-TC44/46: original-rule closure and deterministic qualifier binding."""
import asyncio
import hashlib

import pytest
from fastapi import HTTPException

from experiments.ragfix.rule_graph import (
    RuleGraph, compile_rules, rule_closure, validate_graph, bind_claims,
)
from rag.document_support import canonical_units
from rag.prepared_support import source_binding


def fixture():
    text = ('Collect and verify payment.\n\nClean the floor.\n\n'
            'Payment collection applies only to new or unpaid bookings.\n\n'
            'Only authorized staff may confirm counter payment.')
    sources = [{'document_id': 'd', 'version_id': 'v', 'chunk_id': 'c',
                'heading_path': 'Operations', 'content': text,
                'content_hash': hashlib.sha256(text.encode()).hexdigest()}]
    graph = RuleGraph(source_binding=source_binding(sources),
        units=canonical_units(sources), rules={
            'u0': {'scope': 'LOCAL', 'requires': [2], 'guards': [2]},
            'u1': {'scope': 'LOCAL', 'requires': [], 'guards': []},
            'u2': {'scope': 'LOCAL', 'requires': [3], 'guards': []},
            'u3': {'scope': 'LOCAL', 'requires': [], 'guards': []},
        })
    return sources, graph


def test_rule_dependency_keeps_distant_prerequisite_without_neighbor_workflow():
    sources, graph = fixture()
    validate_graph(graph, sources)
    assert rule_closure(graph, [0]) == [0, 2, 3]
    graph.rules['u1'].scope = 'DOCUMENT'
    assert rule_closure(graph, [0]) == [0, 2, 3]
    assert rule_closure(graph, [1]) == [0, 1, 2, 3]


def test_cycle_is_bounded_and_global_obligations_are_kept():
    _, graph = fixture()
    graph.rules['u3'].requires = [0]
    graph.rules['u1'].scope = 'GLOBAL'
    assert rule_closure(graph, [0]) == [0, 1, 2, 3]


@pytest.mark.parametrize('mutation', ['missing', 'fabricated', 'duplicate', 'unbound_guard', 'stale'])
def test_invalid_graph_never_admits(mutation):
    sources, graph = fixture()
    if mutation == 'missing':
        del graph.rules['u1']
    elif mutation == 'fabricated':
        graph.rules['u0'].requires = [999]
    elif mutation == 'duplicate':
        graph.rules['u0'].requires = [2, 2]
    elif mutation == 'unbound_guard':
        graph.rules['u0'].guards = [999]
    else:
        graph.source_binding = '0' * 64
    with pytest.raises(HTTPException):
        validate_graph(graph, sources)


def test_positive_model_verdict_cannot_release_an_unqualified_payment_claim():
    _, graph = fixture()
    with pytest.raises(HTTPException) as error:
        bind_claims(graph, [{'text': 'Collect and verify payment.', 'support': [0]}])
    assert error.value.detail == 'UNBOUND_ORIGINAL_CONDITION'
    qualified = graph.units[2].text + ' For those bookings, collect and verify payment.'
    blocks = bind_claims(graph, [{'text': qualified, 'support': [0]}])
    assert blocks[0]['support'] == [0, 2, 3]


def test_guard_edges_always_expand_even_if_not_duplicated_in_prerequisite_list():
    sources, graph = fixture()
    graph.rules['u0'].requires = []
    validate_graph(graph, sources)
    assert rule_closure(graph, [0]) == [0, 2, 3]


def test_transitive_guards_are_bound_to_each_affected_claim():
    _, graph = fixture()
    graph.rules['u2'].guards = [3]
    qualified = graph.units[2].text + ' Collect and verify payment.'
    with pytest.raises(HTTPException):
        bind_claims(graph, [{'text': qualified, 'support': [0]}])
    qualified += ' ' + graph.units[3].text
    assert bind_claims(graph, [{'text': qualified, 'support': [0]}])
    with pytest.raises(HTTPException):
        bind_claims(graph, [{'text': qualified, 'support': [0]},
                            {'text': 'Always collect payment.', 'support': [0]}])


def test_every_batch_is_independently_audited_against_all_originals():
    sources, graph = fixture()
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data['stage'])
        assert [u['i'] for u in data['originals']] == list(range(4))
        if data['stage'] == 'RULE_PROPOSAL':
            return schema.model_validate({key: rule.model_dump() for key, rule in graph.rules.items()})
        assert data['closures']['u0'] == [0, 2, 3]
        return schema.model_validate({key: True for key in graph.rules})
    result = asyncio.run(compile_rules(sources, generate))
    assert seen == ['RULE_PROPOSAL', 'RULE_AUDIT']
    assert result.rules == graph.rules


def test_one_rejected_rule_prevents_artifact_even_with_other_positive_verdicts():
    sources, graph = fixture()
    async def generate(prompt, data, schema):
        if data['stage'] == 'RULE_PROPOSAL':
            return schema.model_validate({key: rule.model_dump() for key, rule in graph.rules.items()})
        return schema.model_validate({key: key != 'u0' for key in graph.rules})
    with pytest.raises(HTTPException) as error:
        asyncio.run(compile_rules(sources, generate))
    assert error.value.detail == 'PREPARATION_UNVERIFIED'
