import type {
  Campaign,
  CampaignRule,
  CampaignStatus,
  QualifyingBookingFact,
  RewardWork,
  Voucher,
} from '../models/campaign';

// SPEC-2 Traceability: PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37

export interface CampaignListFilter {
  status?: CampaignStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CampaignRepository {
  // Campaigns
  createCampaign(campaign: Campaign, rules: CampaignRule[]): Promise<Campaign>;
  getCampaignById(id: string): Promise<Campaign | null>;
  listCampaigns(filter?: CampaignListFilter): Promise<{ campaigns: Campaign[]; total: number }>;
  updateCampaign(id: string, updates: Partial<Campaign>, expectedRevision: number): Promise<Campaign>;
  deleteDraftCampaign(id: string): Promise<boolean>;
  updateCampaignStatus(id: string, newStatus: CampaignStatus, expectedRevision: number): Promise<Campaign>;

  // Rules
  getRulesByCampaignId(campaignId: string): Promise<CampaignRule[]>;
  getRuleById(ruleId: string): Promise<CampaignRule | null>;
  getActiveRulesForEvent(eventTimeIso: string): Promise<CampaignRule[]>;
  createSuccessorRule(predecessorRuleId: string, successorRule: CampaignRule): Promise<CampaignRule>;

  // Vouchers
  listVouchersByCustomerId(customerId: string): Promise<Voucher[]>;
  getVoucherById(voucherId: string): Promise<Voucher | null>;
  getVoucherByCode(promoCode: string): Promise<Voucher | null>;
  findExistingVoucherByMilestone(customerId: string, ruleId: string, milestoneIndex: number): Promise<Voucher | null>;
  insertVouchers(vouchers: Voucher[]): Promise<Voucher[]>;
  redeemVoucher(voucherId: string, reservationId: string, discountAmount: number, nowIso?: string): Promise<Voucher>;
  getVoucherCountsByCampaignId(campaignId: string): Promise<{ issued: number; used: number; expired: number }>;

  // Qualifying Facts
  insertQualifyingFact(fact: QualifyingBookingFact): Promise<QualifyingBookingFact>;
  getQualifyingFactsByCustomerId(customerId: string): Promise<QualifyingBookingFact[]>;
  invalidateQualifyingFact(reservationId: string): Promise<boolean>;

  // Reward Work
  enqueueRewardWork(work: RewardWork[]): Promise<RewardWork[]>;
  claimDueRewardWork(limit: number, leaseSeconds: number): Promise<RewardWork[]>;
  completeRewardWork(id: string): Promise<void>;
  failRewardWork(id: string, errorCode: string): Promise<void>;

  // Customer IDs for reconciliation
  listCustomerIdsPaged(limit: number, afterId?: string): Promise<string[]>;
}
