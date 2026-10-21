"""MS64-TC02/07/14: automatic preparation against real synthetic extraction."""
import copy
import io
import json
from types import SimpleNamespace

import pytest

from knowledge.extract import extract
from knowledge.chunk import chunk_sections
from knowledge.preparation import verify_preparation
from test_knowledge_ingestion import CharacterTokenizer


def prepared(tmp_path, text='# Checkout\nVerify the reference.\n\n# Restrictions\nNever add a fee.'):
    path = tmp_path / 'guide.md'
    path.write_text(text, encoding='utf-8')
    extraction = extract(path, 'MD', tmp_path)
    return extraction, chunk_sections(extraction['sections'], CharacterTokenizer())


def test_complete_multi_section_rules_are_eligible(tmp_path):
    extraction, chunks = prepared(tmp_path)
    assert verify_preparation(extraction, chunks) == 'kb-auto-v1'
    assert all(c['section_context']['scope'] == 'UNREVIEWED' for c in chunks)


def test_large_split_paragraph_retains_every_character(tmp_path):
    extraction, chunks = prepared(tmp_path, 'Always verify the reference before releasing the card. ' * 50)
    assert len(chunks) > 1
    assert verify_preparation(extraction, chunks) == 'kb-auto-v1'


def test_hosted_table_with_split_row_accounts_for_repeated_headers(tmp_path):
    from rag.embedding_provider import ByteTokenizer
    extraction, _ = prepared(tmp_path, '# Identifiers\n\n| Identifier | Meaning |\n| :--- | :--- |\n'
                              '| Customer ID | ' + 'Preserve this customer qualification. ' * 25 + '|\n')
    chunks = chunk_sections(extraction['sections'], ByteTokenizer())
    assert len(chunks) > 1
    assert verify_preparation(extraction, chunks) == 'kb-auto-v1'


@pytest.mark.parametrize('damage', ['missing', 'changed', 'reordered', 'duplicated'])
def test_repeated_table_headers_do_not_hide_source_damage(tmp_path, damage):
    from rag.embedding_provider import ByteTokenizer
    extraction, _ = prepared(tmp_path, '# Identifiers\n\n| Identifier | Meaning |\n| :--- | :--- |\n'
                              '| Customer ID | ' + 'Preserve this customer qualification. ' * 25 + '|\n')
    chunks = chunk_sections(extraction['sections'], ByteTokenizer())
    if damage == 'missing':
        chunks.pop()
    elif damage == 'changed':
        chunks[-1]['content'] = chunks[-1]['content'].replace('qualification', 'permission')
    elif damage == 'reordered':
        chunks.reverse()
    else:
        chunks.append(copy.deepcopy(chunks[-1]))
    with pytest.raises(ValueError, match='MANIFEST_INVALID'):
        verify_preparation(extraction, chunks)


@pytest.mark.parametrize('damage', ['hash', 'offset', 'missing', 'qualification', 'unresolved', 'unknown', 'embedded'])
def test_uncertain_or_incomplete_artifacts_cannot_publish(tmp_path, damage):
    extraction, chunks = prepared(tmp_path)
    extraction, chunks = copy.deepcopy(extraction), copy.deepcopy(chunks)
    if damage == 'hash':
        extraction['content_sha256'] = 'a' * 64
    elif damage == 'offset':
        extraction['sections'][0]['normalized_end'] += 1
    elif damage == 'missing':
        chunks.pop()
    elif damage == 'qualification':
        chunks[-1]['content'] = 'Add a fee.'
    elif damage == 'unresolved':
        chunks[-1]['section_context']['unresolved_references'] = True
    elif damage == 'unknown':
        chunks[-1]['section_context']['structure_known'] = False
    else:
        extraction['warning_codes'].append('WORD_EMBEDDED_CONTENT')
    with pytest.raises(ValueError, match='MANIFEST_INVALID'):
        verify_preparation(extraction, chunks)


def test_missing_cross_reference_is_a_file_level_failure(tmp_path):
    extraction, chunks = prepared(tmp_path, 'See section Missing. Then return the card.')
    with pytest.raises(ValueError, match='MANIFEST_INVALID'):
        verify_preparation(extraction, chunks)


@pytest.mark.parametrize('kind', ['DOCX', 'PDF'])
def test_supported_binary_formats_prepare_without_human_review(tmp_path, kind):
    path = tmp_path / ('guide.' + kind.lower())
    if kind == 'DOCX':
        from docx import Document
        document = Document()
        document.add_paragraph('Never leave the cash drawer unlocked.')
        document.save(path)
    else:
        from test_knowledge_ingestion import text_pdf
        text_pdf(path)
    extraction = extract(path, kind, tmp_path)
    chunks = chunk_sections(extraction['sections'], CharacterTokenizer())
    assert verify_preparation(extraction, chunks) == 'kb-auto-v1'


@pytest.mark.parametrize('automatic', [True, False])
@pytest.mark.parametrize('hosted_table', [False, True])
def test_worker_completion_negotiates_only_new_intents(tmp_path, monkeypatch, automatic, hosted_table):
    from knowledge import worker
    from rag.embedding_provider import ByteTokenizer
    text = ('# Identifiers\n\n| Identifier | Meaning |\n| :--- | :--- |\n| Customer ID | '
            + 'Preserve this qualification. ' * 25 + '|\n') if hosted_table else '# Checkout\nVerify payment.'
    extraction, _ = prepared(tmp_path, text)
    raw = (tmp_path / 'guide.md').read_bytes()
    monkeypatch.setattr(worker, 'urlopen', lambda *args, **kwargs: io.BytesIO(raw))
    monkeypatch.setattr(worker.subprocess, 'run', lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=json.dumps({'data': extraction}).encode()))
    calls = []

    class Gateway:
        def call(self, path, data):
            calls.append((path, data))

    class Encoder:
        _model = SimpleNamespace(tokenizer=ByteTokenizer() if hosted_table else CharacterTokenizer())

        def encode(self, texts):
            return [[1.0] + [0.0] * 1023 for _ in texts]

    version = {'detected_type': 'MD', 'source_bytes': len(raw), 'source_sha256': extraction['source_sha256']}
    if automatic:
        version['upload_intent'] = {'policy': 'kb-auto-v1'}
    worker.process_claim(Gateway(), {'job': {'id': 'job', 'kind': 'INGEST', 'generation': 1, 'lease_token': 'lease'},
                                    'version': version, 'source_url': 'http://localhost/synthetic'}, Encoder(), 'a' * 64)
    completion = [data for path, data in calls if path == 'job/complete']
    assert len(completion) == 1
    assert 'error_code' not in completion[0]
    assert ('preparation_policy' in completion[0]) is automatic
    assert completion[0]['expected_chunk_count'] > 0
    assert completion[0]['extraction_manifest']
