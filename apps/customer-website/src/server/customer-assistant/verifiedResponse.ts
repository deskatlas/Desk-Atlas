// MS78-R02/R03: deterministic booking facts cannot be overridden by retrieved policy prose.
import { publicCustomerResponseSchema, type PublicCustomerResponse, type PublicCustomerQuery } from '@deskatlas/validation';
import { prepareVerifiedAnswer, type authorizeVerifiedCustomer } from './verified';
import type { CustomerBookingFacts } from '@deskatlas/domain';
import type { VerifiedPolicyAddendum } from './verifiedKnowledge';

export async function buildVerifiedResponse(
  auth: Awaited<ReturnType<typeof authorizeVerifiedCustomer>>,
  input: Pick<PublicCustomerQuery, 'selected_reservation_id' | 'reservation_filter'>,
  baseResponse: PublicCustomerResponse,
  signal?: AbortSignal,
  policy?: (facts: CustomerBookingFacts) => Promise<VerifiedPolicyAddendum>,
): Promise<PublicCustomerResponse> {
  let addendum: VerifiedPolicyAddendum | undefined;
  const policyForFacts = policy ? async (facts: CustomerBookingFacts) => {
    if (addendum) return;
    try { addendum = await policy(facts); }
    catch (error) {
      // Expiry, cancellation and publication withdrawal must never become a fallback success.
      if (signal?.aborted || error instanceof Error && ['KNOWLEDGE_CHANGED', 'REQUEST_CANCELLED'].includes(error.message)) throw error;
      await auth.reauthorize();
      addendum = { citations: [], excerpts: [], limitations: ['Approved policy guidance is temporarily unavailable. The current booking facts and review actions above remain authoritative.'] };
    }
  } : undefined;
  const resolved = await prepareVerifiedAnswer(auth, input.selected_reservation_id, input.reservation_filter,
    policyForFacts, signal);
  // No source prose is admitted as a private permission claim. Use the exact fact fallback.
  const base = { ...baseResponse, citations: [], suggestions: [], actions: [], limitations: [], as_of: new Date().toISOString(),
    booking_context: undefined, reservation_choices: undefined, reservation_next_cursor: undefined, policy_excerpts: undefined };
  if (resolved.kind === 'CONTEXT') return publicCustomerResponseSchema.parse({
    ...base, kind: 'ANSWER', booking_result: 'CONTEXT', summary: resolved.summary,
    citations: addendum?.citations ?? [], policy_excerpts: addendum?.excerpts ?? [],
    booking_context: resolved.context, as_of: resolved.context.as_of,
    limitations: [...resolved.context.limitations, ...(addendum?.limitations ?? (policy ? ['Approved policy guidance is unavailable. Current booking facts remain authoritative.'] : []))],
  });
  if (resolved.kind === 'CLARIFY') return publicCustomerResponseSchema.parse({
    ...base, kind: 'CLARIFY', booking_result: 'CLARIFY',
    summary: resolved.items.length ? 'Choose the reservation you would like help with.' : 'No matching reservations were found. Try the booking history filter.',
    reservation_choices: resolved.items, reservation_next_cursor: resolved.next_cursor,
  });
  return publicCustomerResponseSchema.parse({
    ...base, kind: 'CLARIFY', booking_result: resolved.kind,
    summary: resolved.kind === 'BOOKING_CHANGED' ? 'This reservation changed while the answer was prepared. Please retry for current options.'
      : 'This reservation is unavailable. Choose one of your reservations to continue.',
  });
}
