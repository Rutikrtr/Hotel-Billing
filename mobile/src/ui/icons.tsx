import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

type P = { color: string; size?: number };
const solid = (d: string) => ({ color, size = 22 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}><Path d={d} fillRule="evenodd" /></Svg>
);

/** Tab and button icons (one filled style, like the web app's bottom bar). */
export const Icon = {
  tables: ({ color, size = 22 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x={3} y={3} width={8} height={8} rx={2} /><Rect x={13} y={3} width={8} height={8} rx={2} />
      <Rect x={3} y={13} width={8} height={8} rx={2} /><Rect x={13} y={13} width={8} height={8} rx={2} />
    </Svg>
  ),
  bills: solid('M5 2.5h14v19l-2.33-1.6L14.33 21.5 12 19.9l-2.33 1.6-2.34-1.6L5 21.5zM8 7v1.6h8V7zm0 4v1.6h8V11zm0 4v1.6h5V15z'),
  analytics: solid('M3 20h18v1.8H3zM5 11h3.2v7.5H5zm5.4-5h3.2v12.5h-3.2zm5.4 3h3.2v9.5h-3.2z'),
  menu: solid('M4 3.5h11.5A3.5 3.5 0 0 1 19 7v13.5H6.5A2.5 2.5 0 0 1 4 18zm3 4v1.7h8V7.5zm0 4v1.7h8v-1.7zm0 4v1.7h5v-1.7z'),
  settings: solid('M10.3 2h3.4l.5 2.6a8 8 0 0 1 1.9 1.1l2.5-.9 1.7 2.9-2 1.7a8 8 0 0 1 0 2.2l2 1.7-1.7 2.9-2.5-.9a8 8 0 0 1-1.9 1.1l-.5 2.6h-3.4l-.5-2.6a8 8 0 0 1-1.9-1.1l-2.5.9-1.7-2.9 2-1.7a8 8 0 0 1 0-2.2l-2-1.7 1.7-2.9 2.5.9a8 8 0 0 1 1.9-1.1zM12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z'),
  chevL: solid('M15.4 4.6 16.8 6l-6 6 6 6-1.4 1.4L8 12z'),
  chevR: solid('M8.6 4.6 7.2 6l6 6-6 6 1.4 1.4L16 12z'),
  star: solid('M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z'),
  starOff: solid('M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8zm0 4.3-1.6 3.4-3.7.5 2.7 2.5-.7 3.7 3.3-1.8 3.3 1.8-.7-3.7 2.7-2.5-3.7-.5z'),
};
