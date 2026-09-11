"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { PasswordRequirementsChecklist, PasswordInput } from '@deskatlas/ui';
import { validatePassword } from '@deskatlas/domain';

function InvitationVerifyForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    status: string;
    expiresAt: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('No invitation token found in link.');
      setLoading(false);
      return;
    }

    async function loadInvitation() {
      try {
        const res = await fetch(`/api/auth/invitation?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load invitation.');
        }
        setInvitation(data.invitation);
      } catch (err: any) {
        setLoadError(err.message || 'Invalid or expired invitation link.');
      } finally {
        setLoading(false);
      }
    }

    loadInvitation();
  }, [token]);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) {
      setSubmitError('Please enter the 6-digit verification code.');
      return;
    }

    if (newPassword) {
      const validation = validatePassword(newPassword);
      if (!validation.isValid) {
        setSubmitError(`Password does not meet requirements: ${validation.errors.join(' ')}`);
        return;
      }
      if (newPassword !== confirmPassword) {
        setSubmitError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/auth/invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          verificationCode: code.trim(),
          password: newPassword || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed. Please check the code.');
      }

      setIsSuccess(true);
    } catch (err: any) {
      setSubmitError(err.message || 'Verification failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ width: '36px', height: '36px', border: '3px solid #cbd5e1', borderTopColor: '#064E3B', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--da-text-secondary)', fontSize: '14px' }}>Verifying invitation link...</p>
      </div>
    );
  }

  if (loadError || !invitation) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#FEE2E2', color: '#991B1B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', margin: '0 auto 16px', fontWeight: 700 }}>
          !
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 8px' }}>
          Invalid or Expired Invitation
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
          {loadError || 'This invitation link is no longer valid. Please contact your workspace administrator to request a new invitation.'}
        </p>
        <button
          onClick={() => router.push('/manage')}
          style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: 'var(--da-brand-dark)', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          Go to Staff Login
        </button>
      </div>
    );
  }

  if (invitation.status !== 'PENDING') {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#FEF3C7', color: '#B45309', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', margin: '0 auto 16px', fontWeight: 700 }}>
          i
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 8px' }}>
          Invitation Already Processed
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', marginBottom: '24px' }}>
          This invitation has status: <strong>{invitation.status}</strong>. You can proceed directly to sign in.
        </p>
        <button
          onClick={() => router.push('/manage')}
          style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: 'var(--da-brand-dark)', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          Go to Staff Login
        </button>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#D1FAE5', color: '#065F46', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', margin: '0 auto 16px', fontWeight: 700 }}>
          ✓
        </div>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#064E3B', margin: '0 0 8px' }}>
          Account Activated!
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
          Your staff account (<strong>{invitation.email}</strong>) has been successfully verified and activated. You can now log into the Staff Dashboard.
        </p>
        <button
          onClick={() => router.push('/manage')}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}
        >
          Proceed to Staff Login →
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--da-border)' }}>
        <div style={{ display: 'inline-block', background: '#D1FAE5', color: '#065F46', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>
          Invitation for {invitation.role}
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px' }}>
          Welcome, {invitation.displayName}!
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: 0 }}>
          Account: <strong>{invitation.email}</strong>
        </p>
      </div>

      {submitError && (
        <div style={{ background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B', padding: '10px 12px', borderRadius: '8px', marginBottom: '16px', fontSize: '12px' }}>
          {submitError}
        </div>
      )}

      <form onSubmit={handleConfirm} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
            2FA VERIFICATION CODE *
          </label>
          <input
            type="text"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
            placeholder="Enter the 6-digit code"
            required
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '2px solid var(--da-brand-accent)',
              fontSize: '20px',
              letterSpacing: '4px',
              textAlign: 'center',
              fontWeight: 800,
              boxSizing: 'border-box',
              background: '#f8fafc',
            }}
          />
          <p style={{ fontSize: '11px', color: 'var(--da-text-secondary)', margin: '4px 0 0' }}>
            Enter the 6-digit code displayed in your admin console or invitation email.
          </p>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
            SET PERMANENT PASSWORD (OPTIONAL)
          </label>
          <PasswordInput
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Leave blank to use pre-set password"
            style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
          />
          {newPassword ? <PasswordRequirementsChecklist password={newPassword} /> : null}
        </div>

        {newPassword && (
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--da-text-secondary)', marginBottom: '4px' }}>
              CONFIRM PERMANENT PASSWORD
            </label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--da-border)', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: '8px',
            padding: '12px',
            borderRadius: '8px',
            border: 'none',
            background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 700,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Verifying & Activating...' : 'Confirm & Activate Account'}
        </button>
      </form>
    </div>
  );
}

export default function VerifyInvitationPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--da-brand-dark)', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '420px', background: '#fff', borderRadius: '16px', padding: '32px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--da-brand-accent)' }}></div>
          <span style={{ fontWeight: 800, fontSize: '19px', color: 'var(--da-brand-dark)' }}>DeskAtlas</span>
        </div>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', marginBottom: '20px' }}>
          Staff Account Confirmation & 2FA
        </div>

        <Suspense fallback={<div>Loading...</div>}>
          <InvitationVerifyForm />
        </Suspense>
      </div>
    </div>
  );
}
