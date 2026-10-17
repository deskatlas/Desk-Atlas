import { AssistantError } from '@deskatlas/domain';

// SPEC-6 phase 7 / SDD-C20-C21 / QAD-TC44/46: request-scoped Preview federation.
// Google verifies the Vercel assertion. Never accept a browser-supplied Google
// access token or use a build-time Vercel token as a runtime fallback.
export type CloudRunIdentity = () => Promise<string | undefined>;

function unavailable(): AssistantError {
  return new AssistantError('MODEL_UNAVAILABLE', 'Assistant cloud authentication is unavailable.', 503);
}

function token(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/\s/.test(value);
}

async function exchange(assertion: string, target: URL, signal: AbortSignal): Promise<string> {
  const provider = process.env.RAG_GOOGLE_WORKLOAD_PROVIDER ?? '';
  const account = process.env.RAG_GOOGLE_SERVICE_ACCOUNT ?? '';
  if (!/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(provider)
      || !/^[a-z][a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account)) throw unavailable();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  try {
    const response = await fetch('https://sts.googleapis.com/v1/token', {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: bounded,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience: `//iam.googleapis.com/${provider}`,
        grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
        requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt', subjectToken: assertion }),
    });
    if (!response.ok) throw unavailable();
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('access_token' in data) || !token(data.access_token)) throw unavailable();
    const identity = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateIdToken`, {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: bounded,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.access_token}` },
      body: JSON.stringify({ audience: target.origin, includeEmail: true }),
    });
    if (!identity.ok) throw unavailable();
    const result: unknown = await identity.json();
    if (!result || typeof result !== 'object' || !('token' in result) || !token(result.token)) throw unavailable();
    return result.token;
  } catch { throw unavailable(); }
}

export function createCloudRunIdentity(request: Request, signal: AbortSignal): CloudRunIdentity {
  // Cache only within this request, never share assertions or tokens across users.
  let pending: Promise<string> | undefined;
  return async () => {
    const mode = process.env.RAG_GOOGLE_AUTH ?? '';
    let target: URL;
    try { target = new URL(process.env.RAG_SERVICE_URL ?? ''); } catch { throw unavailable(); }
    if (!mode && !target.hostname.endsWith('.run.app')) return undefined;
    if (mode !== 'vercel-oidc' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'preview'
        || process.env.VERCEL_GIT_COMMIT_REF !== 'dev'
        || target.protocol !== 'https:' || !target.hostname.endsWith('.run.app')
        || target.username || target.password || target.port || target.pathname !== '/' || target.search || target.hash) throw unavailable();
    const assertion = request.headers.get('x-vercel-oidc-token');
    if (!token(assertion)) throw unavailable();
    pending ??= exchange(assertion, target, signal);
    return pending;
  };
}
