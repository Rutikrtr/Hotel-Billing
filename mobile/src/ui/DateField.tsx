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
      <Pressable onPress={() => setOpen(true)} style={[kit.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]} accessibilityRole="button" accessibilityLabel={`${label}: ${shown}`}>
        <Icon.calendar color={C.muted} size={16} />
        <T w="semibold">{shown}</T>
      </Pressable>
      {open && Platform.OS !== 'web' ? (
        <DateTimePicker value={new Date(`${value}T12:00:00`)} mode="date"
          minimumDate={min ? new Date(`${min}T00:00:00`) : undefined} maximumDate={max ? new Date(`${max}T23:59:59`) : undefined}
          onChange={(e, d) => { setOpen(false); if (e.type === 'set' && d) onChange(localDay(d)); }} />
      ) : null}
    </View>
  );
}
