// Puts the 2.0 screens (the web build in ../public/v2, made by `cd mobile && npm run build:web`) inside the
// desktop app, so the app runs from its own files and never loads code from a website.
import { cpSync, existsSync, rmSync } from 'node:fs';

if (!existsSync('../public/v2/index.html')) throw new Error('Build the screens first: cd mobile && npm run build:web');
rmSync('app', { recursive: true, force: true });
cpSync('../public/v2', 'app/v2', { recursive: true });
console.log('Copied the 2.0 screens into desktop/app/v2');
