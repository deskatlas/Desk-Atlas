"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { DeactivatedAccountModal, useActiveTabPolling } from '@deskatlas/ui';

type Role = 'admin' | 'staff' | 'member' | null;

type User = {
  id?: string;
  email?: string;
  role: Role;
  name?: string;
  token?: string;
  isSuperAdmin?: boolean;
} | null;

type AuthContextType = {
  user: User;
  loading: boolean;
  isDeactivated: boolean;
  login: (role: Exclude<Role, null>, name?: string, details?: { id?: string; email?: string; token?: string; isSuperAdmin?: boolean }) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const STORAGE_KEY = 'desk_atlas_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.role === 'admin') {
            return parsed;
          }
        }
        return null;
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [loading, setLoading] = useState(true);
  const [isDeactivated, setIsDeactivated] = useState(false);

  const handleDeactivation = useCallback(() => {
    setIsDeactivated(true);
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.clear();
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.role === 'admin') {
          setUser(parsed);
          // If isSuperAdmin is not set on stored user, auto-sync from staff endpoint
          if (parsed.id && parsed.isSuperAdmin === undefined) {
            fetch(`/api/admin/staff/${encodeURIComponent(parsed.id)}`, {
              headers: { 'x-user-id': parsed.id, 'x-user-role': 'ADMIN' },
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                if (d?.staff?.isSuperAdmin) {
                  const updated = { ...parsed, isSuperAdmin: true };
                  setUser(updated);
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
                }
              })
              .catch(() => {});
          }
        } else {
          setUser(null);
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Heartbeat check every 60 seconds with active tab visibility guard
  const checkSession = useCallback(async () => {
    if (!user?.id || isDeactivated) return;
    try {
      const res = await fetch('/api/admin/auth/session', {
        headers: {
          'x-user-id': user.id || '',
          'x-user-role': (user.role || 'ADMIN').toUpperCase(),
        },
        cache: 'no-store',
      });

      if (res.status === 403) {
        handleDeactivation();
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data?.deactivated === true || (data?.active === false && res.status !== 200)) {
        handleDeactivation();
      }
    } catch {
      // ignore network error
    }
  }, [user?.id, user?.role, isDeactivated, handleDeactivation]);

  useActiveTabPolling(checkSession, 60000, {
    enabled: Boolean(user?.id) && !isDeactivated,
    immediate: true,
  });

  // Global fetch response interceptor for 403 deactivations (for active logged-in sessions)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
      const isLoginRequest = url.includes('/auth/login');

      if (response.status === 403 && !isLoginRequest && user) {
        try {
          const clone = response.clone();
          const text = await clone.text();
          if (
            text.toLowerCase().includes('deactivated') ||
            text.toLowerCase().includes('not authorized or is deactivated')
          ) {
            handleDeactivation();
          }
        } catch (e) {
          // ignore
        }
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [user, handleDeactivation]);

  const login = (
    role: Exclude<Role, null>,
    name?: string,
    details?: { id?: string; email?: string; token?: string; isSuperAdmin?: boolean }
  ) => {
    setIsDeactivated(false);
    const u = { role, name, ...details } as User;
    setUser(u);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    } catch (e) {
      // ignore
    }
  };

  const logout = () => {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  };

  const handleReturnToLogin = () => {
    setIsDeactivated(false);
    if (typeof window !== 'undefined') {
      window.location.href = '/manage/login';
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, isDeactivated, login, logout }}>
      {children}
      <DeactivatedAccountModal
        isOpen={isDeactivated}
        onReturnToLogin={handleReturnToLogin}
        loginUrl="/manage/login"
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export type { Role, User };
