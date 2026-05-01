import Link from 'next/link';
import AuthForm from '../auth-form.jsx';

export const metadata = {
  title: 'Sign up — NusaNexus Router'
};

export default function SignupPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#111827', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 24px', display: 'grid', gap: 20 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <Link href="/">NusaNexus Router</Link>
          <h1 style={{ margin: 0 }}>Create account</h1>
          <p style={{ margin: 0, color: '#4b5563' }}>Create your account and personal workspace.</p>
        </header>
        <section style={{ border: '1px solid #d0d7de', borderRadius: 16, padding: 20, background: '#fff' }}>
          <AuthForm mode="signup" />
        </section>
        <Link href="/login">Already have an account? Log in</Link>
      </div>
    </main>
  );
}
