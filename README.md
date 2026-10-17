# Hotel Billing

Table-wise order taking and billing for restaurants. Open a table, tap dishes, settle the bill, and print it.

It runs in the browser, keeps its data in **Supabase**, and is hosted on **Netlify**.

## How it works

Each table goes through three steps:

1. **Take the order**: tap a free table. It opens on **★ Popular**, which shows your starred favourites first and then the best sellers of the last 30 days. **All** and the category tabs follow. Tap dishes to add them (use − / + for quantities). Tap **Save Order** and the table shows as *Eating*. You can come back and add more at any time.
2. **Print the bill** after they've eaten: open the table and tap **Print Bill**. The bill gets its number (`B00001`, `B00002`, …) and prints straight away, and the table shows *Bill printed* in amber. If items change after printing, use **Reprint Bill**.
3. **Receive payment**: tap **Receive Payment** and choose Cash, UPI or Card. The table is free again.

**Two groups at one table?** After the first group's order is in, tap **+ Add Section** at the top of the table. You get tabs **Section A** and **Section B**, each with its own order, bill and payment. Once a table is split, both groups are labelled with their letter (`T1-A`, `T1-B`) on screen and on the printed bill. A table has one section by default.

**No printer yet?** By default, **Print Bill** finishes the bill and frees the table in one tap (recorded as Cash), with no print popup and no Receive Payment step. Turn off **Settings → Print Bill clears the table** to use the full print → Receive Payment flow.

Other screens:

- **Bills**: (owner) **Edit Bill** / **Delete** on any paid bill, with a reason; every change is kept in **Bills → Change Log** (who, when, old → new total, items before and after).
- **Bills list**: bills waiting for payment, the day's sales split by payment method, and every paid bill. Pick a date to see past days.
- **Trending**: best-selling dishes for Today, 7 days or 30 days, ranked by quantity or by sales, with the #1 dish, ▲/▼ change against the previous period, and a breakdown by category.
- **Menu**: add dishes, tap ☆ to make a dish a favourite, or tap **Edit** to change its name, rate, category, veg/non-veg or availability.
- **Settings**: restaurant name, address and phone, an optional **Charge GST on bills** switch (off by default; when on, the bill shows CGST + SGST), tables (default T1–T8; tap a table to rename it), and staff access.

Bills round to the nearest rupee and show the round-off. Amounts are stored in whole paise, so totals are exact.

## Design

The design follows Apple's Human Interface Guidelines using the `apple-design` skill in `.claude/skills/`:

- **Tabs**: four tabs (Tables, Bills, Menu, Settings) that only switch screens. They sit at the bottom on phones and become a top bar on wide screens.
- **Phones**: the order slides up as a sheet from a bar showing the running total.
- **Accessibility**: tap targets are at least 44 px, and every text colour meets 4.5:1 contrast in both light and dark mode (values are noted in `style.css`). Veg and non-veg marks differ by shape as well as colour.
- **Receipt**: monospaced type styled like a thermal-printer bill.

## Restaurants

Each owner account runs its own restaurant, with its own menu, tables, bills, bill numbers, settings and staff. Accounts never see another restaurant's data. Staff the owner adds in Settings join that owner's restaurant.

## Super admin

A super admin (Techyverve) signs in like anyone else and lands on **Hotels** (`#/admin`), where they can:

- create a hotel together with its owner login (email + password), starting tables and rooms;
- tick which parts each hotel gets: **Tables & Orders**, **Rooms**, **Trending**, **Edit Bills**;
- pause a hotel's service with a reason (its staff see a "Service paused" screen; data is kept) and resume it;
- reset an owner's password, or permanently delete a hotel after typing its name.

Super admins are rows in `public.super_admins`; to add one, insert the user's id there. Feature switches and the
paused state are enforced in the database (`has_feature()`, `my_restaurant()`), not just hidden in the app.

## Rooms

When the Rooms feature is on, the **Rooms** tab shows every room as free or occupied. Tap a free room to check a guest in,
add extra charges (food, laundry…), adjust dates, rate or discount, then **Check Out** to take payment. Room bills are
numbered `R00001…` and appear in Bills with the food bills. Rooms are managed in Settings.

## Security

Every table has row-level security, so only signed-in staff can read or write data. A settled bill can't be edited, and only the `settle_order()` database function can close an order. The schema is in `supabase/migrations/`.

## Files

```
public/            static site served by Netlify
  app.js           screens and routing; talks to Supabase with supabase-js
  billing.js       bill maths (GST, discount, round off)
  config.js        generated from environment variables (not committed)
  style.css        design tokens, layout, receipt print styles
scripts/write-config.mjs  writes public/config.js from SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
supabase/migrations/
tests/             unit tests for billing.js
```

## Configuration

The Supabase project is set only through environment variables; nothing is hardcoded:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → publishable key (never the secret key) |

On Netlify they live in **Site configuration → Environment variables**; the build (`node scripts/write-config.mjs`)
turns them into `public/config.js` and fails loudly if one is missing. Locally, copy `.env.example` to `.env`.

## Deploying

Netlify deploys `main` automatically: every push to GitHub goes live in about a minute (see `netlify.toml`).
On Netlify's free plan, a private repo only builds commits from the one Git account linked in Netlify
(**Team settings → Git contributors**), so commits must be authored by that account.

## Local development

```bash
cp .env.example .env   # then fill in the two values
npm start   # writes public/config.js and serves public/ at http://localhost:3000
npm test
```
