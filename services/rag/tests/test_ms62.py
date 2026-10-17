"""MS62-TC02/03/04: canonical units never infer scope from a heading name."""
import hashlib
from test_assistant import api
from test_ms57 import body


def request_for(content):
    evidence = body().model_dump()
    evidence['sources'][0].update(
        title='SOP', heading_path='SOP / During an emergency / Lost property',
        content=content, content_hash=hashlib.sha256(content.encode()).hexdigest())
    evidence['spans'] = [{'chunk_id': 'c', 'quote': content, 'start': 0, 'end': len(content)}]
    return api.SynthesisInput.model_validate(evidence)


def test_scope_without_guard_words_remains_available_for_selection_and_review():
    request = request_for('# SOP\n## During an emergency\n1. Contact the supervisor.')
    units = api.main_units(request)
    assert [unit['text'] for unit in units] == ['# SOP', '## During an emergency', 'Contact the supervisor.']
    assert [unit['action'] for unit in units] == [None, None, 0]


def test_repeated_actions_at_different_stages_keep_distinct_indexes_and_conditions():
    content = ('# Lost property\n1. Record the item.\n2. Verify ownership.\n'
               'Before release, ask management.\n# Lost property\n3. Verify ownership.\n'
               'Never release without verification.\n## FAQ\nVerify ownership.')
    request = request_for(content)
    units = api.main_units(request)
    assert [unit['action'] for unit in units if unit['action'] is not None] == [0, 1, 2]
    assert [unit['text'] for unit in units].count('# Lost property') == 2
    assert [unit['text'] for unit in units].count('Verify ownership.') == 3
    assert 'Before release, ask management.' in [unit['text'] for unit in units]
    assert request.spans[0].quote == content


def test_fenced_and_indented_labels_remain_literal_units_without_actions():
    request = request_for('```\n# SOP\n1. Example\n```\n    SOP\n1. Store securely.')
    units = api.main_units(request)
    assert [unit['text'] for unit in units] == ['```', '# SOP', '1. Example', '```', '    SOP', 'Store securely.']
    assert [unit['action'] for unit in units] == [None, None, None, None, None, 0]
