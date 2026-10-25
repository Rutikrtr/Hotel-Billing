import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { q, sb } from '../supabase';
import type { Account } from '../types';
import { clearCache } from './data';

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

// The last known access is kept on the phone, so a phone that opens the app without internet stays signed in.
const ACCOUNT_KEY = 'mb-account-v1';
const loadAccount = async () => {
  const a = await q<Account>(sb.rpc('account_status'));
  AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)).catch(() => {});
  return a;
};
const savedAccount = async (): Promise<Account | null> => {
  try { const s = await AsyncStorage.getItem(ACCOUNT_KEY); return s ? JSON.parse(s) as Account : null; } catch { return null; }
};

/** The super admin console is only in the web app (1.0); the phone app is for hotels. */
export const WEB_ONLY = 'This is the Techyverve admin login. It works only in the Master Bill web app.';
const adminOnly = (a: Account) => a.super_admin && !a.staff;

/** On app start: is someone signed in on this phone? Without internet, the last known access is used. */
export const start = createAsyncThunk('auth/start', async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  let account: Account;
  try { account = await loadAccount(); }
  catch (err) {
    const saved = await savedAccount();
    if (!saved) throw err;
    account = saved;
  }
  if (adminOnly(account)) { await sb.auth.signOut(); throw new Error(WEB_ONLY); }
  return { email: data.session.user.email ?? '', account };
});

export const signIn = createAsyncThunk('auth/signIn', async (p: { login: string; password: string }) => {
  const { data, error } = await sb.auth.signInWithPassword({ email: loginEmail(p.login), password: p.password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong Login ID or password.' : error.message);
  const account = await loadAccount();
  if (adminOnly(account)) { await sb.auth.signOut(); throw new Error(WEB_ONLY); }
  return { email: data.user.email ?? '', account };
});

/** Re-read access (paused hotel, role change) when the app comes back to the front. */
export const recheck = createAsyncThunk('auth/recheck', loadAccount);

export const signOut = createAsyncThunk('auth/signOut', async () => {
  await clearCache();
  await AsyncStorage.removeItem(ACCOUNT_KEY).catch(() => {});
  await sb.auth.signOut();
});

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
      // No saved access on this phone (first start without internet) or the admin login: show the login screen.
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
