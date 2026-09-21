"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useKioskInactivityTimer } from "../../../hooks/useKioskInactivityTimer";
import { InactivityWarningModal } from "../../../components/InactivityWarningModal";

interface SessionManagerProps {
  children: ReactNode;
  timeoutMs?: number;
  warningTimeoutMs?: number;
  onTimeoutWarning?: () => void;
  onReset: () => void;
}

export function SessionManager({ 
  children, 
  timeoutMs = 60000, // 1 minute for kiosk inactivity
  warningTimeoutMs = 15000, // 15 seconds warning threshold
  onTimeoutWarning,
  onReset
}: SessionManagerProps) {
  const router = useRouter();

  const handleReset = () => {
    onReset();
    router.push("/kiosk");
  };

  const { isWarningActive, remainingSeconds, resetTimer } = useKioskInactivityTimer({
    totalTimeoutMs: timeoutMs,
    warningTimeoutMs,
    onWarning: onTimeoutWarning,
    onReset: handleReset,
    enabled: true,
  });

  return (
    <>
      {children}
      <InactivityWarningModal
        isOpen={isWarningActive}
        remainingSeconds={remainingSeconds}
        onStay={resetTimer}
      />
      {/* Staff manual reset control (hidden in corner) */}
      <button
        type="button"
        onClick={handleReset}
        style={{
          position: "fixed",
          bottom: "20px",
          left: "20px",
          width: "40px",
          height: "40px",
          opacity: 0.1,
          background: "red",
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          zIndex: 9999,
        }}
        title="Staff Reset"
      />
    </>
  );
}
