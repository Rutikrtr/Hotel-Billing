// Master Bill 2.5 – the Windows desktop app. It shows the same screens as the 2.0 mobile app (their web build,
// packed inside the app) in a locked-down window: no Node.js in the page, sandboxed, a strict content security
// policy, no navigation away from the app, links open in the normal browser, no developer tools.
const { app, BrowserWindow, Menu, net, protocol, session, shell } = require('electron');
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

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 980, minHeight: 640, show: false,
    title: 'Master Bill', backgroundColor: '#FAF6F2', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged, spellcheck: false },
  });
  // Never leave the app's own pages; web links (QR menu, website) open in the normal browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://master-bill/')) { e.preventDefault(); if (url.startsWith('https://')) shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
  // The window keeps the desktop app's own name (the screens call themselves 2.0).
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle(`Master Bill ${app.getVersion()}`); });
  win.setTitle(`Master Bill ${app.getVersion()}`);
  // Opens full screen (maximized), like desktop billing software.
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL(START);
});

app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on('window-all-closed', () => app.quit());
