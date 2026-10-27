import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { localDay } from '../dates';
import { Icon } from './icons';
import { s as kit, T } from './kit';
import { C } from './theme';

/** A date box that opens the phone's calendar. value and onChange use "YYYY-MM-DD". */
export default function DateField({ label, value, onChange, min, max }: { label: string; value: string; onChange: (day: string) => void; min?: string; max?: string }) {
  const [open, setOpen] = useState(false);
  const shown = new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={{ gap: 5, flex: 1 }}>
      <T w="semibold" style={{ fontSize: 12.5, color: C.muted }}>{label}</T>
      {Platform.OS === 'web' ? (
        // Web app: the browser's own date picker (works on iPhone Safari and computers).
        React.createElement('input', {
          type: 'date', value, min, max, 'aria-label': label,
          onChange: (e: { target: { value: string } }) => { if (e.target.value) onChange(e.target.value); },
          style: { height: 44, borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface, padding: '0 12px', font: '600 15px Inter_600SemiBold, system-ui, sans-serif', color: C.text, width: '100%', boxSizing: 'border-box' },
        })
      ) : (
      <Pressable onPress={() => setOpen(true)} style={[kit.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]} accessibilityRole="button" accessibilityLabel={`${label}: ${shown}`}>
        <Icon.calendar color={C.muted} size={16} />
        <T w="semibold">{shown}</T>
      </Pressable>
      )}
      {open && Platform.OS !== 'web' ? (
        <DateTimePicker value={new Date(`${value}T12:00:00`)} mode="date"
          minimumDate={min ? new Date(`${min}T00:00:00`) : undefined} maximumDate={max ? new Date(`${max}T23:59:59`) : undefined}
          onChange={(e, d) => { setOpen(false); if (e.type === 'set' && d) onChange(localDay(d)); }} />
      ) : null}
    </View>
  );
}
