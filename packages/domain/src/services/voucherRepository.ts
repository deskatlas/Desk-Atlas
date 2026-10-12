import type { Campaign, CampaignRule } from '../models/campaign';
import type {
  NotificationOutboxItem,
  QualifyingBookingFact,
  Voucher,
  VoucherStatus,
} from '../models/voucher';

export interface VoucherRepository {
  findVoucherByCode(promoCode: string): Promise<Voucher | null>;
  findVouchersByCustomerId(customerId: string, status?: VoucherStatus): Promise<Voucher[]>;
  findVoucherById(id: string): Promise<Voucher | null>;
  createVoucher(data: Omit<Voucher, 'id' | 'createdAt' | 'updatedAt'>): Promise<Voucher>;
  updateVoucher(id: string, updates: Partial<Voucher>): Promise<Voucher>;
  redeemVoucher(
    voucherId: string,
    reservationId: string,
    discountAmount: number,
    redeemedAt?: string
  ): Promise<Voucher>;
  listActiveCampaigns(now?: Date): Promise<Campaign[]>;
  listRulesForCampaign(campaignId: string): Promise<CampaignRule[]>;
  listQualifyingFactsForCustomer(customerId: string): Promise<QualifyingBookingFact[]>;
  recordQualifyingFact(fact: QualifyingBookingFact): Promise<void>;
  queueNotification(item: Omit<NotificationOutboxItem, 'id' | 'createdAt'>): Promise<NotificationOutboxItem>;
  findNotificationById(id: string): Promise<NotificationOutboxItem | null>;
  findNotificationByDedupeKey(dedupeKey: string): Promise<NotificationOutboxItem | null>;
  updateNotificationStatus(
    id: string,
    status: 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'FAILED',
    providerMessageId?: string,
    error?: string
  ): Promise<void>;
  findCustomerReservations?(
    customerId: string,
    limit?: number
  ): Promise<
    Array<{
      id: string;
      reference_code: string;
      source: string;
      status: string;
      start_at: string;
      end_at: string;
      workspace_name: string | null;
      amount_due: number;
      currency: string;
      created_at: string;
      is_pre_cutover: boolean;
    }>
  >;
}
