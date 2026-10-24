import { Buffer } from 'buffer';
import { registerRootComponent } from 'expo';
import App from './App';

// Bluetooth printing sends bytes as base64.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

registerRootComponent(App);
