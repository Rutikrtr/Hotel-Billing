import { Platform } from 'react-native';

/** True inside the Windows desktop app (Master Bill 2.5, Electron), which runs the web build of these screens. */
export const isDesktop = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

export interface WinPrinter { name: string; displayName: string; isDefault: boolean; status: number }
interface DesktopApi {
  printers: () => Promise<WinPrinter[]>;
  print: (job: { html: string; deviceName?: string; paper: 58 | 80 }) => Promise<void>;
}
/** The desktop app's bridge to Windows printers (see desktop/preload.js); null in browsers and on phones. */
export const desktopApi = (): DesktopApi | null => (isDesktop ? (globalThis as unknown as { masterBillDesktop?: DesktopApi }).masterBillDesktop ?? null : null);
