"""SDD-C21 / QAD-TC44/46: compact provisional output, unchanged verification."""
from typing import get_args
import copy
import re

from pydantic import Field, create_model

from .document_support import Strict, DraftFragment


def compact_draft_schema(schema, *, customer=False):
    # Keep the original source-specific numeric bounds in the provider grammar
    # as well as canonical validation. Large generic bounds can let the model
    # confuse printed FAQ numbers with valid canonical evidence addresses.
    claim = get_args(schema.model_fields['blocks'].annotation)[0]
    compact_claim = create_model('CompactClaim', __base__=Strict,
        t=(str, Field(min_length=1, max_length=1800)),
        p=(claim.model_fields['support'].annotation, copy.deepcopy(claim.model_fields['support'])))
    return create_model('CompactDraft', __base__=Strict,
        s=(schema.model_fields['scope'].annotation, ...),
        b=(list[compact_claim], Field(max_length=12)))


def restore_draft(value, schema):
    return schema(scope=value.s, blocks=[{'kind': 'text', 'text': block.t, 'support': block.p}
                                       for block in value.b])


def trim_customer_orientation_fragments(fragments):
    """Remove optional draft topics, never original evidence or safety checks."""
    result = []
    for fragment in fragments:
        sentences = re.split(r'(?<=[.!?])\s+|\n+', fragment.text)
        retained = [sentence for sentence in sentences if not re.search(
            r'\b(?:QR(?:s| codes?)?|rewards?|vouchers?|(?:unique )?customer id)\b', sentence, re.I)]
        text = ' '.join(retained).strip()
        if text:
            result.append(DraftFragment(text=text, support=fragment.support))
    return result or fragments


def reconcile_catalog_capacities(text, catalog):
    """PRD-F26: keep live numeric fields out of document-backed policy prose.

    Only explicit positive capacity labels are mechanical field bindings.
    The gateway displays current capacities separately from document citations.
    Do not rewrite policy, negation, party requirements or source evidence. The
    complete resulting answer still receives independent original-source review.
    """
    for fact in catalog or []:
        number = r'(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)'
        pattern = (r'(' + re.escape(fact['name']) + r'\s*)\(\s*'
                   + number +
                   r'[-\s]+(?:persons?|people|pax|seats?)\s*\)')
        text = re.sub(pattern, lambda match: match[1].rstrip(), text, flags=re.I)
        # A positive adjacent size adjective is also a field label. Restrictive
        # or negative statements do not match and remain original policy prose.
        adjective = (r'(' + re.escape(fact['name']) + r'\s+(?:is\s+)?(?:a\s+)?'
                     r'(?:(?:private|soundproof)\s+)?)' + number + r'[-\s]+person\s+(rooms?|booths?|spaces?)\b')
        text = re.sub(adjective, lambda match: match[1] + match[2], text, flags=re.I)
        # A generated call-permission sentence can move the historical size
        # label after the activity. Anchor the whole positive subject/predicate
        # so restrictive wording such as "only allows" remains untouched.
        call_size = (r'(' + re.escape(fact['name'])
                     + r'\s+allows\s+(?:spoken\s+)?(?:video\s+)?calls)\s+for\s+'
                     + number + r'\s+(?:people|persons?|pax)(?=[,.!?;]|$)')
        text = re.sub(call_size, lambda match: match[1], text, flags=re.I)
    return text


def source_backed_payment_method_only(text, proof):
    """A literal method name is not an assertion about a QR's access role."""
    if not any('QR Payment' in unit['text'] for unit in proof):
        return False
    if not re.search(r'\bQR\b', text):
        return False
    if re.search(r'\bQR(?:s| codes?)?\b', text.replace('QR Payment', ''), re.I):
        return False
    roles = r'\b(?:bookings?|codes?|scan\w*|check.?in|entry|access|tokens?|active|activat\w*|valid\w*|confirm\w*|approv\w*|assign\w*|allocat\w*|refund\w*)\b'
    return not re.search(roles, text, re.I)


def qualify_customer_payment_channel(blocks):
    """Qualify generated website-link steps before independent source review.

    A mixed-channel introduction must not attach an emailed payment link to the
    on-site kiosk. No source text, evidence offsets or transaction is changed.
    """
    text = '\n'.join(block['text'] for block in blocks)
    if not re.search(r'\b(?:kiosk|walk[ -]?in)\b', text, re.I) or not re.search(r'\b(?:website|online)\b', text, re.I):
        return blocks
    result = []
    for block in blocks:
        # Keep a supported capability description without turning the software
        # name into an unsupported assertion that it is the physical venue.
        prose = re.sub(r'\bDeskAtlas is (?:a|the) (?:coworking|co-working) (?:space|venue|hub) where you can\b',
                       'With DeskAtlas, you can', block['text'], flags=re.I)
        sentences = re.split(r'(?<=[.!?])\s+|\n+', prose)
        for index, sentence in enumerate(sentences):
            link_step = re.search(r'\b(?:private|email|payment)\s+(?:payment\s+)?(?:link|page)\b', sentence, re.I)
            if link_step and not re.search(r'\b(?:website|online)\b', sentence, re.I):
                sentences[index] = 'For website reservations, ' + sentence[0].lower() + sentence[1:]
        result.append({**block, 'text': ' '.join(sentences)})
    return result


def canonical_access_blocks(blocks, proof, originals=None, *, customer_reference=False):
    """Protect QR identities/roles with mapped ORIGINAL wording before review.

    A positive model verdict cannot authorize swapping payment and booking QR
    roles. Reuse the already-selected exact evidence, never a canned policy.
    Independent relevance, completeness and source checks still run afterward.
    """
    result = []
    for block in blocks:
        if re.search(r'\bQR(?:s| codes?)?\b', block['text'], re.I):
            method_only = 'QR Payment' in block['text'] and not re.search(r'\bQR(?:s| codes?)?\b', block['text'].replace('QR Payment', ''), re.I)
            if customer_reference and method_only:
                sentences = re.split(r'(?<=[.!?])\s+|\n+', block['text'])
                if len(sentences) > 1:
                    # Project generated prose only. All ORIGINAL units and
                    # canonical offsets remain unchanged for independent review.
                    result.extend(canonical_access_blocks([{**block, 'text': sentence} for sentence in sentences if sentence.strip()],
                        proof, originals, customer_reference=True))
                    continue
            if customer_reference and source_backed_payment_method_only(block['text'], originals or proof):
                if not any('QR Payment' in proof[index]['text'] for index in block['support']):
                    choices = [unit for unit in originals or [] if 'QR Payment' in unit['text']]
                    if not choices:
                        from fastapi import HTTPException
                        raise HTTPException(503, detail='INVALID_MODEL_OUTPUT')
                    unit = min(choices, key=lambda item: len(item['text']))
                    address = next((i for i, item in enumerate(proof) if item['i'] == unit['i']), None)
                    if address is None:
                        address = len(proof)
                        proof.append(unit)
                    block = {**block, 'support': list(dict.fromkeys([*block['support'], address]))}
                # Exact literal method label; independent support/completeness
                # still checks the entire prose against every original unit.
                result.append(block)
                continue
            exact = '\n\n'.join(proof[index]['text'] for index in block['support'])
            if not re.search(r'\bQR(?:s| codes?)?\b', exact, re.I):
                # A draft may cite adjacent check-in prose while misstating
                # the QR identity. Recover exact QR rules from the SAME fully
                # selected originals, then independently check applicability.
                rules = [u for u in originals or [] if re.search(r'\bQR(?:s| codes?)?\b', u['text'], re.I)]
                if customer_reference and method_only:
                    methods = [unit for unit in rules if 'QR Payment' in unit['text']]
                    if methods:
                        rules = [min(methods, key=lambda unit: len(unit['text']))]
                if not rules:
                    from fastapi import HTTPException
                    raise HTTPException(503, detail='INVALID_MODEL_OUTPUT')
                seen = set()
                for rule in rules:
                    if rule['text'] in seen:
                        continue
                    seen.add(rule['text'])
                    address = next((i for i, u in enumerate(proof) if u['i'] == rule['i']), None)
                    if address is None:
                        address = len(proof)
                        proof.append(rule)
                    result.append({'kind': 'text', 'text': rule['text'], 'support': [address]})
                continue
            block = {**block, 'text': exact}
        result.append(block)
    return result


def requested_scope(query, proposed):
    """A draft label cannot turn one task into an entire-document request."""
    if proposed == 'DOCUMENT_WIDE' and not re.search(
            r'\b(?:entire|whole|full|complete)\s+(?:source|document|manual|sop|handbook)\b', query, re.I):
        return 'MULTI_PART'
    return proposed


def overview_requested(query):
    return bool(re.search(r'\b(?:big picture|overview|how does (?:deskatlas|this|it|booking) work|what is deskatlas|where (?:do|should) (?:i|we) start|'
                          r'what should (?:i|we) (?:focus on|prioritize)|'
                          r'what (?:are|should be) (?:my|our) priorities)\b', query, re.I))


NO_HOLD = re.compile(r"\b(?:(?:does|do|will|can)(?: not|n['’]t)\s+(?:hold|reserve|secure)|never\s+(?:hold|reserve|secure)|no inventory holds?)\b", re.I)


def preserve_booking_boundary(query, fragments, units):
    """Add an omitted exact original rule BEFORE independent verification."""
    flow = re.search(r'\b(?:how (?:do|can|should) (?:i|we|you) (?:book|reserve)|how to (?:book|reserve)|booking process|make (?:a )?reservation|paano.{0,50}(?:book|reserba))\b', query, re.I)
    if not flow or NO_HOLD.search('\n'.join(block.text for block in fragments)):
        return fragments
    for unit in units:
        if NO_HOLD.search(unit['text']) and re.search(r'\b(inventory|workspace|desk|unit|spot|reservation)s?\b', unit['text'], re.I):
            return [*fragments, DraftFragment(text=unit['text'], support=[unit['i']])]
    return fragments
