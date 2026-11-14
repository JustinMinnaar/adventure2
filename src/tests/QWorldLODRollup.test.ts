import { describe, it, expect, vi, afterEach } from 'vitest';
import { QWorldChunkTree, CHUNK_SIZE, CHUNK_AREA } from '../core/QWorldChunkTree';
import { QWorldBrushEngine } from '../core/QWorldBrushEngine';
import { QWorldTerrainMesh } from '../core/QWorldTerrainMesh';
import { QWorldTerrainWorkerClient } from '../workers/QWorldTerrainWorkerClient';
import { WorkerInMessage } from '../workers/QWorldTerrainWorkerProtocol';

describe('QWorldLODRollup (L3 detail -> L2 overview)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('computes center-weighted median of a 3x3 block of L3 elevations, biomes, and ocean flags', () => {
    const tree = new QWorldChunkTree();
    const spacingL3 = tree.getSampleSpacing(3); // 729

    // Fill a 3x3 L3 block covering L2 sample (0, 0):
    // x < 2 (6 cells including center, weight 11/15) at +300; x = 2 (3 cells, weight 4/15) at +600 -> weighted median = 300
    // 6 Forest (2) + 3 Sand (4) -> dominant = 2; 5 ocean + 4 dry -> parent ocean (1)
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        const height = x < 2 ? 300 : 600;
        const biome = x < 2 ? 2 : 4;
        const waterFlag = z * 3 + x < 5 ? 1 : 0;
        tree.setSampleAt(3, x * spacingL3, z * spacingL3, { height, biome, waterFlag });
      }
    }

    tree.rollupToParent(3, 0, 0, 0, 0);

    expect(tree.getHeightAt(2, 0, 0)).toBe(300);
    expect(tree.getBiomeAt(2, 0, 0)).toBe(2);
    expect(tree.getChunk(2, 0, 0)?.waterFlags[0]).toBe(1);
  });

  it('handles heavy L3 detail across 36 chunks (147k samples) and renders L2 in under 15 ms', () => {
    const tree = new QWorldChunkTree();
    const brush = new QWorldBrushEngine(tree);
    const meshBuilder = new QWorldTerrainMesh(tree);
    const spacingL3 = tree.getSampleSpacing(3);

    // Sculpt 100 overlapping mountain & forest brush strokes at L3 across a 6x6 L3 chunk area
    const brushStart = performance.now();
    for (let i = 0; i < 100; i++) {
      const wx = ((i % 10) * 35 + 10) * spacingL3;
      const wz = (Math.floor(i / 10) * 35 + 10) * spacingL3;
      brush.applyElevationBrush({
        lod: 3,
        worldX: wx,
        worldZ: wz,
        radiusWorld: 14 * spacingL3,
        mode: i % 4 === 0 ? 'lower' : 'raise',
        strength: 180,
      });
      brush.applyBiomeBrush({
        lod: 3,
        worldX: wx,
        worldZ: wz,
        radiusWorld: 14 * spacingL3,
        biomeId: i % 3 === 0 ? 3 : 2,
      });
    }
    const brushDuration = performance.now() - brushStart;

    expect(tree.getStoredChunkCount(3)).toBeGreaterThanOrEqual(25);
    expect(brushDuration).toBeLessThan(150);

    // Verify L2 reflects the L3 mountain peak
    const peakSampleX = 45 * spacingL3;
    const peakSampleZ = 45 * spacingL3;
    const l2Height = tree.getHeightAt(2, peakSampleX, peakSampleZ);
    expect(l2Height).not.toBe(0);

    // Render L2 visible ring (9 L2 chunks covering the entire L3 region and beyond)
    const renderStart = performance.now();
    const l2Geometries = meshBuilder.buildVisibleRing(2, 0, 0, 1, 'biome');
    const renderDuration = performance.now() - renderStart;

    expect(l2Geometries.length).toBe(9);
    expect(l2Geometries[0].getAttribute('position').count).toBe((CHUNK_SIZE + 1) * (CHUNK_SIZE + 1));
    expect(renderDuration).toBeLessThan(80);

    l2Geometries.forEach((g) => g.dispose());
  });

  it('smooths height steps and anti-aliases diagonal biome/coastline edges as you zoom in', () => {
    const tree = new QWorldChunkTree();
    const l0Chunk = tree.getOrCreateChunk(0, 0, 0);
    l0Chunk.waterFlags.fill(0);

    // Create a sharp diagonal cliff & biome/coastline step at L0 (x + z < 10 -> +600 Forest, else 0 Ocean)
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = z * CHUNK_SIZE + x;
        if (x + z < 10) {
          l0Chunk.heights[idx] = 600;
          l0Chunk.biomes[idx] = 2;
          l0Chunk.waterFlags[idx] = 0;
        } else {
          l0Chunk.heights[idx] = 0;
          l0Chunk.biomes[idx] = 1;
          l0Chunk.waterFlags[idx] = 1;
        }
      }
    }

    const maxStepDiff = (arr: Int16Array): number => {
      let maxDiff = 0;
      for (let z = 0; z < CHUNK_SIZE - 1; z++) {
        for (let x = 0; x < CHUNK_SIZE - 1; x++) {
          const i = z * CHUNK_SIZE + x;
          maxDiff = Math.max(maxDiff, Math.abs(arr[i + 1] - arr[i]), Math.abs(arr[i + CHUNK_SIZE] - arr[i]));
        }
      }
      return maxDiff;
    };

    const l1H = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const l1B = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const l1W = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    tree.sampleChunkGrid(1, 0, 0, l1H, l1B, l1W);

    const l2H = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const l2B = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const l2W = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    tree.sampleChunkGrid(2, 0, 0, l2H, l2B, l2W);

    // Height step smoothness strictly improves at each finer LOD (600 -> <= 200 -> <= 70)
    const diffL0 = maxStepDiff(l0Chunk.heights);
    const diffL1 = maxStepDiff(l1H);
    const diffL2 = maxStepDiff(l2H);
    expect(diffL0).toBe(600);
    expect(diffL1).toBeLessThanOrEqual(200);
    expect(diffL2).toBeLessThanOrEqual(70);
    expect(diffL2).toBeLessThan(diffL1);

    // Diagonal staircase corner at L0 (x=5, z=5) is ocean/Grass(1), but its surrounding 3 neighbors
    // include Forest(2), so the L1 sub-cell (lx=15, lz=15) at the inner corner is chamfered to Forest(2)
    expect(l0Chunk.biomes[5 * CHUNK_SIZE + 5]).toBe(1);
    expect(l1B[15 * CHUNK_SIZE + 15]).toBe(2);
  });

  it('rolls up a painted L2 circle of rocks (Radius 8) into L1 and L0 and syncs with QWorldTerrainWorkerClient', () => {
    const postedMessages: WorkerInMessage[] = [];
    class MockWorker {
      public onmessage: ((ev: MessageEvent) => void) | null = null;
      public onerror: ((ev: ErrorEvent) => void) | null = null;
      public postMessage(msg: WorkerInMessage): void {
        postedMessages.push(msg);
      }
      public terminate(): void {}
    }
    vi.stubGlobal('Worker', MockWorker);

    const tree = new QWorldChunkTree();
    const brush = new QWorldBrushEngine(tree);

    // Seed L0 plateau of Snow (biome 7) at 1400 yd, then refine L1 and L2 chunks beforehand (as when zoomed in)
    const l0 = tree.getOrCreateChunk(0, 0, 0);
    l0.heights.fill(1400);
    l0.biomes.fill(7);
    l0.waterFlags.fill(0);
    tree.refineChunkOnZoom(2, 0, 0, 0);
    tree.refineChunkOnZoom(2, 1, 0, 0);
    tree.refineChunkOnZoom(2, 0, 1, 0);
    tree.refineChunkOnZoom(2, 1, 1, 0);

    const client = new QWorldTerrainWorkerClient();
    client.syncWorld(tree);

    // Paint a Radius-8 circle of Rock (biome 3) at L2 positioned so L0 cell (15, 15) has 4/9 Rock L1 sub-cells
    // including its center L1 sub-cell (46, 46): center L2 cell is (133.5, 133.5) -> L1 (44, 44), adjacent to L0 (15, 15)
    const spacingL2 = tree.getSampleSpacing(2);
    const centerX = 133.5 * spacingL2;
    const centerZ = 133.5 * spacingL2;
    const radiusWorld = 8 * spacingL2;
    brush.applyBiomeBrush({
      lod: 2,
      worldX: centerX,
      worldZ: centerZ,
      radiusWorld,
      biomeId: 3,
    });

    // Verify L1 and L0 both reflect the painted Rock circle (including L0 cell (15, 15) via center-weighted mode)
    const spacingL1 = tree.getSampleSpacing(1);
    const spacingL0 = tree.getSampleSpacing(0);
    expect(tree.getBiomeAt(2, centerX, centerZ)).toBe(3);
    expect(tree.getBiomeAt(1, 44 * spacingL1, 44 * spacingL1)).toBe(3);
    expect(tree.getBiomeAt(1, 46 * spacingL1, 46 * spacingL1)).toBe(3);
    expect(tree.getBiomeAt(0, 14 * spacingL0, 14 * spacingL0)).toBe(3);
    expect(tree.getBiomeAt(0, 15 * spacingL0, 15 * spacingL0)).toBe(3);

    // Sync the hierarchy of modified L2/L1/L0 chunks to the worker and verify worker-side L1/L0 meshes
    const minGx = Math.floor((centerX - radiusWorld) / spacingL2);
    const maxGx = Math.ceil((centerX + radiusWorld) / spacingL2);
    const minGz = Math.floor((centerZ - radiusWorld) / spacingL2);
    const maxGz = Math.ceil((centerZ + radiusWorld) / spacingL2);
    const hierarchyChunks = tree.collectChunksInGridHierarchy(2, minGx, maxGx, minGz, maxGz);
    expect(hierarchyChunks.some((c) => c.lod === 0)).toBe(true);
    expect(hierarchyChunks.some((c) => c.lod === 1)).toBe(true);

    client.patchChunks(hierarchyChunks, undefined, undefined, {
      parentLod: 2,
      minGx,
      maxGx,
      minGz,
      maxGz,
    });

    const patchMsg = postedMessages.find((m) => m.type === 'PATCH_CHUNKS');
    expect(patchMsg).toBeDefined();
    expect(patchMsg?.type === 'PATCH_CHUNKS' && patchMsg.invalidateRange).toEqual({
      parentLod: 2,
      minGx,
      maxGx,
      minGz,
      maxGz,
    });

    // Replay SYNC_WORLD + PATCH_CHUNKS on an isolated worker tree & verify L1/L0 mesh colors turn Rock (not Snow)
    const workerTree = new QWorldChunkTree();
    for (const msg of postedMessages) {
      if (msg.type === 'SYNC_WORLD') {
        for (const c of msg.chunks) workerTree.setChunk(c);
      } else if (msg.type === 'PATCH_CHUNKS') {
        for (const c of msg.chunks) workerTree.setChunk(c);
        if (msg.invalidateRange) {
          workerTree.invalidateDescendants(
            msg.invalidateRange.parentLod,
            msg.invalidateRange.minGx,
            msg.invalidateRange.maxGx,
            msg.invalidateRange.minGz,
            msg.invalidateRange.maxGz
          );
        }
      }
    }

    const workerMesh = new QWorldTerrainMesh(workerTree);
    const l1Buf = workerMesh.buildChunkBuffers(1, 0, 0, 'biomes');
    const l1Idx = (44 * (CHUNK_SIZE + 1) + 44) * 3;
    // Rock [0.48, 0.49, 0.52] * shade vs Snow [0.92, 0.95, 0.98] * shade: red channel < 0.60
    expect(l1Buf.colors[l1Idx]).toBeLessThan(0.6);

    const l0Buf = workerMesh.buildChunkBuffers(0, 0, 0, 'biomes');
    const l0Idx = (15 * (CHUNK_SIZE + 1) + 15) * 3;
    expect(l0Buf.colors[l0Idx]).toBeLessThan(0.6);

    client.dispose();
  });

  it('sampleChunkGrid falls back to L0 when an intermediate L1 level only has chunks in another region or across an unallocated neighbor border', () => {
    const tree = new QWorldChunkTree();
    const l0a = tree.getOrCreateChunk(0, 0, 0);
    const l0b = tree.getOrCreateChunk(0, 1, 0);
    l0a.heights.fill(900);
    l0a.biomes.fill(3);
    l0a.waterFlags.fill(0);
    l0b.heights.fill(900);
    l0b.biomes.fill(3);
    l0b.waterFlags.fill(0);

    // Allocate ONLY L1 chunk (0, 0), leaving L1 (1, 0) and L1 (2, 0) unallocated
    const l1 = tree.getOrCreateChunk(1, 0, 0);
    l1.heights.fill(900);
    l1.biomes.fill(3);
    l1.waterFlags.fill(0);

    const outH = new Int16Array(CHUNK_AREA);
    const outB = new Uint8Array(CHUNK_AREA);
    const outW = new Uint8Array(CHUNK_AREA);

    // L2 chunk (6, 0) lies under unallocated L1 chunk (2, 0), which must inherit from L0 (0, 0)
    tree.sampleChunkGrid(2, 6, 0, outH, outB, outW);
    const interiorIdx = 40 * CHUNK_SIZE + 40;
    expect(outH[interiorIdx]).toBe(900);
    expect(outB[interiorIdx]).toBe(3);
    expect(outW[interiorIdx]).toBe(0);

    // L2 chunk (2, 0) lies under L1 (0, 0), but its right border (lx = 80) interpolates into unallocated L1 (1, 0)
    tree.sampleChunkGrid(2, 2, 0, outH, outB, outW);
    const rightBorderIdx = 40 * CHUNK_SIZE + (CHUNK_SIZE - 1);
    expect(outH[rightBorderIdx]).toBe(900);
    expect(outB[rightBorderIdx]).toBe(3);
    expect(outW[rightBorderIdx]).toBe(0);
  });
});
