'use client';

import { useState } from 'react';
import { authCallbackUrl } from '../lib/auth-redirects.js';
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

export default function PasswordResetForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setStatus(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authCallbackUrl('/reset-password')
      });
      if (result.error) throw result.error;
      setStatus({ type: 'success', message: 'If an account exists, reset instructions were sent.' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Failed to request password reset' });
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
      <button style={buttonStyle} type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reset instructions'}</button>
      {status ? <StatusMessage status={status} /> : null}
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
