"""PRD-F26 / QAD-TC46: no new-model call without explicit bounded admission."""
import json
from decimal import Decimal
from contextlib import closing

import pytest
from fastapi import HTTPException
from rag.benchmark_budget import BenchmarkBudget
from rag.answer_provider import answer_model, document_limits, BENCHMARK_MODELS


@pytest.mark.parametrize('model', sorted(BENCHMARK_MODELS))
def test_new_models_require_explicit_local_benchmark_mode(monkeypatch, model):
    monkeypatch.delenv('RAG_FAST_MODEL_RELEASE', raising=False)
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_ANSWER_MODEL', model)
    monkeypatch.delenv('RAG_BENCHMARK_ENABLED', raising=False)
    with pytest.raises(HTTPException):
        answer_model()
    monkeypatch.setenv('RAG_BENCHMARK_ENABLED', 'true')
    monkeypatch.delenv('K_SERVICE', raising=False)
    assert answer_model() == model
    assert document_limits()['byte_tokens'] is True
    monkeypatch.setenv('K_SERVICE', 'synthetic-hosted-service')
    with pytest.raises(HTTPException):
        answer_model()


def test_release_admission_is_separate_explicit_and_limited_to_the_reviewed_model(monkeypatch):
    from rag.answer_provider import FAST_RELEASE_MODEL, released_model
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('K_SERVICE', 'synthetic-hosted-service')
    monkeypatch.setenv('RAG_FAST_MODEL_RELEASE', 'true')
    monkeypatch.setenv('RAG_ANSWER_MODEL', FAST_RELEASE_MODEL)
    assert answer_model() == FAST_RELEASE_MODEL
    assert released_model(FAST_RELEASE_MODEL)
    monkeypatch.setenv('RAG_ANSWER_MODEL', 'google/gemini-3.5-flash')
    with pytest.raises(HTTPException):
        answer_model()


def test_reservation_survives_restart_and_failure_cannot_refund_it(tmp_path):
    with closing(BenchmarkBudget(tmp_path)) as ledger:
        ledger.reserve('google/gemini-3.5-flash', 240000, 2400)
        reserved = ledger.state['reserved_usd']
    with closing(BenchmarkBudget(tmp_path)) as ledger:
        assert ledger.state['reserved_usd'] == reserved
        ledger.reserve('google/gemini-3.5-flash', 240000, 2400)
        with pytest.raises(ValueError, match='BUDGET_EXHAUSTED'):
            ledger.reserve('google/gemini-3.5-flash', 240000, 2400)
        assert Decimal(ledger.state['reserved_usd']) <= Decimal('1')


def test_exclusive_lock_prevents_two_processes_spending_same_balance(tmp_path):
    with closing(BenchmarkBudget(tmp_path)):
        with pytest.raises(FileExistsError):
            BenchmarkBudget(tmp_path)
    with closing(BenchmarkBudget(tmp_path)):
        assert (tmp_path / 'authorized-one-dollar.lock').exists()


def test_settlement_is_idempotent_across_reopened_ledgers(tmp_path):
    with closing(BenchmarkBudget(tmp_path)) as ledger:
        entry = ledger.reserve('google/gemini-3.1-flash-lite', 10000, 1200)
    with closing(BenchmarkBudget(tmp_path)) as ledger:
        ledger.settle(entry, {'prompt_tokens': 1000, 'completion_tokens': 10})
        settled = ledger.state['reserved_usd']
    with closing(BenchmarkBudget(tmp_path)) as ledger:
        ledger.settle(entry, {'prompt_tokens': 0, 'completion_tokens': 0})
        assert ledger.state['reserved_usd'] == settled
        assert Decimal(settled) == Decimal('0.000265')


@pytest.mark.parametrize('usage', [{}, {'prompt_tokens': True, 'completion_tokens': 0},
    {'prompt_tokens': 10001, 'completion_tokens': 0}, {'prompt_tokens': 1, 'completion_tokens': 1201}])
def test_unverified_usage_retains_full_reservation(tmp_path, usage):
    with closing(BenchmarkBudget(tmp_path)) as ledger:
        entry = ledger.reserve('google/gemini-3.1-flash-lite', 10000, 1200)
        reserved = ledger.state['reserved_usd']
        ledger.settle(entry, usage)
        assert ledger.state['reserved_usd'] == reserved


def test_corrupt_ledger_is_closed_without_leaking_a_lock(tmp_path):
    (tmp_path / 'authorized-one-dollar.json').write_text(json.dumps({'ceiling_usd': '2', 'reserved_usd': '0'}))
    with pytest.raises(ValueError):
        BenchmarkBudget(tmp_path)
    assert not (tmp_path / 'authorized-one-dollar.lock').exists()


def test_real_api_reserves_before_inference_and_settles_after_usage(monkeypatch):
    from test_deepinfra import completion, run_generation
    import httpx
    events = []
    model = 'google/gemini-3.1-flash-lite'
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_ANSWER_MODEL', model)
    monkeypatch.setenv('RAG_BENCHMARK_ENABLED', 'true')
    monkeypatch.setenv('DEEPINFRA_API_KEY', 'synthetic-provider-key')
    monkeypatch.delenv('K_SERVICE', raising=False)
    def reserve(chosen, inputs, outputs):
        assert chosen == model and inputs > 0 and outputs == 128
        events.append('reserve')
        return {'id': 'synthetic-reservation'}
    monkeypatch.setattr('rag.benchmark_budget.reserve_request', reserve)
    monkeypatch.setattr('rag.benchmark_budget.settle_request', lambda entry, usage: events.append('settle'))
    def handler(request):
        assert events == ['reserve']
        events.append('provider')
        body = completion()
        body['model'] = model
        return httpx.Response(200, json=body)
    assert run_generation(handler).passages == []
    assert events == ['reserve', 'provider', 'settle']


def test_real_api_never_calls_provider_after_budget_rejection(monkeypatch):
    from test_deepinfra import run_generation
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_ANSWER_MODEL', 'google/gemini-3.1-flash-lite')
    monkeypatch.setenv('RAG_BENCHMARK_ENABLED', 'true')
    monkeypatch.setenv('DEEPINFRA_API_KEY', 'synthetic-provider-key')
    monkeypatch.delenv('K_SERVICE', raising=False)
    def reject(*args):
        raise ValueError('BENCHMARK_BUDGET_EXHAUSTED')
    monkeypatch.setattr('rag.benchmark_budget.reserve_request', reject)
    with pytest.raises(HTTPException, match='BENCHMARK_BUDGET_UNAVAILABLE'):
        run_generation(lambda request: pytest.fail('provider called after budget rejection'))
