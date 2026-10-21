"""MS64-TC07/14: verify extraction accounting before automatic preparation.

This verifies artifacts, never the correctness of a source's business policy.
The SQL boundary independently checks immutable bindings and publication rights.
"""
import hashlib
import re

POLICY = 'kb-auto-v1'
SAFE_WARNINGS = {'SECTION_SCOPE_REVIEW', 'BLANK_PAGE_SKIPPED', 'LEGACY_CONVERSION', 'OCR_REVIEW', 'TABLE_REVIEW'}


def complete_section(original, bodies):
    """Account for ordered source text and only source-backed table headers.

    Split rows can span chunks, with the same header inserted between their
    pieces. Match every original non-whitespace character in order, allowing
    only those complete repeated headers inside their original table unit.
    """
    compact = lambda value: re.sub(r'\s+', '', value)
    expected, actual = compact(original), compact(''.join(bodies))
    if expected == actual:
        return True
    tables = []
    offset = 0
    for unit in re.split(r'\n\s*\n', original):
        lines = unit.splitlines()
        if (len(lines) > 2 and lines[0].lstrip().startswith('|')
                and re.match(r'^\s*\|[\s|:\-]+\|?\s*$', lines[1])):
            header = compact('\n'.join(lines[:2]))
            tables.append((offset + len(header), offset + len(compact(unit)), header))
        offset += len(compact(unit))
    source_pos = chunk_pos = table_pos = 0
    while source_pos < len(expected) and chunk_pos < len(actual):
        while table_pos < len(tables) and source_pos >= tables[table_pos][1]:
            table_pos += 1
        if table_pos < len(tables):
            start, end, header = tables[table_pos]
            if (start <= source_pos < end and actual.startswith(header, chunk_pos)
                    and not expected.startswith(header, source_pos)):
                chunk_pos += len(header)
                continue
        if expected[source_pos] != actual[chunk_pos]:
            return False
        source_pos += 1
        chunk_pos += 1
    return source_pos == len(expected) and chunk_pos == len(actual)


def verify_preparation(extraction, chunks):
    sections = extraction['sections']
    normalized = '\n\n'.join(section['text'] for section in sections)
    if (not normalized.strip() or not chunks
            or hashlib.sha256(normalized.encode()).hexdigest() != extraction['content_sha256']
            or set(extraction['warning_codes']) - SAFE_WARNINGS):
        raise ValueError('MANIFEST_INVALID')
    offset = 0
    for section in sections:
        if (section.get('normalized_start') != offset
                or section.get('normalized_end') != offset + len(section['text'])
                or section.get('outcome', 'EXTRACTED') not in {'EXTRACTED', 'SKIPPED_BLANK'}):
            raise ValueError('MANIFEST_INVALID')
        offset += len(section['text']) + 2
    for chunk in chunks:
        context = chunk['section_context']
        if (context.get('version') != 2 or not context.get('structure_known')
                or context.get('unresolved') or context.get('unresolved_references')):
            raise ValueError('MANIFEST_INVALID')
    # Strip generated heading prefixes, then account for every normalized source
    # character across split units. No source policy text may disappear.
    by_section = {}
    for chunk in chunks:
        body = chunk['content']
        prefix = chunk['heading_path'] + '\n\n' if chunk['heading_path'] else ''
        if prefix and body.startswith(prefix):
            body = body[len(prefix):]
        by_section.setdefault(chunk['section_context']['section_id'], []).append(body)
    for sid, bodies in by_section.items():
        original = '\n\n'.join(section['text'] for section in sections if section.get('section_id') == sid)
        if not complete_section(original, bodies):
            raise ValueError('MANIFEST_INVALID')
    if {s['section_id'] for s in sections if s['text'].strip()} != set(by_section):
        raise ValueError('MANIFEST_INVALID')
    return POLICY


def verify_support_preparation(extraction, chunks):
    """MS65: source integrity plus actual canonical-unit partition admission.

    Publication certifies preparation, not all possible answers. No local policy
    scope is inferred; answering must inspect the complete source generation.
    """
    verify_preparation(extraction, chunks)
    from rag.document_support import canonical_units, partition
    sources = [{'chunk_id': str(c['ordinal']), 'heading_path': c['heading_path'],
                'content': c['content'], 'content_hash': c['content_sha256']} for c in chunks]
    try:
        partition(canonical_units(sources))
    except Exception as error:
        from fastapi import HTTPException
        if isinstance(error, HTTPException):
            raise ValueError('CONTENT_LIMIT') from None
        raise
    return 'ms65-v1'
