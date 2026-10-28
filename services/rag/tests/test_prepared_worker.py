"""QAD-TC44-TC46: durable completion cannot outlive its compiler lease."""
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from knowledge import support_worker


class Artifact:
    def model_dump(self):
        return {'contract': 'ragfix-prepared-v1'}


class Gateway:
    def __init__(self):
        self.calls = []

    def call(self, operation, data):
        self.calls.append((operation, data))
        return {'accepted': True}


def claim():
    return {'job': {'id': 'job', 'lease_token': 'lease', 'generation': 2,
                    'compiler_fingerprint': 'a' * 64}, 'sources': []}


@pytest.mark.parametrize('changed', [False, True])
def test_worker_only_completes_matching_loaded_compiler(monkeypatch, changed):
    stats = {'model': 'Qwen/Qwen3-32B', 'calls': 4, 'bytes': 1000,
             'input_tokens': 100, 'output_tokens': 50,
             'compiler_fingerprint': ('b' if changed else 'a') * 64}
    monkeypatch.setattr(support_worker, 'prepare_generation', AsyncMock(return_value=(Artifact(), stats)))
    gateway = Gateway()
    outcome = support_worker.process_support_claim(gateway, claim())
    operation, payload = gateway.calls[-1]
    assert payload['lease_token'] == 'lease' and payload['generation'] == 2
    if changed:
        assert operation == 'job/fail' and outcome == 'PREPARATION_MODEL_FAILURE'
        assert 'artifact_text' not in payload
    else:
        assert operation == 'job/complete' and outcome == 'READY'
        assert payload['compiler_fingerprint'] == 'a' * 64


def test_rejected_preparation_stores_safe_failure_without_policy_output(monkeypatch):
    monkeypatch.setattr(support_worker, 'prepare_generation', AsyncMock(
        side_effect=HTTPException(400, detail='PREPARATION_UNVERIFIED')))
    gateway = Gateway()
    assert support_worker.process_support_claim(gateway, claim()) == 'PREPARATION_UNVERIFIED'
    assert gateway.calls == [('job/fail', {'lease_token': 'lease', 'generation': 2,
                                          'error_code': 'PREPARATION_UNVERIFIED'})]
