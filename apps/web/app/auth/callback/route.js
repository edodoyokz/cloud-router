import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../lib/supabase-server.js';

function safeNextPath(value) {
  const next = String(value || '/dashboard');
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_auth_code', url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
