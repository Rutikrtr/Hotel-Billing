import { isDesktop } from '../desktop';

// Phones and the web app: the warm "Masala" theme, same as the web app 1.0.
const MASALA = {
  bg: '#FAF6F2',
  surface: '#FFFFFF',
  surface2: '#F7F0EA',
  line: '#EEE4DB',
  text: '#1F1611',
  muted: '#6F635B',
  accent: '#C2410C',
  accentStrong: '#9A3412',
  accentSoft: '#FFF0E6',
  brand1: '#D9480F',
  brand2: '#C2255C',
  ink: '#2B1B16',
  free: '#15803D',
  freeSoft: '#E7F7EC',
  billed: '#6D28D9',
  billedSoft: '#F2ECFF',
  danger: '#B91C1C',
  dangerSoft: '#FDECEC',
  veg: '#15803D',
  nonveg: '#B91C1C',
  busyTile: '#FFF6EF', busyLine: '#F0C2A4', billedTile: '#F7F2FF', billedLine: '#D5C2FF', editLine: '#F5C7AC',
  dishTile: '#FFF7F1', dishLine: '#EFB08A', floorTop: '#FBF7F3', floorBottom: '#F4EDE6', floorDot: '#D9CCC0', floorLine: '#E6DCD2', spotLine: '#DCD2C9',
};

// Desktop app 2.5: "Ember" – a clean, bright orange (no pink) on a neutral light page with white cards and a
// dark stone sidebar; status colours stay small (orange busy, violet billed, green free).
const SLATE: typeof MASALA = {
  bg: '#F6F5F3',
  surface: '#FFFFFF',
  surface2: '#F2F0ED',
  line: '#E7E4E0',
  text: '#1C1917',
  muted: '#78716C',
  accent: '#EA580C',
  accentStrong: '#C2410C',
  accentSoft: '#FFF1E8',
  brand1: '#F97316',
  brand2: '#EA580C',
  ink: '#1C1917',
  free: '#16A34A',
  freeSoft: '#E8F7EE',
  billed: '#7C3AED',
  billedSoft: '#F3EEFF',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  veg: '#15803D',
  nonveg: '#B91C1C',
  busyTile: '#FFF5EE', busyLine: '#FDCBA6', billedTile: '#F8F5FF', billedLine: '#DDD2FD', editLine: '#FDD5BA',
  dishTile: '#FFF7F1', dishLine: '#FBBF8F', floorTop: '#FBFAF9', floorBottom: '#F3F1EE', floorDot: '#D6D1CB', floorLine: '#E7E4E0', spotLine: '#D6D1CB',
};

export const C = isDesktop ? SLATE : MASALA;

// Inter: the font most phone apps use for numbers and small labels (clear digits, tabular figures).
export const F = {
  regular: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
};

/** Soft shadow tinted with the brand colour (never plain grey). */
export const shadow = { shadowColor: isDesktop ? '#44260F' : '#7C2D12', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 };
