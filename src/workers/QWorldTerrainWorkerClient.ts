import { QWorldChunkTree, TerrainChunk } from '../core/QWorldChunkTree';
import { QWorldTerrainMesh, TerrainRenderMode } from '../core/QWorldTerrainMesh';
import {
  ChunkRequestItem,
  DescendantInvalidationRange,
  RollupRange,
  SerializedChunk,
  WorkerInMessage,
  WorkerOutMessage,
} from './QWorldTerrainWorkerProtocol';

export type ChunkMeshMessage = Extract<WorkerOutMessage, { type: 'CHUNK_MESH' }>;
export type RequestCompleteMessage = Extract<WorkerOutMessage, { type: 'REQUEST_COMPLETE' }>;
export type RollupCompleteMessage = Extract<WorkerOutMessage, { type: 'ROLLUP_COMPLETE' }>;
export type RefinedChunksMessage = Extract<WorkerOutMessage, { type: 'REFINED_CHUNKS' }>;

export interface WorkerClientHandlers {
  onChunkMesh?: (msg: ChunkMeshMessage) => void;
  onRequestComplete?: (msg: RequestCompleteMessage) => void;
  onRollupComplete?: (msg: RollupCompleteMessage) => void;
  onRefinedChunks?: (msg: RefinedChunksMessage) => void;
}

function serializeChunkCopy(c: TerrainChunk): SerializedChunk {
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

export class QWorldTerrainWorkerClient {
  private worker: Worker | null = null;
  private worldEpoch = 0;
  private requestSeq = 0;
  private handlers: WorkerClientHandlers;
  private fallbackTree: QWorldChunkTree | null = null;
  private fallbackMesh: QWorldTerrainMesh | null = null;

  constructor(handlers: WorkerClientHandlers = {}) {
    this.handlers = handlers;
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./QWorldTerrainWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
        const msg = event.data;
        if (msg.worldEpoch !== this.worldEpoch) return;
        if (msg.type === 'CHUNK_MESH') {
          this.handlers.onChunkMesh?.(msg);
        } else if (msg.type === 'REQUEST_COMPLETE') {
          this.handlers.onRequestComplete?.(msg);
        } else if (msg.type === 'ROLLUP_COMPLETE') {
          this.handlers.onRollupComplete?.(msg);
        } else if (msg.type === 'REFINED_CHUNKS') {
          this.handlers.onRefinedChunks?.(msg);
        }
      };
      this.worker.onerror = (err) => {
        console.error('[QWorldTerrainWorkerClient] Worker error:', err.message);
      };
    }
  }

  public setHandlers(handlers: WorkerClientHandlers): void {
    this.handlers = handlers;
  }

  public getWorldEpoch(): number {
    return this.worldEpoch;
  }

  public getRequestSeq(): number {
    return this.requestSeq;
  }

  public syncWorld(chunkTree: QWorldChunkTree): number {
    this.worldEpoch++;
    this.requestSeq++;
    if (!this.worker) {
      this.fallbackTree = chunkTree;
      this.fallbackMesh = new QWorldTerrainMesh(chunkTree);
      return this.worldEpoch;
    }
    const chunks = chunkTree.getAllChunks().map(serializeChunkCopy);
    const msg: WorkerInMessage = {
      type: 'SYNC_WORLD',
      worldEpoch: this.worldEpoch,
      chunks,
    };
    this.worker.postMessage(msg);
    return this.worldEpoch;
  }

  public syncAtmosphere(ashGrid: Uint8Array | null, skyVeilGrid: Uint8Array | null): void {
    if (!this.worker) {
      this.fallbackMesh?.setAtmosphereOverlays(ashGrid, skyVeilGrid);
      return;
    }
    const msg: WorkerInMessage = {
      type: 'SYNC_ATMOS',
      ashGrid: ashGrid ? ashGrid.slice() : null,
      skyVeilGrid: skyVeilGrid ? skyVeilGrid.slice() : null,
    };
    this.worker.postMessage(msg);
  }

  public patchChunks(
    chunks: TerrainChunk[],
    rollupFromLod?: number,
    rollupRange?: RollupRange,
    invalidateRange?: DescendantInvalidationRange
  ): void {
    if (!this.worker) {
      if (this.fallbackTree && invalidateRange) {
        this.fallbackTree.invalidateDescendants(
          invalidateRange.parentLod,
          invalidateRange.minGx,
          invalidateRange.maxGx,
          invalidateRange.minGz,
          invalidateRange.maxGz
        );
      }
      if (this.fallbackTree && rollupFromLod !== undefined && rollupFromLod > 0 && rollupRange) {
        this.fallbackTree.rollupChunksToParent(
          rollupFromLod,
          rollupRange.minCx,
          rollupRange.maxCx,
          rollupRange.minCz,
          rollupRange.maxCz
        );
      }
      return;
    }
    const msg: WorkerInMessage = {
      type: 'PATCH_CHUNKS',
      worldEpoch: this.worldEpoch,
      chunks: chunks.map(serializeChunkCopy),
      rollupFromLod,
      rollupRange,
      invalidateRange,
    };
    this.worker.postMessage(msg);
  }

  public requestChunks(params: {
    lod: number;
    mode: TerrainRenderMode;
    flatWaterSurface: boolean;
    solarDeclinationDeg: number;
    seaLevel: number;
    baseTempC?: number;
    items: ChunkRequestItem[];
    prefetchItems?: ChunkRequestItem[];
  }): number {
    this.requestSeq++;
    const seq = this.requestSeq;
    const epoch = this.worldEpoch;

    if (!this.worker) {
      if (this.fallbackTree && this.fallbackMesh) {
        for (const item of params.items) {
          if (params.lod > 0) {
            this.fallbackTree.refineChunkOnZoom(params.lod, item.wrappedCx, item.cz, params.seaLevel);
          }
          const { positions, normals, colors } = this.fallbackMesh.buildChunkBuffers(
            params.lod,
            item.wrappedCx,
            item.cz,
            params.mode,
            params.flatWaterSurface,
            params.solarDeclinationDeg,
            params.seaLevel,
            params.baseTempC ?? 10
          );
          this.handlers.onChunkMesh?.({
            type: 'CHUNK_MESH',
            worldEpoch: epoch,
            requestSeq: seq,
            lod: params.lod,
            cx: item.cx,
            cz: item.cz,
            wrappedCx: item.wrappedCx,
            positions,
            normals,
            colors,
          });
        }
        this.handlers.onRequestComplete?.({
          type: 'REQUEST_COMPLETE',
          worldEpoch: epoch,
          requestSeq: seq,
          lod: params.lod,
        });
      }
      return seq;
    }

    const msg: WorkerInMessage = {
      type: 'REQUEST_CHUNKS',
      worldEpoch: epoch,
      requestSeq: seq,
      lod: params.lod,
      mode: params.mode,
      flatWaterSurface: params.flatWaterSurface,
      solarDeclinationDeg: params.solarDeclinationDeg,
      seaLevel: params.seaLevel,
      baseTempC: params.baseTempC ?? 10,
      items: params.items,
      prefetchItems: params.prefetchItems,
    };
    this.worker.postMessage(msg);
    return seq;
  }

  public cancelBefore(minSeq: number): void {
    if (!this.worker) return;
    const msg: WorkerInMessage = { type: 'CANCEL_REQUESTS', minSeq };
    this.worker.postMessage(msg);
  }

  public dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
