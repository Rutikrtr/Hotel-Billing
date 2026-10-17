import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { computeBill, fmt, nightsBetween, orderBill, plain, toPaise } from './billing.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const METHODS = ['Cash', 'UPI', 'Card'];
const $view = document.getElementById('view');
let session = null;
// Cached account_status() for the current session: super admin?, staff?, role, hotel paused?, feature switches.
let accountCheck = null;
const getAccount = () => (accountCheck ??= q(sb.rpc('account_status')).catch((err) => { accountCheck = null; throw err; }));
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

// Each account belongs to one restaurant; row-level security returns only that one.
const getSettings = () => q(sb.from('restaurants').select('*').single());

// ---------- sign in ----------

const ICONS = {
  receipt: '<path d="M5 2.5h14v19l-2.33-1.6L14.33 21.5 12 19.9l-2.33 1.6-2.34-1.6L5 21.5zM8 7v1.6h8V7zm0 4v1.6h8V11zm0 4v1.6h5V15z" fill-rule="evenodd"/>',
  mail: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.4 2L12 12.2 19.6 7zM4 9.1V17h16V9.1l-8 5.4z" fill-rule="evenodd"/>',
  pause: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM9 8v8h2V8zm4 0v8h2V8z" fill-rule="evenodd"/>',
  lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z" fill-rule="evenodd"/>',
};
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
        <div class="auth-icon">${icon(iconName)}</div>
        <h1>${title}</h1>
        <p class="auth-sub">${subtitle}</p>
        <div class="auth-alert" role="alert" hidden></div>
        ${body}
      </div>
      ${footer ? html`<p class="auth-footer">${footer}</p>` : ''}
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

const emailField = (autofocus = true) => html`
  <div class="field">
    <label for="email">Email</label>
    <input id="email" type="email" name="email" autocomplete="email" inputmode="email" required
      value="${lastEmail}" ${autofocus ? new Raw('autofocus') : ''} placeholder="name@example.com">
  </div>`;

const authViews = {
  signIn() {
    const { handle } = authScreen({
      title: 'Welcome back',
      subtitle: 'Sign in to take orders and print bills.',
      body: html`
        <form class="auth-form" novalidate>
          ${emailField()}
          ${passwordField('Password', 'current-password')}
          <div class="auth-row"><a href="#" data-go="forgot">Forgot password?</a></div>
          <button type="submit" class="wide">Sign In</button>
        </form>
        <p class="auth-switch">New staff member? <a href="#" data-go="signUp">Create an account</a></p>`,
      footer: 'Only people the owner has added in Settings can sign in.',
    });
    handle('Signing In…', async ({ email, password }) => {
      if (!email.trim() || !password) throw new Error('Enter your email and password.');
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (!error) return;
      const code = authError(error);
      if (code === 'unconfirmed') {
        throw html`Confirm your email first. Open the link we sent to ${email.trim()}. <a href="#" data-go="checkEmail">Send it again</a>`;
      }
      throw error;
    });
    if (lastEmail) document.getElementById('password')?.focus();
  },

  signUp() {
    const { handle } = authScreen({
      title: 'Create your account',
      subtitle: 'Use the email address the owner added for you in Settings.',
      body: html`
        <form class="auth-form" novalidate>
          ${emailField()}
          ${passwordField('Choose a password', 'new-password', 'At least 6 characters.')}
          <button type="submit" class="wide">Create Account</button>
        </form>
        <p class="auth-switch">Already have an account? <a href="#" data-go="signIn">Sign in</a></p>`,
      footer: 'We’ll email you a link to confirm the account.',
    });
    handle('Creating Account…', async ({ email, password }) => {
      if (!email.trim()) throw new Error('Enter your email address.');
      if ((password || '').length < 6) throw new Error('Use a password with at least 6 characters.');
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin } });
      if (error) {
        if (authError(error) === 'exists') throw html`There’s already an account for this email. <a href="#" data-go="signIn">Sign in instead</a>`;
        throw error;
      }
      // Supabase hides whether an email is taken: an existing address comes back with no identities.
      if (!data.session && data.user && data.user.identities?.length === 0) {
        throw html`There’s already an account for this email. <a href="#" data-go="signIn">Sign in instead</a>`;
      }
      if (!data.session) authViews.checkEmail('signup');
    });
  },

  forgot() {
    const { handle } = authScreen({
      iconName: 'lock',
      title: 'Reset your password',
      subtitle: 'Enter your email and we’ll send you a link to set a new password.',
      body: html`
        <form class="auth-form" novalidate>
          ${emailField()}
          <button type="submit" class="wide">Send Reset Link</button>
        </form>
        <p class="auth-switch"><a href="#" data-go="signIn">Back to sign in</a></p>`,
    });
    handle('Sending…', async ({ email }) => {
      if (!email.trim()) throw new Error('Enter your email address.');
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin });
      if (error) throw error;
      authViews.checkEmail('reset');
    });
  },

  checkEmail(kind = 'signup') {
    const reset = kind === 'reset';
    const { root, showAlert } = authScreen({
      iconName: 'mail',
      title: 'Check your email',
      subtitle: '',
      body: html`
        <p class="auth-text">We sent a ${reset ? 'password reset' : 'confirmation'} link to <strong>${lastEmail || 'your email'}</strong>.
          ${reset ? 'Open it to choose a new password.' : 'Open it to confirm your account, then come back here and sign in.'}</p>
        <p class="hint">Can’t find it? Check your spam folder.</p>
        <button type="button" class="wide" data-go="signIn">Back to Sign In</button>
        <button type="button" class="wide secondary" id="resend">Send Again</button>`,
    });
    root.querySelector('#resend').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const { error } = reset
        ? await sb.auth.resetPasswordForEmail(lastEmail, { redirectTo: location.origin })
        : await sb.auth.resend({ type: 'signup', email: lastEmail, options: { emailRedirectTo: location.origin } });
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
    q(sb.from('orders').select('discount, tax_rate_bp, order_items(quantity, unit_price)').eq('status', 'paid').gte('closed_at', dayStart.toISOString())),
  ]);
  if (token !== renderToken) return;
  const byTable = {};
  open.forEach((o) => { (byTable[o.table_id] ??= []).push(o); });
  const sales = paidToday.reduce((sum, o) => sum + orderBill(o, o.order_items, o.tax_rate_bp ?? 0).total, 0);
  const runningTables = tables.filter((t) => byTable[t.id]?.length).length;
  const waiting = open.filter((o) => o.billed_at).length;
  const onTables = open.reduce((sum, o) => sum + orderBill(o, o.order_items, settings.tax_rate_bp).total, 0);
  const counts = { all: tables.length, running: runningTables, free: tables.length - runningTables };
  const visible = tables.filter((t) => tableFilter === 'all' || (tableFilter === 'running') === Boolean(byTable[t.id]?.length));
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const root = mount(html`
    <div class="page-head"><div><p class="eyebrow">${today}</p><h1>Tables</h1></div></div>
    <section class="hero" aria-label="Today">
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
          <span class="tap">Tap to take order</span></a>`;
        const bills = orders.map((o) => orderBill(o, o.order_items, settings.tax_rate_bp));
        const total = bills.reduce((sum, b) => sum + b.total, 0);
        const billed = orders.every((o) => o.billed_at);
        const label = billed ? 'Bill printed' : 'Eating';
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
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f) return;
    tableFilter = f.dataset.filter;
    tablesView(renderToken);
  });
}

// ---------- Order for a table ----------

async function tableView(token, tableId, sectionArg) {
  const [table, menu, settings, open, sales] = await Promise.all([
    q(sb.from('dining_tables').select('*').eq('id', tableId).single()),
    q(sb.from('menu_items').select('*').order('id')),
    getSettings(),
    q(sb.from('orders').select('*, order_items(*)').eq('table_id', tableId).eq('status', 'open').order('section').order('id', { referencedTable: 'order_items' })),
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
  const label = tableLabel(table.name, section, multi || Boolean(current?.is_split));
  const state = { order: current, items: current ? current.order_items : [], filter: hasPopular ? POPULAR : 'All', search: '' };
  const categories = [...(hasPopular ? [POPULAR] : []), 'All', ...new Set(menu.map((m) => m.category))];
  let queue = Promise.resolve();

  const countIn = (c) => (c === POPULAR ? favourites.length + bestSellers.length : c === 'All' ? menu.length : menu.filter((m) => m.category === c).length);
  setHTML($view, html`
    <div class="order-page">
      <div class="order-top">
        <a class="back" href="#/" aria-label="Back to all tables">‹</a>
        <div class="titles"><h1>${table.name}</h1><p id="order-sub"></p></div>
        <button type="button" class="secondary add-section" id="add-section" ${current?.order_items.length ? '' : new Raw('hidden')}
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
    const billed = Boolean(state.order?.billed_at);
    document.getElementById('add-section').hidden = !state.items.length;
    const tabTotal = document.querySelector('.section-tab[aria-current="page"] .section-total');
    if (tabTotal) tabTotal.textContent = state.items.length ? rs(b.total) : 'New';
    $sub.textContent = !state.order ? (multi ? `Section ${section} · take this group’s order` : 'Free · take the order')
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
              <span class="each">${rs(i.unit_price)} each</span>
              <span class="qty" role="group" aria-label="Quantity of ${i.name}">
                <button type="button" data-dec="${i.id}" aria-label="Remove one ${i.name}">−</button>
                <output>${i.quantity}</output>
                <button type="button" data-inc="${i.id}" aria-label="Add one ${i.name}">+</button>
              </span>
            </li>`)}
        </ul>
        <div class="totals">
          <div><span class="muted">Subtotal</span><span class="money">${fmt(b.subtotal)}</span></div>
          <div class="discount-row"><label for="discount" class="muted" style="display:flex">Discount (₹)</label>
            <input id="discount" inputmode="decimal" value="${state.order?.discount ? plain(state.order.discount) : ''}" placeholder="0"></div>
          ${b.tax ? html`
            <div><span class="muted">CGST ${pct(settings.tax_rate_bp / 2)}</span><span class="money">${fmt(b.cgst)}</span></div>
            <div><span class="muted">SGST ${pct(settings.tax_rate_bp / 2)}</span><span class="money">${fmt(b.sgst)}</span></div>` : ''}
          ${b.roundOff ? html`<div><span class="muted">Round off</span><span class="money">${fmt(b.roundOff)}</span></div>` : ''}
          <div class="grand"><span>Total</span><span class="money">${rs(b.total)}</span></div>
        </div>
        ${billed ? html`<p class="order-note">Bill printed. Added or removed items? Print it again so the customer gets the right total.</p>` : ''}
        <div class="order-actions">
          ${billed
            ? html`<button type="button" class="secondary" id="print-bill">Reprint Bill</button>
                   <button type="button" id="pay">Receive Payment</button>`
            : html`<button type="button" class="secondary" id="print-bill">Print Bill</button>
                   <button type="button" id="save-order">Save Order</button>`}
        </div>`
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
      const fresh = await q(sb.from('orders').select('*, order_items(*)').eq('table_id', tableId).eq('section', section).eq('status', 'open').order('id', { referencedTable: 'order_items' }).maybeSingle()).catch(() => null);
      state.order = fresh; state.items = fresh ? fresh.order_items : [];
      render();
    });
    return queue;
  }

  async function ensureOrder() {
    if (state.order) return state.order;
    state.order = await q(sb.from('orders').insert({ table_id: table.id, section }).select().single());
    return state.order;
  }

  function changeQty(item, delta) {
    item.quantity += delta;
    if (item.quantity <= 0) state.items = state.items.filter((i) => i !== item);
    render();
    enqueue(async () => {
      const order = await ensureOrder();
      if (item.quantity <= 0) {
        if (item.id > 0) await q(sb.from('order_items').delete().eq('id', item.id));
      } else if (item.id > 0) {
        await q(sb.from('order_items').update({ quantity: item.quantity }).eq('id', item.id));
      } else {
        const row = await q(sb.from('order_items').insert({
          order_id: order.id, menu_item_id: item.menu_item_id, name: item.name, unit_price: item.unit_price, quantity: item.quantity,
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
      item = { id: --tempId, menu_item_id: m.id, name: m.name, unit_price: m.price, quantity: 0 };
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
    } else if (t.id === 'print-bill') {
      act(t, async () => {
        await queue;
        document.body.classList.remove('sheet-open');
        if (settings.quick_close !== false) {
          // No printer / no separate payment step: the bill is created and the table is freed at once.
          const billNo = await q(sb.rpc('settle_order', { p_order_id: state.order.id, p_method: 'Cash' }));
          toast(`Bill ${billNo} done · ${label} is free`);
          location.hash = `#/bill/${state.order.id}`;
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
      if (!confirm(`Clear all items from ${multi ? `Section ${section} of ${table.name}` : table.name}? This can’t be undone.`)) return;
      enqueue(async () => {
        await q(sb.from('orders').delete().eq('id', state.order.id));
        state.order = null; state.items = [];
        toast(`${label} cleared`);
        if (multi) location.hash = `#/table/${table.id}`;
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
                 ${owner && feat('bill_edit') ? html`<button type="button" class="secondary" id="edit-bill">Edit Bill</button>
                   <button type="button" class="secondary danger-outline" id="delete-bill">Delete</button>` : html`<a class="button secondary" href="#/">Tables</a>`}`
          : html`<a class="button secondary" href="#/table/${order.table_id}/${order.section}">Add Items</a>
                 <button type="button" class="secondary" id="print">Print Again</button>
                 <button type="button" id="pay">Receive Payment</button>`}
      </div>
      ${paid ? html`<p class="paid-note no-print">Paid by ${order.payment_method} · ${dateTime(order.closed_at)}${order.edit_count ? html` · <span class="edited-tag">Edited ${order.edit_count}×</span>` : ''}</p>`
             : html`<p class="paid-note no-print">Give this bill to ${tableLabel(order.dining_tables.name, order.section, order.is_split)}. Tap Receive Payment once they pay.</p>`}
      <article class="receipt" aria-label="Bill">
        <div class="center">
          <div class="shop">${settings.hotel_name}</div>
          ${settings.hotel_address ? html`<div>${settings.hotel_address}</div>` : ''}
          ${settings.hotel_phone ? html`<div>Ph: ${settings.hotel_phone}</div>` : ''}
          ${settings.hotel_gstin && rate > 0 ? html`<div>GSTIN: ${settings.hotel_gstin}</div>` : ''}
        </div>
        <div class="rule"></div>
        ${kv(order.bill_no ? `Bill: ${order.bill_no}` : 'Bill', `Table: ${tableLabel(order.dining_tables.name, order.section, order.is_split)}`)}
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
      ${history.length ? html`<section class="history no-print" aria-label="Changes to this bill">
        <h3>Changes to this bill</h3>
        <div class="list">${history.map(logRow)}</div>
      </section>` : ''}
    </div>`);
  document.getElementById('print').addEventListener('click', () => window.print());
  document.getElementById('edit-bill')?.addEventListener('click', () => editBill(order, rate));
  document.getElementById('delete-bill')?.addEventListener('click', () => deleteBill(order, b.total));
  document.getElementById('pay')?.addEventListener('click', async () => {
    const billNo = await receivePayment({ orderId: order.id, tableName: tableLabel(order.dining_tables.name, order.section, order.is_split), total: b.total });
    if (billNo) location.hash = '#/';
  });
  if (autoPrint) {
    history.replaceState(null, '', `#/bill/${order.id}`);
    setTimeout(() => window.print(), 300);
  }
}

// ---------- Bills (history) ----------

async function billsView(token, day = localDay()) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const [orders, settings, unpaid, owner, stays] = await Promise.all([
    q(sb.from('orders').select('*, dining_tables(name), order_items(quantity, unit_price)').eq('status', 'paid')
      .gte('closed_at', start.toISOString()).lt('closed_at', end.toISOString()).order('closed_at', { ascending: false })),
    getSettings(),
    q(sb.from('orders').select('*, dining_tables(name), order_items(quantity, unit_price)').eq('status', 'open')
      .not('billed_at', 'is', null).order('billed_at')),
    isOwner(),
    feat('rooms') ? q(sb.from('stays').select('*, lodging_rooms(number), stay_charges(quantity, unit_price, description)').eq('status', 'paid')
      .gte('closed_at', start.toISOString()).lt('closed_at', end.toISOString())) : [],
  ]);
  if (token !== renderToken) return;
  const rows = [
    ...orders.map((o) => ({ o, b: orderBill(o, o.order_items, o.tax_rate_bp ?? settings.tax_rate_bp), href: `#/bill/${o.id}`, label: tableLabel(o.dining_tables.name, o.section, o.is_split) })),
    ...stays.map((st) => ({ o: st, b: stayBill(st), href: `#/stay/${st.id}`, label: `Room ${st.lodging_rooms.number} · ${st.guest_name}` })),
  ].sort((x, y) => y.o.closed_at.localeCompare(x.o.closed_at));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.b.total, 0);
  const isToday = day === localDay();
  const total = sum(() => true);
  const byMethod = Object.fromEntries(METHODS.map((m) => [m, sum((r) => r.o.payment_method === m)]));
  const badge = (m) => html`<span class="method-badge m-${m.toLowerCase()}" aria-hidden="true">${m === 'Cash' ? '₹' : m}</span>`;
  setHTML($view, html`
    <div class="page-head">
      <div><p class="eyebrow">${isToday ? 'Today' : new Date(start).toLocaleDateString('en-IN', { weekday: 'long' })}</p>
        <h1>Bills</h1></div>
      <div class="head-actions">
        ${owner && feat('bill_edit') ? html`<a class="button secondary" href="#/bills/log">Change Log</a>` : ''}
        <label class="date-pick"><span class="sr-only">Date</span><input type="date" id="day" value="${day}" max="${localDay()}" aria-label="Show bills for date"></label>
      </div>
    </div>
    <section class="sales-card" aria-label="Sales">
      <span class="label">${isToday ? 'Today’s sales' : `Sales on ${new Date(start).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`} · ${rows.length} bill${rows.length === 1 ? '' : 's'}</span>
      <span class="big">${rs(total)}</span>
      <div class="split-bar" aria-hidden="true">${total ? METHODS.filter((m) => byMethod[m]).map((m) => html`<span class="m-${m.toLowerCase()}" style="flex:${byMethod[m]}"></span>`) : ''}</div>
      <div class="split-legend">${METHODS.map((m) => html`<div class="m-${m.toLowerCase()}"><span class="k">${m}</span><strong>${rs(byMethod[m]).replace('.00', '')}</strong></div>`)}</div>
    </section>
    ${unpaid.length ? html`
      <h3 style="margin-top:0">Waiting for payment · ${unpaid.length}</h3>
      <div class="list" style="margin-bottom:20px">${unpaid.map((o) => html`
        <a class="list-row" href="#/bill/${o.id}">
          <span class="method-badge m-wait" aria-hidden="true">⏳</span>
          <span class="grow"><strong>${tableLabel(o.dining_tables.name, o.section, o.is_split)}</strong> · ${o.bill_no}<div class="sub">Printed ${time(o.billed_at)} · not paid yet</div></span>
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
  const menu = await q(sb.from('menu_items').select('id, name, price, category').order('id')).catch(() => []);
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

// ---------- Trending: best-selling dishes ----------

const TREND_PERIODS = { today: { label: 'Today', days: 1, prev: 'yesterday' }, week: { label: '7 days', days: 7, prev: 'the 7 days before' }, month: { label: '30 days', days: 30, prev: 'the 30 days before' } };
let trendPeriod = 'week';
let trendSort = 'qty';

async function trendingView(token) {
  const period = TREND_PERIODS[trendPeriod];
  // Current period and the one before it, so each dish can show whether it is rising or falling.
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (period.days - 1));
  const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - period.days);
  const [orders, menu] = await Promise.all([
    q(sb.from('orders').select('closed_at, order_items(menu_item_id, name, quantity, unit_price)').eq('status', 'paid')
      .gte('closed_at', prevStart.toISOString())),
    q(sb.from('menu_items').select('id, name, category, is_veg')),
  ]);
  if (token !== renderToken) return;

  const menuById = new Map(menu.map((m) => [m.id, m]));
  const stats = new Map();
  for (const o of orders) {
    const current = new Date(o.closed_at) >= start;
    for (const i of o.order_items) {
      const key = i.menu_item_id ?? `n:${i.name}`;
      const m = menuById.get(i.menu_item_id);
      const row = stats.get(key) ?? { name: m?.name ?? i.name, category: m?.category ?? 'Other', is_veg: m?.is_veg ?? true, qty: 0, revenue: 0, prevQty: 0 };
      if (current) { row.qty += i.quantity; row.revenue += i.quantity * i.unit_price; } else row.prevQty += i.quantity;
      stats.set(key, row);
    }
  }
  const sold = [...stats.values()].filter((r) => r.qty > 0);
  const metric = (r) => (trendSort === 'qty' ? r.qty : r.revenue);
  sold.sort((a, b) => metric(b) - metric(a) || b.qty - a.qty || a.name.localeCompare(b.name));
  const max = sold.length ? metric(sold[0]) : 0;
  const totalQty = sold.reduce((n, r) => n + r.qty, 0);
  const totalRevenue = sold.reduce((n, r) => n + r.revenue, 0);
  const cats = new Map();
  sold.forEach((r) => { const c = cats.get(r.category) ?? { name: r.category, qty: 0, revenue: 0 }; c.qty += r.qty; c.revenue += r.revenue; cats.set(r.category, c); });
  const catList = [...cats.values()].sort((a, b) => metric(b) - metric(a));
  const catMax = catList.length ? metric(catList[0]) : 0;
  const money = (p) => rs(p).replace('.00', '');
  const trend = (r) => {
    if (!r.prevQty) return html`<span class="trend new">New</span>`;
    const d = r.qty - r.prevQty;
    if (!d) return html`<span class="trend flat">Same as ${period.prev}</span>`;
    return html`<span class="trend ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} vs ${period.prev}</span>`;
  };
  const top = sold[0];

  const root = mount(html`
    <div class="page-head"><div><p class="eyebrow">Best sellers</p><h1>Trending</h1></div></div>
    <div class="trend-filters">
      <div class="filter-tabs" role="toolbar" aria-label="Period">
        ${Object.entries(TREND_PERIODS).map(([k, p]) => html`<button type="button" class="chip" data-period="${k}" aria-pressed="${k === trendPeriod}">${p.label}</button>`)}
      </div>
      <div class="filter-tabs" role="toolbar" aria-label="Rank by">
        <button type="button" class="chip" data-sort="qty" aria-pressed="${trendSort === 'qty'}">By quantity</button>
        <button type="button" class="chip" data-sort="revenue" aria-pressed="${trendSort === 'revenue'}">By sales ₹</button>
      </div>
    </div>
    ${!sold.length ? html`<div class="card empty"><span class="emoji" aria-hidden="true">📈</span>No dishes sold ${trendPeriod === 'today' ? 'yet today' : `in the last ${period.label}`}.<br>Paid bills appear here as they come in.</div>` : html`
      <section class="hero trend-hero" aria-label="Top dish">
        <span class="label">#1 ${trendPeriod === 'today' ? 'today' : `in the last ${period.label}`}</span>
        <span class="big trend-top">${top.name}</span>
        <div class="facts">
          <div class="fact"><strong>${top.qty}</strong><span>Sold</span></div>
          <div class="fact"><strong>${money(top.revenue)}</strong><span>Sales</span></div>
          <div class="fact"><strong>${Math.round((top.qty / totalQty) * 100)}%</strong><span>Of all dishes</span></div>
        </div>
      </section>
      <div class="kpis">
        <div class="kpi"><span>Dishes sold</span><strong>${totalQty}</strong></div>
        <div class="kpi"><span>Sales (before discount)</span><strong>${money(totalRevenue)}</strong></div>
        <div class="kpi"><span>Different dishes</span><strong>${sold.length}</strong></div>
      </div>
      <h3>Top dishes · ${trendSort === 'qty' ? 'by quantity sold' : 'by sales'}</h3>
      <ol class="rank-list">${sold.slice(0, 20).map((r, i) => html`
        <li class="rank-row" title="${r.name}: ${r.qty} sold · ${money(r.revenue)}">
          <span class="rank ${i < 3 ? 'podium' : ''}">${i + 1}</span>
          <div class="rank-body">
            <div class="rank-line"><span class="diet ${r.is_veg ? 'veg' : 'nonveg'}" aria-hidden="true"></span><strong class="rank-name">${r.name}</strong>
              <span class="rank-value">${trendSort === 'qty' ? `${r.qty} sold` : money(r.revenue)}</span></div>
            <div class="bar-track" aria-hidden="true"><span class="bar" style="width:${Math.max(3, (metric(r) / max) * 100)}%"></span></div>
            <div class="rank-meta">${r.category} · ${trendSort === 'qty' ? money(r.revenue) : `${r.qty} sold`} · ${trend(r)}</div>
          </div>
        </li>`)}
      </ol>
      ${sold.length > 20 ? html`<p class="small">Showing the top 20 of ${sold.length} dishes.</p>` : ''}
      ${catList.length > 1 ? html`
        <h3>By category</h3>
        <div class="card cat-bars">${catList.map((c) => html`
          <div class="cat-row" title="${c.name}: ${c.qty} sold · ${money(c.revenue)}">
            <span class="cat-name">${c.name}</span>
            <span class="bar-track" aria-hidden="true"><span class="bar" style="width:${Math.max(3, (metric(c) / catMax) * 100)}%"></span></span>
            <span class="cat-value">${trendSort === 'qty' ? c.qty : money(c.revenue)}</span>
          </div>`)}
        </div>` : ''}`}`);
  root.addEventListener('click', (e) => {
    const p = e.target.closest('[data-period]'); const so = e.target.closest('[data-sort]');
    if (p) trendPeriod = p.dataset.period; else if (so) trendSort = so.dataset.sort; else return;
    trendingView(renderToken);
  });
}

// ---------- Menu ----------

async function menuView(token) {
  const menu = await q(sb.from('menu_items').select('*').order('id'));
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
    <div class="page-head"><div><h1>Menu</h1><p class="muted">${menu.length} item${menu.length === 1 ? '' : 's'} · tap ☆ to show a dish first when taking orders</p></div></div>
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

async function settingsView(token) {
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
        <label>Restaurant name <input name="hotel_name" value="${s.hotel_name}" required></label>
        <label>Address <textarea name="hotel_address" rows="2">${s.hotel_address}</textarea></label>
        <label>Phone <input name="hotel_phone" type="tel" value="${s.hotel_phone}"></label>
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
        <div class="card" style="margin-top:20px">
          <h2>Staff</h2>
          <p class="small" style="margin-top:-6px">Only these emails can sign in. New staff create an account with the email added here.</p>
          <div class="list" style="box-shadow:none">${staff.map((m) => html`
            <div class="list-row">
              <span class="grow">${m.email}<div class="sub">${m.role === 'owner' ? 'Owner' : 'Staff'} · ${m.user_id ? 'Active' : 'Hasn’t signed up yet'}</div></span>
              ${isOwner && m.role !== 'owner' ? html`<button type="button" class="destructive" data-del-staff="${m.email}">Remove</button>` : ''}
            </div>`)}
          </div>
          ${isOwner ? html`<form id="add-staff" class="row" style="margin-top:12px">
            <input type="email" name="email" placeholder="staff@example.com" required aria-label="Staff email">
            <button type="submit" class="secondary">Add Staff</button></form>` : ''}
        </div>
      </div>
    </div>`);
  root.querySelector('#gst-on').addEventListener('change', (e) => { root.querySelector('#gst-fields').hidden = !e.target.checked; });
  onSubmit(root, '#settings', async (f) => {
    const rate = f.gst_on === 'on' ? toPaise(f.tax_rate) : 0;
    if (f.gst_on === 'on' && rate <= 0) throw new Error('Enter a GST rate, like 5, or turn GST off.');
    if (rate > 10000) throw new Error('GST rate can’t be more than 100%.');
    await q(sb.from('restaurants').update({
      hotel_name: f.hotel_name.trim(), hotel_address: f.hotel_address.trim(), hotel_phone: f.hotel_phone.trim(),
      hotel_gstin: (f.hotel_gstin ?? s.hotel_gstin).trim().toUpperCase(), tax_rate_bp: rate, quick_close: f.quick_close === 'on',
    }).eq('id', s.id));
    document.getElementById('brand').textContent = f.hotel_name.trim();
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
  onSubmit(root, '#add-staff', async (f) => {
    await q(sb.from('staff').insert({ email: f.email.trim().toLowerCase() }));
    toast('Staff added');
    settingsView(renderToken);
  });
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
    } else if (t.dataset.delStaff) {
      if (!confirm(`Remove ${t.dataset.delStaff}? They won’t be able to sign in.`)) return;
      act(t, async () => { await q(sb.from('staff').delete().eq('email', t.dataset.delStaff)); settingsView(renderToken); });
    }
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
    <div class="page-head"><div><p class="eyebrow">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Rooms</h1></div></div>
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
    document.getElementById('print').addEventListener('click', () => window.print());
    if (autoPrint) {
      history.replaceState(null, '', `#/stay/${stay.id}`);
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
  document.getElementById('print').addEventListener('click', () => window.print());
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
  ['trending', 'Trending', 'Best-selling dishes report'],
  ['bill_edit', 'Edit Bills', 'Owner can edit or delete paid bills, with a change log'],
];
let adminSearch = '';

async function adminView(token) {
  const hotels = await q(sb.rpc('sa_list_hotels'));
  if (token !== renderToken) return;
  const active = hotels.filter((h) => h.active).length;
  const sales = hotels.reduce((s, h) => s + Number(h.sales_today), 0);
  const needle = adminSearch.trim().toLowerCase();
  const shown = hotels.filter((h) => !needle || [h.name, h.address, h.phone, ...h.owners].join(' ').toLowerCase().includes(needle));
  const root = mount(html`
    <div class="page-head">
      <div><p class="eyebrow">Techyverve · Super Admin</p><h1>Hotels</h1></div>
      <button type="button" id="new-hotel">＋ New Hotel</button>
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
    if (t.id === 'new-hotel') hotelDialog(null, reload);
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
  const f = hotel?.features ?? { tables: true, rooms: false, trending: true, bill_edit: true };
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
    const flags = Object.fromEntries(FEATURES.map(([k]) => [`p_feat_${k}`, v[`feat_${k}`] === 'on']));
    if (!v.name.trim()) return fail('Enter the hotel name.');
    if (!flags.p_feat_tables && !flags.p_feat_rooms) return fail('Tick Tables & Orders, Rooms, or both.');
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (creating) {
        const count = (x) => { const n = Number(x || 0); if (!Number.isInteger(n) || n < 0) throw new Error('Tables and rooms must be whole numbers.'); return n; };
        if (!/^[^@\s]+@[^@\s]+$/.test(v.email.trim())) throw new Error('Enter the owner’s email.');
        if (v.password.length < 6) throw new Error('The owner’s password needs at least 6 characters.');
        await q(sb.rpc('sa_create_hotel', {
          p_name: v.name, p_address: v.address, p_phone: v.phone, p_owner_email: v.email, p_owner_password: v.password,
          p_tables: flags.p_feat_tables ? count(v.tables) : 0, p_rooms: flags.p_feat_rooms ? count(v.rooms) : 0, ...flags,
        }));
        toast(`${v.name.trim()} created · owner can sign in now`);
      } else {
        await q(sb.rpc('sa_update_hotel', { p_id: hotel.id, p_name: v.name, p_address: v.address, p_phone: v.phone, ...flags }));
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

// [pattern, view, tab, feature needed (or null)]
const routes = [
  [/^\/?$/, tablesView, 'tables', 'tables'],
  [/^\/table\/(\d+)(?:\/([A-Z]))?$/, tableView, 'tables', 'tables'],
  [/^\/bill\/(\d+)(\/print)?$/, billView, 'tables', null],
  [/^\/rooms$/, roomsView, 'rooms', 'rooms'],
  [/^\/stay\/(\d+)(\/print)?$/, stayView, 'rooms', 'rooms'],
  [/^\/bills\/log$/, logView, 'bills', 'bill_edit'],
  [/^\/bills(?:\/(\d{4}-\d{2}-\d{2}))?$/, billsView, 'bills', null],
  [/^\/trending$/, trendingView, 'trending', 'trending'],
  [/^\/menu$/, menuView, 'menu', 'tables'],
  [/^\/settings$/, settingsView, 'settings', null],
];
const adminRoutes = [
  [/^\/admin$/, adminView, 'admin', null],
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
  const show = {
    admin: a.super_admin,
    tables: hotel && feat('tables'),
    rooms: hotel && feat('rooms'),
    bills: hotel,
    trending: hotel && feat('tables') && feat('trending'),
    menu: hotel && feat('tables'),
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
      body: html`<p class="auth-text"><strong>${session.user.email}</strong> isn’t on the staff list yet. Ask the owner to add this email in
        Settings → Staff, then tap Try Again.</p>`,
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
  const hotel = account.staff && account.active;
  let path = location.hash.replace(/^#/, '') || '/';
  // Pick a sensible home screen: the admin console, or Rooms for a hotel without tables.
  if (path === '/' && (!hotel || (!feat('tables') && feat('rooms')))) {
    path = hotel ? '/rooms' : '/admin';
    history.replaceState(null, '', `#${path}`);
  }
  const list = [...(account.super_admin ? adminRoutes : []), ...(hotel ? routes : [])];
  for (const [re, view, tab, feature] of list) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (feature && !feat(feature)) {
      setHTML($view, html`<div class="card empty"><span class="emoji" aria-hidden="true">🔒</span>This part of the app isn’t turned on for your hotel.
        Contact Techyverve to add it.<br><br><a href="#/bills">Go to Bills</a></div>`);
      return;
    }
    // Show placeholders only if loading takes a moment, so fast screens don't flash.
    const placeholder = setTimeout(() => {
      if (token === renderToken) setHTML($view, html`<div class="skeleton" aria-label="Loading"><div class="bar"></div><div class="block"></div>
        <div class="grid">${[1, 2, 3, 4].map(() => html`<div class="block"></div>`)}</div></div>`);
    }, 150);
    try {
      await view(token, ...m.slice(1).filter(Boolean));
      clearTimeout(placeholder);
      if (token === renderToken) window.scrollTo(0, 0);
    } catch (err) {
      clearTimeout(placeholder);
      if (token === renderToken) setHTML($view, html`<div class="card empty">${friendly(err)}<br><br><a href="#/">Back to start</a></div>`);
    }
    return;
  }
  setHTML($view, html`<div class="card empty">Page not found. <a href="#/">Back to start</a></div>`);
}

document.getElementById('logout').addEventListener('click', () => sb.auth.signOut());
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange((event, s) => {
  const changed = (s?.user.id) !== (session?.user.id);
  session = s;
  if (changed) { accountCheck = null; account = null; }
  if (event === 'PASSWORD_RECOVERY') { recoveringPassword = true; setTimeout(route, 0); return; }
  if (event === 'SIGNED_OUT') { recoveringPassword = false; lastEmail = ''; }
  // Defer: calling Supabase from inside this callback can deadlock the auth client.
  if (changed || event === 'INITIAL_SESSION') setTimeout(route, 0);
});

