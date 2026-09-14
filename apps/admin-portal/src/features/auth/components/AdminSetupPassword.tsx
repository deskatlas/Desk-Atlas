"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './AuthProvider';
import {
  validatePassword,
  PASSWORD_MIN_LENGTH,
} from '@deskatlas/domain';

export function AdminSetupPassword() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, user } = useAuth();

  const [userId, setUserId] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSealed, setIsSealed] = useState(false);

  // Load session from query params or sessionStorage on mount
  useEffect(() => {
    if (user && user.role === 'admin' && !success) {
      router.push('/manage');
      return;
    }

    let qUserId = searchParams.get('userId') || '';
    let qEmail = searchParams.get('email') || '';

    let sUserId = '';
    let sEmail = '';
    let sDisplayName = '';
    let sToken = '';

    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem('da_admin_setup_user');
        if (raw) {
          const parsed = JSON.parse(raw);
          sUserId = parsed.userId || '';
          sEmail = parsed.email || '';
          sDisplayName = parsed.displayName || '';
          sToken = parsed.token || '';
        }
      } catch (e) {
        // ignore storage parse error
      }
    }

    const finalUserId = qUserId || sUserId;
    const finalEmail = qEmail || sEmail;

    // Query setup status to verify if setup is sealed
    const statusUrl = finalUserId
      ? `/api/admin/auth/setup/status?userId=${encodeURIComponent(finalUserId)}`
      : '/api/admin/auth/setup/status';

    fetch(statusUrl, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        // If password is already configured or setup is sealed, permanently block access
        if (data && (data.isPasswordConfigured || (data.hasAdmin && !data.setupAllowed))) {
          setIsSealed(true);
          setSessionLoaded(true);
          if (typeof window !== 'undefined') {
            try {
              sessionStorage.removeItem('da_admin_setup_user');
            } catch {}
          }
          return;
        }

        // If no credentials exist:
        if (!finalUserId && !finalEmail) {
          if (data && data.hasAdmin) {
            router.push('/manage/login');
          } else {
            router.push('/manage/setup');
          }
          return;
        }

        // If no admin was bootstrapped yet, redirect to initial setup
        if (data && !data.hasAdmin) {
          router.push('/manage/setup');
          return;
        }

        setUserId(finalUserId);
        setEmail(finalEmail);
        setDisplayName(sDisplayName);
        setToken(sToken);
        setSessionLoaded(true);
      })
      .catch(() => {
        if (!finalUserId && !finalEmail) {
          router.push('/manage/setup');
        } else {
          setUserId(finalUserId);
          setEmail(finalEmail);
          setDisplayName(sDisplayName);
          setToken(sToken);
          setSessionLoaded(true);
        }
      });
  }, [user, router, searchParams, success]);

  // Validation rules evaluation
  const validation = useMemo(() => validatePassword(password), [password]);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isFormValid = validation.isValid && passwordsMatch && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/admin/auth/setup/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          email,
          displayName,
          password,
          token,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403 || data.error?.includes('already exists') || data.error?.includes('sealed')) {
          setIsSealed(true);
        }
        setErrorMsg(data.error || 'Failed to set admin password. Please try again.');
        setLoading(false);
        return;
      }

      // Clean up temporary setup session storage and scrub query params
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem('da_admin_setup_user');
          window.history.replaceState({}, '', '/manage/setup/password');
        } catch {
          // ignore
        }
      }

      setSuccess(true);

      // Authenticate admin session
      login('admin', data.user?.displayName || displayName || 'Admin', {
        id: data.user?.id || userId,
        email: data.user?.email || email,
        token: data.token || token,
        isSuperAdmin: true,
      });

      // Navigate to admin portal dashboard
      setTimeout(() => {
        router.push('/manage');
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error occurred while finalizing setup.');
      setLoading(false);
    }
  };

  if (!sessionLoaded) {
    return (
      <div
        data-screen-label="Admin Password Setup Loading"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(ellipse at top, #143527 0%, #0c1c15 50%, #070f0b 100%)',
          color: '#e2e8f0',
          fontFamily: 'var(--da-font-family, system-ui, sans-serif)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '3px solid rgba(16, 185, 129, 0.2)',
              borderTopColor: '#10b981',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <div style={{ fontSize: '14px', letterSpacing: '0.05em', color: '#94a3b8' }}>
            Preparing password setup session...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (isSealed) {
    return (
      <div
        data-screen-label="Admin Password Setup Sealed"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(ellipse at top, #143527 0%, #0c1c15 50%, #070f0b 100%)',
          padding: '24px',
          fontFamily: 'var(--da-font-family, system-ui, sans-serif)',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '440px',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '16px',
            padding: '40px 32px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px rgba(239, 68, 68, 0.1)',
            backdropFilter: 'blur(16px)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              color: '#ef4444',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <span
            style={{
              display: 'inline-block',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '4px 10px',
              borderRadius: '999px',
              marginBottom: '12px',
            }}
          >
            HTTP 403 • Setup Sealed
          </span>

          <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#f8fafc', margin: '0 0 10px' }}>
            Setup Unavailable
          </h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, margin: '0 0 24px' }}>
            An administrator account already exists and password configuration has been completed for this deployment. For security, setup is permanently sealed.
          </p>

          <button
            onClick={() => router.push('/manage/login')}
            style={{
              width: '100%',
              background: '#059669',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              padding: '12px 18px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(5, 150, 105, 0.3)',
              transition: 'background 0.2s',
            }}
          >
            Proceed to Admin Login
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-screen-label="Admin Password Setup"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at top, #143527 0%, #0c1c15 50%, #070f0b 100%)',
        padding: '24px',
        fontFamily: 'var(--da-font-family, system-ui, sans-serif)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '18px',
          padding: '38px 34px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.6), 0 0 35px rgba(16, 185, 129, 0.15)',
          backdropFilter: 'blur(20px)',
          boxSizing: 'border-box',
        }}
      >
        {/* Header Badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }} />
            <span style={{ fontWeight: 800, fontSize: '18px', color: '#f8fafc', letterSpacing: '-0.02em' }}>
              DeskAtlas
            </span>
          </div>
          <span
            style={{
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              padding: '4px 10px',
              borderRadius: '999px',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            Step 2 • Set Password
          </span>
        </div>

        {/* Title */}
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Create Admin Password
        </h1>
        <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, margin: '0 0 20px' }}>
          Your Google account was successfully connected. Define a master password to sign in directly with your email at any time.
        </p>

        {/* Connected Email Badge */}
        <div
          style={{
            background: 'rgba(2, 6, 23, 0.65)',
            border: '1px solid rgba(51, 65, 85, 0.5)',
            borderRadius: '10px',
            padding: '12px 14px',
            marginBottom: '22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#10b981',
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                Connected Account
              </div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {email}
              </div>
            </div>
          </div>
          <span
            style={{
              fontSize: '11px',
              color: '#10b981',
              fontWeight: 700,
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              flexShrink: 0,
            }}
          >
            Verified
          </span>
        </div>

        {errorMsg && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              padding: '12px 14px',
              borderRadius: '10px',
              fontSize: '13px',
              lineHeight: 1.5,
              marginBottom: '20px',
            }}
          >
            {errorMsg}
          </div>
        )}

        {success ? (
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              padding: '28px 20px',
              borderRadius: '12px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#f8fafc', margin: '0 0 6px' }}>
              Administrator Setup Complete!
            </h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
              Password configured. Launching your management portal...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* New Password Field */}
            <div style={{ marginBottom: '18px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#cbd5e1',
                  marginBottom: '6px',
                  letterSpacing: '0.02em',
                }}
              >
                Admin Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter strong password"
                  disabled={loading}
                  autoComplete="new-password"
                  style={{
                    width: '100%',
                    background: 'rgba(2, 6, 23, 0.7)',
                    border: `1px solid ${
                      password.length > 0 && !validation.isValid
                        ? 'rgba(239, 68, 68, 0.5)'
                        : password.length > 0 && validation.isValid
                        ? 'rgba(16, 185, 129, 0.5)'
                        : 'rgba(51, 65, 85, 0.6)'
                    }`,
                    borderRadius: '10px',
                    padding: '12px 42px 12px 14px',
                    fontSize: '14px',
                    color: '#f8fafc',
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password Field */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#cbd5e1',
                  marginBottom: '6px',
                  letterSpacing: '0.02em',
                }}
              >
                Confirm Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  disabled={loading}
                  autoComplete="new-password"
                  style={{
                    width: '100%',
                    background: 'rgba(2, 6, 23, 0.7)',
                    border: `1px solid ${
                      confirmPassword.length > 0 && !passwordsMatch
                        ? 'rgba(239, 68, 68, 0.5)'
                        : confirmPassword.length > 0 && passwordsMatch
                        ? 'rgba(16, 185, 129, 0.5)'
                        : 'rgba(51, 65, 85, 0.6)'
                    }`,
                    borderRadius: '10px',
                    padding: '12px 42px 12px 14px',
                    fontSize: '14px',
                    color: '#f8fafc',
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex={-1}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Password Policy Checklist (MF-46 compliance) */}
            <div
              style={{
                background: 'rgba(2, 6, 23, 0.5)',
                border: '1px solid rgba(51, 65, 85, 0.4)',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '24px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: '8px', letterSpacing: '0.05em' }}>
                Password Security Requirements
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: validation.minLength ? '#34d399' : '#94a3b8' }}>
                  <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{validation.minLength ? '✓' : '○'}</span>
                  <span>Min {PASSWORD_MIN_LENGTH} chars</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: validation.hasUppercase ? '#34d399' : '#94a3b8' }}>
                  <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{validation.hasUppercase ? '✓' : '○'}</span>
                  <span>1 Uppercase (A-Z)</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: validation.hasNumber ? '#34d399' : '#94a3b8' }}>
                  <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{validation.hasNumber ? '✓' : '○'}</span>
                  <span>1 Number (0-9)</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: validation.hasSpecialChar ? '#34d399' : '#94a3b8' }}>
                  <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{validation.hasSpecialChar ? '✓' : '○'}</span>
                  <span>1 Symbol (!@#$)</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: passwordsMatch ? '#34d399' : '#94a3b8', gridColumn: 'span 2', marginTop: '2px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{passwordsMatch ? '✓' : '○'}</span>
                  <span>Passwords match</span>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!isFormValid || loading}
              style={{
                width: '100%',
                background: isFormValid && !loading
                  ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                  : 'rgba(51, 65, 85, 0.4)',
                color: isFormValid && !loading ? '#ffffff' : '#64748b',
                border: 'none',
                padding: '14px',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: isFormValid && !loading ? 'pointer' : 'not-allowed',
                boxShadow: isFormValid && !loading ? '0 4px 16px rgba(16, 185, 129, 0.3)' : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              {loading ? 'Finalizing Administrator Setup...' : 'Complete Setup & Launch Portal'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
