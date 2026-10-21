import base64
import hashlib
import hmac
import json
import uuid

import pytest
from fastapi import HTTPException
from customer_access import verify_customer_capability, admit_customer_operation
from app import verify_capability

SECRET = 'ms76-test-secret-' * 3


def claims():
    return dict(iss='deskatlas', aud='rag', surface='customer', principal='PUBLIC_VISITOR',
                sub=str(uuid.uuid4()), scope='test', request_id=str(uuid.uuid4()), session_id=str(uuid.uuid4()),
                generation=str(uuid.uuid4()), ops=['customer_knowledge'], audiences=['CUSTOMER'], iat=100, exp=160)


def sign(value):
    payload = base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    signature = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    return payload + '.' + signature


def test_customer_contract_and_internal_boundary():
    token = sign(claims())
    verified = verify_customer_capability(token, SECRET, 'test', 120)
    admit_customer_operation(verified, 'customer_knowledge')
    with pytest.raises(HTTPException):
        admit_customer_operation(verified, 'tools')
    with pytest.raises(HTTPException):
        verify_capability(token, SECRET, 'test', 120)


@pytest.mark.parametrize('patch', [dict(role='ADMIN'), dict(principal='ADMIN'), dict(surface='admin'),
    dict(scope='other'), dict(exp=161), dict(exp=120), dict(iat=121), dict(ops=['tools']),
    dict(ops=['owned_bookings']), dict(audiences=['ADMIN_ONLY']), dict(audiences=['PUBLIC_CUSTOMER','VERIFIED_CUSTOMER']),
    dict(session_id='forged'), dict(ops=['customer_knowledge','customer_knowledge'])])
def test_invalid_customer_bindings(patch):
    with pytest.raises(HTTPException):
        verify_customer_capability(sign({**claims(), **patch}), SECRET, 'test', 120)


def test_verified_customer():
    value = {**claims(), 'principal':'VERIFIED_CUSTOMER', 'ops':['owned_bookings'],
             'audiences':['CUSTOMER']}
    admit_customer_operation(verify_customer_capability(sign(value), SECRET, 'test', 120), 'owned_bookings')
