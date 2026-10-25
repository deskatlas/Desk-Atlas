// MS-84 / QAD-TC1/2/23/24: production HTTP/SSR smoke, no credentials or mutations.
const assert = require('node:assert/strict');
(async () => {
  for (const path of ['/reserve', '/track', '/track/DA-MS84?email=synthetic%40example.invalid']) {
    const response = await fetch(`http://127.0.0.1:3105${path}`);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /<a[^>]*href="\/"[^>]*>Back to Home<\/a>/, path);
    console.log(`PASS ${path}: real SSR Home link targets /`);
  }
  const response = await fetch('http://127.0.0.1:3106/admin/reservations?filter=closure_impacted', { redirect: 'manual' });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location'), 'http://127.0.0.1:3106').pathname, '/manage/reservations');
  assert.equal(new URL(response.headers.get('location'), 'http://127.0.0.1:3106').searchParams.get('filter'), 'closure_impacted');
  console.log('PASS known stale closure URL redirects to canonical filtered route');
  const canonical = await fetch('http://127.0.0.1:3106/manage/reservations?filter=closure_impacted');
  assert.equal(canonical.status, 200);
  console.log('PASS canonical page exists');
  const api = await fetch('http://127.0.0.1:3106/api/admin/reservations?filter=closure_impacted', { redirect: 'manual' });
  assert.equal(api.status, 401);
  assert.equal((await api.json()).error.code, 'AUTH_REQUIRED');
  console.log('PASS API namespace stays separate and denies unauthenticated closure reads');
  const unrelated = await fetch('http://127.0.0.1:3106/admin/reservations', { redirect: 'manual' });
  assert.equal(unrelated.status, 404);
  console.log('PASS compatibility redirect is limited to the specified query/path');
})().catch(error => { console.error(error); process.exitCode = 1; });
