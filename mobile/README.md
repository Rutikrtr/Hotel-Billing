# Master Bill mobile app (React Native)

The native Android app for waiters and managers. Same database and logins as the web app.

- **Redux Toolkit** store (`src/store`): everything on screen comes from memory; the internet is used on start-up,
  pull-to-refresh, live order events (Supabase Realtime) and saves.
- **Save once**: dish taps change only the phone (`cart`), saved even if the app closes. One `order_save` request
  applies them all as +/- amounts, so two phones on the same table both count.
- **No freezes**: an in-app login lock (not the browser lock), 20 s limit on every request, time limits on Bluetooth.
- **Printing**: Bluetooth LE ESC/POS (`src/printing`), same receipts as the web app.

Owner tools (menu editing, analytics, staff, super admin) stay in the web app for now.

## Build

GitHub Actions (`.github/workflows/mobile.yml`) builds an unsigned APK into the `mobile-apk-unsigned` branch.
Sign it with the private release key (kept off GitHub), like the web app's APK (see `android/README.md`).

## Check locally

    npm ci
    npx tsc --noEmit
    npx tsx --test tests/logic.test.ts
