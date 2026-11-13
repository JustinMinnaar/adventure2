import { QWorldChunkTree } from './QWorldChunkTree';
import { QWorldBrushEngine } from './QWorldBrushEngine';
import { QWorldWaterFlood, OceanSeedCell } from './QWorldWaterFlood';
import { QWorldVectorTree } from './QWorldVectorTree';

export function generateStarterWorld(): {
  chunkTree: QWorldChunkTree;
  vectorTree: QWorldVectorTree;
  oceanSeeds: OceanSeedCell[];
} {
  const chunkTree = new QWorldChunkTree();
  const brush = new QWorldBrushEngine(chunkTree);
  const flood = new QWorldWaterFlood(chunkTree, 0);
  const vectorTree = new QWorldVectorTree({
    minX: -500_000,
    maxX: 500_000,
    minZ: -500_000,
    maxZ: 500_000,
  });

  const lod = 0;
  const spacing = chunkTree.getSampleSpacing(lod); // 19683 world units per L0 cell
  const span = chunkTree.getChunkWorldSpan(lod);   // 1594323 world units per L0 chunk

  // Allocate 3x3 L0 chunks centered around (0, 0), starting just below sea level (-15)
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const c = chunkTree.getOrCreateChunk(lod, cx, cz);
      c.heights.fill(-15);
      c.waterFlags.fill(0);
    }
  }

  // Sculpt central continent & mountain spine
  const centerX = span * 0.5;
  const centerZ = span * 0.5;
  brush.applyElevationBrush({
    lod,
    worldX: centerX,
    worldZ: centerZ,
    radiusWorld: span * 0.85,
    mode: 'raise',
    strength: 95,
  });
  brush.applyElevationBrush({
    lod,
    worldX: centerX - spacing * 18,
    worldZ: centerZ - spacing * 10,
    radiusWorld: spacing * 24,
    mode: 'raise',
    strength: 380,
  });
  brush.applyElevationBrush({
    lod,
    worldX: centerX + spacing * 14,
    worldZ: centerZ + spacing * 12,
    radiusWorld: spacing * 20,
    mode: 'raise',
    strength: 220,
  });

  // Paint biomes: Grass base, Forest groves, Rock peaks, Coastal Sand
  brush.applyBiomeBrush({ lod, worldX: centerX, worldZ: centerZ, radiusWorld: span * 0.8, biomeId: 1 });
  brush.applyBiomeBrush({ lod, worldX: centerX + spacing * 8, worldZ: centerZ - spacing * 14, radiusWorld: spacing * 18, biomeId: 2 });
  brush.applyBiomeBrush({ lod, worldX: centerX - spacing * 18, worldZ: centerZ - spacing * 10, radiusWorld: spacing * 14, biomeId: 3 });
  brush.applyBiomeBrush({ lod, worldX: centerX + spacing * 28, worldZ: centerZ + spacing * 18, radiusWorld: spacing * 12, biomeId: 4 });

  // Propagate ocean from outer corner (-1, -1) at L0
  const oceanSeeds: OceanSeedCell[] = [{ cx: -1, cz: -1, lx: 1, lz: 1 }];
  flood.propagateFromSeeds(lod, oceanSeeds);

  // Add a starter river, road, and cities
  vectorTree.addPolyline({
    id: 'starter-river-1',
    type: 'river',
    name: 'Silverrun River',
    sourceVolume: 4,
    points: [
      { x: centerX - spacing * 14, z: centerZ - spacing * 8 },
      { x: centerX, z: centerZ + spacing * 2 },
      { x: centerX + spacing * 24, z: centerZ + spacing * 16 },
    ],
  });

  vectorTree.addPolyline({
    id: 'starter-road-1',
    type: 'road',
    name: 'King’s Road',
    points: [
      { x: centerX - spacing * 6, z: centerZ + spacing * 6 },
      { x: centerX + spacing * 10, z: centerZ + spacing * 4 },
      { x: centerX + spacing * 20, z: centerZ + spacing * 12 },
    ],
  });

  vectorTree.addMarker({
    id: 'starter-city-1',
    name: 'Highwatch',
    category: 'city',
    x: centerX - spacing * 6,
    z: centerZ + spacing * 6,
    minLod: 0,
    maxLod: 9,
  });

  vectorTree.addMarker({
    id: 'starter-town-1',
    name: 'Port Haven',
    category: 'town',
    x: centerX + spacing * 20,
    z: centerZ + spacing * 12,
    minLod: 0,
    maxLod: 9,
  });

  return { chunkTree, vectorTree, oceanSeeds };
}
