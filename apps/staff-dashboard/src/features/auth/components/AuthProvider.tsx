"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useSyncExternalStore } from 'react';
import { Button, DeactivatedAccountModal, useActiveTabPolling } from '@deskatlas/ui';
import { AdminSessionLifecycle, initialSession, STORAGE_KEY, type Role, type SessionUser } from '../../../../../admin-portal/src/features/auth/sessionLifecycle';

type User = SessionUser | null;
type AuthContextType = {
  user: User;
  isDeactivated: boolean;
  login: (role: Exclude<Role, null>, name?: string, details?: { id?: string; email?: string; token?: string; assistantToken?: string }) => void;
  logout: () => void;
};
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// PRD-F13/F26 / QAD-TC23/44: cached display data never establishes authentication.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new AdminSessionLifecycle((input, init) => window.fetch(input, init), user => {
    try {
      if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* Storage may be unavailable. */ }
  }, { endpoint: '/api/auth/session', roles: ['staff', 'admin'], credential: user => user.assistantToken ?? user.token }));
  const state = useSyncExternalStore(session.subscribe, session.snapshot, () => initialSession);
  useEffect(() => {
    const originalFetch = window.fetch;
    const intercepted: typeof fetch = async (input, init) => {
      const before = session.snapshot();
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const authorization = headers.get('authorization');
      const matchedToken = Boolean(authorization && [before.user?.token, before.user?.assistantToken].some(token => token && authorization === `Bearer ${token}`));
      const matchedIdentity = Boolean(before.user?.id && headers.get('x-user-id') === before.user.id);
      const response = await originalFetch(input, init);
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/') && before.generation === session.snapshot().generation
        && (matchedToken || matchedIdentity) && [401, 403].includes(response.status)) {
        if (response.status === 401 && matchedToken) session.reject(before.generation, 'AUTH_REQUIRED');
        else if (response.status === 403) {
          try {
            const body: unknown = await response.clone().json();
            if (body && typeof body === 'object') {
              const error = 'error' in body ? body.error : undefined;
              const inactive = 'deactivated' in body && body.deactivated === true;
              const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
              if (code === 'ACCOUNT_INACTIVE' || inactive
                || typeof error === 'string' && /deactivated|not authorized or is deactivated/i.test(error)) session.reject(before.generation, 'ACCOUNT_INACTIVE');
            }
          } catch { /* Unrelated forbidden requests do not revoke identity. */ }
        }
      }
      return response;
    };
    window.fetch = intercepted;
    let raw: string | null = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* Verify only available credentials. */ }
    void session.restore(raw);
    const synchronize = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) void session.restore(event.newValue);
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
  return <AuthContext.Provider value={{ user: state.user, isDeactivated: state.isDeactivated, login, logout: session.logout }}>
    {state.error && !state.isDeactivated && <div role="alert"><p>{state.error}</p>{state.retryable && <Button onClick={() => { void session.check(); }}>Retry session verification</Button>}</div>}
    {state.loading ? <p role="status">Checking your session...</p> : children}
    <DeactivatedAccountModal isOpen={state.isDeactivated} onReturnToLogin={() => { window.location.href = '/manage'; }} loginUrl="/manage" />
  </AuthContext.Provider>;
}
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
export type { Role, User };
