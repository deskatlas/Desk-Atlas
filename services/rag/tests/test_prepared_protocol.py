"""PRD-F26 / QAD-TC44,46: discovery cannot invent evidence identities."""
import asyncio

import pytest
from fastapi import HTTPException

from rag.prepared_protocol import PreparedIndex, WorkflowSelection, EntrySelection, select_workflows


def index():
    return PreparedIndex(document_id='doc', version_id='version', title='Guide',
        artifact_sha256='a'*64, source_binding='b'*64, groups=[
            {'id':1, 'label':'Review', 'applies_to':'Reviewing payments', 'ranges':[[0,1]],
             'requires':[], 'scope':'WORKFLOW'}])


@pytest.mark.parametrize('document,groups,valid', [(0,[1],True),(1,[1],False),(0,[2],False),(0,[1,1],False)])
def test_prepared_selection_preserves_original_scope_and_binds_catalog_ids(document, groups, valid):
    async def generate(prompt, data, schema):
        assert data['question'] == 'How do we normally review payments?'
        assert data['authenticated_role'] == 'STAFF'
        assert 'ranges' not in data['entries'][0]['tasks'][0]
        return EntrySelection(p=[0] if valid else [0,0] if groups==[1,1] else [1])
    operation = select_workflows('How do we normally review payments?', [index()], generate, 'STAFF')
    if not valid:
        with pytest.raises(HTTPException) as error:
            asyncio.run(operation)
        assert error.value.detail == 'INVALID_MODEL_OUTPUT'
        return
    result = asyncio.run(operation)
    assert result['selections'] == [{'version_id':'version','artifact_sha256':'a'*64,'groups':[1]}]


def test_customer_cannot_use_internal_prepared_discovery():
    async def generate(*args):
        raise AssertionError('No inference may run before role admission')
    with pytest.raises(HTTPException) as error:
        asyncio.run(select_workflows('Payment help?', [index()], generate, 'CUSTOMER'))
    assert error.value.status_code == 403
