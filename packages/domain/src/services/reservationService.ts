import { CreateReservationRequest, ReservationResponseDTO } from "../models/reservation";
import { ReservationRepository } from "./reservationRepository";
import { WorkspaceRepository } from "../models/workspace";
import { validateCandidates, CandidateValidationContext } from "./candidateValidationService";
import { createPaymentSessionService, PaymentSessionService } from "./paymentSessionService";
import { ReservationPaymentRepository } from "./paymentSessionRepository";
import { validatePersonName } from "./personNameValidationService";
import { RateType } from "./pricingService";
import { resolveEffectivePrice } from "./promotionalPricingService";
import { PromotionalRate } from "../models/promotionalRate";

export class ReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationError";
  }
}

export class ReservationService {
  constructor(
    private readonly reservationRepository: ReservationRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly paymentRepository?: ReservationPaymentRepository,
    private readonly paymentSessionService?: PaymentSessionService
  ) {}

  async createReservation(
    request: CreateReservationRequest,
    options?: {
      paymentLinkBaseUrl?: string;
      maxAdvanceBookingDays?: number;
      now?: Date;
      promotions?: PromotionalRate[];
    }
  ): Promise<ReservationResponseDTO> {
    const firstNameValidation = validatePersonName(request.customerFirstName, "First name");
    if (!firstNameValidation.isValid) {
      throw new ReservationError(firstNameValidation.error!);
    }
    const lastNameValidation = validatePersonName(request.customerLastName, "Last name");
    if (!lastNameValidation.isValid) {
      throw new ReservationError(lastNameValidation.error!);
    }
    if (!request.customerEmail || request.customerEmail.trim() === "") {
      throw new ReservationError("Email is required.");
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(request.customerEmail)) {
      throw new ReservationError("Invalid email format.");
    }
    if (request.customerContactNumber && request.customerContactNumber.trim() !== "") {
      const contact = request.customerContactNumber.trim();
      if (contact.length > 30 || !/^[0-9+\-()\s]+$/.test(contact)) {
        throw new ReservationError("Invalid contact number format.");
      }
    }
    if (request.source !== "WEB" && request.source !== "KIOSK") {
      throw new ReservationError("Invalid reservation source.");
    }

    if (!request.candidates || request.candidates.length === 0) {
      throw new ReservationError("At least one candidate is required.");
    }

    // Load instances and templates for validation
    const catalog = await this.workspaceRepository.listCatalog();
    const instances = catalog.instances;
    const templates = catalog.templates;
    
    const context: CandidateValidationContext = {
      instances,
      templates,
      now: options?.now,
      maxAdvanceBookingDays: options?.maxAdvanceBookingDays,
    };

    if (request.source === "KIOSK") {
      if (!request.candidates || request.candidates.length !== 1 || request.candidates[0].rank !== 0) {
        throw new ReservationError("Kiosk reservations require exactly one candidate (Main).");
      }
    }

    // Use CandidateValidationService
    try {
      validateCandidates(request.candidates, context);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Validation failed";
      throw new ReservationError(msg);
    }

    // Extract Main candidate (rank 0) to compute price
    const mainCandidate = request.candidates.find(c => c.rank === 0);
    if (!mainCandidate) {
      throw new ReservationError("Main candidate is required.");
    }

    const mainInstance = instances.find(i => i.id === mainCandidate.workspaceInstanceId);
    const mainTemplate = templates.find(t => t.id === mainInstance?.templateId);

    if (!mainTemplate) {
      throw new ReservationError("Template for main candidate not found.");
    }

    const rateType: RateType = mainCandidate.rateType || request.rateType || "HOURLY";

    let basePrice = mainTemplate.rateAmount;
    if (rateType === "DAY_PASS") {
      basePrice = mainTemplate.dayPassPrice ?? mainTemplate.rateAmount;
    } else if (rateType === "NIGHT_PASS") {
      basePrice = mainTemplate.nightPassPrice ?? mainTemplate.rateAmount;
    } else if (rateType === "WHOLE_DAY_PASS") {
      basePrice = mainTemplate.wholeDayPassPrice ?? (mainTemplate.rateAmount * 24);
    } else if (rateType === "HALF_DAY_PASS") {
      basePrice = mainTemplate.halfDayPassPrice ?? (mainTemplate.rateAmount * 12);
    }

    let rateSnapshot = basePrice;
    let amountDue = basePrice;

    if (rateType === "HOURLY") {
      const start = new Date(mainCandidate.startAt);
      const end = new Date(mainCandidate.endAt);
      const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      amountDue = Math.round(rateSnapshot * durationHours * 100) / 100;
    } else {
      // Flat pass package: amountDue is the flat price, not multiplied by operating window duration
      amountDue = Math.round(rateSnapshot * 100) / 100;
    }

    // Resolve promotional discounts if promotions are provided in options
    if (options?.promotions && options.promotions.length > 0) {
      const targetTime = new Date(mainCandidate.startAt);
      const start = new Date(mainCandidate.startAt);
      const end = new Date(mainCandidate.endAt);
      const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      const resolved = resolveEffectivePrice(
        mainTemplate.id,
        rateType,
        basePrice,
        targetTime,
        options.promotions,
        rateType === "HOURLY" ? durationHours : 1
      );
      rateSnapshot = resolved.effectivePrice;
      amountDue = resolved.estimatedTotal;
    }

    // If client passed validated promo pricing, accept effective rate within limits
    if (request.amountDue !== undefined && request.amountDue !== null && request.amountDue > 0) {
      if (request.amountDue <= amountDue) {
        amountDue = request.amountDue;
        if (request.rateSnapshot !== undefined && request.rateSnapshot !== null) {
          rateSnapshot = request.rateSnapshot;
        } else if (request.bookedRatePerHour !== undefined && request.bookedRatePerHour !== null) {
          rateSnapshot = request.bookedRatePerHour;
        }
      }
    } else if (request.rateSnapshot !== undefined && request.rateSnapshot !== null && request.rateSnapshot > 0) {
      if (request.rateSnapshot <= basePrice) {
        rateSnapshot = request.rateSnapshot;
        if (rateType !== "HOURLY") {
          amountDue = rateSnapshot;
        }
      }
    } else if (request.bookedRatePerHour !== undefined && request.bookedRatePerHour !== null && request.bookedRatePerHour > 0) {
      if (request.bookedRatePerHour <= basePrice) {
        rateSnapshot = request.bookedRatePerHour;
        if (rateType !== "HOURLY") {
          amountDue = rateSnapshot;
        }
      }
    }

    if (request.source === "WEB") {
      if (!this.paymentRepository) {
        throw new ReservationError("Payment repository is required for web reservations.");
      }
      if (!this.paymentSessionService) {
        throw new ReservationError("Payment session service is required for web reservations.");
      }
      if (!options?.paymentLinkBaseUrl) {
        throw new ReservationError("Payment link base URL is required for web reservations.");
      }

      const draftSession = await this.paymentSessionService.createReservationPaymentSession(
        "pending",
        options.paymentLinkBaseUrl
      );

      const reservation = await this.reservationRepository.createReservation(
        request,
        rateSnapshot,
        amountDue,
        {
          tokenHash: draftSession.tokenHash,
          expiresAt: draftSession.expiresAt,
        }
      );

      const storedSession = await this.paymentRepository.findPaymentSessionByTokenHash(draftSession.tokenHash);
      if (!storedSession) {
        throw new ReservationError("Payment session could not be created.");
      }

      return {
        ...reservation,
        paymentSession: {
          paymentAttemptId: storedSession.paymentAttemptId,
          token: draftSession.token,
          expiresAt: draftSession.expiresAt,
          paymentUrl: draftSession.paymentUrl,
          expiryMinutes: draftSession.expiryMinutes,
        },
      };
    }

    if (request.paymentMethodId && this.paymentRepository) {
      const kioskPaymentMethodId = request.paymentMethodId.trim();
      const kioskPaymentMethods = await this.paymentRepository.listActiveKioskPaymentMethods();
      const kioskPaymentMethod = kioskPaymentMethods.find(
        (method) => method.id === kioskPaymentMethodId
      );
      if (!kioskPaymentMethod) {
        throw new ReservationError("Invalid kiosk payment method.");
      }
    }

    return await this.reservationRepository.createReservation(request, rateSnapshot, amountDue);
  }

  async revalidateWorkspacePrice(templateId: string): Promise<{
    currentRate: number;
    rateAmount: number;
    currency: string;
    templateId: string;
    templateName: string;
  }> {
    if (!templateId || !templateId.trim()) {
      throw new ReservationError("Workspace template ID is required.");
    }
    const catalog = await this.workspaceRepository.listCatalog();
    const template = catalog.templates.find((t) => t.id === templateId.trim());
    if (!template) {
      throw new ReservationError(`Workspace template with ID '${templateId}' not found.`);
    }
    return {
      currentRate: template.rateAmount,
      rateAmount: template.rateAmount,
      currency: "PHP",
      templateId: template.id,
      templateName: template.name,
    };
  }
}

export function createReservationService(
  reservationRepository: ReservationRepository,
  workspaceRepository: WorkspaceRepository,
  paymentRepository?: ReservationPaymentRepository,
  paymentSessionService?: PaymentSessionService
): ReservationService {
  return new ReservationService(
    reservationRepository,
    workspaceRepository,
    paymentRepository,
    paymentSessionService ?? (paymentRepository ? createPaymentSessionService(paymentRepository) : undefined)
  );
}

