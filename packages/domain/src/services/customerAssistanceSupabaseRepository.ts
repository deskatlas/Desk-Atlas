// MS78-R02, ERD-E10/E22: server-scoped ownership is enforced inside the read RPC.
import { customerAssistanceSnapshotSchema, customerReservationCursorSchema } from '@deskatlas/validation';
import type { CustomerAssistanceRepository, CustomerReservationChoice } from './customerAssistanceService';

export class CustomerAssistanceSupabaseRepository implements CustomerAssistanceRepository {
  constructor(private readonly config: { supabaseUrl: string; serviceRoleKey: string; fetcher?: typeof fetch; signal?: AbortSignal }) {}
  private async query(customerId: string, id: string | null, filter: 'UPCOMING' | 'HISTORY', cursor?: string) {
    const decoded = cursor ? customerReservationCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))) : null;
    const response = await (this.config.fetcher ?? fetch)(`${this.config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/customer_assistance_owned_bookings`, {
      method: 'POST', cache: 'no-store',
      signal: this.config.signal ? AbortSignal.any([this.config.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { apikey: this.config.serviceRoleKey, Authorization: `Bearer ${this.config.serviceRoleKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_customer_id: customerId, p_reservation_id: id, p_history: filter === 'HISTORY',
        p_cursor_start: decoded?.start_at ?? null, p_cursor_id: decoded?.id ?? null }),
    });
    if (!response.ok) throw new Error('Customer booking context is unavailable');
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length > 11) throw new Error('Invalid booking projection');
    return rows.map((row: unknown) => {
      if (!row || typeof row !== 'object' || !('snapshot' in row) || !('sort_start' in row)) throw new Error('Invalid booking projection');
      const snapshot = customerAssistanceSnapshotSchema.parse(row.snapshot);
      const key = customerReservationCursorSchema.parse({ start_at: row.sort_start, id: snapshot.id });
      return { snapshot, key };
    });
  }
  async list(customerId: string, filter: 'UPCOMING' | 'HISTORY', cursor?: string) {
    const rows = await this.query(customerId, null, filter, cursor);
    const page = rows.slice(0, 10);
    const items: CustomerReservationChoice[] = page.map(({ snapshot: s }) => ({
      id: s.id, reference: s.reference, status: s.status, start_at: s.start_at, end_at: s.end_at, workspace: s.workspace,
    }));
    return { items, next_cursor: rows.length > 10 ? Buffer.from(JSON.stringify(page[page.length - 1].key)).toString('base64url') : null };
  }
  async read(customerId: string, reservationId: string) {
    return (await this.query(customerId, reservationId, 'HISTORY'))[0]?.snapshot ?? null;
  }
}
