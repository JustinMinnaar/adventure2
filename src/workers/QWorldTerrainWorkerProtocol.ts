import { TerrainRenderMode } from '../core/QWorldTerrainMesh';

export interface SerializedChunk {
  lod: number;
  cx: number;
  cz: number;
  heights: Int16Array;
  biomes: Uint8Array;
  waterFlags: Uint8Array;
  rainfall: Uint8Array;
}

export interface ChunkRequestItem {
  cx: number;
  cz: number;
  wrappedCx: number;
}

export interface RollupRange {
  minCx: number;
  maxCx: number;
  minCz: number;
  maxCz: number;
}

export interface DescendantInvalidationRange {
  parentLod: number;
  minGx: number;
  maxGx: number;
  minGz: number;
  maxGz: number;
}

export type WorkerInMessage =
  | {
      type: 'SYNC_WORLD';
      worldEpoch: number;
      chunks: SerializedChunk[];
    }
  | {
      type: 'SYNC_ATMOS';
      ashGrid: Uint8Array | null;
      skyVeilGrid: Uint8Array | null;
    }
  | {
      type: 'PATCH_CHUNKS';
      worldEpoch: number;
      chunks: SerializedChunk[];
      rollupFromLod?: number;
      rollupRange?: RollupRange;
      invalidateRange?: DescendantInvalidationRange;
    }
  | {
      type: 'REQUEST_CHUNKS';
      worldEpoch: number;
      requestSeq: number;
      lod: number;
      mode: TerrainRenderMode;
      flatWaterSurface: boolean;
      solarDeclinationDeg: number;
      seaLevel: number;
      baseTempC?: number;
      items: ChunkRequestItem[];
      prefetchItems?: ChunkRequestItem[];
    }
  | {
      type: 'CANCEL_REQUESTS';
      minSeq: number;
    };

export type WorkerOutMessage =
  | {
      type: 'CHUNK_MESH';
      worldEpoch: number;
      requestSeq: number;
      lod: number;
      cx: number;
      cz: number;
      wrappedCx: number;
      positions: Float32Array;
      normals: Float32Array;
      colors: Float32Array;
      refinedChunks?: SerializedChunk[];
    }
  | {
      type: 'REQUEST_COMPLETE';
      worldEpoch: number;
      requestSeq: number;
      lod: number;
    }
  | {
      type: 'ROLLUP_COMPLETE';
      worldEpoch: number;
      chunks: SerializedChunk[];
    }
  | {
      type: 'REFINED_CHUNKS';
      worldEpoch: number;
      chunks: SerializedChunk[];
    };
