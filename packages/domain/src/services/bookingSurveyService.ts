import {
  BookingEndedSurveyEmailInput,
  createTransactionalEmailService,
  TransactionalEmailService,
} from "./transactionalEmailService";

export interface EndedReservationForSurvey {
  id: string;
  referenceCode: string;
  customerEmail: string;
  customerFirstName?: string;
  customerLastName?: string;
  status: string;
  workspaceDisplayName?: string;
  workspaceTemplateName?: string;
  floorName?: string;
  bookingStartAt?: string;
  bookingEndAt?: string;
}

export interface BookingSurveyRepository {
  listEndedReservationsForSurvey(nowIso: string): Promise<EndedReservationForSurvey[]>;
  hasSurveyEmailBeenDispatched(reservationId: string): Promise<boolean>;
  recordSurveyEmailDispatched(reservationId: string, metadata?: Record<string, any>): Promise<void>;
  markReservationCompleted?(reservationId: string, completedAt: string): Promise<void>;
}

export interface BookingSurveyServiceConfig {
  surveyFormUrl?: string;
  bookAgainUrl?: string;
  trackingBaseUrl?: string;
  emailService?: TransactionalEmailService;
  nowProvider?: () => Date;
}

export interface ProcessEndedBookingsResult {
  scanned: number;
  completed: number;
  surveysSent: number;
  details: Array<{
    reservationId: string;
    referenceCode: string;
    status: string;
    surveySent: boolean;
  }>;
}

export class BookingSurveyService {
  private readonly emailService: TransactionalEmailService;
  private readonly nowProvider: () => Date;

  constructor(
    private readonly repository: BookingSurveyRepository,
    private readonly config?: BookingSurveyServiceConfig
  ) {
    this.emailService = config?.emailService ?? createTransactionalEmailService();
    this.nowProvider = config?.nowProvider ?? (() => new Date());
  }

  async processEndedBookings(options?: { now?: Date }): Promise<ProcessEndedBookingsResult> {
    const now = options?.now ?? this.nowProvider();
    const nowIso = now.toISOString();

    const endedReservations = await this.repository.listEndedReservationsForSurvey(nowIso);
    let completedCount = 0;
    let surveysSent = 0;
    const details: ProcessEndedBookingsResult["details"] = [];

    for (const res of endedReservations) {
      let isCompleted = res.status === "COMPLETED";

      if (!isCompleted && this.repository.markReservationCompleted) {
        try {
          await this.repository.markReservationCompleted(res.id, nowIso);
          isCompleted = true;
          completedCount++;
        } catch (err) {
          console.warn(`[BookingSurveyService] Could not mark reservation ${res.referenceCode} as completed:`, err);
        }
      }

      const alreadySent = await this.repository.hasSurveyEmailBeenDispatched(res.id);
      let sent = false;

      if (!alreadySent && res.customerEmail) {
        const surveyUrl =
          this.config?.surveyFormUrl ||
          process.env.SURVEY_FORM_URL ||
          process.env.NEXT_PUBLIC_SURVEY_FORM_URL ||
          "https://forms.google.com/deskatlas-feedback";
        const bookAgainUrl =
          this.config?.bookAgainUrl ||
          process.env.DESKATLAS_PUBLIC_APP_URL ||
          "https://deskatlas.com";
        const trackingUrl = this.config?.trackingBaseUrl
          ? `${this.config.trackingBaseUrl.replace(/\/$/, "")}/track?code=${encodeURIComponent(res.referenceCode)}`
          : undefined;

        const emailInput: BookingEndedSurveyEmailInput = {
          to: res.customerEmail,
          customerFirstName: res.customerFirstName,
          customerLastName: res.customerLastName,
          referenceCode: res.referenceCode,
          workspaceDisplayName: res.workspaceDisplayName,
          workspaceTemplateName: res.workspaceTemplateName,
          floorName: res.floorName,
          bookingStartAt: res.bookingStartAt,
          bookingEndAt: res.bookingEndAt,
          surveyUrl,
          bookAgainUrl,
          trackingUrl,
        };

        const emailResult = await this.emailService.sendBookingEndedSurveyEmail(emailInput);
        if (emailResult.success) {
          await this.repository.recordSurveyEmailDispatched(res.id, {
            sent_at: nowIso,
            to: res.customerEmail,
            survey_url: surveyUrl,
          });
          surveysSent++;
          sent = true;
        }
      }

      details.push({
        reservationId: res.id,
        referenceCode: res.referenceCode,
        status: isCompleted ? "COMPLETED" : res.status,
        surveySent: sent,
      });
    }

    return {
      scanned: endedReservations.length,
      completed: completedCount,
      surveysSent,
      details,
    };
  }

  async sendSurveyForReservation(reservationId: string): Promise<boolean> {
    const alreadySent = await this.repository.hasSurveyEmailBeenDispatched(reservationId);
    if (alreadySent) {
      return false;
    }

    const nowIso = this.nowProvider().toISOString();
    const endedReservations = await this.repository.listEndedReservationsForSurvey(nowIso);
    const reservation = endedReservations.find((r) => r.id === reservationId);

    if (!reservation || !reservation.customerEmail) {
      return false;
    }

    const surveyUrl =
      this.config?.surveyFormUrl ||
      process.env.SURVEY_FORM_URL ||
      process.env.NEXT_PUBLIC_SURVEY_FORM_URL ||
      "https://forms.google.com/deskatlas-feedback";
    const bookAgainUrl =
      this.config?.bookAgainUrl ||
      process.env.DESKATLAS_PUBLIC_APP_URL ||
      "https://deskatlas.com";

    const emailResult = await this.emailService.sendBookingEndedSurveyEmail({
      to: reservation.customerEmail,
      customerFirstName: reservation.customerFirstName,
      customerLastName: reservation.customerLastName,
      referenceCode: reservation.referenceCode,
      workspaceDisplayName: reservation.workspaceDisplayName,
      workspaceTemplateName: reservation.workspaceTemplateName,
      floorName: reservation.floorName,
      bookingStartAt: reservation.bookingStartAt,
      bookingEndAt: reservation.bookingEndAt,
      surveyUrl,
      bookAgainUrl,
    });

    if (emailResult.success) {
      await this.repository.recordSurveyEmailDispatched(reservationId, {
        sent_at: nowIso,
        to: reservation.customerEmail,
        survey_url: surveyUrl,
      });
      return true;
    }

    return false;
  }
}

export function createBookingSurveyService(
  repository: BookingSurveyRepository,
  config?: BookingSurveyServiceConfig
): BookingSurveyService {
  return new BookingSurveyService(repository, config);
}
