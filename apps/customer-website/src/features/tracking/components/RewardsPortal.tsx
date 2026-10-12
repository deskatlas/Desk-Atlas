"use client";

import { useState } from "react";
import { useRewardsSession } from "../context/RewardsSessionContext";
import { RewardsAccessCard } from "./RewardsAccessCard";
import { RewardsVoucherDashboard } from "./RewardsVoucherDashboard";

export { RewardsAccessCard } from "./RewardsAccessCard";
export { RewardsVoucherDashboard } from "./RewardsVoucherDashboard";

interface RewardsPortalProps {
  standalone?: boolean;
}

export function RewardsPortal({ standalone = false }: RewardsPortalProps) {
  const { session, clearSession } = useRewardsSession();
  const [sessionExpiredError, setSessionExpiredError] = useState<string | null>(null);

  if (!session) {
    return (
      <RewardsAccessCard
        standalone={standalone}
        initialError={sessionExpiredError}
        onSuccess={() => setSessionExpiredError(null)}
      />
    );
  }

  return (
    <RewardsVoucherDashboard
      session={session}
      onSessionExpired={() => {
        clearSession();
        setSessionExpiredError(
          "Session expired. Please enter Customer ID and registered email to continue."
        );
      }}
    />
  );
}
