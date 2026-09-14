"use client";

import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useRouter, useSearchParams } from 'next/navigation';

import { PasswordInput } from '@deskatlas/ui';

const STORAGE_KEY_LOCKOUT = 'desk_atlas_admin_lockout';
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
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const { user, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resetSuccess = searchParams.get('reset') === 'success';

  useEffect(() => {
    fetch('/api/admin/auth/setup/status', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.hasAdmin === false) {
          setNeedsSetup(true);
        }
      })
      .catch(() => {});
  }, []);

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
          if (parsed.email && !loginEmail) {
            setLoginEmail(parsed.email);
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

  useEffect(() => {
    if (user && user.role === 'admin') {
      router.push('/manage');
    }
  }, [user, router]);

  const doLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // DevTools protection: verify lockout status in runtime even if DOM disabled was removed
    if (lockedUntil && Date.now() < lockedUntil) {
      const diff = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
      setErrorMsg(`Too many failed login attempts. Please try again in ${formatLockoutTime(diff)}.`);
      return;
    }

    if (!loginEmail || !loginPassword) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    if (!EMAIL_REGEX.test(loginEmail.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
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
              JSON.stringify({ lockedUntil: lockTime, email: loginEmail })
            );
          } catch (e) {}
        } else {
          setErrorMsg(data.error || 'Login failed. Please check your credentials.');
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
        isSuperAdmin: Boolean(data.user.isSuperAdmin),
      });

      router.push('/manage');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error occurred. Please try again.');
      setLoading(false);
    }
  };

  const isLocked = Boolean(lockedUntil && remainingSeconds > 0);

  return (
    <div data-screen-label="Admin Login" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--da-brand-dark)' }}>
      <div style={{ width: '380px', background: '#fff', borderRadius: '14px', padding: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--da-brand-accent)' }}></div>
          <span style={{ fontWeight: 800, fontSize: '19px', color: 'var(--da-brand-dark)' }}>DeskAtlas</span>
        </div>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '24px' }}>Management Portal</div>

        {resetSuccess && (
          <div data-testid="reset-success-alert" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', fontFamily: 'var(--da-font-family)' }}>
            <strong>Success:</strong> Password updated successfully. Please sign in with your new password.
          </div>
        )}

        {needsSetup && (
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', fontFamily: 'var(--da-font-family)' }}>
            <strong>First-Time Setup:</strong> No administrator account detected.{' '}
            <a href="/manage/setup" style={{ color: '#059669', fontWeight: 700, textDecoration: 'underline' }}>
              Initialize with Google
            </a>
          </div>
        )}

        {errorMsg && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', fontFamily: 'var(--da-font-family)' }}>
            {errorMsg}
          </div>
        )}

        <form onSubmit={doLogin}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>Email</label>
          <input 
            type="email"
            value={loginEmail} 
            onChange={(e) => setLoginEmail(e.target.value)} 
            placeholder="admin@deskatlas.com" 
            disabled={loading || isLocked}
            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', margin: '6px 0 14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box', opacity: isLocked ? 0.7 : 1 }}
          />
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0 2px' }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>Password</label>
            <a href="/manage/forgot-password" data-testid="forgot-password-link" style={{ fontSize: '12px', color: '#059669', textDecoration: 'none', fontWeight: 600, fontFamily: 'var(--da-font-family)' }}>
              Forgot password?
            </a>
          </div>
          <PasswordInput 
            value={loginPassword} 
            onChange={(e) => setLoginPassword(e.target.value)} 
            placeholder="••••••••" 
            disabled={loading || isLocked}
            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', margin: '4px 0 22px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box', opacity: isLocked ? 0.7 : 1 }}
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
