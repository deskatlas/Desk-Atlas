// PRD-F26/F27 / QAD-TC44-TC46: real-source preview and explicit bounded preparation retry.
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const env = { ...parseEnv(readFileSync('apps/admin-portal/.env.local', 'utf8')),
    ...parseEnv(readFileSync('services/rag/.env.local', 'utf8')), ...process.env,
    RAG_MODEL_PROVIDER: 'deepinfra' };
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (process.argv[2] === '--retry-failed') {
    const jobs = await db.from('kb_support_jobs').select('id,version_id,compiler_fingerprint,attempts')
      .eq('scope_id',env.RAG_SCOPE_ID).eq('status','FAILED').lt('attempts',3);
    if (jobs.error) throw Error('RETRY_STATUS_UNAVAILABLE');
    for (const job of jobs.data) {
      const doc = await db.from('kb_documents').select('id').eq('active_version_id',job.version_id)
        .in('audience',['ADMIN_ONLY','ADMIN_AND_STAFF']).is('deleted_at',null).maybeSingle();
      if (doc.error) throw Error('RETRY_SCOPE_UNAVAILABLE');
      if (!doc.data) continue;
      const result = await db.rpc('kb_support_command',{p_scope:env.RAG_SCOPE_ID,p_operation:'retry',p_id:job.id,
        p_data:{compiler_fingerprint:job.compiler_fingerprint}});
      console.log(JSON.stringify({operation:'explicit_retry',accepted:!result.error,prior_attempts:job.attempts}));
      if (result.error) process.exitCode=1;
    }
    return;
  }
  if (process.argv[2] === '--status') {
    const jobs = await db.from('kb_support_jobs').select('status,error_code,attempts,updated_at')
      .eq('scope_id', env.RAG_SCOPE_ID);
    if (jobs.error) throw Error('PREPARATION_STATUS_UNAVAILABLE');
    console.log(JSON.stringify({counts:jobs.data.reduce((counts,job)=>({...counts,[job.status]:(counts[job.status]||0)+1}),{}),
      failures:jobs.data.filter(job=>job.status==='FAILED').map(({error_code,attempts})=>({error_code,attempts}))}));
    return;
  }
  const actor = await db.from('staff_profiles').select('user_id').eq('role', 'ADMIN').eq('is_active', true).limit(1).single();
  if (actor.error || !actor.data) throw Error('ACTIVE_ADMIN_REQUIRED');
  if (process.argv[2] === '--ready') {
    const probe = spawnSync(resolve('services/rag/.venv-service/Scripts/python.exe'),
      ['-c','from knowledge.support_runtime import compiler_fingerprint; print(compiler_fingerprint())'],
      {cwd:resolve('services/rag'),env:{...env,RAG_DOCUMENT_ANSWER_MODEL:'Qwen/Qwen3-32B',RAG_PREPARATION_FORMAT:'bounded_schema'},encoding:'utf8'});
    if(probe.status!==0 || !/^[a-f0-9]{64}$/.test(probe.stdout.trim())) throw Error('COMPILER_UNAVAILABLE');
    const result=await db.rpc('assistant_prepared_catalog',{p_actor:actor.data.user_id,p_scope:env.RAG_SCOPE_ID,
      p_fingerprint:env.RAG_EMBEDDING_FINGERPRINT,p_compiler_fingerprint:probe.stdout.trim()});
    if(result.error) throw Error('READINESS_UNAVAILABLE');
    console.log(JSON.stringify({complete:result.data.complete,ready_documents:result.data.documents.length,epoch:result.data.epoch}));
    return;
  }
  const catalog = await db.from('kb_documents').select('id,title,active_version_id')
    .eq('scope_id', env.RAG_SCOPE_ID).is('deleted_at', null).not('active_version_id', 'is', null).order('id');
  if (catalog.error || !catalog.data) throw Error('CATALOG_UNAVAILABLE');
  if(process.argv[2] === '--export-prepared') {
    const rows=await db.from('kb_support_artifacts').select('version_id,artifact_text');
    if(rows.error) throw Error('PREPARED_REVIEW_UNAVAILABLE');
    const directory=resolve('services/rag/.cache/prepared-review'); mkdirSync(directory,{recursive:true});
    for(const row of rows.data) {
      const doc=catalog.data.find(document=>document.active_version_id===row.version_id); if(!doc) continue;
      const artifact=JSON.parse(row.artifact_text);
      writeFileSync(resolve(directory,artifact.source_binding+'.json'),row.artifact_text);
      console.log(JSON.stringify({title:doc.title,file:artifact.source_binding+'.json'}));
    }
    return;
  }
  if (process.argv[2] === '--map-summary') {
    const rows = await db.from('kb_support_artifacts').select('version_id,artifact_text,stats');
    if (rows.error) throw Error('MAP_STATUS_UNAVAILABLE');
    for (const row of rows.data) {
      const doc = catalog.data.find(document => document.active_version_id === row.version_id);
      if (!doc) continue;
      const artifact = JSON.parse(row.artifact_text);
      const sizes = artifact.groups.map(group => {
        const ids = artifact.groups.some(item=>item.scope==='DOCUMENT') ? artifact.groups.map(item=>item.id)
          : [group.id,...artifact.groups.filter(item=>item.scope==='GLOBAL').map(item=>item.id)];
        const visited = new Set(), chunks = new Set();
        while (ids.length) {
          const id=ids.pop(); if (visited.has(id)) continue; visited.add(id);
          const item=artifact.groups.find(value=>value.id===id); ids.push(...item.requires);
          for (const [first,last] of item.ranges) for(let i=first;i<=last;i++) chunks.add(artifact.units[i].chunk_id);
        }
        return chunks.size;
      });
      console.log(JSON.stringify({title:doc.title,groups:artifact.groups.length,
        scopes:artifact.groups.reduce((counts,item)=>({...counts,[item.scope]:(counts[item.scope]||0)+1}),{}),
        full_chunks:new Set(artifact.units.map(unit=>unit.chunk_id)).size,
        mean_closure_chunks:Math.round(sizes.reduce((a,b)=>a+b,0)/sizes.length),calls:row.stats.calls,
        input_tokens:row.stats.input_tokens,output_tokens:row.stats.output_tokens}));
    }
    return;
  }
  if (process.argv[2] === '--diagnose') {
    const jobs = await db.from('kb_support_jobs').select('version_id,status').eq('scope_id', env.RAG_SCOPE_ID).neq('status','QUEUED');
    for (const job of jobs.data ?? []) {
      const version = await db.from('kb_document_versions').select('embedding_fingerprint,generation').eq('id',job.version_id).single();
      const seed = await db.from('kb_chunks').select('id').eq('version_id',job.version_id).eq('generation',version.data.generation).order('ordinal').limit(1).single();
      const evidence = await db.rpc('assistant_document_evidence', { p_actor:actor.data.user_id,p_scope:env.RAG_SCOPE_ID,
        p_fingerprint:version.data.embedding_fingerprint,p_chunks:[seed.data.id] });
      const doc = await db.from('kb_documents').select('title,audience').eq('active_version_id',job.version_id).single();
      console.log(JSON.stringify({status:job.status,...doc.data,error:evidence.error?.message ?? null,sources:evidence.data?.sources?.length ?? 0}));
    }
    return;
  }
  if (process.argv[2] === '--inventory') {
    const rows = await db.from('kb_chunks').select('version_id,content')
      .in('version_id', catalog.data.map(document => document.active_version_id));
    if (rows.error || !rows.data) throw Error('SOURCE_UNAVAILABLE');
    console.log(JSON.stringify(catalog.data.map((document, index) => {
      const chunks = rows.data.filter(chunk => chunk.version_id === document.active_version_id);
      return { index, title: document.title, chunks: chunks.length,
        content_bytes: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.content, 'utf8'), 0) };
    })));
    return;
  }
  if (!process.argv[2]) {
    console.log(JSON.stringify(catalog.data.map((doc, index) => ({ index, title: doc.title }))));
    return;
  }
  const selected = process.argv[2].split(',').map(Number);
  for (const index of selected) {
    if (!Number.isSafeInteger(index) || !catalog.data[index]) throw Error('INVALID_DOCUMENT_INDEX');
    const doc = catalog.data[index];
    const seed = await db.from('kb_chunks').select('id').eq('version_id', doc.active_version_id).order('ordinal').limit(1).single();
    if (seed.error || !seed.data) throw Error('SOURCE_UNAVAILABLE');
    const evidence = await db.rpc('assistant_document_evidence', { p_actor: actor.data.user_id,
      p_scope: env.RAG_SCOPE_ID, p_fingerprint: env.RAG_EMBEDDING_FINGERPRINT, p_chunks: [seed.data.id] });
    if (evidence.error || !evidence.data?.sources?.length) throw Error('EVIDENCE_UNAVAILABLE');
    const started = performance.now();
    const child = spawn(resolve('services/rag/.venv-service/Scripts/python.exe'), ['-m', 'knowledge.support_runtime'],
      { cwd: resolve('services/rag'), env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(JSON.stringify(evidence.data.sources));
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    // Exception detail may contain provider payloads, so only allowlisted stdout is emitted.
    child.stderr.resume();
    const code = await new Promise(resolveExit => child.on('exit', resolveExit));
    console.log(JSON.stringify({ index, title: doc.title, elapsed_ms: Math.round(performance.now() - started),
      result: output.trim() ? JSON.parse(output.trim()) : { status: 'FAILED', reason: 'COMPILER_UNAVAILABLE' } }));
    if (code !== 0) process.exitCode = 1;
  }
}
main().catch(() => { console.error('PREPARATION_PREVIEW_FAILED'); process.exitCode = 1; });
