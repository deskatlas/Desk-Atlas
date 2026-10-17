import { assistantQueryUnderstandingSchema, type AssistantSource } from '@deskatlas/validation';
import { AssistantError } from './assistantService';

// MS55-TC03/04/07: versioned defaults pending the independent MS-54/55 gate.
export const ASSISTANT_HYBRID_CONFIG = Object.freeze({ version: 'ms55-v1', maxQueries: 4, branchLimit: 12, candidateLimit: 12, rrfK: 60 });

function bookingGuaranteeSearch(message: string): string | undefined {
  // MS53/MS55 / QAD-TC44: normalize a task, never provide its policy answer.
  // "Secure" can mean physical safety. Only an explicit workspace selection
  // plus a booking/ownership/sufficiency question admits this search category.
  const text = message.normalize('NFKC').toLowerCase();
  if (/\b(?:bolt\w*|anchor\w*|screw\w*|fasten\w*|wobbly|loose|legs?|theft|stolen)\b/.test(text)
    || !/\b(?:choos\w*|chos\w*|select\w*|pick\w*)\b/.test(text)
    || !/\b(?:desk|seat|spot|workspace|room|table)s?\b/.test(text)
    || !/\b(?:reserv\w*|book\w*|confirm\w*|secur\w*|holds?|mine|theirs|ours)\b/.test(text)) return undefined;
  return 'Workspace selection, reservation confirmation and inventory allocation';
}

function facilityFaultSearch(message: string): string | undefined {
  // Generalize a reported symptom into its source process, not repair steps.
  const text = message.normalize('NFKC').toLowerCase();
  if (!/\b(?:workspace|facility|office|equipment|printer|wi-?fi|internet|lighting|air.conditioning)\b/.test(text)
    || !/\b(?:not working|isn['’]?t working|out of order|broken|malfunction\w*|not functioning|hindi gumagana)\b/.test(text)) return undefined;
  return 'Facility equipment malfunction and maintenance reporting';
}

function ordinaryTaskSearch(message: string): string | undefined {
  // PRD-F26 / QAD-TC44: normalize ordinary task language into search categories.
  // These strings contain no permissions, required actions or policy answers.
  if (/\b(?:stay(?:ing)? longer|more time|extend(?:ing)?|extension)\b/i.test(message)) return 'Reservation extensions and reservation changes';
  if (/\b(?:noisy|noise|loud (?:calls?|voices?)|quiet)\b/i.test(message)) return 'Noise control and repeated facility rule violations';
  if (/\b(?:upset|unhappy|complain\w*)\b/i.test(message)) return 'Customer complaints, conflict resolution and escalation';
  if (/\b(?:forgot|left|lost|found)\b[^.!?]*\b(?:stuff|belongings?|items?|bags?|wallets?|laptops?)\b/i.test(message)) return 'Lost and found property handling';
  if (/\bbefore\b[^.!?]*\b(?:arriv\w*|open\w*)\b/i.test(message)) return 'Opening procedures and preparation before serving customers';
  return undefined;
}

export function selectBookingGuaranteeSeeds(original: string, candidates: ReadonlyArray<{ chunk_id: string; content: string }>): string[] | undefined {
  // PRD-F4 / QAD-TC44: choose published inventory rules, never a canned answer.
  // Retain affirmative/contrary selection rules as well as the no-hold witness.
  // Reviewed dependencies and independent final applicability stay mandatory.
  if (!bookingGuaranteeSearch(original)
    || /\b(?:also|then|plus)\b|\band\s+(?:how|what|when|who|can|may|should|do|does|is|are|show|tell)\b/i.test(original)) return undefined;
  const isWitness = (text: string) => /no inventory holds|do not reserve inventory|never holds? inventory/i.test(text);
  const rules = candidates.filter(source => {
    const text = source.content.replace(/\s+/g, ' ');
    if (isWitness(text)) return true;
    // Mere inventory mentions, headings and booking instructions are not
    // contrary claims. Preserve explicit selection-to-reservation assertions
    // in either grammatical direction, including negation and qualifications.
    return /\b(?:choosing|selecting|picking|selection|choice)\b[^.!?]{0,100}\b(?:reserves|holds|guarantees|confirms|allocates|books|secures)\b/i.test(text)
      || /\b(?:desk|seat|spot|workspace)s?\s+(?:are|is|become|becomes)\s+(?:not\s+)?(?:held|reserved|booked|allocated|secured)\b[^.!?]{0,100}\b(?:chosen|selected|picked)\b/i.test(text)
      || /\b(?:chosen|selected|picked)\s+(?:desk|seat|spot|workspace)\b[^.!?]{0,80}\b(?:held|reserved|booked|allocated|secured|guaranteed)\b/i.test(text);
  });
  // A mere related occurrence cannot authorize deterministic selection.
  const witness = rules.some(source => isWitness(source.content));
  return witness ? rules.map(source => source.chunk_id) : undefined;
}

export function assistantSearchQueries(original: string, understanding: unknown): string[] {
  const parsed = assistantQueryUnderstandingSchema.safeParse(understanding);
  const aids = parsed.success && parsed.data.original === original ? parsed.data : undefined;
  const normalizedTask = bookingGuaranteeSearch(original) ?? facilityFaultSearch(original)
    ?? (aids ? ordinaryTaskSearch(original) ?? ordinaryTaskSearch(aids.standalone ?? '') : undefined);
  if (!aids && !normalizedTask) return [original];
  const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const seen = new Set([normalize(original)]);
  const queries = [original];
  for (const variant of [normalizedTask, aids?.topic, aids?.standalone, ...(aids?.alternatives ?? [])]) {
    if (!variant || seen.has(normalize(variant))) continue;
    seen.add(normalize(variant));
    // Never replace material conditions with model-authored text. Original
    // wording is present in every embedding/lexical input, including follow-ups.
    const query = `${original}\nSearch interpretation: ${variant}`;
    if (query.length <= 3000) queries.push(query);
  }
  return queries.slice(0, ASSISTANT_HYBRID_CONFIG.maxQueries);
}

export function fuseAssistantCandidates(branches: { semantic: AssistantSource[][]; lexical: AssistantSource[][] }): AssistantSource[] {
  const count = branches.semantic.length;
  if (count < 1 || count > 4 || branches.lexical.length !== count) throw new AssistantError('DATA_UNAVAILABLE', 'Invalid retrieval branches.', 503);
  const ranked = new Map<string, { source: AssistantSource; score: number }>();
  for (const family of [branches.semantic, branches.lexical]) {
    family.forEach((items, variant) => {
      if (items.length > ASSISTANT_HYBRID_CONFIG.branchLimit) throw new AssistantError('DATA_UNAVAILABLE', 'Invalid retrieval bound.', 503);
      // Give the original half of each family's weight when alternatives exist.
      const weight = count === 1 ? 1 : variant === 0 ? 0.5 : 0.5 / (count - 1);
      const seen = new Set<string>();
      items.forEach((source, rank) => {
        // Chunk UUIDs belong to one version/generation. Keep canonical identity,
        // hash and epoch; never merge similar text from different publications.
        const key = `${source.document_id}/${source.version_id}/${source.chunk_id}`;
        const previous = ranked.get(key);
        if (previous && JSON.stringify(previous.source) !== JSON.stringify(source)) throw new AssistantError('KNOWLEDGE_CHANGED', 'Published knowledge changed. Retry.', 409);
        if (seen.has(key)) return;
        seen.add(key);
        const score = weight / (ASSISTANT_HYBRID_CONFIG.rrfK + rank + 1);
        ranked.set(key, { source, score: (previous?.score ?? 0) + score });
      });
    });
  }
  return [...ranked.entries()].sort(([a, left], [b, right]) => right.score - left.score || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, ASSISTANT_HYBRID_CONFIG.candidateLimit).map(([, item]) => item.source);
}
