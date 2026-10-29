"""PRD-F26 / QAD-TC44/46: private RAG release checks, synthetic intent only.

Operator credentials and runtime secrets stay in process memory. No raw HTTP
bodies, tokens, source documents or customer records are printed or saved.
"""
import argparse
import base64
import hashlib
import hmac
import json
import re
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/rag/cloudrun'))
sys.path.insert(0, str(ROOT / 'services/rag'))
from check_private import google, capability, NoRedirect
from rag.runtime_identity import implementation_fingerprint


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag')
    parser.add_argument('--catalog-only', action='store_true')
    parser.add_argument('--customer-repair', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    cli = shutil.which('gcloud.cmd') or shutil.which('gcloud')
    if not cli:
        raise ValueError('GCLOUD_REQUIRED')
    common = ['--project=deskatlas-rag', '--region=us-central1']
    service_name = 'deskatlas-rag-chat-production'
    service = json.loads(google(cli, 'run', 'services', 'describe', service_name, *common, '--format=json'))
    url = service['status']['url']
    if args.tag:
        tagged = [item for item in service['status']['traffic'] if item.get('tag') == args.tag]
        if len(tagged) != 1:
            raise ValueError('REVISION_TAG_NOT_READY')
        url = tagged[0]['url']
    if not url.startswith('https://') or not url.endswith('.run.app'):
        raise ValueError('UNEXPECTED_SERVICE_URL')
    policy = json.loads(google(cli, 'run', 'services', 'get-iam-policy', service_name, *common, '--format=json'))
    if any(member in {'allUsers', 'allAuthenticatedUsers'} for binding in policy.get('bindings', []) for member in binding.get('members', [])):
        raise ValueError('PUBLIC_IAM_REJECTED')
    env = {item['name']: item for item in service['spec']['template']['spec']['containers'][0]['env']}
    secrets = {}
    for name in ('RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET'):
        ref = env[name]['valueFrom']['secretKeyRef']
        secrets[name] = google(cli, 'secrets', 'versions', 'access', ref['key'], '--secret=' + ref['name'], '--project=deskatlas-rag')
    identity = google(cli, 'auth', 'print-identity-token')
    transport = {'X-Serverless-Authorization': 'Bearer ' + identity}
    rows = []

    def call(label, path, headers, body=None):
        encoded = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url + path, data=encoded,
            headers={**headers, **({'Content-Type': 'application/json'} if body is not None else {})})
        started = time.monotonic()
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as result:
                status, data = result.status, json.load(result)
        except urllib.error.HTTPError as error:
            status, data = error.code, {}
        row = {'stage': label, 'status': status, 'elapsed_ms': round((time.monotonic() - started) * 1000)}
        rows.append(row)
        print(json.dumps(row), flush=True)
        return status, data

    if call('no_google_identity', '/health', {})[0] not in (401, 403):
        raise ValueError('IAM_NOT_ENFORCED')
    if call('google_identity_only', '/health', transport)[0] != 401:
        raise ValueError('SERVICE_TOKEN_NOT_ENFORCED')
    authenticated = {**transport, 'Authorization': 'Bearer ' + secrets['RAG_SERVICE_TOKEN']}
    if call('invalid_capability', '/health', {**authenticated, 'X-Request-Capability': 'invalid'})[0] != 401:
        raise ValueError('CAPABILITY_NOT_ENFORCED')
    internal_headers = {**authenticated, 'X-Request-Capability': capability(secrets['RAG_CAPABILITY_SECRET'])}
    status, health = call('authenticated_health', '/health', internal_headers)
    if status != 200 or health.get('ready') is not True or health.get('implementation_fingerprint') != implementation_fingerprint():
        raise ValueError('LOADED_IMPLEMENTATION_MISMATCH')
    if health.get('answer_provider') != 'deepinfra' or health.get('answer_model') != 'Qwen/Qwen3.6-35B-A3B' or health.get('document_answer_model') != 'Qwen/Qwen3.6-35B-A3B':
        raise ValueError('DEPLOYED_MODEL_PROFILE_MISMATCH')
    if call('internal_capability_on_customer_route', '/v1/customer/plan', internal_headers, {'message': 'Hello'})[0] != 401:
        raise ValueError('CUSTOMER_PRINCIPAL_BOUNDARY_FAILED')

    def customer_headers():
        now = int(time.time())
        claims = {'iss': 'deskatlas', 'aud': 'rag', 'surface': 'customer', 'principal': 'PUBLIC_VISITOR',
            'sub': str(uuid4()), 'scope': env['RAG_SCOPE_ID']['value'], 'request_id': str(uuid4()),
            'session_id': str(uuid4()), 'generation': str(uuid4()), 'ops': ['customer_knowledge', 'public_workspace', 'public_availability', 'public_price'],
            'audiences': ['CUSTOMER'], 'iat': now, 'exp': now + 60}
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
        signature = base64.urlsafe_b64encode(hmac.new(secrets['RAG_CAPABILITY_SECRET'].encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        return {**authenticated, 'X-Request-Capability': payload + '.' + signature}

    plan_path = '/v1/customer/catalog-plan' if args.catalog_only else '/v1/customer/plan'
    synthetic = 'Focus Pod is a workspace category. Booking is available to guests without an account.'
    catalog = {'sources': [{'document_id': str(uuid4()), 'version_id': str(uuid4()), 'chunk_id': str(uuid4()),
        'title': 'Synthetic public workspace guide', 'heading_path': 'Workspace types', 'source_page': None,
        'epoch': 0, 'extraction_method': 'TEXT', 'content_hash': hashlib.sha256(synthetic.encode()).hexdigest(),
        'content': synthetic}], 'headings': [['Workspace types']]} if args.catalog_only else {}
    status, legacy = call('legacy_customer_plan', plan_path, customer_headers(),
        {**catalog, 'message': 'It is my first time here. How does booking work, and do I need an account?'})
    if args.catalog_only:
        legacy = legacy.get('plan', {})
    if status != 200 or legacy.get('kind') != 'KNOWLEDGE' or 'constraints' in legacy or 'workspace_mode' in legacy:
        raise ValueError('LEGACY_PLAN_COMPATIBILITY_FAILED')
    status, plan = call('constraints_v1_customer_plan', plan_path, customer_headers(),
        {**catalog, 'conversation_contract': 'constraints-v1', 'message': 'i need a desk for 7am, any availability on focus pod today?'})
    if args.catalog_only:
        plan = plan.get('plan', {})
    constraints = plan.get('constraints', {})
    if (status != 200 or plan.get('kind') != 'WORKSPACE' or constraints.get('relative_date') != 'TODAY'
            or constraints.get('start_time') != '07:00' or 'focus pod' not in constraints.get('template_name', '').lower()
            or constraints.get('duration_minutes') is not None or constraints.get('date') is not None):
        print(json.dumps({'synthetic_plan_probe': plan}), flush=True)
        raise ValueError('CONVERSATIONAL_CONSTRAINTS_FAILED')
    status, private = call('private_record_routing', '/v1/customer/plan', customer_headers(), {'message': 'Show my bookings.'})
    if status != 200 or private.get('kind') != 'BOOKING':
        raise ValueError('PRIVATE_RECORD_ROUTING_FAILED')
    if args.customer_repair:
        # Synthetic originals only. These calls certify serving compatibility,
        # not corpus quality or full website timing before the app is deployed.
        text = 'Sky Booth (two people) allows spoken video calls. Availability must be checked separately. Choose Cash or QR Payment.'
        source = {'document_id': str(uuid4()), 'version_id': str(uuid4()), 'chunk_id': str(uuid4()),
            'title': 'Synthetic customer suitability guide', 'heading_path': 'Calls', 'source_page': None,
            'epoch': 0, 'extraction_method': 'TEXT', 'content_hash': hashlib.sha256(text.encode()).hexdigest(), 'content': text}
        for typed in (False, True):
            payload = {'contract': 'ms65-v1', 'synthesis': True,
                'query': 'Can I take a spoken video call in Sky Booth, and which payment methods are offered?', 'sources': [source]}
            if typed:
                payload['presentation_contract'] = 'customer-concise-v1'
                payload['workspace_catalog'] = [{'template_id': str(uuid4()), 'name': 'Sky Booth', 'capacity': 1, 'hourly_rate': 100}]
            status, proof = call('customer_document_current_catalog' if typed else 'customer_document_legacy',
                '/v1/customer/document-support', customer_headers(), payload)
            expected = hashlib.sha256(json.dumps(payload).encode()).hexdigest()
            if status != 200 or proof.get('binding') != expected or proof.get('outcome') != 'COMPLETE' or not proof.get('spans'):
                raise ValueError('CUSTOMER_DOCUMENT_COMPATIBILITY_FAILED')
            original = text.encode('utf-16-le')
            for span in proof['spans']:
                if (span.get('chunk_id') != source['chunk_id']
                        or original[span['start'] * 2:span['end'] * 2] != span['quote'].encode('utf-16-le')):
                    raise ValueError('CUSTOMER_CANONICAL_PROOF_FAILED')
            prose = ' '.join(block['text'] for block in proof.get('synthesis', {}).get('blocks', []))
            if not typed:
                for block in proof.get('synthesis', {}).get('blocks', []):
                    if (re.search(r'\bQR(?:s| codes?)?\b', block['text'], re.I)
                            and block['text'] != '\n\n'.join(proof['spans'][index]['quote'] for index in block['support'])):
                        raise ValueError('CUSTOMER_LEGACY_QR_COMPATIBILITY_FAILED')
            if not re.search(r'\b(?:calls?|spoken|video)\b', prose, re.I) or typed and re.search(r'\b(?:two|2)\s+people\b', prose, re.I):
                print(json.dumps({'synthetic_probe_only': True, 'typed_catalog': typed,
                    'topic_mentioned': bool(re.search(r'\b(?:calls?|spoken|video)\b', prose, re.I)),
                    'historical_capacity_in_prose': bool(re.search(r'\b(?:two|2)\s+people\b', prose, re.I))}), flush=True)
                # This text is generated exclusively from the fixed synthetic
                # fixture above, never from a real corpus or customer record.
                print(json.dumps({'synthetic_fixture_prose': prose[:1200]}), flush=True)
                raise ValueError('CUSTOMER_CATALOG_AUTHORITY_FAILED')
    receipt = {'service': service_name, 'url': url, 'tag': args.tag,
        'latest_ready_revision': service['status']['latestReadyRevisionName'],
        'implementation_fingerprint': implementation_fingerprint(), 'checks': rows, 'passed': True}
    receipt['answer_model'] = health['answer_model']
    receipt['document_answer_model'] = health['document_answer_model']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print('RAG_DEPLOYMENT_CHECKS_PASSED', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only fixed local stage errors, never remote bodies or exception text.
        permitted = {'GCLOUD_REQUIRED', 'REVISION_TAG_NOT_READY', 'UNEXPECTED_SERVICE_URL', 'PUBLIC_IAM_REJECTED',
            'IAM_NOT_ENFORCED', 'SERVICE_TOKEN_NOT_ENFORCED', 'CAPABILITY_NOT_ENFORCED', 'LOADED_IMPLEMENTATION_MISMATCH', 'DEPLOYED_MODEL_PROFILE_MISMATCH',
            'CUSTOMER_PRINCIPAL_BOUNDARY_FAILED', 'LEGACY_PLAN_COMPATIBILITY_FAILED', 'CONVERSATIONAL_CONSTRAINTS_FAILED', 'PRIVATE_RECORD_ROUTING_FAILED',
            'CUSTOMER_DOCUMENT_COMPATIBILITY_FAILED', 'CUSTOMER_CANONICAL_PROOF_FAILED', 'CUSTOMER_CATALOG_AUTHORITY_FAILED', 'CUSTOMER_LEGACY_QR_COMPATIBILITY_FAILED'}
        print(str(error) if type(error) is ValueError and str(error) in permitted else 'RAG_DEPLOYMENT_CHECK_FAILED: operator access or transport', flush=True)
        raise SystemExit(1) from None
