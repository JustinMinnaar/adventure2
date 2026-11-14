import { describe, it, expect } from 'vitest';
import { computeCometTailMistPixel } from '../core/QWorldSkyMistTextures';

describe('QWorldSkyMistTextures - comet tail mist', () => {
  it('returns zero alpha at texture borders', () => {
    expect(computeCometTailMistPixel(-1, 0)[3]).toBe(0);
    expect(computeCometTailMistPixel(1, 0)[3]).toBe(0);
    expect(computeCometTailMistPixel(0, -1)[3]).toBe(0);
    expect(computeCometTailMistPixel(0, 1)[3]).toBe(0);
    expect(computeCometTailMistPixel(-1.1, 0.2)[3]).toBe(0);
  });

  it('fades monotonically along the straight tail spine away from the comet head', () => {
    const nearHead = computeCometTailMistPixel(-0.6, 0)[3];
    const midInner = computeCometTailMistPixel(-0.1, 0)[3];
    const midOuter = computeCometTailMistPixel(0.4, 0)[3];
    const farTip = computeCometTailMistPixel(0.85, 0)[3];

    expect(nearHead).toBeGreaterThan(0.4);
    expect(nearHead).toBeGreaterThan(midInner);
    expect(midInner).toBeGreaterThan(midOuter);
    expect(midOuter).toBeGreaterThan(farTip);
    expect(farTip).toBeGreaterThan(0);
    expect(farTip).toBeLessThan(0.15);
  });

  it('decays smoothly across transverse slices with no hard edge step', () => {
    const samples: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const v = i * 0.05;
      samples.push(computeCometTailMistPixel(0.0, v)[3]);
    }
    expect(samples[0]).toBeGreaterThan(samples[samples.length - 1]);
    expect(samples[samples.length - 1]).toBe(0);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i - 1] - samples[i]).toBeLessThan(0.18);
    }
  });
});
