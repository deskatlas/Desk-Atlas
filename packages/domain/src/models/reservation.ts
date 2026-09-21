export type ReservationSource = "WEB" | "KIOSK";

export type ReservationStatus = 
  | "PENDING_PAYMENT"
  | "PAYMENT_UNDER_REVIEW"
  | "PENDING_COUNTER_CONFIRMATION"
  | "CONFIRMED"
  | "NEEDS_MANUAL_RESOLUTION"
  | "CHECKED_IN"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export interface Reservation {
  id: string;
  referenceCode: string;
  source: ReservationSource;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  status: ReservationStatus;
  rateSnapshot: number;
  amountDue: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
  bookingTokenHash?: string | null;
  bookingToken?: string | null;
  qrIssuedAt?: string | null;
  qrRevokedAt?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  cancellationReason?: string | null;
  cancelledByUserId?: string | null;
  cancelledAt?: string | null;
  rescheduleCount?: number;
}

export type CandidateRank = 0 | 1 | 2;

export interface ReservationCandidate {
  id?: string;
  reservationId?: string;
  rank: CandidateRank;
  workspaceInstanceId: string;
  startAt: string;
  endAt: string;
  isAssigned: boolean;
  workspaceDisplayName?: string;
  workspaceInstanceCode?: string;
  workspaceTemplateName?: string;
  floorName?: string;
}

export interface CandidateSubmissionDTO {
  rank: CandidateRank;
  workspaceInstanceId: string;
  startAt: string;
  endAt: string;
}

export interface CreateReservationRequest {
  source: ReservationSource;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  candidates: CandidateSubmissionDTO[];
  paymentMethodId?: string;
}

export type PaymentChannel = "WEB" | "KIOSK";

export type PaymentAttemptStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export type RefundStatus = "NONE" | "REQUIRED" | "REFUNDED";

export type PaymentMethodType = "GCASH" | "BANK" | "CASH";

export interface PaymentMethod {
  id: string;
  methodType: PaymentMethodType;
  displayName: string;
  accountName: string | null;
  accountNumber: string | null;
  instructions: string | null;
  qrImagePath: string | null;
  allowWeb: boolean;
  allowKiosk: boolean;
  isActive: boolean;
  displayOrder: number;
}

export interface ReservationPaymentSession {
  paymentAttemptId: string;
  token: string;
  expiresAt: string;
  paymentUrl: string;
  expiryMinutes?: number;
}

export interface PaymentSessionRecord {
  paymentAttemptId: string;
  reservationId: string;
  reservationReferenceCode: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentAttemptStatus;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  amountDue: number;
  currency: string;
  expiresAt: string;
  proofSubmittedAt: string | null;
  paymentMethodId: string | null;
  businessName?: string;
}

export interface PaymentSessionView {
  paymentAttemptId: string;
  reservationId: string;
  reservationReferenceCode: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentAttemptStatus;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  amountDue: number;
  currency: string;
  expiresAt: string;
  proofSubmittedAt: string | null;
  paymentMethodId: string | null;
  paymentMethods: PaymentMethod[];
  businessName?: string;
}

export interface PaymentSessionStatusView {
  reservationId: string;
  reservationReferenceCode: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentAttemptStatus;
  isValid: boolean;
  isExpired: boolean;
  expiresAt: string;
}

export interface CounterPaymentRecord {
  paymentAttemptId: string;
  reservationId: string;
  reservationReferenceCode: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentAttemptStatus;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  amountDue: number;
  currency: string;
  paymentMethodId: string;
  paymentMethodType?: PaymentMethodType | null;
  paymentMethodDisplayName?: string | null;
  submittedCandidates: ReservationCandidate[];
  processedAt: string | null;
  processedByUserId: string | null;
}

export interface PaymentProofSubmissionResult {
  paymentAttemptId: string;
  reservationId: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentAttemptStatus;
  proofSubmittedAt: string;
}

export type PaymentReviewActorRole = "ADMIN" | "STAFF";

export interface PaymentReviewActor {
  userId: string;
  role: PaymentReviewActorRole;
}

export interface PaymentReviewQueueItem {
  paymentAttemptId: string;
  reservationId: string;
  reservationReferenceCode: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentAttemptStatus;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  amountDue: number;
  currency: string;
  paymentMethodId: string | null;
  proofSubmittedAt: string | null;
  submittedCandidates: ReservationCandidate[];
}

export interface PaymentReviewDetail extends PaymentReviewQueueItem {
  proofStoragePath: string | null;
  rejectionReason: string | null;
  refundStatus: RefundStatus;
  processedAt: string | null;
  processedByUserId: string | null;
}

export type PaymentReviewDecision = "APPROVE" | "REJECT" | "RECONSIDER_APPROVE";

export interface ReviewPaymentRequest {
  paymentAttemptId: string;
  actor: PaymentReviewActor;
  decision: PaymentReviewDecision;
  rejectionReason?: string;
}

export interface ConfirmCounterPaymentRequest {
  paymentAttemptId?: string;
  code?: string;
  actor: PaymentReviewActor;
}

export interface PaymentReviewDecisionResult {
  paymentAttemptId: string;
  reservationId: string;
  reservationReferenceCode: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentAttemptStatus;
  refundStatus: RefundStatus;
  assignedCandidate: ReservationCandidate | null;
  assignedCandidateRank: CandidateRank | null;
  rejectionReason: string | null;
  processedAt: string;
  processedByUserId: string;
}

export interface ReservationResponseDTO extends Reservation {
  candidates?: ReservationCandidate[];
  paymentSession?: ReservationPaymentSession;
  counterPaymentAttemptId?: string;
}

export type BookingAccessState = "NOT_ACTIVE" | "ACTIVE" | "EXPIRED" | "INVALID";

export type BookingCheckInState = "NOT_CHECKED_IN" | "CHECKED_IN" | "CHECKED_OUT";

export interface BookingAccessIssueResult {
  reservationId: string;
  referenceCode: string;
  token: string;
  accessUrl: string;
  issuedAt: string;
}

export interface BookingScanResult {
  reservationId: string;
  referenceCode: string;
  reservationStatus: ReservationStatus;
  accessState: BookingAccessState;
  checkInState: BookingCheckInState;
  customerName: string;
  customerEmail?: string;
  workspaceInstanceId: string;
  workspaceDisplayName: string;
  workspaceInstanceCode: string;
  workspaceTemplateName: string;
  floorName: string;
  bookingStartAt: string;
  bookingEndAt: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  qrIssuedAt: string;
  timeRemainingSeconds: number;
  reentry?: boolean;
}

export interface StaffOperationalReservation {
  reservationId: string;
  referenceCode: string;
  source: ReservationSource;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  reservationStatus: ReservationStatus;
  checkInState: BookingCheckInState;
  workspaceInstanceId: string | null;
  workspaceDisplayName: string | null;
  workspaceInstanceCode: string | null;
  workspaceTemplateName: string | null;
  floorName: string | null;
  bookingStartAt: string | null;
  bookingEndAt: string | null;
  confirmedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  qrIssuedAt: string | null;
  paymentMethodId?: string | null;
  paymentMethodType?: PaymentMethodType | null;
  paymentMethodDisplayName?: string | null;
  pendingRelocationRequest?: CustomerRelocationRequest | null;
}

export type OccupancyState = "RESERVED" | "OCCUPIED";

export interface OccupancyRecord extends StaffOperationalReservation {
  occupancyState: OccupancyState;
}

export type OperationalActivityType = "CHECK_IN" | "REENTRY" | "CHECK_OUT";

export interface OperationalActivityRecord {
  reservationId: string;
  referenceCode: string;
  customerName: string;
  workspaceDisplayName: string | null;
  workspaceInstanceCode: string | null;
  activityType: OperationalActivityType;
  occurredAt: string;
  actorUserId: string | null;
  actorRole: "ADMIN" | "STAFF" | "SYSTEM";
  actorName?: string | null;
}

export interface ReservationOperationalActionRequest {
  reservationId: string;
  actor: PaymentReviewActor;
}

export interface ReservationOperationalActionResult extends StaffOperationalReservation {
  action: "CHECK_IN" | "CHECK_OUT";
  actedAt: string;
  actorUserId: string;
  actorRole: PaymentReviewActorRole;
  reentry: boolean;
}

export type GuestReservationTrackingStatus =
  | "PENDING_PAYMENT"
  | "PAYMENT_UNDER_REVIEW"
  | "CONFIRMED"
  | "NEEDS_MANUAL_RESOLUTION"
  | "CANCELLED"
  | "EXPIRED"
  | "COMPLETED"
  | "REJECTED";

export interface GuestReservationAssignmentSummary {
  workspaceInstanceId: string;
  workspaceDisplayName: string;
  workspaceInstanceCode: string;
  workspaceTemplateName: string;
  floorName: string;
  bookingStartAt: string;
  bookingEndAt: string;
}

export interface CustomerRelocationRequest {
  requestId: string;
  targetWorkspaceInstanceId: string;
  targetWorkspaceDisplayName: string;
  reason: string;
  notes?: string | null;
  requestedAt: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  decisionNotes?: string | null;
  decisionBy?: string | null;
  decisionAt?: string | null;
  decisionRole?: "STAFF" | "ADMIN" | "SUPERADMIN" | null;
}

export interface GuestReservationTrackingResult {
  reservationId: string;
  referenceCode: string;
  status: GuestReservationTrackingStatus;
  amountDue: number;
  currency: string;
  confirmedAt: string | null;
  completedAt: string | null;
  finalAssignment: GuestReservationAssignmentSummary | null;
  paymentStatus?: string | null;
  rejectionReason?: string | null;
  rescheduleCount?: number;
  canReschedule?: boolean;
  rescheduleCutoffHours?: number;
  isInSession?: boolean;
  canRelocate?: boolean;
  remainingMinutes?: number;
  pendingRelocationRequest?: CustomerRelocationRequest | null;
}

export type AdminReservationFilter = "all" | "active" | "checked_in" | "upcoming" | "awaiting_proof" | "expired" | "rejected" | "counter_queue";

export interface AdminReservationSummary {
  id: string;
  referenceCode: string;
  source: ReservationSource;
  customerFirstName: string;
  customerLastName: string;
  customerName: string;
  customerInitials: string;
  customerEmail: string;
  workspaceDisplayName: string;
  workspaceInstanceCode?: string | null;
  workspaceTemplateName?: string | null;
  floorName?: string | null;
  schedule: string;
  startAt?: string | null;
  endAt?: string | null;
  paymentStatus: string;
  paymentColor: string;
  reservationStatus: ReservationStatus;
  status: string;
  statusStyle: { background: string; color: string };
  mark: string;
  amountDue: number;
  currency: string;
  createdAt: string;
  confirmedAt?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  paymentExpiresAt?: string | null;
  paymentMethodId?: string | null;
  paymentMethodType?: PaymentMethodType | null;
  paymentMethodDisplayName?: string | null;
  customerPhone?: string | null;
  paymentAttemptStatus?: string | null;
  amountPaid?: number | null;
}

export interface AdminReservationCandidateSummary {
  id?: string;
  rank: CandidateRank;
  tier: string;
  workspaceInstanceId: string;
  workspaceDisplayName: string;
  workspaceInstanceCode?: string | null;
  workspaceTemplateName?: string | null;
  floorName?: string | null;
  startAt: string;
  endAt: string;
  schedule: string;
  isAssigned: boolean;
  color: string;
}

export interface AdminReservationPaymentAttemptSummary {
  id: string;
  status: PaymentAttemptStatus;
  amount: number;
  currency: string;
  channel: PaymentChannel;
  createdAt: string;
  expiresAt: string | null;
  proofSubmittedAt: string | null;
  proofStoragePath?: string | null;
  rejectionReason?: string | null;
  paymentMethodId?: string | null;
  paymentMethodType?: PaymentMethodType | null;
  paymentMethodDisplayName?: string | null;
}

export interface AdminReservationDetail {
  id: string;
  referenceCode: string;
  source: ReservationSource;
  customerFirstName: string;
  customerLastName: string;
  customerName: string;
  customerInitials: string;
  customerEmail: string;
  reservationStatus: ReservationStatus;
  status: string;
  statusStyle: { background: string; color: string };
  mark: string;
  schedule: string;
  duration: string;
  startAt?: string | null;
  endAt?: string | null;
  paymentStatus: string;
  paymentColor: string;
  amountDue: number;
  currency: string;
  rateSnapshot: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  qrIssuedAt?: string | null;
  qrRevokedAt?: string | null;
  hasBookingQr: boolean;
  bookingToken?: string | null;
  bookingAccessUrl?: string | null;
  assignedCandidate: AdminReservationCandidateSummary | null;
  candidates: AdminReservationCandidateSummary[];
  timeline: string[];
  paymentExpiresAt?: string | null;
  paymentAttemptStatus?: string | null;
  paymentMethodId?: string | null;
  paymentMethodType?: PaymentMethodType | null;
  paymentMethodDisplayName?: string | null;
  proofSubmittedAt?: string | null;
  expiryReason?: string | null;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  rescheduleCount?: number;
  paymentAttempts?: AdminReservationPaymentAttemptSummary[];
  pendingRelocationRequest?: CustomerRelocationRequest | null;
}


