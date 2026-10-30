# Master Bill 2.5 (Windows desktop)

The same screens as the 2.0 mobile app, as a Windows program (Electron). Version scheme: whole numbers are the
mobile app (2.0), .5 is the desktop app (2.5).

- `main.js` – the window and its security: the screens are packed inside the app (served from `app://master-bill/`),
  sandboxed with no Node.js access, a strict content security policy (only the app's files and the Supabase
  database), no navigation away, links open in the browser, no developer tools in the built app.
- Printing uses the Windows print window (USB thermal printers with their Windows driver, or any printer).

Build (GitHub does this: `.github/workflows/desktop.yml`, on Windows):

```bash
cd mobile && npm ci && npm run build:web     # the 2.0 screens → public/v2
cd ../desktop && npm ci && npm run dist      # → dist/Master-Bill-2.5.exe (portable, no installer)
```
