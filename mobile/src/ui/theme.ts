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

// Desktop app 2.5 (Tracebit palette): warm off-white page, white cards with hairline borders, warm black
// for the sidebar, titles and the main figure, coral only for the main action and busy tables.
const SLATE: typeof MASALA = {
  bg: 'transparent',
  surface: '#FFFFFF',
  surface2: '#FAF8F6',
  line: 'rgba(0,0,0,0.08)',
  text: '#231F20',
  muted: '#807574',
  accent: '#EA6F53',
  accentStrong: '#BC4725',
  accentSoft: 'rgba(234,111,83,0.12)',
  brand1: '#EA6F53',
  brand2: '#BC4725',
  ink: '#231F20',
  free: '#027A48',
  freeSoft: '#ECFDF3',
  billed: '#8A3C90',
  billedSoft: 'rgba(138,60,144,0.10)',
  danger: '#B42318',
  dangerSoft: '#FEF3F2',
  veg: '#027A48',
  nonveg: '#B42318',
  busyTile: '#FFF7F4', busyLine: 'rgba(234,111,83,0.45)', billedTile: '#FBF5FB', billedLine: 'rgba(138,60,144,0.35)', editLine: 'rgba(234,111,83,0.45)',
  dishTile: '#FFF7F4', dishLine: 'rgba(234,111,83,0.45)', floorTop: '#FFFFFF', floorBottom: '#FCFAF8', floorDot: 'rgba(0,0,0,0.08)', floorLine: 'rgba(0,0,0,0.06)', spotLine: 'rgba(0,0,0,0.14)',
};

/** The desktop sidebar: warm black, white names, coral for the open page's icon. */
export const SIDEBAR = { bg: '#231F20', line: 'rgba(255,255,255,0.12)', text: '#FFFFFF', icon: 'rgba(255,255,255,0.6)', soft: 'rgba(255,255,255,0.5)', hover: 'rgba(255,255,255,0.06)', card: 'rgba(255,255,255,0.08)' };

export const C = isDesktop ? SLATE : MASALA;

// Inter: the font most phone apps use for numbers and small labels (clear digits, tabular figures).
export const F = isDesktop ? {
  // Desktop: Inter Tight (close to Tracebit's Lausanne); titles in SemiBold with tight spacing (F.heavy).
  regular: 'InterTight_400Regular',
  semibold: 'InterTight_500Medium',
  bold: 'InterTight_600SemiBold',
  heavy: 'InterTight_600SemiBold',
  light: 'InterTight_300Light',
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
