"use client";

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PasswordInput, PasswordRequirementsChecklist } from '@deskatlas/ui';
import { validatePassword } from '@deskatlas/domain';

export function ResetPassword() {
  const [token, setToken] = useState<string>('');
  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string>('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Check URL search params for token
    let resetToken = searchParams.get('token');

    // Also check hash fragment in case of Supabase Auth direct email link redirect
    if (!resetToken && typeof window !== 'undefined' && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hashParams.get('access_token');
      if (accessToken) {
        resetToken = accessToken;
      }
    }

    if (!resetToken) {
      setVerifying(false);
      setTokenValid(false);
      setTokenError('No password reset token was provided.');
      return;
    }

    setToken(resetToken);

    // Verify token with backend
    fetch(`/api/admin/auth/reset-password/verify?token=${encodeURIComponent(resetToken)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setTokenValid(true);
          setAccountEmail(data.email || '');
        } else {
          setTokenValid(false);
          setTokenError(data.error || 'This password reset link is invalid or has expired.');
        }
      })
      .catch((err) => {
        setTokenValid(false);
        setTokenError(err?.message || 'Failed to verify password reset token.');
      })
      .finally(() => {
        setVerifying(false);
      });
  }, [searchParams]);

  const validation = validatePassword(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isFormValid = validation.isValid && passwordsMatch;

  const doSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      if (!validation.isValid) {
        setSubmitError(`Password does not meet requirements: ${validation.errors.join(' ')}`);
      } else if (!passwordsMatch) {
        setSubmitError('Passwords do not match.');
      }
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/admin/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password: newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmitError(data.error || 'Failed to update password.');
        setSubmitting(false);
        return;
      }

      // Redirect to login with success indicator
      router.push('/manage/login?reset=success');
    } catch (err: any) {
      setSubmitError(err?.message || 'Network error occurred. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div
      data-screen-label="Admin Reset Password"
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
          width: '420px',
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
          Management Portal &bull; Set New Password
        </div>

        {verifying ? (
          <div data-testid="reset-password-verifying" style={{ textAlign: 'center', padding: '30px 0', color: 'var(--da-text-secondary)' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Verifying password reset link...</div>
          </div>
        ) : !tokenValid ? (
          <div data-testid="reset-password-invalid-token">
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                padding: '14px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                lineHeight: 1.5,
                marginBottom: '20px',
                fontFamily: 'var(--da-font-family)',
              }}
            >
              <strong>Reset link invalid:</strong> {tokenError || 'This password reset link is invalid or has expired.'}
            </div>

            <button
              type="button"
              onClick={() => router.push('/manage/forgot-password')}
              data-testid="request-new-link-btn"
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
                marginBottom: '12px',
              }}
            >
              Request New Reset Link
            </button>

            <div style={{ textAlign: 'center' }}>
              <a
                href="/manage/login"
                style={{
                  fontSize: '13px',
                  color: 'var(--da-text-secondary, #4B5563)',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                &larr; Return to Sign In
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={doSubmit} data-testid="reset-password-form">
            <h1
              style={{
                fontSize: '18px',
                fontWeight: 800,
                color: 'var(--da-text-primary, #111827)',
                margin: '0 0 6px',
                fontFamily: 'var(--da-font-family)',
              }}
            >
              Set New Admin Password
            </h1>
            {accountEmail && (
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--da-text-secondary, #6B7280)',
                  marginBottom: '16px',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Account: <strong>{accountEmail}</strong>
              </div>
            )}

            {submitError && (
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
                {submitError}
              </div>
            )}

            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--da-text-primary)',
                fontFamily: 'var(--da-font-family)',
                marginBottom: '4px',
              }}
            >
              New Password
            </label>
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              disabled={submitting}
              data-testid="reset-new-password-input"
              style={{
                width: '100%',
                border: '1px solid var(--da-border)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '14px',
                fontFamily: 'var(--da-font-family)',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ marginTop: '6px', marginBottom: '14px' }}>
              <PasswordRequirementsChecklist password={newPassword} showWhenEmpty={true} />
            </div>

            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--da-text-primary)',
                fontFamily: 'var(--da-font-family)',
                marginBottom: '4px',
              }}
            >
              Confirm New Password
            </label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              disabled={submitting}
              data-testid="reset-confirm-password-input"
              style={{
                width: '100%',
                border: '1px solid var(--da-border)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '14px',
                fontFamily: 'var(--da-font-family)',
                boxSizing: 'border-box',
              }}
            />
            {confirmPassword && !passwordsMatch && (
              <div style={{ fontSize: '11px', color: '#b91c1c', marginTop: '4px', fontWeight: 600 }}>
                Passwords do not match
              </div>
            )}

            <button
              type="submit"
              disabled={!isFormValid || submitting}
              data-testid="reset-submit-btn"
              style={{
                width: '100%',
                background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)',
                color: '#fff',
                border: 'none',
                padding: '13px',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: !isFormValid || submitting ? 'not-allowed' : 'pointer',
                opacity: !isFormValid || submitting ? 0.6 : 1,
                marginTop: '20px',
              }}
            >
              {submitting ? 'Updating Password...' : 'Update Password'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <a
                href="/manage/login"
                style={{
                  fontSize: '13px',
                  color: 'var(--da-text-secondary, #4B5563)',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                &larr; Cancel and return to Sign In
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
