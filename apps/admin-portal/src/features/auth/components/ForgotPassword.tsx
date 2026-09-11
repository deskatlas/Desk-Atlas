"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  const doSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.trim()) {
      setErrorMsg('Please enter your administrator email address.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/admin/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to submit password reset request.');
        setLoading(false);
        return;
      }

      setSubmitted(true);
      setLoading(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div
      data-screen-label="Admin Forgot Password"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--da-brand-dark)',
      }}
    >
      <div
        style={{
          width: '400px',
          background: '#fff',
          borderRadius: '14px',
          padding: '36px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: 'var(--da-brand-accent)',
            }}
          ></div>
          <span style={{ fontWeight: 800, fontSize: '19px', color: 'var(--da-brand-dark)' }}>
            DeskAtlas
          </span>
        </div>
        <div
          style={{
            fontSize: '13px',
            color: 'var(--da-text-secondary)',
            fontFamily: 'var(--da-font-family)',
            marginBottom: '20px',
          }}
        >
          Management Portal &bull; Password Recovery
        </div>

        <h1
          style={{
            fontSize: '18px',
            fontWeight: 800,
            color: 'var(--da-text-primary, #111827)',
            margin: '0 0 8px',
            fontFamily: 'var(--da-font-family)',
          }}
        >
          Reset Admin Password
        </h1>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--da-text-secondary, #6B7280)',
            margin: '0 0 20px',
            lineHeight: 1.5,
            fontFamily: 'var(--da-font-family)',
          }}
        >
          Enter the email address associated with your administrator account. We will send you a secure link to reset your password.
        </p>

        {submitted ? (
          <div data-testid="forgot-password-success">
            <div
              style={{
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                color: '#065f46',
                padding: '14px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                lineHeight: 1.5,
                marginBottom: '20px',
                fontFamily: 'var(--da-font-family)',
              }}
            >
              <strong>Check your inbox:</strong> If an admin account is associated with <strong>{email}</strong>, you will receive password reset instructions shortly.
            </div>

            <button
              type="button"
              onClick={() => router.push('/manage/login')}
              style={{
                width: '100%',
                background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)',
                color: '#fff',
                border: 'none',
                padding: '12px',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Return to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={doSubmit}>
            {errorMsg && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  marginBottom: '16px',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                {errorMsg}
              </div>
            )}

            <label
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--da-text-primary)',
                fontFamily: 'var(--da-font-family)',
              }}
            >
              Admin Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@deskatlas.com"
              disabled={loading}
              data-testid="forgot-password-email-input"
              style={{
                width: '100%',
                border: '1px solid var(--da-border)',
                borderRadius: '8px',
                padding: '11px 12px',
                fontSize: '14px',
                margin: '6px 0 20px',
                fontFamily: 'var(--da-font-family)',
                boxSizing: 'border-box',
              }}
            />

            <button
              type="submit"
              disabled={loading}
              data-testid="forgot-password-submit-btn"
              style={{
                width: '100%',
                background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)',
                color: '#fff',
                border: 'none',
                padding: '13px',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Sending Reset Link...' : 'Send Reset Link'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '18px' }}>
              <a
                href="/manage/login"
                data-testid="back-to-login-link"
                style={{
                  fontSize: '13px',
                  color: 'var(--da-text-secondary, #4B5563)',
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                &larr; Back to Sign In
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
