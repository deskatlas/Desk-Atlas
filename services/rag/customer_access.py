"""MS76-R02: isolated customer capability contract, never an internal role."""
import base64
import hashlib
import hmac
import json
import re
import time
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict


class CustomerClaims(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    iss: Literal['deskatlas']
    aud: Literal['rag']
    surface: Literal['customer']
    principal: Literal['PUBLIC_VISITOR', 'VERIFIED_CUSTOMER']
    sub: str
    scope: str
    request_id: str
    session_id: str
    generation: str
    ops: list[Literal['customer_knowledge', 'public_workspace', 'public_availability', 'public_price', 'owned_bookings', 'owned_booking_context']]
    audiences: list[Literal['CUSTOMER']]
    iat: int
    exp: int


def verify_customer_capability(token: str, secret: str, scope: str, now: int | None = None) -> CustomerClaims:
    try:
        if len(secret) < 32 or len(token) > 8192 or not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token):
            raise ValueError()
        payload, signature = token.split('.')
        expected = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        claims = CustomerClaims.model_validate(json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))))
        timestamp = int(time.time()) if now is None else now
        if claims.iat > timestamp or claims.exp <= timestamp or not 0 < claims.exp - claims.iat <= 60 or claims.scope != scope:
            raise ValueError()
        if not 1 <= len(claims.scope) <= 200 or not 1 <= len(claims.ops) <= 6 or len(set(claims.ops)) != len(claims.ops):
            raise ValueError()
        for value in (claims.sub, claims.request_id, claims.session_id, claims.generation):
            UUID(value)
        audiences = ['CUSTOMER']
        if sorted(claims.audiences) != sorted(audiences):
            raise ValueError()
        if claims.principal == 'PUBLIC_VISITOR' and any(op.startswith('owned_') for op in claims.ops):
            raise ValueError()
        return claims
    except (ValueError, TypeError, KeyError):
        raise HTTPException(401, detail='INVALID_CAPABILITY') from None


def admit_customer_operation(claims: CustomerClaims, operation: str) -> None:
    if operation not in claims.ops:
        raise HTTPException(403, detail='FORBIDDEN')
