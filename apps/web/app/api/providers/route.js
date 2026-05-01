import { NextResponse } from 'next/server';
import { normalizeProviderInput } from '../../../lib/provider-validation.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const input = normalizeProviderInput(body);

    // TODO: wire Supabase auth, workspace resolution, encryption, and insert.
    return NextResponse.json({
      provider_type: input.provider_type,
      display_name: input.display_name,
      auth_method: input.auth_method,
      status: 'pending_persistence'
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: { code: 'validation_error', message: error.message } }, { status: 400 });
  }
}
