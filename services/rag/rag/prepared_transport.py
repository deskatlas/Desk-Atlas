"""SDD-C21/C23 / QAD-TC44: exact original units, dictionary transport only."""
from pydantic import Field
from fastapi import HTTPException

from .document_support import Strict, wire, wire_length, BUDGET


class Document(Strict):
    d: str = Field(min_length=1,max_length=100)
    v: str = Field(min_length=1,max_length=100)
    t: str = Field(max_length=200)


class Chunk(Strict):
    c: str = Field(min_length=1,max_length=100)
    d: int = Field(ge=0,lt=12)
    h: int = Field(ge=0,lt=1000)
    s: str = Field(pattern=r'^[a-f0-9]{64}$')


class Unit(Strict):
    c: int = Field(ge=0,lt=1000)
    s: int = Field(ge=0)
    e: int = Field(gt=0)
    t: int = Field(ge=0,lt=1000)


class PackedOriginals(Strict):
    documents: list[Document] = Field(min_length=1,max_length=12)
    headings: list[str] = Field(min_length=1,max_length=1000)
    chunks: list[Chunk] = Field(min_length=1,max_length=1000)
    texts: list[str] = Field(min_length=1,max_length=1000)
    units: list[Unit] = Field(min_length=1,max_length=1000)


def unpack_originals(packed):
    def invalid():
        raise HTTPException(503,detail='INVALID_MODEL_OUTPUT')
    if len(wire(packed.model_dump()))>BUDGET['document_bytes']:
        raise HTTPException(400,detail='CONTEXT_BUDGET_EXCEEDED')
    if (len({doc.v for doc in packed.documents})!=len(packed.documents)
        or len({chunk.c for chunk in packed.chunks})!=len(packed.chunks)
        or any(len(heading)>500 for heading in packed.headings)
        or any(not text or wire_length(text)>1500 for text in packed.texts)):
        invalid()
    sources=[]
    for chunk in packed.chunks:
        if chunk.d>=len(packed.documents) or chunk.h>=len(packed.headings):
            invalid()
        doc=packed.documents[chunk.d]
        sources.append({'document_id':doc.d,'version_id':doc.v,'title':doc.t,
                        'chunk_id':chunk.c,'heading_path':packed.headings[chunk.h],'content_hash':chunk.s})
    units=[]
    cursors={}
    used_chunks,used_texts=set(),set()
    for unit in packed.units:
        if unit.c>=len(sources) or unit.t>=len(packed.texts):
            invalid()
        source,text=sources[unit.c],packed.texts[unit.t]
        if unit.e-unit.s!=wire_length(text) or unit.s<cursors.get(unit.c,0):
            invalid()
        cursors[unit.c]=unit.e
        used_chunks.add(unit.c); used_texts.add(unit.t)
        units.append({'i':len(units),'chunk_id':source['chunk_id'],'heading':source['heading_path'],
                      'text':text,'start':unit.s,'end':unit.e})
    if len(used_chunks)!=len(sources) or len(used_texts)!=len(packed.texts):
        invalid()
    return sources,units
