import { Platform } from 'react-native';

/** True inside the Windows desktop app (Master Bill 2.5, Electron), which runs the web build of these screens. */
export const isDesktop = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
