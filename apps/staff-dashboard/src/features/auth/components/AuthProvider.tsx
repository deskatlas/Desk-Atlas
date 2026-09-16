"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { DeactivatedAccountModal } from '@deskatlas/ui';

type Role = 'admin' | 'staff' | 'member' | null;

type User = {
  id?: string;
  email?: string;
  role: Role;
  name?: string;
  token?: string;
} | null;

type AuthContextType = {
  user: User;
  isDeactivated: boolean;
  login: (role: Exclude<Role, null>, name?: string, details?: { id?: string; email?: string; token?: string }) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const STORAGE_KEY = 'desk_atlas_user';
  const [user, setUser] = useState<User>(null);
  const [mounted, setMounted] = useState(false);
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
    setMounted(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch (e) {
      // ignore
    }
  }, []);

  // Heartbeat check every 15 seconds
  useEffect(() => {
    if (!user?.id || isDeactivated) return;

    let isCancelled = false;

    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/session', {
          headers: {
            'x-user-id': user.id || '',
            'x-user-role': (user.role || 'STAFF').toUpperCase(),
          },
          cache: 'no-store',
        });

        if (isCancelled) return;

        if (res.status === 403) {
          handleDeactivation();
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (data?.deactivated === true || (data?.active === false && res.status !== 200)) {
          handleDeactivation();
        }
      } catch (e) {
        // ignore network error
      }
    };

    checkSession();
    const interval = setInterval(checkSession, 15000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [user?.id, user?.role, isDeactivated, handleDeactivation]);

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

  const login = (role: Exclude<Role, null>, name?: string, details?: { id?: string; email?: string; token?: string }) => {
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
      window.location.href = '/manage';
    }
  };

  if (!mounted) return null;

  return (
    <AuthContext.Provider value={{ user, isDeactivated, login, logout }}>
      {children}
      <DeactivatedAccountModal
        isOpen={isDeactivated}
        onReturnToLogin={handleReturnToLogin}
        loginUrl="/manage"
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
