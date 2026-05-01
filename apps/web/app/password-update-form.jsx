'use client';

import Link from 'next/link';
import { useState } from 'react';
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

export default function PasswordUpdateForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setStatus(null);
    if (password.length < 8) {
      setStatus({ type: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const result = await supabase.auth.updateUser({ password });
      if (result.error) throw result.error;

      const sessionResult = await supabase.auth.getSession();
      const token = sessionResult.data?.session?.access_token;
      if (token) {
        const response = await fetch('/api/auth/bootstrap', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data?.error?.message || 'Password updated, but workspace bootstrap failed');
        }
      }

      setStatus({ type: 'success', message: 'Password updated. You can open the dashboard now.' });
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Failed to update password' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        New password
        <input style={inputStyle} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
      </label>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        Confirm password
        <input style={inputStyle} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} />
      </label>
      <button style={buttonStyle} type="submit" disabled={pending}>{pending ? 'Updating…' : 'Update password'}</button>
      {status ? <StatusMessage status={status} /> : null}
      {status?.type === 'success' ? <Link href="/dashboard">Open dashboard</Link> : null}
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
