"""QAD-TC44: transport experiments cannot alter customer or default output."""
import copy

import pytest
from fastapi import HTTPException

from experiments.ragfix.internal_output import internal_output_payload


def payload():
    return {'messages': [{'role': 'system', 'content': 'Trusted instructions.'},
                         {'role': 'user', 'content': 'Untrusted source.'}],
            'response_format': {'type': 'json_schema', 'json_schema': {'schema': {'type': 'object'}}}}


@pytest.mark.parametrize('internal', [False, True])
def test_default_is_unchanged(monkeypatch, internal):
    monkeypatch.delenv('RAG_INTERNAL_OUTPUT_FORMAT', raising=False)
    original = payload()
    assert internal_output_payload(original, internal=internal) is original


def test_explicit_object_mode_keeps_customer_schema_and_source_data(monkeypatch):
    monkeypatch.setenv('RAG_INTERNAL_OUTPUT_FORMAT', 'json_object')
    original = payload()
    saved = copy.deepcopy(original)
    assert internal_output_payload(original, internal=False) is original
    converted = internal_output_payload(original, internal=True)
    assert converted['response_format'] == {'type': 'json_object'}
    assert converted['messages'][1] == original['messages'][1]
    assert 'Local strict validation' in converted['messages'][0]['content']
    assert original == saved


def test_unknown_format_is_rejected(monkeypatch):
    monkeypatch.setenv('RAG_INTERNAL_OUTPUT_FORMAT', 'guess')
    with pytest.raises(HTTPException) as error:
        internal_output_payload(payload(), internal=True)
    assert error.value.detail == 'INVALID_INTERNAL_OUTPUT_FORMAT'
