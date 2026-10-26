import React, { useState } from 'react';
import { View } from 'react-native';
import { planItems, type LayoutArea, type PlanItem } from '../types';

/**
 * Draws an area's floor plan: every table is a block placed on the grid, so a table can be
 * 2 spots across, 2 down, or a 2 × 2 square. Spots are equal width; rows have a fixed height.
 */
export default function PlanGrid({ area, rowH, gap = 6, render }: {
  area: LayoutArea; rowH: number; gap?: number; render: (x: PlanItem) => React.ReactNode;
}) {
  const [w, setW] = useState(0);
  const cw = w ? (w - gap * (area.cols - 1)) / area.cols : 0;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: area.rows * rowH + (area.rows - 1) * gap }}>
      {cw > 0 ? planItems(area).map((x) => (
        <View key={`${x.r}-${x.c}`} style={{
          position: 'absolute', left: x.c * (cw + gap), top: x.r * (rowH + gap),
          width: x.w * cw + (x.w - 1) * gap, height: x.h * rowH + (x.h - 1) * gap,
        }}>
          {render(x)}
        </View>
      )) : null}
    </View>
  );
}
