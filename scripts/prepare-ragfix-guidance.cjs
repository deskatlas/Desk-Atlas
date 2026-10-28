// PRD-F26/F27 / QAD-TC44-TC46: read-only original-guidance component preview.
const {readFileSync}=require('node:fs');
const {parseEnv}=require('node:util');
const {spawn}=require('node:child_process');
const {resolve}=require('node:path');
const {createClient}=require('@supabase/supabase-js');
async function main(){
  const env={...parseEnv(readFileSync('apps/admin-portal/.env.local','utf8')),...parseEnv(readFileSync('services/rag/.env.local','utf8')),
    ...process.env,RAG_MODEL_PROVIDER:'deepinfra',RAG_DOCUMENT_ANSWER_MODEL:process.env.RAG_COMPONENT_PREPARATION_MODEL||'Qwen/Qwen3-32B'};
  const db=createClient(env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const actor=await db.from('staff_profiles').select('user_id').eq('role','ADMIN').eq('is_active',true).limit(1).single();
  const catalog=await db.from('kb_documents').select('id,title,active_version_id').eq('scope_id',env.RAG_SCOPE_ID).is('deleted_at',null).not('active_version_id','is',null).order('id');
  if(actor.error||catalog.error)throw Error('SOURCE_UNAVAILABLE');
  const indexes=process.argv[2]?.split(',').map(Number);if(!indexes)throw Error('DOCUMENT_INDEX_REQUIRED');
  for(const index of indexes){
    if(!Number.isSafeInteger(index)||!catalog.data[index])throw Error('INVALID_INDEX');
    const doc=catalog.data[index];
    const artifact=await db.from('kb_support_artifacts').select('artifact_text,artifact_sha256').eq('version_id',doc.active_version_id).single();
    const seed=await db.from('kb_chunks').select('id').eq('version_id',doc.active_version_id).order('ordinal').limit(1).single();
    if(artifact.error||seed.error)throw Error('PREPARED_SOURCE_REQUIRED');
    const evidence=await db.rpc('assistant_document_evidence',{p_actor:actor.data.user_id,p_scope:env.RAG_SCOPE_ID,
      p_fingerprint:env.RAG_EMBEDDING_FINGERPRINT,p_chunks:[seed.data.id]});
    if(evidence.error||!evidence.data?.sources?.length)throw Error('EVIDENCE_UNAVAILABLE');
    const start=performance.now();
    const moduleName=process.argv[3]==='--rules'?'experiments.ragfix.rule_graph':process.argv[3]==='--exact-conditions'?'experiments.ragfix.unit_closure_runtime':'experiments.ragfix.guidance_runtime';
    const child=spawn(resolve('services/rag/.venv-service/Scripts/python.exe'),['-m',moduleName],
      {cwd:resolve('services/rag'),env,stdio:['pipe','pipe','pipe']});
    child.stdin.end(JSON.stringify({...artifact.data,sources:evidence.data.sources}));
    let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.resume();
    const code=await new Promise(done=>child.on('exit',done));
    console.log(JSON.stringify({index,title:doc.title,elapsed_ms:Math.round(performance.now()-start),result:output.trim()?JSON.parse(output.trim()):{status:'FAILED'}}));
    if(code!==0)process.exitCode=1;
  }
}
main().catch(()=>{console.error('GUIDANCE_PREVIEW_FAILED');process.exitCode=1});
