// Builds the web app (Master Bill 2.0 for iPhone and computers) into ../public/v2/, so it is served at /v2/
// next to the old web app (1.0, untouched): the same screens as the Android app, exported by Expo, plus what
// browsers need to install it from the home screen. The base path /v2 is set in app.json (experiments.baseUrl).
import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const out = '../public/v2';
const base = '/v2';
execSync(`npx expo export -p web --output-dir ${out}`, { stdio: 'inherit' });
copyFileSync('assets/icon.png', `${out}/icon.png`);
writeFileSync(`${out}/manifest.webmanifest`, JSON.stringify({
  name: 'Master Bill 2.0', short_name: 'Master Bill', start_url: `${base}/`, scope: `${base}/`, display: 'standalone',
  background_color: '#FAF6F2', theme_color: '#C2410C', icons: [{ src: `${base}/icon.png`, sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
}, null, 2));
// iPhone: open full screen from the home screen icon, with the app's own icon.
const head = [
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="Master Bill">',
  `<link rel="apple-touch-icon" href="${base}/icon.png">`,
  `<link rel="manifest" href="${base}/manifest.webmanifest">`,
].join('\n');
const html = readFileSync(`${out}/index.html`, 'utf8')
  .replace('httpEquiv=', 'http-equiv=')
  .replace('shrink-to-fit=no', 'viewport-fit=cover')
  .replace('</head>', `${head}\n</head>`);
writeFileSync(`${out}/index.html`, html);
console.log(`Web app ready in ${out}/`);
