from hotel_billing.db import get_db


def add_room(client, number="101", rate="2000"):
    return client.post("/rooms", data={"number": number, "room_type": "Deluxe", "rate": rate})


def check_in(client, room_id=1, **extra):
    data = {"room_id": room_id, "guest_name": "Asha Patil", "guest_phone": "9999999999",
            "check_in": "2026-01-01", "check_out": "2026-01-03", "rate": ""}
    data.update(extra)
    return client.post("/bookings/new", data=data)


def test_pages_render(client):
    add_room(client)
    check_in(client)
    for url in ["/", "/rooms", "/bookings", "/bookings/new", "/settings",
                "/bookings/1", "/bookings/1/invoice"]:
        assert client.get(url).status_code == 200, url


def test_duplicate_room_rejected(client):
    add_room(client)
    resp = add_room(client, rate="3000")
    assert resp.status_code == 302
    assert b"already exists" in client.get("/rooms").data


def test_full_stay_flow(app, client):
    add_room(client)
    assert check_in(client).headers["Location"].endswith("/bookings/1")

    # Room is no longer available for another check-in.
    resp = check_in(client, guest_name="Someone Else")
    assert b"choose an available room" in resp.data

    client.post("/bookings/1/extras", data={"description": "Laundry", "quantity": "2", "unit_price": "150"})
    client.post("/bookings/1/stay", data={"check_out": "2026-01-03", "discount": "300"})
    client.post("/bookings/1/payments", data={"amount": "1000", "method": "UPI"})
    client.post("/bookings/1/checkout")

    with app.app_context():
        b = get_db().execute("SELECT * FROM bookings WHERE id = 1").fetchone()
    assert b["status"] == "checked_out"
    assert b["invoice_no"].endswith("-00001")
    assert b["tax_rate_bp"] == 1200

    # 2 nights x 2000 + 2 x 150 = 4300; minus 300 = 4000; +12% = 4480; paid 1000.
    page = client.get("/bookings/1/invoice").data.decode()
    assert "TAX INVOICE" in page
    assert "4,480.00" in page
    assert "3,480.00" in page

    # Changing the tax rate later does not alter the issued invoice.
    client.post("/settings", data={"hotel_name": "Test Hotel", "tax_rate": "18"})
    assert "4,480.00" in client.get("/bookings/1/invoice").data.decode()

    # Charges are locked after checkout, and the room is free again.
    client.post("/bookings/1/extras", data={"description": "Minibar", "quantity": "1", "unit_price": "500"})
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM extras").fetchone()[0] == 1
    assert check_in(client, guest_name="Next Guest").status_code == 302


def test_check_out_before_check_in_rejected(client):
    add_room(client)
    resp = check_in(client, check_in="2026-01-05", check_out="2026-01-01")
    assert b"cannot be before" in resp.data


def test_room_with_bookings_cannot_be_deleted(app, client):
    add_room(client)
    check_in(client)
    client.post("/rooms/1/delete")
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM rooms").fetchone()[0] == 1
