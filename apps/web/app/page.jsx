import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 32 }}>
      <h1>NusaNexus Router</h1>
      <p>Hosted AI router untuk coding tools, zero-setup.</p>
      <nav style={{ display: 'flex', gap: 12 }}>
        <Link href="/dashboard">Open dashboard</Link>
        <Link href="/login">Log in</Link>
        <Link href="/signup">Sign up</Link>
      </nav>
    </main>
  );
}
