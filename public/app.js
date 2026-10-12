import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { fmt, orderBill, plain, toPaise } from './billing.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const METHODS = ['Cash', 'UPI', 'Card'];
const $view = document.getElementById('view');
let session = null;
let staffCheck = null; // cached is_staff() result for the current session
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
  if (/orders_one_open_per_table/.test(msg)) return 'This table already has a running order. Refresh to see it.';
  if (/menu_items_name_key/.test(msg)) return 'An item with that name is already on the menu.';
  if (/dining_tables_name_key/.test(msg)) return 'A table with that name already exists.';
  if (/orders_table_id_fkey/.test(msg)) return 'This table has bills, so it can’t be removed. Rename it instead.';
  if (/row-level security|Not authorised/.test(msg)) return 'You don’t have permission to do that.';
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

const getSettings = () => q(sb.from('settings').select('*').single());

// ---------- sign in ----------

const ICONS = {
  receipt: '<path d="M5 2.5h14v19l-2.33-1.6L14.33 21.5 12 19.9l-2.33 1.6-2.34-1.6L5 21.5zM8 7v1.6h8V7zm0 4v1.6h8V11zm0 4v1.6h5V15z" fill-rule="evenodd"/>',
  mail: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.4 2L12 12.2 19.6 7zM4 9.1V17h16V9.1l-8 5.4z" fill-rule="evenodd"/>',
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

async function tablesView(token) {
  const [tables, open, settings] = await Promise.all([
    q(sb.from('dining_tables').select('*').order('sort').order('name')),
    q(sb.from('orders').select('*, order_items(quantity, unit_price, name)').eq('status', 'open')),
    getSettings(),
  ]);
  if (token !== renderToken) return;
  const byTable = Object.fromEntries(open.map((o) => [o.table_id, o]));
  const waiting = open.filter((o) => o.billed_at).length;
  const eating = open.length - waiting;
  const summary = open.length
    ? [eating && `${eating} eating`, waiting && `${waiting} waiting to pay`].filter(Boolean).join(' · ')
    : 'All tables are free';
  setHTML($view, html`
    <div class="page-head">
      <div>
        <h1>Tables</h1>
        <p class="muted">${summary}</p>
      </div>
    </div>
    ${tables.length ? '' : html`<div class="card empty">No tables yet. <a href="#/settings">Add tables in Settings</a>.</div>`}
    <div class="tables">
      ${tables.map((t) => {
        const o = byTable[t.id];
        if (!o) return html`<a class="table-tile" href="#/table/${t.id}" aria-label="${t.name}, free">
          <span class="name">${t.name}</span><span class="state">Free</span></a>`;
        const bill = orderBill(o, o.order_items, settings.tax_rate_bp);
        const billed = Boolean(o.billed_at);
        const label = billed ? 'Bill printed' : 'Eating';
        return html`<a class="table-tile busy ${billed ? 'billed' : ''}" href="#/table/${t.id}" aria-label="${t.name}, ${label}, ${rs(bill.total)}">
          <span class="tile-top"><span class="name">${t.name}</span><span class="tag">${label}</span></span>
          <span><span class="amount">${rs(bill.total)}</span><br>
          <span class="state">${billed ? `Waiting to pay · ${since(o.billed_at)}` : `${bill.itemCount} item${bill.itemCount === 1 ? '' : 's'} · ${since(o.opened_at)}`}</span></span></a>`;
      })}
    </div>`);
}

// ---------- Order for a table ----------

async function tableView(token, tableId) {
  const [table, menu, settings, open] = await Promise.all([
    q(sb.from('dining_tables').select('*').eq('id', tableId).single()),
    q(sb.from('menu_items').select('*').order('category').order('name')),
    getSettings(),
    q(sb.from('orders').select('*, order_items(*)').eq('table_id', tableId).eq('status', 'open').order('id', { referencedTable: 'order_items' }).maybeSingle()),
  ]);
  if (token !== renderToken) return;

  const state = { order: open, items: open ? open.order_items : [], filter: 'All', search: '' };
  const categories = ['All', ...new Set(menu.map((m) => m.category))];
  let queue = Promise.resolve();

  setHTML($view, html`
    <div class="order-page">
      <div class="page-head">
        <div><h1>${table.name}</h1><p class="muted" id="order-sub"></p></div>
        <a class="button secondary" href="#/">All Tables</a>
      </div>
      <div class="order-layout">
        <section aria-label="Menu">
          <div class="menu-tools">
            <input type="search" id="search" placeholder="Search menu" aria-label="Search menu" autocomplete="off">
            <div class="chips" role="toolbar" aria-label="Categories">
              ${categories.map((c) => html`<button class="chip" type="button" data-cat="${c}" aria-pressed="${c === 'All'}">${c}</button>`)}
            </div>
          </div>
          <div class="menu-grid" id="menu-grid"></div>
        </section>
        <aside class="order-panel" id="order-panel" aria-label="Order"></aside>
      </div>
      <div class="order-bar" id="order-bar"></div>
    </div>`);

  const $grid = document.getElementById('menu-grid');
  const $panel = document.getElementById('order-panel');
  const $bar = document.getElementById('order-bar');
  const $sub = document.getElementById('order-sub');
  const qtyOf = (menuId) => state.items.find((i) => i.menu_item_id === menuId)?.quantity ?? 0;
  const bill = () => orderBill(state.order, state.items, settings.tax_rate_bp);

  function renderMenu() {
    const term = state.search.trim().toLowerCase();
    const shown = menu.filter((m) => (state.filter === 'All' || m.category === state.filter) && (!term || m.name.toLowerCase().includes(term)));
    if (!menu.length) return setHTML($grid, html`<div class="card empty" style="grid-column: 1 / -1">Your menu is empty. <a href="#/menu">Add menu items</a> to start taking orders.</div>`);
    if (!shown.length) return setHTML($grid, html`<p class="muted" style="grid-column: 1 / -1">No items match “${state.search}”.</p>`);
    setHTML($grid, html`${shown.map((m) => {
      const n = qtyOf(m.id);
      return html`<button type="button" class="menu-item ${n ? 'in-order' : ''}" data-add="${m.id}" ${m.available ? '' : new Raw('disabled')}
          aria-label="Add ${m.name}, ${rs(m.price)}${n ? `, ${n} in order` : ''}${m.available ? '' : ', sold out'}">
        <span class="top"><span class="diet ${m.is_veg ? 'veg' : 'nonveg'}" title="${m.is_veg ? 'Veg' : 'Non-veg'}"></span><span>${m.name}</span></span>
        <span class="price">${m.available ? rs(m.price) : 'Sold out'}</span>
        ${n ? html`<span class="count" aria-hidden="true">${n}</span>` : ''}
      </button>`;
    })}`);
  }

  function renderOrder() {
    const b = bill();
    const billed = Boolean(state.order?.billed_at);
    $sub.textContent = !state.order ? 'Free · take the order'
      : billed ? `Bill ${state.order.bill_no} printed at ${time(state.order.billed_at)} · waiting to pay`
      : `Eating since ${time(state.order.opened_at)}`;
    setHTML($panel, html`
      <div class="order-head">
        <span class="title">Order</span>
        <span>
          ${state.items.length && !state.order?.bill_no ? html`<button type="button" class="destructive" id="clear">Clear Table</button>` : ''}
          <button type="button" class="plain sheet-close" id="close-sheet" aria-label="Close order">Done</button>
        </span>
      </div>
      ${state.items.length ? html`
        <ul class="order-lines">
          ${state.items.map((i) => html`
            <li class="order-line">
              <span><span class="name">${i.name}</span><span class="each">@ ${fmt(i.unit_price)}</span></span>
              <span class="stepper" role="group" aria-label="Quantity of ${i.name}">
                <button type="button" data-dec="${i.id}" aria-label="Remove one ${i.name}">−</button>
                <output>${i.quantity}</output>
                <button type="button" data-inc="${i.id}" aria-label="Add one ${i.name}">+</button>
              </span>
              <span class="line-total">${fmt(i.unit_price * i.quantity)}</span>
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
      : html`<div class="empty">No items yet.<br>Tap dishes from the menu to add them.</div>`}`);
    setHTML($bar, state.items.length
      ? html`<span><span class="money">${rs(b.total)}</span> · ${b.itemCount} item${b.itemCount === 1 ? '' : 's'}</span><button type="button" id="view-order">View Order</button>`
      : html``);
    $bar.hidden = !state.items.length;
    if (!state.items.length) document.body.classList.remove('sheet-open');
  }

  const render = () => { renderMenu(); renderOrder(); };

  /** Queue server writes so rapid taps apply in order. Each write sends the latest local quantity. */
  function enqueue(fn) {
    queue = queue.then(fn).catch(async (err) => {
      toast(friendly(err), 'error');
      const fresh = await q(sb.from('orders').select('*, order_items(*)').eq('table_id', tableId).eq('status', 'open').order('id', { referencedTable: 'order_items' }).maybeSingle()).catch(() => null);
      state.order = fresh; state.items = fresh ? fresh.order_items : [];
      render();
    });
    return queue;
  }

  async function ensureOrder() {
    if (state.order) return state.order;
    state.order = await q(sb.from('orders').insert({ table_id: table.id }).select().single());
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
  $grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const m = menu.find((x) => x.id === Number(btn.dataset.add));
    let item = state.items.find((i) => i.menu_item_id === m.id);
    if (!item) {
      item = { id: --tempId, menu_item_id: m.id, name: m.name, unit_price: m.price, quantity: 0 };
      state.items.push(item);
    }
    changeQty(item, 1);
  });

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
        toast(`${table.name} order saved`);
        location.hash = '#/';
      });
    } else if (t.id === 'print-bill') {
      act(t, async () => {
        await queue;
        await q(sb.rpc('generate_bill', { p_order_id: state.order.id }));
        document.body.classList.remove('sheet-open');
        location.hash = `#/bill/${state.order.id}/print`;
      });
    } else if (t.id === 'pay') {
      act(t, async () => {
        await queue;
        const paid = await receivePayment({ orderId: state.order.id, tableName: table.name, total: bill().total });
        if (paid) { document.body.classList.remove('sheet-open'); location.hash = '#/'; }
      });
    }
    else if (t.id === 'clear') {
      if (!confirm(`Clear all items from ${table.name}? This can’t be undone.`)) return;
      enqueue(async () => {
        await q(sb.from('orders').delete().eq('id', state.order.id));
        state.order = null; state.items = [];
        render();
        toast(`${table.name} cleared`);
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
  const [order, settings] = await Promise.all([
    q(sb.from('orders').select('*, dining_tables(name), order_items(*)').eq('id', orderId).order('id', { referencedTable: 'order_items' }).single()),
    getSettings(),
  ]);
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
                 <a class="button secondary" href="#/">Tables</a>`
          : html`<a class="button secondary" href="#/table/${order.table_id}">Add Items</a>
                 <button type="button" class="secondary" id="print">Print Again</button>
                 <button type="button" id="pay">Receive Payment</button>`}
      </div>
      ${paid ? html`<p class="paid-note no-print">Paid by ${order.payment_method} · ${dateTime(order.closed_at)}</p>`
             : html`<p class="paid-note no-print">Give this bill to ${order.dining_tables.name}. Tap Receive Payment once they pay.</p>`}
      <article class="receipt" aria-label="Bill">
        <div class="center">
          <div class="shop">${settings.hotel_name}</div>
          ${settings.hotel_address ? html`<div>${settings.hotel_address}</div>` : ''}
          ${settings.hotel_phone ? html`<div>Ph: ${settings.hotel_phone}</div>` : ''}
          ${settings.hotel_gstin && rate > 0 ? html`<div>GSTIN: ${settings.hotel_gstin}</div>` : ''}
        </div>
        <div class="rule"></div>
        ${kv(order.bill_no ? `Bill: ${order.bill_no}` : 'Bill', `Table: ${order.dining_tables.name}`)}
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
    </div>`);
  document.getElementById('print').addEventListener('click', () => window.print());
  document.getElementById('pay')?.addEventListener('click', async () => {
    const billNo = await receivePayment({ orderId: order.id, tableName: order.dining_tables.name, total: b.total });
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
  const [orders, settings, unpaid] = await Promise.all([
    q(sb.from('orders').select('*, dining_tables(name), order_items(quantity, unit_price)').eq('status', 'paid')
      .gte('closed_at', start.toISOString()).lt('closed_at', end.toISOString()).order('closed_at', { ascending: false })),
    getSettings(),
    q(sb.from('orders').select('*, dining_tables(name), order_items(quantity, unit_price)').eq('status', 'open')
      .not('billed_at', 'is', null).order('billed_at')),
  ]);
  if (token !== renderToken) return;
  const rows = orders.map((o) => ({ o, b: orderBill(o, o.order_items, o.tax_rate_bp ?? settings.tax_rate_bp) }));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.b.total, 0);
  const isToday = day === localDay();
  setHTML($view, html`
    <div class="page-head">
      <div><h1>Bills</h1><p class="muted">${isToday ? 'Today' : new Date(start).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <label style="min-width:180px">Date <input type="date" id="day" value="${day}" max="${localDay()}"></label>
    </div>
    ${unpaid.length ? html`
      <h3 style="margin-top:0">Waiting for payment</h3>
      <div class="list" style="margin-bottom:20px">${unpaid.map((o) => html`
        <a class="list-row" href="#/bill/${o.id}">
          <span class="grow"><strong>${o.bill_no}</strong> · ${o.dining_tables.name}<div class="sub">Printed ${time(o.billed_at)} · not paid yet</div></span>
          <span class="money">${rs(orderBill(o, o.order_items, settings.tax_rate_bp).total)}</span><span class="chevron" aria-hidden="true">›</span>
        </a>`)}</div>` : ''}
    <h3 style="margin-top:0">Paid</h3>
    <div class="stats">
      <div class="stat lead"><span>Total sales</span><strong>${rs(sum(() => true))}</strong></div>
      ${METHODS.map((m) => html`<div class="stat"><span>${m}</span><strong>${rs(sum((r) => r.o.payment_method === m))}</strong></div>`)}
      <div class="stat"><span>Bills</span><strong>${rows.length}</strong></div>
    </div>
    ${rows.length ? html`<div class="list">${rows.map(({ o, b }) => html`
      <a class="list-row" href="#/bill/${o.id}">
        <span class="grow"><strong>${o.bill_no}</strong> · ${o.dining_tables.name}<div class="sub">${time(o.closed_at)} · ${o.payment_method}</div></span>
        <span class="money">${rs(b.total)}</span><span class="chevron" aria-hidden="true">›</span>
      </a>`)}</div>`
    : html`<div class="card empty">No bills ${isToday ? 'yet today' : 'on this day'}. Settled bills appear here.</div>`}`);
  document.getElementById('day').addEventListener('change', (e) => { location.hash = `#/bills/${e.target.value}`; });
}

// ---------- Menu ----------

async function menuView(token) {
  const menu = await q(sb.from('menu_items').select('*').order('category').order('name'));
  if (token !== renderToken) return;
  const categories = [...new Set(menu.map((m) => m.category))];
  const suggestions = ['Starters', 'Main Course', 'Breads', 'Rice', 'Beverages', 'Desserts', ...categories]
    .filter((c, i, a) => a.indexOf(c) === i);
  const root = mount(html`
    <div class="page-head"><div><h1>Menu</h1><p class="muted">${menu.length} item${menu.length === 1 ? '' : 's'}</p></div></div>
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
          <label>Category <input name="category" list="cats" required placeholder="e.g. Main Course" value="${categories[0] ?? ''}"></label>
          <label>Rate (₹) <input name="price" inputmode="decimal" required placeholder="0"></label>
        </div>
        <label class="toggle"><input type="checkbox" name="is_veg" checked> Vegetarian</label>
        <button type="submit">Add to Menu</button>
      </form>
    </div>
    <datalist id="cats">${suggestions.map((c) => html`<option value="${c}">`)}</datalist>
    <dialog id="edit-item" aria-labelledby="edit-title"></dialog>`);

  const $dialog = root.querySelector('#edit-item');

  function openEditor(m) {
    setHTML($dialog, html`
      <form class="dialog-body" id="edit-form" novalidate>
        <h2 id="edit-title" style="margin:0">Edit Item</h2>
        <div class="auth-alert error" role="alert" hidden></div>
        <label>Name <input name="name" value="${m.name}" required autocomplete="off"></label>
        <div class="row">
          <label>Category <input name="category" list="cats" value="${m.category}" required></label>
          <label>Rate (₹) <input name="price" inputmode="decimal" value="${plain(m.price)}" required></label>
        </div>
        <label class="toggle"><input type="checkbox" name="is_veg" ${m.is_veg ? new Raw('checked') : ''}> Vegetarian</label>
        <label class="toggle"><input type="checkbox" name="available" ${m.available ? new Raw('checked') : ''}> Available today</label>
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
      if (!f.category.trim()) return fail('Enter a category, like Starters or Main Course.');
      let price;
      try { price = toPaise(f.price); } catch (err) { return fail(err.message); }
      if (!f.price.trim()) return fail('Enter the rate in rupees.');
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      sb.from('menu_items').update({
        name: f.name.trim(), category: f.category.trim(), price, is_veg: f.is_veg === 'on', available: f.available === 'on',
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
    await q(sb.from('menu_items').insert({ name: f.name.trim(), category: f.category.trim(), price, is_veg: f.is_veg === 'on' }));
    toast(`${f.name.trim()} added`);
    form.reset();
    menuView(renderToken);
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset.avail) return;
    act(null, async () => {
      await q(sb.from('menu_items').update({ available: el.checked }).eq('id', el.dataset.avail));
      menuView(renderToken);
    });
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) openEditor(menu.find((x) => x.id === Number(b.dataset.edit)));
  });
}

// ---------- Settings ----------

async function settingsView(token) {
  const [s, staff, tables] = await Promise.all([
    getSettings(),
    q(sb.from('staff').select('*').order('created_at')),
    q(sb.from('dining_tables').select('*').order('sort').order('name')),
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
        <button type="submit">Save Changes</button>
      </form>
      <div>
        <div class="card">
          <h2>Tables</h2>
          <div class="table-chips">${tables.map((t) => html`
            <span class="table-chip">${t.name}<button type="button" class="destructive" data-del-table="${t.id}" aria-label="Remove table ${t.name}">✕</button></span>`)}
          </div>
          <form id="add-table" class="row">
            <input name="name" placeholder="e.g. T9 or Parcel" required aria-label="New table name">
            <button type="submit" class="secondary">Add Table</button>
          </form>
        </div>
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
    await q(sb.from('settings').update({
      hotel_name: f.hotel_name.trim(), hotel_address: f.hotel_address.trim(), hotel_phone: f.hotel_phone.trim(),
      hotel_gstin: (f.hotel_gstin ?? s.hotel_gstin).trim().toUpperCase(), tax_rate_bp: rate,
    }).eq('id', 1));
    document.getElementById('brand').textContent = f.hotel_name.trim();
    toast('Changes saved');
  });
  onSubmit(root, '#add-table', async (f) => {
    await q(sb.from('dining_tables').insert({ name: f.name.trim(), sort: tables.length + 1 }));
    toast(`Table ${f.name.trim()} added`);
    settingsView(renderToken);
  });
  onSubmit(root, '#add-staff', async (f) => {
    await q(sb.from('staff').insert({ email: f.email.trim().toLowerCase() }));
    toast('Staff added');
    settingsView(renderToken);
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'signout') sb.auth.signOut();
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

// ---------- routing ----------

const routes = [
  [/^\/?$/, tablesView, 'tables'],
  [/^\/table\/(\d+)$/, tableView, 'tables'],
  [/^\/bill\/(\d+)(\/print)?$/, billView, 'tables'],
  [/^\/bills(?:\/(\d{4}-\d{2}-\d{2}))?$/, billsView, 'bills'],
  [/^\/menu$/, menuView, 'menu'],
  [/^\/settings$/, settingsView, 'settings'],
];

async function route() {
  const token = ++renderToken;
  document.body.classList.remove('sheet-open');
  if (!session) return signInView();
  if (recoveringPassword) return authViews.newPassword();
  staffCheck ??= sb.rpc('is_staff').then((r) => r.data === true);
  if (!(await staffCheck)) {
    staffCheck = null;
    document.body.classList.add('signed-out');
    const { root } = authScreen({
      iconName: 'lock',
      title: 'Waiting for access',
      subtitle: '',
      body: html`
        <p class="auth-text"><strong>${session.user.email}</strong> isn’t on the staff list yet. Ask the owner to add this email in
          Settings → Staff, then tap Try Again.</p>
        <button type="button" class="wide" id="retry">Try Again</button>
        <button type="button" class="wide secondary" id="signout2">Use a Different Account</button>`,
    });
    root.querySelector('#retry').onclick = () => route();
    document.getElementById('signout2').onclick = () => sb.auth.signOut();
    return;
  }
  document.body.classList.remove('signed-out');
  document.getElementById('who').textContent = session.user.email;
  const path = location.hash.replace(/^#/, '') || '/';
  for (const [re, view, tab] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    try {
      await view(token, ...m.slice(1).filter(Boolean));
      if (token === renderToken) window.scrollTo(0, 0);
    } catch (err) {
      if (token === renderToken) setHTML($view, html`<div class="card empty">${friendly(err)}<br><br><a href="#/">Back to Tables</a></div>`);
    }
    return;
  }
  setHTML($view, html`<div class="card empty">Page not found. <a href="#/">Back to Tables</a></div>`);
}

document.getElementById('logout').addEventListener('click', () => sb.auth.signOut());
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange((event, s) => {
  const changed = (s?.user.id) !== (session?.user.id);
  session = s;
  if (changed) staffCheck = null;
  if (event === 'PASSWORD_RECOVERY') { recoveringPassword = true; setTimeout(route, 0); return; }
  if (event === 'SIGNED_OUT') { recoveringPassword = false; lastEmail = ''; }
  // Defer: calling Supabase from inside this callback can deadlock the auth client.
  if (changed || event === 'INITIAL_SESSION') setTimeout(route, 0);
});
// Show the restaurant name in the top bar once signed in.
sb.auth.getSession().then(({ data }) => data.session && getSettings().then((s) => { document.getElementById('brand').textContent = s.hotel_name; }).catch(() => {}));
