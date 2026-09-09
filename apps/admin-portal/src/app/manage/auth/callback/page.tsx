"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth';

export const dynamic = 'force-dynamic';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function handleAuthCallback() {
      try {
        let token: string | null = null;
        let userId: string | null = null;
        let email: string | null = null;
        let displayName: string | null = null;

        // 1. Check URL hash fragment (Implicit Grant flow)
        if (typeof window !== 'undefined' && window.location.hash) {
          const hashClean = window.location.hash.startsWith('#') ? window.location.hash.substring(1) : window.location.hash;
          const hashParams = new URLSearchParams(hashClean);
          token = hashParams.get('access_token');
          if (!token) {
            token = hashParams.get('token');
          }
        }

        // 2. Check URL search query parameters (PKCE / authorization code flow)
        let authCode: string | null = null;
        if (typeof window !== 'undefined' && window.location.search) {
          const searchClean = window.location.search.startsWith('?') ? window.location.search.substring(1) : window.location.search;
          const queryParams = new URLSearchParams(searchClean);
          
          // Check for direct access token or user credentials in query params
          if (!token) {
            token = queryParams.get('access_token') || queryParams.get('token');
          }
          authCode = queryParams.get('code');
          userId = queryParams.get('user_id');
          email = queryParams.get('email');
          displayName = queryParams.get('display_name') || queryParams.get('name');

          // Check if Supabase returned an error in the query parameters
          const errorDesc = queryParams.get('error_description') || queryParams.get('error');
          if (errorDesc) {
            setStatus('error');
            setErrorMessage(`Google OAuth error: ${errorDesc}`);
            return;
          }
        }

        // 3. Fallback: Check if Supabase client session exists in local storage or cookies
        if (!token && !authCode && typeof window !== 'undefined') {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('sb-') || key.includes('supabase')) && (key.endsWith('-auth-token') || key.includes('token'))) {
              try {
                const raw = localStorage.getItem(key);
                if (raw) {
                  const parsed = JSON.parse(raw);
                  if (parsed.access_token) {
                    token = parsed.access_token;
                    userId = parsed.user?.id;
                    email = parsed.user?.email;
                    displayName = parsed.user?.user_metadata?.full_name || parsed.user?.user_metadata?.name;
                    break;
                  }
                }
              } catch {
                // ignore JSON parse error
              }
            }
          }
        }

        if (!token && !userId && !authCode) {
          setStatus('error');
          setErrorMessage('No authentication credentials found in Google OAuth response. Please ensure Google provider is enabled in Supabase.');
          return;
        }

        // 4. Send token or authorization code to server setup endpoint to bootstrap/verify admin profile
        const res = await fetch('/api/admin/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: authCode,
            token,
            userId,
            email,
            displayName,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setStatus('error');
          setErrorMessage(data.error || 'Failed to initialize administrator profile.');
          return;
        }

        // 5. Successfully bootstrapped or verified!
        setStatus('success');
        login('admin', data.user?.displayName || 'Admin', {
          id: data.user?.id,
          email: data.user?.email,
          token: data.token || token,
        });

        // Redirect to admin dashboard
        setTimeout(() => {
          router.push('/manage');
        }, 800);
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err?.message || 'Unexpected error processing Google OAuth callback.');
      }
    }

    handleAuthCallback();
  }, [router, login]);

  return (
    <div
      data-screen-label="Admin Auth Callback"
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
          maxWidth: '420px',
          background: 'rgba(15, 23, 42, 0.85)',
          border: `1px solid ${
            status === 'error'
              ? 'rgba(239, 68, 68, 0.3)'
              : status === 'success'
              ? 'rgba(16, 185, 129, 0.4)'
              : 'rgba(51, 65, 85, 0.4)'
          }`,
          borderRadius: '16px',
          padding: '40px 32px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(16px)',
          textAlign: 'center',
        }}
      >
        {status === 'processing' && (
          <>
            <div
              style={{
                width: '40px',
                height: '40px',
                border: '3px solid rgba(16, 185, 129, 0.2)',
                borderTopColor: '#10b981',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 20px',
              }}
            />
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: '0 0 8px' }}>
              Finalizing Administrator Setup
            </h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
              Verifying Google OAuth token and configuring root admin privileges...
            </p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        )}

        {status === 'success' && (
          <>
            <div
              style={{
                width: '50px',
                height: '50px',
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                color: '#10b981',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: '0 0 8px' }}>
              Setup Complete!
            </h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
              Administrator account initialized. Redirecting to management portal...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div
              style={{
                width: '50px',
                height: '50px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                color: '#ef4444',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: '0 0 8px' }}>
              Authentication Failed
            </h2>
            <p style={{ fontSize: '13px', color: '#fca5a5', margin: '0 0 24px', lineHeight: 1.5 }}>
              {errorMessage}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => router.push('/manage/setup')}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  padding: '11px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Retry Admin Setup
              </button>
              <button
                onClick={() => router.push('/manage/login')}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '11px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Go to Login Page
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
