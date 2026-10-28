"""PRD-F26/F27 / QAD-TC44-TC46: preparation cannot lose original obligations."""
import asyncio
import hashlib

import pytest
from fastapi import HTTPException

from rag.prepared_support import compile_support, support_closure, validate_artifact


def sources():
    text = 'Approve the request after reviewing the proof.\n\nOpening checklist.\n\nNever approve a request with a mismatched amount.'
    return [{'chunk_id': 'c1', 'version_id': 'v1', 'document_id': 'd1',
             'heading_path': 'Guide', 'content': text,
             'content_hash': hashlib.sha256(text.encode()).hexdigest()}]


def proposal(schema, missing=False):
    groups = [
        {'id': 0, 'label': 'Payment review', 'applies_to': 'Reviewing or deciding customer payments',
         'ranges': [[0, 0]], 'requires': [], 'scope': 'WORKFLOW'},
        {'id': 1, 'label': 'Opening', 'applies_to': 'Preparing the space for opening',
         'ranges': [[1, 1]], 'requires': [], 'scope': 'WORKFLOW'},
        {'id': 2, 'label': 'Payment restriction', 'applies_to': 'Approval conditions for payment review',
         'ranges': [[2, 2]] if not missing else [[1, 1]], 'requires': [], 'scope': 'WORKFLOW'},
    ]
    return schema(groups=[{key: value for key, value in group.items() if key in ('label','applies_to')} for group in groups])


def assignments(schema, missing=False):
    return schema(**({'u0':0,'u1':1} if missing else {'u0':0,'u1':1,'u2':2}))


def links(schema):
    values = {'g0':{'scope':'WORKFLOW','required_units':[2]},
              'g1':{'scope':'WORKFLOW','required_units':[]}, 'g2':{'scope':'WORKFLOW','required_units':[]}}
    return schema(**{key:value for key,value in values.items() if key in schema.model_fields})


def test_distant_restriction_survives_prepared_workflow_closure():
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if data.get('stage') == 'DEPENDENCIES':
            assert all('scope' not in group and 'requires' not in group and 'conditions' not in group
                       for group in data['proposal']['groups']), 'unreviewed placeholder scope must not bias source classification'
            return links(schema)
        if data.get('stage') == 'ASSIGNMENTS':
            return assignments(schema)
        if 'proposal' not in data:
            return proposal(schema)
        assert len(data['units']) == 3
        assert data['units'][2]['text'].startswith('Never approve')
        assert data['audit_kind'] == 'SOURCE_ROUTING_MAP'
        assert data['trusted_closures'][0]['original_ranges'] == [[0,0],[2,2]]
        return schema(source_bound=True, complete=True, scope_verified=True,
                      dependencies_complete=True, safe=True, issues=[])
    artifact = asyncio.run(compile_support(sources(), generate))
    selected = support_closure(artifact, [0])
    assert {unit['i'] for unit in selected} == {0, 2}
    assert len(calls) == 6
    assert artifact.groups[0].conditions == [2]
    validate_artifact(artifact, sources())


@pytest.mark.parametrize('failure', ['missing_unit', 'negative_verdict', 'fabricated_dependency'])
def test_incomplete_or_unverified_preparation_cannot_become_an_artifact(failure):
    async def generate(prompt, data, schema):
        if data.get('stage') == 'DEPENDENCIES':
            result = links(schema)
            if failure == 'fabricated_dependency' and 'g0' in type(result).model_fields:
                result.g0.required_units = [60]
            return result
        if data.get('stage') == 'ASSIGNMENTS':
            return assignments(schema, missing=failure == 'missing_unit')
        if 'proposal' not in data:
            result = proposal(schema, missing=failure == 'missing_unit')
            return result
        return schema(source_bound=True, complete=failure != 'negative_verdict',
                      scope_verified=True, dependencies_complete=True, safe=True,
                      issues=['Missing restriction'] if failure == 'negative_verdict' else [])
    with pytest.raises((HTTPException, ValueError)):
        asyncio.run(compile_support(sources(), generate))


def test_changed_original_cannot_reuse_prepared_applicability():
    async def generate(prompt, data, schema):
        if data.get('stage') == 'DEPENDENCIES':
            return links(schema)
        if data.get('stage') == 'ASSIGNMENTS':
            return assignments(schema)
        return proposal(schema) if 'proposal' not in data else schema(
            source_bound=True, complete=True, scope_verified=True,
            dependencies_complete=True, safe=True, issues=[])
    artifact = asyncio.run(compile_support(sources(), generate))
    changed = sources()
    changed[0]['content'] += '\n\nOnly administrators may approve.'
    changed[0]['content_hash'] = hashlib.sha256(changed[0]['content'].encode()).hexdigest()
    with pytest.raises(HTTPException) as error:
        validate_artifact(artifact, changed)
    assert error.value.detail == 'PREPARATION_STALE'


@pytest.mark.parametrize('scope,expected', [('GLOBAL', {0, 1, 2}), ('DOCUMENT', {0, 1, 2})])
def test_global_and_uncertain_scope_cannot_be_silently_narrowed(scope, expected):
    async def generate(prompt, data, schema):
        if data.get('stage') == 'DEPENDENCIES':
            result = links(schema)
            if 'g1' in type(result).model_fields: result.g1.scope = scope
            if 'g2' in type(result).model_fields: result.g2.required_units = [0]
            return result
        if data.get('stage') == 'ASSIGNMENTS':
            return assignments(schema)
        if 'proposal' not in data:
            result = proposal(schema)
            return result
        return schema(source_bound=True, complete=True, scope_verified=True,
                      dependencies_complete=True, safe=True, issues=[])
    artifact = asyncio.run(compile_support(sources(), generate))
    assert {unit['i'] for unit in support_closure(artifact, [0])} == expected


def test_declared_original_condition_cannot_disappear_from_a_stored_closure():
    async def generate(prompt, data, schema):
        if data.get('stage') == 'DISCOVERY': return proposal(schema)
        if data.get('stage') == 'ASSIGNMENTS': return assignments(schema)
        if data.get('stage') == 'DEPENDENCIES': return links(schema)
        return schema(source_bound=True,complete=True,scope_verified=True,dependencies_complete=True,safe=True,issues=[])
    artifact = asyncio.run(compile_support(sources(), generate))
    artifact.groups[0].requires = []
    with pytest.raises(HTTPException) as error:
        validate_artifact(artifact, sources())
    assert error.value.detail == 'PREPARATION_INVALID'


def test_large_assignments_are_bounded_and_final_audit_still_sees_every_original():
    text = '\n\n'.join(f'Original rule {i}.' for i in range(100))
    inputs = [{'chunk_id':'many','heading_path':'Guide','content':text,
               'content_hash':hashlib.sha256(text.encode()).hexdigest()}]
    observed = []
    async def generate(prompt, data, schema):
        observed.append(data)
        if data.get('stage') == 'DISCOVERY':
            return schema(groups=[{'label':f'Task {i}','applies_to':f'Original task {i}'} for i in range(20)])
        if data.get('stage') == 'ASSIGNMENTS':
            assert len(data['units']) <= 48
            return schema(**{f"u{unit['i']}":unit['i']%20 for unit in data['units']})
        if data.get('stage') == 'DEPENDENCIES':
            assert len(data['review_groups']) == 1
            assert len(data['units']) == 100
            return schema(**{f'g{i}':{'scope':'WORKFLOW','required_units':[99] if i==0 else []}
                             for i in data['review_groups']})
        assert {unit['i'] for unit in data['units']} == set(range(100))
        assert any(first<=99<=last for first,last in data['trusted_closures'][0]['original_ranges'])
        return schema(source_bound=True,complete=True,scope_verified=True,dependencies_complete=True,safe=True,issues=[])
    artifact = asyncio.run(compile_support(inputs, generate))
    assert len(observed) == 25
    assert 99 in {unit['i'] for unit in support_closure(artifact, [0])}
