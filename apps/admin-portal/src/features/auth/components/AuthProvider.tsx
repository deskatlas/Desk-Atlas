"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useSyncExternalStore, useCallback } from 'react';
import { Button, DeactivatedAccountModal, useActiveTabPolling } from '@deskatlas/ui';
import { AdminSessionLifecycle, initialSession, STORAGE_KEY, type Role, type SessionUser } from '../sessionLifecycle';

type User = SessionUser | null;
type AuthContextType = {
  user: User; loading: boolean; isDeactivated: boolean; sessionGeneration: number; isSessionCurrent: (generation: number, token?: string) => boolean;
  login: (role: Exclude<Role, null>, name?: string, details?: Omit<SessionUser, 'role' | 'name'>) => void;
  logout: () => void;
};
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new AdminSessionLifecycle((input, init) => window.fetch(input, init), user => {
    try {
      if (user) { const value = JSON.stringify(user); if (localStorage.getItem(STORAGE_KEY) !== value) localStorage.setItem(STORAGE_KEY, value); }
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* Storage may be unavailable. */ }
  }));
  const state = useSyncExternalStore(session.subscribe, session.snapshot, () => initialSession);
  const isSessionCurrent = useCallback((generation: number, token?: string) => {
    const current = session.snapshot();
    return current.generation === generation && Boolean(token) && current.user?.token === token && !current.loading;
  }, [session]);
  useEffect(() => {
    // MS-47: intercept only same-origin requests carrying this credential generation.
    const originalFetch = window.fetch;
    const intercepted: typeof fetch = async (input, init) => {
      const generation = session.snapshot().generation;
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const token = headers.get('authorization');
      const response = await originalFetch(input, init);
      const current = session.snapshot();
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')
        && generation === current.generation && token && token === `Bearer ${current.user?.token}`
        && [401, 403, 503].includes(response.status)) {
        try {
          const body = await response.clone().json();
          session.reject(generation, body.error?.code ?? '');
        } catch { /* Non-contract errors do not change identity. */ }
      }
      return response;
    };
    window.fetch = intercepted;
    let raw: string | null = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* Verify only available credentials. */ }
    void session.restore(raw);
    const synchronize = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) {
        void session.restore(event.newValue);
      }
    };
    window.addEventListener('storage', synchronize);
    return () => {
      window.removeEventListener('storage', synchronize);
      if (window.fetch === intercepted) window.fetch = originalFetch;
      session.abandon();
    };
  }, [session]);
  useActiveTabPolling(session.check, 60000, { enabled: Boolean(state.user) || state.retryable, immediate: false });
  useEffect(() => {
    if (!state.expiresAt || !state.user) return;
    const timer = setTimeout(() => session.reject(state.generation, 'AUTH_REQUIRED'), Math.max(0, state.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session, state.expiresAt, state.generation, state.user]);
  useEffect(() => {
    if (state.isDeactivated) {
      try { sessionStorage.clear(); } catch { /* Storage may be unavailable. */ }
    }
  }, [state.isDeactivated]);
  const login: AuthContextType['login'] = (role, name, details) => { void session.login({ role, name, ...details }); };
  return <AuthContext.Provider value={{ user: state.user, loading: state.loading, isDeactivated: state.isDeactivated,
    sessionGeneration: state.generation, isSessionCurrent, login, logout: session.logout }}>
    {state.error && !state.isDeactivated && <div role="alert"><p>{state.error}</p>{state.retryable
      ? <Button onClick={() => { void session.check(); }}>Retry session verification</Button>
      : <Button onClick={() => { window.location.href = '/manage/login'; }}>Sign in</Button>}</div>}
    {children}
    <DeactivatedAccountModal isOpen={state.isDeactivated} onReturnToLogin={() => { window.location.href = '/manage/login'; }} loginUrl="/manage/login" />
  </AuthContext.Provider>;
}
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
export type { Role, User };
