import Link from 'next/link';
import PasswordResetForm from '../password-reset-form.jsx';

export const metadata = {
  title: 'Forgot password — NusaNexus Router'
};

export default function ForgotPasswordPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#111827', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 24px', display: 'grid', gap: 20 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <Link href="/">NusaNexus Router</Link>
          <h1 style={{ margin: 0 }}>Reset password</h1>
          <p style={{ margin: 0, color: '#4b5563' }}>Enter your email and we’ll send reset instructions if an account exists.</p>
        </header>
        <section style={{ border: '1px solid #d0d7de', borderRadius: 16, padding: 20, background: '#fff' }}>
          <PasswordResetForm />
        </section>
        <Link href="/login">Back to login</Link>
      </div>
    </main>
  );
}
