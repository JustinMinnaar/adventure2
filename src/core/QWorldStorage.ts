import { QWorldChunkTree, WORLD_SPAN_X, WORLD_SPAN_Z } from './QWorldChunkTree';
import { QWorldVectorTree, WorldMarker, WorldPolyline, WorldRoute } from './QWorldVectorTree';

interface SerializedChunk {
  lod: number;
  cx: number;
  cz: number;
  h: number[];
  b: number[];
  w: number[];
  r?: number[];
}

interface SerializedWorld {
  version: 1;
  name: string;
  seaLevel?: number;
  chunks: SerializedChunk[];
  markers: WorldMarker[];
  polylines: WorldPolyline[];
  routes?: WorldRoute[];
}

function encodeRle(arr: Int16Array | Uint8Array): number[] {
  const out: number[] = [];
  const len = arr.length;
  if (len === 0) return out;
  let prev = arr[0];
  let count = 1;
  for (let i = 1; i < len; i++) {
    const val = arr[i];
    if (val === prev) {
      count++;
    } else {
      out.push(count, prev);
      prev = val;
      count = 1;
    }
  }
  out.push(count, prev);
  return out;
}

function decodeRle(rle: number[], target: Int16Array | Uint8Array): void {
  let ptr = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const count = rle[i];
    const val = rle[i + 1];
    target.fill(val, ptr, ptr + count);
    ptr += count;
  }
}

export class QWorldStorage {
  public static serializeToJson(
    chunkTree: QWorldChunkTree,
    vectorTree: QWorldVectorTree,
    name: string = 'Untitled World',
    seaLevel?: number
  ): string {
    const chunks: SerializedChunk[] = chunkTree.getAllChunks().map((c) => ({
      lod: c.lod,
      cx: c.cx,
      cz: c.cz,
      h: encodeRle(c.heights),
      b: encodeRle(c.biomes),
      w: encodeRle(c.waterFlags),
      r: encodeRle(c.rainfall),
    }));

    const payload: SerializedWorld = {
      version: 1,
      name,
      seaLevel,
      chunks,
      markers: vectorTree.getAllMarkers(),
      polylines: vectorTree.getAllPolylines(),
      routes: vectorTree.getAllRoutes(),
    };

    return JSON.stringify(payload);
  }

  public static deserializeFromJson(json: string): {
    name: string;
    seaLevel?: number;
    chunkTree: QWorldChunkTree;
    vectorTree: QWorldVectorTree;
  } {
    const parsed = JSON.parse(json) as SerializedWorld;
    const chunkTree = new QWorldChunkTree();
    const vectorTree = new QWorldVectorTree({
      minX: -100_000,
      maxX: Math.max(100_000, WORLD_SPAN_X),
      minZ: -100_000,
      maxZ: Math.max(100_000, WORLD_SPAN_Z),
    });

    for (const sc of parsed.chunks) {
      const chunk = chunkTree.getOrCreateChunk(sc.lod, sc.cx, sc.cz);
      decodeRle(sc.h, chunk.heights);
      decodeRle(sc.b, chunk.biomes);
      decodeRle(sc.w, chunk.waterFlags);
      if (sc.r) decodeRle(sc.r, chunk.rainfall);
    }

    for (const m of parsed.markers) {
      vectorTree.addMarker(m);
    }
    for (const p of parsed.polylines) {
      vectorTree.addPolyline(p);
    }
    if (parsed.routes) {
      for (const r of parsed.routes) {
        vectorTree.addRoute(r);
      }
    }

    return { name: parsed.name, seaLevel: parsed.seaLevel, chunkTree, vectorTree };
  }
}
