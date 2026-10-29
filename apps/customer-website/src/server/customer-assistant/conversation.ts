import { customerDiscoveryContextSchema, type CustomerDiscoveryContext, customerInterpretedConstraintsSchema, knowledgeValidation as z } from '@deskatlas/validation';

// PRD-F26 / QAD-TC44: an immediate continuation must not revive older topics.
// The previous user question supplies intent only, never evidence or authority.
export function customerConversationTask(message: string, userTurns: string[]) {
  const followUp = /^(?:(?:ok(?:ay)?|and|so|then)[,!.]?\s*)*(?:what (?:happens|comes|do i do) (?:after that|next)|what (?:about|if) (?:that|it)|how (?:about|does) (?:that|it)|and then|what next)[?.!\s]*$/i;
  const continuation = followUp.test(message);
  const previous = [...userTurns].reverse().find(turn => !followUp.test(turn));
  if (!continuation || !previous) return { message, user_turns: userTurns, question: message };
  const channel = /\b(?:walk[ -]?in|kiosk|on[ -]?site)\b/i.test(previous) ? 'on-site walk-in at the kiosk'
    : /\b(?:website|online|email|payment link)\b/i.test(previous) ? 'customer website' : undefined;
  const question = `${channel ? `Active customer channel: ${channel}.\n` : ''}Latest customer question: ${previous}\nFollow-up: ${message}`;
  return { message: question.length <= 2000 ? question : message, user_turns: [previous], question };
}

// PRD-F26 / MS77-TC12: procedure wording is public; ownership is checked at reads.
export function requestsPrivateRecord(message: string): boolean {
  const owned = /\b(?:my|our)\s+(?:(?:existing|current|latest|last|upcoming|previous|confirmed|pending|paid)\s+)?(?:bookings?|reservations?|payments?|refunds?|proof|check.?in|customer\s*id|reference\s*code)\b/i.test(message);
  if (!owned) return false;
  const record = /\b(?:status|details?|history|show|find|retrieve|list|look\s*up|when|which|where\s+is|what\s+is\s+(?:my|our))\b/i.test(message);
  const procedure = /\b(?:how\s+(?:do|can|should|would|to)|what\s+(?:happens|are\s+the\s+(?:rules|steps))|can\s+(?:i|we)|policy|process|rules?)\b/i.test(message);
  return record || !procedure;
}

// Server time owns relative dates. Model text supplies intent, never live facts.
export function mergeConversationConstraints(saved: CustomerDiscoveryContext | undefined,
  constraints: z.infer<typeof customerInterpretedConstraintsSchema> | undefined, now = new Date()): CustomerDiscoveryContext {
  const { template_name: _template, floor_name: _floor, relative_date, ...values } = constraints ?? {};
  let date = values.date;
  if (relative_date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (name: string) => parts.find(item => item.type === name)!.value;
    const day = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
    if (relative_date === 'TOMORROW') day.setUTCDate(day.getUTCDate() + 1);
    date = day.toISOString().slice(0, 10);
  }
  return customerDiscoveryContextSchema.parse({ ...saved, ...values, ...(date ? { date } : {}),
    preferences: { ...saved?.preferences, ...values.preferences } });
}

export function missingScheduleQuestion(context: CustomerDiscoveryContext): string | undefined {
  const missing = [!context.date ? 'business date' : '', !context.start_time ? 'start time' : '',
    !context.duration_minutes ? 'duration (how long you need the space)' : ''].filter(Boolean);
  return missing.length ? `Which ${missing.join(' and ')} should I check?` : undefined;
}
