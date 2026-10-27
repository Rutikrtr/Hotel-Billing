import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { Platform } from 'react-native';

/** A printer: Bluetooth (id = its Bluetooth address) or Wi-Fi/LAN (wifi: true, id = "IP:port"). */
export interface Device { id: string; name: string; wifi?: boolean }
export interface PrinterState {
  bill: Device | null;
  kitchen: Device | null;     // null: kitchen tickets print on the bill printer
  separateKitchen: boolean;
  paper: 58 | 80;
  feed: number;               // blank lines after each slip (1-4)
  voice?: boolean;            // mic button in dish search (on unless switched off)
}

/** In the web app the browser's print dialog is the printer (AirPrint on iPhone, any printer on a computer). */
export const BROWSER: Device = { id: 'browser', name: 'This browser’s print' };
const web = Platform.OS === 'web';
export const initialPrinter: PrinterState = { bill: web ? BROWSER : null, kitchen: null, separateKitchen: false, paper: 58, feed: 2 };

const printer = createSlice({
  name: 'printer',
  initialState: initialPrinter,
  reducers: {
    setPrinter: (s, a: PayloadAction<Partial<PrinterState>>) => ({ ...s, ...a.payload }),
    restorePrinter: (_s, a: PayloadAction<PrinterState>) => ({ ...initialPrinter, ...a.payload, ...(web ? { bill: BROWSER, kitchen: null, separateKitchen: false } : {}) }),
  },
});

export const { setPrinter, restorePrinter } = printer.actions;
export default printer.reducer;
