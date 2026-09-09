"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

export function AdminSetup() {
  const [checking, setChecking] = useState(true);
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role === 'admin') {
      router.push('/manage');
      return;
    }

    async function checkSetup() {
      try {
        const res = await fetch('/api/admin/auth/setup/status', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setHasAdmin(Boolean(data.hasAdmin));
        } else {
          setHasAdmin(false);
        }
      } catch (e) {
        setHasAdmin(false);
      } finally {
        setChecking(false);
      }
    }

    checkSetup();
  }, [user, router]);

  const handleGoogleSignUp = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      // Determine origin callback URL
      const origin = window.location.origin;
      const callbackUrl = `${origin}/manage/auth/callback`;

      // Fetch OAuth authorize URL from API endpoint
      const res = await fetch(`/api/admin/auth/google?redirect_to=${encodeURIComponent(callbackUrl)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      }

      // Fallback: direct browser navigation to OAuth endpoint
      window.location.href = `/api/admin/auth/google?redirect_to=${encodeURIComponent(callbackUrl)}`;
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to initiate Google authentication. Please try again.');
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div
        data-screen-label="Admin Setup Loading"
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
            Verifying system initialization state...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // If an administrator is already registered, seal the setup screen (403 Forbidden UX)
  if (hasAdmin) {
    return (
      <div
        data-screen-label="Admin Setup Sealed"
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
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
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
            An administrator account already exists for this DeskAtlas deployment. For security, single-use bootstrap is permanently disabled.
          </p>

          <button
            onClick={() => router.push('/manage/login')}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#ffffff',
              border: 'none',
              padding: '13px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
            }}
          >
            Go to Admin Login
          </button>
        </div>
      </div>
    );
  }

  // Single-use setup form when no admin exists
  return (
    <div
      data-screen-label="Admin Single-Use Setup"
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
          maxWidth: '460px',
          background: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: '18px',
          padding: '40px 36px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.6), 0 0 35px rgba(16, 185, 129, 0.15)',
          backdropFilter: 'blur(20px)',
          boxSizing: 'border-box',
        }}
      >
        {/* Header Badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
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
            One-Time Setup
          </span>
        </div>

        {/* Title */}
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#ffffff', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Initialize Administrator
        </h1>
        <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, margin: '0 0 24px' }}>
          No administrator account exists yet. Authenticate with Google to create the root admin profile and lock initial deployment setup.
        </p>

        {/* Feature Highlights */}
        <div
          style={{
            background: 'rgba(2, 6, 23, 0.55)',
            border: '1px solid rgba(51, 65, 85, 0.4)',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '28px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
            <div style={{ color: '#10b981', marginTop: '2px', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
                <path d="m9 12 2 2 4-4"/>
              </svg>
            </div>
            <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 }}>
              <strong style={{ color: '#f8fafc' }}>Google OAuth Verification:</strong> Email ownership and deliverability are automatically confirmed by Google IDP.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ color: '#10b981', marginTop: '2px', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 }}>
              <strong style={{ color: '#f8fafc' }}>Single-Admin Gate:</strong> Once registered, this screen permanently closes and cannot be used to create secondary accounts.
            </div>
          </div>
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

        {/* Action Button: Sign Up With Google */}
        <button
          type="button"
          onClick={handleGoogleSignUp}
          disabled={loading}
          style={{
            width: '100%',
            background: '#ffffff',
            color: '#0f172a',
            border: '1px solid #e2e8f0',
            padding: '13px 18px',
            borderRadius: '12px',
            fontWeight: 700,
            fontSize: '14px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            transition: 'background 0.2s ease, transform 0.15s ease',
          }}
        >
          {loading ? (
            <span>Connecting to Google...</span>
          ) : (
            <>
              {/* Google Brand SVG */}
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27a7.18 7.18 0 0 1 0-4.54V6.58H1.25a11.96 11.96 0 0 0 0 10.84l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Sign up with Google</span>
            </>
          )}
        </button>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Already initialized?{' '}
            <button
              onClick={() => router.push('/manage/login')}
              style={{
                background: 'none',
                border: 'none',
                color: '#34d399',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              Sign in with password
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
