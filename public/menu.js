// Public menu that customers open by scanning a hotel's QR code. No sign-in; it only reads what
// public_menu() returns for the secret link: hotel name, address, phone and the available dishes.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const $app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupees = (p) => `₹${(Number(p) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function note(title, text) {
  $app.innerHTML = `<main><div class="note"><strong>${esc(title)}</strong>${esc(text)}</div></main>`;
}

async function load() {
  const token = new URLSearchParams(location.search).get('m') || location.hash.replace(/^#/, '');
  if (!token) return note('Menu not found', 'Please scan the QR code at your table again.');
  const { data, error } = await sb.rpc('public_menu', { p_token: token });
  if (error) return note('Couldn’t load the menu', 'Check your internet connection and try again.');
  if (!data) return note('Menu not available', 'This menu link has changed or is switched off. Please ask the staff for the latest QR code.');
  render(data);
}

function render(menu) {
  document.title = `${menu.name} · Menu`;
  const cats = [...new Set(menu.items.map((i) => i.c))];
  const state = { cat: 'All', diet: 'all', term: '' };
  const phone = String(menu.phone || '').replace(/[^\d+]/g, '');
  $app.innerHTML = `
    <header class="hero">
      <h1>${esc(menu.name)}</h1>
      ${menu.address ? `<p>${esc(menu.address)}</p>` : ''}
      <div class="actions">${phone ? `<a href="tel:${esc(phone)}">📞 Call ${esc(menu.phone)}</a>` : ''}</div>
    </header>
    <div class="tools">
      <input type="search" id="q" placeholder="Search ${menu.items.length} dishes" aria-label="Search dishes" autocomplete="off">
      <div class="filters" role="group" aria-label="Veg or non-veg">
        <button class="chip" data-diet="all" aria-pressed="true">All</button>
        <button class="chip" data-diet="veg" aria-pressed="false">🟢 Veg</button>
        <button class="chip" data-diet="nonveg" aria-pressed="false">🔴 Non-veg</button>
      </div>
      <div class="chips" role="toolbar" aria-label="Categories">
        ${['All', ...cats].map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === 'All'}">${esc(c)}</button>`).join('')}
      </div>
    </div>
    <main id="list"></main>
    <footer>Ask the staff for today’s specials.<br>Menu by Hotel Billing · Techyverve</footer>`;
  const $list = document.getElementById('list');

  const draw = () => {
    const term = state.term.trim().toLowerCase();
    const shown = menu.items.filter((i) => (state.cat === 'All' || i.c === state.cat || term)
      && (state.diet === 'all' || (state.diet === 'veg') === i.v)
      && (!term || i.n.toLowerCase().includes(term)));
    if (!shown.length) { $list.innerHTML = `<div class="note">No dishes match.</div>`; return; }
    const groups = new Map();
    shown.forEach((i) => { if (!groups.has(i.c)) groups.set(i.c, []); groups.get(i.c).push(i); });
    $list.innerHTML = [...groups].map(([c, items]) => `
      <h2>${esc(c)}</h2>
      <div class="list">${items.map((i) => `
        <div class="dish"><span class="mark ${i.v ? '' : 'nv'}" title="${i.v ? 'Veg' : 'Non-veg'}"></span>
          <span class="name">${esc(i.n)}${i.f ? '<span class="star">★ Popular</span>' : ''}</span>
          <span class="price">${rupees(i.p)}</span></div>`).join('')}</div>`).join('');
  };

  document.getElementById('q').addEventListener('input', (e) => { state.term = e.target.value; draw(); });
  $app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat], [data-diet]');
    if (!b) return;
    if (b.dataset.cat) {
      state.cat = b.dataset.cat;
      $app.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      window.scrollTo({ top: document.querySelector('.tools').offsetTop, behavior: 'smooth' });
    } else {
      state.diet = b.dataset.diet;
      $app.querySelectorAll('[data-diet]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }
    draw();
  });
  draw();
}

load();
