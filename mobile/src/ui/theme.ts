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

// Desktop app 2.5: "Tangerine" – built from the owner's palettes: tangerine #FD6500 / #FF8D21 for buttons and
// highlights, soft #FFF4DF / #FFE2C4 / #FFCD90 / #FFB76B shades, a warm off-white page, a light cream sidebar,
// and slate #7F8DA3 for quiet text and the "billed" status.
const SLATE: typeof MASALA = {
  bg: '#FBF6F1',
  surface: '#FFFFFF',
  surface2: '#FFF4DF',
  line: '#F3E3D1',
  text: '#2B1A0E',
  muted: '#7F8DA3',
  accent: '#FD6500',
  accentStrong: '#D74100',
  accentSoft: '#FFE2C4',
  brand1: '#FF8D21',
  brand2: '#FD6500',
  ink: '#2B1A0E',
  free: '#16A34A',
  freeSoft: '#E8F7EE',
  billed: '#5E6B85',
  billedSoft: '#EEF1F6',
  danger: '#D93025',
  dangerSoft: '#FDECEA',
  veg: '#15803D',
  nonveg: '#B91C1C',
  busyTile: '#FFF4DF', busyLine: '#FFCD90', billedTile: '#F5F7FA', billedLine: '#C9D1DE', editLine: '#FFCD90',
  dishTile: '#FFF4DF', dishLine: '#FFB76B', floorTop: '#FFFCF8', floorBottom: '#FFF5EA', floorDot: '#F0D2B2', floorLine: '#F3E3D1', spotLine: '#EDCDAB',
};

/** The desktop sidebar: light cream with tangerine for the selected page. */
export const SIDEBAR = { bg: '#FFF4DF', line: '#F3E3D1', text: '#4A3626', icon: '#B07A52', soft: '#7F8DA3', hover: '#FFE2C4', card: '#FFE9CF' };

export const C = isDesktop ? SLATE : MASALA;

// Inter: the font most phone apps use for numbers and small labels (clear digits, tabular figures).
export const F = {
  regular: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
};

/** Soft shadow tinted with the brand colour (never plain grey). */
export const shadow = { shadowColor: isDesktop ? '#B45309' : '#7C2D12', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 };
