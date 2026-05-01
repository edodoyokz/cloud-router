import DashboardClient from './dashboard-client.jsx';

export const metadata = {
  title: 'Dashboard — NusaNexus Router'
};

export default function DashboardPage() {
  const routerBaseUrl = process.env.NEXT_PUBLIC_ROUTER_BASE_URL || 'http://localhost:8080';

  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#111827', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 24px', display: 'grid', gap: 24 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, color: '#2563eb', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>NusaNexus Router</p>
          <h1 style={{ margin: 0, fontSize: 38 }}>Dashboard</h1>
          <p style={{ margin: 0, color: '#4b5563', fontSize: 16 }}>
            Configure your OpenAI-compatible provider and generate a router API key.
          </p>
          <div style={{ marginTop: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', borderRadius: 12, padding: 12 }}>
            Authenticated sessions use Supabase cookies. Local API calls may still use <code>DEV_WORKSPACE_ID</code> fallback when no session is present.
          </div>
        </header>
        <DashboardClient routerBaseUrl={routerBaseUrl} />
      </div>
    </main>
  );
}
