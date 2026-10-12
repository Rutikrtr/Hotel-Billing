import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { buildBill, fmt, nightsBetween, plain, toPaise } from './billing.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const PAYMENT_METHODS = ['Cash', 'Card', 'UPI', 'Bank transfer'];
const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
let session = null;
let staffCheck = null; // cached is_staff() result for the current session

// ---------- small helpers ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
/** Tagged template that HTML-escapes every interpolated value unless wrapped in raw() or produced by html``. */
function html(strings, ...values) {
  const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v === false || v == null ? '' : esc(v));
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));
}
const render = (tpl) => { $view.innerHTML = tpl.s; };
const rupees = (p) => `₹${fmt(p)}`;
const today = () => new Date().toLocaleDateString('en-CA');
const pct = (bp) => `${+(bp / 100).toFixed(2)}%`;

function flash(message, kind = 'success') {
  const el = document.getElementById('flash');
  el.innerHTML = html`<div class="flash ${kind}">${message}</div>`.s;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function friendly(error) {
  const msg = error?.message || String(error);
  if (/bookings_one_active_per_room/.test(msg)) return 'That room already has a guest checked in';
  if (/rooms_number_key/.test(msg)) return 'A room with that number already exists';
  if (/bookings_room_id_fkey/.test(msg)) return 'Cannot delete a room that has bookings';
  if (/row-level security/.test(msg)) return 'You do not have permission to do that';
  return msg;
}

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

/** Wire a form's submit to an async handler, showing errors as flash messages. */
function onSubmit(selector, handler) {
  document.querySelectorAll(selector).forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    if (form.dataset.confirm && !confirm(form.dataset.confirm)) return;
    btn && (btn.disabled = true);
    try {
      await handler(Object.fromEntries(new FormData(form)), form);
    } catch (err) {
      flash(friendly(err), 'error');
    } finally {
      btn && (btn.disabled = false);
    }
  }));
}

// ---------- auth ----------

function loginView() {
  $nav.hidden = true;
  render(html`
    <div class="login">
      <h1>Hotel Billing</h1>
      <p class="small">Sign in with your staff account.</p>
      <form id="auth" class="stack">
        <label>Email <input type="email" name="email" autocomplete="email" required></label>
        <label>Password <input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
        <div class="row">
          <button name="mode" value="in">Sign in</button>
          <button type="button" id="signup" class="secondary">Create account</button>
        </div>
      </form>
      <p class="small">New staff: create an account with the email the owner added in Settings.
        You'll get a confirmation email – click the link, then come back here and sign in.</p>
    </div>`);
  const form = document.getElementById('auth');
  onSubmit('#auth', async ({ email, password }) => {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  });
  document.getElementById('signup').addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    const { email, password } = Object.fromEntries(new FormData(form));
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
    if (error) return flash(friendly(error), 'error');
    flash(data.session ? 'Account created' : 'Account created. Check your email for the confirmation link, then sign in.');
  });
}

// ---------- views ----------

async function dashboard() {
  const [rooms, active, payments, open] = await Promise.all([
    q(sb.from('rooms').select('*').order('number')),
    q(sb.from('bookings').select('id, room_id, guest_name, check_out').eq('status', 'checked_in')),
    q(sb.from('payments').select('amount').gte('paid_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())),
    loadOutstanding(),
  ]);
  const byRoom = Object.fromEntries(active.map((b) => [b.room_id, b]));
  render(html`
    <h1>Dashboard</h1>
    <div class="stats">
      <div class="stat"><span>Occupied rooms</span><strong>${active.length} / ${rooms.length}</strong></div>
      <div class="stat"><span>Collected today</span><strong>${rupees(payments.reduce((s, p) => s + p.amount, 0))}</strong></div>
      <div class="stat"><span>Outstanding balance</span><strong>${rupees(open)}</strong></div>
    </div>
    <h2>Rooms</h2>
    ${rooms.length ? '' : html`<p>No rooms yet. <a href="#/rooms">Add your rooms</a> to get started.</p>`}
    <div class="room-grid">
      ${rooms.map((r) => { const b = byRoom[r.id]; return html`
        <div class="room ${b ? 'occupied' : 'free'}">
          <strong>${r.number}</strong><span>${r.room_type}</span>
          ${b ? html`<a href="#/booking/${b.id}">${b.guest_name}</a><small>Out: ${b.check_out}</small>`
              : html`<small>Available · ${rupees(r.rate)}/night</small>`}
        </div>`; })}
    </div>`);
}

async function loadOutstanding() {
  const [settings, bookings] = await Promise.all([
    q(sb.from('settings').select('tax_rate_bp').single()),
    q(sb.from('bookings').select('*, rooms(*), extras(*), payments(*)')),
  ]);
  return bookings.reduce((sum, b) => {
    const bill = buildBill(b, b.rooms, b.extras, b.payments, b.tax_rate_bp ?? settings.tax_rate_bp);
    return sum + Math.max(0, bill.balance);
  }, 0);
}

async function roomsView() {
  const [rooms, active, used] = await Promise.all([
    q(sb.from('rooms').select('*').order('number')),
    q(sb.from('bookings').select('room_id').eq('status', 'checked_in')),
    q(sb.from('bookings').select('room_id')),
  ]);
  const occupied = new Set(active.map((b) => b.room_id));
  const hasBookings = new Set(used.map((b) => b.room_id));
  render(html`
    <h1>Rooms</h1>
    <form id="add-room" class="inline-form">
      <input name="number" placeholder="Room no." required>
      <input name="room_type" placeholder="Type (e.g. Deluxe)" required>
      <input name="rate" placeholder="Rate per night" inputmode="decimal" required>
      <button>Add room</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>Room</th><th>Type</th><th>Rate / night (₹)</th><th>Status</th><th></th></tr></thead>
      <tbody>
      ${rooms.length ? rooms.map((r) => html`
        <tr>
          <td>${r.number}</td><td>${r.room_type}</td>
          <td><form class="rate-form inline-form compact" data-id="${r.id}">
            <input name="rate" value="${plain(r.rate)}" inputmode="decimal" required>
            <button class="secondary">Save</button></form></td>
          <td>${occupied.has(r.id) ? 'Occupied' : 'Available'}</td>
          <td>${hasBookings.has(r.id) ? '' : html`<form class="del-room" data-id="${r.id}" data-confirm="Delete room ${r.number}?"><button class="danger">Delete</button></form>`}</td>
        </tr>`) : html`<tr><td colspan="5">No rooms yet.</td></tr>`}
      </tbody>
    </table></div>`);
  onSubmit('#add-room', async (f) => {
    await q(sb.from('rooms').insert({ number: f.number.trim(), room_type: f.room_type.trim(), rate: toPaise(f.rate) }));
    flash(`Room ${f.number} added`);
    roomsView();
  });
  onSubmit('.rate-form', async (f, form) => {
    await q(sb.from('rooms').update({ rate: toPaise(f.rate) }).eq('id', form.dataset.id));
    flash('Rate updated');
  });
  onSubmit('.del-room', async (_f, form) => {
    await q(sb.from('rooms').delete().eq('id', form.dataset.id));
    flash('Room deleted');
    roomsView();
  });
}

async function bookingsView(status = '') {
  let query = sb.from('bookings').select('*, rooms(number)').order('id', { ascending: false });
  if (status) query = query.eq('status', status);
  const rows = await q(query);
  const tab = (s, label) => html`<a href="#/bookings${s ? '/' + s : ''}" class="${status === s ? 'active' : ''}">${label}</a>`;
  render(html`
    <h1>Bookings</h1>
    <p class="filters">${tab('', 'All')}${tab('checked_in', 'In house')}${tab('checked_out', 'Checked out')}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Status</th><th>Invoice</th></tr></thead>
      <tbody>
      ${rows.length ? rows.map((b) => html`
        <tr>
          <td><a href="#/booking/${b.id}">${b.id}</a></td>
          <td><a href="#/booking/${b.id}">${b.guest_name}</a></td>
          <td>${b.rooms.number}</td><td>${b.check_in}</td><td>${b.check_out}</td>
          <td>${b.status === 'checked_in' ? 'In house' : 'Checked out'}</td>
          <td>${b.invoice_no ? html`<a href="#/invoice/${b.id}">${b.invoice_no}</a>` : ''}</td>
        </tr>`) : html`<tr><td colspan="7">No bookings.</td></tr>`}
      </tbody>
    </table></div>`);
}

async function checkinView() {
  const [rooms, active] = await Promise.all([
    q(sb.from('rooms').select('*').order('number')),
    q(sb.from('bookings').select('room_id').eq('status', 'checked_in')),
  ]);
  const busy = new Set(active.map((b) => b.room_id));
  const free = rooms.filter((r) => !busy.has(r.id));
  if (!free.length) return render(html`<h1>Check in guest</h1><p>No rooms are available. <a href="#/rooms">Manage rooms</a></p>`);
  render(html`
    <h1>Check in guest</h1>
    <form id="checkin" class="stack">
      <label>Room <select name="room_id" required>
        ${free.map((r) => html`<option value="${r.id}">${r.number} – ${r.room_type} (${rupees(r.rate)}/night)</option>`)}
      </select></label>
      <label>Guest name <input name="guest_name" required></label>
      <label>Phone <input name="guest_phone" type="tel"></label>
      <label>Address <textarea name="guest_address" rows="2"></textarea></label>
      <label>Guest GSTIN (optional) <input name="guest_gstin"></label>
      <div class="row">
        <label>Check-in <input type="date" name="check_in" value="${today()}" required></label>
        <label>Expected check-out <input type="date" name="check_out" required></label>
      </div>
      <label>Rate per night (leave blank for room's default) <input name="rate" inputmode="decimal"></label>
      <button>Check in</button>
    </form>`);
  onSubmit('#checkin', async (f) => {
    nightsBetween(f.check_in, f.check_out);
    const room = free.find((r) => r.id === Number(f.room_id));
    const booking = await q(sb.from('bookings').insert({
      room_id: room.id, guest_name: f.guest_name.trim(), guest_phone: f.guest_phone.trim(),
      guest_address: f.guest_address.trim(), guest_gstin: f.guest_gstin.trim().toUpperCase(),
      check_in: f.check_in, check_out: f.check_out, rate: toPaise(f.rate) || room.rate,
    }).select().single());
    flash(`${booking.guest_name} checked in to room ${room.number}`);
    location.hash = `#/booking/${booking.id}`;
  });
}

async function loadBooking(id) {
  const [booking, settings] = await Promise.all([
    q(sb.from('bookings').select('*, rooms(*), extras(*), payments(*)').eq('id', id).order('id', { referencedTable: 'extras' }).order('id', { referencedTable: 'payments' }).single()),
    q(sb.from('settings').select('*').single()),
  ]);
  const taxRateBp = booking.tax_rate_bp ?? settings.tax_rate_bp;
  const bill = buildBill(booking, booking.rooms, booking.extras, booking.payments, taxRateBp);
  return { booking, room: booking.rooms, settings, taxRateBp, bill };
}

function billTable({ bill, taxRateBp }, editable) {
  const extraCol = editable ? html`<td class="no-print"></td>` : '';
  const row = (label, value, cls = '') => html`<tr class="${cls}"><td colspan="3">${label}</td><td class="num">${value}</td>${extraCol}</tr>`;
  return html`
    <div class="table-wrap"><table class="bill">
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate (₹)</th><th class="num">Amount (₹)</th>${editable ? html`<th class="no-print"></th>` : ''}</tr></thead>
      <tbody>
        ${bill.lines.map((l, i) => html`
          <tr>
            <td>${l.description}</td><td class="num">${l.quantity}</td>
            <td class="num">${fmt(l.unitPrice)}</td><td class="num">${fmt(l.quantity * l.unitPrice)}</td>
            ${editable ? html`<td class="no-print">${i ? html`<form class="del-extra" data-id="${l.id}"><button class="link danger" title="Remove">✕</button></form>` : ''}</td>` : ''}
          </tr>`)}
      </tbody>
      <tfoot>
        ${row('Subtotal', fmt(bill.subtotal))}
        ${bill.discount ? row('Discount', `-${fmt(bill.discount)}`) : ''}
        ${bill.tax ? [row(`CGST @ ${pct(taxRateBp / 2)}`, fmt(bill.cgst)), row(`SGST @ ${pct(taxRateBp / 2)}`, fmt(bill.sgst))] : ''}
        ${row('Total', rupees(bill.total), 'total')}
        ${row('Paid', fmt(bill.paid))}
        ${row(bill.balance >= 0 ? 'Balance due' : 'Refund due', rupees(Math.abs(bill.balance)), 'total')}
      </tfoot>
    </table></div>`;
}

async function bookingView(id) {
  const ctx = await loadBooking(id);
  const { booking, room, bill } = ctx;
  const open = booking.status === 'checked_in';
  render(html`
    <h1>${booking.guest_name} <small>· Room ${room.number} · ${open ? 'In house' : 'Checked out'}</small></h1>
    <p>${booking.check_in} → ${booking.check_out}
      ${booking.guest_phone ? html`· ${booking.guest_phone}` : ''}
      ${booking.invoice_no ? html`· Invoice <strong>${booking.invoice_no}</strong>` : ''}</p>
    ${billTable(ctx, open)}
    <div class="panels">
      ${open ? html`
      <section>
        <h2>Add charge</h2>
        <form id="add-extra" class="stack">
          <input name="description" placeholder="e.g. Restaurant, Laundry, Minibar" list="extra-suggestions" required>
          <datalist id="extra-suggestions">
            ${['Restaurant', 'Room service', 'Laundry', 'Minibar', 'Extra bed', 'Airport transfer'].map((s) => html`<option value="${s}">`)}
          </datalist>
          <div class="row">
            <input name="quantity" type="number" min="1" value="1" aria-label="Quantity">
            <input name="unit_price" placeholder="Unit price" inputmode="decimal" required>
          </div>
          <button>Add charge</button>
        </form>
      </section>
      <section>
        <h2>Stay</h2>
        <form id="stay" class="stack">
          <label>Check-out date <input type="date" name="check_out" value="${booking.check_out}" min="${booking.check_in}" required></label>
          <label>Discount (₹) <input name="discount" inputmode="decimal" value="${plain(booking.discount)}"></label>
          <button class="secondary">Update</button>
        </form>
      </section>` : ''}
      <section>
        <h2>Record payment</h2>
        <form id="pay" class="stack">
          <input name="amount" placeholder="Amount" inputmode="decimal" value="${bill.balance > 0 ? plain(bill.balance) : ''}" required>
          <select name="method">${PAYMENT_METHODS.map((m) => html`<option>${m}</option>`)}</select>
          <button>Record payment</button>
        </form>
        ${booking.payments.length ? html`<ul class="payments">${booking.payments.map((p) => html`
          <li>${new Date(p.paid_at).toLocaleString('en-IN')} · ${p.method} · ${rupees(p.amount)}</li>`)}</ul>` : ''}
      </section>
    </div>
    <div class="actions">
      ${open ? html`<form id="checkout" data-confirm="Check out and generate the final invoice? Charges cannot be changed afterwards."><button>Check out &amp; generate invoice</button></form>` : ''}
      <a class="button secondary" href="#/invoice/${booking.id}">${open ? 'Preview bill' : 'Print invoice'}</a>
    </div>`);

  const reload = () => bookingView(id);
  onSubmit('#add-extra', async (f) => {
    const quantity = Number(f.quantity) || 1;
    await q(sb.from('extras').insert({ booking_id: booking.id, description: f.description.trim(), quantity, unit_price: toPaise(f.unit_price) }));
    reload();
  });
  onSubmit('.del-extra', async (_f, form) => {
    await q(sb.from('extras').delete().eq('id', form.dataset.id));
    reload();
  });
  onSubmit('#stay', async (f) => {
    nightsBetween(booking.check_in, f.check_out);
    await q(sb.from('bookings').update({ check_out: f.check_out, discount: toPaise(f.discount) }).eq('id', booking.id));
    flash('Stay updated');
    reload();
  });
  onSubmit('#pay', async (f) => {
    const amount = toPaise(f.amount);
    if (amount <= 0) throw new Error('Payment amount must be greater than zero');
    await q(sb.from('payments').insert({ booking_id: booking.id, amount, method: f.method }));
    flash('Payment recorded');
    reload();
  });
  onSubmit('#checkout', async () => {
    const invoiceNo = await q(sb.rpc('checkout', { p_booking_id: booking.id }));
    flash(`Checked out. Invoice ${invoiceNo} generated`);
    reload();
  });
}

async function invoiceView(id) {
  const ctx = await loadBooking(id);
  const { booking, room, settings: s } = ctx;
  render(html`
    <p class="no-print"><a href="#/booking/${booking.id}">← Back to booking</a> <button id="print">Print</button></p>
    <div class="invoice">
      <header>
        <div>
          <h1>${s.hotel_name}</h1>
          ${s.hotel_address ? html`<p>${s.hotel_address}</p>` : ''}
          ${s.hotel_phone ? html`<p>Phone: ${s.hotel_phone}</p>` : ''}
          ${s.hotel_gstin ? html`<p>GSTIN: ${s.hotel_gstin}</p>` : ''}
        </div>
        <div class="meta">
          <h2>${booking.invoice_no ? 'TAX INVOICE' : 'PROFORMA BILL'}</h2>
          ${booking.invoice_no ? html`<p>Invoice no: <strong>${booking.invoice_no}</strong></p>` : ''}
          <p>Booking #${booking.id}</p>
        </div>
      </header>
      <section class="guest">
        <div>
          <strong>Billed to</strong>
          <p>${booking.guest_name}</p>
          ${booking.guest_address ? html`<p>${booking.guest_address}</p>` : ''}
          ${booking.guest_phone ? html`<p>${booking.guest_phone}</p>` : ''}
          ${booking.guest_gstin ? html`<p>GSTIN: ${booking.guest_gstin}</p>` : ''}
        </div>
        <div>
          <p>Room: ${room.number} (${room.room_type})</p>
          <p>Check-in: ${booking.check_in}</p>
          <p>Check-out: ${booking.check_out}</p>
        </div>
      </section>
      ${billTable(ctx, false)}
      ${booking.payments.length ? html`<p class="small">Payments: ${booking.payments.map((p) => `${p.method} ${rupees(p.amount)}`).join(', ')}</p>` : ''}
      <footer>Thank you for staying with us!</footer>
    </div>`);
  document.getElementById('print').addEventListener('click', () => window.print());
}

async function settingsView() {
  const [s, staff] = await Promise.all([
    q(sb.from('settings').select('*').single()),
    q(sb.from('staff').select('*').order('created_at')),
  ]);
  const me = staff.find((m) => m.user_id === session.user.id);
  const isOwner = me?.role === 'owner';
  render(html`
    <h1>Settings</h1>
    <form id="settings" class="stack">
      <label>Hotel name <input name="hotel_name" value="${s.hotel_name}" required></label>
      <label>Address <textarea name="hotel_address" rows="2">${s.hotel_address}</textarea></label>
      <label>Phone <input name="hotel_phone" value="${s.hotel_phone}"></label>
      <label>GSTIN <input name="hotel_gstin" value="${s.hotel_gstin}"></label>
      <label>GST rate (%) – split equally into CGST and SGST on the invoice
        <input name="tax_rate" inputmode="decimal" value="${+(s.tax_rate_bp / 100).toFixed(2)}"></label>
      <p class="small">The rate applies to open bookings. Issued invoices keep the rate they were created with.</p>
      <button>Save settings</button>
    </form>
    <h2>Staff access</h2>
    <p class="small">Only these email addresses can use the app. New staff create an account on the sign-in page using the email added here.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Email</th><th>Role</th><th>Account</th><th></th></tr></thead>
      <tbody>${staff.map((m) => html`<tr>
        <td>${m.email}</td><td>${m.role}</td><td>${m.user_id ? 'Active' : 'Not signed up yet'}</td>
        <td>${isOwner && m.role !== 'owner' ? html`<form class="del-staff" data-email="${m.email}" data-confirm="Remove ${m.email}?"><button class="danger">Remove</button></form>` : ''}</td>
      </tr>`)}</tbody>
    </table></div>
    ${isOwner ? html`<form id="add-staff" class="inline-form">
      <input type="email" name="email" placeholder="staff@example.com" required><button>Add staff</button></form>` : ''}`);
  onSubmit('#settings', async (f) => {
    const taxRateBp = toPaise(f.tax_rate);
    if (taxRateBp > 10000) throw new Error('Tax rate cannot exceed 100%');
    await q(sb.from('settings').update({
      hotel_name: f.hotel_name.trim(), hotel_address: f.hotel_address.trim(), hotel_phone: f.hotel_phone.trim(),
      hotel_gstin: f.hotel_gstin.trim().toUpperCase(), tax_rate_bp: taxRateBp,
    }).eq('id', 1));
    flash('Settings saved');
  });
  onSubmit('#add-staff', async (f) => {
    await q(sb.from('staff').insert({ email: f.email.trim().toLowerCase() }));
    flash('Staff member added');
    settingsView();
  });
  onSubmit('.del-staff', async (_f, form) => {
    await q(sb.from('staff').delete().eq('email', form.dataset.email));
    settingsView();
  });
}

// ---------- routing ----------

const routes = [
  [/^\/?$/, dashboard],
  [/^\/rooms$/, roomsView],
  [/^\/bookings(?:\/(checked_in|checked_out))?$/, bookingsView],
  [/^\/checkin$/, checkinView],
  [/^\/booking\/(\d+)$/, bookingView],
  [/^\/invoice\/(\d+)$/, invoiceView],
  [/^\/settings$/, settingsView],
];

async function route() {
  if (!session) return loginView();
  staffCheck ??= sb.rpc('is_staff').then((r) => r.data === true);
  if (!(await staffCheck)) {
    staffCheck = null;
    $nav.hidden = true;
    return render(html`<div class="login"><h1>No access</h1>
      <p>${session.user.email} is not on the staff list. Ask the hotel owner to add this email in Settings, then sign in again.</p>
      <button id="logout2">Sign out</button></div>`), document.getElementById('logout2').onclick = () => sb.auth.signOut();
  }
  $nav.hidden = false;
  document.getElementById('who').textContent = session.user.email;
  const path = location.hash.replace(/^#/, '') || '/';
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      try { await view(...m.slice(1)); } catch (err) { render(html`<p class="flash error">${friendly(err)}</p>`); }
      return;
    }
  }
  render(html`<h1>Not found</h1><p><a href="#/">Go to dashboard</a></p>`);
}

document.getElementById('logout').addEventListener('click', () => sb.auth.signOut());
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange((event, s) => {
  const changed = (s?.user.id) !== (session?.user.id);
  session = s;
  if (changed) staffCheck = null;
  // Defer: calling Supabase from inside this callback can deadlock the auth client.
  if (changed || event === 'INITIAL_SESSION') setTimeout(route, 0);
});
