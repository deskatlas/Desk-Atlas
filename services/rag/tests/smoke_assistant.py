"""Synthetic CPU planning smoke test. Emits content-free measurements only.

Run from repo root: python services/rag/tests/smoke_assistant.py
This is not five-user, retrieval, or end-to-end release acceptance.
"""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import secrets
import time
from uuid import uuid4
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('assistant_smoke_api', ROOT / 'app.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def main():
    artifact = json.loads((ROOT / 'answer-model.json').read_text())
    secret, service = secrets.token_hex(32), secrets.token_hex(32)
    env = {'RAG_SERVICE_TOKEN':service,'RAG_CAPABILITY_SECRET':secret,'RAG_SCOPE_ID':'synthetic','RAG_ANSWER_DIGEST':artifact['manifest_digest'],'RAG_ANSWER_MODEL':artifact['model'],'KB_ENABLED':'false'}
    results = []
    fixtures = [('en','How many qualifying scheduled bookings are there today?'),('fil','Ilang kumpirmadong booking ngayong araw?'),('taglish','Ilan ang bookings today sa current operations?')]
    with patch.dict(os.environ, env), TestClient(api.app) as client:
        for language, question in fixtures:
            now = int(time.time())
            claims = {'iss':'deskatlas','aud':'rag','sub':str(uuid4()),'role':'STAFF','request_id':str(uuid4()),'scope':'synthetic','ops':['search','answer','operational_snapshot','workspace_availability'],'iat':now,'exp':now+60,'generation':str(uuid4())}
            payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
            signature = base64.urlsafe_b64encode(hmac.new(secret.encode(),payload.encode(),hashlib.sha256).digest()).decode().rstrip('=')
            started = time.perf_counter()
            response = client.post('/v1/plan',headers={'Authorization':'Bearer '+service,'X-Request-Capability':payload+'.'+signature},json={'message':question,'recent_context':{'user_turns':[]},'business_date':'2026-10-14','timezone':'Asia/Manila'})
            valid = response.status_code == 200 and any(t['name']=='operational_snapshot' for t in response.json().get('tools',[]))
            results.append({'language':language,'status':response.status_code,'kind':response.json().get('kind'),'tools':[t['name'] for t in response.json().get('tools',[])],'correct_tool':valid,'duration_seconds':round(time.perf_counter()-started,3)})
    print(json.dumps({'model_digest':artifact['manifest_digest'],'num_gpu':0,'results':results}))
    return 0 if all(item['correct_tool'] for item in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
