/**
 * Lightweight runtime performance, GC/heap, and object-pool telemetry for the Celestial Sky simulation.
 * Tracks per-frame timing breakdowns, detects main-thread spikes (>32ms), estimates heap allocation
 * rate & GC sweeps (via performance.memory when available), and counts object-pool reuses.
 */

export interface PerfSnapshot {
  fps: number;
  avgFrameMs: number;
  maxSpikeMs: number;
  lastSnapshotMs: number;
  lastRenderMs: number;
  lastOmenScanMs: number;
  lastEclipseScanMs: number;
  heapUsedMB: number | null;
  allocKBPerSec: number | null;
  gcCount: number;
  lastGcFreedMB: number;
  poolReuses: number;
  poolAllocations: number;
  poolingRecommended: boolean;
}

interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

class SkyPerfMonitor {
  private frameTimes: number[] = [];
  private maxSpikeMs = 0;
  private lastFpsSampleTime = 0;
  private frameCountInWindow = 0;
  private currentFps = 0;

  private lastSnapshotMs = 0;
  private lastRenderMs = 0;
  private lastOmenScanMs = 0;
  private lastEclipseScanMs = 0;

  private lastHeapSampleTime = 0;
  private lastHeapBytes: number | null = null;
  private heapUsedMB: number | null = null;
  private allocKBPerSec: number | null = null;
  private gcCount = 0;
  private lastGcFreedMB = 0;

  private poolReuses = 0;
  private poolAllocations = 0;
  private lastConsoleLogTime = 0;
  private longTaskObserverStarted = false;

  public startLongTaskObserver(): void {
    if (this.longTaskObserverStarted || typeof PerformanceObserver === 'undefined') return;
    this.longTaskObserverStarted = true;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 50) {
            console.warn(
              `[SkyPerf] Long task detected: ${entry.duration.toFixed(1)}ms ` +
                `(snapshot=${this.lastSnapshotMs.toFixed(1)}ms, render=${this.lastRenderMs.toFixed(1)}ms, ` +
                `omen=${this.lastOmenScanMs.toFixed(1)}ms, eclipse=${this.lastEclipseScanMs.toFixed(1)}ms)`
            );
          }
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch {
      // Browser may not support longtask entryType
    }
  }

  public recordPhase(phase: 'snapshot' | 'render' | 'omen' | 'eclipse', durationMs: number): void {
    switch (phase) {
      case 'snapshot':
        this.lastSnapshotMs = durationMs;
        break;
      case 'render':
        this.lastRenderMs = durationMs;
        break;
      case 'omen':
        this.lastOmenScanMs = durationMs;
        break;
      case 'eclipse':
        this.lastEclipseScanMs = durationMs;
        break;
    }
    if (durationMs > 32) {
      const now = performance.now();
      if (now - this.lastConsoleLogTime > 1000) {
        this.lastConsoleLogTime = now;
        console.warn(`[SkyPerf] Slow ${phase} phase: ${durationMs.toFixed(1)}ms`);
      }
    }
  }

  public recordPoolReuse(count = 1): void {
    this.poolReuses += count;
  }

  public recordPoolAllocation(count = 1): void {
    this.poolAllocations += count;
  }

  public recordFrame(frameMs: number): void {
    const now = performance.now();
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (frameMs > this.maxSpikeMs) this.maxSpikeMs = frameMs;

    if (this.lastFpsSampleTime === 0) this.lastFpsSampleTime = now;
    this.frameCountInWindow++;
    const elapsed = now - this.lastFpsSampleTime;
    if (elapsed >= 1000) {
      this.currentFps = Math.round((this.frameCountInWindow * 1000) / elapsed);
      this.frameCountInWindow = 0;
      this.lastFpsSampleTime = now;
      this.sampleMemory(now);
    }

    if (frameMs > 40 && now - this.lastConsoleLogTime > 1500) {
      this.lastConsoleLogTime = now;
      console.warn(
        `[SkyPerf] Frame hitch ${frameMs.toFixed(1)}ms ` +
          `(snapshot=${this.lastSnapshotMs.toFixed(1)}ms, render=${this.lastRenderMs.toFixed(1)}ms, ` +
          `omen=${this.lastOmenScanMs.toFixed(1)}ms, eclipse=${this.lastEclipseScanMs.toFixed(1)}ms)`
      );
    }
  }

  private sampleMemory(now: number): void {
    const mem = (performance as unknown as { memory?: PerformanceMemoryLike }).memory;
    if (!mem) return;

    const usedBytes = mem.usedJSHeapSize;
    this.heapUsedMB = usedBytes / (1024 * 1024);

    if (this.lastHeapBytes !== null && this.lastHeapSampleTime > 0) {
      const dtSec = Math.max(0.1, (now - this.lastHeapSampleTime) / 1000);
      const deltaBytes = usedBytes - this.lastHeapBytes;
      if (deltaBytes < -250 * 1024) {
        // Heap shrank by >250 KB -> GC sweep occurred
        this.gcCount++;
        this.lastGcFreedMB = Math.abs(deltaBytes) / (1024 * 1024);
        console.info(
          `[SkyPerf] GC sweep #${this.gcCount}: freed ${this.lastGcFreedMB.toFixed(2)} MB ` +
            `(heap now ${this.heapUsedMB.toFixed(1)} MB, poolReuses=${this.poolReuses})`
        );
      } else if (deltaBytes >= 0) {
        this.allocKBPerSec = Math.round(deltaBytes / 1024 / dtSec);
      }
    }

    this.lastHeapBytes = usedBytes;
    this.lastHeapSampleTime = now;
  }

  public resetSpikes(): void {
    this.maxSpikeMs = 0;
  }

  public getSnapshot(): PerfSnapshot {
    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    const avg = this.frameTimes.length > 0 ? sum / this.frameTimes.length : 0;
    const poolingRecommended =
      (this.allocKBPerSec !== null && this.allocKBPerSec > 2048) || this.gcCount > 5;

    return {
      fps: this.currentFps,
      avgFrameMs: avg,
      maxSpikeMs: this.maxSpikeMs,
      lastSnapshotMs: this.lastSnapshotMs,
      lastRenderMs: this.lastRenderMs,
      lastOmenScanMs: this.lastOmenScanMs,
      lastEclipseScanMs: this.lastEclipseScanMs,
      heapUsedMB: this.heapUsedMB,
      allocKBPerSec: this.allocKBPerSec,
      gcCount: this.gcCount,
      lastGcFreedMB: this.lastGcFreedMB,
      poolReuses: this.poolReuses,
      poolAllocations: this.poolAllocations,
      poolingRecommended,
    };
  }
}

export const skyPerfMonitor = new SkyPerfMonitor();
