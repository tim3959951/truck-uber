import type { ViewStyle } from 'react-native';
import type { LatLng } from './types';

export type MapProps = {
  center?: LatLng;
  zoom?: number;
  pickup?: LatLng | null;
  drop?: LatLng | null;
  path?: [number, number][] | null;
  approach?: [number, number][] | null;
  truck?: { pos: [number, number]; heading?: number } | null;
  /** px reserved at the bottom (for the sheet) when fitting bounds */
  bottomPadding?: number;
  style?: ViewStyle;
};
