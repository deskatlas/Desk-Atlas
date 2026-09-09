"use client";

import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';

export function Login() {
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const { user, login } = useAuth();
  const router = useRouter();

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

  useEffect(() => {
    if (user && user.role === 'admin') {
      router.push('/manage');
    }
  }, [user, router]);

  const doLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loginEmail || !loginPassword) {
      setErrorMsg('Please enter both email and password.');
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
        setErrorMsg(data.error || 'Login failed. Please check your credentials.');
        setLoading(false);
        return;
      }

      login(data.user.role, data.user.displayName, {
        id: data.user.id,
        email: data.user.email,
        token: data.token,
      });

      router.push('/manage');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div data-screen-label="Admin Login" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--da-brand-dark)' }}>
      <div style={{ width: '380px', background: '#fff', borderRadius: '14px', padding: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--da-brand-accent)' }}></div>
          <span style={{ fontWeight: 800, fontSize: '19px', color: 'var(--da-brand-dark)' }}>DeskAtlas</span>
        </div>
        <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', marginBottom: '24px' }}>Management Portal</div>

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
            disabled={loading}
            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', margin: '6px 0 14px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
          />
          
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)' }}>Password</label>
          <input 
            type="password" 
            value={loginPassword} 
            onChange={(e) => setLoginPassword(e.target.value)} 
            placeholder="••••••••" 
            disabled={loading}
            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', margin: '6px 0 22px', fontFamily: 'var(--da-font-family)', boxSizing: 'border-box' }}
          />
          
          <button 
            type="submit"
            disabled={loading}
            style={{ width: '100%', background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', border: 'none', padding: '13px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
