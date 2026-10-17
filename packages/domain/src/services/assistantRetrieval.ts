// MS53-TC01..04: bounded task matching over real retrieved evidence.
// These helpers select a seed, never provide an answer or grant permission.
function faqText(value: string): string {
  return value.normalize('NFKC').replace(/\\\./g, '.').replace(/\*\*/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function faqWords(value: string): string[] {
  const ignored = new Set(['a', 'an', 'the', 'is', 'are', 'be', 'been', 'what', 'which', 'how', 'who', 'where', 'when', 'why',
    'can', 'could', 'may', 'should', 'do', 'does', 'did', 'have', 'has', 'for', 'of', 'to', 'if', 'they', 'their', 'them', 'we', 'you', 'i']);
  return (value.match(/[a-z0-9]+/g) ?? []).filter(word => !ignored.has(word)).map(word => {
    let stem = word.length > 5 && word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
    if (stem.length > 5 && stem.endsWith('ing')) stem = stem.slice(0, -3);
    else if (stem.length > 4 && stem.endsWith('ed')) stem = stem.slice(0, -2);
    else if (stem.length > 6 && stem.endsWith('ion')) stem = stem.slice(0, -3);
    else if (stem.length > 7 && stem.endsWith('ment')) stem = stem.slice(0, -4);
    return stem.length > 4 && stem.endsWith('e') ? stem.slice(0, -1) : stem;
  });
}

function competingFaqPermissions(sources: ReadonlyArray<{ content: string }>): boolean {
  const claims: Array<{ role: string; task: string; negative: boolean; exclusive: boolean }> = [];
  const aliases: Readonly<Record<string, string>> = { administrators: 'admin', administrator: 'admin', admins: 'admin', employees: 'employee', managers: 'manager' };
  const role = (value: string) => aliases[value] ?? value;
  for (const source of sources) {
    for (const match of source.content.matchAll(/\b(only\s+)?(administrators?|admins?|staff|management|employees?|managers?)\s+(?:may|can|must|should)\s+((?:not|never)\s+)?([^.!?\n]{3,200})(?:[.!?\n]|$)/gi)) {
      claims.push({ role: role(match[2].toLowerCase()), task: match[4].trim().replace(/\s+/g, ' ').toLowerCase(), negative: Boolean(match[3]), exclusive: Boolean(match[1]) });
    }
    for (const match of source.content.matchAll(/\b(administrators?|admins?|staff|management|employees?|managers?)\s+alone\s+([^.!?\n]{3,200})(?:[.!?\n]|$)/gi)) {
      claims.push({ role: role(match[1].toLowerCase()), task: match[2].trim().replace(/\s+/g, ' ').toLowerCase(), negative: false, exclusive: true });
    }
  }
  return claims.some(left => claims.some(right => left.task === right.task &&
    (left.role === right.role && left.negative !== right.negative || left.exclusive && !left.negative && !right.negative && left.role !== right.role)));
}

// MS44/QAD-TC44: bind a question to published FAQ text, then independently
// verify complete quotations. Word order, roles and qualifiers stay significant.
export function selectFaqSeed(message: string, sources: ReadonlyArray<{ chunk_id: string; heading_path: string; content: string }>): string | undefined {
  // Do not prune a retrieved competing rule out of the normal conflict path.
  if (competingFaqPermissions(sources)) return undefined;
  const question = faqText(message).replace(/\?$/, '');
  if (/\b(it|this|that|these|those|he|she|his|her)\b/.test(question)) return undefined;
  if (/\b(they|them|their)\b/.test(question) && new Set((question.match(/\b(?:employees?|staff|management|administrators?|admins?|managers?|customers?|guests?)\b/g) ?? []).map(role => role.replace(/s$/, ''))).size !== 1) return undefined;
  const words = faqWords(question);
  const matches = sources.filter(source => {
    const path = source.heading_path.split(' / ');
    if (!path.slice(0, -1).some(part => /^faq\b/.test(faqText(part)))) return false;
    const leaf = faqText(path.at(-1) ?? '');
    const published = /^q\d+[.)]\s+(.+)\?$/.exec(leaf)?.[1];
    if (!published || (published !== question && (!/^[a-z0-9\s?,.'()-]+$/.test(question) || !/^[a-z0-9\s?,.'()-]+$/.test(published)
      || words.length < 3 || words.join('|') !== faqWords(published).join('|')))) return false;
    const paragraphs = source.content.split(/\n\s*\n/);
    return faqText(paragraphs[0] ?? '') === faqText(source.heading_path)
      && paragraphs.slice(1).some(part => part.trim() && faqText(part) !== leaf && faqText(part).replace(/\?$/, '') !== question);
  });
  return matches.length === 1 ? matches[0].chunk_id : undefined;
}

export function assistantRetrievalQuery(message: string): string {
  return message.trim().replace(/\s+/g, ' ').replace(/\bcheck(?:[ -]?out|otu)\b/gi, 'check out').replace(/\bcheck[ -]?in\b/gi, 'check in');
}

type ProcedureTask = 'check in' | 'check out';
export function standaloneProcedureTask(message: string): ProcedureTask | undefined {
  const text = assistantRetrievalQuery(message).toLowerCase().replace(/\?$/, '');
  const direct = /^(?:how do i|how do staff|how can i|how to|what is the procedure to) (check in|check out) (?:a |the )?(?:customer|guest)$/.exec(text)
    ?? /^paano(?: ko)? (?:mag[- ]?|i[- ]?)?(check in|check out) ng (?:customer|guest)$/.exec(text);
  if (direct) return direct[1] as ProcedureTask;
  if (/^(?:what should i do when (?:a |the )?(?:customer|guest) leaves|steps to finish (?:a |the )?(?:customer|guest)'s workspace session|(?:customer|guest) is leaving,? paano ang check out)$/.test(text)) return 'check out';
  // Only an explicit numbered section and complete generic task name, never
  // arbitrary "what is" questions or a partial/qualified heading reference.
  const heading = /^what is (?:#{1,6}\s*)?\d+(?:\.\d+)+\.?\s+(?:customer|guest) (check in|check out)$/.exec(text);
  return heading?.[1] as ProcedureTask | undefined;
}

export function selectProcedureSeed(message: string, sources: ReadonlyArray<{ chunk_id: string; heading_path: string; content: string }>): string | undefined {
  const task = standaloneProcedureTask(message);
  if (!task) return undefined;
  const requestedSection = /^what is (?:#{1,6}\s*)?(\d+(?:\.\d+)+)\.?\s+/i.exec(assistantRetrievalQuery(message))?.[1];
  let matchingHeadings = 0;
  const eligible = sources.filter(source => {
    const leaf = source.heading_path.split(' / ').at(-1) ?? '';
    if (requestedSection && /^#{0,6}\s*(\d+(?:\.\d+)+)\.?\s+/.exec(leaf)?.[1] !== requestedSection) return false;
    const heading = assistantRetrievalQuery(leaf.replace(/\\([.\-])/g, '$1')).toLowerCase()
      .replace(/^#{1,6}\s*/, '').replace(/^\d+(?:\.\d+)*\.?\s*/, '');
    if (!new RegExp(`^(?:(?:customer|guest) ${task}|${task} (?:customer|guest))(?: procedure)?$`).test(heading)) return false;
    matchingHeadings++;
    // A matching title alone is insufficient: actual numbered procedure text
    // must independently mention both the action and its customer subject.
    const steps = [...source.content.matchAll(/^\s*(\d+)\\?[.)]\s+/gm)];
    if (steps.length < 2 || steps.some((step, index) => Number(step[1]) !== index + 1) || /```|~~~/.test(source.content)) return false;
    const body = assistantRetrievalQuery(source.content.slice(steps[0].index)).toLowerCase();
    return new RegExp(`\\b${task}\\b`).test(body) && /\b(?:customer|guest)\b/.test(body);
  });
  // Duplicate headings/competing procedures remain a model/clarification case.
  return eligible.length === 1 && matchingHeadings === 1 ? eligible[0].chunk_id : undefined;
}
