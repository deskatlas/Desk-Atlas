import { Suspense } from "react";
import { ReservationPage } from "@/features/reservation";

export default function ReserveRoute() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--da-canvas)] p-8 text-center text-sm text-[var(--da-text-secondary)]">
          Loading reservation...
        </div>
      }
    >
      <ReservationPage />
    </Suspense>
  );
}
