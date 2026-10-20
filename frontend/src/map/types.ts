// A frame is one drawing area (metropolitan France, the Paris zoom, each overseas department),
// with its own SVG coordinate system.
export interface MapFeature {
  code: string; // INSEE department code: "01" … "95", "2A", "2B", "971" … "976"
  name: string;
  d: string; // SVG path, already projected into the frame's viewBox
}

export interface MapFrame {
  viewBox: string;
  features: MapFeature[];
}

export interface MapGeometry {
  frames: Record<string, MapFrame>;
}
