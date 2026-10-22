"""MS79: synthetic public-session checks, print metadata only, no private login."""
import http.cookiejar
import json
import time
import urllib.error
import urllib.request
from uuid import uuid4

ORIGIN = 'https://www.thedeskatlas.com'


def main():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def call(path, data):
        request = urllib.request.Request(ORIGIN + path, data=json.dumps(data).encode(), method='POST',
            headers={'Content-Type': 'application/json', 'Origin': ORIGIN, 'Sec-Fetch-Site': 'same-origin'})
        started = time.monotonic()
        try:
            with opener.open(request, timeout=70) as response:
                return response.status, json.load(response), round(time.monotonic() - started, 2)
        except urllib.error.HTTPError as response:
            try: body = json.load(response)
            except ValueError: body = {}
            return response.code, body, round(time.monotonic() - started, 2)
    status, body, elapsed = call('/api/customer-assistant/session', {})
    print(json.dumps({'stage': 'session', 'status': status, 'ready': body.get('ready'),
                      'error': body.get('error'), 'seconds': elapsed}), flush=True)
    if status != 200:
        raise ValueError()
    for question, label in [('What is the customer check-in process?', 'public_policy'),
                            ('Show my bookings.', 'private_request_without_verification')]:
        data = {'request_id': str(uuid4()), 'session_id': str(uuid4()), 'generation': str(uuid4()),
                'message': question, 'user_turns': []}
        status, body, elapsed = call('/api/customer-assistant/query', data)
        print(json.dumps({'stage': label, 'status': status, 'kind': body.get('kind'),
            'citation_count': len(body.get('citations', [])), 'limitations': body.get('limitations'),
            'error': body.get('error'), 'seconds': elapsed}), flush=True)
        if status != 200 or (label.startswith('private') and body.get('kind') != 'VERIFY_REQUIRED'):
            raise ValueError()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('LIVE_CUSTOMER_CHECK_FAILED: metadata above identifies the failed stage')
        raise SystemExit(1) from None
