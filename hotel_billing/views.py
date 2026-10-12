import sqlite3
from datetime import date, datetime

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

from .billing import build_bill, nights_between, to_paise
from .db import get_db, get_settings

bp = Blueprint("main", __name__)

PAYMENT_METHODS = ["Cash", "Card", "UPI", "Bank transfer"]


def _money(field, required=False):
    raw = request.form.get(field, "").strip()
    if required and not raw:
        raise ValueError(f"{field.replace('_', ' ').capitalize()} is required")
    return to_paise(raw)


def _get_booking(booking_id):
    booking = get_db().execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
    if booking is None:
        abort(404)
    return booking


def _bill_context(booking):
    db = get_db()
    room = db.execute("SELECT * FROM rooms WHERE id = ?", (booking["room_id"],)).fetchone()
    extras = db.execute("SELECT * FROM extras WHERE booking_id = ? ORDER BY id",
                        (booking["id"],)).fetchall()
    payments = db.execute("SELECT * FROM payments WHERE booking_id = ? ORDER BY id",
                          (booking["id"],)).fetchall()
    settings = get_settings()
    # Checked-out bookings keep the tax rate that was in force when the invoice was issued.
    rate = booking["tax_rate_bp"] if booking["tax_rate_bp"] is not None else int(settings["tax_rate_bp"])
    bill = build_bill(booking, room, extras, payments, rate)
    return dict(booking=booking, room=room, extras=extras, payments=payments,
                bill=bill, settings=settings, tax_rate=rate / 100)


def _outstanding(booking_rows):
    total = 0
    for b in booking_rows:
        total += max(0, _bill_context(b)["bill"].balance)
    return total


@bp.route("/")
def dashboard():
    db = get_db()
    rooms = db.execute("""
        SELECT r.*, b.id AS booking_id, b.guest_name, b.check_out
        FROM rooms r LEFT JOIN bookings b ON b.room_id = r.id AND b.status = 'checked_in'
        ORDER BY r.number""").fetchall()
    active = db.execute("SELECT * FROM bookings WHERE status = 'checked_in'").fetchall()
    collected_today = db.execute(
        "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE date(paid_at, 'localtime') = date('now', 'localtime')"
    ).fetchone()[0]
    return render_template("dashboard.html", rooms=rooms, active_count=len(active),
                           collected_today=collected_today,
                           outstanding=_outstanding(db.execute("SELECT * FROM bookings").fetchall()))


@bp.route("/rooms", methods=["GET", "POST"])
def rooms():
    db = get_db()
    if request.method == "POST":
        try:
            number = request.form["number"].strip()
            room_type = request.form["room_type"].strip()
            if not number or not room_type:
                raise ValueError("Room number and type are required")
            rate = _money("rate", required=True)
            db.execute("INSERT INTO rooms (number, room_type, rate) VALUES (?, ?, ?)",
                       (number, room_type, rate))
            db.commit()
            flash(f"Room {number} added", "success")
        except ValueError as e:
            flash(str(e), "error")
        except sqlite3.IntegrityError:
            flash("A room with that number already exists", "error")
        return redirect(url_for("main.rooms"))
    all_rooms = db.execute("""
        SELECT r.*, EXISTS(SELECT 1 FROM bookings b WHERE b.room_id = r.id AND b.status = 'checked_in') AS occupied,
               EXISTS(SELECT 1 FROM bookings b WHERE b.room_id = r.id) AS has_bookings
        FROM rooms r ORDER BY r.number""").fetchall()
    return render_template("rooms.html", rooms=all_rooms)


@bp.post("/rooms/<int:room_id>/rate")
def update_room_rate(room_id):
    db = get_db()
    try:
        db.execute("UPDATE rooms SET rate = ? WHERE id = ?", (_money("rate", required=True), room_id))
        db.commit()
        flash("Rate updated", "success")
    except ValueError as e:
        flash(str(e), "error")
    return redirect(url_for("main.rooms"))


@bp.post("/rooms/<int:room_id>/delete")
def delete_room(room_id):
    db = get_db()
    if db.execute("SELECT 1 FROM bookings WHERE room_id = ?", (room_id,)).fetchone():
        flash("Cannot delete a room that has bookings", "error")
    else:
        db.execute("DELETE FROM rooms WHERE id = ?", (room_id,))
        db.commit()
        flash("Room deleted", "success")
    return redirect(url_for("main.rooms"))


@bp.route("/bookings")
def bookings():
    status = request.args.get("status", "")
    query = "SELECT b.*, r.number AS room_number FROM bookings b JOIN rooms r ON r.id = b.room_id"
    params = ()
    if status in ("checked_in", "checked_out"):
        query += " WHERE b.status = ?"
        params = (status,)
    rows = get_db().execute(query + " ORDER BY b.id DESC", params).fetchall()
    return render_template("bookings.html", bookings=rows, status=status)


@bp.route("/bookings/new", methods=["GET", "POST"])
def new_booking():
    db = get_db()
    free_rooms = db.execute("""
        SELECT * FROM rooms r WHERE NOT EXISTS
            (SELECT 1 FROM bookings b WHERE b.room_id = r.id AND b.status = 'checked_in')
        ORDER BY r.number""").fetchall()
    if request.method == "POST":
        form = request.form
        try:
            room = db.execute("SELECT * FROM rooms WHERE id = ?", (form.get("room_id", type=int),)).fetchone()
            if room is None or room["id"] not in {r["id"] for r in free_rooms}:
                raise ValueError("Please choose an available room")
            guest_name = form.get("guest_name", "").strip()
            if not guest_name:
                raise ValueError("Guest name is required")
            check_in = date.fromisoformat(form["check_in"])
            check_out = date.fromisoformat(form["check_out"])
            nights_between(check_in, check_out)
            rate = _money("rate") or room["rate"]
            cur = db.execute("""
                INSERT INTO bookings (room_id, guest_name, guest_phone, guest_address, guest_gstin,
                                      check_in, check_out, rate)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (room["id"], guest_name, form.get("guest_phone", "").strip(),
                 form.get("guest_address", "").strip(), form.get("guest_gstin", "").strip().upper(),
                 check_in.isoformat(), check_out.isoformat(), rate))
            db.commit()
            flash(f"{guest_name} checked in to room {room['number']}", "success")
            return redirect(url_for("main.booking_detail", booking_id=cur.lastrowid))
        except (ValueError, KeyError) as e:
            flash(str(e) if isinstance(e, ValueError) else "Please fill in all required fields", "error")
    return render_template("booking_new.html", rooms=free_rooms, today=date.today().isoformat(),
                           form=request.form)


@bp.route("/bookings/<int:booking_id>")
def booking_detail(booking_id):
    return render_template("booking_detail.html", methods=PAYMENT_METHODS,
                           **_bill_context(_get_booking(booking_id)))


def _require_open(booking):
    if booking["status"] != "checked_in":
        flash("This booking is already checked out and invoiced", "error")
        return False
    return True


@bp.post("/bookings/<int:booking_id>/stay")
def update_stay(booking_id):
    booking = _get_booking(booking_id)
    if _require_open(booking):
        try:
            check_out = date.fromisoformat(request.form["check_out"])
            nights_between(date.fromisoformat(booking["check_in"]), check_out)
            db = get_db()
            db.execute("UPDATE bookings SET check_out = ?, discount = ? WHERE id = ?",
                       (check_out.isoformat(), _money("discount"), booking_id))
            db.commit()
            flash("Stay updated", "success")
        except (ValueError, KeyError) as e:
            flash(str(e) or "Invalid date", "error")
    return redirect(url_for("main.booking_detail", booking_id=booking_id))


@bp.post("/bookings/<int:booking_id>/extras")
def add_extra(booking_id):
    booking = _get_booking(booking_id)
    if _require_open(booking):
        try:
            description = request.form.get("description", "").strip()
            if not description:
                raise ValueError("Description is required")
            quantity = request.form.get("quantity", type=int) or 1
            if quantity < 1:
                raise ValueError("Quantity must be at least 1")
            db = get_db()
            db.execute("INSERT INTO extras (booking_id, description, quantity, unit_price) VALUES (?, ?, ?, ?)",
                       (booking_id, description, quantity, _money("unit_price", required=True)))
            db.commit()
        except ValueError as e:
            flash(str(e), "error")
    return redirect(url_for("main.booking_detail", booking_id=booking_id))


@bp.post("/bookings/<int:booking_id>/extras/<int:extra_id>/delete")
def delete_extra(booking_id, extra_id):
    if _require_open(_get_booking(booking_id)):
        db = get_db()
        db.execute("DELETE FROM extras WHERE id = ? AND booking_id = ?", (extra_id, booking_id))
        db.commit()
    return redirect(url_for("main.booking_detail", booking_id=booking_id))


@bp.post("/bookings/<int:booking_id>/payments")
def add_payment(booking_id):
    _get_booking(booking_id)
    try:
        amount = _money("amount", required=True)
        if amount <= 0:
            raise ValueError("Payment amount must be greater than zero")
        method = request.form.get("method", "Cash")
        if method not in PAYMENT_METHODS:
            raise ValueError("Unknown payment method")
        db = get_db()
        db.execute("INSERT INTO payments (booking_id, amount, method) VALUES (?, ?, ?)",
                   (booking_id, amount, method))
        db.commit()
        flash("Payment recorded", "success")
    except ValueError as e:
        flash(str(e), "error")
    return redirect(url_for("main.booking_detail", booking_id=booking_id))


@bp.post("/bookings/<int:booking_id>/checkout")
def checkout(booking_id):
    booking = _get_booking(booking_id)
    if _require_open(booking):
        db = get_db()
        invoice_no = f"INV-{datetime.now():%Y}-{booking_id:05d}"
        db.execute("""UPDATE bookings SET status = 'checked_out', invoice_no = ?, tax_rate_bp = ?
                      WHERE id = ?""", (invoice_no, int(get_settings()["tax_rate_bp"]), booking_id))
        db.commit()
        flash(f"Checked out. Invoice {invoice_no} generated", "success")
    return redirect(url_for("main.booking_detail", booking_id=booking_id))


@bp.route("/bookings/<int:booking_id>/invoice")
def invoice(booking_id):
    return render_template("invoice.html", **_bill_context(_get_booking(booking_id)))


@bp.route("/settings", methods=["GET", "POST"])
def settings():
    if request.method == "POST":
        try:
            tax_rate_bp = to_paise(request.form.get("tax_rate", "0"))  # "12.5" -> 1250 basis points
            if tax_rate_bp > 10000:
                raise ValueError("Tax rate cannot exceed 100%")
            values = {k: request.form.get(k, "").strip()
                      for k in ("hotel_name", "hotel_address", "hotel_phone", "hotel_gstin")}
            values["tax_rate_bp"] = str(tax_rate_bp)
            db = get_db()
            db.executemany("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", values.items())
            db.commit()
            flash("Settings saved", "success")
        except ValueError as e:
            flash(str(e), "error")
        return redirect(url_for("main.settings"))
    s = get_settings()
    return render_template("settings.html", settings=s, tax_rate=int(s["tax_rate_bp"]) / 100)
