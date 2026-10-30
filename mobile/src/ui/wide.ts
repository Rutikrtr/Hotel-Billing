import { Platform, useWindowDimensions } from 'react-native';

/**
 * Computer layout (desktop app 2.5 and the web app on a computer): from 900 px wide the screens use the full
 * window – a sidebar instead of the bottom bar, side-by-side panels and more columns. Phones never get it.
 */
export function useWide() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 900;
}
