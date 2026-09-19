import { CreateReservationRequest, ReservationResponseDTO } from "../models/reservation";
import { ReservationRepository } from "./reservationRepository";
import { WorkspaceRepository } from "../models/workspace";
import { validateCandidates, CandidateValidationContext } from "./candidateValidationService";
import { createPaymentSessionService, PaymentSessionService } from "./paymentSessionService";
import { ReservationPaymentRepository } from "./paymentSessionRepository";
import { validatePersonName } from "./personNameValidationService";

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
    };

    if (request.source === "KIOSK") {
      if (!request.candidates || request.candidates.length !== 1 || request.candidates[0].rank !== 0) {
        throw new ReservationError("Kiosk reservations require exactly one candidate (Main).");
      }
    }

    // Use CandidateValidationService
    try {
      validateCandidates(request.candidates, context);
    } catch (error: any) {
      throw new ReservationError(error.message);
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

    const start = new Date(mainCandidate.startAt);
    const end = new Date(mainCandidate.endAt);
    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    const rateSnapshot = mainTemplate.rateAmount;
    const amountDue = rateSnapshot * durationHours; // Because pricing_unit is HOURLY

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
