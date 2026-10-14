// MS-44 / SDD-C20: request-local, content-free monotonic timings. No logging or storage.
const stages = ['validate', 'auth', 'settings', 'catalog', 'plan', 'embed', 'retrieve', 'tools', 'answer', 'evidence', 'serialize'] as const;
type Stage = typeof stages[number];
export class AssistantTiming {
  private readonly start = performance.now();
  private readonly spans = new Map<string, number>();
  private upstreamComplete = true;
  private readonly tokens: Record<string, number> = {};
  async measure<T>(stage: Stage, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await work(); }
    finally { this.add(stage, performance.now() - start); }
  }
  private add(name: string, value: number): void {
    if (Number.isFinite(value) && value >= 0) this.spans.set(name, (this.spans.get(name) ?? 0) + value);
  }
  upstream(stage: 'plan' | 'embed' | 'answer', header: string | null, input?: string | null, output?: string | null): void {
    // Never reflect arbitrary service headers or descriptions into a response.
    let queueFound = false;
    for (const part of (header ?? '').slice(0, 4000).split(',')) {
      const match = /^\s*(queue|verify|inference|schema|total|residual|load|prompt|generation);dur=(\d+(?:\.\d+)?)\s*$/.exec(part);
      if (match) { this.add(`python_${stage}_${match[1]}`, Number(match[2])); if (match[1] === 'queue') queueFound = true; }
    }
    this.upstreamComplete &&= queueFound;
    for (const [key, value] of [['input', input], ['output', output]] as const) {
      if (value && /^\d{1,8}$/.test(value) && Number(value) <= 10000000) this.tokens[`${stage}_${key}`] = (this.tokens[`${stage}_${key}`] ?? 0) + Number(value);
    }
  }
  finish(response: Response, requestId: string): Response {
    const total = performance.now() - this.start;
    const exclusive = stages.reduce((sum, stage) => sum + (this.spans.get(stage) ?? 0), 0);
    const spans = [...this.spans, ['residual', Math.max(0, total - exclusive)] as const, ['total', total] as const];
    response.headers.set('Server-Timing', spans.map(([name, value]) => `${name};dur=${value.toFixed(3)}`).join(', '));
    if (/^[a-f0-9-]{36}$/i.test(requestId)) response.headers.set('X-Request-ID', requestId);
    if (this.upstreamComplete) response.headers.set('X-RAG-Queue-Ms', ['plan', 'embed', 'answer'].reduce((sum, stage) => sum + (this.spans.get(`python_${stage}_queue`) ?? 0), 0).toFixed(3));
    if (Object.keys(this.tokens).length) response.headers.set('X-RAG-Token-Counts', JSON.stringify(this.tokens));
    return response;
  }
}
