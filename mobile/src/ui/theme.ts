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

// Desktop app 2.5: "Midnight" – charcoal panels and black buttons on a light grey page with white cards,
// small coloured status labels (amber busy, violet billed, green free).
const SLATE: typeof MASALA = {
  bg: '#F3F4F6',
  surface: '#FFFFFF',
  surface2: '#F1F2F5',
  line: '#E5E7EB',
  text: '#111318',
  muted: '#6B7280',
  accent: '#1B1E27',
  accentStrong: '#B45309',
  accentSoft: '#EEEFF3',
  brand1: '#151821',
  brand2: '#2E3342',
  ink: '#0E1016',
  free: '#16A34A',
  freeSoft: '#E8F7EE',
  billed: '#7C3AED',
  billedSoft: '#F3EEFF',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  veg: '#15803D',
  nonveg: '#B91C1C',
  busyTile: '#FFF8EB', busyLine: '#F5D9A6', billedTile: '#F8F5FF', billedLine: '#DDD2FD', editLine: '#D9DCE3',
  dishTile: '#F6F7F9', dishLine: '#B9BFCC', floorTop: '#FAFAFB', floorBottom: '#F2F3F6', floorDot: '#D3D7DF', floorLine: '#E5E7EB', spotLine: '#CDD2DB',
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
export const shadow = { shadowColor: isDesktop ? '#0E1016' : '#7C2D12', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 };
