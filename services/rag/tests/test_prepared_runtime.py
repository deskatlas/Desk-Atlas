"""SDD-C21,C23 / QAD-TC44-TC46: preparation transport never replaces validation."""
import pytest
from pydantic import ValidationError

from knowledge.support_runtime import preparation_payload, decode_preparation, compiler_fingerprint
from rag.document_support import Strict


class Receipt(Strict):
    accepted: bool


def test_json_preparation_transport_retains_source_and_explicit_local_schema(monkeypatch):
    monkeypatch.setenv('RAG_PREPARATION_FORMAT','json_object')
    source = {'original':'Original rule: never approve unmatched amounts.'}
    payload = preparation_payload('Qwen/Qwen3-32B','Read original data. JSON only.',source,Receipt,640)
    assert payload['response_format'] == {'type':'json_object'}
    assert '"accepted"' in payload['messages'][0]['content']
    assert 'never approve unmatched amounts' in payload['messages'][1]['content']
    assert payload['reasoning_effort'] == 'none'
    assert decode_preparation('{"accepted":true}',Receipt).accepted


@pytest.mark.parametrize('content', ['{"accepted":true,"accepted":false}',
                                     '{"accepted":"true"}', '{"accepted":true,"extra":1}', '{}'])
def test_invalid_or_duplicate_json_cannot_enter_prepared_storage(content):
    with pytest.raises((ValueError,ValidationError)):
        decode_preparation(content,Receipt)


def test_compiler_identity_binds_transport_mode_without_a_model_fallback(monkeypatch):
    monkeypatch.setenv('RAG_MODEL_PROVIDER','deepinfra')
    monkeypatch.setenv('RAG_DOCUMENT_ANSWER_MODEL','Qwen/Qwen3-32B')
    monkeypatch.setenv('RAG_PREPARATION_FORMAT','json_schema')
    strict = compiler_fingerprint()
    monkeypatch.setenv('RAG_PREPARATION_FORMAT','json_object')
    assert compiler_fingerprint() != strict


@pytest.mark.parametrize('stage', ['ASSIGNMENTS','DEPENDENCIES'])
def test_bounded_address_stages_use_constrained_schemas(monkeypatch, stage):
    from rag.prepared_support import assignment_schema, linkage_schema, SupportGroup
    monkeypatch.setenv('RAG_PREPARATION_FORMAT','bounded_schema')
    schema = assignment_schema([0,1],[0]) if stage == 'ASSIGNMENTS' else linkage_schema([
        SupportGroup(id=0,label='Review',applies_to='Review',ranges=[[0,1]],requires=[],scope='WORKFLOW')],2)
    payload = preparation_payload('Qwen/Qwen3-32B','Return JSON.',{'stage':stage},schema,1024)
    assert payload['response_format']['type'] == 'json_schema'
    assert payload['response_format']['json_schema']['schema'] == schema.model_json_schema()
    if stage == 'ASSIGNMENTS':
        with pytest.raises(ValidationError):
            decode_preparation('{"u0":0,"u1":1}',schema)
    else:
        with pytest.raises(ValidationError):
            decode_preparation('{"g0":{"scope":"WORKFLOW","required_units":[2]}}',schema)


def test_bounded_discovery_retains_locally_validated_object_transport(monkeypatch):
    monkeypatch.setenv('RAG_PREPARATION_FORMAT','bounded_schema')
    payload=preparation_payload('Qwen/Qwen3-32B','Return JSON.',{'stage':'DISCOVERY'},Receipt,4800)
    assert payload['response_format']=={'type':'json_object'}
