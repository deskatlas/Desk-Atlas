// MS83-R01/R05: framework-free typed command boundary. SQL rechecks all facts.
import { paidRecoveryCommandSchema, paidRecoveryReadSchema, type PaidRecoveryCommand, type PaidRecoveryIdentity } from '@deskatlas/validation';

export interface PaidRecoveryContext {
  reservationId: string;
  status: string;
  episodeId: string;
  templateId: string | null;
  templateName: string | null;
  startAt: string | null;
  endAt: string | null;
  eligible: boolean;
  refundPending: boolean;
  remedy: 'RESCHEDULE' | 'REPOSITION' | 'REFUND' | null;
  timezone: string;
}
export interface PaidRecoveryRepository {
  readPaidRecovery(input: PaidRecoveryIdentity): Promise<PaidRecoveryContext | null>;
  commitPaidRecovery(input: PaidRecoveryCommand): Promise<PaidRecoveryContext>;
}
export class PaidRecoveryService {
  constructor(private readonly repository: PaidRecoveryRepository) {}
  read(input: unknown) { return this.repository.readPaidRecovery(paidRecoveryReadSchema.parse(input)); }
  commit(input: unknown) { return this.repository.commitPaidRecovery(paidRecoveryCommandSchema.parse(input)); }
}
