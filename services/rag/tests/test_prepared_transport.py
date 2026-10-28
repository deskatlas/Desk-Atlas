"""QAD-TC44-TC46: dictionary encoding never changes exact canonical addresses."""
import copy

import pytest
from fastapi import HTTPException

from rag.prepared_transport import PackedOriginals, unpack_originals


def packed():
    return {'documents':[{'d':'doc','v':'version','t':'Guide'}], 'headings':['Guide / Review'],
            'chunks':[{'c':'chunk1','d':0,'h':0,'s':'a'*64},{'c':'chunk2','d':0,'h':0,'s':'b'*64}],
            'texts':['Check proof.','Keep the 😀 qualifier.'],
            'units':[{'c':0,'s':15,'e':27,'t':0},{'c':1,'s':0,'e':22,'t':1}]}


def test_lossless_dictionary_keeps_offsets_headings_and_duplicate_contexts():
    data=packed()
    data['units'].append({'c':1,'s':30,'e':42,'t':0})
    sources,units=unpack_originals(PackedOriginals.model_validate(data))
    assert sources[0]['version_id']=='version' and sources[1]['content_hash']=='b'*64
    assert [unit['i'] for unit in units]==[0,1,2]
    assert units[0]['text']==units[2]['text']=='Check proof.'
    assert units[0]['start']==15 and units[2]['start']==30
    assert units[1]['text']=='Keep the 😀 qualifier.' and units[1]['end']==22
    assert all(unit['heading']=='Guide / Review' for unit in units)


@pytest.mark.parametrize('failure',['missing_text','bad_chunk','bad_document','changed_offset','duplicate_span'])
def test_invalid_dictionary_references_cannot_reach_inference(failure):
    data=copy.deepcopy(packed())
    if failure=='missing_text':data['texts'].pop()
    if failure=='bad_chunk':data['units'][0]['c']=9
    if failure=='bad_document':data['chunks'][0]['d']=9
    if failure=='changed_offset':data['units'][0]['e']+=1
    if failure=='duplicate_span':data['units'].append(data['units'][0])
    with pytest.raises(HTTPException):
        unpack_originals(PackedOriginals.model_validate(data))
