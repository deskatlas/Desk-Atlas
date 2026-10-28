"""QAD-TC44-TC46: prepared serving keeps capability and rollout boundaries."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from test_deepinfra import api
from test_prepared_protocol import index


def request():
    return Request({'type':'http','method':'POST','path':'/v1/prepared-selection','headers':[]})


def body():
    return api.PreparedSelectionInput(contract='ragfix-prepared-v2', query='How do we review payments?', indexes=[{**index().model_dump(), 'groups':[{k:v for k,v in group.model_dump().items() if k in ('id','label','applies_to','scope')} for group in index().groups]}])


def test_prepared_endpoint_requires_service_authentication(monkeypatch):
    monkeypatch.setenv('RAG_SERVICE_TOKEN', 'synthetic-service-secret')
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app),base_url='http://test') as client:
            response = await client.post('/v1/prepared-selection',json=body().model_dump())
            assert response.status_code == 401
    asyncio.run(run())


@pytest.mark.parametrize('ops,enabled,expected', [([],True,'FORBIDDEN'),(['answer'],False,'READER_INCOMPATIBLE')])
def test_prepared_rollout_and_operation_fail_before_inference(monkeypatch, ops, enabled, expected):
    monkeypatch.setattr(api,'authenticate',AsyncMock(return_value=SimpleNamespace(ops=ops,role='ADMIN')))
    monkeypatch.setenv('RAG_PREPARED_SUPPORT',str(enabled).lower())
    monkeypatch.setenv('RAG_MODEL_PROVIDER','deepinfra')
    generate=AsyncMock()
    monkeypatch.setattr(api,'generate',generate)
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.prepared_selection(body(),request()))
    assert error.value.detail == expected
    generate.assert_not_called()


def test_cancelled_discovery_cancels_inference_and_restores_limits(monkeypatch):
    monkeypatch.setattr(api,'authenticate',AsyncMock(return_value=SimpleNamespace(ops=['answer'],role='ADMIN')))
    monkeypatch.setenv('RAG_PREPARED_SUPPORT','true')
    monkeypatch.setenv('RAG_MODEL_PROVIDER','deepinfra')
    monkeypatch.setenv('RAG_DOCUMENT_ANSWER_MODEL','Qwen/Qwen3-32B')
    async def run():
        started,cancelled=asyncio.Event(),asyncio.Event()
        async def generate(*args):
            started.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()
        monkeypatch.setattr(api,'generate',generate)
        task=asyncio.create_task(api.prepared_selection(body(),request()))
        await asyncio.wait_for(started.wait(),1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cancelled.is_set()
        assert api.request_timing.model_limits.get() is None
    asyncio.run(run())
