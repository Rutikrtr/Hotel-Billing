import sqlite3

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    room_type TEXT NOT NULL,
    rate INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL DEFAULT '',
    guest_address TEXT NOT NULL DEFAULT '',
    guest_gstin TEXT NOT NULL DEFAULT '',
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    rate INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'checked_in' CHECK (status IN ('checked_in', 'checked_out')),
    invoice_no TEXT UNIQUE,
    tax_rate_bp INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS extras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL,
    paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

DEFAULT_SETTINGS = {
    "hotel_name": "My Hotel",
    "hotel_address": "",
    "hotel_phone": "",
    "hotel_gstin": "",
    "tax_rate_bp": "1200",
}


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(SCHEMA)
    for key, value in DEFAULT_SETTINGS.items():
        db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))
    db.commit()


def get_settings():
    rows = get_db().execute("SELECT key, value FROM settings").fetchall()
    return {**DEFAULT_SETTINGS, **{r["key"]: r["value"] for r in rows}}
