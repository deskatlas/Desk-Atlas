import {
  createAdminReservationService,
  ReservationSupabaseRepository,
  createTransactionalEmailService,
} from "@deskatlas/domain";

export function getAdminReservationService() {
  return createAdminReservationService(
    new ReservationSupabaseRepository(),
    undefined,
    createTransactionalEmailService()
  );
}
