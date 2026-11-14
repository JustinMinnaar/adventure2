import { CHUNK_SIZE, QWorldChunkTree, TerrainChunk } from '../core/QWorldChunkTree';
import { QWorldTerrainMesh } from '../core/QWorldTerrainMesh';
import {
  ChunkRequestItem,
  SerializedChunk,
  WorkerInMessage,
  WorkerOutMessage,
} from './QWorldTerrainWorkerProtocol';

const chunkTree = new QWorldChunkTree();
const meshBuilder = new QWorldTerrainMesh(chunkTree);

const MAX_RESUMED_QUEUE = 64;

interface BackgroundRefineJob {
  lod: number;
  wrappedCx: number;
  cz: number;
  seaLevel: number;
}

let activeWorldEpoch = 0;
let activeRequest: {
  worldEpoch: number;
  requestSeq: number;
  lod: number;
  mode: Parameters<QWorldTerrainMesh['buildChunkBuffers']>[3];
  flatWaterSurface: boolean;
  solarDeclinationDeg: number;
  seaLevel: number;
  baseTempC: number;
  items: ChunkRequestItem[];
  index: number;
} | null = null;

const resumedQueue: BackgroundRefineJob[] = [];
const resumedKeys = new Set<string>();
let prefetchQueue: BackgroundRefineJob[] = [];
let processTimer: ReturnType<typeof setTimeout> | null = null;

function cloneChunk(c: TerrainChunk): SerializedChunk {
  return {
    lod: c.lod,
    cx: c.cx,
    cz: c.cz,
    heights: c.heights.slice(),
    biomes: c.biomes.slice(),
    waterFlags: c.waterFlags.slice(),
    rainfall: c.rainfall.slice(),
  };
}

function postWorkerMessage(msg: WorkerOutMessage, transfer: Transferable[] = []): void {
  (self as unknown as { postMessage: (m: WorkerOutMessage, t?: Transferable[]) => void }).postMessage(
    msg,
    transfer
  );
}

function scheduleNextStep(): void {
  if (processTimer !== null) return;
  processTimer = setTimeout(processNextJob, 0);
}

function enqueueResumedJobs(req: NonNullable<typeof activeRequest>): void {
  if (req.lod <= 0) return;
  for (let i = req.index; i < req.items.length; i++) {
    const item = req.items[i];
    const key = `${req.lod}:${item.wrappedCx}:${item.cz}`;
    if (resumedKeys.has(key) || chunkTree.getChunk(req.lod, item.wrappedCx, item.cz)) {
      continue;
    }
    if (resumedQueue.length >= MAX_RESUMED_QUEUE) {
      const dropped = resumedQueue.shift();
      if (dropped) resumedKeys.delete(`${dropped.lod}:${dropped.wrappedCx}:${dropped.cz}`);
    }
    resumedKeys.add(key);
    resumedQueue.push({
      lod: req.lod,
      wrappedCx: item.wrappedCx,
      cz: item.cz,
      seaLevel: req.seaLevel,
    });
  }
}

function processBackgroundJob(job: BackgroundRefineJob, epoch: number): void {
  if (job.lod <= 0) return;
  const created: TerrainChunk[] = [];
  chunkTree.refineChunkOnZoom(job.lod, job.wrappedCx, job.cz, job.seaLevel, created);
  if (created.length > 0) {
    postWorkerMessage({
      type: 'REFINED_CHUNKS',
      worldEpoch: epoch,
      chunks: created.map(cloneChunk),
    });
  }
}

function processNextJob(): void {
  processTimer = null;

  // Priority 0: Active foreground visible chunks
  const req = activeRequest;
  if (req && req.worldEpoch === activeWorldEpoch) {
    if (req.index < req.items.length) {
      const item = req.items[req.index++];
      const created: TerrainChunk[] = [];
      if (req.lod > 0) {
        chunkTree.refineChunkOnZoom(req.lod, item.wrappedCx, item.cz, req.seaLevel, created);
      }

      const { positions, normals, colors } = meshBuilder.buildChunkBuffers(
        req.lod,
        item.wrappedCx,
        item.cz,
        req.mode,
        req.flatWaterSurface,
        req.solarDeclinationDeg,
        req.seaLevel,
        req.baseTempC
      );

      const msg: WorkerOutMessage = {
        type: 'CHUNK_MESH',
        worldEpoch: req.worldEpoch,
        requestSeq: req.requestSeq,
        lod: req.lod,
        cx: item.cx,
        cz: item.cz,
        wrappedCx: item.wrappedCx,
        positions,
        normals,
        colors,
        refinedChunks: created.length > 0 ? created.map(cloneChunk) : undefined,
      };

      postWorkerMessage(msg, [positions.buffer, normals.buffer, colors.buffer]);

      if (req.index >= req.items.length) {
        postWorkerMessage({
          type: 'REQUEST_COMPLETE',
          worldEpoch: req.worldEpoch,
          requestSeq: req.requestSeq,
          lod: req.lod,
        });
        activeRequest = null;
      }
      if (activeRequest || resumedQueue.length > 0 || prefetchQueue.length > 0) {
        scheduleNextStep();
      }
      return;
    }
    postWorkerMessage({
      type: 'REQUEST_COMPLETE',
      worldEpoch: req.worldEpoch,
      requestSeq: req.requestSeq,
      lod: req.lod,
    });
    activeRequest = null;
  }

  // Priority 1: Resumed paused generation from previous requests
  while (resumedQueue.length > 0) {
    const job = resumedQueue.shift()!;
    resumedKeys.delete(`${job.lod}:${job.wrappedCx}:${job.cz}`);
    if (!chunkTree.getChunk(job.lod, job.wrappedCx, job.cz)) {
      processBackgroundJob(job, activeWorldEpoch);
      if (resumedQueue.length > 0 || prefetchQueue.length > 0) {
        scheduleNextStep();
      }
      return;
    }
  }

  // Priority 2: Adjacent lookahead prefetch chunks
  while (prefetchQueue.length > 0) {
    const job = prefetchQueue.shift()!;
    if (!chunkTree.getChunk(job.lod, job.wrappedCx, job.cz)) {
      processBackgroundJob(job, activeWorldEpoch);
      if (prefetchQueue.length > 0) {
        scheduleNextStep();
      }
      return;
    }
  }
}

function collectRolledUpParents(
  childLod: number,
  minCx: number,
  maxCx: number,
  minCz: number,
  maxCz: number
): SerializedChunk[] {
  const out: SerializedChunk[] = [];
  let minGx = minCx * CHUNK_SIZE;
  let maxGx = (maxCx + 1) * CHUNK_SIZE - 1;
  let minGz = minCz * CHUNK_SIZE;
  let maxGz = (maxCz + 1) * CHUNK_SIZE - 1;

  for (let pLod = childLod - 1; pLod >= 0; pLod--) {
    minGx = Math.floor(minGx / 3);
    maxGx = Math.floor(maxGx / 3);
    minGz = Math.floor(minGz / 3);
    maxGz = Math.floor(maxGz / 3);

    const pMinCx = Math.floor(minGx / CHUNK_SIZE);
    const pMaxCx = Math.floor(maxGx / CHUNK_SIZE);
    const pMinCz = Math.floor(minGz / CHUNK_SIZE);
    const pMaxCz = Math.floor(maxGz / CHUNK_SIZE);

    for (let pz = pMinCz; pz <= pMaxCz; pz++) {
      for (let px = pMinCx; px <= pMaxCx; px++) {
        const c = chunkTree.getChunk(pLod, px, pz);
        if (c) out.push(cloneChunk(c));
      }
    }
  }
  return out;
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  if (msg.type === 'SYNC_WORLD') {
    activeWorldEpoch = msg.worldEpoch;
    activeRequest = null;
    resumedQueue.length = 0;
    resumedKeys.clear();
    prefetchQueue = [];
    chunkTree.clear();
    for (const c of msg.chunks) {
      chunkTree.setChunk(c);
    }
    return;
  }

  if (msg.type === 'SYNC_ATMOS') {
    meshBuilder.setAtmosphereOverlays(msg.ashGrid, msg.skyVeilGrid);
    return;
  }

  if (msg.type === 'PATCH_CHUNKS') {
    if (msg.worldEpoch !== activeWorldEpoch) return;
    for (const c of msg.chunks) {
      chunkTree.setChunk(c);
    }
    if (msg.invalidateRange) {
      chunkTree.invalidateDescendants(
        msg.invalidateRange.parentLod,
        msg.invalidateRange.minGx,
        msg.invalidateRange.maxGx,
        msg.invalidateRange.minGz,
        msg.invalidateRange.maxGz
      );
    }
    if (msg.rollupFromLod !== undefined && msg.rollupFromLod > 0 && msg.rollupRange) {
      const { minCx, maxCx, minCz, maxCz } = msg.rollupRange;
      chunkTree.rollupChunksToParent(msg.rollupFromLod, minCx, maxCx, minCz, maxCz);
      const parents = collectRolledUpParents(msg.rollupFromLod, minCx, maxCx, minCz, maxCz);
      postWorkerMessage({
        type: 'ROLLUP_COMPLETE',
        worldEpoch: msg.worldEpoch,
        chunks: parents,
      });
    }
    return;
  }

  if (msg.type === 'CANCEL_REQUESTS') {
    if (activeRequest && activeRequest.requestSeq < msg.minSeq) {
      enqueueResumedJobs(activeRequest);
      activeRequest = null;
      if (resumedQueue.length > 0 || prefetchQueue.length > 0) {
        scheduleNextStep();
      }
    }
    return;
  }

  if (msg.type === 'REQUEST_CHUNKS') {
    if (msg.worldEpoch !== activeWorldEpoch) return;
    if (activeRequest) {
      enqueueResumedJobs(activeRequest);
    }

    prefetchQueue =
      msg.lod > 0 && msg.prefetchItems
        ? msg.prefetchItems.map((item) => ({
            lod: msg.lod,
            wrappedCx: item.wrappedCx,
            cz: item.cz,
            seaLevel: msg.seaLevel,
          }))
        : [];

    if (msg.items.length === 0) {
      activeRequest = null;
      postWorkerMessage({
        type: 'REQUEST_COMPLETE',
        worldEpoch: msg.worldEpoch,
        requestSeq: msg.requestSeq,
        lod: msg.lod,
      });
      if (resumedQueue.length > 0 || prefetchQueue.length > 0) {
        scheduleNextStep();
      }
      return;
    }

    activeRequest = {
      worldEpoch: msg.worldEpoch,
      requestSeq: msg.requestSeq,
      lod: msg.lod,
      mode: msg.mode,
      flatWaterSurface: msg.flatWaterSurface,
      solarDeclinationDeg: msg.solarDeclinationDeg,
      seaLevel: msg.seaLevel,
      baseTempC: msg.baseTempC ?? 10,
      items: msg.items,
      index: 0,
    };
    scheduleNextStep();
  }
};
