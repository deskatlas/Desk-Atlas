"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export interface CustomerProfile {
  customerCode: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string;
}

export interface RewardsSession {
  accessToken: string;
  expiresAt: string;
  customer: CustomerProfile;
}

export interface RewardsSessionContextType {
  session: RewardsSession | null;
  setSession: (session: RewardsSession | null) => void;
  clearSession: () => void;
}

const RewardsSessionContext = createContext<RewardsSessionContextType | null>(null);

export function RewardsSessionProvider({ children }: { children: ReactNode }) {
  // Ephemeral in-memory state only (SPEC-3 and MS-37 invariant: never in persistent storage, URL, or analytics)
  const [session, setSessionState] = useState<RewardsSession | null>(null);

  const setSession = (newSession: RewardsSession | null) => {
    setSessionState(newSession);
  };

  const clearSession = () => {
    setSessionState(null);
  };

  return (
    <RewardsSessionContext.Provider value={{ session, setSession, clearSession }}>
      {children}
    </RewardsSessionContext.Provider>
  );
}

export function useRewardsSession(): RewardsSessionContextType {
  const context = useContext(RewardsSessionContext);
  if (!context) {
    throw new Error("useRewardsSession must be used within a RewardsSessionProvider");
  }
  return context;
}
