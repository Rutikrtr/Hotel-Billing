import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface Device { id: string; name: string }
export interface PrinterState {
  bill: Device | null;
  kitchen: Device | null;     // null: kitchen tickets print on the bill printer
  separateKitchen: boolean;
  paper: 58 | 80;
  feed: number;               // blank lines after each slip (1-4)
}

export const initialPrinter: PrinterState = { bill: null, kitchen: null, separateKitchen: false, paper: 58, feed: 2 };

const printer = createSlice({
  name: 'printer',
  initialState: initialPrinter,
  reducers: {
    setPrinter: (s, a: PayloadAction<Partial<PrinterState>>) => ({ ...s, ...a.payload }),
    restorePrinter: (_s, a: PayloadAction<PrinterState>) => ({ ...initialPrinter, ...a.payload }),
  },
});

export const { setPrinter, restorePrinter } = printer.actions;
export default printer.reducer;
