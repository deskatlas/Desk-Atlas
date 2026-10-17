"""MS53-TC01/04: pack exact source slices at existing paragraph/list boundaries."""
import re
from rag.evidence_budget import LIMITS


def wire_length(text: str) -> int:
    # The gateway's JavaScript/Zod string limit counts UTF-16 code units.
    return len(text.encode('utf-16-le')) // 2


def fenced_ranges(content: str):
    ranges = []
    opened = None
    for match in re.finditer(r'(?m)^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)\r?$', content):
        marker, tail = match.group(1, 2)
        if opened is None:
            opened = (match.start(), marker)
        elif marker[0] == opened[1][0] and len(marker) >= len(opened[1]) and not tail.strip():
            ranges.append((opened[0], match.end()))
            opened = None
    if opened is not None:
        ranges.append((opened[0], len(content)))
    return ranges


def evidence_spans(content: str, ignored: tuple[str, ...] = (), limit: int = LIMITS['quote_utf16']):
    """Return complete units, never split a sentence, list item, or table row.

    Source offsets preserve CRLF, repeated blank lines, escapes and indentation.
    A long list can span quotes without making its individual steps incomplete.
    Oversized prose/items retain the original explicit budget-failure behavior.
    """
    spans = []
    start = 0
    fences = fenced_ranges(content)
    boundaries = [*(match.span() for match in re.finditer(r'\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*', content)
                    if not any(a <= match.start() < b for a, b in fences)), (len(content), len(content))]
    for end, following in boundaries:
        raw = content[start:end]
        left = start + len(raw) - len(raw.lstrip())
        right = end - len(raw) + len(raw.rstrip())
        text = content[left:right]
        start = following
        if not text or text in ignored:
            continue
        cuts = [left]
        if wire_length(text) > limit:
            # Only source-backed list boundaries, not arbitrary line wrapping.
            cuts += [left + m.start() for m in re.finditer(r'(?m)^(?:[ \t]{0,3})(?:\d{1,3}\\?[.)]|[-*+])\s+', text)
                     if m.start() and not any(a <= left + m.start() < b for a, b in fences)]
        cuts.append(right)
        for a, b in zip(cuts, cuts[1:]):
            segment = content[a:b]
            a += len(segment) - len(segment.lstrip())
            b -= len(segment) - len(segment.rstrip())
            if a < b:
                spans.append((a, b))
    return spans


def pack_evidence(content: str, ignored: tuple[str, ...] = (), limit: int = LIMITS['quote_utf16']):
    packed = []
    for start, end in evidence_spans(content, ignored, limit):
        if wire_length(content[start:end]) > limit:
            raise ValueError('OUTPUT_BUDGET_EXCEEDED')
        if packed and wire_length(content[packed[-1][0]:end]) <= limit and not content[packed[-1][1]:start].strip():
            packed[-1] = (packed[-1][0], end)
        else:
            packed.append((start, end))
    return [content[start:end] for start, end in packed]
