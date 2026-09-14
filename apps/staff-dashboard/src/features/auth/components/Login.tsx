"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { PasswordInput } from '@deskatlas/ui';

const STORAGE_KEY_LOCKOUT = 'desk_atlas_staff_lockout';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatLockoutTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0 && s > 0) {
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  }
  if (m > 0) {
    return `${m}m`;
  }
  return `${s}s`;
}

export function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  // Restore active lockout on initial mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LOCKOUT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.lockedUntil && parsed.lockedUntil > Date.now()) {
          setLockedUntil(parsed.lockedUntil);
          const diff = Math.max(1, Math.ceil((parsed.lockedUntil - Date.now()) / 1000));
          setRemainingSeconds(diff);
          setErrorMsg(`Too many failed login attempts. Please try again in ${formatLockoutTime(diff)}.`);
          if (parsed.email && !email) {
            setEmail(parsed.email);
          }
        } else {
          localStorage.removeItem(STORAGE_KEY_LOCKOUT);
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // Active countdown timer with reload & multi-tab synchronization
  useEffect(() => {
    if (!lockedUntil) return;

    const updateTimer = () => {
      const diff = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemainingSeconds(diff);
      if (diff > 0) {
        setErrorMsg(`Too many failed login attempts. Please try again in ${formatLockoutTime(diff)}.`);
      } else {
        setLockedUntil(null);
        setErrorMsg('Lockout expired. You may try logging in again.');
        try {
          localStorage.removeItem(STORAGE_KEY_LOCKOUT);
        } catch (e) {}
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    const onVisibilityOrFocus = () => {
      updateTimer();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_LOCKOUT) {
        if (e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue);
            if (parsed?.lockedUntil && parsed.lockedUntil > Date.now()) {
              setLockedUntil(parsed.lockedUntil);
              updateTimer();
            }
          } catch (err) {}
        } else {
          setLockedUntil(null);
          setRemainingSeconds(0);
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('storage', onStorage);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [lockedUntil]);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    // DevTools protection: verify lockout status in runtime even if DOM disabled was removed
    if (lockedUntil && Date.now() < lockedUntil) {
      const diff = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
      setErrorMsg(`Too many failed login attempts. Please try again in ${formatLockoutTime(diff)}.`);
      return;
    }

    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    if (!EMAIL_REGEX.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429 || data.lockedUntil || data.retryAfterSeconds) {
          const lockTime = data.lockedUntil || (Date.now() + (data.retryAfterSeconds || 300) * 1000);
          setLockedUntil(lockTime);
          const diff = Math.max(1, Math.ceil((lockTime - Date.now()) / 1000));
          setRemainingSeconds(diff);
          setErrorMsg(`Too many failed login attempts. Please try again in ${formatLockoutTime(diff)}.`);
          try {
            localStorage.setItem(
              STORAGE_KEY_LOCKOUT,
              JSON.stringify({ lockedUntil: lockTime, email })
            );
          } catch (e) {}
        } else {
          setErrorMsg(data.error || 'Invalid credentials or unauthorized account');
        }
        setLoading(false);
        return;
      }

      try {
        localStorage.removeItem(STORAGE_KEY_LOCKOUT);
      } catch (e) {}

      login(data.user.role, data.user.displayName, {
        id: data.user.id,
        email: data.user.email,
        token: data.token,
      });

      router.push('/manage');
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please try again.');
      setLoading(false);
    }
  };

  const isLocked = Boolean(lockedUntil && remainingSeconds > 0);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--da-brand-dark)' }}>
      <div style={{ width: '380px', background: '#fff', borderRadius: '14px', padding: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--da-brand-accent)' }}></div>
          <span style={{ fontWeight: 800, fontSize: '19px', color: 'var(--da-brand-dark)' }}>DeskAtlas</span>
        </div>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: "'Inter', sans-serif", marginBottom: '24px' }}>
          Staff Dashboard
        </div>
        {errorMsg && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', fontFamily: "'Inter', sans-serif" }}>
            {errorMsg}
          </div>
        )}
        <form onSubmit={doLogin}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', fontFamily: "'Inter', sans-serif" }}>Email</label>
          <input 
            type="email"
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            placeholder="staff@deskatlas.com" 
            disabled={loading || isLocked}
            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', margin: '6px 0 14px', fontFamily: "'Inter', sans-serif", outline: 'none', opacity: isLocked ? 0.7 : 1 }}
          />
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', fontFamily: "'Inter', sans-serif" }}>Password</label>
          <PasswordInput 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            placeholder="••••••••" 
            disabled={loading || isLocked}
            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', margin: '6px 0 22px', fontFamily: "'Inter', sans-serif", outline: 'none', opacity: isLocked ? 0.7 : 1 }}
          />
          <button 
            type="submit"
            disabled={loading || isLocked}
            style={{ width: '100%', background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', border: 'none', padding: '13px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: (loading || isLocked) ? 'not-allowed' : 'pointer', opacity: (loading || isLocked) ? 0.7 : 1 }}
          >
            {loading ? 'Signing In...' : isLocked ? `Locked (${formatLockoutTime(remainingSeconds)})` : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
