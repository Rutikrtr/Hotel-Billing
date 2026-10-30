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

// Desktop app 2.5: a cool, calm "Slate & Indigo" theme for a full-screen office/counter screen.
const SLATE: typeof MASALA = {
  bg: '#F4F6FB',
  surface: '#FFFFFF',
  surface2: '#EEF1F7',
  line: '#E2E7F0',
  text: '#141A2B',
  muted: '#667085',
  accent: '#4F46E5',
  accentStrong: '#3730A3',
  accentSoft: '#EEF0FF',
  brand1: '#4F46E5',
  brand2: '#7C3AED',
  ink: '#151A33',
  free: '#0F9D58',
  freeSoft: '#E6F6EE',
  billed: '#B45309',
  billedSoft: '#FEF3E2',
  danger: '#D92D20',
  dangerSoft: '#FEECEB',
  veg: '#15803D',
  nonveg: '#B91C1C',
  busyTile: '#F3F2FF', busyLine: '#C7C4FB', billedTile: '#FFF8EC', billedLine: '#F6D5A3', editLine: '#C7C4FB',
  dishTile: '#F5F4FF', dishLine: '#B9B5F7', floorTop: '#FAFBFE', floorBottom: '#F1F4FA', floorDot: '#CDD4E3', floorLine: '#E2E7F0', spotLine: '#CBD3E1',
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
export const shadow = { shadowColor: isDesktop ? '#1E2A5A' : '#7C2D12', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 };
