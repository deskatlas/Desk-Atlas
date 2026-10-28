"""PRD-F26 / QAD-TC44/46: catalog intent and selection cannot grant tools."""
import asyncio
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from rag.catalog_discovery import CatalogInput, CatalogSource, CatalogDecision, discover_internal


def body():
    return CatalogInput(message='What if they already paid?', user_turns=['What do we do when a guest arrives?'],
        sources=[CatalogSource(chunk_id='one', title='Operations', heading_path='Guide', content='Original introduction.')],
        headings=[['Guide / Arrival', 'Guide / Payment controls']])


def test_followup_intent_and_complete_headings_reach_one_discovery_call():
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        assert data['user_turns'] == body().user_turns
        assert data['catalog'][0]['original_intro'] == body().sources[0].content
        segments = data['heading_segments']
        assert [' / '.join(segments[i] for i in path) for path in data['catalog'][0]['headings']] == body().headings[0]
        return schema(kind='DOCUMENT', query='How do we check in an already-paid confirmed guest?', primaries=[0])
    result = asyncio.run(discover_internal(body(), 'STAFF', generate))
    assert result['chunk_ids'] == ['one'] and result['kind'] == 'DOCUMENT'
    assert 'tools' not in result and 'summary' not in result
    assert len(calls) == 1


@pytest.mark.parametrize('decision', [dict(kind='DOCUMENT', primaries=[1]), dict(kind='DOCUMENT', primaries=[0, 0]),
    dict(kind='DEFER', primaries=[0])])
def test_fabricated_or_duplicate_discovery_choices_fail(decision):
    generate = AsyncMock(return_value=CatalogDecision(query='Original task', **decision))
    with pytest.raises(HTTPException, match='INVALID_MODEL_OUTPUT'):
        asyncio.run(discover_internal(body(), 'STAFF', generate))


def test_noninternal_principals_never_reach_inference():
    generate = AsyncMock()
    with pytest.raises(HTTPException):
        asyncio.run(discover_internal(body(), 'PUBLIC_VISITOR', generate))
    generate.assert_not_called()


def test_live_requests_can_defer_without_granting_a_tool_or_seed():
    generate = AsyncMock(return_value=CatalogDecision(kind='DEFER', query='How many are checked in?', primaries=[]))
    result = asyncio.run(discover_internal(body(), 'STAFF', generate))
    assert result == {'kind': 'DEFER', 'query': 'How many are checked in?', 'chunk_ids': []}
