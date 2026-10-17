"""SPEC5-TC16: tokenizer-measured bounded chunks, provenance, contextual overlap."""
import hashlib
import re
from knowledge.structure import attach_structure


def chunk_sections(sections: list[dict], tokenizer) -> list[dict]:
    chunks = []
    def tokens(text):
        return tokenizer.encode(text, add_special_tokens=True)
    grouped = []
    for section in sections:
        if not section['text'].strip():
            continue
        if grouped and grouped[-1].get('section_id') == section.get('section_id') and all(grouped[-1][key] == section[key] for key in ('heading', 'page', 'method')):
            grouped[-1]['text'] += '\n\n' + section['text']
        else:
            grouped.append(dict(section))
    for section in grouped:
        prefix = (section["heading"] + "\n\n") if section["heading"] else ""
        complete = prefix + section['text']
        if len(tokens(complete)) <= 800:
            chunks.append(make_chunk(complete, section, len(chunks), len(tokens(complete))))
            continue
        # MS46-TC01/02: repeat actual qualifiers, not every role/instruction.
        # A condition that cannot fit safely is a deterministic review failure.
        restrictions = [line for line in section['text'].splitlines()
                        if re.search(r'^(?:only\b|unless\b|except\b|prerequisites?\b|before\b|never\b|huwag\b|maliban\b)|\b(?:must not|may not|cannot|hindi maaaring)\b', line.strip(), re.I)
                        and not line.startswith('#')]
        restriction_text = '\n'.join(dict.fromkeys(restrictions))
        if restriction_text and section.get('section_id') is None:
            prefix += restriction_text + '\n\n'
        if len(tokens(prefix)) > 280:
            raise ValueError("CONTENT_LIMIT")
        # Keep paragraphs/steps/FAQ pairs intact where possible. Oversized units
        # are split by tokenizer boundaries, never silently truncated.
        units = re.split(r"\n\s*\n", section["text"])
        pending = ""
        context = ""
        paired = []
        for unit in units:
            if paired and paired[-1].rstrip().endswith('?'):
                paired[-1] += '\n\n' + unit
            else:
                paired.append(unit)
        for unit in paired:
            pieces = split_unit(unit, tokenizer, budget=min(500, 650 - len(tokens(prefix))))
            for piece in pieces:
                candidate = "\n\n".join(value for value in (pending, piece) if value)
                if pending and len(tokens(prefix + context + candidate)) > 650:
                    content = prefix + context + pending
                    chunks.append(make_chunk(content, section, len(chunks), len(tokens(content))))
                    tail = pending[-60:]
                    while tail and len(tokenizer.encode(tail, add_special_tokens=False)) > 60:
                        tail = tail[1:]
                    # MS-48 sections expand as complete units, so repeating a
                    # partial tail would duplicate instructions in the answer.
                    context = tail + "\n\n" if section.get('section_id') is None else ''
                    pending = piece
                else:
                    pending = candidate
        if pending:
            content = prefix + context + pending
            count = len(tokens(content))
            if count > 800:
                raise ValueError("CONTENT_LIMIT")
            chunks.append(make_chunk(content, section, len(chunks), count))
    if not chunks:
        raise ValueError("EMPTY_TEXT")
    # Preserve legacy test/caller behavior; production extraction always supplies
    # instance metadata for MD/Word. PDF structure is explicitly unresolved.
    return attach_structure(chunks, sections)


def split_unit(unit: str, tokenizer, budget: int = 500) -> list[str]:
    """Split on Unicode character boundaries; repeat table headers on each part."""
    lines = unit.splitlines()
    table_header = '\n'.join(lines[:2]) + '\n' if len(lines) > 2 and lines[0].lstrip().startswith('|') and re.match(r'^\s*\|[\s|:\-]+\|?\s*$', lines[1]) else ''
    remaining = '\n'.join(lines[2:]) if table_header else unit
    result = []
    while remaining:
        low, high = 1, len(remaining)
        if len(tokenizer.encode(table_header, add_special_tokens=False)) >= min(150, budget):
            raise ValueError('CONTENT_LIMIT')
        while low < high:
            middle = (low + high + 1) // 2
            if len(tokenizer.encode(table_header + remaining[:middle], add_special_tokens=False)) <= budget:
                low = middle
            else:
                high = middle - 1
        boundary = low
        if boundary < len(remaining):
            for separator in ('\n', ' '):
                candidate = remaining.rfind(separator, boundary // 2, boundary)
                if candidate >= 0:
                    boundary = candidate + 1
                    break
        result.append(table_header + remaining[:boundary])
        remaining = remaining[boundary:]
    return result or ([table_header] if table_header else [])


def make_chunk(content, section, ordinal, token_count):
    if token_count > 800:
        raise ValueError("CONTENT_LIMIT")
    return {"ordinal": ordinal, "heading_path": section["heading"], "page_start": section["page"], "page_end": section["page"], "content": content, "content_sha256": hashlib.sha256(content.encode()).hexdigest(), "token_count": token_count, "extraction_method": section["method"], "_section_id": section.get('section_id')}
