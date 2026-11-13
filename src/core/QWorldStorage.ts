import { QWorldChunkTree } from './QWorldChunkTree';
import { QWorldVectorTree, WorldMarker, WorldPolyline } from './QWorldVectorTree';

interface SerializedChunk {
  lod: number;
  cx: number;
  cz: number;
  h: number[];
  b: number[];
  w: number[];
}

interface SerializedWorld {
  version: 1;
  name: string;
  chunks: SerializedChunk[];
  markers: WorldMarker[];
  polylines: WorldPolyline[];
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
    name: string = 'Untitled World'
  ): string {
    const chunks: SerializedChunk[] = chunkTree.getAllChunks().map((c) => ({
      lod: c.lod,
      cx: c.cx,
      cz: c.cz,
      h: encodeRle(c.heights),
      b: encodeRle(c.biomes),
      w: encodeRle(c.waterFlags),
    }));

    const payload: SerializedWorld = {
      version: 1,
      name,
      chunks,
      markers: vectorTree.getAllMarkers(),
      polylines: vectorTree.getAllPolylines(),
    };

    return JSON.stringify(payload);
  }

  public static deserializeFromJson(json: string): {
    name: string;
    chunkTree: QWorldChunkTree;
    vectorTree: QWorldVectorTree;
  } {
    const parsed = JSON.parse(json) as SerializedWorld;
    const chunkTree = new QWorldChunkTree();
    const vectorTree = new QWorldVectorTree({ minX: -100_000, maxX: 100_000, minZ: -100_000, maxZ: 100_000 });

    for (const sc of parsed.chunks) {
      const chunk = chunkTree.getOrCreateChunk(sc.lod, sc.cx, sc.cz);
      decodeRle(sc.h, chunk.heights);
      decodeRle(sc.b, chunk.biomes);
      decodeRle(sc.w, chunk.waterFlags);
    }

    for (const m of parsed.markers) {
      vectorTree.addMarker(m);
    }
    for (const p of parsed.polylines) {
      vectorTree.addPolyline(p);
    }

    return { name: parsed.name, chunkTree, vectorTree };
  }
}
