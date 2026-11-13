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

  const lod = 1;
  const spacing = chunkTree.getSampleSpacing(lod); // 6,561 yd per L1 cell

  // Allocate 5x5 L1 chunks (cx/cz: -1..3) covering L0 chunk (0, 0) plus ocean margin
  for (let cz = -1; cz <= 3; cz++) {
    for (let cx = -1; cx <= 3; cx++) {
      const c = chunkTree.getOrCreateChunk(lod, cx, cz);
      c.heights.fill(-15);
      c.waterFlags.fill(0);
    }
  }

  // Sculpt central continent & mountain spine at L1 (maps to L0 chunk (0, 0))
  const l0Span = chunkTree.getChunkWorldSpan(0);
  const centerX = l0Span * 0.5;
  const centerZ = l0Span * 0.5;
  brush.applyElevationBrush({
    lod,
    worldX: centerX,
    worldZ: centerZ,
    radiusWorld: l0Span * 0.38,
    mode: 'raise',
    strength: 110,
  });
  brush.applyElevationBrush({
    lod,
    worldX: centerX - spacing * 36,
    worldZ: centerZ - spacing * 22,
    radiusWorld: spacing * 54,
    mode: 'raise',
    strength: 380,
  });
  brush.applyElevationBrush({
    lod,
    worldX: centerX + spacing * 32,
    worldZ: centerZ + spacing * 28,
    radiusWorld: spacing * 46,
    mode: 'raise',
    strength: 220,
  });

  // Paint biomes: Grass base, Forest groves, Rock peaks, Coastal Sand
  brush.applyBiomeBrush({ lod, worldX: centerX, worldZ: centerZ, radiusWorld: l0Span * 0.36, biomeId: 1 });
  brush.applyBiomeBrush({ lod, worldX: centerX + spacing * 20, worldZ: centerZ - spacing * 26, radiusWorld: spacing * 42, biomeId: 2 });
  brush.applyBiomeBrush({ lod, worldX: centerX - spacing * 36, worldZ: centerZ - spacing * 22, radiusWorld: spacing * 32, biomeId: 3 });
  brush.applyBiomeBrush({ lod, worldX: centerX + spacing * 58, worldZ: centerZ + spacing * 38, radiusWorld: spacing * 28, biomeId: 4 });

  // Add gentle organic coastal/biome variation at L1 before rolling up to L0
  for (let cz = 0; cz <= 2; cz++) {
    for (let cx = 0; cx <= 2; cx++) {
      const c = chunkTree.getChunk(lod, cx, cz);
      if (!c) continue;
      for (let lz = 0; lz < 81; lz++) {
        for (let lx = 0; lx < 81; lx++) {
          const idx = lz * 81 + lx;
          const gx = cx * 81 + lx;
          const gz = cz * 81 + lz;
          const n = Math.sin(gx * 0.19 + gz * 0.11) * Math.cos(gz * 0.17 - gx * 0.09);
          if (c.heights[idx] > -35 && c.heights[idx] < 45) {
            c.heights[idx] = Math.round(c.heights[idx] + n * 28);
            if (c.heights[idx] > 0 && c.biomes[idx] === 0) c.biomes[idx] = 1;
          }
        }
      }
    }
  }

  // Propagate ocean from outer L1 corner (-1, -1) and roll up to L0
  const oceanSeeds: OceanSeedCell[] = [{ cx: -1, cz: -1, lx: 1, lz: 1 }];
  flood.propagateFromSeeds(lod, oceanSeeds);
  chunkTree.rollupChunksToParent(lod, -1, 3, -1, 3);

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
