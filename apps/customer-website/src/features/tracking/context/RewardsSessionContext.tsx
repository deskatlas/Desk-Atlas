"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

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
  purpose?: 'REWARDS_ACCESS' | 'REWARDS_AND_ASSISTANT_ACCESS';
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

  // MS78-TC04: expire in memory at the original absolute deadline, including after sleep.
  useEffect(() => {
    if (!session) return;
    const expire = () => {
      if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.now() >= Date.parse(session.expiresAt)) setSessionState(null);
    };
    expire();
    const timer = setTimeout(expire, Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    window.addEventListener('focus', expire);
    document.addEventListener('visibilitychange', expire);
    return () => { clearTimeout(timer); window.removeEventListener('focus', expire); document.removeEventListener('visibilitychange', expire); };
  }, [session]);

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
