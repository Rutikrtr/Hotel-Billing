import React from 'react';
import { View } from 'react-native';
import { planItems, type LayoutArea, type PlanItem } from '../types';

/**
 * Draws an area's floor plan: every table is a block placed on the grid, so a table can be 2 spots across,
 * 2 down, or a 2 × 2 square. Columns are percentages of the width, so the plan follows the window smoothly
 * (no re-measuring while the sidebar folds); rows have a fixed height.
 */
export default function PlanGrid({ area, rowH, gap = 6, render }: {
  area: LayoutArea; rowH: number; gap?: number; render: (x: PlanItem) => React.ReactNode;
}) {
  const col = 100 / area.cols;
  return (
    <View style={{ height: area.rows * rowH + (area.rows - 1) * gap, marginHorizontal: -gap / 2 }}>
      {planItems(area).map((x) => (
        <View key={`${x.r}-${x.c}`} style={{
          position: 'absolute', left: `${x.c * col}%`, width: `${x.w * col}%`, paddingHorizontal: gap / 2,
          top: x.r * (rowH + gap), height: x.h * rowH + (x.h - 1) * gap,
        }}>
          {render(x)}
        </View>
      ))}
    </View>
  );
}
