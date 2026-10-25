import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { q, sb } from '../supabase';
import { keyOf, type MenuItem, type Order, type OrderKey, type Settings, type Table } from '../types';

/** Server data the app shows. Loaded once on start; after that only open orders are re-read (on live events). */
interface DataState {
  settings: Settings | null;
  menu: MenuItem[];
  tables: Table[];
  orders: Record<OrderKey, Order>;   // open orders by where they are
  loading: boolean;
  error: string | null;
  loadedAt: number;
}

const initialState: DataState = { settings: null, menu: [], tables: [], orders: {}, loading: false, error: null, loadedAt: 0 };

const ORDER_COLUMNS = 'id, table_id, section, is_parcel, status, discount, bill_no, billed_at, opened_at, is_split, items:order_items(id, menu_item_id, name, unit_price, quantity, kot_qty)';

export const fetchOpenOrders = async (): Promise<Order[]> =>
  q(sb.from('orders').select(ORDER_COLUMNS).eq('status', 'open').order('id').order('id', { referencedTable: 'order_items' }));

/** Everything the hotel screens need, in 4 requests at once. */
export const loadAll = createAsyncThunk('data/loadAll', async () => {
  const [settings, menu, tables, orders] = await Promise.all([
    q<Settings>(sb.from('restaurants').select('id, hotel_name, hotel_address, hotel_phone, hotel_gstin, tax_rate_bp, quick_close, kot_tables, staff_limit').single()),
    q<MenuItem[]>(sb.from('menu_items').select('id, name, category, price, is_veg, available, is_favorite').order('id')),
    q<Table[]>(sb.from('dining_tables').select('id, name, sort').order('sort').order('name')),
    fetchOpenOrders(),
  ]);
  return { settings, menu, tables, orders };
});

const MENU_COLUMNS = 'id, name, category, price, is_veg, available, is_favorite';
/** After the owner edits the menu, tables or settings: re-read just that part. */
export const reloadMenu = createAsyncThunk('data/reloadMenu', () => q<MenuItem[]>(sb.from('menu_items').select(MENU_COLUMNS).order('id')));
export const reloadTables = createAsyncThunk('data/reloadTables', () => q<Table[]>(sb.from('dining_tables').select('id, name, sort').order('sort').order('name')));
export const reloadSettings = createAsyncThunk('data/reloadSettings', () => q<Settings>(sb.from('restaurants').select('id, hotel_name, hotel_address, hotel_phone, hotel_gstin, tax_rate_bp, quick_close, kot_tables, staff_limit').single()));

/** Only the open orders (1 request): used when another phone changes an order. */
export const refreshOrders = createAsyncThunk('data/refreshOrders', fetchOpenOrders);

const byKey = (orders: Order[]) => Object.fromEntries(orders.map((o) => [keyOf(o), o]));

const data = createSlice({
  name: 'data',
  initialState,
  reducers: {
    /** The server's copy of one order after a save (no extra request needed). */
    orderSaved(state, a: PayloadAction<Order>) {
      const o = a.payload;
      if (o.status === 'open') state.orders[keyOf(o)] = o;
      else delete state.orders[keyOf(o)];
    },
    orderClosed(state, a: PayloadAction<OrderKey>) {
      delete state.orders[a.payload];
    },
    /** Change a menu item on this phone at once (the switch moves instantly); the save happens behind. */
    patchMenuItem(state, a: PayloadAction<Partial<MenuItem> & { id: number }>) {
      const m = state.menu.find((x) => x.id === a.payload.id);
      if (m) Object.assign(m, a.payload);
    },
    reset: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(loadAll.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(loadAll.fulfilled, (s, a) => {
      Object.assign(s, { ...a.payload, orders: byKey(a.payload.orders), loading: false, error: null, loadedAt: Date.now() });
    });
    b.addCase(loadAll.rejected, (s, a) => { s.loading = false; s.error = a.error.message ?? 'Couldn’t load'; });
    b.addCase(reloadMenu.fulfilled, (s, a) => { s.menu = a.payload; });
    b.addCase(reloadTables.fulfilled, (s, a) => { s.tables = a.payload; });
    b.addCase(reloadSettings.fulfilled, (s, a) => { s.settings = a.payload; });
    b.addCase(refreshOrders.fulfilled, (s, a) => { s.orders = byKey(a.payload); });
  },
});

export const { orderSaved, orderClosed, patchMenuItem, reset: resetData } = data.actions;
export default data.reducer;
