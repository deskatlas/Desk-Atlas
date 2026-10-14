"""SPEC4-TC02/03/05/17/18: synthetic private API and evidence controls."""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import secrets
import time
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from fastapi import HTTPException

spec = importlib.util.spec_from_file_location('assistant_api', Path(__file__).resolve().parents[1] / 'app.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.secret = secrets.token_hex(32)
        self.service = secrets.token_hex(32)
        self.env = patch.dict(os.environ, {'RAG_SERVICE_TOKEN':self.service,'RAG_CAPABILITY_SECRET':self.secret,'RAG_SCOPE_ID':'synthetic','RAG_ANSWER_DIGEST':'a'*64,'KB_ENABLED':'false'})
        self.env.start()
        self.client_context = TestClient(api.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None,None,None)
        self.env.stop()

    def capability(self, role='ADMIN', **changes):
        now = int(time.time())
        claims = {'iss':'deskatlas','aud':'rag','sub':str(uuid4()),'role':role,'request_id':str(uuid4()),'scope':'synthetic','ops':['search','answer'],'iat':now,'exp':now+60,'generation':str(uuid4()),**changes}
        payload=base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
        signature=base64.urlsafe_b64encode(hmac.new(self.secret.encode(),payload.encode(),hashlib.sha256).digest()).decode().rstrip('=')
        return payload+'.'+signature

    def headers(self, role='ADMIN'):
        return {'Authorization':'Bearer '+self.service,'X-Request-Capability':self.capability(role)}

    def test_requires_service_identity_and_scoped_expiring_capability(self):
        self.assertEqual(self.client.get('/health').status_code,401)
        self.assertEqual(self.client.get('/health',headers=self.headers()).status_code,200)
        for token in [self.capability(scope='other'),self.capability(exp=0),self.capability()+'x',self.capability(role='STAFF',ops=['tools','answer'])]:
            with self.assertRaises(HTTPException):
                api.verify_capability(token,self.secret,'synthetic')

    def test_rejects_extra_fields_without_echoing_payload(self):
        response=self.client.post('/v1/embed',headers=self.headers(),json={'query':'synthetic','role':'ADMIN','private':'hidden-value'})
        self.assertEqual(response.status_code,422)
        self.assertNotIn('hidden-value',response.text)

    def test_staff_historical_plan_is_denied(self):
        plan=api.Plan(kind='REPORT',query='',tools=[api.Tool(name='payment_report',args=api.Filters())])
        with patch.object(api,'generate',new=AsyncMock(return_value=plan)):
            response=self.client.post('/v1/plan',headers=self.headers('STAFF'),json={'message':'Magkano last month?','recent_context':{'user_turns':[]},'business_date':'2026-10-14','timezone':'Asia/Manila'})
        self.assertEqual(response.status_code,403)

    def test_fabricated_source_quote_is_dropped(self):
        source={'document_id':str(uuid4()),'version_id':str(uuid4()),'chunk_id':str(uuid4()),'title':'Synthetic','heading_path':'Rules','source_page':None,'epoch':1,'extraction_method':'TEXT','content_hash':'a'*64,'content':'Bookings remain guest-first.'}
        invented=api.Answer(quotes=[api.Quote(chunk_id=source['chunk_id'],quote='Secret invented policy')])
        with patch.object(api,'generate',new=AsyncMock(return_value=invented)):
            response=self.client.post('/v1/answer',headers=self.headers(),json={'query':'How do bookings work?','sources':[source]})
        self.assertEqual(response.json(),{'quotes':[]})

    def test_no_knowledge_does_not_call_generation(self):
        with patch.object(api,'generate',new=AsyncMock()) as generate:
            response=self.client.post('/v1/answer',headers=self.headers(),json={'query':'How?','sources':[]})
            self.assertEqual(response.json(),{'quotes':[]})
            generate.assert_not_called()

    def test_request_budget_is_explicit_and_embedding_never_falls_back(self):
        response=self.client.post('/v1/embed',headers=self.headers(),json={'query':'synthetic'})
        self.assertEqual(response.status_code,503)
        response=self.client.post('/v1/embed',headers=self.headers(),content=b' '*120001)
        self.assertEqual(response.status_code,413)


if __name__ == '__main__':
    unittest.main()
