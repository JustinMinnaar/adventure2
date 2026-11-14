/**
 * Precomputed transparent Gaussian mist overlay textures for Canvas2D sky rendering.
 * Eliminates expensive per-frame `ctx.filter` blurs and concentric stroke contour lines
 * by baking C-infinity analytical 2D Gaussians with sub-LSB dithering into cached canvases.
 */

export interface QWorldSkyMistTextureSet {
  galaxySpine: HTMLCanvasElement;
  galaxyCore: HTMLCanvasElement;
  galaxyPatchBlue: HTMLCanvasElement;
  galaxyPatchLavender: HTMLCanvasElement;
  galaxyDarkRift: HTMLCanvasElement;
  chrysalisNebula: HTMLCanvasElement;
  cometTailMist: HTMLCanvasElement;
}

type MistPixelSampler = (u: number, v: number) => [number, number, number, number];

let cachedMistTextures: QWorldSkyMistTextureSet | null = null;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function hannGaussian1D(t: number, sigma: number): number {
  const absT = Math.abs(t);
  if (absT >= 1) return 0;
  const cosT = Math.cos(absT * Math.PI * 0.5);
  return cosT * cosT * Math.exp(-(t * t) / (2 * sigma * sigma));
}

function radialWindow(r: number): number {
  if (r >= 1) return 0;
  const cosR = Math.cos(r * Math.PI * 0.5);
  return cosR * cosR;
}

/**
 * Evaluates normalized galactic spine mist RGBA `[r, g, b, alpha]` for `u, v in [-1, 1]`.
 * Uses a longitudinal Hann-Gaussian window for ripple-free tiling (`du = 1/3`)
 * and a multi-Gaussian transverse disc profile tapering smoothly to zero at borders.
 */
export function computeGalaxySpinePixel(u: number, v: number): [number, number, number, number] {
  const absU = Math.abs(u);
  const absV = Math.abs(v);
  if (absU >= 1 || absV >= 1) return [165, 205, 245, 0];

  const wU = hannGaussian1D(u, 0.44);
  const cosV = Math.cos(absV * Math.PI * 0.5);
  const wV = cosV * cosV;

  const v2 = v * v;
  const gOuter = 0.24 * Math.exp(-v2 / (2 * 0.50 * 0.50));
  const gMid = 0.30 * Math.exp(-v2 / (2 * 0.28 * 0.28));
  const gInner = 0.32 * Math.exp(-v2 / (2 * 0.15 * 0.15));
  const gCore = 0.14 * Math.exp(-v2 / (2 * 0.07 * 0.07));
  const sumG = gOuter + gMid + gInner + gCore;
  if (sumG <= 1e-6) return [165, 205, 245, 0];

  const r = (gOuter * 165 + gMid * 190 + gInner * 225 + gCore * 255) / sumG;
  const g = (gOuter * 205 + gMid * 222 + gInner * 242 + gCore * 252) / sumG;
  const b = (gOuter * 245 + gMid * 255 + gInner * 255 + gCore * 240) / sumG;
  return [r, g, b, clamp01(sumG * wV * wU)];
}

/**
 * Evaluates normalized Galactic Core Bulge ("The Astral Heart") RGBA in unit coordinates `[-1, 1]`.
 */
export function computeGalaxyCorePixel(u: number, v: number): [number, number, number, number] {
  const r = Math.hypot(u, v);
  if (r >= 1) return [186, 230, 253, 0];

  const window = radialWindow(r);
  const r2 = r * r;
  const g1 = 0.45 * Math.exp(-r2 / (2 * 0.16 * 0.16));
  const g2 = 0.30 * Math.exp(-r2 / (2 * 0.28 * 0.28));
  const g3 = 0.17 * Math.exp(-r2 / (2 * 0.42 * 0.42));
  const g4 = 0.08 * Math.exp(-r2 / (2 * 0.56 * 0.56));
  const sumG = g1 + g2 + g3 + g4;
  if (sumG <= 1e-6) return [186, 230, 253, 0];

  const red = (g1 * 254 + g2 * 253 + g3 * 216 + g4 * 186) / sumG;
  const green = (g1 * 243 + g2 * 224 + g3 * 180 + g4 * 230) / sumG;
  const blue = (g1 * 199 + g2 * 71 + g3 * 254 + g4 * 253) / sumG;
  return [red, green, blue, clamp01(sumG * window)];
}

/**
 * Evaluates soft longitudinal star-cloud density patch RGBA in unit coordinates `[-1, 1]`.
 */
export function computeGalaxyPatchPixel(
  u: number,
  v: number,
  isLavender: boolean
): [number, number, number, number] {
  const r = Math.hypot(u, v);
  if (r >= 1) return isLavender ? [216, 180, 254, 0] : [186, 230, 253, 0];

  const window = radialWindow(r);
  const r2 = r * r;
  const gCore = 0.65 * Math.exp(-r2 / (2 * 0.24 * 0.24));
  const gHalo = 0.35 * Math.exp(-r2 / (2 * 0.44 * 0.44));
  const sumG = gCore + gHalo;

  if (isLavender) {
    const red = (gCore * 250 + gHalo * 216) / sumG;
    const green = (gCore * 232 + gHalo * 180) / sumG;
    const blue = (gCore * 255 + gHalo * 254) / sumG;
    return [red, green, blue, clamp01(sumG * window)];
  }
  const red = (gCore * 224 + gHalo * 186) / sumG;
  const green = (gCore * 242 + gHalo * 230) / sumG;
  const blue = (gCore * 254 + gHalo * 253) / sumG;
  return [red, green, blue, clamp01(sumG * window)];
}

/**
 * Evaluates continuous dark interstellar dust rift RGBA in unit coordinates `[-1, 1]`.
 */
export function computeDarkRiftPixel(u: number, v: number): [number, number, number, number] {
  const absU = Math.abs(u);
  const absV = Math.abs(v);
  if (absU >= 1 || absV >= 1) return [2, 6, 23, 0];

  const wU = hannGaussian1D(u, 0.44);
  const cosV = Math.cos(absV * Math.PI * 0.5);
  const v2 = v * v;
  const gRift = 0.65 * Math.exp(-v2 / (2 * 0.22 * 0.22)) + 0.35 * Math.exp(-v2 / (2 * 0.40 * 0.40));
  return [2, 6, 23, clamp01(gRift * cosV * cosV * wU)];
}

/**
 * Evaluates normalized emission mist RGBA for The Chrysalis Nebula in unit coordinates `[-1, 1]`.
 */
export function computeNebulaMistPixel(u: number, v: number): [number, number, number, number] {
  const r = Math.hypot(u, v);
  if (r >= 1) return [139, 92, 246, 0];

  const window = radialWindow(r);
  const r2 = r * r;
  const gViolet = 0.30 * Math.exp(-r2 / (2 * 0.46 * 0.46));
  const gCyan = 0.38 * Math.exp(-r2 / (2 * 0.28 * 0.28));
  const gRose = 0.32 * Math.exp(-r2 / (2 * 0.16 * 0.16));
  const sumG = gViolet + gCyan + gRose;
  if (sumG <= 1e-6) return [139, 92, 246, 0];

  const red = (gViolet * 112 + gCyan * 28 + gRose * 244) / sumG;
  const green = (gViolet * 82 + gCyan * 185 + gRose * 84) / sumG;
  const blue = (gViolet * 238 + gCyan * 232 + gRose * 136) / sumG;
  return [red, green, blue, clamp01(sumG * window)];
}

/**
 * Evaluates soft, smoothly fading comet tail mist RGBA in unit coordinates `[-1, 1]`.
 * Head sits near `u = -0.80, v = 0`; the straight ion mist plume and curved dust mist fan
 * expand gently rightward while tapering continuously to zero before texture boundaries.
 */
export function computeCometTailMistPixel(u: number, v: number): [number, number, number, number] {
  const absU = Math.abs(u);
  const absV = Math.abs(v);
  if (absU >= 1 || absV >= 1) return [248, 113, 113, 0];

  const uHead = -0.80;
  const s = u >= uHead ? (u - uHead) / (1 - uHead) : 0;
  const cosS = Math.cos(s * Math.PI * 0.5);
  const wLong = cosS * cosS;

  let forwardShoulder = 1;
  if (u < uHead) {
    const sBack = (uHead - u) / (1 + uHead);
    const cosBack = Math.cos(sBack * Math.PI * 0.5);
    forwardShoulder = Math.exp(-(sBack * sBack) / (2 * 0.28 * 0.28)) * cosBack * cosBack;
  }

  const cosV = Math.cos(absV * Math.PI * 0.5);
  const wV = cosV * cosV;

  // 1. Straight Ion Mist Plume along antisolar spine (v = 0)
  const sigmaIon = 0.048 + 0.13 * s;
  const ionProfile = Math.exp(-(v * v) / (2 * sigmaIon * sigmaIon));
  const ionDensity = 0.45 * ionProfile * Math.pow(1 - s, 1.65) * wLong;

  // 2. Broad Gently Curved Dust Mist Fan
  const vCurve = 0.20 * Math.pow(s, 1.4);
  const sigmaDust = 0.075 + 0.34 * Math.pow(s, 0.85);
  const dv = v - vCurve;
  const dustProfile = Math.exp(-(dv * dv) / (2 * sigmaDust * sigmaDust));
  const dustDensity = 0.35 * dustProfile * Math.pow(1 - s, 1.35) * wLong;

  const combined = (ionDensity + dustDensity) * forwardShoulder * wV;
  if (combined <= 1e-6) return [248, 113, 113, 0];

  const sumW = ionDensity + dustDensity;
  const red = (ionDensity * (254 - 10 * s) + dustDensity * (244 - 28 * s)) / sumW;
  const green = (ionDensity * (206 - 90 * s) + dustDensity * (98 - 60 * s)) / sumW;
  const blue = (ionDensity * (206 - 90 * s) + dustDensity * (108 - 70 * s)) / sumW;
  return [red, green, blue, clamp01(combined)];
}

function buildMistCanvas(width: number, height: number, sampler: MistPixelSampler): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D context for QWorldSkyMistTextures offscreen canvas');
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (let y = 0; y < height; y++) {
    const v = ((y + 0.5) / height) * 2 - 1;
    for (let x = 0; x < width; x++) {
      const u = ((x + 0.5) / width) * 2 - 1;
      const [r, g, b, alpha] = sampler(u, v);
      const offset = (y * width + x) * 4;
      if (alpha <= 0) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        continue;
      }
      const hash = (((x * 73856093) ^ (y * 19349663)) >>> 0) & 255;
      const dither = (hash / 255 - 0.5) * 0.9;
      data[offset] = Math.max(0, Math.min(255, Math.round(r)));
      data[offset + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[offset + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[offset + 3] = Math.max(0, Math.min(255, Math.round(clamp01(alpha) * 255 + dither)));
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Returns lazily generated and cached transparent Canvas2D mist textures for fast 60 FPS sky compositing.
 */
export function getQWorldSkyMistTextures(): QWorldSkyMistTextureSet {
  if (cachedMistTextures) return cachedMistTextures;
  if (typeof document === 'undefined') {
    throw new Error('getQWorldSkyMistTextures requires a browser DOM environment');
  }

  cachedMistTextures = {
    galaxySpine: buildMistCanvas(256, 256, computeGalaxySpinePixel),
    galaxyCore: buildMistCanvas(256, 256, computeGalaxyCorePixel),
    galaxyPatchBlue: buildMistCanvas(160, 160, (u, v) => computeGalaxyPatchPixel(u, v, false)),
    galaxyPatchLavender: buildMistCanvas(160, 160, (u, v) => computeGalaxyPatchPixel(u, v, true)),
    galaxyDarkRift: buildMistCanvas(256, 160, computeDarkRiftPixel),
    chrysalisNebula: buildMistCanvas(320, 320, computeNebulaMistPixel),
    cometTailMist: buildMistCanvas(320, 160, computeCometTailMistPixel),
  };

  return cachedMistTextures;
}
