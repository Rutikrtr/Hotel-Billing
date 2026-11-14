import React, { useEffect, useState } from 'react';
import { AppState, Linking, Modal, StyleSheet, View } from 'react-native';
import { isDesktop } from '../desktop';
import { checkForUpdate } from '../update';
import type { UpdateInfo } from '../versions';
import { Button, T } from './kit';
import { C } from './theme';
import { TechyverveLogo } from './TechyverveLogo';

/**
 * Update prompt, controlled from the server (app_versions). Checks when the app opens and each time it comes back
 * to the screen. Required update: a full screen the app can't be used past, with Download. Optional update: a popup
 * with "Update now" and "Later" (Later hides it until the app is next opened). Orders saved on the phone stay safe.
 */
export function UpdateGate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [later, setLater] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => { checkForUpdate().then((u) => { if (alive) setInfo(u); }); };
    check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    return () => { alive = false; sub.remove(); };
  }, []);
  if (!info || (!info.required && later)) return null;
  const download = () => { Linking.openURL(info.url).catch(() => {}); };
  const body = (
    <View style={st.card} accessibilityViewIsModal>
      <View style={st.logo}><TechyverveLogo size={44} /></View>
      <T w="heavy" style={st.title}>{info.required ? 'Update required' : 'New version available'}</T>
      <T style={st.text}>
        {info.required
          ? `Please install Master Bill ${info.latest} to continue. Your login and saved orders stay safe.`
          : `Master Bill ${info.latest} is ready with improvements and fixes. Your login and saved orders stay safe.`}
      </T>
      {info.message ? <T w="semibold" style={st.note}>{info.message}</T> : null}
      <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 6 }}>
        <Button title={info.required ? 'Download update' : 'Update now'} onPress={download} />
        {info.required ? null : <Button kind="secondary" title="Later" onPress={() => setLater(true)} />}
      </View>
      <T style={st.hint}>{isDesktop
        ? 'After it downloads, close Master Bill and open the new file.'
        : 'After it downloads, open the file and tap Install, then open Master Bill again.'}</T>
    </View>
  );
  // Required: covers the whole app (nothing behind can be tapped). Optional: a popup over the app.
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!info.required) setLater(true); }}>
      <View style={[st.back, info.required && st.backSolid]}>{body}</View>
    </Modal>
  );
}

const st = StyleSheet.create({
  back: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(31,22,17,0.55)' },
  backSolid: { backgroundColor: C.bg === 'transparent' ? '#F3EFEC' : C.bg },
  card: { width: '100%', maxWidth: 400, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  logo: { width: 72, height: 72, borderRadius: 20, backgroundColor: '#FFF4EC', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 20, textAlign: 'center', color: '#1F1611' },
  text: { fontSize: 14.5, lineHeight: 21, textAlign: 'center', color: '#5C5049' },
  note: { fontSize: 13.5, lineHeight: 19, textAlign: 'center', color: '#C2410C' },
  hint: { fontSize: 12, lineHeight: 17, textAlign: 'center', color: '#8A7F78', marginTop: 4 },
});
