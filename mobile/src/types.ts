export interface Account {
  super_admin: boolean;
  staff: boolean;
  role?: 'owner' | 'manager' | 'staff';
  can_bill?: boolean;
  active?: boolean;
  paused_reason?: string;
  hotel?: string;
  features?: Record<string, boolean>;
}

export interface Settings {
  id: number;
  hotel_name: string;
  hotel_address: string;
  hotel_phone: string;
  hotel_gstin: string;
  tax_rate_bp: number;
  quick_close: boolean | null;
  kot_tables: boolean;
  staff_limit?: number | null;
  table_layout?: TableLayout | null;
}

/** Optional floor plan: areas (Hall 1, Garden…) each with a grid; cells hold a table id or null (an empty spot). */
/** cells: a table id, null for a free (grey) spot, BLANK for empty floor, or a negative fixture (Bill Counter…). A table in two side-by-side cells is a big table. */
export interface LayoutArea { id: string; name: string; cols: number; rows: number; cells: (number | null)[] }
export const BLANK = 0;
/** Table ids placed in an area, each once (a big table fills two cells). */
export const areaTables = (a: LayoutArea) => [...new Set(a.cells.filter((c): c is number => c != null && c > 0))];
/** Fixed places on a plan (not tables): stored as negative numbers, -(kind × 100 + n), so two of a kind stay apart. */
export const FIXTURES = { 1: 'Bill Counter', 2: 'Kitchen', 3: 'Entrance', 4: 'Washroom' } as const;
export type FixtureKind = keyof typeof FIXTURES;
export const fixtureKind = (v: number) => Math.floor(-v / 100) as FixtureKind;
export const newFixture = (a: LayoutArea, kind: FixtureKind) => {
  let n = 1; while (a.cells.includes(-(kind * 100 + n))) n++;
  return -(kind * 100 + n);
};
/** One thing drawn on a plan: a table block (w spots across, h down), a free grey spot, or blank floor. */
export interface PlanItem { kind: 'table' | 'fixture' | 'free' | 'blank'; id: number | null; r: number; c: number; w: number; h: number }
/** Read an area's cells as blocks: a table's cells form a rectangle (its top-left cell is where it starts). */
export const planItems = (a: LayoutArea): PlanItem[] => {
  const at = (r: number, c: number) => (r < a.rows && c < a.cols ? a.cells[r * a.cols + c] : undefined);
  const seen = new Set<number>(); const out: PlanItem[] = [];
  for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) {
    const id = at(r, c);
    if (id == null) { out.push({ kind: 'free', id: null, r, c, w: 1, h: 1 }); continue; }
    if (id === BLANK) { out.push({ kind: 'blank', id, r, c, w: 1, h: 1 }); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    let w = 1; while (at(r, c + w) === id) w++;
    let h = 1; while (at(r + h, c) === id) h++;
    out.push({ kind: id > 0 ? 'table' : 'fixture', id, r, c, w, h });
  }
  return out;
};
export interface TableLayout { on: boolean; areas: LayoutArea[] }

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  is_veg: boolean;
  available: boolean;
  is_favorite: boolean;
}

export interface Table { id: number; name: string; sort: number }

export interface OrderItem {
  id: number;
  menu_item_id: number | null;
  name: string;
  unit_price: number;
  quantity: number;
  kot_qty: number;
}

export interface Order {
  id: number;
  table_id: number | null;
  section: string;
  is_parcel: boolean;
  status: 'open' | 'paid';
  discount: number;
  bill_no: string | null;
  billed_at: string | null;
  opened_at: string;
  is_split?: boolean;
  items: OrderItem[];
}

/** Where an order lives: a table section, or a parcel (new or saved). */
export type OrderKey = string; // "t:<tableId>:<section>" | "p:<orderId>" | "p:new"
export const tableKey = (tableId: number, section = 'A'): OrderKey => `t:${tableId}:${section}`;
export const parcelKey = (orderId?: number | null): OrderKey => (orderId ? `p:${orderId}` : 'p:new');
export const keyOf = (o: Order): OrderKey => (o.is_parcel ? parcelKey(o.id) : tableKey(o.table_id as number, o.section));

export interface Room { id: number; number: string; room_type: string; rate: number; sort: number }
export interface StayCharge { id: number; description: string; quantity: number; unit_price: number }
export interface Stay {
  id: number; room_id: number; guest_name: string; guest_phone: string; guests: number;
  check_in: string; check_out: string; rate: number; discount: number; status: 'open' | 'paid';
  bill_no: string | null; payment_method: string | null; tax_rate_bp: number | null; closed_at: string | null;
  lodging_rooms?: { number: string; room_type: string }; stay_charges: StayCharge[];
}
