"use client";

import React, { useState } from 'react';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { PasswordInput } from '@deskatlas/ui';

export function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
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
        setErrorMsg(data.error || 'Invalid credentials or unauthorized account');
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
      setErrorMsg(err.message || 'Login failed. Please try again.');
      setLoading(false);
    }
  };

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
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            placeholder="staff@deskatlas.com" 
            disabled={loading}
            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', margin: '6px 0 14px', fontFamily: "'Inter', sans-serif", outline: 'none' }}
          />
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', fontFamily: "'Inter', sans-serif" }}>Password</label>
          <PasswordInput 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            placeholder="••••••••" 
            disabled={loading}
            style={{ width: '100%', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '11px 12px', fontSize: '14px', margin: '6px 0 22px', fontFamily: "'Inter', sans-serif", outline: 'none' }}
          />
          <button 
            type="submit"
            disabled={loading}
            style={{ width: '100%', background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)', color: '#fff', border: 'none', padding: '13px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
