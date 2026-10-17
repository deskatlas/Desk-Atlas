"""MS46-TC01..05/11/12: synthetic controls, not operational release evidence."""
import copy
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from knowledge.chunk import chunk_sections
from knowledge.extract import ExtractionError, extract
from rag.evaluation import evaluate_release
from rag.identity import canonical_digest, freeze_identity
from test_knowledge_ingestion import CharacterTokenizer, text_pdf
from test_operations import complete_evidence

ROOT = Path(__file__).resolve().parents[1]


def test_ms46_tc01_repeated_instructions_with_pinned_real_tokenizer():
    from transformers import AutoTokenizer
    model = json.loads((ROOT / 'models.json').read_text())['embedding']
    tokenizer = AutoTokenizer.from_pretrained(model['id'], revision=model['tokenizer_revision'],
        cache_dir=str(ROOT / '.cache/models'), local_files_only=True, trust_remote_code=False)
    for sentence in ('Staff must verify booking rule number {i} before changing the desk status.',
                     'Dapat suriin ng staff ang display bago ang hakbang {i}.',
                     'Staff must check ang display bago magcontinue sa step {i}.'):
        units = [sentence.format(i=index) for index in range(20)]
        if sentence.startswith('Staff must verify booking'):
            assert len(tokenizer.encode('\n\n'.join(units))) == 291
        chunks = chunk_sections([{'heading': 'Procedure', 'page': 1, 'method': 'TEXT', 'text': '\n\n'.join(units)}], tokenizer)
        assert all(len(tokenizer.encode(chunk['content'])) == chunk['token_count'] <= 800 for chunk in chunks)
        assert all(any(unit in chunk['content'] for chunk in chunks) for unit in units)


def test_ms46_tc02_qualifier_not_lost_across_chunks_and_limits_are_deterministic():
    chunks = chunk_sections([{'heading': 'Counter', 'page': None, 'method': 'TEXT',
        'text': 'Only admins approve payment.\n\n' + '\n\n'.join('Step %d: Check the display.' % i for i in range(100))}], CharacterTokenizer())
    assert all('Only admins approve payment.' in chunk['content'] for chunk in chunks)
    assert chunks[-1]['content'].endswith('Step 99: Check the display.')
    with pytest.raises(ValueError, match='CONTENT_LIMIT'):
        chunk_sections([{'heading': 'X' * 1000, 'page': None, 'method': 'TEXT', 'text': 'Useful text.'}], CharacterTokenizer())


def test_ms46_tc03_blank_page_provenance_and_empty_document(tmp_path, monkeypatch):
    from pypdf import PdfReader, PdfWriter
    text = tmp_path / 'text.pdf'
    text_pdf(text)
    writer = PdfWriter()
    writer.add_blank_page(600, 800)
    writer.add_page(PdfReader(text).pages[0])
    writer.add_blank_page(600, 800)
    source = tmp_path / 'mixed.pdf'
    writer.write(source)
    def version_only(arguments, **_kwargs):
        assert '--version' in arguments, 'A rendered blank page must not run OCR'
        return SimpleNamespace(returncode=0, stdout=b'synthetic-version', stderr=b'')
    monkeypatch.setattr(subprocess, 'run', version_only)
    result = extract(source, 'PDF', tmp_path)
    assert [section['page'] for section in result['sections']] == [1, 2, 3]
    assert result['sections'][0]['outcome'] == result['sections'][2]['outcome'] == 'SKIPPED_BLANK'
    assert 'BLANK_PAGE_SKIPPED' in result['warning_codes']
    chunks = chunk_sections(result['sections'], CharacterTokenizer())
    assert all(chunk['page_start'] == 2 for chunk in chunks)
    writer = PdfWriter()
    writer.add_blank_page(600, 800)
    writer.write(source)
    with pytest.raises(ExtractionError, match='EMPTY_TEXT'):
        extract(source, 'PDF', tmp_path)


def image_pdf(path):
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, NumberObject, DecodedStreamObject, DictionaryObject
    text_pdf(path)
    writer = PdfWriter()
    page = writer.add_page(PdfReader(path).pages[0])
    image = DecodedStreamObject()
    image.set_data(b'\x00' * 10000)
    for key, value in {'/Type': NameObject('/XObject'), '/Subtype': NameObject('/Image'),
                       '/ColorSpace': NameObject('/DeviceGray'), '/BitsPerComponent': NumberObject(8),
                       '/Width': NumberObject(100), '/Height': NumberObject(100)}.items():
        image[NameObject(key)] = value
    page['/Resources'][NameObject('/XObject')] = DictionaryObject({NameObject('/Im0'): writer._add_object(image)})
    contents = DecodedStreamObject()
    contents.set_data(page['/Contents'].get_data() + b' q 200 0 0 200 50 300 cm /Im0 Do Q')
    page[NameObject('/Contents')] = contents
    writer.write(path)


def test_ms46_tc04_readable_header_does_not_hide_scanned_body(tmp_path, monkeypatch):
    source = tmp_path / 'mixed.pdf'
    image_pdf(source)
    header = 'This is a synthetic operating procedure for text extraction.'
    def ocr(arguments, **_kwargs):
        return SimpleNamespace(returncode=0, stdout=(header + '\nNever approve without authorization.').encode(), stderr=b'')
    monkeypatch.setattr(subprocess, 'run', ocr)
    result = extract(source, 'PDF', tmp_path)
    assert result['sections'][0]['method'] == 'MIXED'
    assert result['sections'][0]['text'].count(header) == 1
    assert 'Never approve without authorization.' in result['sections'][0]['text']
    assert 'MIXED_CONTENT_REVIEW' in result['warning_codes']
    assert not list(tmp_path.glob('page-*.png'))
    monkeypatch.setattr(subprocess, 'run', lambda *_a, **_kw: SimpleNamespace(returncode=0, stdout=b'', stderr=b''))
    with pytest.raises(ExtractionError, match='UNREADABLE_PAGE'):
        extract(source, 'PDF', tmp_path)


def test_ms46_tc11_frozen_artifacts_and_secret_rejection():
    root = ROOT.parents[1]
    cases = [{'id': 'synthetic'}]
    identity = freeze_identity(root, [], cases, {'RAG_CAPACITY': '2'})
    assert identity['case_set_digest'] == canonical_digest(cases)
    assert len(identity['source_snapshot']) == 64
    with pytest.raises(ValueError, match='ALLOWLIST'):
        freeze_identity(root, [], cases, {'RAG_SERVICE_TOKEN': 'never hash credentials'})


@pytest.mark.parametrize('field', ['candidate_revision', 'source_snapshot', 'answer_model_digest',
    'embedding_fingerprint', 'parser_fingerprint', 'config_digest', 'corpus_digest', 'case_set_digest', 'run_id'])
def test_ms46_tc11_observations_cannot_be_relabeled(field):
    cases = json.loads((ROOT / 'evaluation/held-out.json').read_text(encoding='utf-8'))
    evidence, observations = complete_evidence(cases)
    # Deep-copy the changed identity so old observations retain the tested one.
    evidence = copy.deepcopy(evidence)
    evidence['identity'][field] = '9' * (40 if field == 'candidate_revision' else 64)
    assert not evaluate_release(evidence, cases, observations)['release_ready']


@pytest.mark.parametrize('fault', ['five_samples', 'duplicate_attempt', 'missing_actor', 'mixed_run',
    'missing_language', 'nonfinite', 'unreviewed', 'missing_gate_records', 'wrong_gate', 'fast_error'])
def test_ms46_tc12_fail_closed_coverage(fault):
    cases = json.loads((ROOT / 'evaluation/held-out.json').read_text(encoding='utf-8'))
    evidence, observations = complete_evidence(cases)
    if fault == 'five_samples': evidence['profiles']['five'] = evidence['profiles']['five'][:5]
    if fault == 'duplicate_attempt': evidence['profiles']['five'][1]['attempt_id'] = '0'
    if fault == 'missing_actor': evidence['profiles']['five'][1]['actor_slot'] = 0
    if fault == 'mixed_run': evidence['profiles']['five'][0]['identity'] = {}
    if fault == 'missing_language': evidence['profiles']['representative'] = evidence['profiles']['representative'][:30]
    if fault == 'nonfinite': evidence['profiles']['five'][0]['duration_ms'] = float('nan')
    if fault == 'unreviewed': observations[0]['procedure_complete'] = False
    if fault == 'missing_gate_records': evidence['gate_records'] = []
    if fault == 'wrong_gate': evidence['gate_records'][0]['gate'] = 'unrelated'
    if fault == 'fast_error': evidence['profiles']['repeat'][0].update(outcome='timeout', duration_ms=1)
    assert not evaluate_release(evidence, cases, observations)['release_ready']
