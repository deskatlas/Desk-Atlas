"use client";

import Link from "next/link";
import { useState } from "react";
import { useRewardsSession } from "@/features/tracking/context/RewardsSessionContext";
import { RewardsAccessCard } from "@/features/tracking/components/RewardsAccessCard";
import { RewardsVoucherDashboard } from "@/features/tracking/components/RewardsVoucherDashboard";

export default function TrackRewardsRoute() {
  const { session, clearSession } = useRewardsSession();
  const [sessionExpiredError, setSessionExpiredError] = useState<string | null>(null);

  const handleSessionExpired = () => {
    clearSession();
    setSessionExpiredError(
      "Session expired. Please enter Customer ID and registered email to continue."
    );
  };

  return (
    <main className="min-h-screen bg-[var(--da-canvas)] px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/track"
            className="text-xs font-bold text-[var(--da-primary)] hover:underline flex items-center gap-1"
          >
            ← Back to Manage Booking
          </Link>
          <Link href="/reserve" className="da-secondary-button text-xs font-bold">
            Reserve Workspace
          </Link>
        </div>

        {session ? (
          <RewardsVoucherDashboard
            session={session}
            onSessionExpired={handleSessionExpired}
          />
        ) : (
          <RewardsAccessCard
            standalone
            initialError={sessionExpiredError}
            onSuccess={() => setSessionExpiredError(null)}
          />
        )}
      </div>
    </main>
  );
}
