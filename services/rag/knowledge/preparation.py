"""MS64-TC07/14: verify extraction accounting before automatic preparation.

This verifies artifacts, never the correctness of a source's business policy.
The SQL boundary independently checks immutable bindings and publication rights.
"""
import hashlib
import re

POLICY = 'kb-auto-v1'
SAFE_WARNINGS = {'SECTION_SCOPE_REVIEW', 'BLANK_PAGE_SKIPPED', 'LEGACY_CONVERSION', 'OCR_REVIEW', 'TABLE_REVIEW'}


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
        compact = lambda value: re.sub(r'\s+', '', value)
        if compact(original) != compact(''.join(bodies)):
            # Repeated table headers are safe context; ordinary source lines
            # must still be represented completely in the corresponding chunks.
            combined = '\n'.join(bodies)
            if any(line.strip() and line.strip() not in combined for line in original.splitlines()):
                raise ValueError('MANIFEST_INVALID')
    if {s['section_id'] for s in sections if s['text'].strip()} != set(by_section):
        raise ValueError('MANIFEST_INVALID')
    return POLICY
