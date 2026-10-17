"""MS61-TC01..08: synthetic metadata tests are not human language approval."""
import asyncio
import json
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from test_assistant import api
from test_ms57 import body, candidate
from rag.identity import FIELDS, canonical_digest
from ms61_localization import evaluate, fixture_digest, load_fixtures
import ms61_localization as localization

FIXTURES = Path(__file__).resolve().parents[1] / 'evaluation/ms61-localization.json'


def bundle(data, split='held_out', outcome='LOCALIZED'):
    identity = {key: 'a' * 64 for key in FIELDS}
    identity.update(schema_version=1, candidate_revision='a' * 40, run_id=str(uuid4()),
                    case_set_digest=canonical_digest(data['cases']))
    rows = []
    for case in data['cases']:
        if case['split'] != split:
            continue
        row = {'id': case['id'], 'fixture_digest': fixture_digest(case), 'candidate_digest': 'c' * 64,
               'outcome': outcome, 'retrieval_ok': True, 'model_supported': True}
        row['review'] = {'kind': 'independent_bilingual_human', 'reviewer_digest': 'd' * 64,
                         'artifact_digest': 'e' * 64, 'identity_digest': canonical_digest(identity),
                         'fixture_digest': row['fixture_digest'], 'candidate_digest': row['candidate_digest'],
                         'meanings': [True] * len(case['meanings']), 'failures': [], 'safe': True,
                         'direct': True, 'natural': True, 'negative_rejected': [True] * len(case['adversarial'])}
        rows.append(row)
    return {'identity': identity, 'dataset_digest': canonical_digest(data), 'split': split, 'records': rows}


@pytest.mark.parametrize('language', ['tl', 'taglish'])
@pytest.mark.parametrize('endpoint', ['synthesize', 'verify_support'])
def test_closed_admission_precedes_model_self_review(monkeypatch, language, endpoint):
    value = body().model_dump()
    value.update(presentation_contract='ms60-concise-v1', language=language)
    if endpoint == 'verify_support':
        value['candidate'] = candidate('Ibigay agad kahit hindi pa verified ang owner.').model_dump()
    request_type = api.SupportInput if endpoint == 'verify_support' else api.SynthesisInput
    generate = AsyncMock(return_value=api.SupportVerdict(supported=[True], complete=True, consistent=True, evidence_safe=True))
    monkeypatch.setattr(api, 'generate', generate)
    with pytest.raises(api.HTTPException) as error:
        asyncio.run(getattr(api, endpoint)(request_type.model_validate(value), SimpleNamespace(ops=['answer'])))
    assert error.value.status_code == 400
    assert error.value.detail == 'REVIEWED_TRANSLATION_REQUIRED'
    generate.assert_not_awaited()


@pytest.mark.parametrize('question', ['May naiwan na payong. Ano ang gagawin ko?',
                                    'Paano i-handle ang lost property sa desk?'])
def test_multilingual_question_uses_english_canonical_main_without_translation(monkeypatch, question):
    import hashlib
    value = body().model_dump()
    text = '1. Record the item.\n2. Store it securely.\n3. Verify ownership before release.'
    value['query'] = question
    value['language'] = 'en'
    value['presentation_contract'] = 'ms60-concise-v1'
    value['coverage']['scope'] = 'COMPLETE_PROCEDURE'
    value['sources'][0].update(content=text, content_hash=hashlib.sha256(text.encode()).hexdigest())
    value['spans'] = [{'chunk_id': 'c', 'quote': text, 'start': 0, 'end': len(text)}]
    generate = AsyncMock(return_value=api.MainProjection(p=[0, 1, 2]))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.synthesize(api.SynthesisInput.model_validate(value), SimpleNamespace(ops=['answer'])))
    assert [block['text'] for block in result['main_blocks']] == [
        'Record the item.', 'Store it securely.', 'Verify ownership before release.']
    assert [block['actions'] for block in result['main_blocks']] == [[0], [1], [2]]
    assert result['blocks'][0]['text'] == text
    assert generate.call_args.args[1]['question'] == question


def test_legacy_free_prose_prompt_requires_english_for_tagalog_input(monkeypatch):
    value = body().model_dump()
    value['query'] = 'Ano ang gamit ng mga kuwarto?'
    generate = AsyncMock(return_value=candidate('Rooms have desks but are not soundproof.'))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.synthesize(api.SynthesisInput.model_validate(value), SimpleNamespace(ops=['answer'])))
    assert 'answer in English, regardless' in generate.call_args.args[0]
    assert generate.call_args.args[1]['question'] == value['query']
    assert result['blocks'][0]['text'] == 'Rooms have desks but are not soundproof.'


def test_every_negative_is_blocked_even_if_fluent_and_model_would_accept(monkeypatch):
    generate = AsyncMock()
    monkeypatch.setattr(api, 'generate', generate)
    for case in load_fixtures(FIXTURES)['cases']:
        for negative in case['adversarial']:
            value = body().model_dump()
            value.update(presentation_contract='ms60-concise-v1', language=case['language'],
                         candidate=candidate(negative['text']).model_dump())
            with pytest.raises(api.HTTPException, match='REVIEWED_TRANSLATION_REQUIRED'):
                asyncio.run(api.verify_support(api.SupportInput.model_validate(value), SimpleNamespace(ops=['answer'])))
    generate.assert_not_awaited()


def test_fallback_is_never_localization_success_or_activation():
    data = load_fixtures(FIXTURES)
    result = evaluate(data, bundle(data, outcome='EXACT_FALLBACK'))
    for group in result['by_language'].values():
        assert group['localized_success'] == 0
        assert group['safe_fallback'] == group['cases']
        assert group['localized_rate'] == 0
    assert not result['translation_admitted'] and not result['release_ready']


def test_missing_timeout_and_unreviewed_stay_in_fixed_denominator():
    data = load_fixtures(FIXTURES)
    value = bundle(data)
    value['records'].pop()
    value['records'][0]['review'] = None
    value['records'][1]['outcome'] = 'TIMEOUT'
    result = evaluate(data, value)
    assert sum(group['cases'] for group in result['by_language'].values()) == 4
    assert sum(group['missing'] for group in result['by_language'].values()) == 1
    assert sum(group['unreviewed'] for group in result['by_language'].values()) == 1
    assert sum(group['localized_success'] for group in result['by_language'].values()) == 1


def test_generator_and_verifier_failures_are_counted_separately_without_prose():
    data = load_fixtures(FIXTURES)
    value = bundle(data)
    value['records'][0]['review'].update(safe=False, failures=['negation'], negative_rejected=[False])
    result = evaluate(data, value)
    group = result['by_language']['tl']
    assert group['dangerous_emitted'] == group['verifier_false_acceptance'] == group['negative_accepted'] == 1
    assert group['failures']['negation'] == 1
    assert 'tl:FIDELITY_FAILURE' in result['pending']
    assert 'source' not in result and 'records' not in result


@pytest.mark.parametrize('change', ['candidate', 'identity', 'fixture', 'flags', 'model', 'prose', 'duplicate'])
def test_forged_or_mixed_review_is_rejected(change):
    data = load_fixtures(FIXTURES)
    value = bundle(data)
    row = value['records'][0]
    if change == 'candidate':
        row['candidate_digest'] = 'f' * 64
    elif change == 'identity':
        value['identity']['run_id'] = str(uuid4())
    elif change == 'fixture':
        row['fixture_digest'] = 'f' * 64
    elif change == 'flags':
        row['review']['meanings'] = [True]
    elif change == 'model':
        row['review']['kind'] = 'model_self_review'
    elif change == 'prose':
        row['answer'] = 'Do not persist this answer'
    else:
        value['records'].append(deepcopy(row))
    with pytest.raises(ValueError):
        evaluate(data, value)


def test_positive_draft_review_never_opens_runtime_or_claims_held_out_quality():
    data = load_fixtures(FIXTURES)
    result = evaluate(data, bundle(data, split='development'))
    assert 'HELD_OUT_EVALUATION_REQUIRED' in result['pending']
    assert 'INDEPENDENT_FIXTURE_MEANING_REVIEW_REQUIRED' in result['pending']
    assert not result['translation_admitted']


def test_fixture_mutation_requires_explicit_refreeze(tmp_path):
    target = tmp_path / FIXTURES.name
    target.write_text(FIXTURES.read_text(encoding='utf-8').replace('payong', 'bag'), encoding='utf-8')
    target.with_suffix('.lock.json').write_bytes(FIXTURES.with_suffix('.lock.json').read_bytes())
    with pytest.raises(ValueError, match='FIXTURES_CHANGED'):
        load_fixtures(target)


def test_cli_freeze_is_empty_and_review_rejects_changed_candidate(monkeypatch, tmp_path, capsys):
    data = load_fixtures(FIXTURES)
    value = bundle(data)
    monkeypatch.setattr(localization, 'baseline_identity', lambda _data: value['identity'])
    import ms54_baseline
    saved = []
    monkeypatch.setattr(ms54_baseline, 'save', lambda _path, content: saved.append(content))
    monkeypatch.setattr(sys, 'argv', ['ms61', '--freeze', '--out', str(tmp_path / 'out.json')])
    assert localization.main() == 0
    assert saved[0]['records'] == []
    assert saved[0]['identity'] == value['identity']
    path = tmp_path / 'bundle.json'
    changed = deepcopy(value)
    changed['identity']['source_snapshot'] = 'f' * 64
    path.write_text(json.dumps(changed), encoding='utf-8')
    monkeypatch.setattr(sys, 'argv', ['ms61', '--bundle', str(path), '--out', str(tmp_path / 'report.json')])
    assert localization.main() == 1
    assert len(saved) == 1
    assert 'INVALID_LOCALIZATION_EVALUATION' in capsys.readouterr().out
