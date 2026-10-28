"""SDD-C21 / QAD-TC44: explicit internal JSON transport experiment."""
import os

from fastapi import HTTPException

from rag.document_support import wire


def internal_output_payload(payload, *, internal):
    mode = os.environ.get('RAG_INTERNAL_OUTPUT_FORMAT', 'json_schema')
    if mode not in ('json_schema', 'json_object'):
        raise HTTPException(503, detail='INVALID_INTERNAL_OUTPUT_FORMAT')
    if not internal or mode == 'json_schema':
        return payload
    schema = payload['response_format']['json_schema']['schema']
    return {**payload, 'response_format': {'type': 'json_object'},
        'messages': [{**message, 'content': message['content'] +
            '\nReturn one JSON object matching this schema. Local strict validation rejects invalid or missing fields:\n' + wire(schema).decode()}
            if index == 0 else message for index, message in enumerate(payload['messages'])]}
