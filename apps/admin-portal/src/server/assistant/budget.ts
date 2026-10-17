import { AssistantError } from '@deskatlas/domain';

// MS46-TC15/16 / SDD-C20: one monotonic budget from handler arrival.
export class RequestBudget {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly deadline: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly disconnect: () => void;

  constructor(private readonly incoming: AbortSignal, milliseconds: number, arrived = performance.now()) {
    this.deadline = arrived + milliseconds;
    this.disconnect = () => this.controller.abort(new Error('cancelled'));
    incoming.addEventListener('abort', this.disconnect, { once: true });
    if (incoming.aborted) this.disconnect();
    this.timer = setTimeout(() => this.controller.abort(new Error('deadline')), this.remaining());
  }

  remaining(): number { return Math.max(0, Math.floor(this.deadline - performance.now())); }

  check(): void {
    if (!this.remaining() && !this.signal.aborted) this.controller.abort(new Error('deadline'));
    if (this.signal.aborted) throw this.failure();
  }

  failure(): AssistantError {
    return new AssistantError(this.signal.reason instanceof Error && this.signal.reason.message === 'deadline'
      ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED', 'Request ended. Retry if needed.', 408);
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    let abort: () => void = () => undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(this.failure());
      this.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const value = await Promise.race([operation(), cancelled]);
      this.check();
      return value;
    } finally { this.signal.removeEventListener('abort', abort); }
  }

  close(): void {
    clearTimeout(this.timer);
    this.incoming.removeEventListener('abort', this.disconnect);
  }
}
