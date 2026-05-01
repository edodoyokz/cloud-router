'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authCallbackUrl, safeNextPath } from '../lib/auth-redirects.js';
import { getSupabaseBrowserClient } from '../lib/supabase-browser.js';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d0d7de',
  fontSize: 14,
  boxSizing: 'border-box'
};

const buttonStyle = {
  border: 0,
  borderRadius: 10,
  padding: '11px 14px',
  background: '#111827',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer'
};

export default function AuthForm({ mode, nextPath = '/dashboard' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);
  const isSignup = mode === 'signup';
  const destination = safeNextPath(nextPath);

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setStatus(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const result = isSignup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) throw result.error;

      const session = result.data?.session;
      if (!session?.access_token) {
        setStatus({ type: 'success', message: 'Check your email to confirm your account, then log in.' });
        return;
      }

      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Failed to prepare workspace');

      setStatus({ type: 'success', message: 'Workspace ready. You can open the dashboard now.', href: destination });
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Authentication failed' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        Email
        <input style={inputStyle} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        Password
        <input style={inputStyle} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
      </label>
      <button style={buttonStyle} type="submit" disabled={pending}>{pending ? 'Working…' : isSignup ? 'Create account' : 'Log in'}</button>
      {status ? <StatusMessage status={status} /> : null}
      {status?.type === 'success' ? <Link href={status.href || destination}>Open dashboard</Link> : null}
    </form>
  );
}

function StatusMessage({ status }) {
  const isError = status.type === 'error';
  return (
    <div style={{
      borderRadius: 10,
      padding: '10px 12px',
      background: isError ? '#fef2f2' : '#ecfdf5',
      color: isError ? '#991b1b' : '#065f46',
      border: `1px solid ${isError ? '#fecaca' : '#a7f3d0'}`
    }}>
      {status.message}
    </div>
  );
}
