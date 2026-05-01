import { NextResponse } from 'next/server';
import { createSupabaseMiddlewareClient } from './lib/supabase-server.js';

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/dashboard')) {
    return NextResponse.next();
  }

  const { supabase, response } = createSupabaseMiddlewareClient(request);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response();
}

export const config = {
  matcher: ['/dashboard/:path*']
};
