// MS46-TC08: isolated provider reproduction using only a newly created bucket.
// Supply dedicated test credentials through environment, never arguments.
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');

async function main() {
  if (process.env.MS46_STORAGE_ISOLATED !== 'true' || !process.env.MS46_STORAGE_URL || !process.env.MS46_STORAGE_SERVICE_KEY) {
    process.stdout.write(JSON.stringify({ status: 'PENDING', reason: 'ISOLATED_STORAGE_FIXTURE_REQUIRED', release_evidence: false }) + '\n');
    return 1;
  }
  const bucket = `ms46-probe-${randomUUID()}`;
  const client = createClient(process.env.MS46_STORAGE_URL, process.env.MS46_STORAGE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  let created = false;
  const result = { status: 'FAILED', late_upload_accepted: null, initial_delete_succeeded: false,
    final_absence_verified: false, bucket_cleanup_verified: false, token_expiry_verified: false, release_evidence: false };
  try {
    const provisioned = await client.storage.createBucket(bucket, { public: false, fileSizeLimit: 2048 });
    if (provisioned.error) throw new Error('FIXTURE_UNAVAILABLE');
    created = true;
    const storage = client.storage.from(bucket);
    const authorization = await storage.createSignedUploadUrl('synthetic-source', { upsert: false });
    if (authorization.error) throw new Error('ISSUANCE_FAILED');
    const initial = await storage.remove(['synthetic-source']);
    result.initial_delete_succeeded = !initial.error;
    const late = await storage.uploadToSignedUrl('synthetic-source', authorization.data.token,
      Buffer.from('MS46 synthetic provider-race fixture only.'), { contentType: 'text/plain', upsert: false });
    result.late_upload_accepted = !late.error;
    const final = await storage.remove(['synthetic-source']);
    const absent = await storage.list('', { search: 'synthetic-source' });
    result.final_absence_verified = !final.error && !absent.error && absent.data.length === 0;
    result.status = result.initial_delete_succeeded && result.final_absence_verified ? 'PASS' : 'FAILED';
  } finally {
    if (created) {
      // Only this invocation's freshly created, random bucket may be emptied.
      await client.storage.emptyBucket(bucket);
      const removed = await client.storage.deleteBucket(bucket);
      result.bucket_cleanup_verified = !removed.error;
    }
    if (!result.bucket_cleanup_verified) result.status = 'FAILED';
    process.stdout.write(JSON.stringify(result) + '\n');
  }
  return result.status === 'PASS' ? 0 : 1;
}
main().then(code => { process.exitCode = code; }, () => { process.exitCode = 1; });
