import {
  createAdminNotificationService,
  ReservationSupabaseRepository,
} from "@deskatlas/domain";
import { SupabaseWorkspaceRepository } from "../../workspaces/_lib/supabaseWorkspaceRepository";

export function getAdminNotificationService() {
  const reservationRepo = new ReservationSupabaseRepository();
  const workspaceRepo = new SupabaseWorkspaceRepository();
  return createAdminNotificationService({
    reportsRepo: reservationRepo,
    staffOpsRepo: reservationRepo,
    workspaceRepo,
  });
}
