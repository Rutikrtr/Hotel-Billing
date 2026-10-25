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
}

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
