import Link from 'next/link';
import AuthForm from '../auth-form.jsx';

export const metadata = {
  title: 'Login — NusaNexus Router'
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = typeof params?.next === 'string' ? params.next : '/dashboard';

  return <AuthPage title="Log in" subtitle="Access your NusaNexus Router dashboard." mode="login" alternateHref="/signup" alternateText="Need an account? Sign up" nextPath={next} />;
}

function AuthPage({ title, subtitle, mode, alternateHref, alternateText, nextPath }) {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#111827', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 24px', display: 'grid', gap: 20 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <Link href="/">NusaNexus Router</Link>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <p style={{ margin: 0, color: '#4b5563' }}>{subtitle}</p>
        </header>
        <section style={{ border: '1px solid #d0d7de', borderRadius: 16, padding: 20, background: '#fff' }}>
          <AuthForm mode={mode} nextPath={nextPath} />
        </section>
        <Link href={alternateHref}>{alternateText}</Link>
        <Link href="/forgot-password">Forgot your password?</Link>
      </div>
    </main>
  );
}
