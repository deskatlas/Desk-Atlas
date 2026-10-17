"""MS-48/MS-53 / SDD-C23: source-backed, reviewable support-unit graph.

Extractor heading events and complete headingless document units establish
identity. Rule scope remains UNREVIEWED until explicit administrator approval.
References resolve only to unique original heading instances.
"""
import hashlib
import re

REFERENCE = re.compile(r'\[[^\]]+\]\(#([^)]+)\)|\b(?:see|refer to|according to|subject to)\s+(?:section\s+)?["\u201c]([^"\u201d]+)["\u201d]', re.I)
REFERENCE_HINT = re.compile(r'\b(?:see|refer to|according to|subject to)\s+(?:section|chapter|appendix|policy|procedure)\b', re.I)


def anchor(heading):
    return re.sub(r'[^\w\- ]', '', heading.casefold()).replace(' ', '-')


def attach_structure(chunks, sections):
    nodes = {}
    for section in sections:
        if not section['text'].strip():
            continue
        sid = section.get('section_id')
        if sid is None:
            continue
        node = nodes.setdefault(sid, {'id': sid, 'ancestors': section['ancestors'], 'text': '', 'heading': section['heading'].split(' / ')[-1], 'uncertain': False})
        node['text'] += '\n\n' + section['text']
        node['uncertain'] = node['uncertain'] or section.get('structure_uncertain', False)
    targets = {}
    for sid, node in nodes.items():
        for key in {anchor(node['heading']), node['heading'].casefold()}:
            targets.setdefault(key, set()).add(sid)
    # Preamble/furniture has structural document scope. Policy scope is a
    # reviewed input, never inferred from words such as "only" or "may".
    global_ids = {sid for sid, node in nodes.items() if not node['heading']}
    graph_over_budget = len(nodes) > 1000 or len(nodes) * len(global_ids) > 10000
    for chunk in chunks:
        sid = chunk.pop('_section_id', None)
        node = nodes.get(sid)
        dependencies = set() if graph_over_budget else set(global_ids)
        unresolved = node is None or graph_over_budget
        ancestors = sorted(parent for parent in node['ancestors'] if parent in nodes) if node else []
        references = set()
        unresolved_references = False
        if node and not graph_over_budget:
            dependencies.update(parent for parent in node['ancestors'] if parent in nodes)
            matches = list(REFERENCE.finditer(node['text']))
            # Ordinary URLs are never dependencies and are never fetched.
            residual = REFERENCE.sub('', node['text'])
            unresolved_references = bool(REFERENCE_HINT.search(residual))
            unresolved = unresolved or unresolved_references
            for match in matches:
                found = targets.get((match[1] or match[2]).casefold(), set())
                if len(found) != 1:
                    unresolved = True
                    unresolved_references = True
                else:
                    references.update(found)
                dependencies.update(found)
        dependencies.discard(sid)
        context = {'version': 2, 'section_id': sid or 'unstructured',
                   'dependencies': sorted(dependencies), 'unresolved': unresolved,
                   'ancestors': ancestors, 'references': sorted(references),
                   'scope': 'UNREVIEWED', 'structure_known': node is not None and not graph_over_budget and not node['uncertain'],
                   'unresolved_references': unresolved_references}
        chunk['section_context'] = context
        chunk['structure_sha256'] = structure_hash(context)
    return chunks


def structure_hash(context):
    # SQL hashes this same explicit field sequence, independent of JSON spacing.
    value = '|'.join([str(context['version']), context['section_id'], ','.join(context['dependencies']),
                      'true' if context['unresolved'] else 'false'])
    if context['version'] == 2:
        value += '|' + '|'.join([','.join(context['ancestors']), ','.join(context['references']),
                                context['scope'], str(context['structure_known']).lower(),
                                str(context['unresolved_references']).lower()])
    return hashlib.sha256(value.encode()).hexdigest()


def manifest_hash(chunks):
    return hashlib.sha256(''.join(c['content_sha256'] + c['structure_sha256'] for c in chunks).encode()).hexdigest()
