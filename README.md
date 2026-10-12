# Hotel Billing

A simple hotel billing app for the front desk. It runs on Python, Flask and SQLite.

## Features

- **Rooms**: add rooms with a type and nightly rate, and see which are free or occupied at a glance.
- **Check-in**: record guest details (name, phone, address, optional GSTIN), dates and a negotiated rate.
- **Charges**: add extra charges such as restaurant, laundry, minibar or extra bed. You can also change the check-out date and apply a discount.
- **GST**: set the rate in Settings. The invoice shows it split equally into CGST and SGST.
- **Payments**: record Cash, Card, UPI or bank-transfer payments, including part-payments and advances, and track the running balance.
- **Check-out**: closes the stay, locks the charges and issues a numbered **tax invoice** (`INV-YYYY-NNNNN`). The invoice keeps the tax rate that applied when it was issued.
- **Printable invoice**: a clean layout made to print or save as PDF from the browser.
- **Dashboard**: shows room occupancy, money collected today and the outstanding balance.

Amounts are stored in whole paise, so totals never pick up floating-point rounding errors.

## Getting started

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000. Fill in your hotel's details and GST rate in **Settings**, add your **Rooms**, then **Check in** a guest.

The database is created automatically at `instance/hotel_billing.sqlite3`. Back up that file to keep your data.

For production, set a `SECRET_KEY` environment variable and run the app behind a WSGI server, for example `gunicorn app:app`.

## Tests

```bash
pytest
```

## Project layout

```
app.py                     entry point
hotel_billing/
  __init__.py              app factory
  billing.py               pure billing maths (nights, tax, totals)
  db.py                    SQLite schema and settings
  views.py                 routes
  templates/               HTML pages and printable invoice
  static/style.css
tests/
```
