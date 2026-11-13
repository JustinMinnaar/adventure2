export type EditorToolMode = 'select' | 'elevate' | 'biome' | 'river' | 'road' | 'marker';
export type CameraPresetMode = '3d' | 'topdown' | 'people';

export interface BiomePreset {
  id: number;
  name: string;
  color: string;
  icon: string;
}

export const BIOME_PRESETS: BiomePreset[] = [
  { id: 1, name: 'Grass', color: '#6bad47', icon: '🌿' },
  { id: 2, name: 'Forest', color: '#216b2e', icon: '🌲' },
  { id: 3, name: 'Rock', color: '#7a7d85', icon: '🪨' },
  { id: 4, name: 'Sand', color: '#d9c285', icon: '🏜️' },
  { id: 5, name: 'Swamp', color: '#385c3d', icon: '🐊' },
  { id: 6, name: 'Jungle', color: '#146126', icon: '🌴' },
  { id: 7, name: 'Snow', color: '#ebf2fa', icon: '❄️' },
  { id: 8, name: 'Farmland', color: '#b8a638', icon: '🌾' },
];

export interface MarkerPreset {
  category: string;
  label: string;
  icon: string;
  color: string;
  minLod: number;
  maxLod: number;
}

export const MARKER_PRESETS: MarkerPreset[] = [
  { category: 'city', label: 'City', icon: '🏰', color: '#f59e0b', minLod: 0, maxLod: 9 },
  { category: 'town', label: 'Town', icon: '🏘️', color: '#eab308', minLod: 1, maxLod: 9 },
  { category: 'fort', label: 'Fort', icon: '🛡️', color: '#94a3b8', minLod: 1, maxLod: 9 },
  { category: 'mine', label: 'Mine', icon: '⛏️', color: '#a8a29e', minLod: 3, maxLod: 9 },
  { category: 'farm', label: 'Farm', icon: '🌾', color: '#84cc16', minLod: 3, maxLod: 9 },
  { category: 'dungeon', label: 'Dungeon', icon: '💀', color: '#ef4444', minLod: 3, maxLod: 9 },
  { category: 'building', label: 'Building', icon: '🏠', color: '#38bdf8', minLod: 7, maxLod: 9 },
];

export const LOD_LABELS: Record<number, string> = {
  0: 'L0 • World (11.2 mi)',
  1: 'L1 • Continent (3.73 mi)',
  2: 'L2 • Kingdom (1.24 mi)',
  3: 'L3 • Region (729 yd)',
  4: 'L4 • Province (243 yd)',
  5: 'L5 • Valley (81 yd)',
  6: 'L6 • Town (27 yd)',
  7: 'L7 • Village (9 yd)',
  8: 'L8 • Street (3 yd)',
  9: 'L9 • People (1 yd)',
};
