// MS53-TC01/04/11: opt-in read-only live retrieval, content-free diagnostics.
// No publication writes, private excerpt files, or diagnostic transcript cache.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHash, createHmac, randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { createClient } = require('@supabase/supabase-js');
// Compile the real dependency-free domain helper before running this probe:
// pnpm exec tsc packages/domain/src/services/assistantRetrieval.ts --target ES2022 --module commonjs --skipLibCheck --outDir node_modules/.cache/ms53-live
const { assistantRetrievalQuery, selectProcedureSeed } = require(resolve(__dirname, '../../../node_modules/.cache/ms53-live/assistantRetrieval.js'));

async function main() {
  const env = { ...parseEnv(readFileSync(resolve(__dirname, '../../../apps/admin-portal/.env.local'), 'utf8')), ...process.env };
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } });
  const profile = await db.from('staff_profiles').select('user_id').eq('role', 'ADMIN').eq('is_active', true).limit(1).single();
  if (profile.error) throw new Error('VERIFIED_ACTOR_REQUIRED');
  const actor = profile.data.user_id;
  const rpc = async (name, args) => {
    const result = await db.rpc(name, { p_actor: actor, p_scope: env.RAG_SCOPE_ID, p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT, ...args });
    if (result.error) throw new Error('READ_ONLY_RPC_FAILED');
    return result.data;
  };
  const model = async (path, body) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ iss: 'deskatlas', aud: 'rag', sub: actor, role: 'ADMIN', request_id: randomUUID(),
      scope: env.RAG_SCOPE_ID, ops: ['search', 'answer'], iat: now, exp: now + 60, generation: randomUUID() })).toString('base64url');
    const capability = payload + '.' + createHmac('sha256', env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url');
    const started = performance.now();
    const response = await fetch(new URL(path, env.RAG_SERVICE_URL), { method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RAG_SERVICE_TOKEN, 'X-Request-Capability': capability, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(55000) });
    const result = await response.json();
    console.log(JSON.stringify({ stage: path, status: response.status, elapsed_ms: Math.round(performance.now() - started),
      input_tokens: response.headers.get('x-rag-input-tokens'), output_tokens: response.headers.get('x-rag-output-tokens'),
      reason: result.detail || result.error || null }));
    if (!response.ok) throw new Error('MODEL_PROBE_FAILED');
    return result;
  };
  const results = [];
  const questions = process.argv.length > 2 ? process.argv.slice(2) : ['how do i checkout a customer', 'what is 4.2. Customer Check-Out'];
  for (const [question_index, query] of questions.entries()) {
    const started = performance.now();
    const searchQuery = assistantRetrievalQuery(query);
    const embedding = await model('/v1/embed', { query: searchQuery });
    const candidates = await rpc('assistant_search_knowledge', { p_vector: embedding.vector, p_min_similarity: Number(env.RAG_MIN_SIMILARITY) });
    const expand = ids => rpc('assistant_expand_evidence', { p_chunks: ids });
    let expanded = await expand(candidates.map(source => source.chunk_id));
    const wire = value => Buffer.byteLength(JSON.stringify(value));
    const selectedIds = new Set();
    const directSeed = selectProcedureSeed(query, candidates);
    if ((directSeed && expanded.complete && candidates.length > 1) || (!expanded.complete && expanded.reason === 'CONTEXT_BUDGET') || wire({ query, sources: expanded.sources, groups: expanded.groups }) > 12000) {
      if (directSeed) selectedIds.add(directSeed);
      for (let offset = 0; !directSeed && offset < candidates.length;) {
        let batch = candidates.slice(offset, offset + 12);
        while (batch.length > 1 && wire({ query, sources: batch }) > 12000) batch = batch.slice(0, -1);
        offset += batch.length;
        if (wire({ query, sources: batch }) > 12000) throw new Error('CANDIDATE_BUDGET');
        const selection = await model('/v1/context', { query, sources: batch });
        if (selection.ambiguous || !selection.chunk_ids.length || selection.chunk_ids.some(id => !batch.some(source => source.chunk_id === id))) throw new Error('INVALID_SELECTION');
        selection.chunk_ids.forEach(id => selectedIds.add(id));
      }
      expanded = await expand([...selectedIds]);
    } else candidates.forEach(source => selectedIds.add(source.chunk_id));
    if (!expanded.complete) {
      console.log(JSON.stringify({ question_index, complete: false, reason: expanded.reason, candidate_count: candidates.length,
        selected_indexes: [...selectedIds].map(id => candidates.findIndex(source => source.chunk_id === id)) }));
      process.exitCode = 1;
      continue;
    }
    const answer = await model('/v1/answer', { query, sources: expanded.sources, groups: expanded.groups });
    const hashesValid = expanded.sources.every(source => createHash('sha256').update(source.content).digest('hex') === source.content_hash);
    const quotesValid = !answer.conflicting_sources && answer.quotes.length > 0 && answer.quotes.length <= 6 && answer.quotes.every(quote =>
      quote.quote.length <= 1500 && expanded.sources.some(source => source.chunk_id === quote.chunk_id && source.content.includes(quote.quote)));
    // Compare against the independently expanded canonical checkout unit, not
    // against a fabricated expected answer. Never print its private content.
    const checkout = candidates.filter(source => /check[ -]?out/i.test(source.heading_path));
    const canonical = checkout.length === 1 ? await expand([checkout[0].chunk_id]) : null;
    const canonicalIds = canonical?.complete ? canonical.sources.map(source => source.chunk_id) : [];
    const allCanonicalGroups = Boolean(canonical?.complete) && canonical.groups.every(group => expanded.groups.some(current =>
      current.id === group.id && [...current.chunk_ids].sort().join('|') === [...group.chunk_ids].sort().join('|') &&
      [...current.requires].sort().join('|') === [...group.requires].sort().join('|')));
    const sourceMap = new Map(expanded.sources.map(source => [source.chunk_id, source]));
    const allCanonicalEvidence = canonicalIds.length > 0 && canonicalIds.every(id => {
      const source = sourceMap.get(id);
      if (!source) return false;
      const ranges = [];
      let cursor = 0;
      for (const quote of answer.quotes.filter(quote => quote.chunk_id === id)) {
        const start = source.content.indexOf(quote.quote, cursor);
        if (start < 0) return false;
        ranges.push([start, start + quote.quote.length]); cursor = start + quote.quote.length;
      }
      let offset = 0;
      return source.content.split(/\n\s*\n/).every(raw => {
        const part = raw.trim(), start = source.content.indexOf(part, offset), end = start + part.length;
        offset = end;
        if (!part || part === source.heading_path || part === query) return true;
        let covered = start;
        for (const [a, b] of ranges) {
          if (b <= covered || a >= end) continue;
          if (source.content.slice(covered, Math.max(covered, a)).trim()) return false;
          covered = Math.max(covered, Math.min(b, end));
        }
        return !source.content.slice(covered, end).trim();
      });
    });
    let currentSources = true;
    for (const source of expanded.sources) {
      const current = await rpc('assistant_read_source', { p_version: source.version_id, p_chunk: source.chunk_id });
      currentSources &&= current?.content_hash === source.content_hash && current?.epoch === source.epoch;
    }
    const finalProfile = await db.from('staff_profiles').select('role,is_active').eq('user_id', actor).single();
    currentSources &&= !finalProfile.error && finalProfile.data.is_active && finalProfile.data.role === 'ADMIN';
    const finalCatalog = await rpc('assistant_knowledge_availability', {});
    currentSources &&= finalCatalog.enabled && expanded.sources.every(source => source.epoch === finalCatalog.knowledge_epoch);
    const stepCount = checkout.length === 1 ? [...checkout[0].content.matchAll(/^\s*\d+\\?[.)]\s+/gm)].length : null;
    const evidenceVerified = hashesValid && quotesValid && allCanonicalEvidence && allCanonicalGroups && currentSources && stepCount === 8;
    const elapsed = Math.round(performance.now() - started);
    const withinGatewayBudget = elapsed < 55000;
    const passed = evidenceVerified && withinGatewayBudget;
    const report = { question_index, passed, candidate_count: candidates.length, selected_indexes: [...selectedIds].map(id => candidates.findIndex(source => source.chunk_id === id)),
      source_count: expanded.sources.length, group_count: expanded.groups.length, payload_bytes: wire({ query, sources: expanded.sources, groups: expanded.groups }),
      quote_count: answer.quotes.length, canonical_step_count: stepCount, hashes_valid: hashesValid, exact_quotes_valid: quotesValid,
      canonical_complete_evidence: allCanonicalEvidence, canonical_groups_complete: allCanonicalGroups,
      current_sources: currentSources, evidence_verified: evidenceVerified,
      within_gateway_budget: withinGatewayBudget, complete_backend_ms: elapsed };
    console.log(JSON.stringify(report));
    results.push({ passed, ids: canonicalIds.sort().join('|') });
    if (!passed) process.exitCode = 1;
  }
  console.log(JSON.stringify({ same_canonical_procedure: results.length > 1 ? results.every(result => result.passed && result.ids === results[0].ids) : null }));
}
main().catch(() => { console.error('READ_ONLY_LIVE_RETRIEVAL_PROBE_FAILED'); process.exitCode = 1; });
