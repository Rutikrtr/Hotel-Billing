import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { q, sb } from '../supabase';
import type { Account } from '../types';

export const STAFF_DOMAIN = '@staff.login';
export const loginEmail = (v: string) => { const t = v.trim().toLowerCase(); return t.includes('@') ? t : t + STAFF_DOMAIN; };
export const loginName = (email = '') => (email.endsWith(STAFF_DOMAIN) ? email.slice(0, -STAFF_DOMAIN.length) : email);

interface AuthState {
  status: 'starting' | 'signedOut' | 'signedIn';
  email: string;
  account: Account | null;
  error: string | null;
  busy: boolean;
}

const initialState: AuthState = { status: 'starting', email: '', account: null, error: null, busy: false };

const loadAccount = () => q<Account>(sb.rpc('account_status'));

/** On app start: is someone signed in on this phone? */
export const start = createAsyncThunk('auth/start', async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  return { email: data.session.user.email ?? '', account: await loadAccount() };
});

export const signIn = createAsyncThunk('auth/signIn', async (p: { login: string; password: string }) => {
  const { data, error } = await sb.auth.signInWithPassword({ email: loginEmail(p.login), password: p.password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong Login ID or password.' : error.message);
  return { email: data.user.email ?? '', account: await loadAccount() };
});

/** Re-read access (paused hotel, role change) when the app comes back to the front. */
export const recheck = createAsyncThunk('auth/recheck', loadAccount);

export const signOut = createAsyncThunk('auth/signOut', async () => { await sb.auth.signOut(); });

const auth = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(start.fulfilled, (s, a) => {
      if (!a.payload) { s.status = 'signedOut'; return; }
      Object.assign(s, { status: 'signedIn', email: a.payload.email, account: a.payload.account, error: null });
    });
    b.addCase(start.rejected, (s, a) => {
      // Signed in but offline: keep going with what we have; the screens say so.
      s.status = 'signedOut'; s.error = a.error.message ?? null;
    });
    b.addCase(signIn.pending, (s) => { s.busy = true; s.error = null; });
    b.addCase(signIn.fulfilled, (s, a) => {
      Object.assign(s, { status: 'signedIn', email: a.payload.email, account: a.payload.account, busy: false, error: null });
    });
    b.addCase(signIn.rejected, (s, a) => { s.busy = false; s.error = a.error.message ?? 'Couldn’t sign in'; });
    b.addCase(recheck.fulfilled, (s, a) => { s.account = a.payload; });
    b.addCase(signOut.fulfilled, () => ({ ...initialState, status: 'signedOut' as const }));
  },
});

export default auth.reducer;
