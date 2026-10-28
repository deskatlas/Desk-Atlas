import type { AssistantLanguage } from './assistantLanguage';
import { standaloneProcedureTask } from './assistantRetrieval';
import { sopGovernanceIntent } from './assistantGovernance';
import { assistantToolSchema, type AssistantFilters, type AssistantTool, type AssistantTable, type AssistantPlan } from '@deskatlas/validation';

// SPEC-4: SDD-C22, QAD-TC44. Date and tool policies are independent of the model.
export class AssistantError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
export interface AssistantActor { id: string; role: 'STAFF' | 'ADMIN' }
export interface AssistantPeriod { start: string; end: string; label: string }
export interface AssistantToolResult { tables: AssistantTable[]; limitations: string[]; interpretation: string[] }
export interface AssistantRepository {
  execute(actor: AssistantActor, tool: AssistantTool, period: AssistantPeriod, asOf: string): Promise<AssistantToolResult>;
}
// MS53-TC02/03: normalize task spelling only, preserving names, dates and negation.
// This is a bounded search aid, never evidence or an authorization decision.
// MS44-TC04/05: an exact grammar deliberately favors planner fallback over recall.
// This selects retrieval only. It never answers a procedure or grants permissions.
export function proceduralDocumentPlan(message: string, context?: { user_turns?: string[]; selections?: unknown }): AssistantPlan | undefined {
  if (context?.selections) return undefined;
  const task = standaloneProcedureTask(message) || sopGovernanceIntent(message);
  if (context?.user_turns?.length && !task) return undefined;
  if (task) return { kind: 'DOCUMENT', query: message.trim(), tools: [] };
  const text = message.normalize('NFKC').trim().toLowerCase().replace(/[?]$/, '').replace(/\s+/g, ' ');
  // These standalone task questions avoid a planner round trip. Near misses,
  // mixed requests, execution requests and follow-ups still use the planner.
  if (/^(?:what should i do when (?:a |the )?(?:customer|guest) leaves|steps to finish (?:a |the )?(?:customer|guest)'s workspace session|(?:customer|guest) is leaving,? paano ang check[ -]?out|paano mag-check[ -]?out ng (?:customer|guest))$/.test(text)) return { kind: 'DOCUMENT', query: message.trim(), tools: [] };
  if (/^who is responsible for (?:reviewing and updating|reviewing|updating) the sop$/.test(text)) return { kind: 'DOCUMENT', query: message.trim(), tools: [] };
  if (/^(?:according to the sop,? )?what is the check-(?:in|out) procedure$/.test(text)) return { kind: 'DOCUMENT', query: message.trim(), tools: [] };
  const prefix = '(?:how do i|how do staff|how can i|how to|what is the procedure to|paano|paano ko|paano mag|paano i)';
  const action = '(?:check[ -]?(?:in|out) (?:a |the )?(?:guest|customer)|check-in ng guest|check-out ng guest|mag-check in ng guest|mag-check out ng guest|scan a booking qr|scan ang booking qr|verify a reference code|verify ang reference code|review an online payment proof|review ang online payment proof)';
  if (!new RegExp(`^${prefix} ${action}$`).test(text)) return undefined;
  return { kind: 'DOCUMENT', query: message.trim(), tools: [] };
}
// PRD-F26 / QAD-TC44: guidance is read-only retrieval, never a tool grant.
export function guidanceDocumentPlan(message: string): AssistantPlan | undefined {
  const text = message.normalize('NFKC').trim().toLowerCase();
  if (/^(?:how|what|paano)\b/.test(text) && /\b(?:it|that|them|they|ito|iyon|sila|siya)\b/.test(text)) return undefined;
  if (/\b(show|count|report|revenue|earnings|how many|how much|ilang|ilan|magkano)\b|\d/.test(text)) return undefined;
  if (!/\b(?:how (?:do|should|can|would) (?:i|we)|what should (?:i|we)|paano (?:ko|kami|namin|natin)|i['’]m new)\b/.test(text)) return undefined;
  return { kind: 'DOCUMENT', query: message.trim(), tools: [] };
}

export function currentOperationalPlan(message: string): AssistantPlan | undefined {
  const text = message.normalize('NFKC').toLowerCase();
  // MS44-TC04: the existing snapshot shortcut must also defer mixed intent.
  if (/[;\n]|\b(and|also|then|how|procedure|policy|sop|paano|at|saka|report|ulat)\b/.test(text.replace(/how many/g, 'count'))) return undefined;
  if (/history|yesterday|last|previous|noong|kahapon|nakaraan|revenue|payment|kita|magkano|compare|comparison|floor|desk|template|\d/.test(text)) return undefined;
  if (!/how many|count|number of|\bilang\b|\bilan\b/.test(text) || !/bookings?|reservations?|reserbasyon|check[ -]?ins?|checked[ -]?in/.test(text) || !/today|ngayong araw|ngayon|right now|currently/.test(text)) return undefined;
  return { kind: 'OPERATIONAL', query: '', tools: [assistantToolSchema.parse({ name: 'operational_snapshot', args: {} })] };
}

// QAD-TC44: previous user intent qualifies references, never a new named task.
export function assistantContextualQuestion(message: string, previous?: string): string {
  if (!previous || !/^(?:and\s+(?:if|before|after|what)|(?:what|how)\s+(?:about|if)\s+(?:they|it|that)|(?:they|he|she|it)\s+(?:ignored|still|just|keep|keeps|won.t|didn.t)|(?:now|then)\s+what\b|can you remind)/i.test(message.trim())) return message;
  const contextual = `${message}\nPrevious user question (intent only): ${previous}`;
  return contextual.length <= 3000 ? contextual : message;
}
export function businessDate(asOf: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf));
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
function validDate(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
// Find local midnight through offsets, including DST. Reject a skipped calendar date.
export function localMidnight(date: string, timezone: string): string {
  if (!validDate(date)) throw new AssistantError('CLARIFICATION_REQUIRED', 'Use a valid calendar date.');
  const base = Date.parse(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let utc = base;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(p => [p.type, p.value]));
    const projected = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const diff = base - projected;
    if (diff === 0) return new Date(utc).toISOString();
    utc += diff;
  }
  throw new AssistantError('CLARIFICATION_REQUIRED', 'This local calendar boundary does not exist. Specify an explicit interval.');
}
function localClock(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
}
function localTimestamp(date: string, clock: string, timezone: string): string {
  const target = Date.parse(`${date}T${clock}Z`);
  let result = target;
  for (let i = 0; i < 4; i++) {
    const value = new Date(result).toISOString();
    const projected = Date.parse(`${businessDate(value, timezone)}T${localClock(value, timezone)}Z`);
    if (projected === target) return value;
    result += target - projected;
  }
  throw new AssistantError('CLARIFICATION_REQUIRED', 'Comparison falls on a missing local time. Specify explicit periods.');
}
function calendarShift(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const next = new Date(d); next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(0);
  d.setUTCDate(Math.min(day, next.getUTCDate())); return d.toISOString().slice(0, 10);
}
export function assistantComparison(filters: AssistantFilters, period: AssistantPeriod, timezone: string, asOf: string): { current: AssistantPeriod; previous: AssistantPeriod } {
  const partial = !filters.start_date && filters.period !== 'yesterday';
  const current = { ...period, end: partial && period.end > asOf ? asOf : period.end };
  const startDate = businessDate(current.start, timezone), endDate = businessDate(current.end, timezone);
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000);
  const mode = filters.compare === 'previous_period' && filters.period === 'this_month' ? 'previous_month' : filters.compare === 'previous_period' && filters.period === 'this_year' ? 'previous_year' : filters.compare;
  let previousStart: string, previousEnd: string;
  if (mode === 'previous_month' || mode === 'previous_year') {
    const months = mode === 'previous_year' ? -12 : -1;
    const shiftedStart = calendarShift(startDate, months);
    previousStart = localTimestamp(shiftedStart, localClock(current.start, timezone), timezone);
    previousEnd = partial ? localTimestamp(shiftDate(shiftedStart, days), localClock(current.end, timezone), timezone) : localTimestamp(calendarShift(endDate, months), localClock(current.end, timezone), timezone);
    if (partial && ['this_month','this_year'].includes(filters.period ?? '') && previousEnd > current.start) previousEnd = current.start;
  } else {
    const fullDays = Math.max(1, Math.round((Date.parse(businessDate(period.end, timezone)) - Date.parse(startDate)) / 86400000));
    previousStart = localTimestamp(shiftDate(startDate, -fullDays), localClock(current.start, timezone), timezone);
    previousEnd = localTimestamp(shiftDate(endDate, -fullDays), localClock(current.end, timezone), timezone);
  }
  return { current: { ...current, label: `[${current.start}, ${current.end}) in ${timezone}` }, previous: { start: previousStart, end: previousEnd, label: `[${previousStart}, ${previousEnd}) in ${timezone}` } };
}
export function resolveAssistantPeriod(filters: AssistantFilters, timezone: string, asOf: string): AssistantPeriod {
  const today = businessDate(asOf, timezone);
  let start = today, end = shiftDate(today, 1), elapsed = false;
  if (filters.start_date || filters.end_date) {
    if (!filters.start_date || !filters.end_date || !validDate(filters.end_date)) throw new AssistantError('CLARIFICATION_REQUIRED', 'Supply both valid start and inclusive end dates.');
    start = filters.start_date; end = shiftDate(filters.end_date, 1);
  } else {
    switch (filters.period ?? 'today') {
      case 'yesterday': start = shiftDate(today, -1); end = today; break;
      case 'last7': start = shiftDate(today, -6); break;
      case 'last30': start = shiftDate(today, -29); break;
      case 'this_month': start = `${today.slice(0, 7)}-01`; elapsed = true; break;
      case 'this_year': start = `${today.slice(0, 4)}-01-01`; elapsed = true; break;
    }
  }
  if (start >= end) throw new AssistantError('CLARIFICATION_REQUIRED', 'End date must follow start date.');
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 366) throw new AssistantError('UNSUPPORTED_REPORT', 'Request at most 366 calendar days, or split the report into smaller periods.');
  const startUtc = localMidnight(start, timezone), endUtc = elapsed ? asOf : localMidnight(end, timezone);
  return { start: startUtc, end: endUtc, label: `[${startUtc}, ${endUtc}) in ${timezone}` };
}
export function authorizeAssistantTool(actor: AssistantActor, input: unknown): AssistantTool {
  const parsed = assistantToolSchema.safeParse(input);
  if (!parsed.success) throw new AssistantError('UNSUPPORTED_REPORT', 'Unsupported tool or filters.');
  const tool = parsed.data;
  if (actor.role !== 'ADMIN' && !['operational_snapshot', 'workspace_availability'].includes(tool.name)) throw new AssistantError('FORBIDDEN', 'Historical and financial reports require administrator access.', 403);
  const args = tool.args;
  if (args.period && (args.start_date || args.end_date)) throw new AssistantError('CLARIFICATION_REQUIRED', 'Choose a named period or explicit dates.');
  // SPEC-4 / QAD-TC44: an explicit current-day period is equivalent to this
  // tool's fixed business day. Other periods and filters still fail closed.
  if (tool.name === 'operational_snapshot' && args.period === 'today') delete args.period;
  if (tool.name === 'operational_snapshot' && Object.keys(args).some(k => !['floor_id', 'basis', 'grouping'].includes(k))) throw new AssistantError('UNSUPPORTED_REPORT', 'Operational snapshot supports only the current business day and optional floor.');
  if (tool.name === 'workspace_availability') {
    if (!args.start_at || !args.end_at || Date.parse(args.start_at) >= Date.parse(args.end_at)) throw new AssistantError('CLARIFICATION_REQUIRED', 'Specify an availability start and end time.');
    if (Date.parse(args.end_at) - Date.parse(args.start_at) > 366 * 86400000) throw new AssistantError('UNSUPPORTED_REPORT', 'Availability queries support at most 366 days.');
    if (Object.keys(args).some(k => !['start_at', 'end_at', 'floor_id', 'template_id', 'desk_id', 'basis', 'grouping'].includes(k))) throw new AssistantError('UNSUPPORTED_REPORT', 'Unsupported availability filters.');
  } else if (args.start_at || args.end_at) throw new AssistantError('UNSUPPORTED_REPORT', 'Reports use local calendar dates.');
  if (args.method_id && tool.name !== 'payment_report') throw new AssistantError('UNSUPPORTED_REPORT', 'Payment method applies only to payment reports.');
  if (args.metric && !['workspace_usage_report', 'operational_report'].includes(tool.name)) throw new AssistantError('UNSUPPORTED_REPORT', 'This tool does not support a metric filter.');
  if (args.statuses && !['booking_report', 'operational_report'].includes(tool.name)) throw new AssistantError('UNSUPPORTED_REPORT', 'This tool does not support status filtering.');
  if (tool.name === 'workspace_usage_report' && !['booking_count', 'booked_hours', 'booked_occupancy', 'actual_usage'].includes(args.metric ?? 'booking_count')) throw new AssistantError('UNSUPPORTED_REPORT', 'Unsupported workspace metric.');
  if (tool.name === 'operational_report' && !['status_cohorts', 'review_backlog', 'cancellation_events'].includes(args.metric ?? 'status_cohorts')) throw new AssistantError('UNSUPPORTED_REPORT', 'Unsupported operational metric.');
  return tool;
}
export async function executeAssistantTool(repository: AssistantRepository, actor: AssistantActor, input: unknown, timezone: string, asOf: string): Promise<AssistantToolResult> {
  const tool = authorizeAssistantTool(actor, input);
  if (tool.name === 'workspace_availability' && Date.parse(tool.args.start_at!) < Date.parse(asOf)) throw new AssistantError('UNSUPPORTED_HISTORY', 'Historical availability cannot be reconstructed. Specify a current or future interval.');
  if (tool.args.metric && ['booked_hours', 'booked_occupancy', 'actual_usage', 'cancellation_events'].includes(tool.args.metric)) throw new AssistantError('UNSUPPORTED_HISTORY', 'Reliable historical allocation, operating availability, attendance, or event coverage is unavailable. This metric is N/A.');
  const period = resolveAssistantPeriod(tool.args, timezone, asOf);
  if (tool.name === 'payment_report' && period.start > asOf) throw new AssistantError('UNSUPPORTED_REPORT', 'Received payments cannot be predicted.');
  if (!tool.args.compare) return repository.execute(actor, tool, period, asOf);
  if (!['booking_report','payment_report','workspace_usage_report','operational_report'].includes(tool.name) || tool.args.metric === 'review_backlog') throw new AssistantError('UNSUPPORTED_REPORT', 'Comparison requires a historical aggregate metric.');
  const ranges = assistantComparison(tool.args, period, timezone, asOf);
  const { compare: _compare, ...args } = tool.args;
  const current = await repository.execute(actor, { ...tool, args }, ranges.current, asOf);
  const previous = await repository.execute(actor, { ...tool, args }, ranges.previous, asOf);
  const comparisons: AssistantTable[] = [];
  if (tool.name !== 'payment_report') {
    const index = tool.name === 'workspace_usage_report' ? 2 : 3;
    const count = (result: AssistantToolResult) => result.tables[0]?.rows.reduce((sum, row) => sum + (typeof row[index] === 'number' ? row[index] : 0), 0) ?? 0;
    const a = count(current), b = count(previous), relative = percentChange(a, b);
    comparisons.push({ title: 'Aggregate count comparison', columns: ['Current','Previous','Absolute change','Relative change'], rows: [[a,b,a-b,relative === null ? 'N/A' : `${relative.toFixed(2)}%`]] });
  } else {
    const totals = (result: AssistantToolResult) => {
      const money = new Map<string,bigint>();
      for (const row of result.tables[0]?.rows ?? []) {
        if (typeof row[1] !== 'string' || typeof row[2] !== 'string' || !/^\d+\.\d{2}$/.test(row[2])) throw new AssistantError('DATA_UNAVAILABLE', 'Invalid monetary aggregate.', 503);
        money.set(row[1], (money.get(row[1]) ?? BigInt(0)) + BigInt(row[2].replace('.', '')));
      }
      return money;
    };
    const a = totals(current), b = totals(previous);
    const decimal = (cents: bigint) => `${cents < BigInt(0) ? '-' : ''}${(cents < BigInt(0) ? -cents : cents) / BigInt(100)}.${String((cents < BigInt(0) ? -cents : cents) % BigInt(100)).padStart(2,'0')}`;
    comparisons.push({ title: 'Verified initial payment comparison', columns: ['Currency','Current','Previous','Absolute change','Relative change'], rows: [...new Set([...a.keys(),...b.keys()])].sort().map(currency => {
      const x=a.get(currency) ?? BigInt(0), y=b.get(currency) ?? BigInt(0);
      return [currency,decimal(x),decimal(y),decimal(x-y),y > BigInt(0) ? `${Number((x-y)*BigInt(10000)/y)/100}%` : 'N/A'];
    }) });
  }
  return { tables: [...current.tables.map(t => ({ ...t, title: `Current: ${t.title}` })), ...previous.tables.map(t => ({ ...t, title: `Previous: ${t.title}` })), ...comparisons], interpretation: [`Current: ${ranges.current.label}`,`Previous: ${ranges.previous.label}`,partialComparisonLabel(tool.args), ...current.interpretation], limitations: [...new Set([...current.limitations,...previous.limitations,'Each compared period uses a separate database snapshot; as_of is shared.'])] };
}
function partialComparisonLabel(filters: AssistantFilters): string { return filters.start_date ? 'Explicit full calendar periods compared.' : 'Incomplete current period compared with the same elapsed portion of the prior period.'; }
export function percentChange(current: number, previous: number): number | null { return previous > 0 ? (current - previous) / previous * 100 : null; }
export function assistantToolNarrative(name: AssistantTool['name'], result: AssistantToolResult, language: AssistantLanguage = 'en'): string {
  const table = result.tables[0];
  if (!table) return '';
  const sum = (index: number) => table.rows.reduce((total,row) => total + (typeof row[index] === 'number' ? row[index] : 0),0);
  if (name === 'operational_snapshot' && table.rows.length) return table.columns.map((label,index) => `${label}: ${table.rows[0][index] ?? 'N/A'}`).join('; ') + '.';
  if (language !== 'en') return localizedNarrative(name, result, language);
  if (name === 'booking_report' || name === 'operational_report' && table.columns.length === 4) return `${sum(3)} reservation requests in the selected current-status cohort. The table breaks down the period, status and source.`;
  if (name === 'workspace_usage_report') return `${sum(2)} qualifying bookings attributed to current candidates across ${table.rows.length} desks. Historical desk hours and occupancy remain unavailable.`;
  if (name === 'workspace_availability') return `${table.rows.filter(row=>row[2]==='AVAILABLE').length} of ${table.rows.length} desks are available for the specified interval. This creates no inventory hold.`;
  if (name === 'payment_report') return `${paymentNarrativeAmounts(table)} in verified initial booking payments across ${sum(3)} approved records. Extension receipts and net revenue are excluded.`;
  return `${table.title}. See the verified table for counts and coverage.`;
}
function paymentNarrativeAmounts(table: AssistantTable): string {
  const amounts = new Map<string, bigint>();
  for (const row of table.rows) {
    if (typeof row[1] !== 'string' || typeof row[2] !== 'string' || !/^\d+\.\d{2}$/.test(row[2])) throw new AssistantError('DATA_UNAVAILABLE', 'Invalid monetary result.', 503);
    amounts.set(row[1], (amounts.get(row[1]) ?? BigInt(0)) + BigInt(row[2].replace('.', '')));
  }
  return [...amounts].map(([currency, cents]) => `${currency} ${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, '0')}`).join(', ');
}
function localizedNarrative(name: AssistantTool['name'], result: AssistantToolResult, language: AssistantLanguage): string {
  const table = result.tables[0];
  if (!table) return '';
  const sum = (index: number) => table.rows.reduce((total, row) => total + (typeof row[index] === 'number' ? row[index] : 0), 0);
  const tl = language === 'tl';
  if (name === 'booking_report' || name === 'operational_report' && table.columns.length === 4) return tl
    ? `${sum(3)} kahilingan sa reserbasyon sa napiling pangkat ng kasalukuyang status. Nasa talahanayan ang panahon, status at source.`
    : `${sum(3)} reservation requests sa selected current-status cohort. Nasa table ang period, status at source.`;
  if (name === 'workspace_usage_report') return tl
    ? `${sum(2)} kuwalipikadong booking sa kasalukuyang mga candidate para sa ${table.rows.length} desk. Hindi pa makukuha ang historical desk hours at occupancy.`
    : `${sum(2)} qualifying bookings sa current candidates para sa ${table.rows.length} desks. Unavailable pa ang historical desk hours at occupancy.`;
  if (name === 'workspace_availability') {
    const available = table.rows.filter(row => row[2] === 'AVAILABLE').length;
    return tl ? `${available} sa ${table.rows.length} desk ang available sa tinukoy na pagitan. Hindi nito hinahawakan ang imbentaryo.`
      : `${available} of ${table.rows.length} desks ang available sa specified interval. Walang inventory hold.`;
  }
  if (name === 'payment_report') {
    const amounts = paymentNarrativeAmounts(table);
    return tl ? `${amounts} sa beripikadong paunang bayad ng booking mula sa ${sum(3)} aprubadong rekord. Hindi kasama ang extension receipts at net revenue.`
      : `${amounts} sa verified initial booking payments mula sa ${sum(3)} approved records. Excluded ang extension receipts at net revenue.`;
  }
  return tl ? `${table.title}. Tingnan ang beripikadong talahanayan para sa bilang at saklaw.`
    : `${table.title}. Tingnan ang verified table para sa counts at coverage.`;
}
export function unionMilliseconds(intervals: ReadonlyArray<readonly [number, number]>, start: number, end: number): number {
  const sorted = intervals.map(([a, b]) => [Math.max(a, start), Math.min(b, end)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, cursor = start;
  for (const [a, b] of sorted) { total += Math.max(0, b - Math.max(a, cursor)); cursor = Math.max(cursor, b); }
  return total;
}
