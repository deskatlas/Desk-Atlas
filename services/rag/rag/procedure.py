"""MS53-TC01..05/11: exact source extraction for strictly proven task closures."""
import hashlib
import re
import unicodedata


def faq_text(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', value).replace('\\.', '.').replace('**', '').strip()).lower()


def faq_words(value):
    ignored = {'a', 'an', 'the', 'is', 'are', 'be', 'been', 'what', 'which', 'how', 'who', 'where', 'when', 'why',
               'can', 'could', 'may', 'should', 'do', 'does', 'did', 'have', 'has', 'for', 'of', 'to', 'if', 'they', 'their', 'them', 'we', 'you', 'i'}
    words = []
    for word in re.findall(r'[a-z0-9]+', value):
        if word in ignored:
            continue
        stem = word[:-3] + 'y' if len(word) > 5 and word.endswith('ies') else word[:-1] if len(word) > 4 and word.endswith('s') else word
        if len(stem) > 5 and stem.endswith('ing'):
            stem = stem[:-3]
        elif len(stem) > 4 and stem.endswith('ed'):
            stem = stem[:-2]
        elif len(stem) > 6 and stem.endswith('ion'):
            stem = stem[:-3]
        elif len(stem) > 7 and stem.endswith('ment'):
            stem = stem[:-4]
        words.append(stem[:-1] if len(stem) > 4 and stem.endswith('e') else stem)
    return words


def faq_seed(query, sources):
    question = faq_text(query).removesuffix('?')
    if re.search(r'\b(it|this|that|these|those|he|she|his|her)\b', question):
        return None
    if re.search(r'\b(they|them|their)\b', question) and len({role.removesuffix('s') for role in re.findall(r'\b(?:employees?|staff|management|administrators?|admins?|managers?|customers?|guests?)\b', question)}) != 1:
        return None
    words = faq_words(question)
    matches = []
    for source in sources:
        path = source.heading_path.split(' / ')
        if not any(re.match(r'^faq\b', faq_text(part)) for part in path[:-1]):
            continue
        leaf = faq_text(path[-1])
        published = re.fullmatch(r'q\d+[.)]\s+(.+)\?', leaf)
        paragraphs = re.split(r'\n\s*\n', source.content)
        if (published and (published[1] == question or re.fullmatch(r"[a-z0-9\s?,.'()-]+", question) and re.fullmatch(r"[a-z0-9\s?,.'()-]+", published[1]) and len(words) >= 3 and words == faq_words(published[1])) and faq_text(paragraphs[0]) == faq_text(source.heading_path)
                and any(part.strip() and faq_text(part) != leaf and faq_text(part).removesuffix('?') != question for part in paragraphs[1:])):
            matches.append(source)
    return matches[0] if len(matches) == 1 else None


def strict_faq_quotes(body, complete_quotes):
    if not getattr(body, 'exact_faq', False):
        return None
    source = faq_seed(body.query, body.sources)
    if source is None or not verified_closure(body, [source.chunk_id]):
        return None
    return complete_quotes(body, [{'chunk_id': source.chunk_id, 'quote': source.content}])


def normalize_task(text):
    text = re.sub(r'\s+', ' ', text.strip())
    text = re.sub(r'\bcheck(?:[ -]?out|otu)\b', 'check out', text, flags=re.I)
    return re.sub(r'\bcheck[ -]?in\b', 'check in', text, flags=re.I)


def procedure_task(message):
    text = normalize_task(message).lower().removesuffix('?')
    direct = re.fullmatch(r'(?:how do i|how do staff|how can i|how to|what is the procedure to) (check in|check out) (?:a |the )?(?:customer|guest)', text)
    direct = direct or re.fullmatch(r'paano(?: ko)? (?:mag[- ]?|i[- ]?)?(check in|check out) ng (?:customer|guest)', text)
    if direct:
        return direct[1]
    if re.fullmatch(r"(?:what should i do when (?:a |the )?(?:customer|guest) leaves|steps to finish (?:a |the )?(?:customer|guest)'s workspace session|(?:customer|guest) is leaving,? paano ang check out)", text):
        return 'check out'
    heading = re.fullmatch(r'what is (?:#{1,6}\s*)?\d+(?:\.\d+)+\.?\s+(?:customer|guest) (check in|check out)', text)
    return heading[1] if heading else None


def procedure_seed(query, sources):
    task = procedure_task(query)
    if not task:
        return None
    requested = re.match(r'^what is (?:#{1,6}\s*)?(\d+(?:\.\d+)+)\.?\s+', normalize_task(query), re.I)
    eligible = []
    matching_headings = 0
    for source in sources:
        leaf = source.heading_path.split(' / ')[-1]
        section = re.match(r'^#{0,6}\s*(\d+(?:\.\d+)+)\.?\s+', leaf)
        if requested and (not section or section[1] != requested[1]):
            continue
        heading = normalize_task(re.sub(r'\\([.\-])', r'\1', leaf)).lower()
        heading = re.sub(r'^#{1,6}\s*', '', heading)
        heading = re.sub(r'^\d+(?:\.\d+)*\.?\s*', '', heading)
        if not re.fullmatch(rf'(?:(?:customer|guest) {task}|{task} (?:customer|guest))(?: procedure)?', heading):
            continue
        matching_headings += 1
        steps = list(re.finditer(r'^\s*(\d+)\\?[.)]\s+', source.content, re.M))
        if len(steps) < 2 or [int(step[1]) for step in steps] != list(range(1, len(steps) + 1)) or re.search(r'```|~~~', source.content):
            continue
        body = normalize_task(source.content[steps[0].start():]).lower()
        if re.search(rf'\b{task}\b', body) and re.search(r'\b(?:customer|guest)\b', body):
            eligible.append((source, steps[0]))
    return eligible[0] if len(eligible) == 1 and matching_headings == 1 else None


def strict_procedure_quotes(body, complete_quotes):
    """None defers uncertain cases to the independent model support verifier.

    Proven cases copy exact complete evidence; no generated policy or inferred
    dependency is introduced. SQL/gateway remain publication authorities.
    """
    candidate = procedure_seed(body.query, body.sources)
    if candidate is None or body.groups is None:
        return None
    seed, anchor = candidate
    if not verified_closure(body, [seed.chunk_id]):
        return None
    return complete_quotes(body, [{'chunk_id': seed.chunk_id, 'quote': seed.content[anchor.start():anchor.end()]}])


def verified_closure(body, seed_ids):
    if not body.sources or body.groups is None or not seed_ids:
        return False
    seed = body.sources[0]
    if any(source.version_id != seed.version_id or source.document_id != seed.document_id or source.epoch != seed.epoch
           or hashlib.sha256(source.content.encode()).hexdigest() != source.content_hash for source in body.sources):
        return False
    groups = {group.id: group for group in body.groups}
    owners = {cid: group.id for group in body.groups for cid in group.chunk_ids}
    if len(groups) != len(body.groups) or len(owners) != len(body.sources) or sum(len(group.chunk_ids) for group in body.groups) != len(body.sources):
        return False
    if set(owners) != {source.chunk_id for source in body.sources} or any(not gid.startswith(seed.version_id + ':') for gid in groups):
        return False
    if any(cid not in owners for cid in seed_ids):
        return False
    pending = [owners[cid] for cid in seed_ids]
    visited = set()
    while pending:
        gid = pending.pop()
        if gid in visited:
            continue
        if gid not in groups:
            return False
        visited.add(gid)
        pending.extend(groups[gid].requires)
    if visited != set(groups):
        return False
    return True
