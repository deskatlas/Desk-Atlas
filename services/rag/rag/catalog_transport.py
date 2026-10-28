"""SDD-C20/C21 / QAD-TC44/46: stable provisional catalog output."""
from typing import Annotated, Literal
import os

from fastapi import HTTPException
from pydantic import Field, ValidationError

from customer_public import CustomerCatalogInterpretation, CustomerRequiredSource
from .catalog_discovery import CatalogDecision, DocumentCatalogDecision


class CompactDependency(CustomerRequiredSource):
    index: int = Field(alias='i', ge=0, lt=12)
    primary: int = Field(alias='p', ge=0, lt=12)
    missing_rule: str = Field(alias='m', min_length=1, max_length=300)
    reference_quote: str = Field(alias='r', min_length=1, max_length=1500)


class CompactCustomerCatalog(CustomerCatalogInterpretation):
    kind: CustomerCatalogInterpretation.model_fields['kind'].annotation = Field(alias='k')
    topic: str = Field(default='', alias='t', max_length=180)
    search_query: str = Field(alias='q', min_length=1, max_length=800)
    comparison_names: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(alias='n', max_length=3)
    primaries: list[Annotated[int, Field(ge=0, lt=12)]] = Field(alias='p', max_length=12)
    dependencies: list[CompactDependency] = Field(alias='d', max_length=11)


class CompactInternalCatalog(CatalogDecision):
    kind: CatalogDecision.model_fields['kind'].annotation = Field(alias='k')
    query: str = Field(alias='q', min_length=1, max_length=2000)
    primaries: list[Annotated[int, Field(ge=0, lt=16)]] = Field(alias='p', max_length=16)


class CompactInternalDocumentCatalog(CompactInternalCatalog):
    kind: Literal['DOCUMENT'] = Field(alias='k')


def catalog_generator(generate, *, customer):
    async def compact(prompt, data, canonical_schema):
        mapping = ('k=kind,t=topic,q=search_query,n=comparison_names,p=primaries,d=dependencies; '
            'each dependency uses i=index,p=primary,m=missing_rule,r=reference_quote' if customer
            else 'k=kind,q=query,p=primaries')
        instruction = prompt + '\nWire keys: ' + mapping + '. '
        instruction += 'Use only actual catalog i addresses. All original discovery, role and explicit-reference rules remain mandatory.'
        wire_schema = CompactCustomerCatalog if customer else CompactInternalCatalog
        if not customer and issubclass(canonical_schema, DocumentCatalogDecision):
            wire_schema = CompactInternalDocumentCatalog
            instruction += ' The authenticated gateway already classified this task as read-only DOCUMENT guidance. Select its original sources; do not repeat that classification. No live lookup or action is authorized.'
        attempts = 2 if os.environ.get('RAG_QWEN_CATALOG_RETRY') == 'true' else 1
        for attempt in range(attempts):
            try:
                result = await generate(instruction, data, wire_schema)
                result = canonical_schema.model_validate(result.model_dump())
                available = {entry['i'] for entry in data['catalog']}
                selected = set(result.primaries)
                invalid = len(selected) != len(result.primaries) or bool(selected - available)
                if customer:
                    # Every primary is read in full. A dependency targeting an
                    # already-selected complete primary adds no source coverage.
                    # Normalize this provisional redundancy before admission;
                    # absent/unselected references still fail the original checks.
                    result = canonical_schema.model_validate({**result.model_dump(), 'dependencies': [
                        item.model_dump() for item in result.dependencies
                        if not (item.primary in selected and item.index in selected)]})
                    invalid |= any(item.primary not in selected or item.index not in available
                        or item.primary == item.index for item in result.dependencies)
                else:
                    invalid |= result.kind == 'DEFER' and bool(selected)
                if invalid:
                    raise HTTPException(503, detail='INVALID_MODEL_OUTPUT')
                return result
            except (HTTPException, ValidationError) as error:
                if isinstance(error, HTTPException) and (error.status_code != 503 or error.detail != 'INVALID_MODEL_OUTPUT'):
                    raise
                if attempt + 1 == attempts:
                    raise HTTPException(503, detail='INVALID_MODEL_OUTPUT') from None
                instruction += ('\nCorrection: The previous discovery output was invalid. Use only catalog i addresses '
                    '(never heading indexes), without duplicates. Dependencies require a selected primary and a different '
                    'existing target; use an empty dependency list unless an exact original introduction explicitly requires it. '
                    'Resolve the ORIGINAL question using earlier USER turns; preserve the strict wire schema. Do not answer policy.')
    return compact
