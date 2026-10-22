import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { computeBill, fmt, nightsBetween, orderBill, plain, toPaise } from './billing.js';
import {
  Slip, bluetoothRemembers, bluetoothSupported, chooseBluetooth, connectBluetooth, directPrinting, forgetBluetooth,
  feedLines, getPrinter, isApple, isConnected, paperWidth, printSlips, reconnectSaved, setPrinter,
} from './printer.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const METHODS = ['Cash', 'UPI', 'Card'];
const $view = document.getElementById('view');
let session = null;
// Cached account_status() for the current session: super admin?, staff?, role, hotel paused?, feature switches.
let accountCheck = null;
let accountAt = 0;
// Re-read at most once a minute, so feature switches or a paused hotel take effect without reopening the app.
const getAccount = () => {
  if (accountCheck && Date.now() - accountAt > 60 * 1000) accountCheck = null;
  if (!accountCheck) { accountAt = Date.now(); accountCheck = q(sb.rpc('account_status')).catch((err) => { accountCheck = null; throw err; }); }
  return accountCheck;
};
let account = null;    // the resolved value, once route() has loaded it
const isOwner = () => getAccount().then((a) => a.role === 'owner', () => false);
/** Feature switches are set per hotel by the super admin. */
const feat = (name) => account?.features?.[name] === true;
let renderToken = 0;   // guards against a slow view finishing after the person navigated away

// ---------- helpers ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } }
/** Tagged template that HTML-escapes every interpolated value unless it came from html``. */
function html(strings, ...values) {
  const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v === false || v == null ? '' : esc(v));
  return new Raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));
}
const setHTML = (el, tpl) => { el.innerHTML = tpl.s; };
/** Render a view into a fresh container so listeners from earlier renders are dropped with it. */
function mount(tpl) {
  const root = document.createElement('div');
  root.innerHTML = tpl.s;
  $view.replaceChildren(root);
  return root;
}
const rs = (p) => `₹${fmt(p)}`;
/** "T2" for a table with one group; "T2-A", "T2-B" once the table has been split into sections. */
const tableLabel = (name, section, split = false) => (section && (split || section !== 'A') ? `${name}-${section}` : name);
const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** "Parcel" for takeaway orders, otherwise the table label. */
const orderLabel = (o) => (o.is_parcel ? 'Parcel' : tableLabel(o.dining_tables?.name ?? 'Table', o.section, o.is_split));
/** The number to call out for a bill: B00046 → 46. */
const tokenNo = (billNo) => String(Number(String(billNo ?? '').replace(/\D/g, '')) || '');
const pct = (bp) => `${+(bp / 100).toFixed(2)}%`;
const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const dateTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const minutesSince = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
const since = (iso) => { const m = minutesSince(iso); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');

function toast(message, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 5000 : 2500);
}

function friendly(error) {
  const msg = error?.message || String(error);
  if (/orders_one_open_per_table_section/.test(msg)) return 'This section already has a running order. Refresh to see it.';
  if (/orders_one_open_per_table/.test(msg)) return 'Sections need one last database step. Ask your admin to finish the setup.';
  if (/menu_items_restaurant_name_key|menu_items_name_key/.test(msg)) return 'Another dish already has this exact name. Add a word to tell them apart, like “Icecream (Mango)”.';
  if (/dining_tables_restaurant_name_key|dining_tables_name_key/.test(msg)) return 'A table with that name already exists.';
  if (/orders_table_id_fkey/.test(msg)) return 'This table has bills, so it can’t be removed. Rename it instead.';
  if (/row-level security|Not authorised/.test(msg)) return 'You don’t have permission to do that.';
  if (/edit_paid_bill|delete_paid_bill/.test(msg) && /function|schema cache/i.test(msg)) return 'Editing bills needs one last database step. Ask your admin to finish the setup.';
  if (/sa_delete_hotel/.test(msg) && /function|schema cache/i.test(msg)) return 'Deleting hotels needs one last database step. Run the setup SQL in Supabase, then try again.';
  if (/stays_one_open_per_room/.test(msg)) return 'Someone is already checked in to this room. Refresh to see it.';
  if (/lodging_rooms_restaurant_number_key/.test(msg)) return 'A room with that number already exists.';
  if (/stays_room_id_fkey/.test(msg)) return 'This room has bills, so it can’t be removed. Change its number instead.';
  if (/stays_check/.test(msg)) return 'Check-out can’t be before check-in.';
  if (/Failed to fetch|NetworkError/.test(msg)) return 'No connection. Check the internet and try again.';
  return msg;
}

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

/** Run an action from a button or form, showing failures as a toast. */
async function act(button, fn) {
  if (button) button.disabled = true;
  try { await fn(); } catch (err) { toast(friendly(err), 'error'); } finally { if (button) button.disabled = false; }
}

function onSubmit(root, selector, handler) {
  root.querySelectorAll(selector).forEach((form) => form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (form.dataset.confirm && !confirm(form.dataset.confirm)) return;
    act(form.querySelector('button[type=submit], button:not([type])'), () => handler(Object.fromEntries(new FormData(form)), form));
  }));
}

// Small caches so every screen doesn't download the same settings and menu again (keeps data use low).
function cached(load, ms) {
  let value = null; let at = 0;
  const get = () => {
    if (!value || Date.now() - at > ms) { at = Date.now(); value = load().catch((err) => { value = null; throw err; }); }
    return value;
  };
  get.clear = () => { value = null; };
  return get;
}
// Each account belongs to one restaurant; row-level security returns only that one.
const getSettings = cached(() => q(sb.from('restaurants').select('*').single()), 5 * 60 * 1000);
// The menu refreshes every minute so "sold out" reaches other phones quickly.
const getMenu = cached(() => q(sb.from('menu_items').select('*').order('id')), 60 * 1000);
let lastPath = '';

// ---------- sign in ----------

const ICONS = {
  receipt: '<path d="M5 2.5h14v19l-2.33-1.6L14.33 21.5 12 19.9l-2.33 1.6-2.34-1.6L5 21.5zM8 7v1.6h8V7zm0 4v1.6h8V11zm0 4v1.6h5V15z" fill-rule="evenodd"/>',
  mail: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.4 2L12 12.2 19.6 7zM4 9.1V17h16V9.1l-8 5.4z" fill-rule="evenodd"/>',
  pause: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM9 8v8h2V8zm4 0v8h2V8z" fill-rule="evenodd"/>',
  lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z" fill-rule="evenodd"/>',
};
/** Line icons for buttons: one drawing style everywhere (emoji look different on every phone). */
const LINE_ICONS = {
  bag: '<path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="m10.5 12.5 9-9M16.5 6.5l2.5 2.5M13.5 9.5l2 2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  swap: '<path d="M7 4 3.5 7.5 7 11M3.5 7.5H17M17 13l3.5 3.5L17 20M20.5 16.5H7"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h.01M20.5 14h.01"/>',
  kitchen: '<path d="M7 17.5h10V21H7z"/><path d="M7 17.5V14a4 4 0 0 1-.8-7.6A4.5 4.5 0 0 1 12 3.5a4.5 4.5 0 0 1 5.8 2.9A4 4 0 0 1 17 14v3.5"/>',
  install: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7m0 0-3-3m3 3 3-3M10.5 18.5h3"/>',
  expand: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  share: '<path d="M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6.5"/>',
};
const ic = (name) => new Raw(`<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LINE_ICONS[name]}</svg>`);
/** Techyverve logo (same drawing as icons/techyverve.svg), coloured by the text colour. */
const LOGO = new Raw(`<svg class="tv-logo" viewBox="120 370 784 800" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"><path d="M512 470V1022"/><path d="M236 486 512 664 788 486"/><path d="M288 640 410 722Q424 732 424 750V922"/><path d="M736 640 614 722Q600 732 600 750V988L556 1036"/><circle cx="198" cy="461" r="43" stroke-width="30"/><circle cx="826" cy="461" r="43" stroke-width="30"/><circle cx="253" cy="620" r="39" stroke-width="32"/><circle cx="771" cy="620" r="39" stroke-width="32"/><circle cx="512" cy="1080" r="46" stroke-width="32"/></g><circle cx="512" cy="437" r="49" fill="currentColor"/></svg>`);
const icon = (name) => new Raw(`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[name]}</svg>`);
let recoveringPassword = false; // set when someone arrives from a password-reset email
let lastEmail = '';             // carried between sign-in screens so nobody retypes it

function authError(error) {
  const msg = error?.message || String(error);
  if (/Invalid login credentials/i.test(msg)) return 'That email and password don’t match. Check them and try again, or reset your password.';
  if (/Email not confirmed/i.test(msg)) return 'unconfirmed';
  if (/already registered|already been registered/i.test(msg)) return 'exists';
  if (/Password should be at least/i.test(msg)) return 'Use a password with at least 6 characters.';
  if (/email rate limit/i.test(msg)) return 'Too many emails were sent in the last hour, so we can’t send another one yet. Try again in an hour, or ask the owner to set up your account.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a minute, then try again.';
  if (/valid email|invalid format/i.test(msg)) return 'Enter a valid email address, like name@example.com.';
  return friendly(error);
}

/** Password field with a Show/Hide button. */
const passwordField = (label, autocomplete, hint = '') => html`
  <div class="field">
    <label for="password">${label}</label>
    <div class="password-wrap">
      <input id="password" type="password" name="password" autocomplete="${autocomplete}" minlength="6" required
        ${hint ? new Raw('aria-describedby="password-hint"') : ''}>
      <button type="button" class="reveal" aria-pressed="false" aria-label="Show password">Show</button>
    </div>
    ${hint ? html`<p class="hint" id="password-hint">${hint}</p>` : ''}
  </div>`;

function authScreen({ iconName = 'receipt', title, subtitle, body, footer = '' }) {
  document.body.classList.add('signed-out');
  const root = mount(html`
    <div class="auth">
      <div class="auth-card">
        <div class="auth-icon">${iconName === 'receipt' ? LOGO : icon(iconName)}</div>
        <h1>${title}</h1>
        <p class="auth-sub">${subtitle}</p>
        <div class="auth-alert" role="alert" hidden></div>
        ${body}
      </div>
      ${footer ? html`<p class="auth-footer">${footer}</p>` : ''}
      <p class="auth-brand">${LOGO} Powered by <strong>Techyverve</strong></p>
    </div>`);
  root.querySelectorAll('.reveal').forEach((b) => b.addEventListener('click', () => {
    const input = b.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? 'Hide' : 'Show';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }));
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const email = root.querySelector('[name=email]')?.value;
    if (email) lastEmail = email;
    authViews[b.dataset.go]();
  }));
  const alertBox = root.querySelector('.auth-alert');
  const showAlert = (message, kind = 'error') => {
    alertBox.className = `auth-alert ${kind}`;
    setHTML(alertBox, message instanceof Raw ? message : html`${message}`);
    alertBox.hidden = false;
    alertBox.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); authViews[b.dataset.go](); }));
  };
  /** Submit handler with a busy label on the button and errors shown in the card. */
  const handle = (busyLabel, fn) => root.querySelector('form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('button[type=submit]');
    const label = btn.textContent;
    alertBox.hidden = true;
    btn.disabled = true;
    btn.textContent = busyLabel;
    try {
      const values = Object.fromEntries(new FormData(form));
      if (values.email) lastEmail = values.email.trim();
      await fn(values);
    } catch (err) {
      showAlert(err instanceof Raw ? err : authError(err));
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  });
  return { root, handle, showAlert };
}

const emailField = (autofocus = true, loginId = false) => html`
  <div class="field">
    <label for="email">${loginId ? 'Email or Login ID' : 'Email'}</label>
    <input id="email" type="${loginId ? 'text' : 'email'}" name="email" autocomplete="username" ${loginId ? new Raw('autocapitalize="none" spellcheck="false"') : new Raw('inputmode="email"')} required
      value="${lastEmail}" ${autofocus ? new Raw('autofocus') : ''} placeholder="${loginId ? 'ramesh or you@hotel.com' : 'name@example.com'}">
  </div>`;
// Staff logins made by the owner are a Login ID like "ramesh"; they sign in as ramesh@staff.login.
const STAFF_DOMAIN = '@staff.login';
const loginEmail = (v) => { const t = v.trim().toLowerCase(); return t.includes('@') ? t : t + STAFF_DOMAIN; };
const ROLE_NAMES = { owner: 'Owner', manager: 'Manager', staff: 'Waiter' };
/** Easy-to-read password: no 0/O, 1/l/I. */
function newPassword(length = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(length)), (n) => chars[n % chars.length]).join('');
}
const loginName = (email) => (email?.endsWith(STAFF_DOMAIN) ? email.slice(0, -STAFF_DOMAIN.length) : email);

const authViews = {
  signIn() {
    const { handle } = authScreen({
      title: 'Welcome back',
      subtitle: 'Sign in to take orders and print bills.',
      body: html`
        <form class="auth-form" novalidate>
          ${emailField(true, true)}
          ${passwordField('Password', 'current-password')}
          <div class="auth-row"><a href="#" data-go="forgot">Forgot password?</a></div>
          <button type="submit" class="wide">Sign In</button>
        </form>
        <button type="button" class="secondary wide" data-install hidden style="margin-top:12px">${ic('install')} Install as App</button>`,
      // Accounts are only created by Techyverve (hotels) and hotel owners (staff), never from this screen.
      footer: 'No account? Ask your hotel owner for a Login ID, or contact Techyverve to register your hotel.',
    });
    handle('Signing In…', async ({ email, password }) => {
      if (!email.trim() || !password) throw new Error('Enter your email or Login ID, and your password.');
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail(email), password });
      if (!error) return;
      if (authError(error) === 'unconfirmed') throw new Error('This account isn’t active yet. Ask your hotel owner or Techyverve to check it.');
      throw error;
    });
    if (lastEmail) document.getElementById('password')?.focus();
    showInstall();
  },

  forgot() {
    const { handle } = authScreen({
      iconName: 'lock',
      title: 'Reset your password',
      subtitle: 'Owners: enter your email and we’ll send a reset link. Staff with a Login ID: ask your hotel owner to set a new password.',
      body: html`
        <form class="auth-form" novalidate>
          ${emailField()}
          <button type="submit" class="wide">Send Reset Link</button>
        </form>
        <p class="auth-switch"><a href="#" data-go="signIn">Back to sign in</a></p>`,
    });
    handle('Sending…', async ({ email }) => {
      if (!email.trim()) throw new Error('Enter your email address.');
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
      if (error) throw error;
      authViews.checkEmail();
    });
  },

  checkEmail() {
    const { root, showAlert } = authScreen({
      iconName: 'mail',
      title: 'Check your email',
      subtitle: '',
      body: html`
        <p class="auth-text">We sent a password reset link to <strong>${lastEmail || 'your email'}</strong>.
          Open it to choose a new password.</p>
        <p class="hint">Can’t find it? Check your spam folder.</p>
        <button type="button" class="wide" data-go="signIn">Back to Sign In</button>
        <button type="button" class="wide secondary" id="resend">Send Again</button>`,
    });
    root.querySelector('#resend').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const { error } = await sb.auth.resetPasswordForEmail(lastEmail, { redirectTo: location.origin + location.pathname });
      showAlert(error ? authError(error) : 'Sent. It can take a minute to arrive.', error ? 'error' : 'success');
      setTimeout(() => { if (btn.isConnected) btn.disabled = false; }, 30000);
    });
  },

  newPassword() {
    const { handle } = authScreen({
      iconName: 'lock',
      title: 'Choose a new password',
      subtitle: session?.user?.email ? `For ${session.user.email}` : '',
      body: html`
        <form class="auth-form" novalidate>
          ${passwordField('New password', 'new-password', 'At least 6 characters.')}
          <button type="submit" class="wide">Save Password</button>
        </form>`,
    });
    handle('Saving…', async ({ password }) => {
      if ((password || '').length < 6) throw new Error('Use a password with at least 6 characters.');
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      recoveringPassword = false;
      toast('Password updated');
      route();
    });
  },
};

const signInView = () => authViews.signIn();

// ---------- Payment ----------

/** Ask for the payment method and close the order. Resolves with the bill number, or null if cancelled. */
function receivePayment({ orderId, tableName, total }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    setHTML(dialog, html`
      <form class="dialog-body" id="pay-form">
        <h2 style="margin:0">Receive Payment · ${tableName}</h2>
        <div class="auth-alert error" role="alert" hidden></div>
        <div class="due"><span class="muted">Amount to collect</span><span class="money">${rs(total)}</span></div>
        <fieldset class="segmented" style="border:0;margin:0" aria-label="Payment method">
          ${METHODS.map((m, i) => html`<label><input type="radio" name="method" value="${m}" ${i === 0 ? new Raw('checked') : ''}><span>${m}</span></label>`)}
        </fieldset>
        <button type="submit" class="wide">Mark as Paid</button>
        <button type="button" class="secondary wide" data-cancel>Cancel</button>
      </form>`);
    const finish = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter ?? e.target.querySelector('button[type=submit]');
      const method = new FormData(e.target).get('method');
      btn.disabled = true; btn.textContent = 'Saving…';
      const { data, error } = await sb.rpc('settle_order', { p_order_id: orderId, p_method: method });
      if (error) {
        btn.disabled = false; btn.textContent = 'Mark as Paid';
        const box = dialog.querySelector('[role=alert]');
        box.textContent = friendly(error); box.hidden = false;
        return;
      }
      finish(data);
      toast(`${tableName} paid · ${method} · ${rs(total)}`);
    });
    dialog.showModal();
  });
}

// ---------- Tables ----------

let tableFilter = 'all'; // remembered while the app is open

async function tablesView(token) {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const [tables, open, settings, paidToday] = await Promise.all([
    q(sb.from('dining_tables').select('*').order('sort').order('name')),
    q(sb.from('orders').select('*, order_items(quantity, unit_price, name)').eq('status', 'open')),
    getSettings(),
    // Only the total is needed here, so the database adds it up instead of sending every bill.
    account.can_bill ? q(sb.rpc('sales_total', { p_from: dayStart.toISOString() })) : 0,
  ]);
  if (token !== renderToken) return;
  const byTable = {};
  open.filter((o) => !o.is_parcel).forEach((o) => { (byTable[o.table_id] ??= []).push(o); });
  const parcels = open.filter((o) => o.is_parcel && o.order_items.length).sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  const canBill = account.can_bill === true;
  const sales = Number(paidToday) || 0;
  const runningTables = tables.filter((t) => byTable[t.id]?.length).length;
  const waiting = open.filter((o) => o.billed_at).length;
  const onTables = open.reduce((sum, o) => sum + orderBill(o, o.order_items, settings.tax_rate_bp).total, 0);
  const counts = { all: tables.length, running: runningTables, free: tables.length - runningTables };
  const visible = tables.filter((t) => tableFilter === 'all' || (tableFilter === 'running') === Boolean(byTable[t.id]?.length));
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const root = mount(html`
    <div class="page-head"><div><p class="eyebrow">${today}</p><h1>Tables</h1>
      ${account.role === 'owner' ? '' : html`<p class="muted">${loginName(session.user.email)} · ${account.role === 'manager' ? 'Manager' : 'Waiter'}</p>`}</div>
      <div class="head-actions">
        ${canBill ? html`<a class="button" href="#/parcel" id="new-parcel">${ic('bag')} New Parcel</a>` : ''}
        ${canBill || settings.kot_tables ? html`<button type="button" class="secondary" id="printer-head" aria-label="Printer setup">${ic('printer')}${directPrinting() ? '' : html` <span>Setup</span>`}</button>` : ''}
        <button type="button" class="secondary" data-install hidden>${ic('install')} Install App</button>
      </div>
    </div>
    ${parcels.length ? html`
      <h3 style="margin-top:0">Parcels · ${parcels.length}</h3>
      <div class="list" style="margin-bottom:20px">${parcels.map((o) => html`
        <a class="list-row" href="${o.billed_at ? `#/bill/${o.id}` : `#/parcel/${o.id}`}">
          <span class="method-badge m-wait" aria-hidden="true">🛍️</span>
          <span class="grow"><strong>Parcel${o.bill_no ? ` #${tokenNo(o.bill_no)}` : ''}</strong>
            <div class="sub">${o.billed_at ? `Bill printed ${time(o.billed_at)} · not paid yet` : `${orderBill(o, o.order_items, 0).itemCount} items · ${since(o.opened_at)}`}</div></span>
          <span class="money">${rs(orderBill(o, o.order_items, settings.tax_rate_bp).total)}</span><span class="chevron" aria-hidden="true">›</span>
        </a>`)}</div>` : ''}
    <section class="hero" aria-label="Today" ${canBill ? '' : new Raw('hidden')}>
      <span class="label">Today’s sales</span>
      <span class="big">${rs(sales)}</span>
      <div class="facts">
        <div class="fact"><strong>${runningTables}</strong><span>Running</span></div>
        <div class="fact"><strong>${waiting}</strong><span>To pay</span></div>
        <div class="fact"><strong>${rs(onTables).replace('.00', '')}</strong><span>On tables</span></div>
      </div>
    </section>
    ${tables.length ? html`
      <div class="filter-tabs" role="toolbar" aria-label="Show tables">
        ${[['all', 'All'], ['running', 'Running'], ['free', 'Free']].map(([k, label]) =>
          html`<button type="button" class="chip" data-filter="${k}" aria-pressed="${tableFilter === k}">${label} <span class="count-badge">${counts[k]}</span></button>`)}
      </div>` : html`<div class="card empty"><span class="emoji" aria-hidden="true">🍽️</span>No tables yet. <a href="#/settings">Add tables in Settings</a>.</div>`}
    <div class="tables">
      ${visible.map((t) => {
        const orders = (byTable[t.id] ?? []).sort((a, b) => a.section.localeCompare(b.section));
        if (!orders.length) return html`<a class="table-tile free" href="#/table/${t.id}" aria-label="${t.name}, free">
          <span class="tile-top"><span class="name">${t.name}</span><span class="pill">Free</span></span>
          <span class="tap">Tap to order</span></a>`;
        const bills = orders.map((o) => orderBill(o, o.order_items, settings.tax_rate_bp));
        const total = bills.reduce((sum, b) => sum + b.total, 0);
        const billed = orders.every((o) => o.billed_at);
        const label = billed ? 'Billed' : 'Eating';
        const o = orders[0];
        const items = bills.reduce((n, b) => n + b.itemCount, 0);
        const detail = orders.length > 1
          ? orders.map((x, i) => `${x.section} ${rs(bills[i].total).replace('.00', '')}`).join(' · ')
          : billed ? `Waiting · ${since(o.billed_at)}` : `${items} item${items === 1 ? '' : 's'} · ${since(o.opened_at)}`;
        return html`<a class="table-tile ${billed ? 'billed' : 'busy'}" href="#/table/${t.id}" aria-label="${t.name}, ${orders.length > 1 ? `${orders.length} sections, ` : ''}${label}, ${rs(total)}">
          <span class="tile-top"><span class="name">${t.name}</span><span class="pill">${orders.length > 1 ? `${orders.length} groups` : label}</span></span>
          <span><span class="amount">${rs(total)}</span><span class="state">${detail}</span></span></a>`;
      })}
    </div>
    ${tables.length && !visible.length ? html`<div class="card empty">${tableFilter === 'free' ? 'Every table is busy right now.' : 'No tables are running right now.'}</div>` : ''}`);
  root.querySelector('#printer-head')?.addEventListener('click', printerDialog);
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f) return;
    tableFilter = f.dataset.filter;
    tablesView(renderToken);
  });
}

// ---------- Order for a table ----------

/** A parcel (takeaway) order uses the same screen as a table, without a table. */
const parcelView = (token, orderId = 'new') => tableView(token, null, null, orderId);

async function tableView(token, tableId, sectionArg, parcelId) {
  const parcel = parcelId !== undefined;
  const openQuery = () => (parcel
    ? sb.from('orders').select('*, order_items(*)').eq('id', parcelId === 'new' ? 0 : parcelId).eq('status', 'open')
    : sb.from('orders').select('*, order_items(*)').eq('table_id', tableId).eq('status', 'open').order('section'));
  const [table, menu, settings, open, sales] = await Promise.all([
    parcel ? { id: null, name: 'Parcel' } : q(sb.from('dining_tables').select('*').eq('id', tableId).single()),
    getMenu(),
    getSettings(),
    q(openQuery().order('id', { referencedTable: 'order_items' })),
    // Best sellers are a convenience: if they can't load, the menu still works.
    sb.rpc('popular_menu_items', { p_days: 30, p_limit: 12 }).then((r) => r.data ?? [], () => []),
  ]);
  if (token !== renderToken) return;

  // Popular tab: starred dishes first, then the month's best sellers.
  const soldById = new Map(sales.map((r) => [r.menu_item_id, Number(r.sold)]));
  const favourites = menu.filter((m) => m.is_favorite);
  const bestSellers = sales.map((r) => menu.find((m) => m.id === r.menu_item_id)).filter((m) => m && !m.is_favorite);
  const POPULAR = '★ Popular';
  const hasPopular = favourites.length + bestSellers.length > 0;
  // Sections: different groups sharing one table each get their own order and bill.
  const section = sectionArg || open[0]?.section || 'A';
  const sections = [...new Set([...open.map((o) => o.section), section])].sort();
  const multi = sections.length > 1;
  const current = open.find((o) => o.section === section) ?? null;
  const totals = Object.fromEntries(open.map((o) => [o.section, orderBill(o, o.order_items, settings.tax_rate_bp).total]));
  const label = parcel ? (current?.bill_no ? `Parcel #${tokenNo(current.bill_no)}` : 'Parcel') : tableLabel(table.name, section, multi || Boolean(current?.is_split));
  const canBill = account.can_bill === true;
  // Kitchen tickets (KOT): each "Send to Kitchen" prints only what changed since the last ticket.
  const kotOn = !parcel && settings.kot_tables === true;
  // cancelled: dishes the kitchen was told about and then removed from the order (until the next ticket).
  const state = { order: current, items: current ? current.order_items : [], cancelled: [], filter: hasPopular ? POPULAR : 'All', search: '' };
  const categories = [...(hasPopular ? [POPULAR] : []), 'All', ...new Set(menu.map((m) => m.category))];
  let queue = Promise.resolve();

  const countIn = (c) => (c === POPULAR ? favourites.length + bestSellers.length : c === 'All' ? menu.length : menu.filter((m) => m.category === c).length);
  setHTML($view, html`
    <div class="order-page">
      <div class="order-top">
        <a class="back" href="#/" aria-label="Back to all tables">‹</a>
        <div class="titles"><h1>${parcel ? html`🛍️ ${label}` : table.name}</h1><p id="order-sub"></p></div>
        <button type="button" class="secondary add-section" id="add-section" ${current?.order_items.length && !parcel ? '' : new Raw('hidden')}
          title="Two different groups at this table? Give each its own bill.">+ Section</button>
      </div>
      ${multi ? html`
        <nav class="sections" aria-label="Sections of ${table.name}">
          ${sections.map((x) => html`<a class="section-tab" href="#/table/${table.id}/${x}" ${x === section ? new Raw('aria-current="page"') : ''}>
            <span class="section-name">Section ${x}</span>
            <span class="section-total">${totals[x] != null ? rs(totals[x]) : 'New'}</span></a>`)}
        </nav>` : ''}
      <div class="order-layout">
        <section aria-label="Menu">
          <div class="menu-tools">
            <div class="search"><input type="search" id="search" placeholder="Search dishes" aria-label="Search dishes" autocomplete="off"></div>
            <div class="chips" role="toolbar" aria-label="Categories">
              ${categories.map((c) => html`<button class="chip" type="button" data-cat="${c}" aria-pressed="${c === state.filter}">${c} <span class="count-badge">${countIn(c)}</span></button>`)}
            </div>
          </div>
          <div class="menu-list" id="menu-grid"></div>
        </section>
        <aside class="order-panel" id="order-panel" aria-label="Order"></aside>
      </div>
      <div class="sheet-backdrop" id="sheet-backdrop"></div>
      <div class="cart-bar" id="order-bar"></div>
    </div>`);

  const $grid = document.getElementById('menu-grid');
  const $panel = document.getElementById('order-panel');
  const $bar = document.getElementById('order-bar');
  const $sub = document.getElementById('order-sub');
  const qtyOf = (menuId) => state.items.find((i) => i.menu_item_id === menuId)?.quantity ?? 0;
  const bill = () => orderBill(state.order, state.items, settings.tax_rate_bp);
  const sentQty = (i) => i.kot_qty ?? 0;
  /** What the kitchen hasn't been told yet: positive = new dishes, negative = cancelled. */
  const kotChanges = () => [
    ...state.items.filter((i) => i.quantity !== sentQty(i)).map((i) => ({ name: i.name, quantity: i.quantity - sentQty(i) })),
    ...state.cancelled.map((c) => ({ name: c.name, quantity: -c.quantity })),
  ];
  const kotTag = (i) => (i.quantity > sentQty(i) ? html` · <span class="kot-new">+${i.quantity - sentQty(i)} new</span>`
    : i.quantity < sentQty(i) ? html` · <span class="kot-new">−${sentQty(i) - i.quantity} cancel</span>`
    : sentQty(i) ? html` · <span class="kot-sent">✓ sent</span>` : '');

  const dish = (m, showSold) => {
    const n = qtyOf(m.id);
    const sold = soldById.get(m.id);
    const control = !m.available
      ? html`<span class="meta">Sold out</span>`
      : n
        ? html`<span class="qty" role="group" aria-label="${m.name}, ${n} in order">
            <button type="button" data-minus="${m.id}" aria-label="Remove one ${m.name}">−</button>
            <output>${n}</output>
            <button type="button" data-add="${m.id}" aria-label="Add one more ${m.name}">+</button></span>`
        : html`<button type="button" class="add-btn" data-add="${m.id}" aria-label="Add ${m.name}, ${rs(m.price)}">ADD</button>`;
    return html`<div class="dish ${n ? 'in-order' : ''} ${m.available ? '' : 'sold-out'}">
      <div class="info">
        <span class="line1"><span class="diet ${m.is_veg ? 'veg' : 'nonveg'}" title="${m.is_veg ? 'Veg' : 'Non-veg'}"></span><span class="dname">${m.name}</span>${m.is_favorite ? html`<span class="star" title="Favourite">★</span>` : ''}</span>
        <span><span class="price">${rs(m.price).replace('.00', '')}</span>${showSold && sold ? html`<span class="meta"> · ${sold} sold this month</span>` : ''}</span>
      </div>
      ${control}
    </div>`;
  };
  const groupHead = (title, note) => html`<h3 class="list-head">${title}${note ? html` <span class="note">${note}</span>` : ''}</h3>`;

  function renderMenu() {
    const term = state.search.trim().toLowerCase();
    if (!menu.length) return setHTML($grid, html`<div class="card empty" style="grid-column: 1 / -1"><span class="emoji" aria-hidden="true">📋</span>Your menu is empty. <a href="#/menu">Add dishes</a> to start taking orders.</div>`);
    // Searching looks through the whole menu, whichever tab is selected.
    if (term) {
      const found = menu.filter((m) => m.name.toLowerCase().includes(term));
      return setHTML($grid, found.length ? html`${found.map((m) => dish(m, false))}`
        : html`<p class="muted" style="grid-column: 1 / -1">No dishes match “${state.search}”.</p>`);
    }
    if (state.filter === POPULAR) {
      return setHTML($grid, html`
        ${favourites.length ? [groupHead('★ Favourites'), favourites.map((m) => dish(m, true))] : ''}
        ${bestSellers.length ? [groupHead('Best sellers', 'last 30 days'), bestSellers.map((m) => dish(m, true))] : ''}`);
    }
    const shown = menu.filter((m) => state.filter === 'All' || m.category === state.filter);
    setHTML($grid, html`${shown.map((m) => dish(m, false))}`);
  }

  function renderOrder() {
    const b = bill();
    const toKitchen = kotOn ? kotChanges().reduce((n, c) => n + Math.abs(c.quantity), 0) : 0;
    const billed = Boolean(state.order?.billed_at);
    document.getElementById('add-section').hidden = !state.items.length || parcel;
    const tabTotal = document.querySelector('.section-tab[aria-current="page"] .section-total');
    if (tabTotal) tabTotal.textContent = state.items.length ? rs(b.total) : 'New';
    $sub.textContent = !state.order ? (parcel ? 'Takeaway · add the dishes' : multi ? `Section ${section} · take this group’s order` : 'Free · take the order')
      : billed ? `Bill ${state.order.bill_no} printed at ${time(state.order.billed_at)} · waiting to pay`
      : `Eating since ${time(state.order.opened_at)}`;
    setHTML($panel, html`
      <div class="grabber" aria-hidden="true"></div>
      <div class="order-head">
        <span><span class="title">${multi ? `Section ${section}` : 'Your order'}</span>
          <span class="sub">${label}${state.items.length ? ` · ${b.itemCount} item${b.itemCount === 1 ? '' : 's'}` : ''}</span></span>
        <span>
          ${state.items.length && !state.order?.bill_no ? html`<button type="button" class="destructive" id="clear">Clear</button>` : ''}
          <button type="button" class="plain sheet-close" id="close-sheet" aria-label="Close order">Done</button>
        </span>
      </div>
      ${state.items.length ? html`
        <ul class="order-lines">
          ${state.items.map((i) => html`
            <li class="order-line">
              <span class="name">${i.name}</span>
              <span class="line-total">${rs(i.unit_price * i.quantity)}</span>
              <span class="each">${rs(i.unit_price)} each${kotOn ? kotTag(i) : ''}</span>
              <span class="qty" role="group" aria-label="Quantity of ${i.name}">
                <button type="button" data-dec="${i.id}" aria-label="Remove one ${i.name}">−</button>
                <output>${i.quantity}</output>
                <button type="button" data-inc="${i.id}" aria-label="Add one ${i.name}">+</button>
              </span>
            </li>`)}
        </ul>
        <div class="totals">
          <div><span class="muted">Subtotal</span><span class="money">${fmt(b.subtotal)}</span></div>
          ${canBill ? html`<div class="discount-row"><label for="discount" class="muted" style="display:flex">Discount (₹)</label>
            <input id="discount" inputmode="decimal" value="${state.order?.discount ? plain(state.order.discount) : ''}" placeholder="0"></div>` : ''}
          ${b.tax ? html`
            <div><span class="muted">CGST ${pct(settings.tax_rate_bp / 2)}</span><span class="money">${fmt(b.cgst)}</span></div>
            <div><span class="muted">SGST ${pct(settings.tax_rate_bp / 2)}</span><span class="money">${fmt(b.sgst)}</span></div>` : ''}
          ${b.roundOff ? html`<div><span class="muted">Round off</span><span class="money">${fmt(b.roundOff)}</span></div>` : ''}
          <div class="grand"><span>Total</span><span class="money">${rs(b.total)}</span></div>
        </div>
        ${billed ? html`<p class="order-note">Bill printed. Added or removed items? Print it again so the customer gets the right total.</p>` : ''}
        ${kotOn && state.cancelled.length ? html`<p class="order-note">Kitchen will be told to cancel: ${state.cancelled.map((c) => `${c.quantity} × ${c.name}`).join(', ')}</p>` : ''}
        ${kotOn ? (toKitchen
          ? html`<button type="button" class="kot-send" id="send-kot">${ic('kitchen')} Send to Kitchen · ${toKitchen} item${toKitchen === 1 ? '' : 's'}</button>`
          : html`<p class="order-note">✓ Kitchen has the full order.</p>`) : ''}
        ${parcel && canBill ? html`<p class="order-note">Print Bill prints two slips: the customer’s bill and a kitchen copy, both with the bill number to call out.</p>` : ''}
        <div class="order-actions">
          ${!canBill
            ? html`<button type="button" id="save-order" class="wide-action">Save Order</button>`
            : billed
            ? html`<button type="button" class="secondary" id="print-bill">Reprint Bill</button>
                   <button type="button" id="pay">Receive Payment</button>`
            : html`<button type="button" class="secondary" id="print-bill">Print Bill</button>
                   <button type="button" id="save-order">Save Order</button>`}
        </div>
        ${canBill ? '' : html`<p class="order-note">The manager prints the bill and takes payment.</p>`}`
      : html`<div class="empty"><span class="emoji" aria-hidden="true">🍛</span>No dishes yet.<br>Tap <strong>ADD</strong> on a dish to start the order.</div>`}`);
    setHTML($bar, state.items.length
      ? html`<span><span class="count">${b.itemCount} item${b.itemCount === 1 ? '' : 's'} · ${label}</span><span class="money">${rs(b.total)}</span></span>
          <button type="button" id="view-order">View Order ›</button>`
      : html``);
    $bar.hidden = !state.items.length;
    if (!state.items.length) document.body.classList.remove('sheet-open');
  }

  const render = () => { renderMenu(); renderOrder(); };

  /** Queue server writes so rapid taps apply in order. Each write sends the latest local quantity. */
  function enqueue(fn) {
    queue = queue.then(fn).catch(async (err) => {
      toast(friendly(err), 'error');
      const fresh = await q((parcel
        ? sb.from('orders').select('*, order_items(*)').eq('id', state.order?.id ?? 0).eq('status', 'open')
        : sb.from('orders').select('*, order_items(*)').eq('table_id', tableId).eq('section', section).eq('status', 'open')).order('id', { referencedTable: 'order_items' }).maybeSingle()).catch(() => null);
      state.order = fresh; state.items = fresh ? fresh.order_items : [];
      render();
    });
    return queue;
  }

  async function ensureOrder() {
    if (state.order) return state.order;
    state.order = await q(sb.from('orders').insert(parcel ? { is_parcel: true } : { table_id: table.id, section }).select().single());
    // Keep the parcel's own address so a refresh comes back to it.
    if (parcel) history.replaceState(null, '', `#/parcel/${state.order.id}`);
    return state.order;
  }

  function changeQty(item, delta) {
    item.quantity += delta;
    if (item.quantity <= 0) {
      state.items = state.items.filter((i) => i !== item);
      if (kotOn && sentQty(item)) state.cancelled.push({ menu_item_id: item.menu_item_id, name: item.name, quantity: sentQty(item) });
    }
    render();
    enqueue(async () => {
      const order = await ensureOrder();
      if (item.quantity <= 0) {
        if (item.id > 0) await q(sb.from('order_items').delete().eq('id', item.id));
      } else if (item.id > 0) {
        await q(sb.from('order_items').update({ quantity: item.quantity }).eq('id', item.id));
      } else {
        const row = await q(sb.from('order_items').insert({
          order_id: order.id, menu_item_id: item.menu_item_id, name: item.name, unit_price: item.unit_price, quantity: item.quantity, kot_qty: sentQty(item),
        }).select().single());
        item.id = row.id;
        if (item.quantity !== row.quantity) await q(sb.from('order_items').update({ quantity: item.quantity }).eq('id', item.id));
      }
    });
  }

  let tempId = 0;
  const tick = () => { try { navigator.vibrate?.(8); } catch { /* not supported */ } };
  $grid.addEventListener('click', (e) => {
    const minus = e.target.closest('[data-minus]');
    if (minus) {
      const item = state.items.find((i) => i.menu_item_id === Number(minus.dataset.minus));
      if (item) { tick(); changeQty(item, -1); }
      return;
    }
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const m = menu.find((x) => x.id === Number(btn.dataset.add));
    let item = state.items.find((i) => i.menu_item_id === m.id);
    if (!item) {
      const was = state.cancelled.find((c) => c.menu_item_id === m.id);
      state.cancelled = state.cancelled.filter((c) => c !== was);
      item = { id: --tempId, menu_item_id: m.id, name: m.name, unit_price: m.price, quantity: 0, kot_qty: was?.quantity ?? 0 };
      state.items.push(item);
    }
    tick();
    changeQty(item, 1);
  });
  document.getElementById('sheet-backdrop').addEventListener('click', () => document.body.classList.remove('sheet-open'));

  $panel.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    const find = (id) => state.items.find((i) => i.id === Number(id));
    if (t.dataset.inc) changeQty(find(t.dataset.inc), 1);
    else if (t.dataset.dec) changeQty(find(t.dataset.dec), -1);
    else if (t.id === 'close-sheet') document.body.classList.remove('sheet-open');
    else if (t.id === 'save-order') {
      act(t, async () => {
        await queue;
        document.body.classList.remove('sheet-open');
        toast(`${label} order saved`);
        location.hash = '#/';
      });
    } else if (t.id === 'send-kot') {
      const p = getPrinter();
      if (p.method === 'bluetooth') connectBluetooth(p.kitchen.separate ? 'kitchen' : 'bill', true).catch(() => {});
      act(t, async () => {
        await queue;
        const changes = kotChanges();
        if (!changes.length) return;
        const sent = state.items.filter((i) => i.quantity !== sentQty(i)).map((i) => ({ item: i, qty: i.quantity }));
        const ticket = { label, changes, addOn: state.items.some((i) => sentQty(i) > 0) || state.cancelled.length > 0,
          by: loginName(session.user.email), at: new Date().toISOString() };
        if (directPrinting()) {
          const failed = await printSlips([kotSlip(ticket)], { pick: true });
          if (failed.length) throw failed[0].error;
        } else printTicket(ticket);
        sent.forEach(({ item, qty }) => { item.kot_qty = qty; });
        state.cancelled = [];
        renderOrder();
        enqueue(() => Promise.all(sent.map(({ item, qty }) => q(sb.from('order_items').update({ kot_qty: qty }).eq('id', item.id)))));
        toast(`Sent to kitchen · ${label}`);
      });
    } else if (t.id === 'print-bill') {
      if (kotOn && kotChanges().length && !confirm('Some dishes haven’t been sent to the kitchen yet. Print the bill anyway?')) return;
      warmPrinter();
      act(t, async () => {
        await queue;
        document.body.classList.remove('sheet-open');
        if (directPrinting()) {
          // Straight to the Bluetooth / RawBT printer: no popup, no bill screen.
          const done = settings.quick_close !== false;
          const billNo = await q(sb.rpc(done ? 'settle_order' : 'generate_bill', done ? { p_order_id: state.order.id, p_method: 'Cash' } : { p_order_id: state.order.id }));
          let result;
          try {
            result = await printOrderDirect(state.order.id);
          } catch (err) {
            toast(`Bill ${billNo} saved, but printing failed: ${friendly(err)}`, 'error');
            location.hash = `#/bill/${state.order.id}`;
            return;
          }
          // No kitchen printer: the bill screen offers "Print Kitchen Copy" for the parcel.
          location.hash = done && !result.kitchenPending ? '#/' : `#/bill/${state.order.id}`;
          return;
        }
        if (settings.quick_close !== false) {
          // No separate payment step: the bill is created and the table is freed at once.
          const billNo = await q(sb.rpc('settle_order', { p_order_id: state.order.id, p_method: 'Cash' }));
          toast(parcel ? `Parcel #${tokenNo(billNo)} · printing bill and kitchen copy` : `Bill ${billNo} done · ${label} is free`);
          // Parcels always print: the customer keeps one slip, the kitchen gets the other.
          location.hash = parcel ? `#/bill/${state.order.id}/print` : `#/bill/${state.order.id}`;
          return;
        }
        await q(sb.rpc('generate_bill', { p_order_id: state.order.id }));
        location.hash = `#/bill/${state.order.id}/print`;
      });
    } else if (t.id === 'pay') {
      act(t, async () => {
        await queue;
        const paid = await receivePayment({ orderId: state.order.id, tableName: label, total: bill().total });
        if (paid) { document.body.classList.remove('sheet-open'); location.hash = '#/'; }
      });
    }
    else if (t.id === 'clear') {
      if (!confirm(`Clear all items from ${parcel ? 'this parcel' : multi ? `Section ${section} of ${table.name}` : table.name}? This can’t be undone.`)) return;
      enqueue(async () => {
        await q(sb.from('orders').delete().eq('id', state.order.id));
        state.order = null; state.items = [];
        toast(`${label} cleared`);
        if (parcel) location.hash = '#/';
        else if (multi) location.hash = `#/table/${table.id}`;
        else render();
      });
    }
  });

  $panel.addEventListener('change', (e) => {
    if (e.target.id !== 'discount') return;
    let paise;
    try { paise = toPaise(e.target.value); } catch (err) { toast(err.message, 'error'); return; }
    enqueue(async () => {
      const order = await ensureOrder();
      order.discount = paise;
      renderOrder();
      await q(sb.from('orders').update({ discount: paise }).eq('id', order.id));
    });
  });

  $bar.addEventListener('click', (e) => { if (e.target.closest('#view-order')) document.body.classList.add('sheet-open'); });
  document.getElementById('add-section').addEventListener('click', () => {
    const next = [...SECTION_LETTERS].find((x) => !sections.includes(x));
    if (!next) return toast('This table already has the most sections it can.', 'error');
    queue.then(() => {
      toast(`Section ${next} added · take the second group’s order`);
      location.hash = `#/table/${table.id}/${next}`;
    });
  });
  document.getElementById('search').addEventListener('input', (e) => { state.search = e.target.value; renderMenu(); });
  $view.querySelector('.chips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (!c) return;
    state.filter = c.dataset.cat;
    $view.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    renderMenu();
  });

  render();
}

// ---------- Direct printing (Bluetooth / RawBT) ----------

/** Shop name, address and phone at the top of a slip. */
function slipHeader(slip, settings, rate) {
  // Compact: tall (not wide) name, one line for address and phone, so bills use less paper.
  slip.align('center').bold(true).size(1, 2).wrap(settings.hotel_name).size(1, 1).bold(false);
  const phone = settings.hotel_phone ? `Ph ${settings.hotel_phone}` : '';
  const both = [settings.hotel_address, phone].filter(Boolean).join(', ');
  if (both.length <= slip.width) { if (both) slip.line(both); } else { slip.wrap(settings.hotel_address); if (phone) slip.line(phone); }
  if (settings.hotel_gstin && rate > 0) slip.line(`GSTIN ${settings.hotel_gstin}`);
  return slip.align('left').rule();
}
const shortStamp = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' });

/** One line per item ("2 Puneri Misal      180.00"), then the totals. Shared by food and room bills. */
function slipBody(slip, lines, b, rate) {
  const amtW = 9;
  const nameW = slip.width - amtW;
  for (const l of lines) {
    const left = `${l.quantity} ${l.name}`;
    if (left.length <= nameW - 1) slip.cols(left, fmt(l.quantity * l.unitPrice));
    else { slip.wrap(left); slip.cols('', fmt(l.quantity * l.unitPrice)); }
  }
  slip.rule();
  if (b.discount || b.tax || b.roundOff) {
    slip.cols(`Subtotal (${b.itemCount})`, fmt(b.subtotal));
    if (b.discount) slip.cols('Discount', `-${fmt(b.discount)}`);
    if (b.tax) slip.cols(`CGST ${pct(rate / 2)}`, fmt(b.cgst)).cols(`SGST ${pct(rate / 2)}`, fmt(b.sgst));
    if (b.roundOff) slip.cols('Round off', fmt(b.roundOff));
  }
  return slip.bold(true).size(1, 2).cols(`TOTAL (${b.itemCount})`, `Rs.${fmt(b.total)}`).size(1, 1).bold(false);
}

function kitchenSlip(order) {
  const kot = new Slip(paperWidth(), 'kitchen');
  kot.align('center').bold(true).size(2, 2).line(`PARCEL #${tokenNo(order.bill_no)}`).size(1, 1).bold(false)
    .line(`Kitchen copy  ${time(order.billed_at ?? order.closed_at ?? new Date().toISOString())}`).align('left').rule();
  for (const i of order.order_items) kot.bold(true).size(1, 2).wrap(`${i.quantity} x ${i.name}`).size(1, 1).bold(false);
  return kot.cut();
}

const ticketLabel = (label) => (/^table/i.test(label) ? label : `Table ${label}`);

/** Kitchen ticket for a table: the table in big letters, then only the dishes added (or cancelled) since the last ticket. */
function kotSlip(t) {
  const s = new Slip(paperWidth(), 'kitchen');
  s.align('center').bold(true).size(2, 2).wrap(ticketLabel(t.label).toUpperCase(), Math.floor(s.width / 2)).size(1, 1)
    .line(t.addOn ? 'KOT - ADD-ON' : 'KOT').bold(false)
    .line(`${time(t.at)}${t.by ? `  ${t.by}` : ''}`).align('left').rule();
  for (const c of t.changes) {
    s.bold(true).size(1, 2).wrap(c.quantity > 0 ? `${c.quantity} x ${c.name}` : `CANCEL ${-c.quantity} x ${c.name}`).size(1, 1).bold(false);
  }
  return s.cut();
}

/** Kitchen ticket through the phone's print dialog (no direct printer set up). */
function printTicket(t) {
  document.querySelector('.kot-ticket')?.remove();
  const el = document.createElement('article');
  el.className = 'receipt kot-ticket';
  setHTML(el, html`
    <div class="center"><div class="shop">${ticketLabel(t.label)}</div><div>${t.addOn ? 'KOT · ADD-ON' : 'KOT'} · ${time(t.at)}${t.by ? ` · ${t.by}` : ''}</div></div>
    <div class="rule"></div>
    <table><tbody>${t.changes.map((c) => html`<tr><td class="kot-item">${c.quantity > 0 ? c.name : `CANCEL ${c.name}`}</td><td class="r kot-item">${Math.abs(c.quantity)}</td></tr>`)}</tbody></table>`);
  document.body.append(el);
  document.body.classList.add('print-ticket');
  window.print();
  setTimeout(() => { document.body.classList.remove('print-ticket'); el.remove(); }, 1000);
}

/** The customer's bill. A parcel's bill shows its number big so it can be called out. */
function billSlip(order, settings) {
  const rate = order.status === 'paid' ? order.tax_rate_bp ?? 0 : settings.tax_rate_bp;
  const b = orderBill(order, order.order_items, rate);
  const bill = slipHeader(new Slip(paperWidth()), settings, rate);
  if (order.is_parcel && order.bill_no) bill.align('center').bold(true).size(2, 2).line(`PARCEL #${tokenNo(order.bill_no)}`).size(1, 1).bold(false).align('left');
  bill.bold(true).cols(order.bill_no ?? 'Bill', order.is_parcel ? 'Parcel' : ticketLabel(orderLabel(order))).bold(false);
  bill.cols(shortStamp(order.closed_at ?? order.billed_at ?? new Date().toISOString()), order.status === 'paid' ? order.payment_method ?? '' : '').rule();
  return slipBody(bill, b.lines, b, rate).align('center').line('Thank you! Visit again.').cut();
}

/** Slips for an order. which: 'auto' = the bill, plus the kitchen copy only when a kitchen printer is set; 'kitchen' = kitchen copy only. */
function orderSlips(order, settings, which = 'auto') {
  const kitchen = order.is_parcel && order.bill_no;
  if (which === 'kitchen') return kitchen ? [kitchenSlip(order)] : [];
  const p = getPrinter();
  const autoKitchen = kitchen && p.method === 'bluetooth' && p.kitchen.separate;
  return autoKitchen ? [billSlip(order, settings), kitchenSlip(order)] : [billSlip(order, settings)];
}

function staySlips(stay, settings) {
  const rate = stay.status === 'paid' ? stay.tax_rate_bp ?? 0 : settings.tax_rate_bp;
  const b = stayBill(stay, rate);
  const slip = slipHeader(new Slip(paperWidth()), settings, rate);
  slip.cols(`${stay.bill_no ?? 'Room bill'} Room ${stay.lodging_rooms.number}`, stay.status === 'paid' ? stay.payment_method : '')
    .cols(stay.guest_name, stay.guest_phone || '')
    .cols(`${shortDate(stay.check_in)} - ${shortDate(stay.check_out)}`, `${b.nights} night${b.nights === 1 ? '' : 's'}`).rule();
  return [slipBody(slip, b.lines, b, rate).align('center').line('Thank you for staying with us!').cut()];
}

/** Print an order straight to the printer. which: 'auto' or 'kitchen'. Call from a tap so Bluetooth can ask if needed. */
async function printOrderDirect(orderId, which = 'auto') {
  const [order, settings] = await Promise.all([
    q(sb.from('orders').select('*, dining_tables(name), order_items(*)').eq('id', orderId).order('id', { referencedTable: 'order_items' }).single()),
    getSettings(),
  ]);
  const slips = orderSlips(order, settings, which);
  const failed = await printSlips(slips, { pick: true });
  if (failed.length) {
    const what = failed.map((f) => (f.slot === 'kitchen' ? 'kitchen copy' : 'bill')).join(' and ');
    toast(`Couldn’t print the ${what}: ${friendly(failed[0].error)} Tap Print on the bill to try again.`, 'error');
  } else if (which === 'kitchen') toast(`Kitchen copy printed · #${tokenNo(order.bill_no)}`);
  else toast(slips.length > 1 ? `Printed bill and kitchen copy · #${tokenNo(order.bill_no)}` : `Printed bill ${order.bill_no ?? ''}`);
  return { order, kitchenPending: which === 'auto' && order.is_parcel && slips.length === 1 };
}

/** Phone print dialog for just the bill or just the kitchen copy. */
function printPage(which) {
  document.body.classList.toggle('print-kot', which === 'kitchen');
  window.print();
  setTimeout(() => document.body.classList.remove('print-kot'), 1000);
}

/** Start the Bluetooth connection inside the tap, before any network call uses up the tap. */
function warmPrinter() {
  if (getPrinter().method === 'bluetooth') connectBluetooth('bill', true).catch(() => {});
}

/** Printer setup for this phone: phone print dialog, Bluetooth printer or the RawBT app. */
function printerDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'tall';
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  const printerRow = (slot, title, sub) => {
    const saved = getPrinter()[slot];
    return html`<div class="printer-status">
      <span><strong>${title}</strong><span class="small"> · ${sub}</span><br>
        ${saved.name ? html`${saved.name} <span class="small">${isConnected(slot) ? '· connected' : '· not connected'}</span>` : html`<span class="small">None chosen</span>`}</span>
      <span>${saved.name && !isConnected(slot) ? html`<button type="button" class="secondary" data-reconnect="${slot}">Connect</button>` : ''}
        <button type="button" class="secondary" data-choose="${slot}">${saved.name ? 'Change' : 'Choose'}</button>
        ${saved.name ? html`<button type="button" class="destructive" data-forget="${slot}">Forget</button>` : ''}</span></div>`;
  };
  const draw = (status = '') => {
    const p = getPrinter();
    setHTML(dialog, html`
      <form class="dialog-body" novalidate>
        <h2 style="margin:0" class="with-ic">${ic('printer')} Printer</h2>
        <p class="hint">Saved on this phone only. Each phone that prints sets this once.</p>
        ${isApple() && !bluetoothSupported() ? html`<div class="ios-tip">
          <strong>On iPhone / iPad</strong>
          <p>Apple doesn’t let Safari or Chrome use Bluetooth, so they can’t reach the printer. To print straight to the Bluetooth printer:</p>
          <ol>
            <li>Install the free app <strong>“Bluefy – Web BLE Browser”</strong> from the App Store.</li>
            <li>Open this billing link in Bluefy and sign in.</li>
            <li>Tap 🖨️ → <strong>Bluetooth printer (direct)</strong> → Choose Printer.</li>
          </ol>
          <button type="button" class="secondary wide" data-copy-link>Copy App Link</button>
        </div>` : ''}
        <div class="auth-alert" role="status" ${status ? '' : new Raw('hidden')}>${status}</div>
        <fieldset class="feature-picks">
          <legend>How should bills print?</legend>
          <label class="feature-pick"><input type="radio" name="method" value="bluetooth" ${p.method === 'bluetooth' ? new Raw('checked') : ''}>
            <span><strong>Bluetooth printer (direct)</strong><span class="small">Prints at once, no popup. Chrome on Android, or the Bluefy app on iPhone. Works with most Bluetooth receipt printers.${bluetoothSupported() ? '' : ' Not available in this browser.'}</span></span></label>
          <label class="feature-pick"><input type="radio" name="method" value="rawbt" ${p.method === 'rawbt' ? new Raw('checked') : ''}>
            <span><strong>RawBT app</strong><span class="small">Android only. For printers the browser can’t find. Install the free “RawBT” app from Play Store and pick your printer there once.</span></span></label>
          <label class="feature-pick"><input type="radio" name="method" value="dialog" ${p.method === 'dialog' ? new Raw('checked') : ''}>
            <span><strong>Phone print dialog</strong><span class="small">The normal popup. For Wi-Fi printers, PDF or computers.</span></span></label>
        </fieldset>
        <label>Blank space after each bill
          <select name="feed">${[1, 2, 3, 4].map((n) => html`<option value="${n}" ${feedLines() === n ? new Raw('selected') : ''}>${n} line${n === 1 ? '' : 's'}${n === 2 ? ' (default)' : ''}</option>`)}</select></label>
        <fieldset class="segmented" style="border:0;margin:0" aria-label="Paper width">
          <label><input type="radio" name="paper" value="58" ${p.paper !== 80 ? new Raw('checked') : ''}><span>58 mm (2 inch)</span></label>
          <label><input type="radio" name="paper" value="80" ${p.paper === 80 ? new Raw('checked') : ''}><span>80 mm (3 inch)</span></label>
        </fieldset>
        ${p.method === 'bluetooth' ? html`
          ${printerRow('bill', 'Bill printer', 'Customer bills')}
          <label class="toggle"><input type="checkbox" name="kitchen_separate" ${p.kitchen.separate ? new Raw('checked') : ''}> Separate kitchen printer</label>
          <p class="small" style="margin:-6px 0 0">${p.kitchen.separate ? 'Kitchen copies (parcels) print on the kitchen printer.' : 'Off: kitchen copies print on the bill printer.'}</p>
          ${p.kitchen.separate ? printerRow('kitchen', 'Kitchen printer', 'Kitchen copies') : ''}
          ${bluetoothRemembers() ? '' : html`<details class="remember-tip"><summary>Stop Chrome asking for the printer every time</summary>
            <ol>
              <li>In Chrome, open <strong>chrome://flags</strong> (type it in the address bar).</li>
              <li>Search <strong>Web Bluetooth new permissions backend</strong> and set it to <strong>Enabled</strong>.</li>
              <li>Tap <strong>Relaunch</strong>, open this app, and connect the printer once more.</li>
            </ol>
            <p class="small">After that the app reconnects by itself whenever it opens. Or use the RawBT app, which never asks.</p></details>`}` : ''}
        ${p.method !== 'dialog' ? html`<button type="button" class="secondary wide" data-test>Print Test Slip${p.method === 'bluetooth' && p.kitchen.separate ? 's' : ''}</button>` : ''}
        <button type="button" class="wide" data-done>Done</button>
      </form>`);
  };
  dialog.addEventListener('change', (e) => {
    if (e.target.name === 'method') setPrinter({ method: e.target.value });
    if (e.target.name === 'paper') setPrinter({ paper: Number(e.target.value) });
    if (e.target.name === 'feed') setPrinter({ feed: Number(e.target.value) });
    if (e.target.name === 'kitchen_separate') setPrinter({ kitchen: { ...getPrinter().kitchen, separate: e.target.checked } });
    draw();
  });
  dialog.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.done !== undefined) return close();
    if (t.dataset.copyLink !== undefined) {
      const link = location.href.split('#')[0];
      try { await navigator.clipboard.writeText(link); draw('App link copied. Paste it in Bluefy’s address bar.'); } catch { draw(`App link: ${link}`); }
      return;
    }
    if (t.dataset.forget) { forgetBluetooth(t.dataset.forget); return draw('Printer forgotten.'); }
    if (t.dataset.choose || t.dataset.reconnect) {
      const slot = t.dataset.choose || t.dataset.reconnect;
      t.disabled = true;
      try {
        const name = t.dataset.choose ? await chooseBluetooth(slot) : await connectBluetooth(slot, true);
        draw(`${slot === 'kitchen' ? 'Kitchen' : 'Bill'} printer: ${name} connected. Tap Print Test to check.`);
      } catch (err) { draw(friendly(err)); }
    }
    if (t.dataset.test !== undefined) {
      const test = (target, title) => new Slip(paperWidth(), target).align('center').bold(true).size(2, 2).line(title).size(1, 1).bold(false)
        .line('Printer is working').line(dateTime(new Date().toISOString())).rule().line('1234567890'.repeat(5).slice(0, paperWidth())).cut();
      const p = getPrinter();
      const slips = [test('bill', 'BILL PRINTER'), ...(p.method === 'bluetooth' && p.kitchen.separate ? [test('kitchen', 'KITCHEN')] : [])];
      try {
        const failed = await printSlips(slips, { pick: true });
        draw(failed.length ? `The ${failed[0].slot} printer didn’t print: ${friendly(failed[0].error)}` : 'Test sent. If nothing printed, try the other paper width or RawBT.');
      } catch (err) { draw(friendly(err)); }
    }
  });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  draw();
  dialog.showModal();
}

// ---------- Bill / receipt ----------

async function billView(token, orderId, autoPrint) {
  const [order, settings, owner] = await Promise.all([
    q(sb.from('orders').select('*, dining_tables(name), order_items(*)').eq('id', orderId).order('id', { referencedTable: 'order_items' }).single()),
    getSettings(),
    isOwner(),
  ]);
  const history = owner && order.edit_count
    ? await q(sb.from('bill_logs').select('*').eq('order_id', order.id).order('created_at', { ascending: false })).catch(() => [])
    : [];
  if (token !== renderToken) return;
  const paid = order.status === 'paid';
  const rate = order.tax_rate_bp ?? settings.tax_rate_bp;
  const b = orderBill(order, order.order_items, rate);
  const kv = (k, v, cls = '') => html`<div class="kv ${cls}"><span>${k}</span><span>${v}</span></div>`;
  setHTML($view, html`
    <div class="receipt-wrap">
      <div class="receipt-actions no-print">
        ${paid
          ? html`<a class="button secondary" href="#/bills">All Bills</a>
                 <button type="button" class="secondary" id="print">Print</button>
                 <button type="button" class="secondary" id="printer-setup" aria-label="Printer setup">${ic('printer')}</button>
                 ${owner && feat('bill_edit') ? html`<button type="button" class="secondary" id="edit-bill">Edit Bill</button>
                   <button type="button" class="secondary danger-outline" id="delete-bill">Delete</button>` : html`<a class="button secondary" href="#/">Tables</a>`}`
          : html`<a class="button secondary" href="${order.is_parcel ? `#/parcel/${order.id}` : `#/table/${order.table_id}/${order.section}`}">Add Items</a>
                 <button type="button" class="secondary" id="print">Print Again</button>
                 <button type="button" class="secondary" id="printer-setup" aria-label="Printer setup">${ic('printer')}</button>
                 <button type="button" id="pay">Receive Payment</button>`}
      </div>
      ${paid ? html`<p class="paid-note no-print">Paid by ${order.payment_method} · ${dateTime(order.closed_at)}${order.edit_count ? html` · <span class="edited-tag">Edited ${order.edit_count}×</span>` : ''}</p>`
             : html`<p class="paid-note no-print">Give this bill to ${orderLabel(order)}. Tap Receive Payment once they pay.</p>`}
      <article class="receipt" aria-label="Bill">
        <div class="center">
          <div class="shop">${settings.hotel_name}</div>
          ${settings.hotel_address ? html`<div>${settings.hotel_address}</div>` : ''}
          ${settings.hotel_phone ? html`<div>Ph: ${settings.hotel_phone}</div>` : ''}
          ${settings.hotel_gstin && rate > 0 ? html`<div>GSTIN: ${settings.hotel_gstin}</div>` : ''}
        </div>
        <div class="rule"></div>
        ${order.is_parcel && order.bill_no ? html`<div class="token-box"><span>PARCEL · Bill No.</span><strong>${tokenNo(order.bill_no)}</strong></div><div class="rule"></div>` : ''}
        ${kv(order.bill_no ? `Bill: ${order.bill_no}` : 'Bill', order.is_parcel ? 'Parcel' : `Table: ${orderLabel(order)}`)}
        ${kv(dateTime(order.closed_at ?? order.billed_at ?? new Date().toISOString()), paid ? order.payment_method : '')}
        <div class="rule"></div>
        <table>
          <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amt</th></tr></thead>
          <tbody>${order.order_items.map((i) => html`
            <tr><td>${i.name}<br><small>@ ${fmt(i.unit_price)}</small></td><td class="r">${i.quantity}</td><td class="r">${fmt(i.unit_price * i.quantity)}</td></tr>`)}
          </tbody>
        </table>
        <div class="rule"></div>
        ${kv(`Subtotal (${b.itemCount} items)`, fmt(b.subtotal))}
        ${b.discount ? kv('Discount', `-${fmt(b.discount)}`) : ''}
        ${b.tax ? [kv(`CGST @ ${pct(rate / 2)}`, fmt(b.cgst)), kv(`SGST @ ${pct(rate / 2)}`, fmt(b.sgst))] : ''}
        ${b.roundOff ? kv('Round off', fmt(b.roundOff)) : ''}
        <div class="rule"></div>
        ${kv('TOTAL', rs(b.total), 'grand')}
        <div class="rule"></div>
        <div class="center">Thank you! Visit again.</div>
      </article>
      ${order.is_parcel && order.bill_no ? html`
        <div class="kot-actions no-print"><button type="button" class="wide" id="print-kot">${ic('kitchen')} Print Kitchen Copy</button></div>
        <p class="paid-note no-print" style="margin-top:12px">Kitchen copy</p>
        <article class="receipt kot" aria-label="Kitchen copy">
          <div class="center"><div class="shop">KITCHEN · PARCEL</div></div>
          <div class="rule"></div>
          <div class="token-box"><span>Bill No.</span><strong>${tokenNo(order.bill_no)}</strong></div>
          <div class="rule"></div>
          ${kv(order.bill_no, time(order.billed_at ?? order.closed_at ?? new Date().toISOString()))}
          <div class="rule"></div>
          <table>
            <thead><tr><th>Item</th><th class="r">Qty</th></tr></thead>
            <tbody>${order.order_items.map((i) => html`<tr><td class="kot-item">${i.name}</td><td class="r kot-item">${i.quantity}</td></tr>`)}</tbody>
          </table>
          <div class="rule"></div>
          ${kv(`${b.itemCount} item${b.itemCount === 1 ? '' : 's'}`, 'Pack for takeaway')}
        </article>` : ''}
      ${history.length ? html`<section class="history no-print" aria-label="Changes to this bill">
        <h3>Changes to this bill</h3>
        <div class="list">${history.map(logRow)}</div>
      </section>` : ''}
    </div>`);
  document.getElementById('print').addEventListener('click', (e) => {
    if (!directPrinting()) return printPage('bill');
    act(e.currentTarget, () => printOrderDirect(order.id));
  });
  document.getElementById('print-kot')?.addEventListener('click', (e) => {
    if (!directPrinting()) return printPage('kitchen');
    act(e.currentTarget, () => printOrderDirect(order.id, 'kitchen'));
  });
  document.getElementById('printer-setup')?.addEventListener('click', printerDialog);
  document.getElementById('edit-bill')?.addEventListener('click', () => editBill(order, rate));
  document.getElementById('delete-bill')?.addEventListener('click', () => deleteBill(order, b.total));
  document.getElementById('pay')?.addEventListener('click', async () => {
    const billNo = await receivePayment({ orderId: order.id, tableName: orderLabel(order), total: b.total });
    if (billNo) location.hash = '#/';
  });
  if (autoPrint) {
    window.history.replaceState(null, '', `#/bill/${order.id}`);
    if (directPrinting()) printOrderDirect(order.id).catch((err) => toast(`${friendly(err)} Tap Print to try again.`, 'error'));
    else setTimeout(() => printPage('bill'), 300);
  }
}

// ---------- Bills (history) ----------

async function billsView(token, day = localDay()) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const [list, settings, unpaid, owner] = await Promise.all([
    // Every bill of the day with its total, worked out in the database (no item lists downloaded).
    q(sb.rpc('bill_list', { p_from: start.toISOString(), p_to: end.toISOString() })),
    getSettings(),
    q(sb.from('orders').select('*, dining_tables(name), order_items(quantity, unit_price)').eq('status', 'open')
      .not('billed_at', 'is', null).order('billed_at')),
    isOwner(),
  ]);
  if (token !== renderToken) return;
  const rows = list.map((x) => ({
    o: { ...x, payment_method: x.method }, b: { total: Number(x.total) },
    href: x.kind === 'stay' ? `#/stay/${x.id}` : `#/bill/${x.id}`, label: x.label,
  }));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.b.total, 0);
  const isToday = day === localDay();
  const total = sum(() => true);
  const byMethod = Object.fromEntries(METHODS.map((m) => [m, sum((r) => r.o.payment_method === m)]));
  const badge = (m) => html`<span class="method-badge m-${m.toLowerCase()}" aria-hidden="true">${m === 'Cash' ? '₹' : m}</span>`;
  setHTML($view, html`
    <div class="page-head">
      <div><p class="eyebrow">${isToday ? 'Today' : new Date(start).toLocaleDateString('en-IN', { weekday: 'long' })}</p>
        <h1>Bills</h1></div>
    </div>
    <section class="sales-card" aria-label="Sales">
      <span class="label">${isToday ? 'Today’s sales' : `Sales on ${new Date(start).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`} · ${rows.length} bill${rows.length === 1 ? '' : 's'}</span>
      <span class="big">${rs(total)}</span>
      <div class="split-bar" aria-hidden="true">${total ? METHODS.filter((m) => byMethod[m]).map((m) => html`<span class="m-${m.toLowerCase()}" style="flex:${byMethod[m]}"></span>`) : ''}</div>
      <div class="split-legend">${METHODS.map((m) => html`<div class="m-${m.toLowerCase()}"><span class="k">${m}</span><strong>${rs(byMethod[m]).replace('.00', '')}</strong></div>`)}</div>
    </section>
    <div class="bills-tools">
      <label class="date-pick">${ic('calendar')} <input type="date" id="day" value="${day}" max="${localDay()}" aria-label="Show bills for date"></label>
      ${owner && feat('bill_edit') ? html`<a class="button secondary" href="#/bills/log">Change Log</a>` : ''}
    </div>
    ${unpaid.length ? html`
      <h3 style="margin-top:0">Waiting for payment · ${unpaid.length}</h3>
      <div class="list" style="margin-bottom:20px">${unpaid.map((o) => html`
        <a class="list-row" href="#/bill/${o.id}">
          <span class="method-badge m-wait" aria-hidden="true">⏳</span>
          <span class="grow"><strong>${orderLabel(o)}</strong> · ${o.bill_no}<div class="sub">Printed ${time(o.billed_at)} · not paid yet</div></span>
          <span class="money">${rs(orderBill(o, o.order_items, settings.tax_rate_bp).total)}</span><span class="chevron" aria-hidden="true">›</span>
        </a>`)}</div>` : ''}
    <h3 style="margin-top:0">Paid bills</h3>
    ${rows.length ? html`<div class="list">${rows.map(({ o, b, href, label }) => html`
      <a class="list-row" href="${href}">
        ${badge(o.payment_method)}
        <span class="grow"><strong>${label}</strong> · ${o.bill_no}<div class="sub">${time(o.closed_at)} · ${o.payment_method}${o.edit_count ? html` · <span class="edited-tag">Edited</span>` : ''}</div></span>
        <span class="money">${rs(b.total)}</span><span class="chevron" aria-hidden="true">›</span>
      </a>`)}</div>`
    : html`<div class="card empty"><span class="emoji" aria-hidden="true">🧾</span>No bills ${isToday ? 'yet today' : 'on this day'}. Paid bills appear here.</div>`}`);
  document.getElementById('day').addEventListener('change', (e) => { location.hash = `#/bills/${e.target.value}`; });
}

// ---------- Edit / delete paid bills (owner), with a change log ----------

const logItems = (snap) => (snap?.items ?? []).map((i) => `${i.name} ×${i.qty}`).join(', ');
function logRow(l) {
  const before = l.before?.total ?? 0;
  const after = l.after?.total;
  const changes = [];
  if (l.after) {
    if (logItems(l.before) !== logItems(l.after)) changes.push(['Items', logItems(l.before), logItems(l.after)]);
    if ((l.before.discount ?? 0) !== (l.after.discount ?? 0)) changes.push(['Discount', rs(l.before.discount ?? 0), rs(l.after.discount ?? 0)]);
    if (l.before.method !== l.after.method) changes.push(['Payment', l.before.method, l.after.method]);
  }
  return html`<details class="log-row">
    <summary>
      <span class="log-badge ${l.action}">${l.action === 'edit' ? 'Edited' : 'Deleted'}</span>
      <span class="grow"><strong>${l.bill_no ?? 'Bill'}</strong>${l.table_label ? ` · ${l.table_label}` : ''}
        <div class="sub">${dateTime(l.created_at)} · ${l.user_email ?? 'Unknown'}</div>
        ${l.reason ? html`<div class="log-reason">“${l.reason}”</div>` : ''}</span>
      <span class="log-amount">${l.after ? html`<s>${rs(before)}</s> ${rs(after)}` : html`<s>${rs(before)}</s>`}</span>
    </summary>
    <div class="log-detail">
      ${l.after
        ? (changes.length ? changes.map(([k, a, b]) => html`<div class="log-change"><span class="k">${k}</span><span class="was">${a || '—'}</span><span class="now">${b || '—'}</span></div>`)
          : html`<p class="small">No visible changes.</p>`)
        : html`<div class="log-change"><span class="k">Items</span><span class="was">${logItems(l.before)}</span></div>
               <div class="log-change"><span class="k">Payment</span><span class="was">${l.before?.method ?? '—'}</span></div>`}
    </div>
  </details>`;
}

async function editBill(order, rate) {
  const menu = await getMenu().catch(() => []);
  // Work on a copy; nothing is saved until the owner taps Save.
  const items = order.order_items.map((i) => ({ menu_item_id: i.menu_item_id, name: i.name, unit_price: i.unit_price, quantity: i.quantity }));
  const draft = { discount: order.discount, method: order.payment_method };
  const dialog = document.createElement('dialog');
  dialog.className = 'tall';
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  const draw = () => {
    const b = orderBill({ discount: draft.discount }, items, rate);
    setHTML(dialog, html`
      <form class="dialog-body" novalidate>
        <h2 style="margin:0">Edit Bill ${order.bill_no}</h2>
        <div class="auth-alert error" role="alert" hidden></div>
        <ul class="edit-lines">${items.map((i, n) => html`
          <li><span class="grow"><strong>${i.name}</strong><div class="sub">${rs(i.unit_price)} each</div></span>
            <span class="qty" role="group" aria-label="Quantity of ${i.name}">
              <button type="button" data-dec="${n}" aria-label="One less ${i.name}">−</button><output>${i.quantity}</output>
              <button type="button" data-inc="${n}" aria-label="One more ${i.name}">+</button></span></li>`)}
          ${items.length ? '' : html`<li class="small">No items. Add a dish below, or delete the bill instead.</li>`}
        </ul>
        <label>Add a dish
          <select data-add-dish><option value="">Choose a dish…</option>
            ${menu.map((m) => html`<option value="${m.id}">${m.name} · ${rs(m.price).replace('.00', '')}</option>`)}</select></label>
        <div class="row">
          <label>Discount (₹) <input name="discount" inputmode="decimal" value="${draft.discount ? plain(draft.discount) : ''}" placeholder="0"></label>
          <div class="edit-total"><span class="small">New total</span><strong>${rs(b.total)}</strong>
            <span class="small">was ${rs(orderBill(order, order.order_items, rate).total)}</span></div>
        </div>
        <fieldset class="segmented" style="border:0;margin:0" aria-label="Payment method">
          ${METHODS.map((m) => html`<label><input type="radio" name="method" value="${m}" ${m === draft.method ? new Raw('checked') : ''}><span>${m}</span></label>`)}
        </fieldset>
        <label>Reason for the change <input name="reason" placeholder="e.g. Customer returned Lassi" maxlength="200" autocomplete="off"></label>
        <button type="submit" class="wide">Save Changes</button>
        <button type="button" class="secondary wide" data-cancel>Cancel</button>
      </form>`);
  };
  const keepInputs = () => {
    const form = dialog.querySelector('form');
    if (!form) return {};
    const f = Object.fromEntries(new FormData(form));
    if (f.method) draft.method = f.method;
    return f;
  };
  dialog.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cancel !== undefined) return close();
    const reason = dialog.querySelector('[name=reason]')?.value ?? '';
    if (t.dataset.inc) items[t.dataset.inc].quantity += 1;
    else if (t.dataset.dec) { const i = items[t.dataset.dec]; i.quantity -= 1; if (i.quantity < 1) items.splice(Number(t.dataset.dec), 1); }
    else return;
    keepInputs(); draw();
    dialog.querySelector('[name=reason]').value = reason;
  });
  dialog.addEventListener('change', (e) => {
    const reason = dialog.querySelector('[name=reason]')?.value ?? '';
    if (e.target.matches('[data-add-dish]') && e.target.value) {
      const m = menu.find((x) => x.id === Number(e.target.value));
      const existing = items.find((i) => i.menu_item_id === m.id);
      if (existing) existing.quantity += 1;
      else items.push({ menu_item_id: m.id, name: m.name, unit_price: m.price, quantity: 1 });
    } else if (e.target.name === 'discount') {
      try { draft.discount = toPaise(e.target.value); } catch { return; }
    } else { keepInputs(); return; }
    keepInputs(); draw();
    dialog.querySelector('[name=reason]').value = reason;
  });
  dialog.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = keepInputs();
    const alertBox = dialog.querySelector('[role=alert]');
    const fail = (m) => { alertBox.textContent = m; alertBox.hidden = false; };
    if (!items.length) return fail('A bill needs at least one item. To remove the whole bill, use Delete.');
    try { draft.discount = toPaise(f.discount); } catch (err) { return fail(err.message); }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving…';
    const { error } = await sb.rpc('edit_paid_bill', {
      p_order_id: order.id, p_items: items, p_discount: draft.discount, p_method: draft.method, p_reason: f.reason ?? '',
    });
    if (error) { btn.disabled = false; btn.textContent = 'Save Changes'; return fail(friendly(error)); }
    close();
    toast(`Bill ${order.bill_no} updated · saved in the change log`);
    route();
  });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  draw();
  dialog.showModal();
}

function deleteBill(order, total) {
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  setHTML(dialog, html`
    <form class="dialog-body" novalidate>
      <h2 style="margin:0">Delete Bill ${order.bill_no}?</h2>
      <div class="auth-alert error" role="alert" hidden></div>
      <div class="due"><span class="muted">Bill total</span><span class="money">${rs(total)}</span></div>
      <p class="hint">The bill is removed from sales. A full copy is kept in the change log with your name and reason.</p>
      <label>Reason <input name="reason" placeholder="e.g. Wrong table, entered twice" maxlength="200" autocomplete="off" required></label>
      <button type="submit" class="wide danger-fill">Delete Bill</button>
      <button type="button" class="secondary wide" data-cancel>Cancel</button>
    </form>`);
  dialog.querySelector('[data-cancel]').addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = e.target.reason.value.trim();
    const alertBox = dialog.querySelector('[role=alert]');
    if (!reason) { alertBox.textContent = 'Write a short reason, so the log shows why this bill was deleted.'; alertBox.hidden = false; return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Deleting…';
    const { error } = await sb.rpc('delete_paid_bill', { p_order_id: order.id, p_reason: reason });
    if (error) { btn.disabled = false; btn.textContent = 'Delete Bill'; alertBox.textContent = friendly(error); alertBox.hidden = false; return; }
    close();
    toast(`Bill ${order.bill_no} deleted · saved in the change log`);
    location.hash = '#/bills';
  });
  dialog.showModal();
}

async function logView(token) {
  const [owner, logs] = await Promise.all([
    isOwner(),
    q(sb.from('bill_logs').select('*').order('created_at', { ascending: false }).limit(200)).catch(() => null),
  ]);
  if (token !== renderToken) return;
  setHTML($view, html`
    <div class="page-head"><div><p class="eyebrow"><a href="#/bills">‹ Bills</a></p><h1>Change Log</h1>
      <p class="muted">Every edited or deleted bill, with who did it and why.</p></div></div>
    ${!owner ? html`<div class="card empty">Only the owner can see the change log.</div>`
      : logs === null ? html`<div class="card empty">The change log isn’t set up yet. Run the last database step, then reload.</div>`
      : logs.length ? html`<div class="list">${logs.map(logRow)}</div>`
      : html`<div class="card empty"><span class="emoji" aria-hidden="true">📝</span>No changes yet. Edited and deleted bills will appear here.</div>`}`);
}

// ---------- Analytics: sales for any date range ----------

const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
/** Quick ranges: [label, () => [from, to]] with both days included. */
const RANGES = {
  today: ['Today', () => { const t = localDay(new Date()); return [t, t]; }],
  week: ['7 days', () => { const t = localDay(new Date()); return [addDays(t, -6), t]; }],
  month: ['This month', () => { const n = new Date(); return [localDay(new Date(n.getFullYear(), n.getMonth(), 1)), localDay(n)]; }],
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
let analytics = { range: 'week', from: null, to: null, sort: 'qty', allDishes: false };

async function analyticsView(token) {
  const a = analytics;
  if (a.range !== 'custom') [a.from, a.to] = RANGES[a.range][1]();
  const days = daysBetween(a.from, a.to);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const [report, menu] = await Promise.all([
    // One small summary from the database instead of every bill in the range.
    q(sb.rpc('sales_report', {
      p_from: new Date(`${a.from}T00:00:00`).toISOString(), p_to: new Date(`${addDays(a.to, 1)}T00:00:00`).toISOString(), p_tz: tz,
    })),
    getMenu(),
  ]);
  if (token !== renderToken) return;

  const t = report.totals;
  const prev = report.prev;
  const money = (p) => rs(p).replace('.00', '');
  const rangeName = a.range === 'custom' ? (days === 1 ? shortDate(a.from) : `${shortDate(a.from)} – ${shortDate(a.to)}`) : RANGES[a.range][0];
  const prevName = days === 1 ? 'the day before' : `the ${days} days before`;
  const change = (now, before) => {
    if (!before) return now ? html`<span class="trend new">New</span>` : html`<span class="trend flat">—</span>`;
    const pc = Math.round(((now - before) / before) * 100);
    return pc === 0 ? html`<span class="trend flat">Same</span>` : html`<span class="trend ${pc > 0 ? 'up' : 'down'}">${pc > 0 ? '▲' : '▼'} ${Math.abs(pc)}%</span>`;
  };

  // Dishes and categories
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const sold = report.dishes.map((x) => {
    const m = menuById.get(x.menu_item_id);
    return { name: m?.name ?? x.name, category: m?.category ?? 'Other', is_veg: m?.is_veg ?? true, qty: Number(x.qty), revenue: Number(x.revenue), prevQty: Number(x.prev_qty) };
  }).filter((r) => r.qty > 0);
  const metric = (r) => (a.sort === 'qty' ? r.qty : r.revenue);
  sold.sort((x, y) => metric(y) - metric(x) || y.qty - x.qty || x.name.localeCompare(y.name));
  const dishMax = sold.length ? metric(sold[0]) : 0;
  const cats = new Map();
  sold.forEach((r) => { const c = cats.get(r.category) ?? { name: r.category, qty: 0, revenue: 0 }; c.qty += r.qty; c.revenue += r.revenue; cats.set(r.category, c); });
  const catList = [...cats.values()].sort((x, y) => metric(y) - metric(x));
  const catMax = catList.length ? metric(catList[0]) : 0;
  const dishTrend = (r) => {
    if (!r.prevQty) return html`<span class="trend new">New</span>`;
    const d = r.qty - r.prevQty;
    return d ? html`<span class="trend ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}</span>` : html`<span class="trend flat">Same</span>`;
  };
  const shownDishes = a.allDishes ? sold : sold.slice(0, 10);

  // Day by day (every day in the range, including days with no sales)
  const byDay = new Map(report.days.map((d) => [d.day, d]));
  const dayRows = Array.from({ length: Math.min(days, 92) }, (_, i) => {
    const day = addDays(a.from, i);
    return { day, bills: byDay.get(day)?.bills ?? 0, sales: Number(byDay.get(day)?.sales ?? 0) };
  });
  const dayMax = Math.max(...dayRows.map((d) => d.sales), 0);
  const best = report.days.length ? report.days.reduce((x, y) => (Number(y.sales) > Number(x.sales) ? y : x)) : null;
  // Hours: from the first to the last hour with a sale
  const byHour = new Map(report.hours.map((h) => [h.hour, h]));
  const hrs = report.hours.map((h) => h.hour);
  const hourRows = hrs.length ? Array.from({ length: Math.max(...hrs) - Math.min(...hrs) + 1 }, (_, i) => {
    const h = Math.min(...hrs) + i;
    return { h, bills: byHour.get(h)?.bills ?? 0, sales: Number(byHour.get(h)?.sales ?? 0) };
  }) : [];
  const hourMax = Math.max(...hourRows.map((h) => h.sales), 0);
  const peak = hourRows.length ? hourRows.reduce((x, y) => (y.sales > x.sales ? y : x)) : null;
  const wk = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({ dow, sales: Number(report.weekdays.find((w) => w.dow === dow)?.sales ?? 0), bills: report.weekdays.find((w) => w.dow === dow)?.bills ?? 0 }));
  const wkMax = Math.max(...wk.map((w) => w.sales), 0);
  const methodTotal = report.methods.reduce((n, m) => n + Number(m.sales), 0);
  const mClass = (m) => `m-${String(m).toLowerCase().replace(/[^a-z]/g, '')}`;
  const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);
  const avgBill = t.bills ? Math.round(t.sales / t.bills / 100) * 100 : 0;
  const showRooms = feat('rooms') && report.rooms?.bills > 0;

  const col = (label, value, title, max, cls = '') => html`
    <div class="col ${cls}" title="${title}"><span class="col-bar" style="height:${max ? Math.max(value ? 4 : 0, (value / max) * 100) : 0}%"></span><span class="col-label">${label}</span></div>`;

  const root = mount(html`
    <div class="page-head"><div><p class="eyebrow">Sales report</p><h1>Analytics</h1></div></div>
    <div class="filter-tabs" role="toolbar" aria-label="Date range">
      ${Object.entries(RANGES).map(([k, [label]]) => html`<button type="button" class="chip" data-range="${k}" aria-pressed="${k === a.range}">${label}</button>`)}
      <button type="button" class="chip" data-range="custom" aria-pressed="${a.range === 'custom'}">${ic('calendar')} Dates</button>
    </div>
    <form class="range-form card" id="range-form" ${a.range === 'custom' ? '' : new Raw('hidden')}>
      <label>From <input type="date" name="from" value="${a.from}" max="${localDay(new Date())}" required></label>
      <label>To <input type="date" name="to" value="${a.to}" max="${localDay(new Date())}" required></label>
      <button type="submit">Show</button>
    </form>
    <section class="hero an-hero" aria-label="Sales">
      <span class="label">Sales · ${rangeName}</span>
      ${t.bills ? html`<button type="button" class="an-export" id="an-export" aria-label="Export to spreadsheet" title="Export to spreadsheet">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg></button>` : ''}
      <span class="big">${money(t.sales)}</span>
      <span class="an-compare">${change(t.sales, prev.sales)} vs ${prevName} (${money(prev.sales)})</span>
      <div class="facts">
        <div class="fact"><strong>${t.bills}</strong><span>Bills</span></div>
        <div class="fact"><strong>${money(avgBill)}</strong><span>Avg. bill</span></div>
        <div class="fact"><strong>${t.items}</strong><span>Dishes sold</span></div>
      </div>
    </section>
    ${!t.bills ? html`<div class="card empty"><span class="emoji" aria-hidden="true">📊</span>No paid bills ${days === 1 ? 'on this day' : 'in these dates'}.<br>Pick another range above.</div>` : html`
      <div class="kpis an-kpis">
        <div class="kpi"><span>Bills vs before</span><strong>${t.bills} ${change(t.bills, prev.bills)}</strong></div>
        <div class="kpi"><span>Discount given</span><strong>${money(t.discount)}</strong></div>
        ${t.tax ? html`<div class="kpi"><span>GST collected</span><strong>${money(t.tax)}</strong></div>` : ''}
        <div class="kpi"><span>Parcels</span><strong>${t.parcels} <small>· ${money(t.parcel_sales)}</small></strong></div>
        ${t.dine_in_minutes ? html`<div class="kpi"><span>Avg. time at table</span><strong>${t.dine_in_minutes} min</strong></div>` : ''}
        ${peak ? html`<div class="kpi"><span>Busiest hour</span><strong>${hourLabel(peak.h)}</strong></div>` : ''}
        ${days > 1 && best ? html`<div class="kpi"><span>Best day</span><strong>${shortDate(best.day)} <small>· ${money(best.sales)}</small></strong></div>` : ''}
        ${showRooms ? html`<div class="kpi"><span>Room bills</span><strong>${report.rooms.bills} <small>· ${money(report.rooms.sales)}</small></strong></div>` : ''}
      </div>

      ${days > 1 ? html`
        <h3>Sales by day</h3>
        <div class="card chart-card">
          <div class="cols ${dayRows.length > 14 ? 'dense' : ''}" role="img" aria-label="Sales by day">${dayRows.map((d, i) => col(
            dayRows.length <= 14 || i % Math.ceil(dayRows.length / 10) === 0 ? (dayRows.length <= 7 ? WEEKDAYS[new Date(`${d.day}T00:00:00`).getDay()] : String(Number(d.day.slice(8)))) : '',
            d.sales, `${shortDate(d.day)}: ${money(d.sales)} · ${d.bills} bill${d.bills === 1 ? '' : 's'}`, dayMax))}</div>
          <p class="chart-note">Highest ${money(dayMax)} · ${days > 92 ? 'first 92 days shown' : `daily average ${money(Math.round(t.sales / days / 100) * 100)}`}</p>
        </div>` : ''}

      ${hourRows.length > 1 ? html`
        <h3>Busy hours</h3>
        <div class="card chart-card">
          <div class="cols ${hourRows.length > 12 ? 'dense' : ''}" role="img" aria-label="Sales by hour of the day">${hourRows.map((h, i) => col(
            hourRows.length <= 12 || i % 2 === 0 ? hourLabel(h.h) : '', h.sales, `${hourLabel(h.h)}–${hourLabel((h.h + 1) % 24)}: ${money(h.sales)} · ${h.bills} bill${h.bills === 1 ? '' : 's'}`, hourMax, peak && h.h === peak.h ? 'peak' : ''))}</div>
        </div>` : ''}

      <h3>Payments</h3>
      <div class="card an-pay">
        <div class="split-bar" aria-hidden="true">${report.methods.map((m) => html`<span class="${mClass(m.method)}" style="width:${pct(Number(m.sales), methodTotal)}%"></span>`)}</div>
        <div class="split-legend">${report.methods.map((m) => html`
          <div class="${mClass(m.method)}"><span class="k">${m.method} · ${pct(Number(m.sales), methodTotal)}%</span><strong>${money(m.sales)}</strong><span class="small">${m.bills} bill${m.bills === 1 ? '' : 's'}</span></div>`)}
        </div>
      </div>

      ${days >= 7 ? html`
        <h3>By weekday</h3>
        <div class="card cat-bars">${wk.map((w) => html`
          <div class="cat-row" title="${WEEKDAYS[w.dow]}: ${money(w.sales)} · ${w.bills} bills">
            <span class="cat-name">${WEEKDAYS[w.dow]}</span>
            <span class="bar-track" aria-hidden="true"><span class="bar" style="width:${wkMax ? Math.max(w.sales ? 3 : 0, (w.sales / wkMax) * 100) : 0}%"></span></span>
            <span class="cat-value">${money(w.sales)}</span>
          </div>`)}
        </div>` : ''}

      <div class="an-head"><h3>Top dishes</h3>
        <div class="filter-tabs" role="toolbar" aria-label="Rank by">
          <button type="button" class="chip" data-sort="qty" aria-pressed="${a.sort === 'qty'}">Quantity</button>
          <button type="button" class="chip" data-sort="revenue" aria-pressed="${a.sort === 'revenue'}">Sales ₹</button>
        </div></div>
      <ol class="rank-list">${shownDishes.map((r, i) => html`
        <li class="rank-row" title="${r.name}: ${r.qty} sold · ${money(r.revenue)}">
          <span class="rank ${i < 3 ? 'podium' : ''}">${i + 1}</span>
          <div class="rank-body">
            <div class="rank-line"><span class="diet ${r.is_veg ? 'veg' : 'nonveg'}" aria-hidden="true"></span><strong class="rank-name">${r.name}</strong>
              <span class="rank-value">${a.sort === 'qty' ? `${r.qty} sold` : money(r.revenue)}</span></div>
            <div class="bar-track" aria-hidden="true"><span class="bar" style="width:${Math.max(3, (metric(r) / dishMax) * 100)}%"></span></div>
            <div class="rank-meta">${r.category} · ${a.sort === 'qty' ? money(r.revenue) : `${r.qty} sold`} · ${dishTrend(r)}</div>
          </div>
        </li>`)}
      </ol>
      ${sold.length > 10 ? html`<button type="button" class="secondary wide an-more" id="an-all">${a.allDishes ? 'Show top 10' : `Show all ${sold.length} dishes`}</button>` : ''}

      ${catList.length > 1 ? html`
        <h3>By category</h3>
        <div class="card cat-bars">${catList.map((c) => html`
          <div class="cat-row" title="${c.name}: ${c.qty} sold · ${money(c.revenue)}">
            <span class="cat-name">${c.name}</span>
            <span class="bar-track" aria-hidden="true"><span class="bar" style="width:${Math.max(3, (metric(c) / catMax) * 100)}%"></span></span>
            <span class="cat-value">${a.sort === 'qty' ? c.qty : money(c.revenue)}</span>
          </div>`)}
        </div>` : ''}`}`);

  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-range]');
    const so = e.target.closest('[data-sort]');
    if (r) {
      if (r.dataset.range === 'custom') {
        a.range = 'custom';
        root.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === r)));
        root.querySelector('#range-form').hidden = false;
        return;
      }
      a.range = r.dataset.range;
    } else if (so) a.sort = so.dataset.sort;
    else if (e.target.closest('#an-all')) a.allDishes = !a.allDishes;
    else if (e.target.closest('#an-export')) { exportReport(report, sold, dayRows, rangeName); return; }
    else return;
    analyticsView(renderToken);
  });
  root.querySelector('#range-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.from > f.to) return toast('“From” must be on or before “To”.', 'error');
    Object.assign(a, { range: 'custom', from: f.from, to: f.to });
    analyticsView(renderToken);
  });
}

/** Spreadsheet (CSV) of the report: summary, day by day and every dish. */
function exportReport(report, sold, dayRows, rangeName) {
  const rupees = (p) => (Number(p) / 100).toFixed(2);
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [
    ['Sales report', rangeName, `${analytics.from} to ${analytics.to}`],
    [],
    ['Total sales', rupees(report.totals.sales)], ['Bills', report.totals.bills], ['Dishes sold', report.totals.items],
    ['Discount', rupees(report.totals.discount)], ['GST', rupees(report.totals.tax)], ['Parcels', report.totals.parcels],
    ...report.methods.map((m) => [`${m.method}`, rupees(m.sales), `${m.bills} bills`]),
    [],
    ['Date', 'Bills', 'Sales'], ...dayRows.map((d) => [d.day, d.bills, rupees(d.sales)]),
    [],
    ['Dish', 'Category', 'Quantity', 'Sales'], ...sold.map((r) => [r.name, r.category, r.qty, rupees(r.revenue)]),
  ];
  const blob = new Blob([`﻿${rows.map((r) => r.map(cell).join(',')).join('\n')}`], { type: 'text/csv' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sales-${analytics.from}-to-${analytics.to}.csv` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

// ---------- Menu ----------

async function menuView(token) {
  getMenu.clear();
  const menu = await getMenu();
  if (token !== renderToken) return;
  const categories = [...new Set(menu.map((m) => m.category))];
  const suggestions = [...categories, ...['Starters', 'Main Course', 'Breads', 'Rice', 'Beverages', 'Desserts', 'Others']]
    .filter((c, i, a) => a.indexOf(c) === i);
  const NEW_CATEGORY = '__new__';
  // A real dropdown of categories, with "+ New category" revealing a text box.
  const categoryField = (selected) => html`
    <label>Category
      <select name="category_pick" data-category-pick>
        ${suggestions.map((c) => html`<option value="${c}" ${c === selected ? new Raw('selected') : ''}>${c}</option>`)}
        <option value="${NEW_CATEGORY}">+ New category…</option>
      </select>
      <input name="category_new" placeholder="New category name" autocomplete="off" hidden>
    </label>`;
  const readCategory = (f) => (f.category_pick === NEW_CATEGORY ? (f.category_new || '').trim() : (f.category_pick || '').trim());
  const root = mount(html`
    <div class="page-head"><div><h1>Menu</h1><p class="muted">${menu.length} item${menu.length === 1 ? '' : 's'} · tap ☆ to show a dish first when taking orders</p></div>
      ${feat('qr_menu') ? html`<button type="button" class="secondary" id="menu-qr">${ic('qr')} QR Menu</button>` : ''}</div>
    <div class="two-col">
      <div>
        ${menu.length ? categories.map((c) => html`
          <h3>${c}</h3>
          <div class="list">${menu.filter((m) => m.category === c).map((m) => html`
            <div class="list-row menu-row">
              <span class="diet ${m.is_veg ? 'veg' : 'nonveg'}" title="${m.is_veg ? 'Veg' : 'Non-veg'}"></span>
              <button type="button" class="row-main" data-edit="${m.id}" aria-label="Edit ${m.name}">
                <span class="row-name">${m.name}</span>
                <span class="sub"><span class="money">${rs(m.price)}</span>${m.available ? '' : ' · Sold out'}</span>
              </button>
              <button type="button" class="star-btn" data-star="${m.id}" aria-pressed="${m.is_favorite}" aria-label="${m.is_favorite ? 'Remove' : 'Add'} ${m.name} ${m.is_favorite ? 'from' : 'to'} favourites" title="${m.is_favorite ? 'Favourite: shows first when taking orders' : 'Mark as favourite'}">${m.is_favorite ? '★' : '☆'}</button>
              <label class="toggle" title="${m.available ? 'Available' : 'Sold out'}"><input type="checkbox" data-avail="${m.id}" ${m.available ? new Raw('checked') : ''} aria-label="${m.name} available today"></label>
              <button type="button" class="secondary edit-btn" data-edit="${m.id}" aria-label="Edit ${m.name}">Edit</button>
            </div>`)}
          </div>`)
        : html`<div class="card empty">Add your first dish using the form.</div>`}
      </div>
      <form id="add-item" class="card form">
        <h2 style="margin:0">Add Item</h2>
        <label>Name <input name="name" required autocomplete="off" placeholder="e.g. Paneer Butter Masala"></label>
        <div class="row">
          ${categoryField(categories[0] ?? 'Others')}
          <label>Rate (₹) <input name="price" inputmode="decimal" required placeholder="0"></label>
        </div>
        <label class="toggle"><input type="checkbox" name="is_veg" checked> Vegetarian</label>
        <button type="submit">Add to Menu</button>
      </form>
    </div>
    <dialog id="edit-item" aria-labelledby="edit-title"></dialog>`);

  const $dialog = root.querySelector('#edit-item');

  function openEditor(m) {
    setHTML($dialog, html`
      <form class="dialog-body" id="edit-form" novalidate>
        <h2 id="edit-title" style="margin:0">Edit Item</h2>
        <div class="auth-alert error" role="alert" hidden></div>
        <label>Name <input name="name" value="${m.name}" required autocomplete="off"></label>
        <div class="row">
          ${categoryField(m.category)}
          <label>Rate (₹) <input name="price" inputmode="decimal" value="${plain(m.price)}" required></label>
        </div>
        <label class="toggle"><input type="checkbox" name="is_veg" ${m.is_veg ? new Raw('checked') : ''}> Vegetarian</label>
        <label class="toggle"><input type="checkbox" name="available" ${m.available ? new Raw('checked') : ''}> Available today</label>
        <label class="toggle"><input type="checkbox" name="is_favorite" ${m.is_favorite ? new Raw('checked') : ''}> ★ Favourite (shows first when taking orders)</label>
        <p class="hint">Tables already running keep the old rate. New orders use the new one.</p>
        <button type="submit" value="save" class="wide">Save Changes</button>
        <button type="button" class="secondary wide" data-close>Cancel</button>
        <button type="button" class="destructive wide" data-remove>Delete Item</button>
      </form>`);
    const form = $dialog.querySelector('form');
    const alertBox = form.querySelector('[role=alert]');
    const fail = (message) => { alertBox.textContent = message; alertBox.hidden = false; };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      alertBox.hidden = true;
      if (!f.name.trim()) return fail('Enter a name for this item.');
      const category = readCategory(f);
      if (!category) return fail('Type a name for the new category, like Ice Cream.');
      let price;
      try { price = toPaise(f.price); } catch (err) { return fail(err.message); }
      if (!f.price.trim()) return fail('Enter the rate in rupees.');
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      sb.from('menu_items').update({
        name: f.name.trim(), category, price, is_veg: f.is_veg === 'on', available: f.available === 'on',
        is_favorite: f.is_favorite === 'on',
      }).eq('id', m.id).then(({ error }) => {
        if (error) {
          btn.disabled = false;
          btn.textContent = 'Save Changes';
          return fail(friendly(error));
        }
        $dialog.close();
        toast(`${f.name.trim()} updated`);
        menuView(renderToken);
      });
    });
    form.querySelector('[data-close]').addEventListener('click', () => $dialog.close());
    form.querySelector('[data-remove]').addEventListener('click', (e) => {
      if (!confirm(`Delete ${m.name} from the menu? Past bills keep it.`)) return;
      act(e.currentTarget, async () => {
        await q(sb.from('menu_items').delete().eq('id', m.id));
        $dialog.close();
        toast(`${m.name} deleted`);
        menuView(renderToken);
      });
    });
    $dialog.showModal();
    form.querySelector('[name=name]').focus();
  }

  root.querySelector('#menu-qr')?.addEventListener('click', qrDialog);
  onSubmit(root, '#add-item', async (f, form) => {
    if (!f.price.trim()) throw new Error('Enter the rate in rupees.');
    const price = toPaise(f.price);
    const category = readCategory(f);
    if (!category) throw new Error('Type a name for the new category, like Ice Cream.');
    await q(sb.from('menu_items').insert({ name: f.name.trim(), category, price, is_veg: f.is_veg === 'on' }));
    toast(`${f.name.trim()} added`);
    form.reset();
    menuView(renderToken);
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-category-pick]')) {
      const box = e.target.parentElement.querySelector('[name=category_new]');
      box.hidden = e.target.value !== NEW_CATEGORY;
      if (!box.hidden) box.focus();
      return;
    }
    const el = e.target;
    if (!el.dataset.avail) return;
    act(null, async () => {
      await q(sb.from('menu_items').update({ available: el.checked }).eq('id', el.dataset.avail));
      menuView(renderToken);
    });
  });
  root.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      const m = menu.find((x) => x.id === Number(star.dataset.star));
      act(star, async () => {
        await q(sb.from('menu_items').update({ is_favorite: !m.is_favorite }).eq('id', m.id));
        toast(m.is_favorite ? `${m.name} removed from favourites` : `★ ${m.name} will show first`);
        menuView(renderToken);
      });
      return;
    }
    const b = e.target.closest('[data-edit]');
    if (b) openEditor(menu.find((x) => x.id === Number(b.dataset.edit)));
  });
}

// ---------- Settings ----------

/** Settings for managers and waiters: who they are, the hotel, the QR menu, printer and sign out. */
async function staffSettingsView(token) {
  const [s, me] = await Promise.all([
    getSettings(),
    sb.from('staff').select('display_name, role').eq('user_id', session.user.id).maybeSingle().then((r) => r.data, () => null),
  ]);
  if (token !== renderToken) return;
  const login = loginName(session.user.email);
  const name = me?.display_name || login;
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const role = account.role;
  const canPrint = account.can_bill === true || s.kot_tables;
  const root = mount(html`
    <div class="page-head"><div><p class="eyebrow">My account</p><h1>Settings</h1></div></div>
    <div class="two-col">
      <div class="card profile-card">
        <div class="staff-item">
          <span class="avatar r-${role}" aria-hidden="true">${initials}</span>
          <div class="staff-main">
            <div class="staff-name"><strong>${name}</strong><span class="role-pill r-${role}">${ROLE_NAMES[role] ?? role}</span></div>
            <div class="staff-id">${session.user.email.endsWith(STAFF_DOMAIN) ? html`Login ID <code>${login}</code>` : session.user.email}</div>
          </div>
        </div>
        <p class="small" style="margin:10px 0 0">${role === 'manager' ? 'You can take orders, print bills, take parcels and payments.' : 'You can take orders at tables.'}
          To change your password or role, ask the hotel owner.</p>
        <div class="hotel-info">
          <div><span>Hotel</span><strong>${s.hotel_name}</strong></div>
          ${s.hotel_address ? html`<div><span>Address</span><strong>${s.hotel_address}</strong></div>` : ''}
          ${s.hotel_phone ? html`<div><span>Phone</span><strong><a href="tel:${s.hotel_phone}">${s.hotel_phone}</a></strong></div>` : ''}
        </div>
      </div>
      <div>
        ${feat('qr_menu') ? html`<div class="card qr-card" id="qr-card">
          <h2>QR Menu</h2>
          <p class="small" style="margin-top:-6px">Show this to customers. They scan it with the phone camera to see the menu.</p>
          <div class="qr-box" id="qr-box"><div class="skeleton"><div class="block"></div></div></div>
          <div class="hotel-actions" style="margin-top:12px">
            <button type="button" id="qr-big">${ic('expand')} Show Big</button>
            <button type="button" class="secondary" id="qr-share">Share Link</button>
            <a class="button secondary" id="qr-open" target="_blank" rel="noopener">Open Menu</a>
          </div>
        </div>` : ''}
        <div class="card" style="margin-top:${feat('qr_menu') ? 14 : 0}px">
          <h2>This phone</h2>
          <div class="app-actions">
            ${canPrint ? html`<button type="button" class="secondary wide" id="printer-setup">${ic('printer')} Printer Setup</button>` : ''}
            <button type="button" class="secondary wide" data-install hidden>📲 Install App</button>
            <button type="button" class="wide danger-fill" id="signout">Sign Out</button>
          </div>
        </div>
      </div>
    </div>`);
  showInstall();
  root.querySelector('#signout').addEventListener('click', () => sb.auth.signOut());
  root.querySelector('#printer-setup')?.addEventListener('click', printerDialog);
  root.querySelector('#qr-big')?.addEventListener('click', qrDialog);
  if (feat('qr_menu')) {
    const box = root.querySelector('#qr-box');
    try {
      const qrToken = await q(sb.rpc('my_menu_token'));
      if (token !== renderToken) return;
      if (!qrToken) { box.textContent = 'The QR menu is switched off for this hotel.'; return; }
      const url = menuUrl(qrToken);
      box.innerHTML = qrSvg(await loadQr(), url);
      root.querySelector('#qr-open').href = url;
      root.querySelector('#qr-share').addEventListener('click', async () => {
        try {
          if (navigator.share) await navigator.share({ title: `${s.hotel_name} menu`, url });
          else { await navigator.clipboard.writeText(url); toast('Menu link copied'); }
        } catch { /* cancelled */ }
      });
    } catch (err) { box.textContent = friendly(err); }
  }
}

async function settingsView(token) {
  if (account.role !== 'owner') return staffSettingsView(token);
  const [s, staff, tables, rooms] = await Promise.all([
    getSettings(),
    q(sb.from('staff').select('*').order('created_at')),
    feat('tables') ? q(sb.from('dining_tables').select('*').order('sort').order('name')) : [],
    feat('rooms') ? q(sb.from('lodging_rooms').select('*').order('sort').order('number')) : [],
  ]);
  if (token !== renderToken) return;
  const isOwner = staff.find((m) => m.user_id === session.user.id)?.role === 'owner';
  const root = mount(html`
    <div class="page-head"><div><h1>Settings</h1><p class="muted">${session.user.email}</p></div>
      <button type="button" class="secondary" id="signout">Sign Out</button></div>
    <div class="two-col">
      <form id="settings" class="card form">
        <h2 style="margin:0">Bill Details</h2>
        <div class="locked-field"><span>Restaurant name ${ic('lock')}</span><strong>${s.hotel_name}</strong></div>
        <div class="locked-field"><span>Address ${ic('lock')}</span><strong>${s.hotel_address || '—'}</strong></div>
        <p class="small" style="margin:-4px 0 0">To change the name or address, contact Techyverve.</p>
        <label>Phone <input name="hotel_phone" type="tel" value="${s.hotel_phone}" maxlength="20"></label>
        <div class="gst-box">
          <label class="toggle"><input type="checkbox" name="gst_on" id="gst-on" ${s.tax_rate_bp > 0 ? new Raw('checked') : ''}> Charge GST on bills</label>
          <p class="small" style="margin:0">Off: bills show only items and the total. Turn on if your restaurant is GST-registered.</p>
          <div class="gst-fields" id="gst-fields" ${s.tax_rate_bp > 0 ? '' : new Raw('hidden')}>
            <div class="row">
              <label>GST rate (%) <input name="tax_rate" inputmode="decimal" value="${s.tax_rate_bp > 0 ? +(s.tax_rate_bp / 100).toFixed(2) : 5}"></label>
              <label>GSTIN <input name="hotel_gstin" value="${s.hotel_gstin}" autocapitalize="characters" placeholder="Optional"></label>
            </div>
            <p class="small" style="margin:0">Shown on the bill as CGST + SGST (half each). Bills already settled don’t change.</p>
          </div>
        </div>
        <div class="gst-box" ${feat('tables') ? '' : new Raw('hidden')}>
          <label class="toggle"><input type="checkbox" name="quick_close" ${s.quick_close !== false ? new Raw('checked') : ''}> Print Bill clears the table</label>
          <p class="small" style="margin:0">On: tapping Print Bill finishes the bill and frees the table straight away (recorded as Cash). Turn off when you have a printer and want to choose Cash / UPI / Card with Receive Payment.</p>
          <label class="toggle" style="margin-top:8px"><input type="checkbox" name="kot_tables" ${s.kot_tables ? new Raw('checked') : ''}> Kitchen tickets (KOT) for tables</label>
          <p class="small" style="margin:0">On: table orders get a “Send to Kitchen” button. Each tap prints only the newly added dishes with the table number, on the kitchen printer (or the bill printer if you have one). The full bill prints at the counter when the customer pays. Off: no kitchen printing for tables.</p>
        </div>
        <button type="submit">Save Changes</button>
      </form>
      <div>
        <div class="card" ${feat('tables') ? '' : new Raw('hidden')}>
          <h2>Tables</h2>
          <p class="small" style="margin-top:-6px">Tap a table to give it your own name, like “Garden 1” or “Family Hall”.</p>
          <div class="table-chips">${tables.map((t) => html`
            <span class="table-chip"><button type="button" class="chip-name" data-rename-table="${t.id}" aria-label="Rename table ${t.name}">${t.name} <span class="chip-edit" aria-hidden="true">✎</span></button><button type="button" class="destructive" data-del-table="${t.id}" aria-label="Remove table ${t.name}">✕</button></span>`)}
          </div>
          <form id="add-table" class="row">
            <input name="name" placeholder="e.g. T9, Parcel or Garden 1" required maxlength="30" aria-label="New table name">
            <button type="submit" class="secondary">Add Table</button>
          </form>
        </div>
        ${feat('rooms') ? html`<div class="card" style="margin-top:${feat('tables') ? 20 : 0}px">
          <h2>Rooms</h2>
          <p class="small" style="margin-top:-6px">Tap a room to change its number, type or nightly rate.</p>
          ${rooms.length ? html`<div class="list" style="box-shadow:none">${rooms.map((r) => html`
            <div class="list-row">
              <button type="button" class="plain grow room-edit" data-edit-room="${r.id}" aria-label="Edit room ${r.number}">
                <strong>${r.number}</strong> <span class="sub">${r.room_type} · ${rs(r.rate).replace('.00', '')}/night</span></button>
              <button type="button" class="destructive" data-del-room="${r.id}" aria-label="Remove room ${r.number}">✕</button>
            </div>`)}</div>` : ''}
          <form id="add-room" class="charge-form" style="margin-top:12px">
            <input name="number" placeholder="Room no." required maxlength="20" aria-label="Room number">
            <input name="room_type" placeholder="Type, e.g. Deluxe AC" maxlength="40" aria-label="Room type">
            <input name="rate" placeholder="₹/night" inputmode="decimal" required aria-label="Rate per night">
            <button type="submit" class="secondary">Add Room</button>
          </form>
        </div>` : ''}
        ${!feat('qr_menu') ? html`<div class="card qr-card qr-off" style="margin-top:20px" id="qr-card">
          <h2>QR Menu</h2>
          <p class="small" style="margin:-6px 0 0">Let customers scan a QR code to see your menu on their phone. This feature isn’t active for your hotel yet.
            Contact Techyverve to switch it on.</p>
        </div>` : html`<div class="card qr-card" style="margin-top:20px" id="qr-card">
          <h2>QR Menu</h2>
          <p class="small" style="margin-top:-6px">Customers scan this code to see your menu on their phone. Sold-out dishes are hidden automatically.</p>
          <div class="qr-box" id="qr-box"><div class="skeleton"><div class="block"></div></div></div>
          <p class="qr-link small" id="qr-link"></p>
          <div class="hotel-actions">
            <button type="button" id="qr-print">${ic('printer')} Print Poster</button>
            <button type="button" class="secondary" id="qr-download">${ic('download')} Download</button>
            <button type="button" class="secondary" id="qr-share">Share Link</button>
            <a class="button secondary" id="qr-open" target="_blank" rel="noopener">Open Menu</a>
            <button type="button" class="secondary danger-outline" id="qr-new">Change Link</button>
          </div>
        </div>`}
        <div class="card" style="margin-top:20px">
          <h2>Staff Logins</h2>
          <p class="small" style="margin-top:-6px"><span class="role-pill r-staff">Waiter</span> adds dishes to tables · <span class="role-pill r-manager">Manager</span> also bills, parcels and payments</p>
          <div class="staff-list">${staff.map((m) => {
            const name = m.display_name || (m.role === 'owner' ? 'Hotel owner' : loginName(m.email));
            const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
            return html`
            <div class="staff-item">
              <span class="avatar r-${m.role}" aria-hidden="true">${initials}</span>
              <div class="staff-main">
                <div class="staff-name"><strong>${name}</strong><span class="role-pill r-${m.role}">${ROLE_NAMES[m.role] ?? m.role}</span></div>
                <div class="staff-id">${m.email.endsWith(STAFF_DOMAIN) ? html`Login ID <code>${loginName(m.email)}</code>` : m.email}</div>
              </div>
              ${isOwner && m.role !== 'owner' ? html`<div class="staff-actions">
                <button type="button" class="mini" data-role-staff="${m.email}" title="${m.role === 'manager' ? 'Make Waiter' : 'Make Manager'}">${ic('swap')} ${m.role === 'manager' ? 'To Waiter' : 'To Manager'}</button>
                <button type="button" class="mini" data-reset-staff="${m.email}">${ic('key')} Password</button>
                <button type="button" class="mini danger" data-del-staff="${m.email}" aria-label="Remove ${name}" title="Remove">${ic('trash')} Remove</button></div>` : ''}
            </div>`;
          })}
          </div>
          ${isOwner ? html`<button type="button" class="wide" id="add-staff" style="margin-top:12px">＋ Add Staff Login</button>` : ''}
        </div>
      </div>
    </div>`);
  root.querySelector('#gst-on').addEventListener('change', (e) => { root.querySelector('#gst-fields').hidden = !e.target.checked; });
  onSubmit(root, '#settings', async (f) => {
    const rate = f.gst_on === 'on' ? toPaise(f.tax_rate) : 0;
    if (f.gst_on === 'on' && rate <= 0) throw new Error('Enter a GST rate, like 5, or turn GST off.');
    if (rate > 10000) throw new Error('GST rate can’t be more than 100%.');
    await q(sb.from('restaurants').update({
      hotel_phone: f.hotel_phone.trim(),
      hotel_gstin: (f.hotel_gstin ?? s.hotel_gstin).trim().toUpperCase(), tax_rate_bp: rate, quick_close: f.quick_close === 'on', kot_tables: f.kot_tables === 'on',
    }).eq('id', s.id));
    getSettings.clear();
    toast('Changes saved');
  });
  onSubmit(root, '#add-table', async (f) => {
    await q(sb.from('dining_tables').insert({ name: f.name.trim(), sort: tables.length + 1 }));
    toast(`Table ${f.name.trim()} added`);
    settingsView(renderToken);
  });
  onSubmit(root, '#add-room', async (f) => {
    await q(sb.from('lodging_rooms').insert({ number: f.number.trim(), room_type: f.room_type.trim() || 'Standard', rate: toPaise(f.rate), sort: rooms.length + 1 }));
    toast(`Room ${f.number.trim()} added`);
    settingsView(renderToken);
  });
  function addStaff() {
    const dialog = document.createElement('dialog');
    dialog.className = 'tall';
    document.body.append(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    setHTML(dialog, html`
      <form class="dialog-body" novalidate>
        <h2 style="margin:0">Add Staff Login</h2>
        <div class="auth-alert error" role="alert" hidden></div>
        <label>Staff name <input name="name" required maxlength="40" autocomplete="off" placeholder="e.g. Ramesh Patil"></label>
        <div class="field">
          <label for="staff-pass">Password</label>
          <div class="password-wrap">
            <input id="staff-pass" name="password" required minlength="6" autocomplete="new-password" value="${newPassword()}" spellcheck="false">
            <button type="button" class="reveal" data-new-pass aria-label="Make a new password">New</button>
          </div>
          <p class="hint">Made for you; you can type your own (6+ characters).</p>
        </div>
        <fieldset class="segmented" style="border:0;margin:0" aria-label="Role">
          <label><input type="radio" name="role" value="staff" checked><span>Waiter</span></label>
          <label><input type="radio" name="role" value="manager"><span>Manager</span></label>
        </fieldset>
        <p class="hint">The Login ID is made automatically and is unique, like <strong>ramesh.nt42</strong>. Waiter only adds dishes to tables; Manager can also print bills, take parcels and payments.</p>
        <button type="submit" class="wide">Create Login</button>
        <button type="button" class="secondary wide" data-cancel>Cancel</button>
      </form>`);
    dialog.querySelector('[data-cancel]').addEventListener('click', close);
    dialog.querySelector('[data-new-pass]').addEventListener('click', () => { dialog.querySelector('[name=password]').value = newPassword(); });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const alertBox = dialog.querySelector('[role=alert]');
      if (!f.name.trim()) { alertBox.textContent = 'Enter the staff member’s name.'; alertBox.hidden = false; return; }
      if (f.password.length < 6) { alertBox.textContent = 'The password needs at least 6 characters.'; alertBox.hidden = false; return; }
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      const { data, error } = await sb.rpc('owner_add_staff', { p_name: f.name, p_password: f.password, p_role: f.role });
      if (error) { btn.disabled = false; alertBox.textContent = friendly(error); alertBox.hidden = false; return; }
      // Show the details once so the owner can pass them on.
      const link = location.origin + location.pathname;
      setHTML(dialog, html`
        <div class="dialog-body">
          <h2 style="margin:0">Login created ✓</h2>
          <p class="hint">Give these to ${esc(f.name.trim())} (${f.role === 'manager' ? 'Manager' : 'Waiter'}). They sign in at the same app link.</p>
          <div class="cred-box">
            <div><span>App</span><strong>${link}</strong></div>
            <div><span>Login ID</span><strong>${loginName(data)}</strong></div>
            <div><span>Password</span><strong>${f.password}</strong></div>
          </div>
          <button type="button" class="wide" id="share-cred">Share / Copy</button>
          <button type="button" class="secondary wide" data-done>Done</button>
        </div>`);
      const text = `Hotel Billing login\nApp: ${link}\nLogin ID: ${loginName(data)}\nPassword: ${f.password}`;
      dialog.querySelector('#share-cred').addEventListener('click', async () => {
        try {
          if (navigator.share) await navigator.share({ text });
          else { await navigator.clipboard.writeText(text); toast('Copied'); }
        } catch { /* cancelled */ }
      });
      dialog.querySelector('[data-done]').addEventListener('click', () => { close(); settingsView(renderToken); });
    });
    dialog.showModal();
    dialog.querySelector('[name=name]').focus();
  }
  root.querySelector('#add-staff')?.addEventListener('click', addStaff);
  if (feat('qr_menu') && isOwner) setupQrCard(root, s);
  // Opened from Menu → QR Menu: jump straight to the card.
  if (location.hash.endsWith('?qr')) setTimeout(() => root.querySelector('#qr-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  function renameTable(table) {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    setHTML(dialog, html`
      <form class="dialog-body" novalidate>
        <h2 style="margin:0">Rename Table</h2>
        <div class="auth-alert error" role="alert" hidden></div>
        <label>Table name <input name="name" value="${table.name}" maxlength="30" required autocomplete="off"></label>
        <p class="hint">Shown on the Tables screen and printed on the bill. Running orders and past bills move with it.</p>
        <button type="submit" class="wide">Save Name</button>
        <button type="button" class="secondary wide" data-cancel>Cancel</button>
      </form>`);
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dialog.querySelector('[data-cancel]').addEventListener('click', close);
    dialog.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = new FormData(e.target).get('name').trim();
      const alertBox = dialog.querySelector('[role=alert]');
      const fail = (m) => { alertBox.textContent = m; alertBox.hidden = false; };
      if (!name) return fail('Enter a name for this table.');
      if (name === table.name) return close();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Saving…';
      const { error } = await sb.from('dining_tables').update({ name }).eq('id', table.id);
      if (error) { btn.disabled = false; btn.textContent = 'Save Name'; return fail(friendly(error)); }
      close();
      toast(`${table.name} renamed to ${name}`);
      settingsView(renderToken);
    });
    dialog.showModal();
    const input = dialog.querySelector('[name=name]');
    input.focus(); input.select();
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'signout') sb.auth.signOut();
    else if (t.dataset.editRoom) {
      const r = rooms.find((x) => x.id === Number(t.dataset.editRoom));
      formDialog({
        title: `Room ${r.number}`,
        submit: 'Save Room',
        fields: [
          { name: 'number', label: 'Room number', value: r.number, attrs: { required: '', maxlength: 20 } },
          { name: 'room_type', label: 'Type', value: r.room_type, attrs: { maxlength: 40 } },
          { name: 'rate', label: 'Rate per night (₹)', value: plain(r.rate), attrs: { inputmode: 'decimal' } },
        ],
        hint: 'Guests already checked in keep the rate they checked in with.',
        async onSave(f) {
          if (!f.number.trim()) throw new Error('Enter a room number.');
          await q(sb.from('lodging_rooms').update({ number: f.number.trim(), room_type: f.room_type.trim() || 'Standard', rate: toPaise(f.rate) }).eq('id', r.id));
          toast(`Room ${f.number.trim()} saved`);
          settingsView(renderToken);
        },
      });
    } else if (t.dataset.delRoom) {
      const r = rooms.find((x) => x.id === Number(t.dataset.delRoom));
      if (!confirm(`Remove room ${r.number}?`)) return;
      act(t, async () => { await q(sb.from('lodging_rooms').delete().eq('id', r.id)); toast(`Room ${r.number} removed`); settingsView(renderToken); });
    } else if (t.dataset.renameTable) renameTable(tables.find((x) => x.id === Number(t.dataset.renameTable)));
    else if (t.dataset.delTable) {
      const name = tables.find((x) => x.id === Number(t.dataset.delTable)).name;
      if (!confirm(`Remove table ${name}?`)) return;
      act(t, async () => { await q(sb.from('dining_tables').delete().eq('id', t.dataset.delTable)); toast(`Table ${name} removed`); settingsView(renderToken); });
    } else if (t.dataset.resetStaff) {
      const who = loginName(t.dataset.resetStaff);
      formDialog({
        title: `New password for ${who}`,
        submit: 'Set Password',
        hint: 'Tell them the new password. Their old one stops working.',
        fields: [{ name: 'password', label: 'New password', attrs: { minlength: 6, required: '', autocomplete: 'new-password' } }],
        async onSave(f) {
          await q(sb.rpc('owner_reset_staff_password', { p_email: t.dataset.resetStaff, p_password: f.password }));
          toast(`Password changed for ${who}`);
        },
      });
    } else if (t.dataset.roleStaff) {
      const m = staff.find((x) => x.email === t.dataset.roleStaff);
      const role = m.role === 'manager' ? 'staff' : 'manager';
      act(t, async () => {
        await q(sb.rpc('owner_set_staff_role', { p_email: m.email, p_role: role }));
        toast(`${loginName(m.email)} is now a ${ROLE_NAMES[role]}`);
        settingsView(renderToken);
      });
    } else if (t.dataset.delStaff) {
      if (!confirm(`Remove ${loginName(t.dataset.delStaff)}? They won’t be able to sign in.`)) return;
      act(t, async () => { await q(sb.from('staff').delete().eq('email', t.dataset.delStaff)); settingsView(renderToken); });
    }
  });
}

// ---------- QR menu (owner) ----------

let qrLib = null;
/** The QR generator is only needed on this card, so it is loaded on first use. */
function loadQr() {
  qrLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.js';
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { qrLib = null; reject(new Error('Couldn’t load the QR maker. Check the internet and try again.')); };
    document.head.append(s);
  });
  return qrLib;
}
const menuUrl = (token) => new URL(`menu.html?m=${encodeURIComponent(token)}`, location.href.split('#')[0]).href;
function qrSvg(qrcode, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

/** Big QR for showing a customer at the table, with share and open. Any staff member can use it. */
async function qrDialog() {
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  setHTML(dialog, html`<div class="dialog-body">
    <h2 style="margin:0" class="with-ic">${ic('qr')} Scan for Menu</h2>
    <div class="qr-box big" id="qr-dlg-box"><div class="skeleton"><div class="block"></div></div></div>
    <p class="hint" style="text-align:center">Customer opens the phone camera and points it at this code.</p>
    <div class="hotel-actions">
      <button type="button" id="qr-dlg-share">Share Link</button>
      <a class="button secondary" id="qr-dlg-open" target="_blank" rel="noopener">Open Menu</a>
    </div>
    <button type="button" class="secondary wide" data-cancel>Close</button>
  </div>`);
  dialog.querySelector('[data-cancel]').addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.showModal();
  const box = dialog.querySelector('#qr-dlg-box');
  try {
    const token = await q(sb.rpc('my_menu_token'));
    if (!token) { box.textContent = 'The QR menu is switched off for this hotel.'; return; }
    const url = menuUrl(token);
    box.innerHTML = qrSvg(await loadQr(), url);
    dialog.querySelector('#qr-dlg-open').href = url;
    dialog.querySelector('#qr-dlg-share').addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ title: `${account.hotel} menu`, url });
        else { await navigator.clipboard.writeText(url); toast('Menu link copied'); }
      } catch { /* cancelled */ }
    });
  } catch (err) { box.textContent = friendly(err); }
}

async function setupQrCard(root, settings) {
  const box = root.querySelector('#qr-box');
  let url = '';
  const show = async (token) => {
    url = menuUrl(token);
    const qrcode = await loadQr();
    box.innerHTML = qrSvg(qrcode, url);
    root.querySelector('#qr-link').textContent = url;
    root.querySelector('#qr-open').href = url;
  };
  try {
    const token = await q(sb.rpc('my_menu_token'));
    if (!token) { box.textContent = 'The QR menu is switched off for this hotel.'; return; }
    await show(token);
  } catch (err) { box.textContent = friendly(err); return; }

  root.querySelector('#qr-print').addEventListener('click', async () => {
    const qrcode = await loadQr();
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print the poster.', 'error');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR Menu · ${esc(settings.hotel_name)}</title>
      <style>@page{size:A5;margin:12mm}body{font:16px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;color:#14161A;margin:0}
      .p{border:3px solid #C2410C;border-radius:24px;padding:28px 20px;max-width:420px;margin:20px auto}
      h1{margin:0 0 4px;font-size:28px}h2{margin:18px 0 6px;color:#C2410C;font-size:22px;letter-spacing:.02em}
      svg{width:260px;height:260px}.s{color:#5B606B;font-size:13px;margin-top:10px}</style></head>
      <body><div class="p"><h1>${esc(settings.hotel_name)}</h1>${settings.hotel_address ? `<div class="s">${esc(settings.hotel_address)}</div>` : ''}
      <h2>📱 Scan to see our menu</h2>${qrSvg(qrcode, url)}<div class="s">Open your phone camera and point it at the code</div></div>
      <script>setTimeout(function(){window.print()},300)<\/script></body></html>`);
    w.document.close();
  });
  root.querySelector('#qr-download').addEventListener('click', async () => {
    // Draw the QR on a white canvas with the hotel name, and save it as a picture.
    const svg = box.querySelector('svg');
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 1140;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 100, 60, 800, 800);
    g.fillStyle = '#14161A'; g.textAlign = 'center';
    g.font = 'bold 54px sans-serif'; g.fillText(settings.hotel_name, 500, 950, 900);
    g.fillStyle = '#C2410C'; g.font = 'bold 40px sans-serif'; g.fillText('Scan to see our menu', 500, 1030, 900);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${settings.hotel_name} QR menu.png`;
    a.click();
  });
  root.querySelector('#qr-share').addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ title: `${settings.hotel_name} menu`, url });
      else { await navigator.clipboard.writeText(url); toast('Menu link copied'); }
    } catch { /* cancelled */ }
  });
  root.querySelector('#qr-new').addEventListener('click', (e) => {
    if (!confirm('Make a new menu link? Printed QR codes with the old link will stop working, so print the new one.')) return;
    act(e.currentTarget, async () => { await show(await q(sb.rpc('owner_new_menu_link'))); toast('New menu link ready. Print the new QR code.'); });
  });
}

// ---------- Rooms (lodging) ----------

/** Bill for a stay: room nights plus any extra charges. */
function stayBill(stay, rate = stay.tax_rate_bp ?? 0) {
  const nights = nightsBetween(stay.check_in, stay.check_out);
  return {
    nights,
    ...computeBill({
      lines: [
        { name: `Room ${stay.lodging_rooms?.number ?? ''} · ${nights} night${nights === 1 ? '' : 's'}`, quantity: nights, unitPrice: stay.rate },
        ...(stay.stay_charges ?? []).map((c) => ({ name: c.description, quantity: c.quantity, unitPrice: c.unit_price })),
      ],
      discount: stay.discount,
      taxRateBp: rate,
    }),
  };
}
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
const shortDate = (day) => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** A small form dialog. fields: [{ name, label, type, value, ...attrs }]. onSave(values) may throw to show an error. */
function formDialog({ title, fields, submit, hint = '', onSave }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'tall';
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  setHTML(dialog, html`
    <form class="dialog-body" novalidate>
      <h2 style="margin:0">${title}</h2>
      <div class="auth-alert error" role="alert" hidden></div>
      ${fields.map((f) => (f.type === 'row' ? html`<div class="row">${f.fields.map(field)}</div>` : field(f)))}
      ${hint ? html`<p class="hint">${hint}</p>` : ''}
      <button type="submit" class="wide">${submit}</button>
      <button type="button" class="secondary wide" data-cancel>Cancel</button>
    </form>`);
  function field(f) {
    return html`<label>${f.label} <input name="${f.name}" type="${f.type ?? 'text'}" value="${f.value ?? ''}"
      ${new Raw(Object.entries(f.attrs ?? {}).map(([k, v]) => `${k}="${esc(v)}"`).join(' '))}></label>`;
  }
  dialog.querySelector('[data-cancel]').addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const alertBox = dialog.querySelector('[role=alert]');
    btn.disabled = true;
    try {
      await onSave(Object.fromEntries(new FormData(e.target)));
      close();
    } catch (err) {
      alertBox.textContent = friendly(err); alertBox.hidden = false;
      btn.disabled = false;
    }
  });
  dialog.showModal();
  dialog.querySelector('input')?.focus();
}

async function roomsView(token) {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const [rooms, open, paidToday] = await Promise.all([
    q(sb.from('lodging_rooms').select('*').order('sort').order('number')),
    q(sb.from('stays').select('*, stay_charges(quantity, unit_price)').eq('status', 'open')),
    q(sb.from('stays').select('*, stay_charges(quantity, unit_price)').eq('status', 'paid').gte('closed_at', dayStart.toISOString())),
  ]);
  if (token !== renderToken) return;
  const byRoom = Object.fromEntries(open.map((st) => [st.room_id, st]));
  const today = localDay();
  const sales = paidToday.reduce((sum, st) => sum + stayBill(st).total, 0);
  const leaving = open.filter((st) => st.check_out <= today).length;
  const root = mount(html`
    <div class="page-head"><div><p class="eyebrow">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Rooms</h1></div>
      ${account.role === 'owner' ? '' : html`<button type="button" class="secondary" id="signout-rooms">Sign Out</button>`}</div>
    <section class="hero" aria-label="Rooms today">
      <span class="label">Room sales today</span>
      <span class="big">${rs(sales)}</span>
      <div class="facts">
        <div class="fact"><strong>${open.length}</strong><span>Occupied</span></div>
        <div class="fact"><strong>${rooms.length - open.length}</strong><span>Free</span></div>
        <div class="fact"><strong>${leaving}</strong><span>Checking out</span></div>
      </div>
    </section>
    ${rooms.length ? '' : html`<div class="card empty"><span class="emoji" aria-hidden="true">🛏️</span>No rooms yet. <a href="#/settings">Add rooms in Settings</a>.</div>`}
    <div class="tables">
      ${rooms.map((r) => {
        const st = byRoom[r.id];
        if (!st) return html`<button type="button" class="table-tile free" data-checkin="${r.id}" aria-label="Room ${r.number}, free, check in a guest">
          <span class="tile-top"><span class="name">${r.number}</span><span class="pill">Free</span></span>
          <span class="state">${r.room_type} · ${rs(r.rate).replace('.00', '')}/night</span>
          <span class="tap">Tap to check in</span></button>`;
        const due = st.check_out <= today;
        return html`<a class="table-tile ${due ? 'billed' : 'busy'}" href="#/stay/${st.id}" aria-label="Room ${r.number}, ${st.guest_name}${due ? ', checking out today' : ''}">
          <span class="tile-top"><span class="name">${r.number}</span><span class="pill">${due ? 'Check-out' : 'Occupied'}</span></span>
          <span><span class="amount">${rs(stayBill(st, 0).total)}</span>
          <span class="state">${st.guest_name} · till ${shortDate(st.check_out)}</span></span></a>`;
      })}
    </div>`);
  root.querySelector('#signout-rooms')?.addEventListener('click', () => sb.auth.signOut());
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-checkin]');
    if (t) checkIn(rooms.find((r) => r.id === Number(t.dataset.checkin)));
  });
}

function checkIn(room) {
  const today = localDay();
  formDialog({
    title: `Check In · Room ${room.number}`,
    submit: 'Check In',
    fields: [
      { name: 'guest_name', label: 'Guest name', attrs: { required: '', maxlength: 80, autocomplete: 'off' } },
      { type: 'row', fields: [
        { name: 'guest_phone', label: 'Phone', type: 'tel', attrs: { maxlength: 20 } },
        { name: 'guests', label: 'Guests', value: 1, attrs: { inputmode: 'numeric' } },
      ] },
      { type: 'row', fields: [
        { name: 'check_in', label: 'Check-in', type: 'date', value: today },
        { name: 'check_out', label: 'Check-out', type: 'date', value: addDays(today, 1) },
      ] },
      { name: 'rate', label: 'Rate per night (₹)', value: plain(room.rate), attrs: { inputmode: 'decimal' } },
    ],
    async onSave(f) {
      if (!f.guest_name.trim()) throw new Error('Enter the guest’s name.');
      if (!f.check_in || !f.check_out || f.check_out < f.check_in) throw new Error('Check-out can’t be before check-in.');
      const guests = Number(f.guests || 1);
      if (!Number.isInteger(guests) || guests < 1) throw new Error('Guests must be 1 or more.');
      const stay = await q(sb.from('stays').insert({
        room_id: room.id, guest_name: f.guest_name.trim(), guest_phone: f.guest_phone.trim(), guests,
        check_in: f.check_in, check_out: f.check_out, rate: toPaise(f.rate),
      }).select('id').single());
      toast(`${f.guest_name.trim()} checked in to Room ${room.number}`);
      location.hash = `#/stay/${stay.id}`;
    },
  });
}

async function stayView(token, stayId, autoPrint) {
  const [stay, settings] = await Promise.all([
    q(sb.from('stays').select('*, lodging_rooms(number, room_type), stay_charges(*)').eq('id', stayId).order('id', { referencedTable: 'stay_charges' }).single()),
    getSettings(),
  ]);
  if (token !== renderToken) return;
  const paid = stay.status === 'paid';
  const rate = paid ? stay.tax_rate_bp ?? 0 : settings.tax_rate_bp;
  const b = stayBill(stay, rate);
  const kv = (k, v, cls = '') => html`<div class="kv ${cls}"><span>${k}</span><span>${v}</span></div>`;
  const receipt = html`
    <article class="receipt" aria-label="Room bill">
      <div class="center">
        <div class="shop">${settings.hotel_name}</div>
        ${settings.hotel_address ? html`<div>${settings.hotel_address}</div>` : ''}
        ${settings.hotel_phone ? html`<div>Ph: ${settings.hotel_phone}</div>` : ''}
        ${settings.hotel_gstin && rate > 0 ? html`<div>GSTIN: ${settings.hotel_gstin}</div>` : ''}
      </div>
      <div class="rule"></div>
      ${kv(stay.bill_no ? `Bill: ${stay.bill_no}` : 'Room bill', `Room: ${stay.lodging_rooms.number}`)}
      ${kv(`Guest: ${stay.guest_name}`, stay.guest_phone)}
      ${kv(`${shortDate(stay.check_in)} → ${shortDate(stay.check_out)}`, `${b.nights} night${b.nights === 1 ? '' : 's'}`)}
      <div class="rule"></div>
      <table>
        <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amt</th></tr></thead>
        <tbody>${b.lines.map((l) => html`
          <tr><td>${l.name}<br><small>@ ${fmt(l.unitPrice)}</small></td><td class="r">${l.quantity}</td><td class="r">${fmt(l.unitPrice * l.quantity)}</td></tr>`)}
        </tbody>
      </table>
      <div class="rule"></div>
      ${kv('Subtotal', fmt(b.subtotal))}
      ${b.discount ? kv('Discount', `-${fmt(b.discount)}`) : ''}
      ${b.tax ? [kv(`CGST @ ${pct(rate / 2)}`, fmt(b.cgst)), kv(`SGST @ ${pct(rate / 2)}`, fmt(b.sgst))] : ''}
      ${b.roundOff ? kv('Round off', fmt(b.roundOff)) : ''}
      <div class="rule"></div>
      ${kv('TOTAL', rs(b.total), 'grand')}
      ${paid ? kv(dateTime(stay.closed_at), stay.payment_method) : ''}
      <div class="rule"></div>
      <div class="center">Thank you for staying with us!</div>
    </article>`;

  if (paid) {
    setHTML($view, html`
      <div class="receipt-wrap">
        <div class="receipt-actions no-print">
          <a class="button secondary" href="#/rooms">Rooms</a>
          <a class="button secondary" href="#/bills">All Bills</a>
          <button type="button" class="secondary" id="print">Print</button>
        </div>
        <p class="paid-note no-print">Paid by ${stay.payment_method} · ${dateTime(stay.closed_at)}</p>
        ${receipt}
      </div>`);
    document.getElementById('print').addEventListener('click', (e) => {
      if (!directPrinting()) return window.print();
      act(e.currentTarget, async () => { await printSlips(staySlips(stay, settings), { pick: true }); toast(`Printed ${stay.bill_no}`); });
    });
    if (autoPrint) {
      window.history.replaceState(null, '', `#/stay/${stay.id}`);
      setTimeout(() => window.print(), 300);
    }
    return;
  }

  const root = mount(html`
    <div class="page-head no-print">
      <div><p class="eyebrow"><a href="#/rooms">‹ Rooms</a></p><h1>Room ${stay.lodging_rooms.number}</h1>
        <p class="muted">${stay.guest_name}${stay.guest_phone ? ` · ${stay.guest_phone}` : ''} · ${stay.guests} guest${stay.guests === 1 ? '' : 's'}</p></div>
    </div>
    <div class="two-col">
      <div class="no-print">
        <form class="card form" id="stay-dates">
          <h2 style="margin:0">Stay</h2>
          <div class="row">
            <label>Check-in <input type="date" name="check_in" value="${stay.check_in}"></label>
            <label>Check-out <input type="date" name="check_out" value="${stay.check_out}" min="${stay.check_in}"></label>
          </div>
          <div class="row">
            <label>Rate per night (₹) <input name="rate" inputmode="decimal" value="${plain(stay.rate)}"></label>
            <label>Discount (₹) <input name="discount" inputmode="decimal" value="${stay.discount ? plain(stay.discount) : ''}" placeholder="0"></label>
          </div>
          <button type="submit" class="secondary">Save Stay</button>
        </form>
        <div class="card" style="margin-top:20px">
          <h2>Extra Charges</h2>
          <p class="small" style="margin-top:-6px">Food, laundry, extra bed — anything to add to this room’s bill.</p>
          ${stay.stay_charges.length ? html`<div class="list" style="box-shadow:none">${stay.stay_charges.map((c) => html`
            <div class="list-row"><span class="grow">${c.description}<div class="sub">${c.quantity} × ${rs(c.unit_price)}</div></span>
              <span class="money">${rs(c.quantity * c.unit_price)}</span>
              <button type="button" class="destructive" data-del-charge="${c.id}" aria-label="Remove ${c.description}">✕</button></div>`)}</div>` : ''}
          <form id="add-charge" class="charge-form">
            <input name="description" placeholder="e.g. Breakfast" required maxlength="80" aria-label="Charge description" autocomplete="off">
            <input name="quantity" value="1" inputmode="numeric" aria-label="Quantity">
            <input name="price" placeholder="₹" inputmode="decimal" required aria-label="Price each">
            <button type="submit" class="secondary">Add</button>
          </form>
        </div>
      </div>
      <div>
        ${receipt}
        <div class="receipt-actions no-print" style="margin-top:16px">
          <button type="button" class="secondary danger-outline" id="cancel-stay">Cancel Check-in</button>
          <button type="button" class="secondary" id="print">Print</button>
          <button type="button" id="checkout">Check Out · ${rs(b.total)}</button>
        </div>
      </div>
    </div>`);
  onSubmit(root, '#stay-dates', async (f) => {
    if (!f.check_out || f.check_out < f.check_in) throw new Error('Check-out can’t be before check-in.');
    await q(sb.from('stays').update({ check_in: f.check_in, check_out: f.check_out, rate: toPaise(f.rate), discount: toPaise(f.discount) }).eq('id', stay.id));
    toast('Stay saved');
    stayView(renderToken, stayId);
  });
  onSubmit(root, '#add-charge', async (f, form) => {
    const quantity = Number(f.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be 1 or more.');
    await q(sb.from('stay_charges').insert({ stay_id: stay.id, description: f.description.trim(), quantity, unit_price: toPaise(f.price) }));
    form.reset();
    stayView(renderToken, stayId);
  });
  document.getElementById('print').addEventListener('click', (e) => {
    if (!directPrinting()) return window.print();
    act(e.currentTarget, async () => { await printSlips(staySlips(stay, settings), { pick: true }); toast('Printed'); });
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.delCharge) {
      act(t, async () => { await q(sb.from('stay_charges').delete().eq('id', t.dataset.delCharge)); stayView(renderToken, stayId); });
    } else if (t.id === 'cancel-stay') {
      if (!confirm(`Cancel ${stay.guest_name}’s check-in? Room ${stay.lodging_rooms.number} becomes free and nothing is billed.`)) return;
      act(t, async () => { await q(sb.from('stays').delete().eq('id', stay.id)); toast('Check-in cancelled'); location.hash = '#/rooms'; });
    } else if (t.id === 'checkout') {
      checkOut(stay, b.total);
    }
  });
}

function checkOut(stay, total) {
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  setHTML(dialog, html`
    <form class="dialog-body">
      <h2 style="margin:0">Check Out · Room ${stay.lodging_rooms.number}</h2>
      <div class="auth-alert error" role="alert" hidden></div>
      <div class="due"><span class="muted">Amount to collect</span><span class="money">${rs(total)}</span></div>
      <fieldset class="segmented" style="border:0;margin:0" aria-label="Payment method">
        ${METHODS.map((m, i) => html`<label><input type="radio" name="method" value="${m}" ${i === 0 ? new Raw('checked') : ''}><span>${m}</span></label>`)}
      </fieldset>
      <button type="submit" class="wide">Mark as Paid</button>
      <button type="button" class="secondary wide" data-cancel>Cancel</button>
    </form>`);
  dialog.querySelector('[data-cancel]').addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const method = new FormData(e.target).get('method');
    btn.disabled = true; btn.textContent = 'Saving…';
    const { error } = await sb.rpc('checkout_stay', { p_stay_id: stay.id, p_method: method });
    if (error) {
      btn.disabled = false; btn.textContent = 'Mark as Paid';
      const box = dialog.querySelector('[role=alert]');
      box.textContent = friendly(error); box.hidden = false;
      return;
    }
    close();
    toast(`Room ${stay.lodging_rooms.number} checked out · ${method} · ${rs(total)}`);
    route();
  });
  dialog.showModal();
}

// ---------- Super admin: every hotel, its features, pause and delete ----------

const FEATURES = [
  ['tables', 'Tables & Orders', 'Table-wise orders, menu and food bills'],
  ['rooms', 'Rooms', 'Room check-in, extra charges and room bills'],
  ['trending', 'Analytics', 'Sales for any dates, busy hours, best-selling dishes'],
  ['bill_edit', 'Edit Bills', 'Owner can edit or delete paid bills, with a change log'],
  ['qr_menu', 'QR Menu', 'Customers scan a QR code to see the menu on their phone'],
];
let adminSearch = '';

// ---- Backups: one folder per hotel on this computer ----

const BACKUP_DB = 'hb-backup';
/** Remember the chosen backup folder between visits (IndexedDB can store folder handles). */
function folderStore(mode, value) {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(BACKUP_DB, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('kv', mode === 'get' ? 'readonly' : 'readwrite');
        const st = tx.objectStore('kv');
        const r = mode === 'get' ? st.get('folder') : st.put(value, 'folder');
        r.onsuccess = () => resolve(mode === 'get' ? r.result ?? null : value);
        r.onerror = () => resolve(null);
      } catch { resolve(null); } // can't remember the folder: it will simply be asked for next time
    };
  });
}
async function backupFolder(choose = false) {
  let dir = choose ? null : await folderStore('get');
  if (dir && (await dir.requestPermission?.({ mode: 'readwrite' })) !== 'granted') dir = null;
  if (!dir) {
    dir = await window.showDirectoryPicker({ id: 'hotel-backups', mode: 'readwrite' });
    await folderStore('put', dir);
  }
  return dir;
}
const safeName = (t) => String(t).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Hotel';
const rupees = (p) => (Number(p ?? 0) / 100).toFixed(2);
function csv(rows) {
  const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
async function writeFile(dir, path, text) {
  const parts = path.split('/');
  let d = dir;
  for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
  const fh = await d.getFileHandle(parts.at(-1), { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
async function readJson(dir, name) {
  try { return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()); } catch { return null; }
}
const monthOf = (iso) => new Date(iso).toLocaleDateString('en-CA').slice(0, 7);
function byMonth(list, key) {
  const m = {};
  for (const x of list) (m[monthOf(x[key])] ??= []).push(x);
  return m;
}

/** Back up one hotel into <folder>/<Hotel name (#id)>/. Only months since the last backup are fetched again. */
async function backupHotel(root, h) {
  const dir = await root.getDirectoryHandle(`${safeName(h.name)} (#${h.id})`, { create: true });
  const info = await readJson(dir, 'backup-info.json');
  // Re-fetch from the start of the month of the last backup, so that month's files are complete.
  const since = info?.last_backup_at ? new Date(new Date(info.last_backup_at).setDate(1)) : null;
  if (since) since.setHours(0, 0, 0, 0);
  const data = await q(sb.rpc('sa_export_hotel', { p_id: h.id, p_since: since?.toISOString() ?? null }));
  await writeFile(dir, 'hotel.json', JSON.stringify(data.hotel, null, 2));
  await writeFile(dir, 'menu.csv', csv([['Dish', 'Category', 'Price', 'Veg', 'Available', 'Favourite'],
    ...data.menu.map((m) => [m.name, m.category, rupees(m.price), m.veg ? 'Yes' : 'No', m.available ? 'Yes' : 'No', m.favourite ? 'Yes' : 'No'])]));
  await writeFile(dir, 'staff.csv', csv([['Login', 'Role', 'Added'], ...data.staff.map((x) => [loginName(x.login), ROLE_NAMES[x.role] ?? x.role, x.added])]));
  await writeFile(dir, 'tables.csv', csv([['Table'], ...data.tables.map((t) => [t.name])]));
  if (data.rooms.length) await writeFile(dir, 'rooms.csv', csv([['Room', 'Type', 'Rate'], ...data.rooms.map((r) => [r.number, r.type, rupees(r.rate)])]));
  const bills = byMonth(data.bills, 'closed_at');
  for (const [month, list] of Object.entries(bills)) {
    await writeFile(dir, `bills/${month}.csv`, csv([['Bill No', 'Date', 'Time', 'Table', 'Payment', 'Items', 'Discount', 'GST %', 'Total', 'Edited'],
      ...list.map((b) => [b.bill_no, new Date(b.closed_at).toLocaleDateString('en-IN'), new Date(b.closed_at).toLocaleTimeString('en-IN'), b.label, b.method,
        (b.items ?? []).map((i) => `${i.qty} x ${i.name} @ ${rupees(i.price)}`).join('; '), rupees(b.discount), (b.tax_rate_bp ?? 0) / 100, rupees(b.total), b.edits || ''])]));
    await writeFile(dir, `bills/${month}.json`, JSON.stringify(list, null, 1));
  }
  const stays = byMonth(data.room_bills, 'closed_at');
  for (const [month, list] of Object.entries(stays)) {
    await writeFile(dir, `room-bills/${month}.csv`, csv([['Bill No', 'Room', 'Guest', 'Phone', 'Check-in', 'Check-out', 'Rate', 'Extras', 'Discount', 'Payment', 'Total'],
      ...list.map((x) => [x.bill_no, x.room, x.guest, x.phone, x.check_in, x.check_out, rupees(x.rate),
        (x.charges ?? []).map((c) => `${c.qty} x ${c.name} @ ${rupees(c.price)}`).join('; '), rupees(x.discount), x.method, rupees(x.total)])]));
  }
  const logs = byMonth(data.change_log, 'created_at');
  for (const [month, list] of Object.entries(logs)) await writeFile(dir, `change-log/${month}.json`, JSON.stringify(list, null, 1));
  await writeFile(dir, 'backup-info.json', JSON.stringify({ hotel: h.name, id: h.id, last_backup_at: data.exported_at,
    note: 'bills/ and room-bills/ have one file per month. Open the .csv files in Excel or Google Sheets.' }, null, 2));
  return data.bills.length + data.room_bills.length;
}

/** Phones and other browsers can't write to folders: download one file per hotel instead. */
async function downloadHotel(h) {
  const data = await q(sb.rpc('sa_export_hotel', { p_id: h.id, p_since: null }));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `${safeName(h.name)} backup ${localDay()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function runBackup(hotels, chooseFolder) {
  if (!window.showDirectoryPicker) {
    for (const h of hotels) await downloadHotel(h);
    toast(`Downloaded ${hotels.length} backup file${hotels.length === 1 ? '' : 's'}. For folder backups use Chrome on a computer.`);
    return;
  }
  const root = await backupFolder(chooseFolder);
  let n = 0;
  for (const h of hotels) { toast(`Backing up ${h.name}…`); n += await backupHotel(root, h); }
  const when = new Date().toISOString();
  try { localStorage.setItem('hb-last-backup', when); } catch { /* private mode */ }
  toast(`Backup done · ${hotels.length} hotel${hotels.length === 1 ? '' : 's'} · ${n} bills saved to “${root.name}”`);
}

async function adminView(token) {
  const [hotels, usage] = await Promise.all([
    q(sb.rpc('sa_list_hotels')),
    q(sb.rpc('sa_usage')).catch(() => null),
  ]);
  if (token !== renderToken) return;
  let lastBackup = null;
  try { lastBackup = localStorage.getItem('hb-last-backup'); } catch { /* private mode */ }
  const usedPct = usage ? Math.min(100, (Number(usage.db_bytes) / Number(usage.limit_bytes)) * 100) : 0;
  const level = usedPct >= 90 ? 'danger' : usedPct >= 70 ? 'warn' : 'ok';
  const mb = (b) => `${(Number(b) / 1024 / 1024).toFixed(1)} MB`;
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const active = hotels.filter((h) => h.active).length;
  const sales = hotels.reduce((s, h) => s + Number(h.sales_today), 0);
  const needle = adminSearch.trim().toLowerCase();
  const shown = hotels.filter((h) => !needle || [h.name, h.address, h.phone, ...h.owners].join(' ').toLowerCase().includes(needle));
  const root = mount(html`
    <div class="page-head">
      <div><p class="eyebrow">Techyverve · Super Admin</p><h1>Hotels</h1><p class="muted">${session.user.email}</p></div>
      <div class="head-actions">
        <button type="button" class="secondary" data-install hidden>${ic('install')} Install App</button>
        <button type="button" class="secondary" id="sa-signout">Sign Out</button>
        <button type="button" id="new-hotel">＋ New Hotel</button>
      </div>
    </div>
    <section class="hero" aria-label="All hotels today">
      <span class="label">Sales today · all hotels</span>
      <span class="big">${rs(sales)}</span>
      <div class="facts">
        <div class="fact"><strong>${hotels.length}</strong><span>Hotels</span></div>
        <div class="fact"><strong>${active}</strong><span>Active</span></div>
        <div class="fact"><strong>${hotels.length - active}</strong><span>Paused</span></div>
      </div>
    </section>
    ${hotels.length > 3 ? html`<label class="admin-search"><span class="sr-only">Search hotels</span>
      <input type="search" id="hotel-search" placeholder="Search by hotel, phone or owner email" value="${adminSearch}" autocomplete="off"></label>` : ''}
    ${usage ? html`<section class="card usage-card ${level}" aria-label="Database space">
      <div class="usage-top"><span><strong>Database space</strong><span class="small"> · Free plan 500 MB</span></span>
        <strong>${usedPct < 1 ? '<1' : Math.round(usedPct)}% used</strong></div>
      <div class="usage-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(usedPct)}" aria-label="Database space used"><span style="width:${Math.max(usedPct, 1)}%"></span></div>
      <p class="small" style="margin:0">${mb(usage.db_bytes)} of ${mb(usage.limit_bytes)} · ${usage.bills} bills stored.
        ${level === 'danger' ? html`<strong>Almost full: upgrade Supabase to Pro now so bills keep saving.</strong>`
          : level === 'warn' ? html`<strong>Getting full: plan the upgrade to Supabase Pro ($25/month).</strong>` : 'Plenty of space.'}
        Data transfer limits are on the <a href="https://supabase.com/dashboard/project/${projectRef}/usage" target="_blank" rel="noopener">Supabase usage page</a>.</p>
    </section>` : ''}
    <section class="card backup-card" aria-label="Backups">
      <div class="usage-top"><span><strong>Backups</strong><span class="small"> · ${lastBackup ? `last on this computer ${dateTime(lastBackup)}` : 'none on this computer yet'}</span></span></div>
      <p class="small" style="margin:0">Saves every hotel into its own folder: menu, staff, and bills month by month (Excel files). Later backups only fetch what’s new.</p>
      <div class="hotel-actions">
        <button type="button" id="backup-all">${ic('download')} Back Up All Hotels</button>
        ${window.showDirectoryPicker ? html`<button type="button" class="secondary" id="backup-choose">Change Folder</button>` : ''}
      </div>
    </section>
    <div class="hotel-list">
      ${shown.map((h) => html`
        <article class="card hotel-card ${h.active ? '' : 'paused'}" aria-label="${h.name}">
          <div class="hotel-top">
            <div class="grow"><h2>${h.name}</h2>
              <p class="small">${[h.address, h.phone].filter(Boolean).join(' · ') || 'No address yet'}</p></div>
            <span class="status-pill ${h.active ? 'on' : 'off'}">${h.active ? 'Active' : 'Paused'}</span>
          </div>
          ${!h.active && h.paused_reason ? html`<p class="pause-reason">Paused: “${h.paused_reason}”</p>` : ''}
          <div class="hotel-stats">
            <div><strong>${rs(Number(h.sales_today)).replace('.00', '')}</strong><span>Today</span></div>
            <div><strong>${h.bills}</strong><span>Bills</span></div>
            <div><strong>${h.tables}</strong><span>Tables</span></div>
            <div><strong>${h.rooms}</strong><span>Rooms</span></div>
            <div><strong>${h.menu_items}</strong><span>Dishes</span></div>
            <div><strong>${h.staff_count}</strong><span>Logins</span></div>
          </div>
          <div class="feature-chips" aria-label="Features">
            ${FEATURES.map(([k, label]) => html`<span class="feature-chip ${h.features[k] ? 'on' : ''}">${h.features[k] ? '✓' : '✕'} ${label}</span>`)}
          </div>
          <p class="small hotel-meta">Owner: ${h.owners.join(', ') || '—'}<br>
            Last bill: ${h.last_bill_at ? dateTime(h.last_bill_at) : 'none yet'} · Since ${new Date(h.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <div class="hotel-actions">
            <button type="button" class="secondary" data-edit="${h.id}">Edit & Features</button>
            <button type="button" class="secondary" data-reset="${h.id}">Reset Password</button>
            ${h.active ? html`<button type="button" class="secondary" data-pause="${h.id}">Pause Service</button>`
                       : html`<button type="button" data-resume="${h.id}">Resume Service</button>`}
            <button type="button" class="secondary" data-backup="${h.id}">Back Up</button>
            <button type="button" class="secondary danger-outline" data-delete="${h.id}">Delete</button>
          </div>
        </article>`)}
    </div>
    ${hotels.length && !shown.length ? html`<div class="card empty">No hotel matches “${adminSearch}”.</div>` : ''}
    ${hotels.length ? '' : html`<div class="card empty"><span class="emoji" aria-hidden="true">🏨</span>No hotels yet. Tap New Hotel to add the first one.</div>`}`);

  const byId = (id) => hotels.find((h) => h.id === Number(id));
  const reload = () => adminView(renderToken);
  root.querySelector('#hotel-search')?.addEventListener('input', (e) => {
    adminSearch = e.target.value;
    const pos = e.target.selectionStart;
    adminView(renderToken).then(() => { const i = document.getElementById('hotel-search'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } });
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'sa-signout') sb.auth.signOut();
    else if (t.id === 'backup-all' || t.id === 'backup-choose') act(t, () => runBackup(hotels, t.id === 'backup-choose').then(reload));
    else if (t.dataset.backup) act(t, () => runBackup([byId(t.dataset.backup)], false));
    else if (t.id === 'new-hotel') hotelDialog(null, reload);
    else if (t.dataset.edit) hotelDialog(byId(t.dataset.edit), reload);
    else if (t.dataset.reset) {
      const h = byId(t.dataset.reset);
      formDialog({
        title: `Reset Password · ${h.name}`,
        submit: 'Set New Password',
        hint: 'Tell the owner their new password. They can sign in with it straight away.',
        fields: [
          { name: 'email', label: 'Login email', type: 'email', value: h.owners[0] ?? '', attrs: { required: '' } },
          { name: 'password', label: 'New password', value: '', attrs: { minlength: 6, required: '', autocomplete: 'new-password' } },
        ],
        async onSave(f) {
          await q(sb.rpc('sa_reset_password', { p_id: h.id, p_email: f.email, p_password: f.password }));
          toast(`Password changed for ${f.email.trim()}`);
        },
      });
    } else if (t.dataset.pause) {
      const h = byId(t.dataset.pause);
      formDialog({
        title: `Pause ${h.name}?`,
        submit: 'Pause Service',
        hint: 'Everyone at this hotel is locked out until you resume. Their data stays safe. They will see the reason below.',
        fields: [{ name: 'reason', label: 'Reason (shown to the hotel)', value: '', attrs: { placeholder: 'e.g. Subscription payment pending', maxlength: 200 } }],
        async onSave(f) {
          await q(sb.rpc('sa_set_active', { p_id: h.id, p_active: false, p_reason: f.reason }));
          toast(`${h.name} paused`);
          reload();
        },
      });
    } else if (t.dataset.resume) {
      const h = byId(t.dataset.resume);
      act(t, async () => {
        await q(sb.rpc('sa_set_active', { p_id: h.id, p_active: true, p_reason: '' }));
        toast(`${h.name} is active again`);
        reload();
      });
    } else if (t.dataset.delete) {
      const h = byId(t.dataset.delete);
      formDialog({
        title: `Delete ${h.name}?`,
        submit: 'Delete Hotel Forever',
        hint: `This permanently removes the hotel, its ${h.bills} bills, menu, tables, rooms and every login. It can’t be undone. To only stop it for a while, use Pause Service instead.`,
        fields: [{ name: 'confirm', label: `Type ${h.name} to confirm`, value: '', attrs: { autocomplete: 'off', required: '' } }],
        async onSave(f) {
          if (f.confirm.trim() !== h.name.trim()) throw new Error(`Type the name exactly: ${h.name}`);
          await q(sb.rpc('sa_delete_hotel', { p_id: h.id, p_confirm_name: f.confirm }));
          toast(`${h.name} deleted`);
          reload();
        },
      });
      document.querySelector('dialog [type=submit]')?.classList.add('danger-fill');
    }
  });
}

/** Create a hotel (with its owner login) or edit one. */
function hotelDialog(hotel, done) {
  const creating = !hotel;
  const f = hotel?.features ?? { tables: true, rooms: false, trending: true, bill_edit: true, qr_menu: false };
  const dialog = document.createElement('dialog');
  dialog.className = 'tall';
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  setHTML(dialog, html`
    <form class="dialog-body" novalidate>
      <h2 style="margin:0">${creating ? 'New Hotel' : `Edit ${hotel.name}`}</h2>
      <div class="auth-alert error" role="alert" hidden></div>
      <label>Hotel name <input name="name" value="${hotel?.name ?? ''}" required maxlength="80" autocomplete="off"></label>
      <div class="row">
        <label>Phone <input name="phone" type="tel" value="${hotel?.phone ?? ''}" maxlength="20"></label>
        <label>Address <input name="address" value="${hotel?.address ?? ''}" maxlength="160"></label>
      </div>
      <fieldset class="feature-picks">
        <legend>What this hotel can use</legend>
        ${FEATURES.map(([k, label, desc]) => html`
          <label class="feature-pick"><input type="checkbox" name="feat_${k}" ${f[k] ? new Raw('checked') : ''}>
            <span><strong>${label}</strong><span class="small">${desc}</span></span></label>`)}
      </fieldset>
      ${creating ? html`
        <div class="row">
          <label>Tables to start with <input name="tables" inputmode="numeric" value="10"></label>
          <label>Rooms to start with <input name="rooms" inputmode="numeric" value="0"></label>
        </div>
        <h3 style="margin:4px 0 0">Owner login</h3>
        <label>Owner email <input name="email" type="email" required autocomplete="off" placeholder="owner@hotel.com"></label>
        <label>Owner password <input name="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></label>
        <p class="hint">The owner signs in with this email and password. They can add their own staff in Settings.</p>` : ''}
      <button type="submit" class="wide">${creating ? 'Create Hotel' : 'Save Changes'}</button>
      <button type="button" class="secondary wide" data-cancel>Cancel</button>
    </form>`);
  dialog.querySelector('[data-cancel]').addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // Rooms to start with only matters when Rooms is ticked.
  const roomsField = dialog.querySelector('[name=rooms]');
  const syncRooms = () => {
    if (!roomsField) return;
    const on = dialog.querySelector('[name=feat_rooms]').checked;
    roomsField.closest('label').hidden = !on;
    if (on && roomsField.value === '0') roomsField.value = '10';
  };
  dialog.querySelector('[name=feat_rooms]').addEventListener('change', syncRooms);
  syncRooms();
  dialog.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    const alertBox = dialog.querySelector('[role=alert]');
    const fail = (m) => { alertBox.textContent = m; alertBox.hidden = false; alertBox.scrollIntoView({ block: 'nearest' }); };
    // The QR menu has its own switch; the other features go with the hotel's details.
    const flags = Object.fromEntries(FEATURES.filter(([k]) => k !== 'qr_menu').map(([k]) => [`p_feat_${k}`, v[`feat_${k}`] === 'on']));
    const qrOn = v.feat_qr_menu === 'on';
    if (!v.name.trim()) return fail('Enter the hotel name.');
    if (!flags.p_feat_tables && !flags.p_feat_rooms) return fail('Tick Tables & Orders, Rooms, or both.');
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (creating) {
        const count = (x) => { const n = Number(x || 0); if (!Number.isInteger(n) || n < 0) throw new Error('Tables and rooms must be whole numbers.'); return n; };
        if (!/^[^@\s]+@[^@\s]+$/.test(v.email.trim())) throw new Error('Enter the owner’s email.');
        if (v.password.length < 6) throw new Error('The owner’s password needs at least 6 characters.');
        const id = await q(sb.rpc('sa_create_hotel', {
          p_name: v.name, p_address: v.address, p_phone: v.phone, p_owner_email: v.email, p_owner_password: v.password,
          p_tables: flags.p_feat_tables ? count(v.tables) : 0, p_rooms: flags.p_feat_rooms ? count(v.rooms) : 0, ...flags,
        }));
        if (qrOn) await q(sb.rpc('sa_set_qr_menu', { p_id: id, p_on: true }));
        toast(`${v.name.trim()} created · owner can sign in now`);
      } else {
        await q(sb.rpc('sa_update_hotel', { p_id: hotel.id, p_name: v.name, p_address: v.address, p_phone: v.phone, ...flags }));
        if (qrOn !== Boolean(hotel.features.qr_menu)) await q(sb.rpc('sa_set_qr_menu', { p_id: hotel.id, p_on: qrOn }));
        toast(`${v.name.trim()} saved`);
      }
      close();
      done();
    } catch (err) {
      btn.disabled = false;
      fail(friendly(err));
    }
  });
  dialog.showModal();
}

// ---------- routing ----------

// [pattern, view, tab, feature needed (or null), who may open it: any | bill (owner, manager) | owner]
const routes = [
  [/^\/?$/, tablesView, 'tables', 'tables', 'any'],
  [/^\/table\/(\d+)(?:\/([A-Z]))?$/, tableView, 'tables', 'tables', 'any'],
  [/^\/parcel(?:\/(\d+))?$/, parcelView, 'tables', 'tables', 'bill'],
  [/^\/bill\/(\d+)(\/print)?$/, billView, 'tables', null, 'bill'],
  [/^\/rooms$/, roomsView, 'rooms', 'rooms', 'bill'],
  [/^\/stay\/(\d+)(\/print)?$/, stayView, 'rooms', 'rooms', 'bill'],
  [/^\/bills\/log$/, logView, 'bills', 'bill_edit', 'owner'],
  [/^\/bills(?:\/(\d{4}-\d{2}-\d{2}))?$/, billsView, 'bills', null, 'bill'],
  [/^\/(?:analytics|trending)$/, analyticsView, 'trending', 'trending', 'bill'],
  [/^\/menu$/, menuView, 'menu', 'tables', 'owner'],
  [/^\/settings(\?qr)?$/, settingsView, 'settings', null, 'any'],
];
const allowed = (who) => who === 'any' || (who === 'bill' ? account.can_bill === true : account.role === 'owner');
const adminRoutes = [
  [/^\/admin$/, adminView, 'admin', null, 'any'],
];

/** Full-screen notice shown instead of the app (no access yet, hotel paused, …). */
function blockedScreen({ iconName = 'lock', title, body, retry = true }) {
  const { root } = authScreen({
    iconName, title, subtitle: '',
    body: html`${body}
      ${retry ? html`<button type="button" class="wide" id="retry">Try Again</button>` : ''}
      <button type="button" class="wide secondary" id="signout2">Use a Different Account</button>`,
  });
  root.querySelector('#retry')?.addEventListener('click', () => { accountCheck = null; route(); });
  root.querySelector('#signout2').addEventListener('click', () => sb.auth.signOut());
}

/** Show only the tabs this account can use. */
function setTabs(a) {
  const hotel = a.staff && a.active;
  const bill = hotel && a.can_bill === true;
  const owner = hotel && a.role === 'owner';
  const show = {
    admin: a.super_admin,
    tables: hotel && feat('tables'),
    rooms: bill && feat('rooms'),
    bills: bill,
    trending: bill && feat('tables') && feat('trending'),
    menu: owner && feat('tables'),
    settings: hotel,
  };
  document.querySelectorAll('[data-tab]').forEach((t) => { t.hidden = !show[t.dataset.tab]; });
}

async function route() {
  const token = ++renderToken;
  document.body.classList.remove('sheet-open');
  if (!session) return signInView();
  if (recoveringPassword) return authViews.newPassword();
  try {
    account = await getAccount();
  } catch (err) {
    if (token !== renderToken) return;
    return blockedScreen({ iconName: 'lock', title: 'Can’t connect', body: html`<p class="auth-text">${friendly(err)}</p>` });
  }
  if (token !== renderToken) return;
  if (!account.super_admin && !account.staff) {
    accountCheck = null;
    return blockedScreen({
      title: 'Waiting for access',
      body: html`<p class="auth-text"><strong>${session.user.email}</strong> has no access to any hotel. Ask your hotel owner to add you in
        Settings → Staff Logins, or contact Techyverve, then tap Try Again.</p>`,
    });
  }
  if (!account.super_admin && !account.active) {
    accountCheck = null;
    return blockedScreen({
      iconName: 'pause',
      title: 'Service paused',
      body: html`<p class="auth-text">Billing for <strong>${account.hotel}</strong> is paused right now.
        ${account.paused_reason ? html`<br>Reason: “${account.paused_reason}”` : ''}</p>
        <p class="auth-text">Please contact Techyverve to turn it back on. Your bills and menu are safe.</p>`,
    });
  }
  document.body.classList.remove('signed-out');
  document.body.classList.toggle('super-admin', account.super_admin);
  document.getElementById('who').textContent = session.user.email;
  document.getElementById('brand').textContent = account.staff ? account.hotel : 'Super Admin';
  setTabs(account);
  // Reconnect remembered Bluetooth printers in the background, once per app open.
  if (account.can_bill && !route.printersTried) { route.printersTried = true; reconnectSaved().catch(() => {}); }
  const hotel = account.staff && account.active;
  let path = location.hash.replace(/^#/, '') || '/';
  // Coming back from the Menu screen: use the dishes just edited.
  if (lastPath === '/menu' && path !== '/menu') getMenu.clear();
  lastPath = path;
  // Pick a sensible home screen: the admin console, or Rooms for a hotel without tables.
  if (path === '/' && (!hotel || (!feat('tables') && feat('rooms') && account.can_bill))) {
    path = hotel ? '/rooms' : '/admin';
    history.replaceState(null, '', `#${path}`);
  }
  const list = [...(account.super_admin ? adminRoutes : []), ...(hotel ? routes : [])];
  for (const [re, view, tab, feature, who] of list) {
    const m = path.match(re);
    if (!m) continue;
    if (!allowed(who)) {
      setHTML($view, html`<div class="card empty"><span class="emoji" aria-hidden="true">🔒</span>Only the ${who === 'owner' ? 'owner' : 'owner or a manager'} can open this.<br><br><a href="#/">Back to Tables</a></div>`);
      return;
    }
    document.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (feature && !feat(feature)) {
      setHTML($view, html`<div class="card empty"><span class="emoji" aria-hidden="true">🔒</span>This part of the app isn’t turned on for your hotel.
        Contact Techyverve to add it.<br><br><a href="#/">Back to start</a></div>`);
      return;
    }
    // Show placeholders only if loading takes a moment, so fast screens don't flash.
    const placeholder = setTimeout(() => {
      if (token === renderToken) setHTML($view, html`<div class="skeleton" aria-label="Loading"><div class="bar"></div><div class="block"></div>
        <div class="grid">${[1, 2, 3, 4].map(() => html`<div class="block"></div>`)}</div></div>`);
    }, 150);
    try {
      await view(token, ...m.slice(1).filter(Boolean));
      showInstall();
      clearTimeout(placeholder);
      if (token === renderToken) window.scrollTo(0, 0);
    } catch (err) {
      clearTimeout(placeholder);
      if (token === renderToken) {
        setHTML($view, html`<div class="card empty state-error" role="alert">
          <span class="emoji" aria-hidden="true">${navigator.onLine ? '⚠️' : '📶'}</span>
          <strong>${navigator.onLine ? 'Couldn’t load this screen' : 'No internet connection'}</strong>
          <span>${navigator.onLine ? friendly(err) : 'Check Wi-Fi or mobile data, then try again.'}</span>
          <button type="button" id="retry">Try Again</button></div>`);
        document.getElementById('retry').addEventListener('click', route);
      }
    }
    return;
  }
  setHTML($view, html`<div class="card empty">Page not found. <a href="#/">Back to start</a></div>`);
}

document.getElementById('logout').addEventListener('click', () => sb.auth.signOut());

// Offline notice: orders and bills need the internet, so say so before a tap fails.
const $offline = Object.assign(document.createElement('div'), { className: 'offline-bar', role: 'status', textContent: 'You’re offline. Orders and bills can’t be saved until the internet is back.' });
document.body.append($offline);
const showOnline = () => { $offline.hidden = navigator.onLine; };
window.addEventListener('online', () => { showOnline(); toast('Back online'); });
window.addEventListener('offline', showOnline);
showOnline();
// Coming back to the app (from another app or a locked screen): check for changes made by the super admin.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !session || !account) return;
  const before = JSON.stringify(account);
  accountCheck = null;
  getAccount().then((a) => { if (JSON.stringify(a) !== before) route(); }).catch(() => {});
});

// ---------- install as an app (opens full screen, without the browser bar) ----------
let installPrompt = null;
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
function showInstall() {
  document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = isInstalled() || (!installPrompt && !isIOS()); });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; showInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; showInstall(); toast('Installed. Open “Billing” from your home screen.'); });
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-install]')) return;
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null; showInstall();
  } else if (isIOS()) {
    toast('On iPhone: tap the Share button, then “Add to Home Screen”.');
  }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// No zooming: it's an app, not a web page. iPhones ignore the viewport setting, so stop the pinch there too.
document.addEventListener('gesturestart', (e) => e.preventDefault());

// Pull down from the top to reload: the installed app has no browser reload button.
(function pullToRefresh() {
  const el = document.createElement('div');
  el.className = 'ptr';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = '↻';
  document.body.append(el);
  const PULL = 90;
  let startY = null;
  let dist = 0;
  const scrolledInside = (node) => {
    for (let n = node; n && n !== document.body; n = n.parentElement) if (n.scrollTop > 0) return true;
    return false;
  };
  addEventListener('touchstart', (e) => {
    dist = 0;
    startY = e.touches.length === 1 && window.scrollY <= 0 && !document.querySelector('dialog[open]')
      && !document.body.classList.contains('sheet-open') && !scrolledInside(e.target) ? e.touches[0].clientY : null;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (startY == null) return;
    if (window.scrollY > 0) { startY = null; dist = 0; }
    else dist = Math.max(0, e.touches[0].clientY - startY);
    el.classList.remove('back');
    el.style.transform = `translate(-50%, ${Math.min(dist, 150) * 0.6 - 60}px) rotate(${dist * 2}deg)`;
    el.classList.toggle('ready', dist > PULL);
  }, { passive: true });
  addEventListener('touchend', () => {
    if (startY == null) return;
    startY = null;
    if (dist > PULL) { el.style.transform = 'translate(-50%, 30px)'; location.reload(); return; }
    el.classList.add('back');
    el.classList.remove('ready');
    el.style.transform = '';
  });
})();
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange((event, s) => {
  const changed = (s?.user.id) !== (session?.user.id);
  session = s;
  if (changed) { accountCheck = null; account = null; getSettings.clear(); getMenu.clear(); }
  if (event === 'PASSWORD_RECOVERY') { recoveringPassword = true; setTimeout(route, 0); return; }
  if (event === 'SIGNED_OUT') { recoveringPassword = false; lastEmail = ''; }
  // Defer: calling Supabase from inside this callback can deadlock the auth client.
  if (changed || event === 'INITIAL_SESSION') setTimeout(route, 0);
});

