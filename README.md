# Hotel Billing

Table-wise order taking and billing for restaurants. Open a table, tap dishes, settle the bill, and print it.

It runs in the browser, keeps its data in **Supabase**, and is hosted on **Netlify**.

## How it works

1. **Tables**: every table at a glance. Free tables are plain; running tables show the amount due and how long the order has been open.
2. **Order**: tap a table, then tap dishes to add them. Use − / + to change quantities and add a discount if needed. Search the menu or filter it by category.
3. **Settle**: choose Cash, UPI or Card. The bill gets the next number (`B00001`, `B00002` and so on), its GST rate is locked, and the table is free again.
4. **Bill**: an 80 mm receipt layout that prints on thermal bill printers, or to any printer or PDF.
5. **Bills**: the day's sales split by payment method, and every settled bill. Pick a date to see past days.
6. **Menu**: add dishes with a category, price and veg/non-veg mark. Change prices, or mark an item sold out for the day.
7. **Settings**: restaurant name, address, GSTIN and GST rate (default 5%, shown as CGST + SGST), tables, and staff access.

Bills round to the nearest rupee and show the round-off. Amounts are stored in whole paise, so totals are exact.

## Design

The design follows Apple's Human Interface Guidelines using the `apple-design` skill in `.claude/skills/`:

- **Tabs**: four tabs (Tables, Bills, Menu, Settings) that only switch screens. They sit at the bottom on phones and become a top bar on wide screens.
- **Phones**: the order slides up as a sheet from a bar showing the running total.
- **Accessibility**: tap targets are at least 44 px, and every text colour meets 4.5:1 contrast in both light and dark mode (values are noted in `style.css`). Veg and non-veg marks differ by shape as well as colour.
- **Receipt**: monospaced type styled like a thermal-printer bill.

## Security

Every table has row-level security, so only signed-in staff can read or write data. A settled bill can't be edited, and only the `settle_order()` database function can close an order. The schema is in `supabase/migrations/`.

## Files

```
public/            static site served by Netlify (no build step)
  app.js           screens and routing; talks to Supabase with supabase-js
  billing.js       bill maths (GST, discount, round off)
  config.js        Supabase URL + publishable key (safe to be public)
  style.css        design tokens, layout, receipt print styles
supabase/migrations/
tests/             unit tests for billing.js
```

## Local development

```bash
npm start   # serves public/ at http://localhost:3000
npm test
```
