import { WORLD_SPAN_X, WORLD_SPAN_Z } from './QWorldChunkTree';
import { skyPerfMonitor } from './QWorldPerfMonitor';

export interface PrimaryMoonConfig {
  name: string;
  synodicPeriodDays: number;
  inclinationDeg: number;
  ascendingNodeDeg: number;
  initialPhaseOffsetDeg: number; // 0 = New at epoch, 180 = Full at epoch
  albedo: number;
  angularRadiusDeg: number;
  color: string;
}

export interface TrojanClusterConfig {
  name: string;
  enabled: boolean;
  lagrangePoint: 'L4' | 'L5'; // L4 (+60 deg in orbit) follows moon in sky; L5 (-60 deg) leads in sky
  lagCenterDeg: number; // ~55-60 deg Trojan pocket offset from primary moon
  arcSpreadDeg: number; // angular width of the shard arc
  inclinationScatterDeg: number;
  shardCount: number;
  albedo: number;
}

export interface BlackMoonConfig {
  name: string;
  enabled: boolean;
  siderealPeriodDays: number;
  retrograde: boolean;
  inclinationDeg: number;
  ascendingNodeDeg: number;
  initialLongitudeDeg: number;
  albedo: number; // ~0.02 - 0.05 charcoal carbonaceous rock
  angularRadiusDeg: number;
  ashGlowColor: string;
}

export interface CometConfig {
  name: string;
  orbitalPeriodYears: number; // 12-year period (Year 3, Year 15...)
  perihelionYear: number; // 3
  perihelionDay: number; // 55 (winter apparition)
  activeWindowDays: number; // 50 (visible +/- 50 days around perihelion)
  inclinationDeg: number; // 32
  ascendingNodeDeg: number; // 75
  perihelionDistanceAU: number; // 0.52
  color: string; // Pale red '#f87171'
  tailColor: string; // 'rgba(239, 68, 68, 0.42)'
  tailLengthDeg: number; // 24
  tailWidthMultiplier: number; // 4 (4 times the width arc of the moon)
}

export interface CelestialWorldConfig {
  worldName: string;
  sunName: string;
  hoursPerDay: number;
  daysPerYear: number;
  axialTiltDeg: number;
  primaryMoon: PrimaryMoonConfig;
  trojanCluster: TrojanClusterConfig;
  blackMoon: BlackMoonConfig;
  comet: CometConfig;
}

export interface SkyVectorHorizontal {
  east: number;
  north: number;
  up: number;
  altitudeDeg: number;
  azimuthDeg: number; // 0 = N, 90 = E, 180 = S, 270 = W
  aboveHorizon: boolean;
}

export interface RiseSetInfo {
  riseHour: number | null;
  setHour: number | null;
  state: 'normal' | 'circumpolar' | 'never-rises';
}

export interface MoonSkyState {
  name: string;
  sky: SkyVectorHorizontal;
  eclipticLonDeg: number;
  eclipticLatDeg: number;
  orbitalAngleRad: number;
  phaseFraction: number; // 0 = New, 1 = Full
  elongationDeg: number; // 0..180 separation from Sun
  waxing: boolean;
  phaseName: string;
  brightLimbAngleRad: number; // Screen-space angle of sunlit limb (0 = right, PI/2 = up)
  surfaceVisibility: number; // 0..1 perceived surface brightness
  angularRadiusDeg: number;
  isAshFull: boolean; // True when Black Moon enters opposition surge
  riseSet: RiseSetInfo;
}

export interface CometSkyState {
  name: string;
  active: boolean; // True during apparition years (Year 3, Year 15...) within the active perihelion window
  sky: SkyVectorHorizontal;
  distanceAU: number;
  activityFraction: number; // 0..1 (peaks at perihelion)
  tailLengthDeg: number;
  tailWidthDeg: number; // 8 times the width arc of the moon (~4.48°)
  eclipticLonDeg: number;
  eclipticLatDeg: number;
  riseSet: RiseSetInfo;
}

export interface ShardParticleState {
  id: number;
  sky: SkyVectorHorizontal;
  phaseFraction: number;
  relativeSize: number; // 0.3 .. 1.0
  brightness: number; // 0 .. 1
}

export interface CelestialOmen {
  type:
    | 'black-solar-eclipse'
    | 'silver-solar-eclipse'
    | 'ash-full'
    | 'shadow-conjunction'
    | 'weeping-meteors'
    | 'pitch-night'
    | 'silver-full'
    | 'comet-apparition';
  title: string;
  severity: 'omen' | 'celestial' | 'info';
  description: string;
}

export interface OmenLoreEntry {
  type: CelestialOmen['type'];
  name: string;
  severity: CelestialOmen['severity'];
  gmNotes: string;
  gmMechanics: string;
  playerDescription: string;
}

/**
 * Returns both Game-Master astronomical/mechanical notes and in-world player readout for an omen type.
 */
export function getOmenLore(type: CelestialOmen['type'], config: CelestialWorldConfig): OmenLoreEntry {
  const sun = config.sunName;
  const pm = config.primaryMoon.name;
  const bm = config.blackMoon.name;
  const tc = config.trojanCluster.name;

  switch (type) {
    case 'pitch-night':
      return {
        type,
        name: 'Night of the Watching Void',
        severity: 'omen',
        gmNotes: `Triggered during deep night (${sun} > 8° below horizon) when ${pm} and the ${tc} cast almost no light (nightIllumination < 0.02) while ${bm} hangs above the horizon.`,
        gmMechanics: `Pitch Dark ground lighting. ${bm}'s charcoal surface (albedo ${config.blackMoon.albedo}) reflects virtually no sunlight while physically occluding a disc of stars behind it.`,
        playerDescription: `No silver moonlight touches the land tonight. Overhead, a starless black disc drifts silently across the constellations — an unseen watcher blotting out the heavens one star at a time.`,
      };
    case 'weeping-meteors':
      return {
        type,
        name: 'Weeping Sky Meteor Shower',
        severity: 'celestial',
        gmNotes: `Triggered at night (${sun} < -4°) when ${tc} is visible (> 15%) and ${bm} aligns within ±14° of orbital conjunction or 180° opposition with the Trojan pocket.`,
        gmMechanics: `Gravitational perturbation from ${bm} shakes loose dust and rocky shards from the ${tc} Lagrange cluster, producing animated meteor streaks near the shard arc.`,
        playerDescription: `Pale silver-blue streaks tear away from the ${tc} and rain silently across the night sky, as if the heavens themselves were weeping shards of starlight.`,
      };
    case 'ash-full':
      return {
        type,
        name: 'Ash-Full Black Moon',
        severity: 'omen',
        gmNotes: `Triggered at night (${sun} < -4°) when ${bm} is above the horizon and within 8.5° of exact opposition (180° opposite ${sun}).`,
        gmMechanics: `Carbonaceous opposition surge causes ${bm}'s rough, ultra-dark surface to flare dramatically into a visible ember-ash glow without casting bright moonlight.`,
        playerDescription: `For once, the Dark Moon refuses to stay hidden. Directly opposite the sunken sun, ${bm} kindles into a dim, smoldering ember-ash disc — like a dying coal suspended among the stars.`,
      };
    case 'silver-full':
      return {
        type,
        name: `High Full ${pm}`,
        severity: 'info',
        gmNotes: `Triggered at night (${sun} < -4°) when ${pm} is above the horizon and > 97.5% illuminated.`,
        gmMechanics: `Bright Moonlight ground lighting from sunset to sunrise, granting clear silhouettes at distance.`,
        playerDescription: `${pm} rides high and full, flooding roads, rooftops, and open fields in crisp silver light from dusk until dawn.`,
      };
    case 'shadow-conjunction':
      return {
        type,
        name: 'Shadowed Crown Conjunction',
        severity: 'omen',
        gmNotes: `Triggered when ${pm} and ${bm} converge within 3.2° in the sky while at least one moon is above the horizon.`,
        gmMechanics: `Because ${bm} orbits retrograde while ${pm} orbits prograde, their paths periodically cross, bringing the dark silhouette side-by-side with (or across) the bright moon.`,
        playerDescription: `The Silver Moon and the Black Moon draw together in the vault of heaven, forming a twin crown of light and shadow.`,
      };
    case 'black-solar-eclipse':
      return {
        type,
        name: 'Black Omen Eclipse',
        severity: 'omen',
        gmNotes: `Triggered during daytime (${sun} above horizon) when ${bm} passes in front of ${sun} (> 2% disc overlap).`,
        gmMechanics: `Because ${bm}'s apparent radius (${config.blackMoon.angularRadiusDeg}°) is smaller than ${sun}'s (0.265°), it produces a partial or annular ("ring of fire") eclipse up to ~${Math.round(Math.min(1, Math.pow(config.blackMoon.angularRadiusDeg / 0.265, 2)) * 100)}% coverage.`,
        playerDescription: `An unseen shadow bites into ${sun} at midday — ${bm} carves a pitch-black silhouette across the burning solar disc, leaving a cold, unnatural ring of fire in the sky.`,
      };
    case 'silver-solar-eclipse':
      return {
        type,
        name: 'Solar Eclipse',
        severity: 'celestial',
        gmNotes: `Triggered during daytime (${sun} above horizon) when ${pm} passes in front of ${sun} (> 2% disc overlap).`,
        gmMechanics: `Because ${pm}'s apparent radius (${config.primaryMoon.angularRadiusDeg}°) exceeds ${sun}'s (0.265°), it can produce a partial or total solar eclipse, dimming daytime light into eerie twilight above 75% coverage.`,
        playerDescription: `${pm} glides across the face of ${sun}, swallowing daylight into sudden, hushed twilight as the noon sky turns the color of dusk.`,
      };
    case 'comet-apparition':
      return {
        type,
        name: 'The Bleeding Star (The Red Harbinger)',
        severity: 'omen',
        gmNotes: `Triggered when the 12-year periodic comet is active (visible in Year 3, Year 15, etc.) and above the horizon at night (${sun} < -2°).`,
        gmMechanics: `Terrifying omen. While the Red Harbinger is visible in the sky with its sweeping pale red tail (8× moon width arc), divination portents are dark and NPC superstition/morale checks suffer a -2 penalty.`,
        playerDescription: `A pale red star bleeding a sweeping crimson tail hangs like an executioner’s blade across the heavens — an ancient omen of upheaval, war, and fallen kings.`,
      };
  }
}

export interface UpcomingOmenEvent {
  type: CelestialOmen['type'];
  title: string;
  severity: CelestialOmen['severity'];
  worldHours: number;
  dayNumber: number;
  yearNumber: number;
  localHour: number;
}

export interface EclipseProjection {
  type: 'black-solar-eclipse' | 'silver-solar-eclipse';
  title: string;
  eclipsedBy: 'primary' | 'black';
  maxCoverageFraction: number;
  worldHours: number;
  startWorldHours: number;
  endWorldHours: number;
  dayNumber: number;
  yearNumber: number;
  localHour: number;
}

export type TabletopLightLevel =
  | 'Daylight'
  | 'Civil Twilight'
  | 'Bright Moonlight'
  | 'Dim Moonlight'
  | 'Faint Shardlight'
  | 'Starlight'
  | 'Pitch Dark';

export interface CelestialSnapshot {
  worldHours: number;
  year: number;
  dayOfYear: number; // 1..daysPerYear
  monthName: string;
  dayOfMonth: number;
  seasonName: string;
  localHour: number; // 0..hoursPerDay
  latitudeDeg: number;
  longitudeDeg: number;
  localSiderealRad: number;
  sun: {
    name: string;
    sky: SkyVectorHorizontal;
    eclipticLonDeg: number;
    angularRadiusDeg: number;
    riseSet: RiseSetInfo;
    eclipseFraction: number;
    eclipsedBy: 'primary' | 'black' | null;
  };
  primaryMoon: MoonSkyState;
  trojanCluster: {
    name: string;
    coreSky: SkyVectorHorizontal;
    phaseFraction: number;
    riseSet: RiseSetInfo;
    visibleFraction: number;
    meteorActivity: number; // 0..1 intensity of "weeping sky" meteor perturbation
    shards: ShardParticleState[];
  };
  blackMoon: MoonSkyState;
  comet: CometSkyState;
  lighting: {
    level: TabletopLightLevel;
    nightIllumination: number; // 0..1
    summary: string;
  };
  activeOmens: CelestialOmen[];
}

export const DEFAULT_CELESTIAL_CONFIG: CelestialWorldConfig = {
  worldName: 'Vaelora',
  sunName: 'Solis',
  hoursPerDay: 24,
  daysPerYear: 395, // 13 months * 30 days + 5 intercalary festival gap days
  axialTiltDeg: 23.4,
  primaryMoon: {
    name: 'Vaelis',
    synodicPeriodDays: 30.4375,
    inclinationDeg: 5.1,
    ascendingNodeDeg: 18,
    initialPhaseOffsetDeg: 140,
    albedo: 0.28,
    angularRadiusDeg: 0.28,
    color: '#e2e8f0',
  },
  trojanCluster: {
    name: 'Tears of Vaelis',
    enabled: true,
    lagrangePoint: 'L4',
    lagCenterDeg: 56,
    arcSpreadDeg: 30,
    inclinationScatterDeg: 2.1,
    shardCount: 44,
    albedo: 0.32,
  },
  blackMoon: {
    name: 'Morvath (The Black Moon)',
    enabled: true,
    siderealPeriodDays: 113,
    retrograde: true,
    inclinationDeg: 6.4,
    ascendingNodeDeg: 112,
    initialLongitudeDeg: 235,
    albedo: 0.03,
    angularRadiusDeg: 0.22,
    ashGlowColor: '#9f5848',
  },
  comet: {
    name: 'The Red Harbinger',
    orbitalPeriodYears: 12,
    perihelionYear: 3,
    perihelionDay: 55,
    activeWindowDays: 50,
    inclinationDeg: 32,
    ascendingNodeDeg: 75,
    perihelionDistanceAU: 0.52,
    color: '#f87171',
    tailColor: 'rgba(239, 68, 68, 0.42)',
    tailLengthDeg: 36,
    tailWidthMultiplier: 8, // 8 times the width arc of the primary moon (~4.48°)
  },
};

const MONTH_NAMES = [
  'Deepfrost',
  'Rimewake',
  'Stormthaw',
  'Greenrise',
  'Blossomtide',
  'Sunreach',
  'Highflame',
  'Goldreap',
  'Leafward',
  'Duskfall',
  'Frostveil',
  'Longnight',
  'Shadowsend',
] as const;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;
const VERNAL_EQUINOX_FRACTION = 80 / 365;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapRad(rad: number): number {
  const r = rad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

function wrapSignedRad(rad: number): number {
  let r = (rad + Math.PI) % TWO_PI;
  if (r < 0) r += TWO_PI;
  return r - Math.PI;
}

/**
 * Converts Adventure2 map coordinates (worldX, worldZ) to planetary Latitude & Longitude in degrees.
 * worldZ = 0 -> +90°N, worldZ = WORLD_SPAN_Z/2 -> 0° Equator, worldZ = WORLD_SPAN_Z -> -90°S
 * worldX = 0 -> -180°W, worldX = WORLD_SPAN_X/2 -> 0° Prime Meridian, worldX = WORLD_SPAN_X -> +180°E
 */
export function worldCoordsToLatLon(worldX: number, worldZ: number): { latitudeDeg: number; longitudeDeg: number } {
  const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
  const clampedZ = clamp(worldZ, 0, WORLD_SPAN_Z);
  const latitudeDeg = 90 - (clampedZ / WORLD_SPAN_Z) * 180;
  const longitudeDeg = (wrappedX / WORLD_SPAN_X) * 360 - 180;
  return {
    latitudeDeg: Math.round(latitudeDeg * 10) / 10,
    longitudeDeg: Math.round(longitudeDeg * 10) / 10,
  };
}

export type NorthernSeasonKey = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * Computes the solar declination (subsolar latitude in degrees, -axialTilt..+axialTilt)
 * from the orbital period (Vernal Equinox at Day 80).
 */
export function computeSolarDeclinationDeg(
  worldHours: number,
  config: CelestialWorldConfig = DEFAULT_CELESTIAL_CONFIG
): number {
  const hoursPerDay = Math.max(1, config.hoursPerDay);
  const daysPerYear = Math.max(1, config.daysPerYear);
  const totalDays = worldHours / hoursPerDay;
  const eqOffset = daysPerYear * VERNAL_EQUINOX_FRACTION;
  const sunLonRad = wrapRad(((totalDays - eqOffset) / daysPerYear) * TWO_PI);
  const tiltRad = config.axialTiltDeg * DEG_TO_RAD;
  return Math.asin(Math.sin(tiltRad) * Math.sin(sunLonRad)) * RAD_TO_DEG;
}

/**
 * Computes the subsolar geographic coordinates (latitudeDeg, longitudeDeg) at `worldHours`.
 * At localHour = 12:00 (noon), the Sun is over Prime Meridian (0°); as time advances, it moves westward.
 */
export function computeSubsolarLatLon(
  worldHours: number,
  config: CelestialWorldConfig = DEFAULT_CELESTIAL_CONFIG
): { latitudeDeg: number; longitudeDeg: number } {
  const hoursPerDay = Math.max(1, config.hoursPerDay);
  const localHour = ((worldHours % hoursPerDay) + hoursPerDay) % hoursPerDay;
  const rawLon = (0.5 - localHour / hoursPerDay) * 360;
  const longitudeDeg = ((((rawLon + 180) % 360) + 360) % 360) - 180;
  return {
    latitudeDeg: computeSolarDeclinationDeg(worldHours, config),
    longitudeDeg,
  };
}

/**
 * Returns `worldHours` jumped to the requested Northern Hemisphere season
 * (Equinoxes / Solstices) while preserving the current year and time of day.
 */
export function getNorthernSeasonWorldHours(
  season: NorthernSeasonKey,
  currentWorldHours: number,
  config: CelestialWorldConfig = DEFAULT_CELESTIAL_CONFIG
): number {
  const hoursPerDay = Math.max(1, config.hoursPerDay);
  const daysPerYear = Math.max(1, config.daysPerYear);
  const totalDays = currentWorldHours / hoursPerDay;
  const yearZeroIdx = Math.max(0, Math.floor(Math.floor(totalDays) / daysPerYear));
  const localHour = ((currentWorldHours % hoursPerDay) + hoursPerDay) % hoursPerDay;

  const equinoxDay = Math.round(daysPerYear * VERNAL_EQUINOX_FRACTION);
  const targetDayOffset =
    season === 'spring'
      ? equinoxDay
      : season === 'summer'
        ? Math.round(equinoxDay + daysPerYear * 0.25)
        : season === 'autumn'
          ? Math.round(equinoxDay + daysPerYear * 0.5)
          : Math.round(equinoxDay + daysPerYear * 0.75);

  const dayZeroIdx = yearZeroIdx * daysPerYear + (targetDayOffset - 1);
  return dayZeroIdx * hoursPerDay + localHour;
}

/**
 * Maps `worldHours` to the active Northern Hemisphere season key matching `formatCalendarDate`.
 */
export function getNorthernSeasonFromWorldHours(
  worldHours: number,
  config: CelestialWorldConfig = DEFAULT_CELESTIAL_CONFIG
): NorthernSeasonKey {
  const hoursPerDay = Math.max(1, config.hoursPerDay);
  const daysPerYear = Math.max(1, config.daysPerYear);
  const dayFloor = Math.floor(worldHours / hoursPerDay);
  const yearZeroIdx = Math.floor(dayFloor / daysPerYear);
  const dayOfYear = dayFloor - yearZeroIdx * daysPerYear + 1;
  const yearFrac = (clamp(dayOfYear, 1, daysPerYear) - 1) / daysPerYear;
  if (yearFrac >= 0.21 && yearFrac < 0.46) return 'spring';
  if (yearFrac >= 0.46 && yearFrac < 0.71) return 'summer';
  if (yearFrac >= 0.71 && yearFrac < 0.96) return 'autumn';
  return 'winter';
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Reusable scratch vectors to eliminate per-shard / per-step Vec3 GC allocations without aliasing
const _pmEcl: Vec3 = { x: 0, y: 0, z: 0 };
const _tcCoreEcl: Vec3 = { x: 0, y: 0, z: 0 };
const _shardEcl: Vec3 = { x: 0, y: 0, z: 0 };
const _bmEcl: Vec3 = { x: 0, y: 0, z: 0 };
const _sunEq: Vec3 = { x: 0, y: 0, z: 0 };
const _pmEq: Vec3 = { x: 0, y: 0, z: 0 };
const _tcCoreEq: Vec3 = { x: 0, y: 0, z: 0 };
const _shardEq: Vec3 = { x: 0, y: 0, z: 0 };
const _bmEq: Vec3 = { x: 0, y: 0, z: 0 };
const _cometEq: Vec3 = { x: 0, y: 0, z: 0 };
const _riseSetEcl: Vec3 = { x: 0, y: 0, z: 0 };
const _riseSetEq: Vec3 = { x: 0, y: 0, z: 0 };

function orbitalToEclipticVecInto(argOfLatRad: number, incRad: number, nodeRad: number, out: Vec3): Vec3 {
  const cu = Math.cos(argOfLatRad);
  const su = Math.sin(argOfLatRad);
  const ci = Math.cos(incRad);
  const si = Math.sin(incRad);
  const cO = Math.cos(nodeRad);
  const sO = Math.sin(nodeRad);

  out.x = cO * cu - sO * su * ci;
  out.y = sO * cu + cO * su * ci;
  out.z = su * si;
  skyPerfMonitor.recordPoolReuse(1);
  return out;
}

/**
 * Computes ecliptic unit vector for a body offset perpendicularly by `latOffsetRad` from an inclined orbit.
 * Prevents 3D shard scatter from collapsing to zero thickness at the ascending/descending orbital nodes.
 */
function orbitalWithLatOffsetToEclipticVecInto(
  argOfLatRad: number,
  latOffsetRad: number,
  incRad: number,
  nodeRad: number,
  out: Vec3
): Vec3 {
  const cu = Math.cos(argOfLatRad);
  const su = Math.sin(argOfLatRad);
  const ci = Math.cos(incRad);
  const si = Math.sin(incRad);
  const cO = Math.cos(nodeRad);
  const sO = Math.sin(nodeRad);
  const cb = Math.cos(latOffsetRad);
  const sb = Math.sin(latOffsetRad);

  const rx = cO * cu - sO * su * ci;
  const ry = sO * cu + cO * su * ci;
  const rz = su * si;

  const nx = sO * si;
  const ny = -cO * si;
  const nz = ci;

  out.x = cb * rx + sb * nx;
  out.y = cb * ry + sb * ny;
  out.z = cb * rz + sb * nz;
  skyPerfMonitor.recordPoolReuse(1);
  return out;
}

function eclipticToEquatorialVecInto(ecl: Vec3, tiltRad: number, out: Vec3): Vec3 {
  const ce = Math.cos(tiltRad);
  const se = Math.sin(tiltRad);
  out.x = ecl.x;
  out.y = ecl.y * ce - ecl.z * se;
  out.z = ecl.y * se + ecl.z * ce;
  skyPerfMonitor.recordPoolReuse(1);
  return out;
}

function equatorialToHorizontal(eq: Vec3, lstRad: number, latRad: number): SkyVectorHorizontal {
  const sinLst = Math.sin(lstRad);
  const cosLst = Math.cos(lstRad);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);

  const meridian = eq.x * cosLst + eq.y * sinLst;
  const east = -eq.x * sinLst + eq.y * cosLst;
  const north = -meridian * sinLat + eq.z * cosLat;
  const up = meridian * cosLat + eq.z * sinLat;

  const altitudeDeg = Math.asin(clamp(up, -1, 1)) * RAD_TO_DEG;
  let azimuthDeg = Math.atan2(east, north) * RAD_TO_DEG;
  if (azimuthDeg < 0) azimuthDeg += 360;

  return {
    east,
    north,
    up,
    altitudeDeg,
    azimuthDeg,
    aboveHorizon: altitudeDeg > -0.25,
  };
}

/**
 * Maps a catalog star magnitude (`0.04` brightest .. `0.74` faintest) onto pinpoint luminance.
 * Keeps only 1st-magnitude stars near full intensity while mid and catalog stars drop smoothly to dim/faint.
 */
export function computeStarPinpointLuminance(mag: number): number {
  const t = clamp((0.76 - mag) / 0.72, 0, 1);
  return 0.06 + 0.89 * Math.pow(t, 2.8);
}

/**
 * Computes continuous comet sky visibility across daytime, dawn/sunset twilight, and full night.
 * Faintly visible even in daylight, brightening smoothly through sunset and dimming smoothly after sunrise.
 */
export function computeCometSkyVisibility(
  sunAltDeg: number,
  eclipseFraction = 0,
  overheadVeil = 0,
  showGlareWashout = true
): number {
  const effectiveSunAlt = sunAltDeg - clamp(eclipseFraction, 0, 1) * 18;
  let baseVis: number;
  if (effectiveSunAlt <= -12) {
    baseVis = 1.0;
  } else if (effectiveSunAlt <= 6) {
    const t = (effectiveSunAlt + 12) / 18;
    const s = t * t * (3 - 2 * t);
    baseVis = 1.0 - s * 0.78;
  } else {
    const d = clamp((effectiveSunAlt - 6) / 44, 0, 1);
    baseVis = 0.22 - d * 0.08;
  }
  const washoutAdjusted = showGlareWashout ? baseVis : Math.max(0.55, baseVis);
  return clamp(washoutAdjusted * (1 - clamp(overheadVeil, 0, 1) * 0.75), 0, 1);
}

/**
 * Computes deterministic atmospheric star scintillation (twinkling) factors.
 * Stronger near the horizon where airmass is higher, and active only when `twinkleStrength > 0`.
 * Stars remain strict 1x1 pixel pinpoints (`radiusMul: 1`), modulating only brightness when twinkling.
 */
export function computeStarTwinkleFactor(
  raRad: number,
  decRad: number,
  altitudeDeg: number,
  timeSec: number,
  twinkleStrength: number
): { alphaMul: number; radiusMul: number } {
  if (twinkleStrength <= 0.001) return { alphaMul: 1, radiusMul: 1 };
  const seedA = raRad * 73.13 + decRad * 31.7;
  const seedB = raRad * 19.41 - decRad * 53.9;
  const sinAlt = Math.max(0.08, Math.sin(clamp(altitudeDeg, 2, 90) * DEG_TO_RAD));
  const airmass = clamp(0.2 + 0.8 * Math.pow(0.14 / sinAlt, 0.55), 0.25, 1.0);
  const freq1 = 2.6 + Math.abs(Math.sin(seedA)) * 2.4;
  const freq2 = 4.3 + Math.abs(Math.cos(seedB)) * 3.1;
  const wave = 0.62 * Math.sin(timeSec * freq1 + seedA * 10) + 0.38 * Math.sin(timeSec * freq2 + seedB * 17);
  const amp = 0.36 * clamp(twinkleStrength, 0, 1) * airmass;
  return {
    alphaMul: clamp(1 - amp * 0.25 + amp * wave, 0.38, 1.25),
    radiusMul: 1,
  };
}

/**
 * Converts a star's fixed Equatorial (RA, Dec) into current observer Horizontal coordinates.
 */
export function starRaDecToHorizontal(
  raRad: number,
  decRad: number,
  lstRad: number,
  latitudeDeg: number
): SkyVectorHorizontal {
  const cd = Math.cos(decRad);
  const eq: Vec3 = {
    x: cd * Math.cos(raRad),
    y: cd * Math.sin(raRad),
    z: Math.sin(decRad),
  };
  return equatorialToHorizontal(eq, lstRad, latitudeDeg * DEG_TO_RAD);
}

function computeBrightLimbAngle(moonSky: SkyVectorHorizontal, sunSky: SkyVectorHorizontal): number {
  // Local tangent basis at moon's sky position: screenRight = +Azimuth, screenUp = +Altitude
  const azRad = moonSky.azimuthDeg * DEG_TO_RAD;
  const altRad = moonSky.altitudeDeg * DEG_TO_RAD;

  // Unit vector pointing right along constant altitude (increasing azimuth)
  const rightE = Math.cos(azRad);
  const rightN = -Math.sin(azRad);
  const rightU = 0;

  // Unit vector pointing up along increasing altitude
  const upE = -Math.sin(altRad) * Math.sin(azRad);
  const upN = -Math.sin(altRad) * Math.cos(azRad);
  const upU = Math.cos(altRad);

  const dx = sunSky.east * rightE + sunSky.north * rightN + sunSky.up * rightU;
  const dy = sunSky.east * upE + sunSky.north * upN + sunSky.up * upU;

  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 0;
  return Math.atan2(dy, dx);
}

function describeMoonPhase(phaseFraction: number, waxing: boolean, isBlackMoon: boolean, isAshFull: boolean): string {
  if (isBlackMoon && isAshFull) {
    return 'Ash-Full (Opposition Surge)';
  }
  if (phaseFraction < 0.03) return isBlackMoon ? 'Dark Void (New)' : 'New Moon';
  if (phaseFraction > 0.97) return 'Full Moon';
  if (phaseFraction < 0.44) return waxing ? 'Waxing Crescent' : 'Waning Crescent';
  if (phaseFraction <= 0.56) return waxing ? 'First Quarter' : 'Third Quarter';
  return waxing ? 'Waxing Gibbous' : 'Waning Gibbous';
}

interface ShardTemplate {
  id: number;
  lagOffsetDeg: number;
  latScatterDeg: number;
  relativeSize: number;
  reflectivity: number;
}

function getDeterministicShards(count: number, arcSpreadDeg: number, incScatterDeg: number): ShardTemplate[] {
  const list: ShardTemplate[] = [];
  for (let i = 0; i < count; i++) {
    // 4D low-discrepancy quasi-random sequence so longitudinal and perpendicular scatter stay decorrelated
    const u1 = ((i * 0.61803398875 + 0.17) % 1 + 1) % 1;
    const u2 = ((i * 0.75487766625 + 0.43) % 1 + 1) % 1;
    const u3 = ((i * 0.56984029099 + 0.81) % 1 + 1) % 1;
    const u4 = ((i * 0.8191725133961644 + 0.37) % 1 + 1) % 1;

    // Tadpole asymmetry: denser core toward L4/L5 head, longer wispy tail trailing behind
    const signed = u1 < 0.55 ? -(u1 / 0.55) * 0.42 : ((u1 - 0.55) / 0.45) * 0.58;
    const radialWeight = Math.pow(u2, 0.7);
    const lagOffsetDeg = signed * arcSpreadDeg * (0.35 + 0.65 * radialWeight);
    const latScatterDeg = (u4 * 2 - 1) * incScatterDeg * (1 - Math.abs(signed) * 0.45);
    const relativeSize = i < 5 ? 0.8 + 0.2 * u3 : 0.28 + 0.52 * Math.pow(u3, 1.6);
    const reflectivity = 0.55 + 0.45 * (1 - Math.abs(signed));

    list.push({
      id: i,
      lagOffsetDeg,
      latScatterDeg,
      relativeSize,
      reflectivity,
    });
  }
  return list;
}

function formatCalendarDate(dayOfYear: number, daysPerYear: number): {
  monthName: string;
  dayOfMonth: number;
  seasonName: string;
} {
  const clampedDay = clamp(dayOfYear, 1, daysPerYear);
  const totalRegularDays = 13 * 30; // 390 days in 13 months of 30 days
  const isIntercalary = clampedDay > totalRegularDays;

  let monthName: string;
  let dayOfMonth: number;
  let seasonName = 'Winter';

  if (!isIntercalary) {
    const monthIdx = Math.min(12, Math.floor((clampedDay - 1) / 30));
    monthName = MONTH_NAMES[monthIdx];
    dayOfMonth = ((clampedDay - 1) % 30) + 1;

    const yearFrac = (clampedDay - 1) / daysPerYear;
    if (yearFrac >= 0.20 && yearFrac < 0.45) seasonName = 'Spring';
    else if (yearFrac >= 0.45 && yearFrac < 0.70) seasonName = 'Summer';
    else if (yearFrac >= 0.70 && yearFrac < 0.95) seasonName = 'Autumn';
  } else {
    monthName = 'The Reckoning Veil';
    dayOfMonth = clampedDay - totalRegularDays;
    seasonName = 'Year-End Festival';
  }

  return {
    monthName,
    dayOfMonth,
    seasonName,
  };
}

export function computeCometEcliptic(utDays: number, config: CelestialWorldConfig): Vec3 {
  const daysPerYear = config.daysPerYear;
  const cycleDays = config.comet.orbitalPeriodYears * daysPerYear;
  const peri0Days = (config.comet.perihelionYear - 1) * daysPerYear + (config.comet.perihelionDay - 1);
  const offsetFromPeri0 = utDays - peri0Days;
  const daysFromPeri = ((offsetFromPeri0 % cycleDays) + cycleDays + cycleDays / 2) % cycleDays - cycleDays / 2;

  // Keplerian orbit
  const aAU = Math.pow(config.comet.orbitalPeriodYears, 2 / 3); // ~5.24 AU
  const qAU = config.comet.perihelionDistanceAU; // 0.52 AU
  const ecc = clamp(1 - qAU / aAU, 0.1, 0.98); // ~0.90
  const meanAnomaly = (TWO_PI / cycleDays) * daysFromPeri;

  // Solve Kepler's equation E - e sin E = M via Newton-Raphson
  let E = meanAnomaly;
  for (let it = 0; it < 5; it++) {
    const f = E - ecc * Math.sin(E) - meanAnomaly;
    const fPrime = 1 - ecc * Math.cos(E);
    E -= f / Math.max(1e-6, fPrime);
  }

  // True anomaly nu and heliocentric distance rAU
  const nu = 2 * Math.atan2(Math.sqrt(1 + ecc) * Math.sin(E * 0.5), Math.sqrt(1 - ecc) * Math.cos(E * 0.5));
  const rAU = aAU * (1 - ecc * Math.cos(E));

  // Heliocentric orbital plane coordinates
  const omegaRad = 45 * DEG_TO_RAD; // argument of perihelion
  const thetaRad = nu + omegaRad;
  const xOrb = rAU * Math.cos(thetaRad);
  const yOrb = rAU * Math.sin(thetaRad);

  // Rotate by inclination and ascending node to heliocentric ecliptic
  const incRad = config.comet.inclinationDeg * DEG_TO_RAD;
  const nodeRad = config.comet.ascendingNodeDeg * DEG_TO_RAD;
  const cosNode = Math.cos(nodeRad);
  const sinNode = Math.sin(nodeRad);
  const cosInc = Math.cos(incRad);
  const sinInc = Math.sin(incRad);

  const xHelio = cosNode * xOrb - sinNode * yOrb * cosInc;
  const yHelio = sinNode * xOrb + cosNode * yOrb * cosInc;
  const zHelio = yOrb * sinInc;

  // Planet Vaelora heliocentric position: Sun is at sunLonRad, so planet is at -sunEcl
  const eqOffset = daysPerYear * VERNAL_EQUINOX_FRACTION;
  const sunLonRad = wrapRad(((utDays - eqOffset) / daysPerYear) * TWO_PI);
  const xGeo = xHelio + Math.cos(sunLonRad);
  const yGeo = yHelio + Math.sin(sunLonRad);
  const zGeo = zHelio;

  const distGeo = Math.hypot(xGeo, yGeo, zGeo);
  return {
    x: xGeo / Math.max(1e-5, distGeo),
    y: yGeo / Math.max(1e-5, distGeo),
    z: zGeo / Math.max(1e-5, distGeo),
  };
}

function computeBodyAltitudeAtHour(
  dayBaseHours: number,
  hourOfDay: number,
  config: CelestialWorldConfig,
  latitudeDeg: number,
  longitudeDeg: number,
  body: 'sun' | 'primary' | 'trojan' | 'black' | 'comet'
): number {
  const worldHours = dayBaseHours + hourOfDay;
  const totalDays = worldHours / config.hoursPerDay;
  const utDays = totalDays - longitudeDeg / 360;
  const eqOffset = config.daysPerYear * VERNAL_EQUINOX_FRACTION;
  const sunLonRad = wrapRad(((utDays - eqOffset) / config.daysPerYear) * TWO_PI);
  const lstRad = wrapRad(sunLonRad + ((hourOfDay - config.hoursPerDay * 0.5) / config.hoursPerDay) * TWO_PI);
  const tiltRad = config.axialTiltDeg * DEG_TO_RAD;
  const latRad = latitudeDeg * DEG_TO_RAD;

  let ecl: Vec3;
  if (body === 'sun') {
    ecl = { x: Math.cos(sunLonRad), y: Math.sin(sunLonRad), z: 0 };
  } else if (body === 'primary' || body === 'trojan') {
    const pm = config.primaryMoon;
    const nodeRad = pm.ascendingNodeDeg * DEG_TO_RAD;
    const incRad = pm.inclinationDeg * DEG_TO_RAD;
    const meanElong = pm.initialPhaseOffsetDeg * DEG_TO_RAD + (utDays / pm.synodicPeriodDays) * TWO_PI;
    const lagSign = config.trojanCluster.lagrangePoint === 'L4' ? 1 : -1;
    const lagOffsetRad = body === 'trojan' ? lagSign * config.trojanCluster.lagCenterDeg * DEG_TO_RAD : 0;
    const argLat = sunLonRad + meanElong + lagOffsetRad - nodeRad;
    ecl = orbitalToEclipticVecInto(argLat, incRad, nodeRad, _riseSetEcl);
  } else if (body === 'comet') {
    ecl = computeCometEcliptic(utDays, config);
  } else {
    const bm = config.blackMoon;
    const nodeRad = bm.ascendingNodeDeg * DEG_TO_RAD;
    const incRad = bm.inclinationDeg * DEG_TO_RAD;
    const dir = bm.retrograde ? -1 : 1;
    const lon = bm.initialLongitudeDeg * DEG_TO_RAD + dir * (utDays / bm.siderealPeriodDays) * TWO_PI;
    ecl = orbitalToEclipticVecInto(lon - nodeRad, incRad, nodeRad, _riseSetEcl);
  }

  const eq = eclipticToEquatorialVecInto(ecl, tiltRad, _riseSetEq);
  return equatorialToHorizontal(eq, lstRad, latRad).altitudeDeg;
}

const riseSetCache = new Map<string, RiseSetInfo>();

function solveRiseSetForDay(
  dayBaseHours: number,
  config: CelestialWorldConfig,
  latitudeDeg: number,
  longitudeDeg: number,
  body: 'sun' | 'primary' | 'trojan' | 'black' | 'comet'
): RiseSetInfo {
  const c = config.comet;
  const cacheKey = `${dayBaseHours}|${latitudeDeg.toFixed(3)}|${longitudeDeg.toFixed(3)}|${body}|${config.hoursPerDay}|${config.daysPerYear}|${config.axialTiltDeg}|${config.primaryMoon.synodicPeriodDays}|${config.primaryMoon.inclinationDeg}|${config.primaryMoon.ascendingNodeDeg}|${config.primaryMoon.initialPhaseOffsetDeg}|${config.trojanCluster.lagrangePoint}|${config.trojanCluster.lagCenterDeg}|${config.blackMoon.enabled ? 1 : 0}|${config.blackMoon.siderealPeriodDays}|${config.blackMoon.retrograde}|${config.blackMoon.inclinationDeg}|${config.blackMoon.ascendingNodeDeg}|${config.blackMoon.initialLongitudeDeg}|${c.orbitalPeriodYears}|${c.perihelionYear}|${c.perihelionDay}|${c.activeWindowDays}|${c.inclinationDeg}|${c.ascendingNodeDeg}`;
  const cached = riseSetCache.get(cacheKey);
  if (cached) {
    skyPerfMonitor.recordPoolReuse(1);
    return cached;
  }

  const steps = 48;
  const dt = config.hoursPerDay / steps;
  let riseHour: number | null = null;
  let setHour: number | null = null;
  let anyAbove = false;
  let anyBelow = false;

  let prevAlt = computeBodyAltitudeAtHour(dayBaseHours, 0, config, latitudeDeg, longitudeDeg, body);
  if (prevAlt >= -0.25) anyAbove = true;
  else anyBelow = true;

  for (let i = 1; i <= steps; i++) {
    const h = i * dt;
    const alt = computeBodyAltitudeAtHour(dayBaseHours, h, config, latitudeDeg, longitudeDeg, body);
    if (alt >= -0.25) anyAbove = true;
    else anyBelow = true;

    // Linear root refinement across horizon (-0.25 deg refraction/limb threshold)
    const threshold = -0.25;
    if (prevAlt < threshold && alt >= threshold && riseHour === null) {
      const frac = (threshold - prevAlt) / Math.max(1e-5, alt - prevAlt);
      riseHour = (i - 1 + frac) * dt;
    } else if (prevAlt >= threshold && alt < threshold && setHour === null) {
      const frac = (prevAlt - threshold) / Math.max(1e-5, prevAlt - alt);
      setHour = (i - 1 + frac) * dt;
    }
    prevAlt = alt;
  }

  const result: RiseSetInfo = !anyBelow
    ? { riseHour: null, setHour: null, state: 'circumpolar' }
    : !anyAbove
      ? { riseHour: null, setHour: null, state: 'never-rises' }
      : { riseHour, setHour, state: 'normal' };

  if (riseSetCache.size >= 64) {
    const firstKey = riseSetCache.keys().next().value;
    if (firstKey !== undefined) riseSetCache.delete(firstKey);
  }
  riseSetCache.set(cacheKey, result);
  return result;
}

function angularSeparationDeg(a: SkyVectorHorizontal, b: SkyVectorHorizontal): number {
  const dot = clamp(a.east * b.east + a.north * b.north + a.up * b.up, -1, 1);
  return Math.acos(dot) * RAD_TO_DEG;
}

function computeDiskOverlapFraction(sepDeg: number, targetRadiusDeg: number, occulterRadiusDeg: number): number {
  if (sepDeg >= targetRadiusDeg + occulterRadiusDeg) return 0;
  if (sepDeg <= Math.abs(targetRadiusDeg - occulterRadiusDeg)) {
    const minR = Math.min(targetRadiusDeg, occulterRadiusDeg);
    return clamp((minR * minR) / (targetRadiusDeg * targetRadiusDeg), 0, 1);
  }
  const r1 = targetRadiusDeg;
  const r2 = occulterRadiusDeg;
  const d = sepDeg;
  const part1 = r1 * r1 * Math.acos(clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1, 1));
  const part2 = r2 * r2 * Math.acos(clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1, 1));
  const part3 = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  const area = part1 + part2 - part3;
  return clamp(area / (Math.PI * r1 * r1), 0, 1);
}

/**
 * Computes the complete closed-form celestial sky state for a given timestamp and observer location.
 */
export function computeCelestialSnapshot(
  worldHours: number,
  latitudeDeg: number,
  longitudeDeg: number,
  config: CelestialWorldConfig = DEFAULT_CELESTIAL_CONFIG,
  includeRiseSet = true,
  includeShards = includeRiseSet
): CelestialSnapshot {
  const clampedLat = clamp(latitudeDeg, -89.9, 89.9);
  const clampedLon = clamp(longitudeDeg, -180, 180);
  const hoursPerDay = Math.max(1, config.hoursPerDay);
  const daysPerYear = Math.max(1, config.daysPerYear);

  const totalDays = worldHours / hoursPerDay;
  const dayFloor = Math.floor(totalDays);
  const localHour = ((worldHours % hoursPerDay) + hoursPerDay) % hoursPerDay;
  const dayBaseHours = dayFloor * hoursPerDay;

  const yearZeroIdx = Math.floor(dayFloor / daysPerYear);
  const year = yearZeroIdx + 1;
  const dayOfYear = dayFloor - yearZeroIdx * daysPerYear + 1;
  const { monthName, dayOfMonth, seasonName } = formatCalendarDate(dayOfYear, daysPerYear);

  const utDays = totalDays - clampedLon / 360;
  const tiltRad = config.axialTiltDeg * DEG_TO_RAD;
  const latRad = clampedLat * DEG_TO_RAD;

  // 1. Sun position (Vernal Equinox at VERNAL_EQUINOX_FRACTION * daysPerYear)
  const eqOffset = daysPerYear * VERNAL_EQUINOX_FRACTION;
  const sunLonRad = wrapRad(((utDays - eqOffset) / daysPerYear) * TWO_PI);
  const lstRad = wrapRad(sunLonRad + ((localHour - hoursPerDay * 0.5) / hoursPerDay) * TWO_PI);
  const sunEcl: Vec3 = { x: Math.cos(sunLonRad), y: Math.sin(sunLonRad), z: 0 };
  const sunEq = eclipticToEquatorialVecInto(sunEcl, tiltRad, _sunEq);
  const sunSky = equatorialToHorizontal(sunEq, lstRad, latRad);
  const sunAngularRadiusDeg = 0.265;

  // 2. Primary Bright Moon
  const pm = config.primaryMoon;
  const pmNodeRad = pm.ascendingNodeDeg * DEG_TO_RAD;
  const pmIncRad = pm.inclinationDeg * DEG_TO_RAD;
  const pmMeanElongRad = wrapRad(pm.initialPhaseOffsetDeg * DEG_TO_RAD + (utDays / pm.synodicPeriodDays) * TWO_PI);
  const pmOrbitalLonRad = wrapRad(sunLonRad + pmMeanElongRad);
  const pmArgLatRad = pmOrbitalLonRad - pmNodeRad;
  const pmEcl = orbitalToEclipticVecInto(pmArgLatRad, pmIncRad, pmNodeRad, _pmEcl);
  const pmEq = eclipticToEquatorialVecInto(pmEcl, tiltRad, _pmEq);
  const pmSky = equatorialToHorizontal(pmEq, lstRad, latRad);

  const pmDotSun = clamp(pmEcl.x * sunEcl.x + pmEcl.y * sunEcl.y + pmEcl.z * sunEcl.z, -1, 1);
  const pmPhaseFraction = (1 - pmDotSun) * 0.5;
  const pmElongationDeg = Math.acos(pmDotSun) * RAD_TO_DEG;
  const pmSignedElong = wrapSignedRad(Math.atan2(pmEcl.y, pmEcl.x) - sunLonRad);
  const pmWaxing = pmSignedElong >= 0;

  // 3. Trojan L4/L5 Shard Cluster ("Tears")
  const tc = config.trojanCluster;
  const lagSign = tc.lagrangePoint === 'L4' ? 1 : -1;
  const tcLagRad = tc.lagCenterDeg * DEG_TO_RAD;
  const tcCoreOrbitalRad = wrapRad(pmOrbitalLonRad + lagSign * tcLagRad);
  const tcCoreEcl = orbitalToEclipticVecInto(tcCoreOrbitalRad - pmNodeRad, pmIncRad, pmNodeRad, _tcCoreEcl);
  const tcCoreEq = eclipticToEquatorialVecInto(tcCoreEcl, tiltRad, _tcCoreEq);
  const tcCoreSky = equatorialToHorizontal(tcCoreEq, lstRad, latRad);
  const tcDotSun = clamp(tcCoreEcl.x * sunEcl.x + tcCoreEcl.y * sunEcl.y + tcCoreEcl.z * sunEcl.z, -1, 1);
  const tcPhaseFraction = (1 - tcDotSun) * 0.5;

  const shards: ShardParticleState[] = [];
  let visibleShardCount = 0;
  if (tc.enabled && includeShards) {
    const templates = getDeterministicShards(tc.shardCount, tc.arcSpreadDeg, tc.inclinationScatterDeg);
    for (const tpl of templates) {
      const sArgLat = pmOrbitalLonRad + lagSign * (tc.lagCenterDeg + tpl.lagOffsetDeg) * DEG_TO_RAD - pmNodeRad;
      const sLatOffsetRad = tpl.latScatterDeg * DEG_TO_RAD;
      const sEcl = orbitalWithLatOffsetToEclipticVecInto(sArgLat, sLatOffsetRad, pmIncRad, pmNodeRad, _shardEcl);
      const sEq = eclipticToEquatorialVecInto(sEcl, tiltRad, _shardEq);
      const sSky = equatorialToHorizontal(sEq, lstRad, latRad);
      const sDotSun = clamp(sEcl.x * sunEcl.x + sEcl.y * sunEcl.y + sEcl.z * sunEcl.z, -1, 1);
      const sPhase = (1 - sDotSun) * 0.5;
      if (sSky.aboveHorizon) visibleShardCount++;
      shards.push({
        id: tpl.id,
        sky: sSky,
        phaseFraction: sPhase,
        relativeSize: tpl.relativeSize,
        brightness: clamp(tpl.reflectivity * (0.18 + 0.82 * Math.pow(sPhase, 0.85)), 0, 1),
      });
    }
  }

  // 4. Distant Outer "Black Moon"
  const bm = config.blackMoon;
  const bmNodeRad = bm.ascendingNodeDeg * DEG_TO_RAD;
  const bmIncRad = bm.inclinationDeg * DEG_TO_RAD;
  const bmDir = bm.retrograde ? -1 : 1;
  const bmOrbitalLonRad = wrapRad(
    bm.initialLongitudeDeg * DEG_TO_RAD + bmDir * (utDays / bm.siderealPeriodDays) * TWO_PI
  );
  const bmEcl = orbitalToEclipticVecInto(bmOrbitalLonRad - bmNodeRad, bmIncRad, bmNodeRad, _bmEcl);
  const bmEq = eclipticToEquatorialVecInto(bmEcl, tiltRad, _bmEq);
  const bmSky = equatorialToHorizontal(bmEq, lstRad, latRad);

  // 4b. 12-Year Periodic Comet ("The Red Harbinger")
  const cometCfg = config.comet;
  const cometCycleDays = cometCfg.orbitalPeriodYears * daysPerYear;
  const cometPeri0Days = (cometCfg.perihelionYear - 1) * daysPerYear + (cometCfg.perihelionDay - 1);
  const cometOffsetDays = totalDays - cometPeri0Days;
  const cometDaysFromPeri =
    ((cometOffsetDays % cometCycleDays) + cometCycleDays + cometCycleDays / 2) % cometCycleDays - cometCycleDays / 2;
  const cometActive = Math.abs(cometDaysFromPeri) <= cometCfg.activeWindowDays;
  const cometActivityFraction = cometActive
    ? clamp(1 - Math.abs(cometDaysFromPeri) / cometCfg.activeWindowDays, 0, 1)
    : 0;

  const cometEcl = computeCometEcliptic(utDays, config);
  const cometEq = eclipticToEquatorialVecInto(cometEcl, tiltRad, _cometEq);
  const cometSky = equatorialToHorizontal(cometEq, lstRad, latRad);
  const cometTailWidthDeg = cometCfg.tailWidthMultiplier * (pm.angularRadiusDeg * 2); // 8 * 0.56° = 4.48°
  const cometTailLengthDeg = cometCfg.tailLengthDeg * (0.35 + 0.65 * cometActivityFraction);

  const bmDotSun = clamp(bmEcl.x * sunEcl.x + bmEcl.y * sunEcl.y + bmEcl.z * sunEcl.z, -1, 1);
  const bmPhaseFraction = (1 - bmDotSun) * 0.5;
  const bmElongationDeg = Math.acos(bmDotSun) * RAD_TO_DEG;
  const bmSignedElong = wrapSignedRad(Math.atan2(bmEcl.y, bmEcl.x) - sunLonRad);
  const bmWaxing = bmSignedElong >= 0;

  // Carbonaceous opposition surge ("Ash-Full"): sharp brightening within ~8.5 deg of opposition (180 deg elongation)
  const oppSeparationDeg = 180 - bmElongationDeg;
  const oppositionSurge = Math.exp(-Math.pow(oppSeparationDeg / 6.2, 2));
  const isAshFull = bm.enabled && oppSeparationDeg <= 8.5;
  const bmSurfaceVisibility = bm.enabled
    ? clamp(bm.albedo * 1.6 * Math.pow(bmPhaseFraction, 1.4) + 0.42 * oppositionSurge, 0, 1)
    : 0;

  // 5. Eclipses & Omen Alignments
  const sepSunPrimary = angularSeparationDeg(sunSky, pmSky);
  const sepSunBlack = angularSeparationDeg(sunSky, bmSky);
  const primaryEclipseFrac = computeDiskOverlapFraction(sepSunPrimary, sunAngularRadiusDeg, pm.angularRadiusDeg);
  const blackEclipseFrac = bm.enabled
    ? computeDiskOverlapFraction(sepSunBlack, sunAngularRadiusDeg, bm.angularRadiusDeg)
    : 0;

  const eclipseFraction = Math.max(primaryEclipseFrac, blackEclipseFrac);
  const eclipsedBy: 'primary' | 'black' | null =
    blackEclipseFrac > 0.01 && blackEclipseFrac >= primaryEclipseFrac
      ? 'black'
      : primaryEclipseFrac > 0.01
        ? 'primary'
        : null;

  // Perturbation of L5 shard cluster fringe when Black Moon aligns with or opposes the Trojan pocket
  const trojanBlackDeltaDeg = Math.abs(wrapSignedRad(bmOrbitalLonRad - tcCoreOrbitalRad)) * RAD_TO_DEG;
  const alignmentDistDeg = Math.min(trojanBlackDeltaDeg, Math.abs(180 - trojanBlackDeltaDeg));
  const meteorActivity =
    bm.enabled && tc.enabled ? clamp(1 - alignmentDistDeg / 14, 0, 1) : 0;

  // Conjunction between Black Moon and Primary Moon in the sky ("The Shadowed Crown")
  const sepMoonsDeg = angularSeparationDeg(pmSky, bmSky);

  // 6. Rise & Set Times (optional fast skip during multi-month coarse omen scans)
  const emptyRiseSet: RiseSetInfo = { riseHour: null, setHour: null, state: 'normal' };
  const sunRiseSet = includeRiseSet
    ? solveRiseSetForDay(dayBaseHours, config, clampedLat, clampedLon, 'sun')
    : emptyRiseSet;
  const pmRiseSet = includeRiseSet
    ? solveRiseSetForDay(dayBaseHours, config, clampedLat, clampedLon, 'primary')
    : emptyRiseSet;
  const tcRiseSet = includeRiseSet && tc.enabled
    ? solveRiseSetForDay(dayBaseHours, config, clampedLat, clampedLon, 'trojan')
    : emptyRiseSet;
  const bmRiseSet = includeRiseSet && bm.enabled
    ? solveRiseSetForDay(dayBaseHours, config, clampedLat, clampedLon, 'black')
    : emptyRiseSet;
  const cometRiseSet = includeRiseSet && cometActive
    ? solveRiseSetForDay(dayBaseHours, config, clampedLat, clampedLon, 'comet')
    : emptyRiseSet;

  const cometState: CometSkyState = {
    name: cometCfg.name,
    active: cometActive,
    sky: cometSky,
    distanceAU: 0.26 + 4.72 * (1 - cometActivityFraction),
    activityFraction: cometActivityFraction,
    tailLengthDeg: cometTailLengthDeg,
    tailWidthDeg: cometTailWidthDeg,
    eclipticLonDeg: Math.atan2(cometEcl.y, cometEcl.x) * RAD_TO_DEG,
    eclipticLatDeg: Math.asin(clamp(cometEcl.z, -1, 1)) * RAD_TO_DEG,
    riseSet: cometRiseSet,
  };

  // 7. Tabletop Sky & Ground Illumination
  const pmAltFactor = pmSky.altitudeDeg > 0 ? Math.sin(clamp(pmSky.altitudeDeg, 0, 90) * DEG_TO_RAD) : 0;
  const pmLight = clamp(pm.albedo * 3.4 * Math.pow(pmPhaseFraction, 1.35) * (0.25 + 0.75 * pmAltFactor), 0, 1) *
    (pmSky.aboveHorizon ? 1 : 0);

  const tcAltFactor = tcCoreSky.altitudeDeg > 0 ? Math.sin(clamp(tcCoreSky.altitudeDeg, 0, 90) * DEG_TO_RAD) : 0;
  const visibleFraction = !tc.enabled
    ? 0
    : includeShards
      ? shards.length > 0
        ? visibleShardCount / shards.length
        : 0
      : clamp((tcCoreSky.altitudeDeg + tc.arcSpreadDeg * 0.5) / Math.max(1, tc.arcSpreadDeg), 0, 1);
  const tcLight = tc.enabled
    ? 0.16 * tcPhaseFraction * visibleFraction * (0.35 + 0.65 * tcAltFactor)
    : 0;

  const bmAltFactor = bmSky.altitudeDeg > 0 ? Math.sin(clamp(bmSky.altitudeDeg, 0, 90) * DEG_TO_RAD) : 0;
  const bmLight = bm.enabled && bmSky.aboveHorizon ? 0.05 * oppositionSurge * bmAltFactor : 0;

  const nightIllumination = clamp(pmLight + tcLight + bmLight, 0, 1);

  let lightLevel: TabletopLightLevel;
  let lightSummary: string;

  if (sunSky.altitudeDeg > -0.5) {
    if (eclipseFraction > 0.75) {
      lightLevel = 'Civil Twilight';
      lightSummary = `Eerie eclipse twilight (${Math.round(eclipseFraction * 100)}% of ${config.sunName} covered).`;
    } else {
      lightLevel = 'Daylight';
      lightSummary = `Full daylight (${config.sunName} ${Math.round(sunSky.altitudeDeg)}° above horizon).`;
    }
  } else if (sunSky.altitudeDeg > -6) {
    lightLevel = 'Civil Twilight';
    lightSummary = `Dusk/dawn twilight (${config.sunName} ${Math.abs(Math.round(sunSky.altitudeDeg))}° below horizon).`;
  } else if (nightIllumination >= 0.52) {
    lightLevel = 'Bright Moonlight';
    lightSummary = `Silvery bright moonlight from ${pm.name} (${Math.round(pmPhaseFraction * 100)}% full) — clear silhouettes at distance.`;
  } else if (nightIllumination >= 0.18) {
    lightLevel = 'Dim Moonlight';
    lightSummary = `Dim moonlight (${pm.name} ${pmSky.aboveHorizon ? `${Math.round(pmPhaseFraction * 100)}%` : 'below horizon'}) — shadows conceal beyond close range.`;
  } else if (tcLight >= 0.045) {
    lightLevel = 'Faint Shardlight';
    lightSummary = `${pm.name} is ${pmSky.aboveHorizon ? 'dark' : 'down'}, leaving only the shimmering ${tc.name} across the sky.`;
  } else if (bm.enabled && bmSky.aboveHorizon && nightIllumination < 0.03) {
    lightLevel = 'Pitch Dark';
    lightSummary = `Pitch black omen sky — ${bm.name} blots out the stars overhead with no silver moonlight.`;
  } else {
    lightLevel = 'Starlight';
    lightSummary = `Moonless starlight — only faint constellations illuminate open ground.`;
  }

  // 8. Active Omens & Notable Sky Events
  const activeOmens: CelestialOmen[] = [];

  if (blackEclipseFrac > 0.02 && sunSky.aboveHorizon) {
    activeOmens.push({
      type: 'black-solar-eclipse',
      title: `Black Omen Eclipse (${Math.round(blackEclipseFrac * 100)}%)`,
      severity: 'omen',
      description: `${bm.name} cuts a pitch-black silhouette across ${config.sunName}!`,
    });
  } else if (primaryEclipseFrac > 0.02 && sunSky.aboveHorizon) {
    activeOmens.push({
      type: 'silver-solar-eclipse',
      title: `Solar Eclipse (${Math.round(primaryEclipseFrac * 100)}%)`,
      severity: 'celestial',
      description: `${pm.name} passes across the disc of ${config.sunName}.`,
    });
  }

  if (isAshFull && bmSky.aboveHorizon && sunSky.altitudeDeg < -4) {
    activeOmens.push({
      type: 'ash-full',
      title: 'Ash-Full Black Moon',
      severity: 'omen',
      description: `${bm.name} surges into a ghostly ember-ash glow at exact opposition.`,
    });
  }

  if (bm.enabled && sepMoonsDeg < 3.2 && (pmSky.aboveHorizon || bmSky.aboveHorizon)) {
    activeOmens.push({
      type: 'shadow-conjunction',
      title: 'Shadowed Crown Conjunction',
      severity: 'omen',
      description: `${pm.name} and ${bm.name} converge within ${sepMoonsDeg.toFixed(1)}° in the sky.`,
    });
  }

  if (meteorActivity > 0.35 && sunSky.altitudeDeg < -4 && visibleFraction > 0.15) {
    activeOmens.push({
      type: 'weeping-meteors',
      title: 'Weeping Sky Meteor Shower',
      severity: 'celestial',
      description: `${bm.name}'s alignment tugs loose dust from the ${tc.name}, streaking across the night sky.`,
    });
  }

  if (sunSky.altitudeDeg < -8 && nightIllumination < 0.02 && bm.enabled && bmSky.aboveHorizon) {
    activeOmens.push({
      type: 'pitch-night',
      title: 'Night of the Watching Void',
      severity: 'omen',
      description: `No moonlight reaches the ground while ${bm.name} hangs unseen above the horizon, swallowing starlight.`,
    });
  } else if (pmPhaseFraction > 0.975 && pmSky.aboveHorizon && sunSky.altitudeDeg < -4) {
    activeOmens.push({
      type: 'silver-full',
      title: `High Full ${pm.name}`,
      severity: 'info',
      description: `${pm.name} shines at full brilliance from sunset to sunrise.`,
    });
  }

  if (cometActive && cometSky.aboveHorizon && sunSky.altitudeDeg < -2) {
    activeOmens.push({
      type: 'comet-apparition',
      title: `${cometCfg.name} Apparition`,
      severity: 'omen',
      description: `The pale red bleeding star streaks across the dark heavens, casting its fearful tail across the sky.`,
    });
  }

  return {
    worldHours,
    year,
    dayOfYear,
    monthName,
    dayOfMonth,
    seasonName,
    localHour,
    latitudeDeg: clampedLat,
    longitudeDeg: clampedLon,
    localSiderealRad: lstRad,
    sun: {
      name: config.sunName,
      sky: sunSky,
      eclipticLonDeg: sunLonRad * RAD_TO_DEG,
      angularRadiusDeg: sunAngularRadiusDeg,
      riseSet: sunRiseSet,
      eclipseFraction,
      eclipsedBy,
    },
    primaryMoon: {
      name: pm.name,
      sky: pmSky,
      eclipticLonDeg: Math.atan2(pmEcl.y, pmEcl.x) * RAD_TO_DEG,
      eclipticLatDeg: Math.asin(clamp(pmEcl.z, -1, 1)) * RAD_TO_DEG,
      orbitalAngleRad: pmOrbitalLonRad,
      phaseFraction: pmPhaseFraction,
      elongationDeg: pmElongationDeg,
      waxing: pmWaxing,
      phaseName: describeMoonPhase(pmPhaseFraction, pmWaxing, false, false),
      brightLimbAngleRad: computeBrightLimbAngle(pmSky, sunSky),
      surfaceVisibility: clamp(0.15 + 0.85 * Math.pow(pmPhaseFraction, 0.7), 0, 1),
      angularRadiusDeg: pm.angularRadiusDeg,
      isAshFull: false,
      riseSet: pmRiseSet,
    },
    trojanCluster: {
      name: tc.name,
      coreSky: tcCoreSky,
      phaseFraction: tcPhaseFraction,
      riseSet: tcRiseSet,
      visibleFraction,
      meteorActivity,
      shards,
    },
    blackMoon: {
      name: bm.name,
      sky: bmSky,
      eclipticLonDeg: Math.atan2(bmEcl.y, bmEcl.x) * RAD_TO_DEG,
      eclipticLatDeg: Math.asin(clamp(bmEcl.z, -1, 1)) * RAD_TO_DEG,
      orbitalAngleRad: bmOrbitalLonRad,
      phaseFraction: bmPhaseFraction,
      elongationDeg: bmElongationDeg,
      waxing: bmWaxing,
      phaseName: describeMoonPhase(bmPhaseFraction, bmWaxing, true, isAshFull),
      brightLimbAngleRad: computeBrightLimbAngle(bmSky, sunSky),
      surfaceVisibility: bmSurfaceVisibility,
      angularRadiusDeg: bm.angularRadiusDeg,
      isAshFull,
      riseSet: bmRiseSet,
    },
    comet: cometState,
    lighting: {
      level: lightLevel,
      nightIllumination,
      summary: lightSummary,
    },
    activeOmens,
  };
}

/**
 * Computes a 24-hour trajectory polyline of (azimuthDeg, altitudeDeg) samples for plotting sky arcs.
 */
export function computeDailySkyArc(
  worldHours: number,
  latitudeDeg: number,
  longitudeDeg: number,
  config: CelestialWorldConfig,
  body: 'sun' | 'primary' | 'black' | 'comet'
): { azimuthDeg: number; altitudeDeg: number }[] {
  const dayFloor = Math.floor(worldHours / config.hoursPerDay);
  const dayBase = dayFloor * config.hoursPerDay;
  const samples = 48;
  const pts: { azimuthDeg: number; altitudeDeg: number }[] = [];

  for (let i = 0; i <= samples; i++) {
    const h = dayBase + (i / samples) * config.hoursPerDay;
    const snap = computeCelestialSnapshot(h, latitudeDeg, longitudeDeg, config, false);
    const sky =
      body === 'sun'
        ? snap.sun.sky
        : body === 'primary'
          ? snap.primaryMoon.sky
          : body === 'black'
            ? snap.blackMoon.sky
            : snap.comet.sky;
    pts.push({ azimuthDeg: sky.azimuthDeg, altitudeDeg: sky.altitudeDeg });
  }
  return pts;
}

function scoreOmenPeak(snap: CelestialSnapshot, type: CelestialOmen['type']): number {
  switch (type) {
    case 'black-solar-eclipse':
    case 'silver-solar-eclipse':
      return snap.sun.sky.aboveHorizon ? snap.sun.eclipseFraction : 0;
    case 'ash-full':
      return snap.blackMoon.isAshFull && snap.blackMoon.sky.aboveHorizon && snap.sun.sky.altitudeDeg < -6
        ? snap.blackMoon.surfaceVisibility * (0.3 + 0.7 * Math.sin(Math.max(0, snap.blackMoon.sky.altitudeDeg) * DEG_TO_RAD))
        : 0;
    case 'weeping-meteors':
      return snap.sun.sky.altitudeDeg < -6
        ? snap.trojanCluster.meteorActivity * snap.trojanCluster.visibleFraction
        : 0;
    case 'shadow-conjunction': {
      const sep = angularSeparationDeg(snap.primaryMoon.sky, snap.blackMoon.sky);
      return sep < 3.2 && (snap.primaryMoon.sky.aboveHorizon || snap.blackMoon.sky.aboveHorizon)
        ? 4 - sep
        : 0;
    }
    case 'silver-full':
      return snap.primaryMoon.sky.aboveHorizon && snap.sun.sky.altitudeDeg < -6
        ? snap.primaryMoon.phaseFraction * Math.sin(Math.max(0, snap.primaryMoon.sky.altitudeDeg) * DEG_TO_RAD)
        : 0;
    case 'pitch-night':
      return snap.sun.sky.altitudeDeg < -10 && snap.blackMoon.sky.aboveHorizon
        ? Math.max(0, 0.03 - snap.lighting.nightIllumination) * 20 + Math.max(0, snap.blackMoon.sky.altitudeDeg) * 0.01
        : 0;
    case 'comet-apparition':
      return snap.comet && snap.comet.active && snap.comet.sky.aboveHorizon && snap.sun.sky.altitudeDeg < -4
        ? snap.comet.activityFraction * Math.sin(Math.max(0, snap.comet.sky.altitudeDeg) * DEG_TO_RAD)
        : 0;
  }
}

function refineEclipseCandidate(
  conjHours: number,
  body: 'primary' | 'black',
  latitudeDeg: number,
  longitudeDeg: number,
  config: CelestialWorldConfig
): EclipseProjection | null {
  const startH = Math.max(0, conjHours - 5);
  const endH = conjHours + 5;
  const step = 0.05; // 3-minute resolution

  let firstH: number | null = null;
  let lastH: number | null = null;
  let peakH = conjHours;
  let peakFrac = 0;
  let peakSnap: CelestialSnapshot | null = null;

  for (let rh = startH; rh <= endH; rh += step) {
    const snap = computeCelestialSnapshot(rh, latitudeDeg, longitudeDeg, config, false);
    if (!snap.sun.sky.aboveHorizon) continue;
    if (snap.sun.eclipsedBy !== body || snap.sun.eclipseFraction <= 0.02) continue;

    if (firstH === null) firstH = rh;
    lastH = rh;
    if (snap.sun.eclipseFraction > peakFrac) {
      peakFrac = snap.sun.eclipseFraction;
      peakH = rh;
      peakSnap = snap;
    }
  }

  if (firstH === null || lastH === null || !peakSnap || peakFrac <= 0.02) {
    return null;
  }

  const isBlack = body === 'black';
  return {
    type: isBlack ? 'black-solar-eclipse' : 'silver-solar-eclipse',
    title: isBlack
      ? `Black Omen Eclipse (${Math.round(peakFrac * 100)}%)`
      : `Solar Eclipse (${Math.round(peakFrac * 100)}%)`,
    eclipsedBy: body,
    maxCoverageFraction: peakFrac,
    worldHours: peakH,
    startWorldHours: firstH,
    endWorldHours: lastH,
    dayNumber: peakSnap.dayOfYear,
    yearNumber: peakSnap.year,
    localHour: peakSnap.localHour,
  };
}

function collectEclipsesInRange(
  rangeStartHours: number,
  rangeEndHours: number,
  latitudeDeg: number,
  longitudeDeg: number,
  config: CelestialWorldConfig
): EclipseProjection[] {
  const hoursPerDay = Math.max(1, config.hoursPerDay);
  const daysPerYear = Math.max(1, config.daysPerYear);
  const clampedLon = clamp(longitudeDeg, -180, 180);
  const lonOffsetDays = clampedLon / 360;

  const startUtDays = Math.max(0, rangeStartHours) / hoursPerDay - lonOffsetDays;
  const endUtDays = Math.max(0, rangeEndHours) / hoursPerDay - lonOffsetDays;
  if (endUtDays <= startUtDays) return [];

  const results: EclipseProjection[] = [];
  const sunRadius = 0.265;

  // 1. Primary Moon (Vaelis) conjunctions
  const pm = config.primaryMoon;
  const pmNodeRad = pm.ascendingNodeDeg * DEG_TO_RAD;
  const pmPhaseCycles0 = pm.initialPhaseOffsetDeg / 360;
  const pmKMin = Math.floor(startUtDays / pm.synodicPeriodDays + pmPhaseCycles0) - 1;
  const pmKMax = Math.ceil(endUtDays / pm.synodicPeriodDays + pmPhaseCycles0) + 1;

  for (let k = pmKMin; k <= pmKMax; k++) {
    const utDays = (k - pmPhaseCycles0) * pm.synodicPeriodDays;
    const conjHours = (utDays + lonOffsetDays) * hoursPerDay;
    if (conjHours < Math.max(0, rangeStartHours) - 5 || conjHours > rangeEndHours + 5) continue;

    const eqOffset = daysPerYear * VERNAL_EQUINOX_FRACTION;
    const sunLonRad = wrapRad(((utDays - eqOffset) / daysPerYear) * TWO_PI);
    const approxLatDeg = Math.abs(Math.sin(sunLonRad - pmNodeRad)) * pm.inclinationDeg;
    if (approxLatDeg <= sunRadius + pm.angularRadiusDeg + 1.5) {
      const ev = refineEclipseCandidate(conjHours, 'primary', latitudeDeg, longitudeDeg, config);
      if (ev) results.push(ev);
    }
  }

  // 2. Black Moon (Morvath) conjunctions
  const bm = config.blackMoon;
  if (bm.enabled) {
    const bmNodeRad = bm.ascendingNodeDeg * DEG_TO_RAD;
    const bmDir = bm.retrograde ? -1 : 1;
    const phi0 = bm.initialLongitudeDeg / 360 + VERNAL_EQUINOX_FRACTION;
    const relRate = bmDir / bm.siderealPeriodDays - 1 / daysPerYear;
    if (Math.abs(relRate) > 1e-9) {
      const kA = phi0 + startUtDays * relRate;
      const kB = phi0 + endUtDays * relRate;
      const bmKMin = Math.floor(Math.min(kA, kB)) - 1;
      const bmKMax = Math.ceil(Math.max(kA, kB)) + 1;

      for (let k = bmKMin; k <= bmKMax; k++) {
        const utDays = (k - phi0) / relRate;
        const conjHours = (utDays + lonOffsetDays) * hoursPerDay;
        if (conjHours < Math.max(0, rangeStartHours) - 5 || conjHours > rangeEndHours + 5) continue;

        const eqOffset = daysPerYear * VERNAL_EQUINOX_FRACTION;
        const sunLonRad = wrapRad(((utDays - eqOffset) / daysPerYear) * TWO_PI);
        const approxLatDeg = Math.abs(Math.sin(sunLonRad - bmNodeRad)) * bm.inclinationDeg;
        if (approxLatDeg <= sunRadius + bm.angularRadiusDeg + 1.5) {
          const ev = refineEclipseCandidate(conjHours, 'black', latitudeDeg, longitudeDeg, config);
          if (ev) results.push(ev);
        }
      }
    }
  }

  return results.sort((a, b) => a.worldHours - b.worldHours);
}

/**
 * Projects upcoming visible solar eclipses (both Vaelis and Morvath) for the observer over multiple years.
 */
export function projectUpcomingEclipses(
  startWorldHours: number,
  latitudeDeg: number,
  longitudeDeg: number,
  config: CelestialWorldConfig,
  maxSearchYears = 50,
  limit = 6
): EclipseProjection[] {
  const spanHours = maxSearchYears * Math.max(1, config.daysPerYear) * Math.max(1, config.hoursPerDay);
  const all = collectEclipsesInRange(startWorldHours, startWorldHours + spanHours, latitudeDeg, longitudeDeg, config);
  return all.filter((e) => e.endWorldHours > startWorldHours).slice(0, limit);
}

/**
 * Finds the next (+1) or previous (-1) visible solar eclipse relative to `worldHours`.
 */
export function findAdjacentEclipse(
  worldHours: number,
  direction: 1 | -1,
  latitudeDeg: number,
  longitudeDeg: number,
  config: CelestialWorldConfig,
  maxSearchYears = 50
): EclipseProjection | null {
  const t0 = performance.now();
  const yearHours = Math.max(1, config.daysPerYear) * Math.max(1, config.hoursPerDay);
  let found: EclipseProjection | null = null;

  if (direction === 1) {
    for (let y = 0; y < maxSearchYears; y++) {
      const chunkStart = worldHours + y * yearHours;
      const chunkEnd = chunkStart + yearHours;
      const all = collectEclipsesInRange(chunkStart, chunkEnd, latitudeDeg, longitudeDeg, config);
      const match =
        all.find((e) => e.startWorldHours > worldHours + 0.05 || (e.worldHours > worldHours + 0.05 && worldHours < e.startWorldHours)) ??
        all.find((e) => e.startWorldHours > worldHours) ??
        null;
      if (match) {
        found = match;
        break;
      }
    }
  } else if (worldHours > 0.05) {
    for (let y = 0; y < maxSearchYears; y++) {
      const chunkEnd = worldHours - y * yearHours;
      if (chunkEnd <= 0) break;
      const chunkStart = Math.max(0, chunkEnd - yearHours);
      const all = collectEclipsesInRange(chunkStart, chunkEnd, latitudeDeg, longitudeDeg, config);
      for (let i = all.length - 1; i >= 0; i--) {
        if (all[i].endWorldHours < worldHours - 0.05) {
          found = all[i];
          break;
        }
      }
      if (found) break;
    }
  }

  skyPerfMonitor.recordPhase('eclipse', performance.now() - t0);
  return found;
}

/**
 * Scans forward from `startWorldHours` up to `searchDays` to find the next peak occurrence of each notable omen/event.
 */
export function scanUpcomingOmens(
  startWorldHours: number,
  latitudeDeg: number,
  longitudeDeg: number,
  config: CelestialWorldConfig,
  searchDays = 140
): UpcomingOmenEvent[] {
  const hoursPerDay = Math.max(1, config.hoursPerDay);
  const daysPerYear = Math.max(1, config.daysPerYear);
  const maxHours = startWorldHours + searchDays * hoursPerDay;
  const stepHours = 2.0;
  const foundByType = new Map<CelestialOmen['type'], UpcomingOmenEvent>();

  // Determine whether the periodic comet's apparition window overlaps [startWorldHours, maxHours]
  const cometCfg = config.comet;
  const cometCycleDays = cometCfg.orbitalPeriodYears * daysPerYear;
  const cometPeri0Days = (cometCfg.perihelionYear - 1) * daysPerYear + (cometCfg.perihelionDay - 1);
  const startDays = (startWorldHours + 2) / hoursPerDay;
  const endDays = maxHours / hoursPerDay;
  let cometPossibleInRange = false;
  if (cometCycleDays > 0) {
    const kMin = Math.floor((startDays - cometCfg.activeWindowDays - cometPeri0Days) / cometCycleDays);
    const kMax = Math.ceil((endDays + cometCfg.activeWindowDays - cometPeri0Days) / cometCycleDays);
    for (let k = kMin; k <= kMax; k++) {
      const periDay = cometPeri0Days + k * cometCycleDays;
      if (periDay + cometCfg.activeWindowDays >= startDays && periDay - cometCfg.activeWindowDays <= endDays) {
        cometPossibleInRange = true;
        break;
      }
    }
  }

  // Solar eclipses are already exhaustively seeded analytically below; omit them (and out-of-window comet) from early-exit targets
  const loopTargetTypes: CelestialOmen['type'][] = [
    'silver-full',
    'ash-full',
    'weeping-meteors',
    'shadow-conjunction',
    'pitch-night',
  ];
  if (cometPossibleInRange) {
    loopTargetTypes.push('comet-apparition');
  }

  // Seed accurate eclipse detections first so coarse steps never skip a brief solar eclipse
  const upcomingEclipses = collectEclipsesInRange(startWorldHours + 0.25, maxHours, latitudeDeg, longitudeDeg, config);
  for (const ec of upcomingEclipses) {
    if (!foundByType.has(ec.type)) {
      foundByType.set(ec.type, {
        type: ec.type,
        title: ec.title,
        severity: ec.type === 'black-solar-eclipse' ? 'omen' : 'celestial',
        worldHours: ec.worldHours,
        dayNumber: ec.dayNumber,
        yearNumber: ec.yearNumber,
        localHour: ec.localHour,
      });
    }
  }

  for (let h = startWorldHours + 2; h <= maxHours; h += stepHours) {
    const snap = computeCelestialSnapshot(h, latitudeDeg, longitudeDeg, config, false);
    for (const omen of snap.activeOmens) {
      if (!foundByType.has(omen.type)) {
        // Refine forward across the event window (~30h) to land on the peak sky moment
        let bestH = h;
        let bestSnap = snap;
        let bestScore = scoreOmenPeak(snap, omen.type);
        const refineEnd = Math.min(maxHours, h + hoursPerDay * 1.4);
        for (let rh = h + 0.25; rh <= refineEnd; rh += 0.25) {
          const rSnap = computeCelestialSnapshot(rh, latitudeDeg, longitudeDeg, config, false);
          if (!rSnap.activeOmens.some((o) => o.type === omen.type)) continue;
          const s = scoreOmenPeak(rSnap, omen.type);
          if (s > bestScore) {
            bestScore = s;
            bestH = rh;
            bestSnap = rSnap;
          }
        }
        const peakOmen = bestSnap.activeOmens.find((o) => o.type === omen.type) ?? omen;
        foundByType.set(omen.type, {
          type: omen.type,
          title: peakOmen.title,
          severity: peakOmen.severity,
          worldHours: bestH,
          dayNumber: bestSnap.dayOfYear,
          yearNumber: bestSnap.year,
          localHour: bestSnap.localHour,
        });
      }
    }
    if (loopTargetTypes.every((t) => foundByType.has(t))) break;
  }

  return Array.from(foundByType.values()).sort((a, b) => a.worldHours - b.worldHours);
}

export function formatClockHour(hour: number | null, hoursPerDay = 24): string {
  if (hour === null || !Number.isFinite(hour)) return '—';
  const wrapped = ((hour % hoursPerDay) + hoursPerDay) % hoursPerDay;
  const hh = Math.floor(wrapped);
  const mm = Math.floor((wrapped - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function azimuthToCompass(azimuthDeg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round((((azimuthDeg % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}
