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

// Desktop app 2.5: clean and glossy – white frosted cards over a light grey page with soft glows, a black
// sidebar, near-black text and orange only to highlight (money on tables, busy tables, the open page).
const SLATE: typeof MASALA = {
  bg: 'transparent',
  surface: 'rgba(255,255,255,0.86)',
  surface2: 'rgba(248,248,250,0.92)',
  line: 'rgba(16,16,20,0.08)',
  text: '#111113',
  muted: '#6E6E73',
  accent: '#E8590C',
  accentStrong: '#C2410C',
  accentSoft: 'rgba(232,89,12,0.08)',
  brand1: '#FF8A3D',
  brand2: '#E8590C',
  ink: '#111113',
  free: '#1E8E5A',
  freeSoft: 'rgba(30,142,90,0.08)',
  billed: '#6B4FD8',
  billedSoft: 'rgba(107,79,216,0.08)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220,38,38,0.08)',
  veg: '#15803D',
  nonveg: '#B91C1C',
  busyTile: '#FFF6EF', busyLine: 'rgba(232,89,12,0.55)', billedTile: '#F7F5FF', billedLine: 'rgba(107,79,216,0.40)', editLine: 'rgba(232,89,12,0.45)',
  dishTile: '#FFF6EF', dishLine: 'rgba(232,89,12,0.55)', floorTop: 'rgba(255,255,255,0.55)', floorBottom: 'rgba(255,255,255,0.40)', floorDot: 'rgba(16,16,20,0.10)', floorLine: 'rgba(16,16,20,0.07)', spotLine: 'rgba(16,16,20,0.16)',
};

/** The desktop sidebar: black, grey names, white and orange for the open page. */
export const SIDEBAR = { bg: '#0B0B0D', line: 'rgba(255,255,255,0.07)', text: '#F2F2F0', icon: '#8B8B90', soft: '#7C7C80', hover: 'rgba(255,255,255,0.06)', card: 'rgba(255,255,255,0.08)' };

export const C = isDesktop ? SLATE : MASALA;

// Inter: the font most phone apps use for numbers and small labels (clear digits, tabular figures).
export const F = isDesktop ? {
  // Desktop: Instrument Sans (calm, modern type); big page titles in Medium with tight spacing (F.light).
  regular: 'InstrumentSans_400Regular',
  semibold: 'InstrumentSans_500Medium',
  bold: 'InstrumentSans_600SemiBold',
  heavy: 'InstrumentSans_600SemiBold',
  light: 'InstrumentSans_500Medium',
  mono: 'IBMPlexMono_500Medium',
} : {
  regular: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
  light: 'Inter_500Medium',
  mono: 'Inter_800ExtraBold',
};

/** Soft shadow tinted with the brand colour (never plain grey). */
export const shadow = { shadowColor: isDesktop ? '#14141E' : '#7C2D12', shadowOpacity: isDesktop ? 0.06 : 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 };
