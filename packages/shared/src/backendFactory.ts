import type { Backend } from './backend';
import { createMockServer } from './mockServer';
import { hasSupabaseConfig } from './supabaseClient';
import { createSupabaseBackend } from './supabaseBackend';

/**
 * Picks the backend once at startup.
 *  - EXPO_PUBLIC_BACKEND=mock            → in-memory demo (no network)
 *  - otherwise, with Supabase keys set   → real backend
 *  - keys missing                         → mock, with a loud warning
 */
export function createBackend(role: 'customer' | 'driver'): Backend {
  const forced = process.env.EXPO_PUBLIC_BACKEND;
  if (forced === 'mock') return createMockServer(role);
  if (hasSupabaseConfig()) return createSupabaseBackend();
  console.warn('[backend] EXPO_PUBLIC_SUPABASE_URL / ANON_KEY not set — running against the in-memory mock. Copy .env.example to .env.');
  return createMockServer(role);
}
