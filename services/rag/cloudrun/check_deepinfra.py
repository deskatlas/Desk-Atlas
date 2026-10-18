"""QAD-TC44/46: real hosted schema checks using synthetic inputs only.

Reads the provider secret into memory. Prints no keys, prompts or responses.
This tests the provider integration, not Cloud Run or website availability.
"""
import asyncio
import os
from pathlib import Path
import shutil
import sys

from check_private import google


async def check():
    import app
    async with app.lifespan(app.app):
        print('Hosted startup schema canary: PASS', flush=True)
        selection = await app.generate('This is a synthetic schema test. Return exactly the JSON object {"p":[0],"c":false}.',
            {'passages': ['Synthetic office opens at 9 AM.']}, app.PassageSelection)
        if selection.passages != [0] or selection.conflicting_sources:
            raise ValueError('SELECTION_CHECK_FAILED')
        print('Hosted passage selection: PASS', flush=True)
        verdict = await app.generate('Return JSON: assessment="supported", supported=true.',
            {}, app.EvidenceCheck)
        if not verdict.supported:
            raise ValueError('VERDICT_CHECK_FAILED')
        print('Hosted evidence verdict schema: PASS', flush=True)
        plan = await app.generate('Return a JSON plan for an unsupported greeting. '
            'kind=UNSUPPORTED, query="hello", clarification=null, tools=[], '
            'search=null, interpretation="", resolution=null.', {}, app.Plan)
        if plan.kind != 'UNSUPPORTED' or plan.tools:
            raise ValueError('PLAN_CHECK_FAILED')
        print('Hosted nested planning schema: PASS', flush=True)


def main():
    cli = shutil.which('gcloud.cmd') or shutil.which('gcloud')
    if not cli:
        raise ValueError('GCLOUD_NOT_FOUND')
    key = google(cli, 'secrets', 'versions', 'access', '1',
        '--secret=deepinfra-api-key', '--project=deskatlas-rag')
    os.environ.update({'RAG_MODEL_PROVIDER': 'deepinfra', 'RAG_ANSWER_MODEL': 'Qwen/Qwen3-32B',
        'DEEPINFRA_API_KEY': key, 'KB_ENABLED': 'false', 'RAG_SCOPE_ID': 'synthetic',
        'RAG_SERVICE_TOKEN': 'synthetic-service-credential-at-least-32',
        'RAG_CAPABILITY_SECRET': 'synthetic-capability-secret-at-least-32'})
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    try:
        asyncio.run(check())
    finally:
        os.environ.pop('DEEPINFRA_API_KEY', None)
    print('DEEPINFRA_SCHEMA_CHECKS_PASSED', flush=True)


if __name__ == '__main__':
    # Remote errors and tracebacks can retain authorization headers. Only
    # display fixed stage outcomes, never exception strings or HTTP bodies.
    try:
        main()
    except Exception as error:
        from fastapi import HTTPException
        if isinstance(error, HTTPException) and error.detail in {
            'INVALID_MODEL_OUTPUT', 'CONTEXT_BUDGET_EXCEEDED', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'}:
            print('Provider check code: ' + error.detail)
        elif type(error) is ValueError and str(error) in {
            'SELECTION_CHECK_FAILED', 'VERDICT_CHECK_FAILED', 'PLAN_CHECK_FAILED'}:
            print('Provider check code: ' + str(error))
        print('DEEPINFRA_CHECK_FAILED: check operator secret access, provider configuration and schema support')
        raise SystemExit(1) from None
