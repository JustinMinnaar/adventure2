import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CELESTIAL_CONFIG,
  computeCelestialSnapshot,
  findAdjacentEclipse,
  projectUpcomingEclipses,
  scanUpcomingOmens,
  worldCoordsToLatLon,
} from '../core/QWorldCelestial';
import {
  WORLD_CONSTELLATIONS,
  GALAXY_CLOUD,
  GALAXY_CORE_RA_DEG,
  GALAXY_CORE_DEC_DEG,
  COLOURED_NEBULA,
  buildConsistentStarCatalog,
} from '../core/QWorldConstellations';
import {
  computeGalaxySpinePixel,
  computeNebulaMistPixel,
  getQWorldSkyMistTextures,
} from '../core/QWorldSkyMistTextures';
import { WORLD_SPAN_X, WORLD_SPAN_Z } from '../core/QWorldChunkTree';

describe('QWorldCelestial', () => {
  it('maps Adventure2 world coordinates to planetary latitude and longitude', () => {
    const center = worldCoordsToLatLon(WORLD_SPAN_X * 0.5, WORLD_SPAN_Z * 0.5);
    expect(center.latitudeDeg).toBeCloseTo(0, 1);
    expect(center.longitudeDeg).toBeCloseTo(0, 1);

    const north = worldCoordsToLatLon(WORLD_SPAN_X * 0.75, WORLD_SPAN_Z * 0.25);
    expect(north.latitudeDeg).toBeCloseTo(45, 1);
    expect(north.longitudeDeg).toBeCloseTo(90, 1);
  });

  it('produces longer summer days than winter days in the northern hemisphere', () => {
    // Vernal equinox = Day 80 -> Summer solstice ~ Day 171, Winter solstice ~ Day 354
    const summerSnap = computeCelestialSnapshot(170 * 24 + 12, 48, 0, DEFAULT_CELESTIAL_CONFIG);
    const winterSnap = computeCelestialSnapshot(353 * 24 + 12, 48, 0, DEFAULT_CELESTIAL_CONFIG);

    expect(summerSnap.sun.sky.altitudeDeg).toBeGreaterThan(winterSnap.sun.sky.altitudeDeg + 35);
    const summerDayLen = (summerSnap.sun.riseSet.setHour ?? 18) - (summerSnap.sun.riseSet.riseHour ?? 6);
    const winterDayLen = (winterSnap.sun.riseSet.setHour ?? 18) - (winterSnap.sun.riseSet.riseHour ?? 6);
    expect(summerDayLen).toBeGreaterThan(winterDayLen + 5);
  });

  it('cycles primary moon phases over its synodic period and trails L5 shards behind it', () => {
    const t0 = 10 * 24;
    const snap0 = computeCelestialSnapshot(t0, 35, 0, DEFAULT_CELESTIAL_CONFIG);
    const synodicHours = DEFAULT_CELESTIAL_CONFIG.primaryMoon.synodicPeriodDays * 24;
    const snapCycle = computeCelestialSnapshot(t0 + synodicHours, 35, 0, DEFAULT_CELESTIAL_CONFIG);

    expect(snapCycle.primaryMoon.phaseFraction).toBeCloseTo(snap0.primaryMoon.phaseFraction, 2);
    expect(snap0.trojanCluster.shards.length).toBe(DEFAULT_CELESTIAL_CONFIG.trojanCluster.shardCount);

    // L5 cluster rises roughly 2.5 - 4.5 hours after the primary moon on normal days
    if (snap0.primaryMoon.riseSet.riseHour !== null && snap0.trojanCluster.riseSet.riseHour !== null) {
      let lagHours = snap0.trojanCluster.riseSet.riseHour - snap0.primaryMoon.riseSet.riseHour;
      if (lagHours < 0) lagHours += 24;
      expect(lagHours).toBeGreaterThan(2.0);
      expect(lagHours).toBeLessThan(5.5);
    }
  });

  it('moves the outer Black Moon retrograde and triggers Ash-Full surge near opposition', () => {
    const day1 = computeCelestialSnapshot(24, 30, 0, DEFAULT_CELESTIAL_CONFIG, false);
    const day6 = computeCelestialSnapshot(6 * 24, 30, 0, DEFAULT_CELESTIAL_CONFIG, false);

    // Retrograde longitude decreases over time (unwrapped)
    let deltaRad = day6.blackMoon.orbitalAngleRad - day1.blackMoon.orbitalAngleRad;
    if (deltaRad > Math.PI) deltaRad -= Math.PI * 2;
    if (deltaRad < -Math.PI) deltaRad += Math.PI * 2;
    expect(deltaRad).toBeLessThan(0);

    // Scan forward and verify that an Ash-Full opposition event is found and triggers higher visibility
    const omens = scanUpcomingOmens(0, 35, 0, DEFAULT_CELESTIAL_CONFIG, 120);
    const ashEvent = omens.find((o) => o.type === 'ash-full');
    expect(ashEvent).toBeDefined();

    if (ashEvent) {
      const ashSnap = computeCelestialSnapshot(ashEvent.worldHours, 35, 0, DEFAULT_CELESTIAL_CONFIG, false);
      expect(ashSnap.blackMoon.isAshFull).toBe(true);
      expect(ashSnap.blackMoon.surfaceVisibility).toBeGreaterThan(0.25);
    }
  });

  it('projects upcoming solar eclipses and navigates forward/backward between them', () => {
    const eclipses = projectUpcomingEclipses(0, 35, 0, DEFAULT_CELESTIAL_CONFIG, 50, 10);
    expect(eclipses.length).toBeGreaterThanOrEqual(2);

    const first = findAdjacentEclipse(0, 1, 35, 0, DEFAULT_CELESTIAL_CONFIG, 50);
    expect(first).not.toBeNull();
    if (first) {
      const peakSnap = computeCelestialSnapshot(first.worldHours, 35, 0, DEFAULT_CELESTIAL_CONFIG, false);
      expect(peakSnap.sun.sky.aboveHorizon).toBe(true);
      expect(peakSnap.sun.eclipseFraction).toBeGreaterThan(0.02);

      const second = findAdjacentEclipse(first.worldHours, 1, 35, 0, DEFAULT_CELESTIAL_CONFIG, 50);
      expect(second).not.toBeNull();
      if (second) {
        expect(second.worldHours).toBeGreaterThan(first.endWorldHours);
        const backToFirst = findAdjacentEclipse(second.worldHours, -1, 35, 0, DEFAULT_CELESTIAL_CONFIG, 50);
        expect(backToFirst).not.toBeNull();
        expect(backToFirst?.worldHours).toBeCloseTo(first.worldHours, 1);
      }
    }
  });

  it('builds a consistent star catalog with no duplicate stars, capping faintness and including constellation stars', () => {
    const catalog = buildConsistentStarCatalog(480);
    expect(catalog.length).toBe(480);

    // Determinism test
    const catalog2 = buildConsistentStarCatalog(480);
    expect(catalog[0].raRad).toBe(catalog2[0].raRad);
    expect(catalog[250].decRad).toBe(catalog2[250].decRad);

    // Verify all constellation anchor stars are present in the catalog
    let totalConstellationStars = 0;
    for (const con of WORLD_CONSTELLATIONS) {
      totalConstellationStars += con.stars.length;
      for (const cs of con.stars) {
        const found = catalog.some(
          (s) => Math.abs(s.raRad - cs.raDeg * (Math.PI / 180)) < 1e-4 && Math.abs(s.decRad - cs.decDeg * (Math.PI / 180)) < 1e-4
        );
        expect(found).toBe(true);
      }
    }
    expect(totalConstellationStars).toBeGreaterThan(50);

    // Verify nebula is a pure mist cloud with no artificial central star
    const nebCenterStar = catalog.find((s) => s.name === 'Stella Chrysalis');
    expect(nebCenterStar).toBeUndefined();

    // Verify faintness filtering: no faint mud (all mag <= 0.74)
    for (const s of catalog) {
      expect(s.mag).toBeLessThanOrEqual(0.74);
      expect(s.mag).toBeGreaterThanOrEqual(0.04);
    }

    // Verify separation rejection and rare close companion pairs (< 5% of catalog)
    const DEG = 180 / Math.PI;
    let closePairsCount = 0;
    for (let i = 0; i < catalog.length; i++) {
      const a = catalog[i];
      for (let j = i + 1; j < catalog.length; j++) {
        const b = catalog[j];
        const sinDDec = Math.sin((a.decRad - b.decRad) * 0.5);
        const sinDRa = Math.sin((a.raRad - b.raRad) * 0.5);
        const h = sinDDec * sinDDec + Math.cos(a.decRad) * Math.cos(b.decRad) * sinDRa * sinDRa;
        const angDistDeg = 2 * Math.asin(Math.min(1, Math.sqrt(h))) * DEG;

        // Even close pairs must not completely overlap (minimum 0.08° separation)
        expect(angDistDeg).toBeGreaterThanOrEqual(0.08);

        if (angDistDeg < 0.60) {
          closePairsCount++;
        }
      }
    }

    // Rare close companion stars (<5% of total catalog)
    expect(closePairsCount).toBeGreaterThan(0);
    expect(closePairsCount / catalog.length).toBeLessThan(0.05);
  });

  it('defines an alien Galaxy Cloud (The Astral River) along an inclined plane with core bulge and dark rifts', () => {
    expect(GALAXY_CLOUD.name).toBe('The Astral River');
    expect(GALAXY_CLOUD.inclinationDeg).toBe(58);
    expect(GALAXY_CLOUD.ascendingNodeDeg).toBe(64);
    expect(GALAXY_CORE_RA_DEG).toBeCloseTo(282.0, 1);
    expect(GALAXY_CORE_DEC_DEG).toBeCloseTo(-18.0, 1);
    expect(GALAXY_CLOUD.nodes.length).toBeGreaterThanOrEqual(40);

    // Must have warm core bulge nodes
    const coreNodes = GALAXY_CLOUD.nodes.filter((n) => n.tint === '#fef3c7');
    expect(coreNodes.length).toBeGreaterThan(0);

    // Must have dark dust rift nodes
    const riftNodes = GALAXY_CLOUD.nodes.filter((n) => n.tint === '#64748b');
    expect(riftNodes.length).toBeGreaterThan(0);

    // All nodes must lie strictly in the galactic equator plane with 0 transverse deviation
    const DEG_TO_RAD = Math.PI / 180;
    const iRad = GALAXY_CLOUD.inclinationDeg * DEG_TO_RAD;
    const oRad = GALAXY_CLOUD.ascendingNodeDeg * DEG_TO_RAD;
    const nx = Math.sin(iRad) * Math.sin(oRad);
    const ny = -Math.sin(iRad) * Math.cos(oRad);
    const nz = Math.cos(iRad);

    for (const node of GALAXY_CLOUD.nodes) {
      const raRad = node.raDeg * DEG_TO_RAD;
      const decRad = node.decDeg * DEG_TO_RAD;
      const x = Math.cos(decRad) * Math.cos(raRad);
      const y = Math.cos(decRad) * Math.sin(raRad);
      const z = Math.sin(decRad);
      const dot = x * nx + y * ny + z * nz;
      expect(Math.abs(dot)).toBeLessThan(1e-5);
    }
  });

  it('defines The Chrysalis Nebula with saved coordinates, dimensions and multi-hued composition', () => {
    expect(COLOURED_NEBULA.name).toBe('The Chrysalis Nebula');
    expect(COLOURED_NEBULA.centerRaDeg).toBeCloseTo(218.0, 1);
    expect(COLOURED_NEBULA.centerDecDeg).toBeCloseTo(34.5, 1);
    expect(COLOURED_NEBULA.radiusMajorDeg).toBeGreaterThan(COLOURED_NEBULA.radiusMinorDeg);
    expect(COLOURED_NEBULA.coreColor).toBe('#f43f5e');
    expect(COLOURED_NEBULA.midColor).toBe('#06b6d4');
    expect(COLOURED_NEBULA.outerColor).toBe('#8b5cf6');
  });

  it('calculates the 12-year periodic comet appearing in Year 3 and Year 15 with 4x moon width tail', () => {
    const hoursPerDay = DEFAULT_CELESTIAL_CONFIG.hoursPerDay;
    const daysPerYear = DEFAULT_CELESTIAL_CONFIG.daysPerYear;

    // Helper to calculate worldHours for a given year, day, and local hour
    const getHours = (year: number, day: number, hour = 23) =>
      ((year - 1) * daysPerYear + (day - 1)) * hoursPerDay + hour;

    // Year 1 Day 55: Inactive (off cycle)
    const snapY1 = computeCelestialSnapshot(getHours(1, 55), 35, 0, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snapY1.year).toBe(1);
    expect(snapY1.comet.active).toBe(false);

    // Year 2 Day 55: Inactive
    const snapY2 = computeCelestialSnapshot(getHours(2, 55), 35, 0, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snapY2.year).toBe(2);
    expect(snapY2.comet.active).toBe(false);

    // Year 3 Day 55: Active perihelion apparition!
    const snapY3 = computeCelestialSnapshot(getHours(3, 55), 35, 0, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snapY3.year).toBe(3);
    expect(snapY3.comet.active).toBe(true);
    expect(snapY3.comet.activityFraction).toBeGreaterThan(0.95);
    // Tail width must be strictly 4 times the width arc of the moon
    const moonWidthArc = DEFAULT_CELESTIAL_CONFIG.primaryMoon.angularRadiusDeg * 2; // 0.56°
    expect(snapY3.comet.tailWidthDeg).toBeCloseTo(moonWidthArc * 4, 2); // 2.24°
    expect(snapY3.comet.tailLengthDeg).toBeGreaterThan(20);

    // Active omen trigger when above horizon at night
    if (snapY3.sun.sky.altitudeDeg < -2 && snapY3.comet.sky.altitudeDeg > 0) {
      expect(snapY3.activeOmens.some((o) => o.type === 'comet-apparition')).toBe(true);
    }

    // Year 4 Day 55: Inactive again
    const snapY4 = computeCelestialSnapshot(getHours(4, 55), 35, 0, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snapY4.year).toBe(4);
    expect(snapY4.comet.active).toBe(false);

    // Year 14 Day 55: Inactive (11 years later)
    const snapY14 = computeCelestialSnapshot(getHours(14, 55), 35, 0, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snapY14.year).toBe(14);
    expect(snapY14.comet.active).toBe(false);

    // Year 15 Day 55: Return apparition (12-year orbit period!)
    const snapY15 = computeCelestialSnapshot(getHours(15, 55), 35, 0, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snapY15.year).toBe(15);
    expect(snapY15.comet.active).toBe(true);
    expect(snapY15.comet.activityFraction).toBeGreaterThan(0.95);
    expect(snapY15.comet.tailWidthDeg).toBeCloseTo(moonWidthArc * 4, 2);
  });

  it('supports calendar year jumping and year stepping while preserving day of year and hour', () => {
    const hoursPerDay = DEFAULT_CELESTIAL_CONFIG.hoursPerDay;
    const daysPerYear = DEFAULT_CELESTIAL_CONFIG.daysPerYear;
    const yearHours = daysPerYear * hoursPerDay;

    // Start at Year 1 Day 34 at 2:00 (as shown in user initial view)
    let curHours = ((1 - 1) * daysPerYear + (34 - 1)) * hoursPerDay + 2;
    let snap = computeCelestialSnapshot(curHours, 0, 9.2, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snap.year).toBe(1);
    expect(snap.dayOfYear).toBe(34);
    expect(snap.localHour).toBeCloseTo(2.0, 1);
    expect(snap.comet.active).toBe(false);

    // Jump directly to Year 3 (same day and hour)
    curHours = ((3 - 1) * daysPerYear + (34 - 1)) * hoursPerDay + 2;
    snap = computeCelestialSnapshot(curHours, 0, 9.2, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snap.year).toBe(3);
    expect(snap.dayOfYear).toBe(34);
    expect(snap.localHour).toBeCloseTo(2.0, 1);
    // Day 34 in Year 3 is within the 25-day perihelion window around Day 55 (55 - 25 = 30)
    expect(snap.comet.active).toBe(true);

    // Step forward 1 year (+1y / ']')
    curHours += yearHours;
    snap = computeCelestialSnapshot(curHours, 0, 9.2, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snap.year).toBe(4);
    expect(snap.dayOfYear).toBe(34);
    expect(snap.comet.active).toBe(false);

    // Step forward 11 more years to Year 15
    curHours += yearHours * 11;
    snap = computeCelestialSnapshot(curHours, 0, 9.2, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snap.year).toBe(15);
    expect(snap.dayOfYear).toBe(34);
    expect(snap.comet.active).toBe(true);

    // Step back 1 year (-1y / '[')
    curHours -= yearHours;
    snap = computeCelestialSnapshot(curHours, 0, 9.2, DEFAULT_CELESTIAL_CONFIG, false);
    expect(snap.year).toBe(14);
    expect(snap.comet.active).toBe(false);
  });

  it('verifies diurnal and sidereal sky rotation rates are consistent across Year 1 and Year 3', () => {
    const cfg = DEFAULT_CELESTIAL_CONFIG;
    const lat = 0;
    const lon = 9.2;

    // Compare hour-by-hour progression in Year 1 vs Year 3
    const d34_Y1 = ((1 - 1) * cfg.daysPerYear + (34 - 1)) * cfg.hoursPerDay;
    const d34_Y3 = ((3 - 1) * cfg.daysPerYear + (34 - 1)) * cfg.hoursPerDay;

    for (let h = 0; h < 24; h += 3) {
      const snapY1 = computeCelestialSnapshot(d34_Y1 + h, lat, lon, cfg, false);
      const snapY3 = computeCelestialSnapshot(d34_Y3 + h, lat, lon, cfg, false);

      // Local sidereal angle and Sun horizontal coordinates must match exactly for the same day and hour
      expect(snapY3.localSiderealRad).toBeCloseTo(snapY1.localSiderealRad, 4);
      expect(snapY3.sun.sky.altitudeDeg).toBeCloseTo(snapY1.sun.sky.altitudeDeg, 2);
      expect(snapY3.sun.sky.azimuthDeg).toBeCloseTo(snapY1.sun.sky.azimuthDeg, 2);
    }

    // Sidereal rotation advances by ~15.038° per hour
    const snapH0 = computeCelestialSnapshot(d34_Y3 + 0, lat, lon, cfg, false);
    const snapH1 = computeCelestialSnapshot(d34_Y3 + 1, lat, lon, cfg, false);
    let siderealDiffRad = snapH1.localSiderealRad - snapH0.localSiderealRad;
    if (siderealDiffRad < 0) siderealDiffRad += Math.PI * 2;
    const degPerHour = (siderealDiffRad * 180) / Math.PI;
    expect(degPerHour).toBeGreaterThan(14.9);
    expect(degPerHour).toBeLessThan(15.2);
  });

  it('guarantees Year 3 Day 55 comet is visible in evening twilight (18:30) and sets by 23:00', () => {
    const cfg = DEFAULT_CELESTIAL_CONFIG;
    const lat = 25;
    const lon = 0;
    const day55Base = ((3 - 1) * cfg.daysPerYear + (55 - 1)) * cfg.hoursPerDay;

    // At 18:30 (dusk): Sun has set, sky is dark, comet is high in western sky
    const snap1830 = computeCelestialSnapshot(day55Base + 18.5, lat, lon, cfg, false);
    expect(snap1830.comet.active).toBe(true);
    expect(snap1830.sun.sky.altitudeDeg).toBeLessThan(-6); // Twilight/night
    expect(snap1830.comet.sky.altitudeDeg).toBeGreaterThan(10); // Well above horizon (+14° to +25°)
    expect(snap1830.comet.sky.azimuthDeg).toBeGreaterThan(240); // Western sky
    expect(snap1830.comet.sky.azimuthDeg).toBeLessThan(290);

    // At 23:00 (late night): Comet has set and is far underground (-40°)
    const snap2300 = computeCelestialSnapshot(day55Base + 23.0, lat, lon, cfg, false);
    expect(snap2300.comet.sky.altitudeDeg).toBeLessThan(-25); // Deep underground!
  });

  it('executes computeCelestialSnapshot within real-time 60 FPS performance budget (<0.5ms)', () => {
    const t0 = performance.now();
    const ITERATIONS = 100;
    for (let i = 0; i < ITERATIONS; i++) {
      computeCelestialSnapshot(i * 2.4, 25, 10, DEFAULT_CELESTIAL_CONFIG, false);
    }
    const elapsed = performance.now() - t0;
    const avgMs = elapsed / ITERATIONS;
    expect(avgMs).toBeLessThan(0.5);
  });

  it('reuses cached daily rise/set data across 60 animation frames within the same day (<15ms total)', () => {
    const cfg = DEFAULT_CELESTIAL_CONFIG;
    const dayStart = 33 * cfg.hoursPerDay;
    // Warm up day cache on first frame
    const warmSnap = computeCelestialSnapshot(dayStart, 25, 10, cfg, true);
    expect(warmSnap.sun.riseSet.riseHour).not.toBeNull();

    const t0 = performance.now();
    for (let frame = 0; frame < 60; frame++) {
      const snap = computeCelestialSnapshot(dayStart + frame * 0.25, 25, 10, cfg, true);
      expect(snap.sun.riseSet.riseHour).toBe(warmSnap.sun.riseSet.riseHour);
      expect(snap.primaryMoon.riseSet.riseHour).toBe(warmSnap.primaryMoon.riseSet.riseHour);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(15);
  });

  it('completes scanUpcomingOmens in Year 1 within 50ms without stalling on Year 3 comet', () => {
    const t0 = performance.now();
    const omens = scanUpcomingOmens(33 * 24, 25, 10, DEFAULT_CELESTIAL_CONFIG, 130);
    const elapsed = performance.now() - t0;

    expect(omens.length).toBeGreaterThan(0);
    expect(omens.some((o) => o.type === 'comet-apparition')).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it('generates C-infinity Gaussian mist textures with smooth border falloff and constant spine overlap', () => {
    expect(typeof getQWorldSkyMistTextures).toBe('function');

    // Transverse Gaussian profile along v at u = 0 must strictly decay from spine center to 0 at border
    const [, , , a0] = computeGalaxySpinePixel(0, 0);
    const [, , , a25] = computeGalaxySpinePixel(0, 0.25);
    const [, , , a50] = computeGalaxySpinePixel(0, 0.5);
    const [, , , a75] = computeGalaxySpinePixel(0, 0.75);
    const [, , , aBorder] = computeGalaxySpinePixel(0, 1.0);
    const [, , , aUBorder] = computeGalaxySpinePixel(1.0, 0);

    expect(a0).toBeGreaterThan(0.95);
    expect(a0).toBeGreaterThan(a25);
    expect(a25).toBeGreaterThan(a50);
    expect(a50).toBeGreaterThan(a75);
    expect(a75).toBeGreaterThan(0);
    expect(aBorder).toBe(0);
    expect(aUBorder).toBe(0);

    // Overlapping stamps spaced at du = 1/3 (6 segments across [-1, 1]) produce uniform spine density (<2% ripple)
    const sampleSums: number[] = [];
    for (let s = 0; s <= 12; s++) {
      const x = -0.5 + s / 12;
      let sum = 0;
      for (let k = -4; k <= 4; k++) {
        const u = x - k / 3;
        if (Math.abs(u) < 1) {
          sum += computeGalaxySpinePixel(u, 0)[3];
        }
      }
      sampleSums.push(sum);
    }
    const minSum = Math.min(...sampleSums);
    const maxSum = Math.max(...sampleSums);
    expect((maxSum - minSum) / maxSum).toBeLessThan(0.02);

    // Nebula mist tapers smoothly from core (0,0) to zero at unit circle border
    const [, , , nebCenter] = computeNebulaMistPixel(0, 0);
    const [, , , nebMid] = computeNebulaMistPixel(0.45, 0);
    const [, , , nebOuter] = computeNebulaMistPixel(0.75, 0);
    const [, , , nebEdge] = computeNebulaMistPixel(1.0, 0);
    expect(nebCenter).toBeGreaterThan(nebMid);
    expect(nebMid).toBeGreaterThan(nebOuter);
    expect(nebOuter).toBeGreaterThan(0);
    expect(nebEdge).toBe(0);
  });
});
