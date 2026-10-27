import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

/** Every request gives up after 20 s (weak Wi-Fi, network switch) instead of waiting forever. */
function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  init.signal?.addEventListener?.('abort', () => ctrl.abort());
  return fetch(input, { ...init, signal: ctrl.signal })
    .catch((err) => {
      throw ctrl.signal.aborted ? new Error('The internet is slow right now. Please try again.') : err;
    })
    .finally(() => clearTimeout(timer));
}

/** A simple in-app lock for the login token (the browser lock was the cause of freezes in the web app). */
const chains = new Map<string, Promise<unknown>>();
function appLock<R>(name: string, _timeout: number, fn: () => Promise<R>): Promise<R> {
  const run = (chains.get(name) ?? Promise.resolve()).catch(() => undefined).then(fn);
  chains.set(name, run.catch(() => undefined));
  return run;
}

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, lock: appLock,
    // Web app 2.0 lives next to the old web app on the same site: keep its sign-in separate. (Phones keep the default.)
    ...(Platform.OS === 'web' ? { storageKey: 'master-bill-2-auth' } : {}),
  },
  global: { fetch: fetchWithTimeout },
});

// Refresh the login only while the app is on screen (Supabase's advice for React Native).
AppState.addEventListener('change', (state) => {
  if (state === 'active') sb.auth.startAutoRefresh();
  else sb.auth.stopAutoRefresh();
});

/** Unwrap a Supabase reply: return the data or throw a readable error. */
export async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendly(error.message));
  return data as T;
}

export function friendly(message: string): string {
  const m = String(message).replace(/^(Type)?Error: /, '');
  if (/Network request failed|Failed to fetch/i.test(m)) return 'No internet connection. Check Wi-Fi or mobile data.';
  if (/Invalid login credentials/i.test(m)) return 'Wrong Login ID or password.';
  if (/JWT expired|session/i.test(m)) return 'Please sign in again.';
  if (/dining_tables_unique_name/i.test(m)) return 'There is already a table with this name. Each table needs its own name.';
  return m;
}
