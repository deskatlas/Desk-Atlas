import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { customerCapabilitySchema, customerControlIdentitySchema, customerPlanSchema } from '@deskatlas/validation';
import type { CustomerCapability } from '@deskatlas/validation';
import type { CustomerService } from '@deskatlas/domain';

// MS76-R02: this package must only be imported by server adapters.
if (typeof window !== 'undefined') throw new Error('Server-only assistant adapter');

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function subjectDigest(secret: string, principal: CustomerCapability['principal'], subject: string): string {
  if (secret.length < 32) throw new Error('Assistant signing key unavailable');
  return createHmac('sha256', secret).update(`${principal}:${subject}`).digest('hex');
}
export function signCustomerCapability(claims: CustomerCapability, secret: string): string {
  if (secret.length < 32) throw new Error('Assistant signing key unavailable');
  const payload = Buffer.from(JSON.stringify(customerCapabilitySchema.parse(claims))).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function verifyCustomerCapability(token: string, secret: string, expected: Pick<CustomerCapability,
  'scope' | 'principal' | 'sub' | 'request_id' | 'session_id' | 'generation'>, now = Math.floor(Date.now() / 1000)): CustomerCapability {
  if (secret.length < 32 || token.length > 8192 || !/^[\w-]+\.[\w-]+$/.test(token)) throw new Error('INVALID_CAPABILITY');
  const [payload, signature] = token.split('.');
  if (!equal(signature, createHmac('sha256', secret).update(payload).digest('base64url'))) throw new Error('INVALID_CAPABILITY');
  const claims = customerCapabilitySchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  if (claims.iat > now || claims.exp <= now || (['scope', 'principal', 'sub', 'request_id', 'session_id', 'generation'] as const).some(key => claims[key] !== expected[key])) throw new Error('INVALID_CAPABILITY');
  return claims;
}
export function admitCustomerPlan(value: unknown, claims: CustomerCapability) {
  const plan = customerPlanSchema.parse(value);
  if (plan.operations.some(op => !claims.ops.includes(op.name))
      || claims.principal === 'PUBLIC_VISITOR' && (plan.kind === 'BOOKING' || plan.operations.some(op => op.name.startsWith('owned_')))) throw new Error('FORBIDDEN');
  return plan;
}
export async function verifyAssistantCustomer(service: CustomerService, bearer: string) {
  // Internal feature credentials never become customer authority.
  const customer = await service.verifyAccessToken(bearer, undefined, 'REWARDS_AND_ASSISTANT_ACCESS');
  if (!customer) throw new Error('FORBIDDEN');
  return customer;
}

export type ControlStage = 'checking' | 'retrieving' | 'preparing' | 'complete';
export interface CustomerControlOwner {
  scope: string; principal: CustomerCapability['principal']; subject_digest: string;
}
export class CustomerRequestControl {
  constructor(private readonly db: SupabaseClient, private readonly owner: CustomerControlOwner) {}
  async command(operation: 'claim' | 'progress' | 'cancel' | 'stage' | 'release' | 'check', identity: unknown, stage?: ControlStage): Promise<{ stage: ControlStage; cancelled: boolean } | null> {
    const ids = customerControlIdentitySchema.parse(identity);
    const { data, error } = await this.db.rpc('customer_assistant_control', {
      p_operation: operation, p_scope: this.owner.scope, p_principal: this.owner.principal,
      p_subject: this.owner.subject_digest, p_request: ids.request_id,
      p_session: ids.session_id, p_generation: ids.generation, p_stage: stage ?? null,
    });
    if (error) throw new Error('ASSISTANT_CONTROL_UNAVAILABLE');
    if (data === null) return null;
    if (!data || !['checking', 'retrieving', 'preparing', 'complete'].includes(data.stage) || typeof data.cancelled !== 'boolean') throw new Error('INVALID_CONTROL_RESPONSE');
    return { stage: data.stage, cancelled: data.cancelled };
  }
  async assertActive(identity: unknown): Promise<void> {
    const state = await this.command('check', identity);
    if (!state || state.cancelled || state.stage === 'complete') throw new Error('REQUEST_CANCELLED');
  }
  async run<T>(identity: unknown, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    await this.assertActive(identity);
    const abort = new AbortController();
    let checking = false;
    const poll = setInterval(async () => {
      if (checking) return;
      checking = true;
      try { await this.assertActive(identity); } catch { abort.abort(); }
      finally { checking = false; }
    }, 250);
    const timeout = setTimeout(() => abort.abort(), 60000);
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('REQUEST_CANCELLED'));
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([work(abort.signal), cancelled]);
      await this.assertActive(identity);
      if (abort.signal.aborted) throw new Error('REQUEST_CANCELLED');
      return result;
    } finally {
      clearInterval(poll); clearTimeout(timeout);
      abort.signal.removeEventListener('abort', onAbort);
    }
  }
}

// MS76-TC06: execute reads at the gateway and repeat authority/epoch checks
// immediately before releasing evidence. Never expose source storage URLs.
export class CustomerKnowledgeReader {
  constructor(private readonly db: SupabaseClient, private readonly claims: CustomerCapability,
    private readonly fingerprint: string, private readonly authorize: () => Promise<void>) {
    this.claims = customerCapabilitySchema.parse(claims);
  }
  async read(operation: 'availability' | 'search' | 'search_hybrid' | 'source' | 'document', args: Record<string, unknown> = {}) {
    await this.authorize();
    if (!this.claims.ops.includes('customer_knowledge')) throw new Error('FORBIDDEN');
    const names = { availability: 'customer_knowledge_availability', search: 'customer_search_knowledge', search_hybrid: 'customer_search_hybrid', source: 'customer_read_source', document: 'customer_document_evidence' };
    const { data, error } = await this.db.rpc(names[operation], {
      ...args, p_actor: this.claims.sub, p_principal: this.claims.principal,
      p_scope: this.claims.scope, p_fingerprint: this.fingerprint,
    });
    if (error) throw new Error('KNOWLEDGE_UNAVAILABLE');
    return data as unknown;
  }
  async release<T>(epoch: number, build: () => Promise<T>): Promise<T> {
    const result = await build();
    const state = await this.read('availability');
    if (!state || typeof state !== 'object' || !('knowledge_epoch' in state) || state.knowledge_epoch !== epoch) throw new Error('KNOWLEDGE_CHANGED');
    await this.authorize();
    return result;
  }
}
