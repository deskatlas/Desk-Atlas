"""MS44-TC10/12: ASGI disconnect/deadline cancellation reaches inference.

Avoid BaseHTTPMiddleware: cancelling call_next can leave its handler running.
Native encoder work cannot be interrupted; its slot stays held until it exits.
"""
import asyncio
from contextlib import suppress
from time import perf_counter
from uuid import UUID
from fastapi.responses import JSONResponse
from . import request_timing


class RequestBoundary:
    def __init__(self, app, maximum=5, deadline=50):
        self.app, self.maximum, self.deadline = app, maximum, deadline
        self.active = 0
        self.customer_active = 0

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        start, spans = perf_counter(), {}
        token = request_timing.current.set(spans)
        counts = {}
        counts_token = request_timing.tokens.set(counts)
        model_metrics = {}
        metrics_token = request_timing.metrics.set(model_metrics)
        task = watcher = None
        admitted = False
        customer = scope.get('path', '').startswith('/v1/customer/')
        started = False

        async def timed_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
                message['headers'] = [*message.get('headers', []),
                    (b'cache-control', b'no-store'),
                    (b'server-timing', request_timing.header(spans, start).encode('ascii'))]
                for key, value in counts.items():
                    message['headers'].append((f'x-rag-{key}-tokens'.encode('ascii'), str(value).encode('ascii')))
                for key, value in model_metrics.items():
                    message['headers'].append((f'x-rag-model-{key}'.encode('ascii'), str(value).encode('ascii')))
                message['headers'].append((b'x-rag-active', str(self.active).encode('ascii')))
                try:
                    identifier = str(UUID(scope.get('state', {}).get('request_id', '')))
                    message['headers'].append((b'x-request-id', identifier.encode('ascii')))
                except (ValueError, TypeError):
                    pass
            await send(message)

        async def disconnect():
            while True:
                if (await receive())['type'] == 'http.disconnect':
                    return

        try:
            # Bound body reading too. Never retain it after this request.
            headers = dict(scope.get('headers', []))
            supplied = headers.get(b'x-request-timeout-ms')
            deadline = self.deadline
            if supplied is not None:
                try:
                    remaining = int(supplied)
                    if remaining <= 0:
                        raise ValueError()
                    deadline = min(deadline, remaining / 1000)
                except (ValueError, TypeError):
                    return await JSONResponse({'error': 'REQUEST_TIMEOUT'}, 504)(scope, receive, timed_send)
            async with asyncio.timeout(deadline):
                body = bytearray()
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    body.extend(message.get('body', b''))
                    if len(body) > (260000 if scope.get('path') in ('/v1/document-support', '/v1/prepared-support', '/v1/customer/document-support', '/v1/customer/characteristics') else 120000):
                        return await JSONResponse({'error': 'INVALID_REQUEST'}, 413)(scope, receive, timed_send)
                    if not message.get('more_body', False):
                        break
                if (self.customer_active >= 2 if customer else self.active >= self.maximum):
                    return await JSONResponse({'error': 'CAPACITY_BUSY'}, 429,
                        headers={'Retry-After': '5'})(scope, receive, timed_send)
                if customer:
                    self.customer_active += 1
                else:
                    self.active += 1
                admitted = True
                delivered = False

                async def replay():
                    nonlocal delivered
                    if not delivered:
                        delivered = True
                        return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
                    # The disconnect watcher owns the real receive channel.
                    await asyncio.Future()

                task = asyncio.create_task(self.app(scope, replay, timed_send))
                watcher = asyncio.create_task(disconnect())
                done, _ = await asyncio.wait([task, watcher], return_when=asyncio.FIRST_COMPLETED)
                if task in done:
                    await task
                else:
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
        except TimeoutError:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            if not started:
                await JSONResponse({'error': 'REQUEST_TIMEOUT'}, 504)(scope, receive, timed_send)
        finally:
            # Outer server cancellation must also drain model/encoder cleanup.
            for pending in (watcher, task):
                if pending and not pending.done():
                    pending.cancel()
                    with suppress(asyncio.CancelledError):
                        await pending
            if admitted:
                if customer:
                    self.customer_active -= 1
                else:
                    self.active -= 1
            request_timing.current.reset(token)
            request_timing.tokens.reset(counts_token)
            request_timing.metrics.reset(metrics_token)
