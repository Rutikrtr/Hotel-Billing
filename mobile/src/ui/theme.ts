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

// Desktop app 2.5: warm glass (after the owner's Dribbble reference): frosted white panels over a soft
// peach-orange backdrop, orange #F7921E actions and round + buttons, dark #1E1E1E text, grey quiet labels.
const SLATE: typeof MASALA = {
  bg: 'transparent',
  surface: 'rgba(255,255,255,0.78)',
  surface2: 'rgba(255,250,244,0.80)',
  line: 'rgba(30,30,30,0.08)',
  text: '#1E1E1E',
  muted: '#8A8580',
  accent: '#F7921E',
  accentStrong: '#E07800',
  accentSoft: 'rgba(247,146,30,0.12)',
  brand1: '#FFAB3D',
  brand2: '#F7861C',
  ink: '#2A2622',
  free: '#1FA35B',
  freeSoft: 'rgba(31,163,91,0.10)',
  billed: '#9B4DE0',
  billedSoft: 'rgba(155,77,224,0.10)',
  danger: '#E5484D',
  dangerSoft: 'rgba(229,72,77,0.10)',
  veg: '#15803D',
  nonveg: '#B91C1C',
  busyTile: 'rgba(255,243,228,0.88)', busyLine: 'rgba(247,146,30,0.55)', billedTile: 'rgba(247,240,255,0.88)', billedLine: 'rgba(155,77,224,0.40)', editLine: 'rgba(247,146,30,0.45)',
  dishTile: 'rgba(255,243,228,0.90)', dishLine: 'rgba(247,146,30,0.55)', floorTop: 'rgba(255,255,255,0.40)', floorBottom: 'rgba(255,255,255,0.28)', floorDot: 'rgba(30,30,30,0.12)', floorLine: 'rgba(255,255,255,0.75)', spotLine: 'rgba(30,30,30,0.16)',
};

/** The desktop sidebar: frosted glass, orange for the selected page. */
export const SIDEBAR = { bg: 'rgba(255,255,255,0.62)', line: 'rgba(255,255,255,0.85)', text: '#1E1E1E', icon: '#8A8580', soft: '#8A8580', hover: 'rgba(247,146,30,0.10)', card: 'rgba(255,255,255,0.7)' };

export const C = isDesktop ? SLATE : MASALA;

// Inter: the font most phone apps use for numbers and small labels (clear digits, tabular figures).
export const F = isDesktop ? {
  // Desktop (Stripe-like): lighter weights; big page titles use Inter Light (F.light).
  regular: 'Inter_400Regular',
  semibold: 'Inter_500Medium',
  bold: 'Inter_600SemiBold',
  heavy: 'Inter_600SemiBold',
  light: 'Inter_300Light',
} : {
  regular: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
  light: 'Inter_500Medium',
};

/** Soft shadow tinted with the brand colour (never plain grey). */
export const shadow = { shadowColor: isDesktop ? '#8A4B12' : '#7C2D12', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 };
