// MS82-R03 / SDD-C2/C5/C12: one attempt, bounded transport and body consumption.
export const DATABASE_REQUEST_TIMEOUT_MS = 10_000;

export class DatabaseInterruptionError extends Error {
  constructor(
    public readonly kind: 'unavailable' | 'deadline' | 'cancelled',
    public readonly outcomeUnknown: boolean,
    public readonly code?: string,
  ) {
    super(outcomeUnknown
      ? 'Database request interrupted. Verify the operation status before trying again.'
      : 'Database request unavailable. Please try again.');
    this.name = 'DatabaseInterruptionError';
  }
}

// No retries, including GET: the next caller-owned poll/read performs recovery.
// POST RPCs are conservatively treated as mutations even when some only read.
export async function databaseRequest<T>(
  fetcher: typeof fetch,
  url: string,
  options: RequestInit,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const mutation = !['GET', 'HEAD'].includes((options.method ?? 'GET').toUpperCase());
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let started = false;
  let onAbort: () => void = () => {};
  const interrupted = () => {
    const reason: unknown = options.signal?.reason;
    const callerDeadline = reason instanceof Error && reason.name === 'TimeoutError';
    return new DatabaseInterruptionError(
      options.signal?.aborted && !callerDeadline ? 'cancelled' : 'deadline', mutation && started,
    );
  };
  const timer = setTimeout(() => controller.abort(), DATABASE_REQUEST_TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(interrupted());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, (async () => {
      if (signal.aborted) throw interrupted();
      started = true;
      let response: Response;
      try {
        response = await fetcher(url, { ...options, signal });
      } catch {
        if (signal.aborted) throw interrupted();
        // Do not retain fetch error causes: they can contain URLs and credentials.
        throw new DatabaseInterruptionError('unavailable', mutation);
      }
      if (signal.aborted) throw interrupted();
      if (!response.ok) {
        const detail = await response.clone().text();
        let code: string | undefined;
        try {
          const payload: unknown = JSON.parse(detail);
          if (payload && typeof payload === 'object' && 'code' in payload &&
              typeof payload.code === 'string' && /^[0-9A-Z]{5}$/.test(payload.code)) code = payload.code;
        } catch { /* Non-JSON gateway responses contain no SQLSTATE. */ }
        if (code === '57P01' || code === '57P03' || code?.startsWith('08') ||
            [502, 503, 504].includes(response.status)) {
          throw new DatabaseInterruptionError('unavailable', mutation, code);
        }
      }
      if (signal.aborted) throw interrupted();
      return consume(response);
    })()]);
  } catch (error) {
    if (signal.aborted) throw interrupted();
    if (error instanceof TypeError) throw new DatabaseInterruptionError('unavailable', mutation && started);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
