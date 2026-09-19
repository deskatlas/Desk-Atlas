import {
  AdminReservationCandidateSummary,
  AdminReservationDetail,
  AdminReservationPaymentAttemptSummary,
  AdminReservationSummary,
  BookingAccessState,
  CandidateRank,
  CounterPaymentRecord,
  CreateReservationRequest,
  OperationalActivityRecord,
  OccupancyRecord,
  PaymentMethod,
  PaymentProofSubmissionResult,
  PaymentReviewDecisionResult,
  PaymentReviewDetail,
  PaymentReviewQueueItem,
  PaymentSessionRecord,
  ReservationOperationalActionResult,
  ReservationCandidate,
  ReservationResponseDTO,
  StaffOperationalReservation,
  CustomerRelocationRequest,
} from "../models/reservation";
import {
  AdminReservationRepository,
  RescheduleReservationInput,
  RescheduleSlotAvailability,
  ExtendReservationInput,
  CheckExtendAvailabilityInput,
  ExtendAvailabilityResult,
  ExtendReservationResult,
  ExtendAvailabilityNextBooking,
  AvailableRelocationSpot,
  ListAvailableRelocationSpotsInput,
  RelocateReservationInput,
  RequestCustomerRelocationInput,
  DecideCustomerRelocationInput,
} from "./adminReservationRepository";
import {
  formatAmountWithCurrency,
  formatDuration,
  formatInitials,
  formatSchedule,
  formatTimelineDate,
  getCandidateColor,
  getCandidateTier,
  mapStatusPresentation,
} from "./adminReservationService";
import {
  ReportPaymentAttemptRecord,
  ReportReservationRecord,
} from "../models/reports";
import { ReservationRepository } from "./reservationRepository";
import { BookingAccessRecord, BookingAccessRepository } from "./bookingAccessRepository";
import { CounterPaymentRepository } from "./counterPaymentRepository";
import { CreateWebPaymentSessionInput, ReservationPaymentRepository } from "./paymentSessionRepository";
import { PaymentReviewRepository } from "./paymentReviewRepository";
import { ReportsRepository } from "./reportsRepository";
import { StaffOperationsRepository } from "./staffOperationsRepository";
import {
  StaffOperationsError,
  StaffOperationsConflictError,
} from "./staffOperationsService";
import {
  GuestReservationTrackingRecord,
  GuestReservationTrackingRepository,
} from "./guestReservationTrackingRepository";
import { BookingSurveyRepository, EndedReservationForSurvey } from "./bookingSurveyService";
import { zonedDateTimeToUtc } from "./availabilityService";

export class ReservationSupabaseRepository
  implements
  ReservationRepository,
  ReservationPaymentRepository,
  PaymentReviewRepository,
  BookingAccessRepository,
  CounterPaymentRepository,
  StaffOperationsRepository,
  GuestReservationTrackingRepository,
  ReportsRepository,
  AdminReservationRepository,
  BookingSurveyRepository {
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;

  constructor(options?: { supabaseUrl?: string; serviceRoleKey?: string }) {
    const supabaseUrl =
      options?.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = options?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for reservation routes');
    }

    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for reservation routes');
    }

    this.restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
    this.serviceRoleKey = serviceRoleKey;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('apikey', this.serviceRoleKey);
    headers.set('Authorization', `Bearer ${this.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${this.restUrl}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  private mapReservation(data: any, candidates: ReservationCandidate[]): ReservationResponseDTO {
    return {
      id: data.id,
      referenceCode: data.reference_code,
      source: data.source,
      customerFirstName: data.customer_first_name,
      customerLastName: data.customer_last_name,
      customerEmail: data.customer_email,
      status: data.status,
      rateSnapshot: Number(data.rate_snapshot),
      amountDue: Number(data.amount_due),
      currency: data.currency,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      confirmedAt: data.confirmed_at,
      bookingTokenHash: data.booking_token_hash,
      bookingToken: data.booking_token ?? null,
      qrIssuedAt: data.qr_issued_at,
      qrRevokedAt: data.qr_revoked_at,
      checkedInAt: data.checked_in_at,
      checkedOutAt: data.checked_out_at,
      candidates,
    };
  }

  async createReservation(
    request: CreateReservationRequest,
    rateSnapshot: number,
    amountDue: number,
    paymentSession?: CreateWebPaymentSessionInput
  ): Promise<ReservationResponseDTO> {
    let reservationId: string;
    let counterPaymentAttemptId: string | undefined;

    if (request.source === "WEB" && paymentSession) {
      const paymentResult = await this.request<any[]>("/rpc/create_web_reservation_with_payment_session", {
        method: "POST",
        body: JSON.stringify({
          p_first_name: request.customerFirstName,
          p_last_name: request.customerLastName,
          p_email: request.customerEmail,
          p_rate_snapshot: rateSnapshot,
          p_amount_due: amountDue,
          p_candidates: request.candidates,
          p_token_hash: paymentSession.tokenHash,
          p_expires_at: paymentSession.expiresAt,
        }),
      });

      if (!paymentResult || paymentResult.length === 0) {
        throw new Error("Failed to create reservation payment session.");
      }

      reservationId = paymentResult[0].reservation_id;
    } else if (request.source === "KIOSK") {
      const paymentResult = await this.request<any[]>(
        "/rpc/create_kiosk_reservation_with_counter_payment",
        {
          method: "POST",
          body: JSON.stringify({
            p_first_name: request.customerFirstName,
            p_last_name: request.customerLastName,
            p_email: request.customerEmail,
            p_rate_snapshot: rateSnapshot,
            p_amount_due: amountDue,
            p_candidates: request.candidates,
            p_payment_method_id: request.paymentMethodId ?? null,
          }),
        }
      );

      if (!paymentResult || paymentResult.length === 0) {
        throw new Error("Failed to create kiosk counter payment.");
      }

      reservationId = paymentResult[0].reservation_id;
      counterPaymentAttemptId = paymentResult[0].payment_attempt_id;
    } else {
      const data = await this.request<any>("/rpc/create_reservation", {
        method: "POST",
        body: JSON.stringify({
          p_source: request.source,
          p_first_name: request.customerFirstName,
          p_last_name: request.customerLastName,
          p_email: request.customerEmail,
          p_rate_snapshot: rateSnapshot,
          p_amount_due: amountDue,
          p_candidates: request.candidates,
        }),
      });

      if (!data) {
        throw new Error("Failed to create reservation: no data returned from RPC.");
      }

      reservationId = data.id;
    }

    const candidatesData = await this.request<any[]>(
      `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservationId)}&order=rank.asc`
    );

    const candidates: ReservationCandidate[] = candidatesData.map((c: any) => ({
      id: c.id,
      reservationId: c.reservation_id,
      rank: c.rank,
      workspaceInstanceId: c.workspace_instance_id,
      startAt: c.start_at,
      endAt: c.end_at,
      isAssigned: c.is_assigned,
    }));

    const reservationRows = await this.request<any[]>(
      `/reservations?select=*&id=eq.${encodeURIComponent(reservationId)}&limit=1`
    );

    if (!reservationRows || reservationRows.length === 0) {
      throw new Error("Created reservation could not be loaded.");
    }

    return {
      ...this.mapReservation(reservationRows[0], candidates),
      counterPaymentAttemptId,
    };
  }

  async getPaymentExpiryMinutes(): Promise<number> {
    const settingsRows = await this.request<any[]>(
      "/business_settings?select=payment_expiry_minutes&id=eq.1&limit=1"
    );

    return Number(settingsRows?.[0]?.payment_expiry_minutes ?? 60);
  }

  async listActiveWebPaymentMethods(): Promise<PaymentMethod[]> {
    const rows = await this.request<any[]>(
      "/payment_methods?select=*&is_active=eq.true&allow_web=eq.true&order=display_order.asc"
    );

    return rows.map((row) => ({
      id: row.id,
      methodType: row.method_type,
      displayName: row.display_name,
      accountName: row.account_name,
      accountNumber: row.account_number,
      instructions: row.instructions,
      qrImagePath: row.qr_image_path,
      allowWeb: row.allow_web,
      allowKiosk: row.allow_kiosk,
      isActive: row.is_active,
      displayOrder: row.display_order,
    }));
  }

  async listActiveKioskPaymentMethods(): Promise<PaymentMethod[]> {
    const rows = await this.request<any[]>(
      "/payment_methods?select=*&is_active=eq.true&allow_kiosk=eq.true&order=display_order.asc"
    );

    return rows.map((row) => ({
      id: row.id,
      methodType: row.method_type,
      displayName: row.display_name,
      accountName: row.account_name,
      accountNumber: row.account_number,
      instructions: row.instructions,
      qrImagePath: row.qr_image_path,
      allowWeb: row.allow_web,
      allowKiosk: row.allow_kiosk,
      isActive: row.is_active,
      displayOrder: row.display_order,
    }));
  }

  async getCounterPaymentRecord(paymentAttemptId: string): Promise<CounterPaymentRecord | null> {
    const attempt = (
      await this.request<any[]>(
        `/payment_attempts?select=*&id=eq.${encodeURIComponent(paymentAttemptId)}&channel=eq.KIOSK&limit=1`
      )
    )?.[0];

    if (!attempt) {
      return null;
    }

    const reservation = (
      await this.request<any[]>(
        `/reservations?select=*&id=eq.${encodeURIComponent(attempt.reservation_id)}&limit=1`
      )
    )?.[0];

    if (!reservation) {
      return null;
    }

    const candidatesRows = await this.request<any[]>(
      `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&order=rank.asc`
    );

    const candidates: ReservationCandidate[] = candidatesRows.map((candidate: any) => ({
      id: candidate.id,
      reservationId: candidate.reservation_id,
      rank: candidate.rank,
      workspaceInstanceId: candidate.workspace_instance_id,
      startAt: candidate.start_at,
      endAt: candidate.end_at,
      isAssigned: candidate.is_assigned,
    }));

    let paymentMethod: any = null;
    if (attempt.payment_method_id) {
      paymentMethod = (
        await this.request<any[]>(
          `/payment_methods?select=*&id=eq.${encodeURIComponent(attempt.payment_method_id)}&limit=1`
        )
      )?.[0];
    }

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationReferenceCode: reservation.reference_code,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      customerEmail: reservation.customer_email,
      customerFirstName: reservation.customer_first_name,
      customerLastName: reservation.customer_last_name,
      amountDue: Number(reservation.amount_due),
      currency: reservation.currency,
      paymentMethodId: attempt.payment_method_id,
      paymentMethodType: paymentMethod?.method_type ?? null,
      paymentMethodDisplayName: paymentMethod?.display_name ?? null,
      submittedCandidates: candidates,
      processedAt: attempt.processed_at,
      processedByUserId: attempt.processed_by_user_id,
    };
  }

  async getCounterPaymentRecordByCode(code: string): Promise<CounterPaymentRecord | null> {
    const trimmed = code.trim();
    // Try finding reservation by reference code first
    const reservationRows = await this.request<any[]>(
      `/reservations?select=*&reference_code=eq.${encodeURIComponent(trimmed)}&source=eq.KIOSK&limit=1`
    );

    let reservation = reservationRows?.[0];
    let attempt: any;

    if (reservation) {
      const attemptRows = await this.request<any[]>(
        `/payment_attempts?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&channel=eq.KIOSK&order=created_at.desc&limit=1`
      );
      attempt = attemptRows?.[0];
    } else {
      // Try finding by payment attempt ID directly
      const attemptRows = await this.request<any[]>(
        `/payment_attempts?select=*&id=eq.${encodeURIComponent(trimmed)}&channel=eq.KIOSK&limit=1`
      );
      attempt = attemptRows?.[0];
      if (attempt) {
        const resRows = await this.request<any[]>(
          `/reservations?select=*&id=eq.${encodeURIComponent(attempt.reservation_id)}&limit=1`
        );
        reservation = resRows?.[0];
      }
    }

    if (!attempt || !reservation) {
      return null;
    }

    const candidatesRows = await this.request<any[]>(
      `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&order=rank.asc`
    );

    const candidates: ReservationCandidate[] = candidatesRows.map((candidate: any) => ({
      id: candidate.id,
      reservationId: candidate.reservation_id,
      rank: candidate.rank,
      workspaceInstanceId: candidate.workspace_instance_id,
      startAt: candidate.start_at,
      endAt: candidate.end_at,
      isAssigned: candidate.is_assigned,
    }));

    let paymentMethod: any = null;
    if (attempt.payment_method_id) {
      paymentMethod = (
        await this.request<any[]>(
          `/payment_methods?select=*&id=eq.${encodeURIComponent(attempt.payment_method_id)}&limit=1`
        )
      )?.[0];
    }

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationReferenceCode: reservation.reference_code,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      customerEmail: reservation.customer_email,
      customerFirstName: reservation.customer_first_name,
      customerLastName: reservation.customer_last_name,
      amountDue: Number(reservation.amount_due),
      currency: reservation.currency,
      paymentMethodId: attempt.payment_method_id,
      paymentMethodType: paymentMethod?.method_type ?? null,
      paymentMethodDisplayName: paymentMethod?.display_name ?? null,
      submittedCandidates: candidates,
      processedAt: attempt.processed_at,
      processedByUserId: attempt.processed_by_user_id,
    };
  }

  async getBusinessName(): Promise<string> {
    try {
      const rows = await this.request<any[]>(
        "/business_settings?select=business_name&id=eq.1&limit=1"
      );
      if (rows && rows.length > 0 && rows[0].business_name) {
        return rows[0].business_name;
      }
    } catch {
      // Return default
    }
    return "DeskAtlas";
  }

  async findPaymentSessionByTokenHash(tokenHash: string): Promise<PaymentSessionRecord | null> {
    const attemptRows = await this.request<any[]>(
      `/payment_attempts?select=*&token_hash=eq.${encodeURIComponent(tokenHash)}&channel=eq.WEB&limit=1`
    );

    if (!attemptRows || attemptRows.length === 0) {
      return null;
    }

    const attempt = attemptRows[0];
    const reservationRows = await this.request<any[]>(
      `/reservations?select=*&id=eq.${encodeURIComponent(attempt.reservation_id)}&limit=1`
    );

    if (!reservationRows || reservationRows.length === 0) {
      return null;
    }

    const reservation = reservationRows[0];
    const businessName = await this.getBusinessName();

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationReferenceCode: reservation.reference_code,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      customerEmail: reservation.customer_email,
      customerFirstName: reservation.customer_first_name,
      customerLastName: reservation.customer_last_name,
      amountDue: Number(reservation.amount_due),
      currency: reservation.currency,
      expiresAt: attempt.expires_at,
      proofSubmittedAt: attempt.proof_submitted_at,
      paymentMethodId: attempt.payment_method_id,
      businessName,
    };
  }

  async expirePaymentSession(tokenHash: string, expiredAt: string): Promise<boolean> {
    const result = await this.request<any[]>("/rpc/expire_web_payment_session", {
      method: "POST",
      body: JSON.stringify({
        p_token_hash: tokenHash,
        p_expired_at: expiredAt,
      }),
    });

    return Array.isArray(result) && result.length > 0;
  }

  async submitPaymentProof(input: {
    tokenHash: string;
    paymentMethodId: string;
    proofStoragePath: string;
    proofSubmittedAt: string;
  }): Promise<PaymentProofSubmissionResult> {
    const result = await this.request<any[]>("/rpc/submit_web_payment_proof", {
      method: "POST",
      body: JSON.stringify({
        p_token_hash: input.tokenHash,
        p_payment_method_id: input.paymentMethodId,
        p_proof_storage_path: input.proofStoragePath,
        p_proof_submitted_at: input.proofSubmittedAt,
      }),
    });

    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("Failed to submit payment proof.");
    }

    return {
      paymentAttemptId: result[0].payment_attempt_id,
      reservationId: result[0].reservation_id,
      reservationStatus: result[0].reservation_status,
      paymentStatus: result[0].payment_status,
      proofSubmittedAt: result[0].proof_submitted_at,
    };
  }

  async listPaymentReviewQueue(): Promise<PaymentReviewQueueItem[]> {
    const attempts = await this.request<any[]>(
      "/payment_attempts?select=*&channel=eq.WEB&status=eq.UNDER_REVIEW&order=proof_submitted_at.asc.nullslast,created_at.asc"
    );

    const reviews = await Promise.all(
      attempts.map(async (attempt) => this.loadPaymentReview(attempt.id, attempt))
    );

    return reviews
      .filter((review): review is PaymentReviewDetail => review !== null)
      .map(({ proofStoragePath: _proofStoragePath, rejectionReason: _rejectionReason, refundStatus: _refundStatus, processedAt: _processedAt, processedByUserId: _processedByUserId, ...queueItem }) => queueItem)
      .sort((a, b) => {
        const aTime = a.proofSubmittedAt ? new Date(a.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.proofSubmittedAt ? new Date(b.proofSubmittedAt).getTime() : Number.POSITIVE_INFINITY;
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });
  }

  async listRejectedPayments(): Promise<PaymentReviewDetail[]> {
    const attempts = await this.request<any[]>(
      "/payment_attempts?select=*&channel=eq.WEB&status=eq.REJECTED&order=processed_at.desc.nullslast,created_at.desc"
    );

    const reviews = await Promise.all(
      attempts.map(async (attempt) => this.loadPaymentReview(attempt.id, attempt))
    );

    return reviews
      .filter((review): review is PaymentReviewDetail => review !== null)
      .sort((a, b) => {
        const aTime = a.processedAt ? new Date(a.processedAt).getTime() : 0;
        const bTime = b.processedAt ? new Date(b.processedAt).getTime() : 0;
        if (aTime !== bTime) {
          return bTime - aTime;
        }
        return a.paymentAttemptId.localeCompare(b.paymentAttemptId);
      });
  }

  async getPaymentReviewDetail(paymentAttemptId: string): Promise<PaymentReviewDetail | null> {
    return this.loadPaymentReview(paymentAttemptId);
  }

  async approvePaymentAndAllocate(input: {
    paymentAttemptId: string;
    actorUserId: string;
    processedAt: string;
  }): Promise<PaymentReviewDecisionResult> {
    try {
      const result = await this.request<any[]>("/rpc/approve_online_payment_and_allocate", {
        method: "POST",
        body: JSON.stringify({
          p_payment_attempt_id: input.paymentAttemptId,
          p_processed_by_user_id: input.actorUserId,
          p_processed_at: input.processedAt,
        }),
      });

      if (!Array.isArray(result) || result.length === 0) {
        throw new Error("Failed to approve payment review.");
      }

      const decisionResult = this.mapDecisionResult(result[0]);

      if (decisionResult.reservationStatus === "CONFIRMED" || decisionResult.reservationStatus === "NEEDS_MANUAL_RESOLUTION") {
        try {
          await this.request(`/reservations?id=eq.${encodeURIComponent(decisionResult.reservationId)}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              cancelled_at: null,
              cancellation_reason: null,
              cancelled_by_user_id: null,
              updated_at: input.processedAt,
            }),
          });
        } catch {
          // non-blocking
        }
      }

      return decisionResult;
    } catch (rpcError: any) {
      const msg = rpcError instanceof Error ? rpcError.message : String(rpcError);
      if (
        msg.includes("not in an approvable review state") ||
        msg.includes("PGRST202") ||
        msg.includes("404")
      ) {
        return this.fallbackApprovePaymentAndAllocate(input);
      }
      throw rpcError;
    }
  }

  private async fallbackApprovePaymentAndAllocate(input: {
    paymentAttemptId: string;
    actorUserId: string;
    processedAt: string;
  }): Promise<PaymentReviewDecisionResult> {
    const attempts = await this.request<any[]>(
      `/payment_attempts?id=eq.${encodeURIComponent(input.paymentAttemptId)}&limit=1`
    );
    if (!attempts || attempts.length === 0) {
      throw new Error(`Payment attempt not found: ${input.paymentAttemptId}`);
    }
    const attempt = attempts[0];
    const reservationId = attempt.reservation_id;

    const candidates = await this.request<any[]>(
      `/reservation_candidates?reservation_id=eq.${encodeURIComponent(reservationId)}&order=rank.asc`
    );

    let assignedCandidate: any = null;
    for (const c of candidates ?? []) {
      const conflicts = await this.request<any[]>(
        `/reservation_candidates?workspace_instance_id=eq.${encodeURIComponent(c.workspace_instance_id)}&is_assigned=eq.true&reservation_id=neq.${encodeURIComponent(reservationId)}&select=id,start_at,end_at`
      ).catch(() => []);

      const cStart = new Date(c.start_at).getTime();
      const cEnd = new Date(c.end_at).getTime();
      const hasConflict = (conflicts ?? []).some((conflict) => {
        const confStart = new Date(conflict.start_at).getTime();
        const confEnd = new Date(conflict.end_at).getTime();
        return cStart < confEnd && cEnd > confStart;
      });

      if (!hasConflict) {
        assignedCandidate = c;
        await this.request(`/reservation_candidates?id=eq.${encodeURIComponent(c.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ is_assigned: true, updated_at: input.processedAt }),
        }).catch(() => {});
        break;
      }
    }

    const wasRejected = attempt.status === "REJECTED";
    await this.request(`/payment_attempts?id=eq.${encodeURIComponent(attempt.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "APPROVED",
        processed_by_user_id: input.actorUserId,
        processed_at: input.processedAt,
        rejection_reason: null,
      }),
    });

    const newResStatus = assignedCandidate ? "CONFIRMED" : "NEEDS_MANUAL_RESOLUTION";
    await this.request(`/reservations?id=eq.${encodeURIComponent(reservationId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: newResStatus,
        confirmed_at: assignedCandidate ? input.processedAt : null,
        cancelled_at: null,
        cancellation_reason: null,
        cancelled_by_user_id: null,
        updated_at: input.processedAt,
      }),
    });

    await this.request("/audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        actor_user_id: input.actorUserId,
        actor_role: "ADMIN",
        action: wasRejected ? "payment_review_reconsidered_approved" : "payment_review_completed",
        entity_type: "payment_attempt",
        entity_id: attempt.id,
        metadata: {
          decision: "APPROVE",
          was_reconsidered: wasRejected,
          reservation_id: reservationId,
          assigned_candidate_id: assignedCandidate?.id ?? null,
        },
      }),
    }).catch(() => {});

    const res = await this.request<any[]>(`/reservations?id=eq.${encodeURIComponent(reservationId)}&limit=1`);

    return {
      paymentAttemptId: attempt.id,
      reservationId,
      reservationReferenceCode: res?.[0]?.reference_code ?? "",
      reservationStatus: newResStatus,
      paymentStatus: "APPROVED",
      refundStatus: attempt.refund_status ?? "NONE",
      assignedCandidate: assignedCandidate
        ? {
            id: assignedCandidate.id,
            reservationId,
            rank: assignedCandidate.rank,
            workspaceInstanceId: assignedCandidate.workspace_instance_id,
            startAt: assignedCandidate.start_at,
            endAt: assignedCandidate.end_at,
            isAssigned: true,
          }
        : null,
      assignedCandidateRank: assignedCandidate?.rank ?? null,
      rejectionReason: null,
      processedAt: input.processedAt,
      processedByUserId: input.actorUserId,
    };
  }

  async rejectPaymentAttempt(input: {
    paymentAttemptId: string;
    actorUserId: string;
    processedAt: string;
    rejectionReason: string;
  }): Promise<PaymentReviewDecisionResult> {
    const trimmedReason = input.rejectionReason.trim();
    let result: any[] | null = null;

    try {
      result = await this.request<any[]>("/rpc/reject_online_payment_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_payment_attempt_id: input.paymentAttemptId,
          p_processed_by_user_id: input.actorUserId,
          p_processed_at: input.processedAt,
          p_rejection_reason: trimmedReason,
        }),
      });
    } catch (rpcError: any) {
      const isRecoverableError =
        rpcError?.message?.includes("23514") ||
        rpcError?.message?.includes("42702") ||
        rpcError?.message?.includes("reservations_cancellation_requirements") ||
        rpcError?.message?.includes("PGRST202");

      if (isRecoverableError) {
        return await this.fallbackRejectPaymentAttempt(input, trimmedReason);
      }
      throw rpcError;
    }

    if (!Array.isArray(result) || result.length === 0) {
      return await this.fallbackRejectPaymentAttempt(input, trimmedReason);
    }

    const decisionResult = this.mapDecisionResult(result[0]);

    if (decisionResult.reservationStatus !== "CANCELLED") {
      try {
        await fetch(
          `${this.restUrl}/reservations?id=eq.${encodeURIComponent(decisionResult.reservationId)}`,
          {
            method: "PATCH",
            headers: {
              apikey: this.serviceRoleKey,
              Authorization: `Bearer ${this.serviceRoleKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            cache: "no-store",
            body: JSON.stringify({
              status: "CANCELLED",
              cancelled_at: input.processedAt,
              cancellation_reason: `Payment proof rejected: ${trimmedReason}`,
              cancelled_by_user_id: input.actorUserId,
              updated_at: input.processedAt,
            }),
          }
        );
        decisionResult.reservationStatus = "CANCELLED";
      } catch {
        // ignore
      }
    }

    return decisionResult;
  }

  private async fallbackRejectPaymentAttempt(
    input: {
      paymentAttemptId: string;
      actorUserId: string;
      processedAt: string;
      rejectionReason: string;
    },
    trimmedReason: string
  ): Promise<PaymentReviewDecisionResult> {
    const attempts = await this.request<any[]>(
      `/payment_attempts?id=eq.${encodeURIComponent(input.paymentAttemptId)}&limit=1`
    );
    if (!attempts || attempts.length === 0) {
      throw new Error(`Payment attempt not found: ${input.paymentAttemptId}`);
    }
    const attempt = attempts[0];

    // Update payment attempt to REJECTED
    await this.request(
      `/payment_attempts?id=eq.${encodeURIComponent(input.paymentAttemptId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "REJECTED",
          processed_by_user_id: input.actorUserId,
          processed_at: input.processedAt,
          rejection_reason: trimmedReason,
        }),
      }
    );

    // Unassign candidates if any
    try {
      await this.request(
        `/reservation_candidates?reservation_id=eq.${encodeURIComponent(attempt.reservation_id)}&is_assigned=eq.true`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            is_assigned: false,
            updated_at: input.processedAt,
          }),
        }
      );
    } catch {
      // non-blocking
    }

    // Update reservation to CANCELLED with cancellation requirements satisfied
    await this.request(
      `/reservations?id=eq.${encodeURIComponent(attempt.reservation_id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "CANCELLED",
          cancelled_at: input.processedAt,
          cancellation_reason: `Payment proof rejected: ${trimmedReason}`,
          cancelled_by_user_id: input.actorUserId,
          updated_at: input.processedAt,
        }),
      }
    );

    // Audit log
    try {
      await this.request("/audit_logs", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          actor_user_id: input.actorUserId,
          actor_role: "ADMIN",
          action: "payment_review_completed",
          entity_type: "payment_attempt",
          entity_id: input.paymentAttemptId,
          metadata: {
            decision: "REJECT",
            reservation_id: attempt.reservation_id,
            rejection_reason: trimmedReason,
          },
        }),
      });
    } catch {
      // non-blocking
    }

    const reservations = await this.request<any[]>(
      `/reservations?id=eq.${encodeURIComponent(attempt.reservation_id)}&limit=1`
    );

    return {
      paymentAttemptId: input.paymentAttemptId,
      reservationId: attempt.reservation_id,
      reservationReferenceCode: reservations?.[0]?.reference_code ?? "",
      reservationStatus: "CANCELLED",
      paymentStatus: "REJECTED",
      refundStatus: attempt.refund_status ?? "NONE",
      assignedCandidate: null,
      assignedCandidateRank: null,
      rejectionReason: trimmedReason,
      processedAt: input.processedAt,
      processedByUserId: input.actorUserId,
    };
  }

  async confirmCounterPaymentAndAllocate(input: {
    paymentAttemptId?: string;
    code?: string;
    actorUserId: string;
    processedAt: string;
  }): Promise<PaymentReviewDecisionResult> {
    let resolvedPaymentAttemptId = input.paymentAttemptId?.trim();

    if (!resolvedPaymentAttemptId && input.code) {
      const record = await this.getCounterPaymentRecordByCode(input.code);
      if (!record) {
        throw new Error("Counter payment attempt was not found.");
      }
      resolvedPaymentAttemptId = record.paymentAttemptId;
    }

    if (!resolvedPaymentAttemptId) {
      throw new Error("Payment attempt ID or code is required.");
    }

    const result = await this.request<any[]>("/rpc/confirm_kiosk_payment_and_allocate", {
      method: "POST",
      body: JSON.stringify({
        p_payment_attempt_id: resolvedPaymentAttemptId,
        p_processed_by_user_id: input.actorUserId,
        p_processed_at: input.processedAt,
      }),
    });

    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("Failed to confirm counter payment.");
    }

    const decisionResult = this.mapDecisionResult(result[0]);

    if (decisionResult.assignedCandidate) {
      if (decisionResult.reservationStatus !== "CHECKED_IN") {
        try {
          await fetch(
            `${this.restUrl}/reservations?id=eq.${encodeURIComponent(decisionResult.reservationId)}`,
            {
              method: "PATCH",
              headers: {
                apikey: this.serviceRoleKey,
                Authorization: `Bearer ${this.serviceRoleKey}`,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              cache: "no-store",
              body: JSON.stringify({
                status: "CHECKED_IN",
                checked_in_at: input.processedAt,
                updated_at: input.processedAt,
              }),
            }
          );
        } catch {
          // fallback to returned DB state
        }
        decisionResult.reservationStatus = "CHECKED_IN";
      }

      // Record operational check-in audit log for activity feed
      try {
        await fetch(`${this.restUrl}/audit_logs`, {
          method: "POST",
          headers: {
            apikey: this.serviceRoleKey,
            Authorization: `Bearer ${this.serviceRoleKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          cache: "no-store",
          body: JSON.stringify({
            actor_user_id: input.actorUserId,
            actor_role: "STAFF",
            action: "reservation_checked_in",
            entity_type: "reservation",
            entity_id: decisionResult.reservationId,
            metadata: {
              source: "KIOSK",
              auto_check_in: true,
              workspace_instance_id: decisionResult.assignedCandidate.workspaceInstanceId,
              start_at: decisionResult.assignedCandidate.startAt,
              end_at: decisionResult.assignedCandidate.endAt,
            },
          }),
        });
      } catch {
        // non-blocking
      }
    }

    return decisionResult;
  }

  async issueBookingAccessToken(input: {
    reservationId: string;
    tokenHash: string;
    token?: string;
    issuedAt: string;
  }): Promise<boolean> {
    const reservationRows = await this.request<any[]>(
      `/reservations?select=id,status,booking_token_hash&id=eq.${encodeURIComponent(input.reservationId)}&limit=1`
    );

    if (!reservationRows || reservationRows.length === 0) {
      throw new Error("Reservation was not found.");
    }

    const reservation = reservationRows[0];
    if (reservation.booking_token_hash) {
      return false;
    }

    if (reservation.status !== "CONFIRMED" && reservation.status !== "CHECKED_IN") {
      throw new Error("Booking access can only be issued for confirmed reservations.");
    }

    const patchBody: Record<string, any> = {
      booking_token_hash: input.tokenHash,
      qr_issued_at: input.issuedAt,
      updated_at: input.issuedAt,
    };
    if (input.token !== undefined) {
      patchBody.booking_token = input.token;
    }

    const response = await fetch(
      `${this.restUrl}/reservations?id=eq.${encodeURIComponent(input.reservationId)}&booking_token_hash=is.null&select=id`,
      {
        method: "PATCH",
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        cache: "no-store",
        body: JSON.stringify(patchBody),
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${detail}`);
    }

    const updatedRows = (await response.json()) as any[];
    return Array.isArray(updatedRows) && updatedRows.length > 0;
  }

  async findBookingAccessByTokenHash(tokenHash: string): Promise<BookingAccessRecord | null> {
    const reservationRows = await this.request<any[]>(
      `/reservations?select=*&booking_token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`
    );

    if (!reservationRows || reservationRows.length === 0) {
      return null;
    }

    const reservation = reservationRows[0];
    const assignedCandidate = (
      await this.request<any[]>(
        `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&is_assigned=eq.true&limit=1`
      )
    )?.[0];

    if (!assignedCandidate) {
      return null;
    }

    const workspaceInstance = (
      await this.request<any[]>(
        `/workspace_instances?select=*&id=eq.${encodeURIComponent(assignedCandidate.workspace_instance_id)}&limit=1`
      )
    )?.[0];
    const workspaceTemplate = workspaceInstance
      ? (
        await this.request<any[]>(
          `/workspace_templates?select=*&id=eq.${encodeURIComponent(workspaceInstance.template_id)}&limit=1`
        )
      )?.[0]
      : null;
    const floor = workspaceInstance
      ? (
        await this.request<any[]>(
          `/floors?select=*&id=eq.${encodeURIComponent(workspaceInstance.floor_id)}&limit=1`
        )
      )?.[0]
      : null;

    return {
      reservationId: reservation.id,
      referenceCode: reservation.reference_code,
      reservationStatus: reservation.status,
      customerFirstName: reservation.customer_first_name,
      customerLastName: reservation.customer_last_name,
      customerEmail: reservation.customer_email,
      bookingTokenHash: reservation.booking_token_hash,
      bookingToken: reservation.booking_token ?? null,
      qrIssuedAt: reservation.qr_issued_at,
      qrRevokedAt: reservation.qr_revoked_at,
      checkedInAt: reservation.checked_in_at,
      checkedOutAt: reservation.checked_out_at,
      assignedWorkspaceInstanceId: assignedCandidate.workspace_instance_id,
      assignedWorkspaceDisplayName:
        workspaceInstance?.display_name ?? workspaceInstance?.instance_code ?? assignedCandidate.workspace_instance_id,
      assignedWorkspaceInstanceCode:
        workspaceInstance?.instance_code ?? assignedCandidate.workspace_instance_id,
      assignedWorkspaceTemplateName: workspaceTemplate?.name ?? "Workspace",
      assignedFloorName: floor?.name ?? "Unknown Floor",
      assignedStartAt: assignedCandidate.start_at,
      assignedEndAt: assignedCandidate.end_at,
    };
  }

  async findBookingAccessByReferenceOrId(identifier: string): Promise<BookingAccessRecord | null> {
    const trimmed = identifier.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const filter = isUuid
      ? `/reservations?select=*&or=(id.eq.${encodeURIComponent(trimmed)},reference_code.ilike.${encodeURIComponent(trimmed)})&limit=1`
      : `/reservations?select=*&reference_code=ilike.${encodeURIComponent(trimmed)}&limit=1`;

    const reservationRows = await this.request<any[]>(filter);
    if (!reservationRows || reservationRows.length === 0) {
      return null;
    }

    const reservation = reservationRows[0];
    let assignedCandidate = (
      await this.request<any[]>(
        `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&is_assigned=eq.true&limit=1`
      )
    )?.[0];

    if (!assignedCandidate) {
      assignedCandidate = (
        await this.request<any[]>(
          `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&order=candidate_order.asc&limit=1`
        )
      )?.[0];
    }

    if (!assignedCandidate) {
      return null;
    }

    const workspaceInstance = (
      await this.request<any[]>(
        `/workspace_instances?select=*&id=eq.${encodeURIComponent(assignedCandidate.workspace_instance_id)}&limit=1`
      )
    )?.[0];
    const workspaceTemplate = workspaceInstance
      ? (
        await this.request<any[]>(
          `/workspace_templates?select=*&id=eq.${encodeURIComponent(workspaceInstance.template_id)}&limit=1`
        )
      )?.[0]
      : null;
    const floor = workspaceInstance
      ? (
        await this.request<any[]>(
          `/floors?select=*&id=eq.${encodeURIComponent(workspaceInstance.floor_id)}&limit=1`
        )
      )?.[0]
      : null;

    return {
      reservationId: reservation.id,
      referenceCode: reservation.reference_code,
      reservationStatus: reservation.status,
      customerFirstName: reservation.customer_first_name,
      customerLastName: reservation.customer_last_name,
      customerEmail: reservation.customer_email,
      bookingTokenHash: reservation.booking_token_hash ?? "",
      bookingToken: reservation.booking_token ?? null,
      qrIssuedAt: reservation.qr_issued_at ?? reservation.created_at,
      qrRevokedAt: reservation.qr_revoked_at ?? null,
      checkedInAt: reservation.checked_in_at,
      checkedOutAt: reservation.checked_out_at,
      assignedWorkspaceInstanceId: assignedCandidate.workspace_instance_id,
      assignedWorkspaceDisplayName:
        workspaceInstance?.display_name ?? workspaceInstance?.instance_code ?? assignedCandidate.workspace_instance_id,
      assignedWorkspaceInstanceCode:
        workspaceInstance?.instance_code ?? assignedCandidate.workspace_instance_id,
      assignedWorkspaceTemplateName: workspaceTemplate?.name ?? "Workspace",
      assignedFloorName: floor?.name ?? "Unknown Floor",
      assignedStartAt: assignedCandidate.start_at,
      assignedEndAt: assignedCandidate.end_at,
    };
  }

  async recordBookingScan(input: {
    reservationId: string;
    scannedAt: string;
    accessState: BookingAccessState;
    actorUserId?: string | null;
    actorRole?: "ADMIN" | "STAFF" | "SYSTEM" | null;
    reentry?: boolean;
    checkIn?: boolean;
  }): Promise<void> {
    const isReentry = Boolean(input.reentry);
    const isCheckIn = Boolean(input.checkIn);
    const actorUserId = input.actorUserId ?? null;
    let actorRole = input.actorRole ?? (actorUserId ? "STAFF" : "SYSTEM");
    if (!actorUserId && !input.actorRole) {
      actorRole = "SYSTEM";
    }

    if (isCheckIn) {
      try {
        const patchRes = await fetch(`${this.restUrl}/reservations?id=eq.${input.reservationId}`, {
          method: "PATCH",
          headers: {
            apikey: this.serviceRoleKey,
            Authorization: `Bearer ${this.serviceRoleKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          cache: "no-store",
          body: JSON.stringify({
            status: "CHECKED_IN",
            checked_in_at: input.scannedAt,
            updated_at: input.scannedAt,
          }),
        });
        if (!patchRes.ok) {
          const detail = await patchRes.text();
          console.error("Failed to update reservation to CHECKED_IN on scan:", detail);
        }
      } catch (err) {
        console.error("Network error updating reservation to CHECKED_IN on scan:", err);
      }
    }

    const action = isCheckIn
      ? "reservation_checked_in"
      : isReentry
      ? "reservation_reentered"
      : "booking_qr_scanned";

    const eventType = isCheckIn
      ? "CHECK_IN"
      : isReentry
      ? "RE_ENTRY"
      : "QR_SCAN";

    let actorDisplayName: string | null = null;
    if (actorUserId) {
      try {
        const staffRes = await this.request<any[]>(
          `/staff_profiles?user_id=eq.${encodeURIComponent(actorUserId)}&select=display_name&limit=1`
        );
        if (Array.isArray(staffRes) && staffRes[0]?.display_name) {
          actorDisplayName = staffRes[0].display_name;
        }
      } catch {
        // fallback
      }
    }
    const resolvedActorName =
      actorDisplayName ||
      (actorRole === "ADMIN" ? "Admin" : actorRole === "STAFF" ? "Staff" : null);

    const response = await fetch(`${this.restUrl}/audit_logs`, {
      method: "POST",
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      cache: "no-store",
      body: JSON.stringify({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action,
        entity_type: "reservation",
        entity_id: input.reservationId,
        metadata: {
          access_state: input.accessState,
          scanned_at: input.scannedAt,
          reentry: isReentry,
          event_type: eventType,
          actor_name: resolvedActorName,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${detail}`);
    }
  }

  async listOperationalReservations(_nowIso: string): Promise<StaffOperationalReservation[]> {
    const reservations = await this.request<any[]>(
      "/reservations?select=*&status=in.(CONFIRMED,CHECKED_IN,COMPLETED,PENDING_COUNTER_CONFIRMATION)&order=created_at.desc&limit=200"
    );

    const summaries = await Promise.all(
      reservations.map((reservation) => this.loadOperationalReservation(reservation.id, reservation))
    );

    return summaries
      .filter((summary): summary is StaffOperationalReservation => summary !== null)
      .sort(compareOperationalReservations);
  }

  async getOperationalReservation(
    idOrReferenceCode: string
  ): Promise<StaffOperationalReservation | null> {
    return this.loadOperationalReservation(idOrReferenceCode);
  }

  async listOccupancy(nowIso: string): Promise<OccupancyRecord[]> {
    const reservations = await this.request<any[]>(
      "/reservations?select=*&status=in.(CONFIRMED,CHECKED_IN)&limit=200"
    );

    const summaries = await Promise.all(
      reservations.map((reservation) => this.loadOperationalReservation(reservation.id, reservation))
    );

    return summaries
      .filter((summary): summary is StaffOperationalReservation => summary !== null)
      .filter(
        (summary) =>
          summary.bookingStartAt !== null &&
          summary.bookingEndAt !== null &&
          (summary.reservationStatus === "CHECKED_IN" ||
            summary.checkInState === "CHECKED_IN" ||
            (summary.bookingStartAt <= nowIso && nowIso <= summary.bookingEndAt)) &&
          nowIso <= summary.bookingEndAt
      )
      .map(
        (summary) =>
          ({
            ...summary,
            occupancyState:
              summary.reservationStatus === "CHECKED_IN" ? "OCCUPIED" : "RESERVED",
          }) satisfies OccupancyRecord
      )
      .sort(compareOperationalReservations);
  }

  async listOperationalActivity(limit: number): Promise<OperationalActivityRecord[]> {
    const rows = await this.request<any[]>(
      `/audit_logs?select=*&action=in.(reservation_checked_in,reservation_checked_out,reservation_reentered)&order=created_at.desc&limit=${limit}`
    );

    const actorUserIds = Array.from(
      new Set(
        rows
          .map((r) => r.actor_user_id)
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      )
    );

    const profileMap = new Map<string, string>();
    if (actorUserIds.length > 0) {
      try {
        const idFilter = actorUserIds.map((id) => encodeURIComponent(id)).join(",");
        const profiles = await this.request<any[]>(
          `/staff_profiles?select=user_id,display_name&user_id=in.(${idFilter})`
        );
        if (Array.isArray(profiles)) {
          for (const p of profiles) {
            if (p.user_id && p.display_name) {
              profileMap.set(p.user_id, p.display_name);
            }
          }
        }
      } catch {
        // non-blocking fallback
      }
    }

    const events: (OperationalActivityRecord | null)[] = await Promise.all(
      rows.map(async (row): Promise<OperationalActivityRecord | null> => {
        const summary = await this.loadOperationalReservation(row.entity_id);
        if (!summary) {
          return null;
        }

        const resolvedActorName =
          row.metadata?.actor_name ||
          (row.actor_user_id ? profileMap.get(row.actor_user_id) : undefined) ||
          (row.actor_role === "ADMIN" ? "Admin" : row.actor_role === "STAFF" ? "Staff" : null);

        return {
          reservationId: summary.reservationId,
          referenceCode: summary.referenceCode,
          customerName: `${summary.customerFirstName} ${summary.customerLastName}`.trim(),
          workspaceDisplayName: summary.workspaceDisplayName,
          workspaceInstanceCode: summary.workspaceInstanceCode,
          activityType:
            row.action === "reservation_checked_out"
              ? "CHECK_OUT"
              : (row.action === "reservation_reentered" || row.metadata?.reentry === true || row.metadata?.event_type === "RE_ENTRY")
                ? "REENTRY"
                : "CHECK_IN",
          occurredAt: row.created_at,
          actorUserId: row.actor_user_id,
          actorRole: row.actor_role,
          actorName: resolvedActorName,
        };
      })
    );

    const filtered: OperationalActivityRecord[] = [];
    for (const event of events) {
      if (event !== null) {
        filtered.push(event);
      }
    }
    return filtered;
  }

  async listReportReservations(): Promise<ReportReservationRecord[]> {
    const [reservations, candidatesRows, instancesRows, templatesRows, floorsRows] =
      await Promise.all([
        this.request<any[]>("/reservations?select=*&order=created_at.desc&limit=500"),
        this.request<any[]>("/reservation_candidates?select=*&order=rank.asc"),
        this.request<any[]>("/workspace_instances?select=*"),
        this.request<any[]>("/workspace_templates?select=*"),
        this.request<any[]>("/floors?select=*"),
      ]);

    if (!reservations || reservations.length === 0) {
      return [];
    }

    const candidatesByReservation = new Map<string, any[]>();
    for (const c of candidatesRows ?? []) {
      const list = candidatesByReservation.get(c.reservation_id) ?? [];
      list.push(c);
      candidatesByReservation.set(c.reservation_id, list);
    }

    const instancesById = new Map<string, any>((instancesRows ?? []).map((i) => [i.id, i]));
    const templatesById = new Map<string, any>((templatesRows ?? []).map((t) => [t.id, t]));
    const floorsById = new Map<string, any>((floorsRows ?? []).map((f) => [f.id, f]));

    return reservations
      .map((r) => {
        const candidateList = candidatesByReservation.get(r.id) ?? [];
        const assignedCandidate =
          candidateList.find((entry) => entry.is_assigned === true) ?? candidateList[0] ?? null;
        const workspaceInstance = assignedCandidate
          ? instancesById.get(assignedCandidate.workspace_instance_id)
          : null;
        const workspaceTemplate = workspaceInstance
          ? templatesById.get(workspaceInstance.template_id)
          : null;
        const floor = workspaceInstance ? floorsById.get(workspaceInstance.floor_id) : null;

        return {
          reservationId: r.id,
          referenceCode: r.reference_code,
          source: r.source,
          customerFirstName: r.customer_first_name,
          customerLastName: r.customer_last_name,
          customerEmail: r.customer_email,
          reservationStatus: r.status,
          amountDue: Number(r.amount_due),
          currency: r.currency,
          createdAt: r.created_at,
          confirmedAt: r.confirmed_at,
          checkedInAt: r.checked_in_at,
          checkedOutAt: r.checked_out_at,
          bookingStartAt: assignedCandidate?.start_at ?? null,
          bookingEndAt: assignedCandidate?.end_at ?? null,
          assignedCandidateRank: assignedCandidate?.is_assigned ? assignedCandidate.rank : null,
          workspaceDisplayName:
            workspaceInstance?.display_name ?? workspaceInstance?.instance_code ?? null,
          workspaceInstanceCode: workspaceInstance?.instance_code ?? null,
          workspaceTemplateName: workspaceTemplate?.name ?? null,
          floorName: floor?.name ?? null,
        } satisfies ReportReservationRecord;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listReportPaymentAttempts(): Promise<ReportPaymentAttemptRecord[]> {
    const attempts = await this.request<any[]>(
      "/payment_attempts?select=*&order=created_at.desc&limit=500"
    );
    const reservations = await this.request<any[]>(
      "/reservations?select=id,reference_code,amount_due,currency"
    );
    const paymentMethods = await this.request<any[]>(
      "/payment_methods?select=id,method_type,display_name"
    );

    const reservationsById = new Map(
      reservations.map((reservation) => [reservation.id, reservation] as const)
    );
    const paymentMethodsById = new Map(
      paymentMethods.map((method) => [method.id, method] as const)
    );

    return attempts
      .map((attempt) => {
        const reservation = reservationsById.get(attempt.reservation_id);
        const method = attempt.payment_method_id
          ? paymentMethodsById.get(attempt.payment_method_id)
          : null;

        return {
          paymentAttemptId: attempt.id,
          reservationId: attempt.reservation_id,
          reservationReferenceCode: reservation?.reference_code ?? "",
          channel: attempt.channel,
          paymentStatus: attempt.status,
          refundStatus: attempt.refund_status,
          amount: Number(attempt.amount ?? reservation?.amount_due ?? 0),
          currency: reservation?.currency ?? "PHP",
          paymentMethodId: attempt.payment_method_id,
          paymentMethodType: method?.method_type ?? null,
          paymentMethodDisplayName: method?.display_name ?? null,
          createdAt: attempt.created_at,
          proofSubmittedAt: attempt.proof_submitted_at,
          processedAt: attempt.processed_at,
        } satisfies ReportPaymentAttemptRecord;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async findGuestReservationTrackingRecord(input: {
    referenceCode: string;
    customerEmail?: string;
  }): Promise<GuestReservationTrackingRecord | null> {
    const emailFilter = input.customerEmail
      ? `&customer_email=ilike.${encodeURIComponent(input.customerEmail.trim())}`
      : "";
    const reservation = (
      await this.request<any[]>(
        `/reservations?select=*&reference_code=eq.${encodeURIComponent(input.referenceCode.trim().toUpperCase())}${emailFilter}&limit=1`
      )
    )?.[0];

    if (!reservation) {
      return null;
    }

    const candidate = (
      await this.request<any[]>(
        `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&is_assigned=eq.true&limit=1`
      )
    )?.[0];

    const workspaceInstance = candidate
      ? (
        await this.request<any[]>(
          `/workspace_instances?select=*&id=eq.${encodeURIComponent(candidate.workspace_instance_id)}&limit=1`
        )
      )?.[0]
      : null;
    const workspaceTemplate = workspaceInstance
      ? (
        await this.request<any[]>(
          `/workspace_templates?select=*&id=eq.${encodeURIComponent(workspaceInstance.template_id)}&limit=1`
        )
      )?.[0]
      : null;
    const floor = workspaceInstance
      ? (
        await this.request<any[]>(
          `/floors?select=*&id=eq.${encodeURIComponent(workspaceInstance.floor_id)}&limit=1`
        )
      )?.[0]
      : null;

    const paymentAttempt = (
      await this.request<any[]>(
        `/payment_attempts?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&order=created_at.desc&limit=1`
      )
    )?.[0];

    const auditLogs = await this.request<any[]>(
      `/audit_logs?entity_type=eq.reservation&entity_id=eq.${encodeURIComponent(reservation.id)}&order=created_at.desc&limit=10`
    ).catch(() => []);

    let pendingRelocationRequest: CustomerRelocationRequest | null = null;
    const reqEvents = (auditLogs ?? []).filter((a) => a.action === "reservation_relocation_requested");
    if (reqEvents.length > 0) {
      const latestReq = reqEvents[0];
      const reqTime = latestReq.created_at;
      const subsequentDecisions = (auditLogs ?? []).filter(
        (a) =>
          (a.action === "reservation_relocation_approved" ||
            a.action === "reservation_relocation_declined" ||
            a.action === "reservation_relocated") &&
          (a.created_at || "") > reqTime
      );
      if (subsequentDecisions.length === 0) {
        pendingRelocationRequest = {
          requestId: latestReq.id || latestReq.metadata?.request_id || "req",
          targetWorkspaceInstanceId: latestReq.metadata?.target_workspace_instance_id,
          targetWorkspaceDisplayName: latestReq.metadata?.target_workspace_name || "Target Spot",
          reason: latestReq.metadata?.reason || "Spot Issue",
          notes: latestReq.metadata?.notes ?? null,
          requestedAt: latestReq.created_at,
          status: "PENDING",
        };
      }
    }

    return {
      reservationId: reservation.id,
      referenceCode: reservation.reference_code,
      customerEmail: reservation.customer_email,
      reservationStatus: reservation.status,
      amountDue: Number(reservation.amount_due),
      currency: reservation.currency,
      confirmedAt: reservation.confirmed_at,
      checkedOutAt: reservation.checked_out_at,
      finalAssignment: candidate
        ? {
          workspaceInstanceId: candidate.workspace_instance_id,
          workspaceDisplayName:
            workspaceInstance?.display_name ??
            workspaceInstance?.instance_code ??
            candidate.workspace_instance_id,
          workspaceInstanceCode:
            workspaceInstance?.instance_code ?? candidate.workspace_instance_id,
          workspaceTemplateName: workspaceTemplate?.name ?? "Workspace",
          floorName: floor?.name ?? "Unknown Floor",
          bookingStartAt: candidate.start_at,
          bookingEndAt: candidate.end_at,
        }
        : null,
      paymentStatus: paymentAttempt?.status ?? null,
      rejectionReason: paymentAttempt?.rejection_reason ?? null,
      rescheduleCount: reservation.reschedule_count ?? 0,
      pendingRelocationRequest,
    };
  }

  async checkInReservation(input: {
    reservationId: string;
    actorUserId: string;
    actorRole: "ADMIN" | "STAFF";
    actedAt: string;
  }): Promise<ReservationOperationalActionResult> {
    let result: any[];
    try {
      result = await this.request<any[]>("/rpc/check_in_reservation", {
        method: "POST",
        body: JSON.stringify({
          p_reservation_id: input.reservationId,
          p_actor_user_id: input.actorUserId,
          p_acted_at: input.actedAt,
        }),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Reservation is not currently active for check-in")) {
        throw new StaffOperationsError("Reservation is not currently active for check-in.");
      }
      if (msg.includes("Reservation was not found")) {
        throw new StaffOperationsError("Reservation was not found.");
      }
      if (msg.includes("Reservation has no assigned workspace to check in")) {
        throw new StaffOperationsError("Reservation has no assigned workspace to check in.");
      }
      if (msg.includes("Reservation is not in a check-in state")) {
        throw new StaffOperationsConflictError("Reservation is not in a check-in state.");
      }
      throw error;
    }

    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("Failed to check in reservation.");
    }

    const summary = await this.loadOperationalReservation(input.reservationId);
    if (!summary) {
      throw new Error("Checked-in reservation could not be loaded.");
    }

    return {
      ...summary,
      action: "CHECK_IN",
      actedAt: input.actedAt,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      reentry: Boolean(result[0].reentry),
    };
  }

  async checkOutReservation(input: {
    reservationId: string;
    actorUserId: string;
    actorRole: "ADMIN" | "STAFF";
    actedAt: string;
  }): Promise<ReservationOperationalActionResult> {
    try {
      await this.request<any[]>("/rpc/check_out_reservation", {
        method: "POST",
        body: JSON.stringify({
          p_reservation_id: input.reservationId,
          p_actor_user_id: input.actorUserId,
          p_acted_at: input.actedAt,
        }),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Reservation is not currently checked in")) {
        throw new StaffOperationsConflictError("Reservation is not currently checked in.");
      }
      if (msg.includes("Reservation was not found")) {
        throw new StaffOperationsError("Reservation was not found.");
      }
      throw error;
    }

    const summary = await this.loadOperationalReservation(input.reservationId);
    if (!summary) {
      throw new Error("Checked-out reservation could not be loaded.");
    }

    return {
      ...summary,
      action: "CHECK_OUT",
      actedAt: input.actedAt,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      reentry: false,
    };
  }

  private async loadPaymentReview(
    paymentAttemptId: string,
    attemptRow?: any
  ): Promise<PaymentReviewDetail | null> {
    let attempt = attemptRow;
    if (!attempt) {
      const attempts = await this.request<any[]>(
        `/payment_attempts?select=*&id=eq.${encodeURIComponent(paymentAttemptId)}&limit=1`
      );
      if (attempts && attempts.length > 0) {
        attempt = attempts[0];
      } else {
        // Fallback: check if identifier is reservation_id
        const resAttempts = await this.request<any[]>(
          `/payment_attempts?select=*&reservation_id=eq.${encodeURIComponent(paymentAttemptId)}&order=created_at.desc&limit=1`
        );
        if (resAttempts && resAttempts.length > 0) {
          attempt = resAttempts[0];
        } else {
          // Fallback: check if identifier is reservation reference_code
          const res = await this.request<any[]>(
            `/reservations?select=id&reference_code=eq.${encodeURIComponent(paymentAttemptId)}&limit=1`
          );
          if (res && res.length > 0) {
            const byRefAttempts = await this.request<any[]>(
              `/payment_attempts?select=*&reservation_id=eq.${encodeURIComponent(res[0].id)}&order=created_at.desc&limit=1`
            );
            if (byRefAttempts && byRefAttempts.length > 0) {
              attempt = byRefAttempts[0];
            }
          }
        }
      }
    }

    if (!attempt) {
      return null;
    }

    if (attempt.channel !== "WEB") {
      return null;
    }

    const reservation = (
      await this.request<any[]>(
        `/reservations?select=*&id=eq.${encodeURIComponent(attempt.reservation_id)}&limit=1`
      )
    )?.[0];

    if (!reservation) {
      return null;
    }

    const candidatesRows = await this.request<any[]>(
      `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&order=rank.asc`
    );

    const instanceIds = candidatesRows
      .map((c: any) => c.workspace_instance_id)
      .filter((id: any): id is string => Boolean(id));

    let instancesById = new Map<string, any>();
    let templatesById = new Map<string, any>();
    let floorsById = new Map<string, any>();

    if (instanceIds.length > 0) {
      const uniqueInstanceIds = Array.from(new Set(instanceIds));
      const instances = await this.request<any[]>(
        `/workspace_instances?select=*&id=in.(${uniqueInstanceIds.map(encodeURIComponent).join(",")})`
      );
      if (instances && Array.isArray(instances)) {
        instancesById = new Map(instances.map((i: any) => [i.id, i]));
        const templateIds = Array.from(
          new Set(instances.map((i: any) => i.template_id).filter(Boolean))
        );
        const floorIds = Array.from(
          new Set(instances.map((i: any) => i.floor_id).filter(Boolean))
        );

        if (templateIds.length > 0) {
          const templates = await this.request<any[]>(
            `/workspace_templates?select=*&id=in.(${templateIds.map(encodeURIComponent).join(",")})`
          );
          if (templates && Array.isArray(templates)) {
            templatesById = new Map(templates.map((t: any) => [t.id, t]));
          }
        }

        if (floorIds.length > 0) {
          const floors = await this.request<any[]>(
            `/floors?select=*&id=in.(${floorIds.map(encodeURIComponent).join(",")})`
          );
          if (floors && Array.isArray(floors)) {
            floorsById = new Map(floors.map((f: any) => [f.id, f]));
          }
        }
      }
    }

    const candidates: ReservationCandidate[] = candidatesRows.map((candidate: any) => {
      const instance = instancesById.get(candidate.workspace_instance_id);
      const template = instance ? templatesById.get(instance.template_id) : null;
      const floor = instance ? floorsById.get(instance.floor_id) : null;

      return {
        id: candidate.id,
        reservationId: candidate.reservation_id,
        rank: candidate.rank,
        workspaceInstanceId: candidate.workspace_instance_id,
        startAt: candidate.start_at,
        endAt: candidate.end_at,
        isAssigned: candidate.is_assigned,
        workspaceDisplayName:
          instance?.display_name ?? instance?.instance_code ?? candidate.workspace_instance_id,
        workspaceInstanceCode:
          instance?.instance_code ?? candidate.workspace_instance_id,
        workspaceTemplateName: template?.name ?? undefined,
        floorName: floor?.name ?? undefined,
      };
    });

    return {
      paymentAttemptId: attempt.id,
      reservationId: reservation.id,
      reservationReferenceCode: reservation.reference_code,
      reservationStatus: reservation.status,
      paymentStatus: attempt.status,
      customerFirstName: reservation.customer_first_name,
      customerLastName: reservation.customer_last_name,
      customerEmail: reservation.customer_email,
      amountDue: Number(reservation.amount_due),
      currency: reservation.currency,
      paymentMethodId: attempt.payment_method_id,
      proofSubmittedAt: attempt.proof_submitted_at,
      submittedCandidates: candidates,
      proofStoragePath: attempt.proof_storage_path,
      rejectionReason: attempt.rejection_reason,
      refundStatus: attempt.refund_status,
      processedAt: attempt.processed_at,
      processedByUserId: attempt.processed_by_user_id,
    };
  }

  private mapDecisionResult(row: any): PaymentReviewDecisionResult {
    const assignedCandidate =
      row.assigned_candidate_id && row.assigned_candidate_rank !== null
        ? {
          id: row.assigned_candidate_id,
          reservationId: row.reservation_id,
          rank: row.assigned_candidate_rank,
          workspaceInstanceId: row.assigned_workspace_instance_id,
          startAt: row.assigned_start_at,
          endAt: row.assigned_end_at,
          isAssigned: true,
        }
        : null;

    return {
      paymentAttemptId: row.payment_attempt_id,
      reservationId: row.reservation_id,
      reservationReferenceCode: row.reservation_reference_code,
      reservationStatus: row.reservation_status,
      paymentStatus: row.payment_status,
      refundStatus: row.refund_status,
      assignedCandidate,
      assignedCandidateRank: assignedCandidate?.rank ?? null,
      rejectionReason: row.rejection_reason,
      processedAt: row.processed_at,
      processedByUserId: row.processed_by_user_id,
    };
  }

  private async loadOperationalReservation(
    idOrReferenceCode: string,
    reservationRow?: any
  ): Promise<StaffOperationalReservation | null> {
    let reservation = reservationRow;
    if (!reservation) {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          idOrReferenceCode
        );
      const filter = isUuid
        ? `id=eq.${encodeURIComponent(idOrReferenceCode)}`
        : `reference_code=eq.${encodeURIComponent(idOrReferenceCode)}`;

      reservation = (
        await this.request<any[]>(
          `/reservations?select=*&${filter}&limit=1`
        )
      )?.[0];
    }

    if (!reservation || !["CONFIRMED", "CHECKED_IN", "COMPLETED", "PENDING_COUNTER_CONFIRMATION"].includes(reservation.status)) {
      return null;
    }

    const candidateRows = await this.request<any[]>(
      `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&order=rank.asc`
    );

    const candidate =
      candidateRows.find((entry) => entry.is_assigned === true) ?? candidateRows[0] ?? null;

    const workspaceInstance = candidate
      ? (
        await this.request<any[]>(
          `/workspace_instances?select=*&id=eq.${encodeURIComponent(candidate.workspace_instance_id)}&limit=1`
        )
      )?.[0]
      : null;
    const workspaceTemplate = workspaceInstance
      ? (
        await this.request<any[]>(
          `/workspace_templates?select=*&id=eq.${encodeURIComponent(workspaceInstance.template_id)}&limit=1`
        )
      )?.[0]
      : null;
    const floor = workspaceInstance
      ? (
        await this.request<any[]>(
          `/floors?select=*&id=eq.${encodeURIComponent(workspaceInstance.floor_id)}&limit=1`
        )
      )?.[0]
      : null;

    let pendingRelocationRequest: CustomerRelocationRequest | null = null;
    try {
      const auditLogs = await this.request<any[]>(
        `/audit_logs?select=*&entity_type=eq.reservation&entity_id=eq.${encodeURIComponent(reservation.id)}&order=created_at.desc&limit=10`
      );
      const reqEvents = (auditLogs ?? []).filter((a) => a.action === "reservation_relocation_requested");
      if (reqEvents.length > 0) {
        const latestReq = reqEvents[0];
        const reqTime = latestReq.created_at;
        const subsequentDecisions = (auditLogs ?? []).filter(
          (a) =>
            (a.action === "reservation_relocation_approved" ||
              a.action === "reservation_relocation_declined" ||
              a.action === "reservation_relocated" ||
              a.action === "RESERVATION_RELOCATED") &&
            (a.created_at || "") > reqTime
        );
        if (subsequentDecisions.length === 0) {
          pendingRelocationRequest = {
            requestId: latestReq.id || latestReq.metadata?.request_id || "req",
            targetWorkspaceInstanceId: latestReq.metadata?.target_workspace_instance_id,
            targetWorkspaceDisplayName: latestReq.metadata?.target_workspace_name || "Target Spot",
            reason: latestReq.metadata?.reason || "Spot Issue",
            notes: latestReq.metadata?.notes ?? null,
            requestedAt: latestReq.created_at,
            status: "PENDING",
          };
        }
      }
    } catch {
      // non-blocking fallback
    }

    return {
      reservationId: reservation.id,
      referenceCode: reservation.reference_code,
      source: reservation.source,
      customerFirstName: reservation.customer_first_name,
      customerLastName: reservation.customer_last_name,
      customerEmail: reservation.customer_email,
      reservationStatus: reservation.status,
      checkInState: getCheckInState(reservation.checked_in_at, reservation.checked_out_at),
      workspaceInstanceId: candidate?.workspace_instance_id ?? null,
      workspaceDisplayName:
        workspaceInstance?.display_name ?? workspaceInstance?.instance_code ?? null,
      workspaceInstanceCode: workspaceInstance?.instance_code ?? null,
      workspaceTemplateName: workspaceTemplate?.name ?? null,
      floorName: floor?.name ?? null,
      bookingStartAt: candidate?.start_at ?? null,
      bookingEndAt: candidate?.end_at ?? null,
      confirmedAt: reservation.confirmed_at,
      checkedInAt: reservation.checked_in_at,
      checkedOutAt: reservation.checked_out_at,
      qrIssuedAt: reservation.qr_issued_at,
      pendingRelocationRequest,
    };
  }

  private async loadReportReservation(
    reservationId: string,
    reservationRow?: any
  ): Promise<ReportReservationRecord | null> {
    const reservation =
      reservationRow ??
      (
        await this.request<any[]>(
          `/reservations?select=*&id=eq.${encodeURIComponent(reservationId)}&limit=1`
        )
      )?.[0];

    if (!reservation) {
      return null;
    }

    const candidateRows = await this.request<any[]>(
      `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(reservation.id)}&order=rank.asc`
    );

    const assignedCandidate =
      candidateRows.find((entry) => entry.is_assigned === true) ?? candidateRows[0] ?? null;

    const workspaceInstance = assignedCandidate
      ? (
        await this.request<any[]>(
          `/workspace_instances?select=*&id=eq.${encodeURIComponent(assignedCandidate.workspace_instance_id)}&limit=1`
        )
      )?.[0]
      : null;
    const workspaceTemplate = workspaceInstance
      ? (
        await this.request<any[]>(
          `/workspace_templates?select=*&id=eq.${encodeURIComponent(workspaceInstance.template_id)}&limit=1`
        )
      )?.[0]
      : null;
    const floor = workspaceInstance
      ? (
        await this.request<any[]>(
          `/floors?select=*&id=eq.${encodeURIComponent(workspaceInstance.floor_id)}&limit=1`
        )
      )?.[0]
      : null;

    return {
      reservationId: reservation.id,
      referenceCode: reservation.reference_code,
      source: reservation.source,
      customerFirstName: reservation.customer_first_name,
      customerLastName: reservation.customer_last_name,
      customerEmail: reservation.customer_email,
      reservationStatus: reservation.status,
      amountDue: Number(reservation.amount_due),
      currency: reservation.currency,
      createdAt: reservation.created_at,
      confirmedAt: reservation.confirmed_at,
      checkedInAt: reservation.checked_in_at,
      checkedOutAt: reservation.checked_out_at,
      bookingStartAt: assignedCandidate?.start_at ?? null,
      bookingEndAt: assignedCandidate?.end_at ?? null,
      assignedCandidateRank: assignedCandidate?.is_assigned ? assignedCandidate.rank : null,
      workspaceDisplayName:
        workspaceInstance?.display_name ?? workspaceInstance?.instance_code ?? null,
      workspaceInstanceCode: workspaceInstance?.instance_code ?? null,
      workspaceTemplateName: workspaceTemplate?.name ?? null,
      floorName: floor?.name ?? null,
    };
  }

  async listAdminReservations(): Promise<AdminReservationSummary[]> {
    const reservations = await this.request<any[]>(
      "/reservations?select=*&order=created_at.desc&limit=500"
    );

    if (!reservations || reservations.length === 0) {
      return [];
    }

    const [candidatesRows, instancesRows, templatesRows, floorsRows, paymentAttemptsRows, paymentMethodsRows] =
      await Promise.all([
        this.request<any[]>("/reservation_candidates?select=*&order=rank.asc"),
        this.request<any[]>("/workspace_instances?select=*"),
        this.request<any[]>("/workspace_templates?select=*"),
        this.request<any[]>("/floors?select=*"),
        this.request<any[]>("/payment_attempts?select=*&order=created_at.desc"),
        this.request<any[]>("/payment_methods?select=*").catch(() => []),
      ]);

    const candidatesByReservation = new Map<string, any[]>();
    for (const c of candidatesRows ?? []) {
      const list = candidatesByReservation.get(c.reservation_id) ?? [];
      list.push(c);
      candidatesByReservation.set(c.reservation_id, list);
    }

    const attemptsByReservation = new Map<string, any>();
    for (const pa of paymentAttemptsRows ?? []) {
      if (!attemptsByReservation.has(pa.reservation_id)) {
        attemptsByReservation.set(pa.reservation_id, pa);
      }
    }

    const instancesById = new Map<string, any>((instancesRows ?? []).map((i) => [i.id, i]));
    const templatesById = new Map<string, any>((templatesRows ?? []).map((t) => [t.id, t]));
    const floorsById = new Map<string, any>((floorsRows ?? []).map((f) => [f.id, f]));
    const paymentMethodsById = new Map<string, any>((paymentMethodsRows ?? []).map((m) => [m.id, m]));

    return reservations.map((r) => {
      const candidates = candidatesByReservation.get(r.id) ?? [];
      const assignedCandidate = candidates.find((c) => c.is_assigned === true) ?? null;
      const mainCandidate = candidates.find((c) => c.rank === 0) ?? candidates[0] ?? null;
      const targetCandidate = assignedCandidate ?? mainCandidate;

      const instance = targetCandidate ? instancesById.get(targetCandidate.workspace_instance_id) : null;
      const template = instance ? templatesById.get(instance.template_id) : null;
      const floor = instance ? floorsById.get(instance.floor_id) : null;

      const latestAttempt = attemptsByReservation.get(r.id);
      const paymentExpiresAt = latestAttempt?.expires_at ?? null;
      const paymentMethod = latestAttempt?.payment_method_id
        ? paymentMethodsById.get(latestAttempt.payment_method_id)
        : null;

      const pres = mapStatusPresentation(r.status, latestAttempt?.status);
      const customerName = `${r.customer_first_name} ${r.customer_last_name}`.trim();
      const customerInitials = formatInitials(r.customer_first_name, r.customer_last_name);
      const schedule = formatSchedule(targetCandidate?.start_at, targetCandidate?.end_at);

      const workspaceDisplayName = assignedCandidate
        ? (instance?.display_name ?? instance?.instance_code ?? targetCandidate?.workspace_instance_id ?? "Assigned Workspace")
        : candidates.length > 1
          ? "Multiple Candidates"
          : (instance?.display_name ?? instance?.instance_code ?? template?.name ?? "Unassigned");

      const amountDue = Number(r.amount_due);
      const isApproved =
        latestAttempt?.status === "APPROVED" ||
        ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(r.status);
      const amountPaid = isApproved ? Number(latestAttempt?.amount ?? amountDue) : 0;

      return {
        id: r.id,
        referenceCode: r.reference_code,
        source: r.source,
        customerFirstName: r.customer_first_name,
        customerLastName: r.customer_last_name,
        customerName,
        customerInitials,
        customerEmail: r.customer_email,
        workspaceDisplayName,
        workspaceInstanceCode: instance?.instance_code ?? null,
        workspaceTemplateName: template?.name ?? null,
        floorName: floor?.name ?? null,
        schedule,
        startAt: targetCandidate?.start_at ?? null,
        endAt: targetCandidate?.end_at ?? null,
        paymentStatus: pres.payment,
        paymentColor: pres.paymentColor,
        reservationStatus: r.status,
        status: pres.label,
        statusStyle: pres.style,
        mark: pres.mark,
        amountDue,
        amountPaid,
        currency: r.currency,
        createdAt: r.created_at,
        confirmedAt: r.confirmed_at,
        checkedInAt: r.checked_in_at,
        checkedOutAt: r.checked_out_at,
        paymentExpiresAt,
        paymentAttemptStatus: latestAttempt?.status ?? null,
        paymentMethodId: latestAttempt?.payment_method_id ?? null,
        paymentMethodType: paymentMethod?.method_type ?? null,
        paymentMethodDisplayName: paymentMethod?.display_name ?? null,
      };
    });
  }

  async getAdminReservationDetail(idOrReferenceCode: string): Promise<AdminReservationDetail | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrReferenceCode);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(idOrReferenceCode)}`
      : `reference_code=eq.${encodeURIComponent(idOrReferenceCode)}`;

    const reservationRows = await this.request<any[]>(
      `/reservations?select=*&${filter}&limit=1`
    );

    if (!reservationRows || reservationRows.length === 0) {
      return null;
    }

    const r = reservationRows[0];

    const [candidateRows, instancesRows, templatesRows, floorsRows, paymentAttempts, auditRows] =
      await Promise.all([
        this.request<any[]>(
          `/reservation_candidates?select=*&reservation_id=eq.${encodeURIComponent(r.id)}&order=rank.asc`
        ),
        this.request<any[]>("/workspace_instances?select=*"),
        this.request<any[]>("/workspace_templates?select=*"),
        this.request<any[]>("/floors?select=*"),
        this.request<any[]>(
          `/payment_attempts?select=*&reservation_id=eq.${encodeURIComponent(r.id)}&order=created_at.desc`
        ),
        this.request<any[]>(
          `/audit_logs?select=*&entity_type=eq.reservation&entity_id=eq.${encodeURIComponent(r.id)}&order=created_at.asc`
        ).catch(() => []),
      ]);

    const instancesById = new Map<string, any>((instancesRows ?? []).map((i) => [i.id, i]));
    const templatesById = new Map<string, any>((templatesRows ?? []).map((t) => [t.id, t]));
    const floorsById = new Map<string, any>((floorsRows ?? []).map((f) => [f.id, f]));

    const candidateList = (candidateRows ?? []).map((c) => {
      const instance = instancesById.get(c.workspace_instance_id);
      const template = instance ? templatesById.get(instance.template_id) : null;
      const floor = instance ? floorsById.get(instance.floor_id) : null;

      const rank = c.rank as CandidateRank;
      const displayName = instance?.display_name ?? instance?.instance_code ?? template?.name ?? c.workspace_instance_id;

      return {
        id: c.id,
        rank,
        tier: getCandidateTier(rank),
        workspaceInstanceId: c.workspace_instance_id,
        workspaceDisplayName: displayName,
        workspaceInstanceCode: instance?.instance_code ?? null,
        workspaceTemplateName: template?.name ?? null,
        floorName: floor?.name ?? null,
        startAt: c.start_at,
        endAt: c.end_at,
        schedule: formatSchedule(c.start_at, c.end_at),
        isAssigned: Boolean(c.is_assigned),
        color: getCandidateColor(rank),
      } satisfies AdminReservationCandidateSummary;
    });

    const assigned = candidateList.find((c) => c.isAssigned) ?? null;
    const main = candidateList.find((c) => c.rank === 0) ?? candidateList[0] ?? null;
    const effective = assigned ?? main;

    const latestAttempt = (paymentAttempts ?? [])[0] ?? null;
    const isPaymentRejected =
      latestAttempt?.status === "REJECTED" ||
      (r.status === "CANCELLED" && (paymentAttempts ?? []).some((a) => a.status === "REJECTED"));

    const pres = mapStatusPresentation(r.status, isPaymentRejected ? "REJECTED" : latestAttempt?.status);
    const customerName = `${r.customer_first_name} ${r.customer_last_name}`.trim();
    const customerInitials = formatInitials(r.customer_first_name, r.customer_last_name);
    const schedule = formatSchedule(effective?.startAt, effective?.endAt);
    const duration = formatDuration(effective?.startAt, effective?.endAt);

    const proofAttempt = (paymentAttempts ?? []).find((a) => a.proof_submitted_at !== null) ?? null;
    const paymentExpiresAt = latestAttempt?.expires_at ?? null;
    const proofSubmittedAt = proofAttempt?.proof_submitted_at ?? null;

    const paymentAttemptsSummary: AdminReservationPaymentAttemptSummary[] = (paymentAttempts ?? []).map((a) => ({
      id: a.id,
      status: a.status,
      amount: Number(a.amount),
      currency: a.currency,
      channel: a.channel,
      createdAt: a.created_at,
      expiresAt: a.expires_at,
      proofSubmittedAt: a.proof_submitted_at,
      proofStoragePath: a.proof_storage_path,
      rejectionReason: a.rejection_reason,
    }));

    let expiryReason: string | null = null;
    if (r.status === "EXPIRED") {
      if (latestAttempt?.rejection_reason) {
        expiryReason = latestAttempt.rejection_reason;
      } else if (proofSubmittedAt) {
        expiryReason = "Proof submitted after payment window expired";
      } else {
        expiryReason = "1-hour payment window expired without payment proof submission";
      }
    }

    // Timeline building
    const timeline: string[] = [];
    timeline.push(
      `${formatTimelineDate(r.created_at)} - Reservation requested (${r.source === "KIOSK" ? "Kiosk" : "Web"})`
    );

    if (proofAttempt?.proof_submitted_at) {
      timeline.push(`${formatTimelineDate(proofAttempt.proof_submitted_at)} - Payment proof uploaded`);
    }

    if (r.confirmed_at) {
      timeline.push(
        `${formatTimelineDate(r.confirmed_at)} - Payment approved & Allocated to ${assigned?.workspaceDisplayName ?? "spot"}`
      );
    }

    if (r.checked_in_at) {
      timeline.push(`${formatTimelineDate(r.checked_in_at)} - Customer checked in`);
    }

    const reentries = (auditRows ?? [])
      .filter(
        (a) =>
          a.action === "reservation_reentered" ||
          (a.action === "reservation_checked_in" && a.metadata?.reentry === true) ||
          a.metadata?.reentry === true ||
          a.metadata?.event_type === "RE_ENTRY"
      )
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

    for (const re of reentries) {
      timeline.push(`${formatTimelineDate(re.created_at)} - Customer re-entered (Re-entry)`);
    }

    if (r.checked_out_at) {
      timeline.push(`${formatTimelineDate(r.checked_out_at)} - Customer checked out`);
    }

    const rescheduleEvents = (auditRows ?? []).filter(
      (a) => a.action === "reservation_rescheduled" || a.action === "RESERVATION_RESCHEDULED"
    );
    for (const res of rescheduleEvents) {
      const actorLabel = res.actor_role === "CUSTOMER" ? "Customer" : "Admin";
      timeline.push(
        `${formatTimelineDate(res.created_at)} - Rescheduled by ${actorLabel} to ${res.metadata?.new_schedule || schedule}`
      );
    }

    const extensionEvents = (auditRows ?? []).filter(
      (a) => a.action === "reservation_extended" || a.action === "RESERVATION_TIME_EXTENDED"
    );
    for (const ext of extensionEvents) {
      const actor = ext.actor_role === "STAFF" ? "Staff" : "Admin";
      const addedMinutes = ext.metadata?.added_duration_minutes;
      const durationText = addedMinutes
        ? `${addedMinutes >= 60 && addedMinutes % 60 === 0 ? `${addedMinutes / 60} hour${addedMinutes / 60 > 1 ? 's' : ''}` : `${addedMinutes} mins`}`
        : "time";
      timeline.push(
        `${formatTimelineDate(ext.created_at)} - Time extended by ${actor} by ${durationText}`
      );
    }

    const relocationEvents = (auditRows ?? []).filter(
      (a) => a.action === "reservation_relocated" || a.action === "RESERVATION_RELOCATED"
    );
    for (const rel of relocationEvents) {
      const oldName = rel.metadata?.old_workspace_name || "previous spot";
      const newName = rel.metadata?.new_workspace_name || "new spot";
      const reason = rel.metadata?.reason || "Maintenance";
      const notesStr = rel.metadata?.notes ? ` (${rel.metadata.notes})` : "";
      const actorRole = rel.metadata?.actor_role || rel.actor_role || "ADMIN";
      const actorLabel =
        actorRole === "STAFF"
          ? "Staff"
          : actorRole === "CUSTOMER"
          ? "Customer"
          : actorRole === "SUPERADMIN" || actorRole === "SUPER_ADMIN"
          ? "Super Admin"
          : "Admin";
      const inSession = Boolean(rel.metadata?.in_session);
      const remainingMinutes = rel.metadata?.remaining_minutes;

      if (inSession && remainingMinutes) {
        const remainingHours = Math.floor(remainingMinutes / 60);
        const remMins = remainingMinutes % 60;
        const remText =
          remainingHours > 0
            ? `${remainingHours}h${remMins > 0 ? ` ${remMins}m` : ""}`
            : `${remMins}m`;

        timeline.push(
          `${formatTimelineDate(rel.created_at)} - In-session spot relocated from ${oldName} to ${newName} by ${actorLabel} for remaining time (${remText} remaining). Reason: ${reason}${notesStr}`
        );
      } else {
        timeline.push(
          `${formatTimelineDate(rel.created_at)} - Relocated by ${actorLabel} from ${oldName} to ${newName} due to: ${reason}${notesStr}`
        );
      }
    }

    let pendingRelocationRequest: CustomerRelocationRequest | null = null;
    const reqEvents = (auditRows ?? [])
      .filter((a) => a.action === "reservation_relocation_requested")
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    if (reqEvents.length > 0) {
      const latestReq = reqEvents[0];
      const reqTime = latestReq.created_at;
      const subsequentDecisions = (auditRows ?? []).filter(
        (a) =>
          (a.action === "reservation_relocation_approved" ||
            a.action === "reservation_relocation_declined" ||
            a.action === "reservation_relocated" ||
            a.action === "RESERVATION_RELOCATED") &&
          (a.created_at || "") > reqTime
      );
      if (subsequentDecisions.length === 0) {
        pendingRelocationRequest = {
          requestId: latestReq.id || latestReq.metadata?.request_id || "req",
          targetWorkspaceInstanceId: latestReq.metadata?.target_workspace_instance_id,
          targetWorkspaceDisplayName: latestReq.metadata?.target_workspace_name || "Target Spot",
          reason: latestReq.metadata?.reason || "Spot Issue",
          notes: latestReq.metadata?.notes ?? null,
          requestedAt: latestReq.created_at,
          status: "PENDING",
        };
      }
    }

    if (pendingRelocationRequest) {
      timeline.push(
        `${formatTimelineDate(pendingRelocationRequest.requestedAt)} - Customer requested spot relocation to ${pendingRelocationRequest.targetWorkspaceDisplayName}. Reason: ${pendingRelocationRequest.reason}${pendingRelocationRequest.notes ? ` (${pendingRelocationRequest.notes})` : ""}`
      );
    }

    const declinedRelocEvents = (auditRows ?? []).filter((a) => a.action === "reservation_relocation_declined");
    for (const dec of declinedRelocEvents) {
      const decActor = dec.actor_role === "STAFF" ? "Staff" : dec.actor_role === "SUPERADMIN" ? "Super Admin" : "Admin";
      timeline.push(
        `${formatTimelineDate(dec.created_at)} - Customer spot relocation request declined by ${decActor}. Reason: ${dec.metadata?.notes || "Unavailable"}`
      );
    }

    if (r.status === "CANCELLED") {
      const cancelReasonStr = r.cancellation_reason ? ` (${r.cancellation_reason})` : "";
      timeline.push(`${formatTimelineDate(r.cancelled_at || r.updated_at)} - Reservation cancelled${cancelReasonStr}`);
    } else if (r.status === "EXPIRED") {
      timeline.push(`${formatTimelineDate(r.updated_at)} - Payment session expired (${expiryReason ?? "Window elapsed"})`);
    } else if (r.status === "NEEDS_MANUAL_RESOLUTION") {
      timeline.push(`${formatTimelineDate(r.updated_at)} - Needs manual resolution`);
    }

    const amountDue = Number(r.amount_due);
    const formattedPaymentStatus = `${pres.payment} (${formatAmountWithCurrency(amountDue, r.currency)})`;

    return {
      id: r.id,
      referenceCode: r.reference_code,
      source: r.source,
      customerFirstName: r.customer_first_name,
      customerLastName: r.customer_last_name,
      customerName,
      customerInitials,
      customerEmail: r.customer_email,
      reservationStatus: r.status,
      status: pres.label,
      statusStyle: pres.style,
      mark: pres.mark,
      schedule,
      duration,
      startAt: effective?.startAt ?? null,
      endAt: effective?.endAt ?? null,
      paymentStatus: formattedPaymentStatus,
      paymentColor: pres.paymentColor,
      amountDue,
      currency: r.currency,
      rateSnapshot: Number(r.rate_snapshot),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      confirmedAt: r.confirmed_at,
      checkedInAt: r.checked_in_at,
      checkedOutAt: r.checked_out_at,
      qrIssuedAt: r.qr_issued_at,
      qrRevokedAt: r.qr_revoked_at,
      hasBookingQr: Boolean(r.qr_issued_at && !r.qr_revoked_at),
      bookingToken: r.booking_token ?? null,
      bookingAccessUrl: r.booking_token
        ? `${(process.env.BOOKING_ACCESS_BASE_URL ?? process.env.DESKATLAS_PUBLIC_APP_URL ?? "https://deskatlas.test/booking").replace(/\/$/, "")}/${encodeURIComponent(r.booking_token)}`
        : null,
      assignedCandidate: assigned,
      candidates: candidateList,
      timeline,
      paymentExpiresAt,
      paymentAttemptStatus: latestAttempt?.status ?? null,
      proofSubmittedAt,
      expiryReason,
      cancellationReason: r.cancellation_reason ?? null,
      cancelledAt: r.cancelled_at ?? null,
      rescheduleCount: r.reschedule_count ?? 0,
      paymentAttempts: paymentAttemptsSummary,
      pendingRelocationRequest,
    };
  }

  async cancelReservation(input: {
    reservationId: string;
    reason: string;
    notes?: string;
    actorUserId?: string;
    actorRole?: string;
  }): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`);
    if (!reservationRows || reservationRows.length === 0) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    const r = reservationRows[0];
    const nowIso = new Date().toISOString();
    const fullReason = input.notes ? `${input.reason} - ${input.notes}` : input.reason;

    try {
      await this.request("/rpc/cancel_reservation", {
        method: "POST",
        body: JSON.stringify({
          p_reservation_id: r.id,
          p_cancellation_reason: fullReason,
          p_cancelled_at: nowIso,
          p_actor_user_id: input.actorUserId ?? null,
          p_actor_role: input.actorRole ?? "ADMIN",
        }),
      });
    } catch (rpcErr: any) {
      if (
        rpcErr?.message?.includes("PGRST202") ||
        rpcErr?.message?.includes("Could not find the function") ||
        rpcErr?.message?.includes("404")
      ) {
        throw new Error(
          "Database function public.cancel_reservation is missing in Supabase. Please run the migration in supabase/002_functions.sql in your Supabase SQL Editor to enable reservation cancellation."
        );
      }
      throw rpcErr;
    }

    const detail = await this.getAdminReservationDetail(r.id);
    if (!detail) {
      throw new Error("Failed to retrieve updated reservation detail");
    }

    return {
      success: true,
      reservation: detail,
      message: "Reservation cancelled successfully",
    };
  }

  async rescheduleReservation(input: RescheduleReservationInput): Promise<{ success: boolean; reservation: AdminReservationDetail; message?: string; oldSchedule?: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`);
    if (!reservationRows || reservationRows.length === 0) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    const r = reservationRows[0];
    if (r.status === "CANCELLED" || r.status === "EXPIRED") {
      throw new Error(`Cannot reschedule a ${r.status.toLowerCase()} reservation`);
    }

    const candidates = await this.request<any[]>(
      `/reservation_candidates?reservation_id=eq.${encodeURIComponent(r.id)}&order=rank.asc`
    );

    const assigned = (candidates ?? []).find((c) => c.is_assigned) ?? candidates?.[0];
    const targetInstanceId = input.workspaceInstanceId || assigned?.workspace_instance_id;

    if (!targetInstanceId) {
      throw new Error("Target workspace instance not specified");
    }

    const conflictingCandidates = await this.request<any[]>(
      `/reservation_candidates?workspace_instance_id=eq.${encodeURIComponent(targetInstanceId)}&is_assigned=eq.true&reservation_id=neq.${encodeURIComponent(r.id)}&select=id,start_at,end_at,reservations(id,status)`
    ).catch(() => []);

    const newStartMs = new Date(input.startAt).getTime();
    const newEndMs = new Date(input.endAt).getTime();
    const nowMs = new Date().getTime();

    if (newStartMs < nowMs) {
      throw new Error("Cannot reschedule to a past date or time.");
    }

    const isCustomerActor = input.actorRole === "CUSTOMER";
    const currentRescheduleCount = r.reschedule_count ?? 0;

    if (isCustomerActor) {
      if (currentRescheduleCount >= 1) {
        throw new Error("Customer can only reschedule a reservation once.");
      }

      if (assigned?.start_at) {
        const origStartMs = new Date(assigned.start_at).getTime();
        const cutoffHours = input.cutoffHours ?? 12;
        const cutoffMs = cutoffHours * 60 * 60 * 1000;
        if (nowMs > origStartMs - cutoffMs) {
          throw new Error(`Reschedule must be requested at least ${cutoffHours} hours before the scheduled start time.`);
        }

        if (assigned.end_at) {
          const origDurationMs = new Date(assigned.end_at).getTime() - origStartMs;
          const newDurationMs = newEndMs - newStartMs;
          if (Math.abs(origDurationMs - newDurationMs) > 60000) {
            throw new Error("Rescheduled reservation must have the exact same duration as the original booking.");
          }
        }
      }
    }

    for (const cand of conflictingCandidates ?? []) {
      const resStatus = cand.reservations?.status;
      if (resStatus === "CANCELLED" || resStatus === "EXPIRED") {
        continue;
      }
      const candStartMs = new Date(cand.start_at).getTime();
      const candEndMs = new Date(cand.end_at).getTime();
      if (newStartMs < candEndMs && newEndMs > candStartMs) {
        throw new Error("Selected workspace slot is already booked for this time window");
      }
    }

    const oldSchedule = formatSchedule(assigned?.start_at, assigned?.end_at);
    const newSchedule = formatSchedule(input.startAt, input.endAt);
    const nowIso = new Date().toISOString();

    if (assigned) {
      await this.request(`/reservation_candidates?id=eq.${encodeURIComponent(assigned.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          start_at: input.startAt,
          end_at: input.endAt,
          workspace_instance_id: targetInstanceId,
          is_assigned: true,
        }),
      });
    }

    await this.request(`/reservations?id=eq.${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        updated_at: nowIso,
        reschedule_count: currentRescheduleCount + 1,
      }),
    });

    await this.request("/audit_logs", {
      method: "POST",
      body: JSON.stringify({
        actor_user_id: input.actorUserId ?? null,
        actor_role: input.actorRole ?? "ADMIN",
        action: "reservation_rescheduled",
        entity_type: "reservation",
        entity_id: r.id,
        metadata: {
          old_schedule: oldSchedule,
          new_schedule: newSchedule,
          start_at: input.startAt,
          end_at: input.endAt,
          reference_code: r.reference_code,
          rescheduled_at: nowIso,
        },
      }),
    }).catch(() => {});

    const detail = await this.getAdminReservationDetail(r.id);
    if (!detail) {
      throw new Error("Failed to retrieve updated reservation detail");
    }

    return {
      success: true,
      reservation: detail,
      oldSchedule,
      message: "Reservation rescheduled successfully",
    };
  }

  async checkRescheduleAvailability(input: {
    reservationId: string;
    startAt?: string;
    endAt?: string;
    date?: string;
    durationHours?: number;
    workspaceInstanceId?: string;
  }): Promise<{
    available: boolean;
    reason?: string;
    workspaceInstanceId?: string;
    workspaceDisplayName?: string;
    slots?: RescheduleSlotAvailability[];
  }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`).catch(() => []);
    const r = reservationRows?.[0];

    let targetInstanceId = input.workspaceInstanceId;
    if (!targetInstanceId && r) {
      const candidates = await this.request<any[]>(
        `/reservation_candidates?reservation_id=eq.${encodeURIComponent(r.id)}&order=rank.asc`
      ).catch(() => []);
      const assigned = (candidates ?? []).find((c) => c.is_assigned) ?? candidates?.[0];
      targetInstanceId = assigned?.workspace_instance_id;
    }

    if (!targetInstanceId) {
      return { available: true };
    }

    const conflictingCandidates = await this.request<any[]>(
      `/reservation_candidates?workspace_instance_id=eq.${encodeURIComponent(targetInstanceId)}&is_assigned=eq.true${r ? `&reservation_id=neq.${encodeURIComponent(r.id)}` : ""}&select=id,start_at,end_at,reservations(id,status)`
    ).catch(() => []);

    let available = true;
    let reason: string | undefined;
    const nowMs = new Date().getTime();

    if (input.startAt && input.endAt) {
      const newStartMs = new Date(input.startAt).getTime();
      const newEndMs = new Date(input.endAt).getTime();

      if (newStartMs < nowMs) {
        available = false;
        reason = "Cannot reschedule to a past date or time";
      } else {
        for (const cand of conflictingCandidates ?? []) {
          const resStatus = cand.reservations?.status;
          if (resStatus === "CANCELLED" || resStatus === "EXPIRED") {
            continue;
          }
          const candStartMs = new Date(cand.start_at).getTime();
          const candEndMs = new Date(cand.end_at).getTime();
          if (newStartMs < candEndMs && newEndMs > candStartMs) {
            available = false;
            reason = "Spot is occupied during this time window";
            break;
          }
        }
      }
    }

    // Compute slots
    let slots: RescheduleSlotAvailability[] | undefined;
    const targetDate = input.date || (input.startAt ? input.startAt.split("T")[0] : undefined);
    const duration = input.durationHours || 2;

    if (targetDate) {
      const timeOptions = [
        '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00',
        '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'
      ];

      slots = timeOptions.map((time) => {
        const [h, m] = time.split(":").map(Number);
        const slotStart = zonedDateTimeToUtc(targetDate, time, "Asia/Manila");
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 60 * 1000);
        const startMs = slotStart.getTime();
        const endMs = slotEnd.getTime();

        const endHour = h + duration;
        const endTime = `${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        let slotAvailable = true;
        let slotReason: string | undefined;

        if (startMs < nowMs) {
          slotAvailable = false;
          slotReason = "Past";
        } else {
          for (const cand of conflictingCandidates ?? []) {
            const resStatus = cand.reservations?.status;
            if (resStatus === "CANCELLED" || resStatus === "EXPIRED") {
              continue;
            }
            const candStartMs = new Date(cand.start_at).getTime();
            const candEndMs = new Date(cand.end_at).getTime();
            if (startMs < candEndMs && endMs > candStartMs) {
              slotAvailable = false;
              slotReason = "Booked";
              break;
            }
          }
        }

        return {
          startTime: time,
          endTime,
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
          isAvailable: slotAvailable,
          reason: slotReason,
        };
      });
    }

    return {
      available,
      reason,
      workspaceInstanceId: targetInstanceId,
      slots,
    };
  }

  async listEndedReservationsForSurvey(nowIso: string): Promise<EndedReservationForSurvey[]> {
    const reservations = await this.request<any[]>(
      `/reservations?select=id,reference_code,customer_email,customer_first_name,customer_last_name,status,created_at,checked_out_at&status=in.(CONFIRMED,CHECKED_IN,COMPLETED)&order=created_at.desc&limit=100`
    );

    if (!Array.isArray(reservations) || reservations.length === 0) {
      return [];
    }

    const resIds = reservations.map((r) => r.id);
    const candidates = await this.request<any[]>(
      `/reservation_candidates?select=*&reservation_id=in.(${resIds.map(encodeURIComponent).join(",")})&is_assigned=eq.true`
    );

    const instances = await this.request<any[]>("/workspace_instances?select=id,display_name,instance_code,template_id,floor_id");
    const templates = await this.request<any[]>("/workspace_templates?select=id,name");
    const floors = await this.request<any[]>("/floors?select=id,name");

    const instanceMap = new Map(instances.map((i) => [i.id, i]));
    const templateMap = new Map(templates.map((t) => [t.id, t]));
    const floorMap = new Map(floors.map((f) => [f.id, f]));
    const candidateMap = new Map(candidates.map((c) => [c.reservation_id, c]));

    const results: EndedReservationForSurvey[] = [];
    const nowMs = new Date(nowIso).getTime();

    for (const r of reservations) {
      const cand = candidateMap.get(r.id);
      const endMs = cand?.end_at ? new Date(cand.end_at).getTime() : 0;
      const isEnded = r.status === "COMPLETED" || (endMs > 0 && endMs <= nowMs);

      if (isEnded) {
        const inst = cand ? instanceMap.get(cand.workspace_instance_id) : null;
        const tpl = inst ? templateMap.get(inst.template_id) : null;
        const fl = inst ? floorMap.get(inst.floor_id) : null;

        results.push({
          id: r.id,
          referenceCode: r.reference_code,
          customerEmail: r.customer_email,
          customerFirstName: r.customer_first_name,
          customerLastName: r.customer_last_name,
          status: r.status,
          workspaceDisplayName: inst?.display_name || inst?.instance_code || "Workspace",
          workspaceTemplateName: tpl?.name || "Desk",
          floorName: fl?.name || "Main Floor",
          bookingStartAt: cand?.start_at,
          bookingEndAt: cand?.end_at,
        });
      }
    }

    return results;
  }

  async hasSurveyEmailBeenDispatched(reservationId: string): Promise<boolean> {
    try {
      const logs = await this.request<any[]>(
        `/audit_logs?select=id&action=eq.SURVEY_EMAIL_DISPATCHED&entity_id=eq.${encodeURIComponent(reservationId)}&limit=1`
      );
      return Array.isArray(logs) && logs.length > 0;
    } catch {
      return false;
    }
  }

  async recordSurveyEmailDispatched(reservationId: string, metadata?: Record<string, any>): Promise<void> {
    await this.request("/audit_logs", {
      method: "POST",
      body: JSON.stringify({
        actor_user_id: null,
        actor_role: "SYSTEM",
        action: "SURVEY_EMAIL_DISPATCHED",
        entity_type: "reservation",
        entity_id: reservationId,
        metadata: metadata ?? {},
      }),
    });
  }

  async markReservationCompleted(reservationId: string, completedAt: string): Promise<void> {
    await this.request(`/reservations?id=eq.${encodeURIComponent(reservationId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "COMPLETED",
        checked_out_at: completedAt,
        updated_at: completedAt,
      }),
    });
  }

  async checkExtendAvailability(input: {
    reservationId: string;
    extensionMinutes?: number;
  }): Promise<ExtendAvailabilityResult> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`).catch(() => []);
    const r = reservationRows?.[0];
    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    if (r.status === "CANCELLED" || r.status === "EXPIRED" || r.status === "REJECTED") {
      return {
        canExtend: false,
        reservationId: r.id,
        referenceCode: r.reference_code,
        currentEndAt: r.updated_at,
        maxExtensionMinutes: 0,
        hourlyRate: 0,
        additionalFee: 0,
        reason: `Cannot extend a ${r.status.toLowerCase()} reservation`,
      };
    }

    const candidates = await this.request<any[]>(
      `/reservation_candidates?reservation_id=eq.${encodeURIComponent(r.id)}&order=rank.asc`
    ).catch(() => []);

    const assigned = (candidates ?? []).find((c) => c.is_assigned) ?? candidates?.[0];
    if (!assigned || !assigned.workspace_instance_id) {
      return {
        canExtend: false,
        reservationId: r.id,
        referenceCode: r.reference_code,
        currentEndAt: new Date().toISOString(),
        maxExtensionMinutes: 0,
        hourlyRate: 0,
        additionalFee: 0,
        reason: "No assigned workspace spot found for this reservation",
      };
    }

    const targetInstanceId = assigned.workspace_instance_id;
    const currentEndIso = assigned.end_at;
    const currentEndMs = new Date(currentEndIso).getTime();

    const [instanceRows, settingsRows] = await Promise.all([
      this.request<any[]>(`/workspace_instances?id=eq.${encodeURIComponent(targetInstanceId)}&select=*,workspace_templates(*),floors(*)`).catch(() => []),
      this.request<any[]>("/business_settings?limit=1").catch(() => []),
    ]);

    const inst = instanceRows?.[0];
    const template = inst?.workspace_templates;
    const hourlyRate = Number(template?.rate_amount || r.rate_snapshot || 150);
    const workspaceDisplayName = inst?.display_name || inst?.instance_code || "Workspace Spot";
    const templateName = template?.name || undefined;

    const timezone = settingsRows?.[0]?.timezone || "Asia/Manila";

    const conflictingCandidates = await this.request<any[]>(
      `/reservation_candidates?workspace_instance_id=eq.${encodeURIComponent(targetInstanceId)}&is_assigned=eq.true&reservation_id=neq.${encodeURIComponent(r.id)}&select=id,start_at,end_at,reservations(id,reference_code,customer_first_name,customer_last_name,status)`
    ).catch(() => []);

    const upcomingCandidates = (conflictingCandidates ?? [])
      .filter((cand) => {
        const resStatus = cand.reservations?.status;
        if (resStatus === "CANCELLED" || resStatus === "EXPIRED" || resStatus === "REJECTED") {
          return false;
        }
        const candEndMs = new Date(cand.end_at).getTime();
        return candEndMs > currentEndMs;
      })
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

    const nextCand = upcomingCandidates[0] ?? null;
    let minutesUntilNextBooking: number | null = null;
    let nextBooking: ExtendAvailabilityNextBooking | null = null;

    const formatTimeInTz = (iso: string) => {
      try {
        return new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(new Date(iso));
      } catch {
        return iso;
      }
    };

    if (nextCand) {
      const nextStartMs = new Date(nextCand.start_at).getTime();
      minutesUntilNextBooking = Math.max(0, Math.floor((nextStartMs - currentEndMs) / (60 * 1000)));
      const res = nextCand.reservations;
      const custName = res ? `${res.customer_first_name || ""} ${res.customer_last_name || ""}`.trim() : undefined;
      nextBooking = {
        reservationId: res?.id,
        referenceCode: res?.reference_code,
        customerName: custName || undefined,
        startAt: nextCand.start_at,
        startTimeFormatted: formatTimeInTz(nextCand.start_at),
      };
    }

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(currentEndIso));
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const dateStr = `${v.year}-${v.month}-${v.day}`;
    const dayOfWeek = new Date(currentEndIso).getDay();

    const operatingHours = await this.request<any[]>(
      `/operating_hours?day_of_week=eq.${dayOfWeek}&is_active=eq.true&order=opens_at.asc`
    ).catch(() => []);

    let operatingHoursCloseAt: string | null = null;
    let minutesUntilClosing: number | null = null;

    if (operatingHours && operatingHours.length > 0) {
      const lastInterval = operatingHours[operatingHours.length - 1];
      const closeUtc = zonedDateTimeToUtc(dateStr, lastInterval.closes_at, timezone);
      operatingHoursCloseAt = closeUtc.toISOString();
      const diffCloseMs = closeUtc.getTime() - currentEndMs;
      minutesUntilClosing = Math.max(0, Math.floor(diffCloseMs / (60 * 1000)));
    }

    let maxExtensionMinutes = 24 * 60;
    if (minutesUntilClosing !== null) {
      maxExtensionMinutes = Math.min(maxExtensionMinutes, minutesUntilClosing);
    }
    if (minutesUntilNextBooking !== null) {
      maxExtensionMinutes = Math.min(maxExtensionMinutes, minutesUntilNextBooking);
    }
    maxExtensionMinutes = Math.max(0, maxExtensionMinutes);

    const extensionMinutes = input.extensionMinutes ?? 60;
    const additionalFee = Math.round(((extensionMinutes / 60) * hourlyRate) * 100) / 100;
    const proposedEndMs = currentEndMs + extensionMinutes * 60 * 1000;
    const proposedEndAt = new Date(proposedEndMs).toISOString();

    let canExtend = true;
    let reason: string | undefined;

    if (maxExtensionMinutes <= 0) {
      canExtend = false;
      if (nextBooking) {
        reason = `Spot is reserved starting at ${nextBooking.startTimeFormatted || nextBooking.startAt}. No further extension is possible.`;
      } else if (minutesUntilClosing !== null && minutesUntilClosing <= 0) {
        reason = "Venue is at or past operating closing time.";
      } else {
        reason = "No extension available for this slot.";
      }
    } else if (input.extensionMinutes !== undefined && input.extensionMinutes > maxExtensionMinutes) {
      canExtend = false;
      const extStr = extensionMinutes >= 60 ? `${extensionMinutes / 60} hour(s)` : `${extensionMinutes} mins`;
      if (minutesUntilNextBooking !== null && maxExtensionMinutes === minutesUntilNextBooking) {
        const who = nextBooking?.customerName || nextBooking?.referenceCode || "another booking";
        reason = `Cannot extend by ${extStr}: Desk is reserved by ${who} starting at ${nextBooking?.startTimeFormatted || nextBooking?.startAt}. Maximum extension possible: ${maxExtensionMinutes} minutes.`;
      } else if (minutesUntilClosing !== null && maxExtensionMinutes === minutesUntilClosing) {
        const closeFormatted = operatingHoursCloseAt ? formatTimeInTz(operatingHoursCloseAt) : "closing time";
        reason = `Cannot extend by ${extStr}: Venue closes at ${closeFormatted}. Maximum extension possible: ${maxExtensionMinutes} minutes.`;
      } else {
        reason = `Cannot extend by ${extStr}. Maximum extension possible: ${maxExtensionMinutes} minutes.`;
      }
    }

    return {
      canExtend,
      reservationId: r.id,
      referenceCode: r.reference_code,
      currentEndAt: currentEndIso,
      proposedEndAt,
      extensionMinutes,
      maxExtensionMinutes,
      hourlyRate,
      additionalFee,
      nextBooking,
      closingTime: operatingHoursCloseAt,
      reason,
      workspaceDisplayName,
      templateName,
    };
  }

  async extendReservation(input: ExtendReservationInput): Promise<ExtendReservationResult> {
    const availability = await this.checkExtendAvailability({
      reservationId: input.reservationId,
      extensionMinutes: input.extensionMinutes,
    });

    if (!availability.canExtend) {
      throw new Error(availability.reason || `Cannot extend reservation by ${input.extensionMinutes} minutes`);
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`);
    const r = reservationRows[0];
    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    const candidates = await this.request<any[]>(
      `/reservation_candidates?reservation_id=eq.${encodeURIComponent(r.id)}&order=rank.asc`
    );
    const assigned = (candidates ?? []).find((c) => c.is_assigned) ?? candidates?.[0];
    if (!assigned) {
      throw new Error("Assigned reservation candidate not found");
    }

    const previousEndAt = assigned.end_at;
    const newEndAt = availability.proposedEndAt!;
    const nowIso = new Date().toISOString();
    const additionalFee = input.additionalFee ?? availability.additionalFee;
    const paymentMethod = input.paymentMethod ?? "CASH";

    await this.request(`/reservation_candidates?id=eq.${encodeURIComponent(assigned.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        end_at: newEndAt,
      }),
    });

    await this.request(`/reservations?id=eq.${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        updated_at: nowIso,
      }),
    });

    await this.request("/audit_logs", {
      method: "POST",
      body: JSON.stringify({
        actor_user_id: input.actorUserId ?? null,
        actor_role: input.actorRole ?? "ADMIN",
        action: "RESERVATION_TIME_EXTENDED",
        entity_type: "reservation",
        entity_id: r.id,
        metadata: {
          previous_end_time: previousEndAt,
          new_end_time: newEndAt,
          added_duration_minutes: input.extensionMinutes,
          additional_fee: additionalFee,
          payment_method: paymentMethod,
          reference_code: r.reference_code,
          workspace_instance_id: assigned.workspace_instance_id,
        },
      }),
    }).catch(() => {});

    const detail = await this.getAdminReservationDetail(r.id);
    if (!detail) {
      throw new Error("Failed to retrieve updated reservation detail");
    }

    return {
      success: true,
      reservation: detail,
      previousEndAt,
      newEndAt,
      addedDurationMinutes: input.extensionMinutes,
      additionalFee,
      paymentMethod,
      message: "Reservation time extended successfully",
    };
  }

  async listAvailableRelocationSpots(input: ListAvailableRelocationSpotsInput): Promise<AvailableRelocationSpot[]> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`).catch(() => []);
    const r = reservationRows?.[0];
    if (!r) {
      return [];
    }

    const candidates = await this.request<any[]>(
      `/reservation_candidates?reservation_id=eq.${encodeURIComponent(r.id)}&order=rank.asc`
    ).catch(() => []);
    const assigned = (candidates ?? []).find((c) => c.is_assigned) ?? candidates?.[0];
    if (!assigned || !assigned.workspace_instance_id) {
      return [];
    }

    const currentInstRows = await this.request<any[]>(
      `/workspace_instances?id=eq.${encodeURIComponent(assigned.workspace_instance_id)}&select=id,template_id,floor_id`
    ).catch(() => []);
    const currentInst = currentInstRows?.[0];
    if (!currentInst) {
      return [];
    }

    const [siblingInstances, templates, floors] = await Promise.all([
      this.request<any[]>(
        `/workspace_instances?template_id=eq.${encodeURIComponent(currentInst.template_id)}&id=neq.${encodeURIComponent(currentInst.id)}&select=id,display_name,instance_code,template_id,floor_id,operational_status`
      ).catch(() => []),
      this.request<any[]>("/workspace_templates?select=id,name").catch(() => []),
      this.request<any[]>("/floors?select=id,name").catch(() => []),
    ]);

    const templateMap = new Map((templates ?? []).map((t: any) => [t.id, t]));
    const floorMap = new Map((floors ?? []).map((f: any) => [f.id, f]));

    const nowMs = input.evaluationTime ? new Date(input.evaluationTime).getTime() : Date.now();
    const startMs = new Date(assigned.start_at).getTime();
    const endMs = new Date(assigned.end_at).getTime();

    const isInSession =
      (r.status === "CONFIRMED" || r.status === "CHECKED_IN") &&
      nowMs >= startMs &&
      nowMs < endMs;
    const effectiveStartMs = isInSession ? Math.max(nowMs, startMs) : startMs;

    const spots: AvailableRelocationSpot[] = [];

    for (const inst of siblingInstances ?? []) {
      const template = templateMap.get(inst.template_id);
      const floor = floorMap.get(inst.floor_id);
      let isAvailable = true;
      let reason: string | undefined;

      const opStatus = (inst.operational_status || "ACTIVE").toUpperCase();
      if (opStatus === "MAINTENANCE") {
        isAvailable = false;
        reason = "Under Maintenance";
      } else if (opStatus === "INACTIVE") {
        isAvailable = false;
        reason = "Inactive";
      } else {
        const conflictingCandidates = await this.request<any[]>(
          `/reservation_candidates?workspace_instance_id=eq.${encodeURIComponent(inst.id)}&is_assigned=eq.true&reservation_id=neq.${encodeURIComponent(r.id)}&select=id,start_at,end_at,reservations(id,status)`
        ).catch(() => []);

        for (const cand of conflictingCandidates ?? []) {
          const resStatus = cand.reservations?.status;
          if (resStatus === "CANCELLED" || resStatus === "EXPIRED" || resStatus === "REJECTED") {
            continue;
          }
          if (resStatus !== "CONFIRMED" && resStatus !== "CHECKED_IN") {
            continue;
          }
          const candStartMs = new Date(cand.start_at).getTime();
          const candEndMs = new Date(cand.end_at).getTime();
          if (effectiveStartMs < candEndMs && endMs > candStartMs) {
            isAvailable = false;
            reason = "Already booked for this time window";
            break;
          }
        }
      }

      if (isAvailable) {
        spots.push({
          id: inst.id,
          instanceCode: inst.instance_code || inst.display_name,
          displayName: inst.display_name || inst.instance_code,
          templateId: inst.template_id,
          templateName: template?.name || "Workspace",
          floorId: inst.floor_id,
          floorName: floor?.name || "Floor",
          isAvailable: true,
        });
      }
    }

    return spots;
  }

  async relocateReservation(input: RelocateReservationInput): Promise<{
    success: boolean;
    reservation: AdminReservationDetail;
    message?: string;
    oldWorkspaceDisplayName?: string;
    newWorkspaceDisplayName?: string;
    previousSpotName?: string;
    newSpotName?: string;
  }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`);
    const r = reservationRows?.[0];
    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    if (r.status !== "CONFIRMED" && r.status !== "CHECKED_IN") {
      throw new Error(`Only confirmed or checked-in reservations can be relocated (current status: ${r.status})`);
    }

    let rpcRes: any = null;
    const fullReason = input.notes ? `${input.reason} - ${input.notes}` : input.reason;

    let resolvedActorUserId = input.actorUserId ?? null;
    let resolvedActorRole = input.actorRole ?? "ADMIN";

    if (!resolvedActorUserId) {
      const targetRole = input.actorRole === "STAFF" ? "STAFF" : "ADMIN";
      const matching = await this.request<any[]>(
        `/staff_profiles?select=user_id,role&role=eq.${targetRole}&is_active=eq.true&order=created_at.asc&limit=1`
      ).catch(() => []);
      if (matching && matching.length > 0) {
        resolvedActorUserId = matching[0].user_id;
        resolvedActorRole = matching[0].role;
      }
    }

    try {
      const res = await this.request<any>("/rpc/relocate_reservation", {
        method: "POST",
        body: JSON.stringify({
          p_reservation_id: r.id,
          p_target_workspace_instance_id: input.targetWorkspaceInstanceId,
          p_reason: fullReason,
          p_notes: input.notes ?? null,
          p_actor_user_id: resolvedActorUserId,
          p_actor_role: resolvedActorRole,
        }),
      });
      rpcRes = Array.isArray(res) ? res[0] : res;
    } catch (rpcErr: any) {
      if (
        rpcErr?.message?.includes("PGRST202") ||
        rpcErr?.message?.includes("Could not find the function") ||
        rpcErr?.message?.includes("404")
      ) {
        throw new Error(
          "Database function public.relocate_reservation is missing in Supabase. Please run the migration in supabase/002_functions.sql in your Supabase SQL Editor to enable reservation relocation."
        );
      }
      throw rpcErr;
    }

    const detail = await this.getAdminReservationDetail(r.id);
    if (!detail) {
      throw new Error(`Failed to reload reservation detail for ${r.id}`);
    }

    const oldWorkspaceDisplayName = rpcRes?.old_workspace_name || rpcRes?.previous_spot_name;
    const newWorkspaceDisplayName = rpcRes?.new_workspace_name || rpcRes?.new_spot_name;

    return {
      success: true,
      reservation: detail,
      oldWorkspaceDisplayName,
      newWorkspaceDisplayName,
      previousSpotName: oldWorkspaceDisplayName,
      newSpotName: newWorkspaceDisplayName,
      message: "Reservation relocated successfully",
    };
  }

  async requestCustomerRelocation(input: RequestCustomerRelocationInput): Promise<CustomerRelocationRequest> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`);
    const r = reservationRows?.[0];
    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    if (r.status !== "CONFIRMED" && r.status !== "CHECKED_IN") {
      throw new Error(`Only confirmed or checked-in reservations can request relocation (current status: ${r.status})`);
    }

    const targetRows = await this.request<any[]>(
      `/workspace_instances?select=id,template_id,instance_code,display_name,operational_status&id=eq.${encodeURIComponent(
        input.targetWorkspaceInstanceId
      )}&limit=1`
    );
    const targetInst = targetRows?.[0];
    if (!targetInst) {
      throw new Error(`Target spot not found: ${input.targetWorkspaceInstanceId}`);
    }

    const existingAuditLogs = await this.request<any[]>(
      `/audit_logs?select=*&entity_type=eq.reservation&entity_id=eq.${encodeURIComponent(r.id)}&order=created_at.desc`
    ).catch(() => []);

    const pendingReqs = (existingAuditLogs ?? []).filter((a) => a.action === "reservation_relocation_requested");
    if (pendingReqs.length > 0) {
      const latestReq = pendingReqs[0];
      const reqTime = latestReq.created_at;
      const subsequentDecisions = (existingAuditLogs ?? []).filter(
        (a) =>
          (a.action === "reservation_relocation_approved" ||
            a.action === "reservation_relocation_declined" ||
            a.action === "reservation_relocated" ||
            a.action === "RESERVATION_RELOCATED") &&
          (a.created_at || "") > reqTime
      );
      if (subsequentDecisions.length === 0) {
        throw new Error("A relocation request is already pending approval for this reservation");
      }
    }

    const assignedCandidate = (r.reservation_candidates || []).find((c: any) => c.is_assigned);
    const now = new Date();
    const isSessionActive =
      assignedCandidate &&
      new Date(assignedCandidate.start_at) <= now &&
      now < new Date(assignedCandidate.end_at);
    const remainingMinutes = isSessionActive
      ? Math.max(0, Math.round((new Date(assignedCandidate.end_at).getTime() - now.getTime()) / 60000))
      : undefined;

    const requestId = crypto.randomUUID();
    const pendingRequest: CustomerRelocationRequest = {
      requestId,
      targetWorkspaceInstanceId: targetInst.id,
      targetWorkspaceDisplayName: targetInst.display_name || targetInst.instance_code || "Selected Workspace",
      reason: input.reason,
      notes: input.notes,
      requestedAt: now.toISOString(),
      status: "PENDING",
    };

    await this.request("/audit_logs", {
      method: "POST",
      body: JSON.stringify({
        entity_type: "reservation",
        entity_id: r.id,
        action: "reservation_relocation_requested",
        actor_role: "SYSTEM",
        actor_user_id: null,
        metadata: {
          request_id: requestId,
          target_workspace_instance_id: targetInst.id,
          target_workspace_name: targetInst.display_name || targetInst.instance_code || "Selected Workspace",
          reason: input.reason,
          notes: input.notes ?? null,
          requested_at: now.toISOString(),
          in_session: Boolean(isSessionActive),
          remaining_minutes: remainingMinutes ?? null,
        },
      }),
    });

    return pendingRequest;
  }

  async decideCustomerRelocation(input: DecideCustomerRelocationInput): Promise<{
    success: boolean;
    decision: "APPROVE" | "DECLINE";
    reservation: AdminReservationDetail;
    message?: string;
  }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.reservationId);
    const filter = isUuid
      ? `id=eq.${encodeURIComponent(input.reservationId)}`
      : `reference_code=eq.${encodeURIComponent(input.reservationId)}`;

    const reservationRows = await this.request<any[]>(`/reservations?select=*&${filter}&limit=1`);
    const r = reservationRows?.[0];
    if (!r) {
      throw new Error(`Reservation not found: ${input.reservationId}`);
    }

    const auditLogs = await this.request<any[]>(
      `/audit_logs?select=*&entity_type=eq.reservation&entity_id=eq.${encodeURIComponent(r.id)}&order=created_at.desc`
    ).catch(() => []);

    const reqEvents = (auditLogs ?? []).filter((a) => a.action === "reservation_relocation_requested");
    if (reqEvents.length === 0) {
      throw new Error("No relocation request found for this reservation");
    }
    const latestReq = reqEvents[0];
    const reqTime = latestReq.created_at;
    const subsequentDecisions = (auditLogs ?? []).filter(
      (a) =>
        (a.action === "reservation_relocation_approved" ||
          a.action === "reservation_relocation_declined" ||
          a.action === "reservation_relocated" ||
          a.action === "RESERVATION_RELOCATED") &&
        (a.created_at || "") > reqTime
    );
    if (subsequentDecisions.length > 0) {
      throw new Error("The relocation request has already been decided");
    }

    const targetInstanceId = latestReq.metadata?.target_workspace_instance_id;
    if (!targetInstanceId) {
      throw new Error("Invalid pending relocation request: missing target spot");
    }

    let resolvedActorUserId: string | null = null;
    let resolvedAuditActorRole: "ADMIN" | "STAFF" | "SYSTEM" = "SYSTEM";

    const rawActorUserId = input.actorUserId || null;
    if (rawActorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawActorUserId)) {
      const profs = await this.request<any[]>(
        `/staff_profiles?select=user_id,role&user_id=eq.${encodeURIComponent(rawActorUserId)}&limit=1`
      ).catch(() => []);
      if (profs && profs.length > 0) {
        resolvedActorUserId = profs[0].user_id;
        resolvedAuditActorRole = profs[0].role;
      }
    }

    if (!resolvedActorUserId) {
      const targetRole = input.actorRole === "STAFF" ? "STAFF" : "ADMIN";
      const matching = await this.request<any[]>(
        `/staff_profiles?select=user_id,role&role=eq.${targetRole}&is_active=eq.true&order=created_at.asc&limit=1`
      ).catch(() => []);
      if (matching && matching.length > 0) {
        resolvedActorUserId = matching[0].user_id;
        resolvedAuditActorRole = matching[0].role;
      } else {
        const anyActive = await this.request<any[]>(
          `/staff_profiles?select=user_id,role&is_active=eq.true&order=created_at.asc&limit=1`
        ).catch(() => []);
        if (anyActive && anyActive.length > 0) {
          resolvedActorUserId = anyActive[0].user_id;
          resolvedAuditActorRole = anyActive[0].role;
        } else {
          resolvedActorUserId = null;
          resolvedAuditActorRole = "SYSTEM";
        }
      }
    }

    if (input.decision === "APPROVE") {
      const relocRes = await this.relocateReservation({
        reservationId: r.id,
        targetWorkspaceInstanceId: targetInstanceId,
        reason: latestReq.metadata?.reason || "Customer Relocation Request",
        notes: input.notes ? `Approved: ${input.notes}` : "Approved by operator",
        actorUserId: resolvedActorUserId ?? undefined,
        actorRole: input.actorRole,
      });

      await this.request("/audit_logs", {
        method: "POST",
        body: JSON.stringify({
          entity_type: "reservation",
          entity_id: r.id,
          action: "reservation_relocation_approved",
          actor_role: resolvedAuditActorRole,
          actor_user_id: resolvedActorUserId,
          metadata: {
            request_id: latestReq.metadata?.request_id || latestReq.id,
            target_workspace_instance_id: targetInstanceId,
            target_workspace_name: latestReq.metadata?.target_workspace_name,
            notes: input.notes ?? null,
            decision_role: input.actorRole,
          },
        }),
      }).catch((e) => console.warn("Failed to log approval audit:", e));

      return {
        success: true,
        decision: "APPROVE",
        reservation: relocRes.reservation,
        message: "Customer relocation request approved and executed successfully",
      };
    } else {
      await this.request("/audit_logs", {
        method: "POST",
        body: JSON.stringify({
          entity_type: "reservation",
          entity_id: r.id,
          action: "reservation_relocation_declined",
          actor_role: resolvedAuditActorRole,
          actor_user_id: resolvedActorUserId,
          metadata: {
            request_id: latestReq.metadata?.request_id || latestReq.id,
            target_workspace_instance_id: targetInstanceId,
            notes: input.notes ?? "Declined by operator",
            decision_role: input.actorRole,
          },
        }),
      }).catch((e) => console.warn("Failed to log decline audit:", e));

      const detail = await this.getAdminReservationDetail(r.id);
      if (!detail) {
        throw new Error("Failed to reload reservation detail");
      }
      return {
        success: true,
        decision: "DECLINE",
        reservation: detail,
        message: "Customer relocation request was declined",
      };
    }
  }
}


function getCheckInState(checkedInAt: string | null, checkedOutAt: string | null) {
  if (checkedOutAt) {
    return "CHECKED_OUT" as const;
  }

  if (checkedInAt) {
    return "CHECKED_IN" as const;
  }

  return "NOT_CHECKED_IN" as const;
}

function compareOperationalReservations(
  left: StaffOperationalReservation,
  right: StaffOperationalReservation
) {
  return (left.bookingStartAt ?? "").localeCompare(right.bookingStartAt ?? "");
}
