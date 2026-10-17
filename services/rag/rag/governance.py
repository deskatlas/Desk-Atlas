"""MS53/QAD-TC44: exact published governance evidence, no inferred permissions."""
import re
from .procedure import verified_closure


def governance_intent(message):
    text = re.sub(r'\s+', ' ', message.strip().lower().removesuffix('?'))
    subject = r'(?:the )?(?:sop|standard operating procedures?)'
    owner = rf'(?:who (?:can|may) (?:manage|maintain|review|update) {subject}|who is responsible for (?:managing|maintaining|reviewing(?: and updating)?|updating) {subject})'
    improve = rf'(?:can (?:we|staff|employees) (?:improve|suggest improvements to|suggest changes to) (?:{subject}|it)|how can (?:we|staff|employees) (?:improve|suggest improvements to|suggest changes to) {subject})'
    if re.fullmatch(owner, text):
        return True, False
    if re.fullmatch(owner + ' and ' + improve, text):
        return True, True
    if re.fullmatch(improve, text) and not re.search(r'\bit$', text):
        return False, True
    return None


def governance_support(content):
    text = content.lower()
    sop = bool(re.search(r'\bsop\b|standard operating procedure', text))
    owner = sop and all(re.search(pattern, text) for pattern in (
        r'\b(?:management|managers?|administrators?|admins?|owners?)\b', r'\bresponsib\w*\b', r'\b(?:review\w*|updat\w*|maintain\w*)\b'))
    improve = sop and all(re.search(pattern, text) for pattern in (
        r'\b(?:employees?|staff)\b', r'\b(?:suggest\w*|feedback)\b', r'\bmanagement\b', r'\breview\w*\b'))
    return bool(owner), bool(improve)


def strict_governance_quotes(body, complete_quotes):
    intent = governance_intent(body.query)
    if intent is None:
        return None
    relevant = [source for source in body.sources if any(need and found for need, found in zip(intent, governance_support(source.content)))]
    if any(need and not any(governance_support(source.content)[index] for source in relevant) for index, need in enumerate(intent)):
        return None
    if not verified_closure(body, [source.chunk_id for source in relevant]):
        return None
    # Copy every required source unchanged. Never turn a role name or suggestion
    # into a generated yes/no permission statement.
    return complete_quotes(body, [{'chunk_id': source.chunk_id, 'quote': source.content} for source in relevant])
