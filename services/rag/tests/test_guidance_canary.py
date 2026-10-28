"""QAD-TC44: a positive model verdict cannot excuse missing major tasks."""
import asyncio

import pytest
from fastapi import HTTPException

from experiments.ragfix.guidance_runtime import body_unit, compile_guidance
from test_unit_closure_canary import fixture


def test_faq_heading_and_answer_remain_atomic_original_evidence():
    assert not body_unit('### Payment policy')
    assert body_unit('### Q1. Can I approve this?\nNever approve a mismatched amount.')
    assert body_unit('Receive the payment only when an amount is due.')


def test_guidance_missing_major_workflow_fails_before_model_audit():
    sources, _, text, digest = fixture()
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        return schema(u=[0])
    with pytest.raises(HTTPException) as error:
        asyncio.run(compile_guidance(sources, text, digest, generate))
    assert error.value.detail == 'PREPARATION_INCOMPLETE'
    assert len(calls) == 1


def test_independent_whole_source_rejection_prevents_guidance_artifact():
    sources, _, text, digest = fixture()
    async def generate(prompt, data, schema):
        if 'proposed_original_ids' not in data:
            return schema(u=[0, 1, 3])
        assert data['originals'][-2]['text'] == 'Never approve a mismatched amount.'
        return schema(finding='The omitted amount restriction changes approval eligibility.',source_bound=True, ordinary_workflows_complete=True, conditions_preserved=False,
                      scope_safe=True, safe=True, missing_originals=[2], issues=['MISSING_CONDITION'])
    with pytest.raises(HTTPException) as error:
        asyncio.run(compile_guidance(sources, text, digest, generate))
    assert error.value.detail == 'PREPARATION_UNVERIFIED'
