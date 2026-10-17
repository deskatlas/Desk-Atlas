// MS53/QAD-TC44: recognize read-only SOP governance questions, never grant roles.
export interface GovernanceIntent { ownership: boolean; improvement: boolean }
export function sopGovernanceIntent(message: string): GovernanceIntent | undefined {
  const text = message.normalize('NFKC').toLowerCase().trim().replace(/\?$/, '').replace(/\s+/g, ' ');
  const subject = '(?:the )?(?:sop|standard operating procedures?)';
  const owner = `(?:who (?:can|may) (?:manage|maintain|review|update) ${subject}|who is responsible for (?:managing|maintaining|reviewing(?: and updating)?|updating) ${subject})`;
  const improve = `(?:can (?:we|staff|employees) (?:improve|suggest improvements to|suggest changes to) (?:${subject}|it)|how can (?:we|staff|employees) (?:improve|suggest improvements to|suggest changes to) ${subject})`;
  if (new RegExp(`^${owner}$`).test(text)) return { ownership: true, improvement: false };
  if (new RegExp(`^${owner} and ${improve}$`).test(text)) return { ownership: true, improvement: true };
  // Pronouns alone need the conversation resolver, not guessed policy scope.
  if (new RegExp(`^${improve}$`).test(text) && !/\bit$/.test(text)) return { ownership: false, improvement: true };
  return undefined;
}
export function governanceSupport(content: string): GovernanceIntent {
  const text = content.toLowerCase();
  const sop = /\bsop\b|standard operating procedure/.test(text);
  return {
    ownership: sop && /\b(?:management|managers?|administrators?|admins?|owners?)\b/.test(text)
      && /\bresponsib\w*\b/.test(text) && /\b(?:review\w*|updat\w*|maintain\w*)\b/.test(text),
    improvement: sop && /\b(?:employees?|staff)\b/.test(text) && /\b(?:suggest\w*|feedback)\b/.test(text)
      && /\bmanagement\b/.test(text) && /\breview\w*\b/.test(text),
  };
}
export function selectGovernanceSeeds(message: string, sources: ReadonlyArray<{chunk_id: string; content: string}>): string[] | undefined {
  const intent = sopGovernanceIntent(message);
  if (!intent) return undefined;
  // A combined question starts from every explicit improvement passage. The
  // reviewed graph must supply its authority prerequisites, and Python must
  // independently prove both clauses in that complete closure before release.
  // Single-topic ownership retains all corroborating owner passages.
  const relevant = sources.filter(source => { const proof = governanceSupport(source.content); return (intent.ownership && proof.ownership) || (intent.improvement && proof.improvement); });
  const coverage = relevant.map(source => governanceSupport(source.content));
  if ((intent.ownership && !coverage.some(proof => proof.ownership)) || (intent.improvement && !coverage.some(proof => proof.improvement))) return undefined;
  return relevant.filter(source => !intent.improvement || governanceSupport(source.content).improvement).map(source => source.chunk_id);
}
