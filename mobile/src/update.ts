import { Platform } from 'react-native';
import app from '../app.json';
import { desktopApi, isDesktop } from './desktop';
import { sb } from './supabase';
import { updateFor, type UpdateInfo, type VersionRow } from './versions';

/** This app's platform and version: the Android app (app.json) or the desktop app (its own version); null in browsers. */
async function thisApp(): Promise<{ platform: 'android' | 'desktop'; version: string } | null> {
  if (isDesktop) {
    const version = await desktopApi()?.version?.().catch(() => null);
    return version ? { platform: 'desktop', version } : null;
  }
  return Platform.OS === 'android' ? { platform: 'android', version: app.expo.version } : null;
}

/**
 * Asks the server (app_versions, set by Techyverve) whether a newer app is out. Any problem (no internet, old
 * server) means "no update", so the app is never blocked by the check itself.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const me = await thisApp();
    if (!me) return null;
    const { data, error } = await sb.from('app_versions').select('latest, minimum, url, message').eq('platform', me.platform).maybeSingle();
    if (error || !data) return null;
    return updateFor(me.version, data as VersionRow);
  } catch {
    return null;
  }
}
