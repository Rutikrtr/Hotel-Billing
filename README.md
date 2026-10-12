# Hotel Billing

A front-desk billing app for hotels. It runs entirely in the browser, uses
**Supabase** for the database and staff login, and is hosted on **Netlify**.

## Features

- **Rooms**: add rooms with a type and nightly rate, and see at a glance which are free or occupied.
- **Check-in**: record guest details (name, phone, address, optional GSTIN), dates and a negotiated rate.
- **Charges**: add extras such as restaurant, laundry, minibar or extra bed. You can also change the check-out date and apply a discount.
- **GST**: set the rate in Settings. The invoice shows it split equally into CGST and SGST.
- **Payments**: record Cash, Card, UPI or bank-transfer payments, including part-payments and advances, and track the running balance.
- **Check-out**: closes the stay, locks the charges and issues a numbered **tax invoice** (`INV-YYYY-NNNNN`). The invoice keeps the tax rate that applied when it was issued.
- **Printable invoice**: print it, or save it as a PDF from the browser.
- **Staff accounts**: only email addresses the owner adds in Settings can sign in and see data.

Amounts are stored in whole paise, so totals never pick up floating-point rounding errors.

## How it fits together

```
public/            static site served by Netlify (no build step)
  index.html
  app.js           UI and routing; talks to Supabase with supabase-js
  billing.js       pure billing maths (nights, tax, totals)
  config.js        Supabase URL + publishable key (safe to be public)
  style.css
supabase/migrations/   database schema, row-level security and checkout function
tests/             unit tests for billing.js (node --test)
netlify.toml       publishes the public/ folder
```

Security is enforced in the database. Every table has row-level security, so
only signed-in users on the `staff` list can read or write data. A checked-out
booking can't be edited, and only the `checkout()` function can issue an invoice.

## First-time setup

1. Open the site and choose **Create account** with the owner email (already on the staff list).
2. Click the confirmation link in the email. If it opens a page that doesn't load, that's fine; the account is confirmed anyway.
3. Come back to the site and sign in.
4. In **Settings**, enter your hotel name, address, GSTIN and GST rate, and add staff emails.
5. Add your **Rooms**, then **Check in** guests.

To have confirmation emails link back to the site, go to the Supabase dashboard,
open **Authentication → URL Configuration**, and set **Site URL** to the Netlify address.

## Local development

```bash
npm start      # serves public/ at http://localhost:3000
npm test       # billing unit tests
```
