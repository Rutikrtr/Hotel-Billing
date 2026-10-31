// Master Bill 2.5 – the Windows desktop app. It shows the same screens as the 2.0 mobile app (their web build,
// packed inside the app) in a locked-down window: no Node.js in the page, sandboxed, a strict content security
// policy, no navigation away from the app, links open in the normal browser, no developer tools.
const { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, 'app');
const START = 'app://master-bill/v2/index.html';
const SUPABASE = 'https://ftzhystkinhxxgddnqgp.supabase.co';

// The app's own files are served from app://master-bill/ (a secure, standard origin, so sign-in storage works).
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${SUPABASE} ${SUPABASE.replace('https', 'wss')}`,
  "frame-src 'self' about:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// One copy of the app at a time.
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('Not found', { status: 404 });   // no ../ escapes
    return net.fetch(pathToFileURL(file).toString());
  });

  // The security policy is added to every page the app shows.
  session.defaultSession.webRequest.onHeadersReceived((details, done) => {
    done({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  // No camera, microphone, location or notifications; only copying text (share on a computer copies it).
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));

  // Printers installed on Windows (USB, Bluetooth paired in Windows, network): listed and printed to directly.
  ipcMain.handle('printers', async (e) => (await e.sender.getPrintersAsync()).map((p) => ({
    name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, status: p.status,
  })));
  ipcMain.handle('print', async (_e, job) => {
    const { html, deviceName, paper } = job ?? {};
    if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Nothing to print');
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true } });
    try {
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await w.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => 1) : 1', true).catch(() => 1);
      const px = await w.webContents.executeJavaScript('document.body.scrollHeight', true).catch(() => 1000);
      const widthMm = paper === 80 ? 80 : 58;
      const heightMm = Math.max(60, Math.ceil(px * 0.2646) + 8);
      await new Promise((resolve, reject) => w.webContents.print({
        silent: !!deviceName, deviceName: deviceName || undefined, printBackground: true,
        margins: { marginType: 'none' }, pageSize: { width: widthMm * 1000, height: heightMm * 1000 },
      }, (ok, why) => (ok ? resolve() : reject(new Error(why || 'Printing failed')))));
    } finally { w.destroy(); }
  });

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 980, minHeight: 640, show: false,
    title: 'Master Bill', backgroundColor: '#FAF6F2', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    // No black Windows title bar: the page header is the title bar, with the window buttons floating on it.
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#1E1E1E', height: 44 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged, spellcheck: false },
  });
  // Never leave the app's own pages; web links (QR menu, website) open in the normal browser.
  // Drag the window by its headers (marked data-drag in the screens) and by a thin strip along the top.
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      [data-glass] { backdrop-filter: blur(22px) saturate(150%); -webkit-backdrop-filter: blur(22px) saturate(150%); }
      [data-drag] { -webkit-app-region: drag; }
      /* Every control is clickable wherever it is: on Windows a drag area under another screen would otherwise
         swallow clicks (no-drag always wins over drag). */
      [role="button"], [role="tab"], [role="link"], [role="switch"], [role="checkbox"], button, a, input, textarea, select { -webkit-app-region: no-drag; }
      #mb-drag { position: fixed; top: 0; left: 0; right: 150px; height: 6px; -webkit-app-region: drag; z-index: 99999; }
    `);
    win.webContents.executeJavaScript(`if (!document.getElementById('mb-drag')) { const d = document.createElement('div'); d.id = 'mb-drag'; document.body.appendChild(d); }`);
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://master-bill/')) { e.preventDefault(); if (url.startsWith('https://')) shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
  // The window keeps the desktop app's own name (the screens call themselves 2.0).
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle(`Master Bill ${app.getVersion()}`); });
  win.setTitle(`Master Bill ${app.getVersion()}`);
  // Opens full screen (maximized), like desktop billing software.
  // Windows: the mouse's back button arrives as an app command; the app goes back a screen.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') win.webContents.executeJavaScript("window.dispatchEvent(new Event('mb-back'))").catch(() => {});
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL(START);
});

app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on('window-all-closed', () => app.quit());
