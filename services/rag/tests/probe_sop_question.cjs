// MS53/QAD-TC44: opt-in read-only diagnostic, no excerpts or credentials logged.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { createHmac, randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { createClient } = require('@supabase/supabase-js');
async function main() {
  const root = resolve(__dirname, '../../..');
  const env = { ...parseEnv(readFileSync(resolve(root, 'apps/admin-portal/.env.local'), 'utf8')), ...process.env };
  const db = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const profile = await db.from('staff_profiles').select('user_id').eq('role', 'ADMIN').eq('is_active', true).limit(1).single();
  if (profile.error) throw Error('ACTOR_REQUIRED');
  const query = process.argv[2] || 'who can manage the sop and can we improve it?';
  const started = performance.now();
  async function model(path, value) {
    const now = Math.floor(Date.now()/1000);
    const payload = Buffer.from(JSON.stringify({ iss:'deskatlas',aud:'rag',sub:profile.data.user_id,role:'ADMIN',request_id:randomUUID(),scope:env.RAG_SCOPE_ID,ops:['search','answer'],iat:now,exp:now+60,generation:randomUUID() })).toString('base64url');
    const sig = createHmac('sha256',env.RAG_CAPABILITY_SECRET).update(payload).digest('base64url');
    const start = performance.now();
    const response = await fetch(new URL(path,env.RAG_SERVICE_URL), {method:'POST',headers:{Authorization:'Bearer '+env.RAG_SERVICE_TOKEN,'X-Request-Capability':payload+'.'+sig,'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(55000)});
    const data = await response.json();
    console.log(JSON.stringify({stage:path,status:response.status,elapsed_ms:Math.round(performance.now()-start),reason:data.detail||data.error||null,timing:response.headers.get('server-timing'),kind:data.kind,quote_count:data.quotes?.length}));
    if(!response.ok) throw Error('STAGE_FAILED');
    return data;
  }
  if(process.argv.includes('--plan')) { await model('/v1/plan',{message:query,recent_context:{user_turns:[]},business_date:'2026-10-15',timezone:'Asia/Manila'}); return; }
  const embedding = await model('/v1/embed',{query});
  const rpc = async(name,args) => {const r=await db.rpc(name,{p_actor:profile.data.user_id,p_scope:env.RAG_SCOPE_ID,p_fingerprint:env.RAG_EMBEDDING_FINGERPRINT,...args});if(r.error)throw Error('RPC_FAILED');return r.data;};
  const candidates = await rpc('assistant_search_knowledge',{p_vector:embedding.vector,p_min_similarity:Number(env.RAG_MIN_SIMILARITY)});
  if(process.argv.includes('--context')) {
    const selection = await model('/v1/context', {query,sources:candidates,contract_version:2});
    console.log(JSON.stringify({candidate_count:candidates.length,selected_count:selection.chunk_ids?.length,outcome:selection.coverage?.outcome}));
    if(!selection.chunk_ids?.length)throw Error('USEFUL_SUPPORT_REQUIRED');
    const evidence=await rpc('assistant_expand_evidence',{p_chunks:selection.chunk_ids});
    if(!evidence.complete)throw Error('COMPLETE_EVIDENCE_REQUIRED');
    const answer=await model('/v1/answer',{query,sources:evidence.sources,groups:evidence.groups,required_chunk_ids:evidence.sources.map(s=>s.chunk_id),coverage:selection.coverage});
    if(!answer.quotes?.length||answer.conflicting_sources)throw Error('USEFUL_ANSWER_REQUIRED');
    if(process.argv.includes('--synthesis')) {
      const spans=answer.quotes.map(q=>{const s=evidence.sources.find(s=>s.chunk_id===q.chunk_id);const start=s?.content.indexOf(q.quote)??-1;if(start<0)throw Error('EXACT_EVIDENCE_REQUIRED');return {...q,start,end:start+q.quote.length};});
      const payload={query,coverage:selection.coverage,sources:evidence.sources,spans};
      const candidate=await model('/v1/synthesis',payload);
      const verdict=await model('/v1/support',{...payload,candidate});
      const accepted=verdict.complete&&verdict.consistent&&verdict.evidence_safe&&verdict.supported.length===candidate.blocks.length&&verdict.supported.every(Boolean);
      console.log(JSON.stringify({synthesis_supported:accepted,blocks:candidate.blocks.length}));
      if(!accepted)throw Error('SYNTHESIS_SUPPORT_REQUIRED');
    }
    return;
  }
  if(process.argv.includes('--verify')) {
    const { sopGovernanceIntent, selectGovernanceSeeds } = require(resolve(__dirname, '../../../node_modules/.cache/ms53-live/assistantGovernance.js'));
    if(!sopGovernanceIntent(query))throw Error('DOCUMENT_PLAN_REQUIRED');
    const seeds=selectGovernanceSeeds(query,candidates);
    if(!seeds?.length)throw Error('SUPPORTED_SEEDS_REQUIRED');
    const evidence=await rpc('assistant_expand_evidence',{p_chunks:seeds});
    if(!evidence.complete){
      const edges=[];
      for(const id of seeds){const x=await rpc('assistant_expand_evidence',{p_chunks:[id]});edges.push({index:candidates.findIndex(s=>s.chunk_id===id),complete:x.complete,source_indexes:x.sources.map(s=>candidates.findIndex(c=>c.chunk_id===s.chunk_id)),count:x.sources.length});}
      const contains=[];for(const [a,s] of candidates.entries())for(const [b,t] of candidates.entries())if(a!==b&&seeds.includes(s.chunk_id)&&seeds.includes(t.chunk_id)){const ps=t.content.split(/\n\s*\n/).map(p=>p.trim()).filter(p=>p&&!t.heading_path.includes(p)&&p!==t.title);contains.push({a,b,covers:ps.length>0&&ps.every(p=>s.content.includes(p))});}
      console.log(JSON.stringify({closure_edges:edges,paragraph_contains:contains}));
    }
    console.log(JSON.stringify({seed_indexes:seeds.map(id=>candidates.findIndex(s=>s.chunk_id===id)),complete:evidence.complete,reason:evidence.reason,sources:evidence.sources.length}));
    if(!evidence.complete)throw Error('COMPLETE_EVIDENCE_REQUIRED');
    const answer=await model('/v1/answer',{query,sources:evidence.sources,groups:evidence.groups});
    const {createHash}=require('node:crypto');
    const exact=answer.quotes?.length>0&&!answer.conflicting_sources&&answer.quotes.every(q=>evidence.sources.some(s=>s.chunk_id===q.chunk_id&&s.content.includes(q.quote)));
    const complete=exact&&evidence.sources.every(s=>{
      const ranges=answer.quotes.filter(q=>q.chunk_id===s.chunk_id).map(q=>{const start=s.content.indexOf(q.quote);return[start,start+q.quote.length];}).sort((a,b)=>a[0]-b[0]);
      let offset=0;
      return s.content.split(/\n\s*\n/).every(raw=>{const part=raw.trim(),start=s.content.indexOf(part,offset),end=start+part.length;offset=end;if(!part||part===s.heading_path||part===query)return true;let covered=start;for(const[a,b]of ranges){if(b<=covered||a>=end)continue;if(s.content.slice(covered,Math.max(covered,a)).trim())return false;covered=Math.max(covered,Math.min(b,end));}return !s.content.slice(covered,end).trim();});
    });
    let current=complete;
    for(const s of evidence.sources){const read=await rpc('assistant_read_source',{p_version:s.version_id,p_chunk:s.chunk_id});current&&=read.content_hash===s.content_hash&&createHash('sha256').update(s.content).digest('hex')===s.content_hash&&read.epoch===s.epoch;}
    const finalProfile=await db.from('staff_profiles').select('role,is_active').eq('user_id',profile.data.user_id).single();
    const catalog=await rpc('assistant_knowledge_availability',{});
    current&&=!finalProfile.error&&finalProfile.data.role==='ADMIN'&&finalProfile.data.is_active&&catalog.enabled&&evidence.sources.every(s=>s.epoch===catalog.knowledge_epoch);
    console.log(JSON.stringify({exact_quotes:exact,complete_required_evidence:complete,current_sources:current,quote_count:answer.quotes.length,complete_backend_ms:Math.round(performance.now()-started)}));
    if(!current)throw Error('VERIFICATION_FAILED');return;
  }
  const reports=[];
  for(const [index,source] of candidates.entries()) {
    const evidence=await rpc('assistant_expand_evidence',{p_chunks:[source.chunk_id]});
    reports.push({index,bytes:Buffer.byteLength(source.content),complete:evidence.complete,reason:evidence.reason,source_count:evidence.sources.length,
      signals:{sop:/\bSOP\b|standard operating procedure/i.test(source.content+' '+source.heading_path),management:/management|responsib|review|updat|maintain|ownership/i.test(source.content),improvement:/improv|suggest|feedback|revis|updat/i.test(source.content)}});
  }
  console.log(JSON.stringify({candidates:reports}));
  if(process.argv.includes('--answer')) { const evidence=await rpc('assistant_expand_evidence',{p_chunks:candidates.map(s=>s.chunk_id)});console.log(JSON.stringify({union_complete:evidence.complete,reason:evidence.reason,sources:evidence.sources.length}));if(evidence.complete)await model('/v1/answer',{query,sources:evidence.sources,groups:evidence.groups}); }
}
main().catch(()=>{console.log('SOP_DIAGNOSTIC_FAILED');process.exitCode=1;});
