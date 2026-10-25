// MS82-TC02/03/04/08; PRD-F4/F6/F9/F13; QAD-TC7/10/14/23/35.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReservationSupabaseRepository } from '@deskatlas/domain';
import { SupabaseAvailabilityRepository } from '../packages/domain/src/services/availabilitySupabaseRepository';
import { databaseRequest, DATABASE_REQUEST_TIMEOUT_MS } from '../packages/domain/src/services/databaseRequest';
import { createServer } from 'node:http';
import { once } from 'node:events';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const repo = (fetcher: typeof fetch) => new ReservationSupabaseRepository({
  supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'synthetic', fetcher,
});
const consume = (response: Response) => response.text();

describe('MS82 bounded database interruption', () => {
  it('TC02: real loopback connection loss fails honestly and a fresh read recovers', async () => {
    let calls = 0;
    const server = createServer((request, response) => {
      calls++;
      if (calls === 1) { request.socket.destroy(); return; }
      response.end('[]');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing loopback port');
      const repository = new ReservationSupabaseRepository({
        supabaseUrl: `http://127.0.0.1:${address.port}`, serviceRoleKey: 'synthetic',
      });
      await expect(repository.findCandidatesByReservationId('synthetic')).rejects.toMatchObject({ kind: 'unavailable' });
      expect(calls).toBe(1);
      expect(await repository.findCandidatesByReservationId('synthetic')).toEqual([]);
      expect(calls).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('TC02/08: a lost response body produces a sanitized unavailable error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError('private body diagnostic')); },
    })));
    const failure = await repo(fetcher).findCandidatesByReservationId('synthetic').catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'unavailable', outcomeUnknown: false });
    expect(String(failure)).not.toContain('private');
  });

  it.each(['57P01', '57P03', '08006', '08P01'])('TC02/03: %s fails once and the next read recovers', async code => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code, message: 'private payload' }), { status: 503 }))
      .mockResolvedValueOnce(new Response('[]'));
    const repository = repo(fetcher);
    await expect(repository.findCandidatesByReservationId('synthetic')).rejects.toMatchObject({
      kind: 'unavailable', code, outcomeUnknown: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await repository.findCandidatesByReservationId('synthetic')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ cache: 'no-store' });
  });

  it.each(['42703', '42702', '57014'])('TC03/05: %s remains an error without replay', async code => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code }), { status: 400 }));
    await expect(repo(fetcher).findCandidatesByReservationId('synthetic')).rejects.toThrow(code);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('TC02: reservation transport and body are bounded by the same 10-second budget', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream()));
    const pending = repo(fetcher).findCandidatesByReservationId('synthetic');
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'deadline', outcomeUnknown: false });
    await vi.advanceTimersByTimeAsync(DATABASE_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('TC02: availability reads without a caller signal still have a deadline', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const repository = new SupabaseAvailabilityRepository({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'synthetic' });
    const pending = repository.listScheduleBlocks('desk', '2026-10-25T00:00:00Z', '2026-10-26T00:00:00Z');
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'deadline' });
    await vi.advanceTimersByTimeAsync(DATABASE_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['57P03', '42703', '57014'])('TC03: settings failure %s cannot trigger a second query', async code => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ code }), { status: code === '57P03' ? 503 : 400 }));
    vi.stubGlobal('fetch', fetcher);
    const repository = new SupabaseAvailabilityRepository({ supabaseUrl: 'https://ms82-settings.invalid', serviceRoleKey: 'synthetic' });
    await expect(repository.getBusinessSettings()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('TC02: failed schedule-block read cannot become successful empty occupancy', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input =>
      String(input).includes('/schedule_blocks')
        ? new Response('{"code":"57P03"}', { status: 503 }) : new Response('[]'));
    vi.stubGlobal('fetch', fetcher);
    const repository = new SupabaseAvailabilityRepository({ supabaseUrl: 'https://ms82-occupancy.invalid', serviceRoleKey: 'synthetic' });
    await expect(repository.listOccupiedInstanceDetails('2026-10-25T00:00:00Z', '2026-10-26T00:00:00Z'))
      .rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('TC03: pre-cancellation prevents dispatch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(databaseRequest(fetcher, 'https://fixture.invalid', { signal: AbortSignal.abort() }, consume))
      .rejects.toMatchObject({ kind: 'cancelled', outcomeUnknown: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('TC03/05: an earlier caller deadline retains deadline attribution', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = databaseRequest(fetcher, 'https://fixture.invalid', { signal: controller.signal }, consume);
    controller.abort(new DOMException('synthetic deadline', 'TimeoutError'));
    await expect(pending).rejects.toMatchObject({ kind: 'deadline', outcomeUnknown: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('TC03: deliberate cancellation wins over a hanging fetch without retries', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = databaseRequest(fetcher, 'https://fixture.invalid', { signal: controller.signal }, consume);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', outcomeUnknown: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('TC04/08: payment committed before response loss is never replayed or reported successful', async () => {
    let commits = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      commits++;
      throw new TypeError('private credential and guest payload');
    });
    const error = await repo(fetcher).approvePaymentAndAllocate({
      paymentAttemptId: 'synthetic', actorUserId: 'actor', processedAt: '2026-10-25T00:00:00Z',
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ kind: 'unavailable', outcomeUnknown: true });
    expect(String(error)).not.toContain('private');
    expect(String(error)).toContain('Verify the operation status');
    expect(commits).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('TC04: a payment deadline retains its unknown outcome without a second dispatch', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = repo(fetcher).approvePaymentAndAllocate({
      paymentAttemptId: 'synthetic', actorUserId: 'actor', processedAt: '2026-10-25T00:00:00Z',
    });
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'deadline', outcomeUnknown: true });
    await vi.advanceTimersByTimeAsync(DATABASE_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('TC02: successful reads clean up their timer and keep normal response contracts', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('[]'));
    const repository = repo(fetcher);
    for (let index = 0; index < 20; index++) {
      expect(await repository.findCandidatesByReservationId('synthetic')).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(fetcher).toHaveBeenCalledTimes(20);
  });

  it.each([502, 503, 504])('TC08: gateway %s cannot leak its response body', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private gateway payload', { status }));
    const failure = await repo(fetcher).findCandidatesByReservationId('synthetic').catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'unavailable' });
    expect(String(failure)).not.toContain('private');
  });
});
