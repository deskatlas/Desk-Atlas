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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error occurred. Please try again.';
      setErrorMsg(msg);
      setLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    if (loading || isLocked) return;
    setLoading(true);
    window.location.href = '/api/admin/auth/google';
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

        <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', gap: '10px' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--da-border, #e2e8f0)' }} />
          <span style={{ fontSize: '11px', color: 'var(--da-text-secondary, #94a3b8)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            OR
          </span>
          <div style={{ flex: 1, height: '1px', background: 'var(--da-border, #e2e8f0)' }} />
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading || isLocked}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            border: '1px solid var(--da-border, #cbd5e1)',
            background: '#ffffff',
            color: '#1e293b',
            padding: '11px 14px',
            borderRadius: '10px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: (loading || isLocked) ? 'not-allowed' : 'pointer',
            opacity: (loading || isLocked) ? 0.7 : 1,
            transition: 'background 0.2s, border-color 0.2s',
            fontFamily: 'var(--da-font-family)',
            boxSizing: 'border-box',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Sign in with Google</span>
        </button>
      </div>
    </div>
  );
}
