import { SkyVectorHorizontal, starRaDecToHorizontal } from './QWorldCelestial';

export interface ConstellationStar {
  name?: string;
  raDeg: number;
  decDeg: number;
  mag: number; // 0 = brightest (1st mag), 1 = faint
  tint: string;
}

export interface ConstellationArtPath {
  points: [number, number][]; // Normalized local offsets (-1..1) in (East, North) around anchor
  closed?: boolean;
  fillAlpha?: number;
}

export interface ConstellationDef {
  id: string;
  name: string;
  subtitle: string;
  centerRaDeg: number;
  centerDecDeg: number;
  artRadiusDeg: number;
  lore: string;
  color: string;
  stars: ConstellationStar[];
  edges: [number, number][];
  artPaths: ConstellationArtPath[];
}

const DEG_TO_RAD = Math.PI / 180;

export const WORLD_CONSTELLATIONS: ConstellationDef[] = [
  {
    id: 'crown',
    name: 'The Northstar Crown',
    subtitle: 'Navigators’ Pole',
    centerRaDeg: 0,
    centerDecDeg: 78,
    artRadiusDeg: 14,
    lore: 'Anchored by Polaris Vael near the celestial pole, guiding mariners when both moons are dark.',
    color: '#bae6fd',
    stars: [
      { name: 'Polaris Vael', raDeg: 0, decDeg: 88.2, mag: 0.05, tint: '#e0f2fe' },
      { raDeg: 335, decDeg: 76, mag: 0.22, tint: '#f8fafc' },
      { raDeg: 350, decDeg: 72, mag: 0.25, tint: '#f8fafc' },
      { raDeg: 15, decDeg: 71.5, mag: 0.2, tint: '#fef3c7' },
      { raDeg: 32, decDeg: 75.5, mag: 0.28, tint: '#f8fafc' },
      { raDeg: 5, decDeg: 79, mag: 0.3, tint: '#dbeafe' },
    ],
    edges: [
      [0, 5],
      [1, 2],
      [2, 3],
      [3, 4],
      [1, 5],
      [4, 5],
    ],
    artPaths: [
      {
        // Circlet crown outline
        points: [
          [-0.75, -0.35],
          [-0.95, 0.25],
          [-0.4, -0.05],
          [0, 0.55],
          [0.4, -0.05],
          [0.95, 0.25],
          [0.75, -0.35],
        ],
        closed: true,
        fillAlpha: 0.09,
      },
      {
        points: [
          [-0.65, -0.52],
          [0.65, -0.52],
        ],
      },
    ],
  },
  {
    id: 'chalice',
    name: 'The Silver Chalice',
    subtitle: 'Vessel of Vaelis',
    centerRaDeg: 32,
    centerDecDeg: 33,
    artRadiusDeg: 13,
    lore: 'Said to catch the shimmering Tears of Vaelis as they pour across the midnight sky.',
    color: '#93c5fd',
    stars: [
      { name: 'Rim-East', raDeg: 22, decDeg: 41, mag: 0.18, tint: '#e0f2fe' },
      { name: 'Rim-West', raDeg: 42, decDeg: 41, mag: 0.2, tint: '#f8fafc' },
      { raDeg: 26, decDeg: 34, mag: 0.32, tint: '#f8fafc' },
      { raDeg: 38, decDeg: 34, mag: 0.3, tint: '#f8fafc' },
      { raDeg: 32, decDeg: 29, mag: 0.24, tint: '#fef3c7' },
      { raDeg: 32, decDeg: 22, mag: 0.35, tint: '#f8fafc' },
      { raDeg: 25, decDeg: 19, mag: 0.4, tint: '#dbeafe' },
      { raDeg: 39, decDeg: 19, mag: 0.4, tint: '#dbeafe' },
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 4],
      [4, 5],
      [5, 6],
      [5, 7],
      [6, 7],
    ],
    artPaths: [
      {
        // Cup bowl
        points: [
          [-0.82, 0.68],
          [0.82, 0.68],
          [0.58, 0.05],
          [0.12, -0.25],
          [-0.12, -0.25],
          [-0.58, 0.05],
        ],
        closed: true,
        fillAlpha: 0.09,
      },
      {
        // Stem & base
        points: [
          [0, -0.25],
          [0, -0.78],
          [-0.55, -0.95],
          [0.55, -0.95],
          [0, -0.78],
        ],
      },
    ],
  },
  {
    id: 'serpent',
    name: 'The Weeping Serpent',
    subtitle: 'Ecliptic Watcher',
    centerRaDeg: 90,
    centerDecDeg: 9,
    artRadiusDeg: 18,
    lore: 'Coils along the solar road; peasants watch its fangs when the Black Moon draws near.',
    color: '#a5b4fc',
    stars: [
      { name: 'Serpentis Fang', raDeg: 74, decDeg: 16, mag: 0.14, tint: '#fed7aa' },
      { raDeg: 80, decDeg: 19, mag: 0.32, tint: '#f8fafc' },
      { raDeg: 86, decDeg: 12, mag: 0.28, tint: '#f8fafc' },
      { raDeg: 93, decDeg: 5, mag: 0.25, tint: '#fef3c7' },
      { raDeg: 100, decDeg: 10, mag: 0.3, tint: '#f8fafc' },
      { raDeg: 107, decDeg: 3, mag: 0.34, tint: '#dbeafe' },
      { raDeg: 112, decDeg: -4, mag: 0.42, tint: '#f8fafc' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ],
    artPaths: [
      {
        // Winding serpent silhouette
        points: [
          [-0.95, 0.38],
          [-0.65, 0.62],
          [-0.3, 0.25],
          [0.1, -0.22],
          [0.52, 0.12],
          [0.85, -0.35],
          [1.0, -0.68],
          [0.72, -0.45],
          [0.45, -0.05],
          [0.05, -0.42],
          [-0.38, 0.05],
          [-0.72, 0.4],
        ],
        closed: true,
        fillAlpha: 0.08,
      },
    ],
  },
  {
    id: 'shield',
    name: 'The Sundered Shield',
    subtitle: 'Aegis of the Dawn',
    centerRaDeg: 145,
    centerDecDeg: 27,
    artRadiusDeg: 14,
    lore: 'A great kite-shield cloven down the middle—veterans read omens of war in its brightest rim.',
    color: '#fcd34d',
    stars: [
      { name: 'Aegis Apex', raDeg: 145, decDeg: 39, mag: 0.16, tint: '#fef3c7' },
      { raDeg: 133, decDeg: 34, mag: 0.25, tint: '#f8fafc' },
      { raDeg: 157, decDeg: 34, mag: 0.27, tint: '#f8fafc' },
      { raDeg: 136, decDeg: 22, mag: 0.3, tint: '#dbeafe' },
      { raDeg: 154, decDeg: 22, mag: 0.32, tint: '#dbeafe' },
      { raDeg: 145, decDeg: 13, mag: 0.2, tint: '#fed7aa' },
      { raDeg: 145, decDeg: 27, mag: 0.35, tint: '#f8fafc' },
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 5],
      [4, 5],
      [0, 6],
      [6, 5],
    ],
    artPaths: [
      {
        points: [
          [0, 0.92],
          [-0.85, 0.55],
          [-0.65, -0.35],
          [0, -0.95],
          [0.65, -0.35],
          [0.85, 0.55],
        ],
        closed: true,
        fillAlpha: 0.08,
      },
      {
        // Jagged cleft down the center
        points: [
          [0.05, 0.85],
          [-0.12, 0.28],
          [0.14, -0.18],
          [-0.04, -0.82],
        ],
      },
    ],
  },
  {
    id: 'stag',
    name: 'The Pale Stag',
    subtitle: 'Herald of Greenrise',
    centerRaDeg: 202,
    centerDecDeg: 43,
    artRadiusDeg: 16,
    lore: 'Bounds across the northern canopy in spring; rangers follow its antlers to find water.',
    color: '#86efac',
    stars: [
      { name: 'Hart-Heart', raDeg: 202, decDeg: 42, mag: 0.12, tint: '#fef3c7' },
      { raDeg: 192, decDeg: 48, mag: 0.25, tint: '#f8fafc' },
      { raDeg: 186, decDeg: 55, mag: 0.34, tint: '#e0f2fe' },
      { raDeg: 196, decDeg: 56, mag: 0.38, tint: '#e0f2fe' },
      { raDeg: 212, decDeg: 40, mag: 0.28, tint: '#f8fafc' },
      { raDeg: 197, decDeg: 32, mag: 0.32, tint: '#f8fafc' },
      { raDeg: 215, decDeg: 31, mag: 0.35, tint: '#f8fafc' },
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [0, 4],
      [0, 5],
      [4, 6],
    ],
    artPaths: [
      {
        // Stag body & neck
        points: [
          [-0.8, -0.05],
          [-0.55, 0.35],
          [-0.15, 0.05],
          [0.62, -0.05],
          [0.85, -0.58],
          [0.45, -0.25],
          [-0.1, -0.22],
          [-0.45, -0.72],
          [-0.35, -0.15],
        ],
        closed: true,
        fillAlpha: 0.08,
      },
      {
        // Antlers
        points: [
          [-0.55, 0.35],
          [-0.85, 0.85],
          [-0.58, 0.65],
          [-0.45, 0.92],
        ],
      },
    ],
  },
  {
    id: 'lantern',
    name: 'The Watchman’s Lantern',
    subtitle: 'Beacon of Duskfall',
    centerRaDeg: 256,
    centerDecDeg: 22,
    artRadiusDeg: 13,
    lore: 'An amber beacon hung at the edge of night; travelers pray its light holds until dawn.',
    color: '#fdba74',
    stars: [
      { name: 'Wick-Star', raDeg: 256, decDeg: 22, mag: 0.1, tint: '#fed7aa' },
      { raDeg: 256, decDeg: 32, mag: 0.3, tint: '#f8fafc' },
      { raDeg: 249, decDeg: 26, mag: 0.32, tint: '#f8fafc' },
      { raDeg: 263, decDeg: 26, mag: 0.32, tint: '#f8fafc' },
      { raDeg: 250, decDeg: 15, mag: 0.34, tint: '#fef3c7' },
      { raDeg: 262, decDeg: 15, mag: 0.34, tint: '#fef3c7' },
      { raDeg: 256, decDeg: 11, mag: 0.38, tint: '#dbeafe' },
    ],
    edges: [
      [1, 2],
      [1, 3],
      [2, 4],
      [3, 5],
      [4, 6],
      [5, 6],
    ],
    artPaths: [
      {
        // Lantern frame
        points: [
          [0, 0.92],
          [0.52, 0.45],
          [0.44, -0.58],
          [0, -0.86],
          [-0.44, -0.58],
          [-0.52, 0.45],
        ],
        closed: true,
        fillAlpha: 0.1,
      },
      {
        // Inner flame diamond
        points: [
          [0, 0.28],
          [0.2, -0.05],
          [0, -0.38],
          [-0.2, -0.05],
        ],
        closed: true,
        fillAlpha: 0.14,
      },
    ],
  },
  {
    id: 'eye',
    name: 'The Hollow Eye',
    subtitle: 'Sign of Morvath',
    centerRaDeg: 308,
    centerDecDeg: -5,
    artRadiusDeg: 15,
    lore: 'An empty ring of stars with no center; astrologers say Morvath was born from its pupil.',
    color: '#fca5a5',
    stars: [
      { name: 'Lid-North', raDeg: 308, decDeg: 6, mag: 0.22, tint: '#fecaca' },
      { raDeg: 296, decDeg: -5, mag: 0.2, tint: '#fed7aa' },
      { raDeg: 320, decDeg: -5, mag: 0.2, tint: '#fed7aa' },
      { raDeg: 308, decDeg: -16, mag: 0.24, tint: '#fecaca' },
      { raDeg: 301, decDeg: 2, mag: 0.36, tint: '#f8fafc' },
      { raDeg: 315, decDeg: 2, mag: 0.36, tint: '#f8fafc' },
      { raDeg: 301, decDeg: -12, mag: 0.38, tint: '#f8fafc' },
      { raDeg: 315, decDeg: -12, mag: 0.38, tint: '#f8fafc' },
    ],
    edges: [
      [1, 4],
      [4, 0],
      [0, 5],
      [5, 2],
      [2, 7],
      [7, 3],
      [3, 6],
      [6, 1],
    ],
    artPaths: [
      {
        // Almond eye contour
        points: [
          [-0.95, 0],
          [-0.45, 0.58],
          [0, 0.75],
          [0.45, 0.58],
          [0.95, 0],
          [0.45, -0.58],
          [0, -0.75],
          [-0.45, -0.58],
        ],
        closed: true,
        fillAlpha: 0.08,
      },
      {
        // Hollow iris ring
        points: [
          [0, 0.42],
          [0.35, 0.2],
          [0.35, -0.2],
          [0, -0.42],
          [-0.35, -0.2],
          [-0.35, 0.2],
        ],
        closed: true,
        fillAlpha: 0.12,
      },
    ],
  },
  {
    id: 'galleon',
    name: 'The Sunken Galleon',
    subtitle: 'Southern Tides',
    centerRaDeg: 348,
    centerDecDeg: -33,
    artRadiusDeg: 17,
    lore: 'Sails the southern horizon; sailors claim its rigging predicts storm-tides.',
    color: '#67e8f9',
    stars: [
      { name: 'Keel-Star', raDeg: 348, decDeg: -43, mag: 0.14, tint: '#e0f2fe' },
      { raDeg: 336, decDeg: -37, mag: 0.26, tint: '#f8fafc' },
      { raDeg: 360, decDeg: -36, mag: 0.25, tint: '#f8fafc' },
      { raDeg: 348, decDeg: -22, mag: 0.2, tint: '#fef3c7' },
      { raDeg: 341, decDeg: -29, mag: 0.34, tint: '#dbeafe' },
      { raDeg: 356, decDeg: -29, mag: 0.34, tint: '#dbeafe' },
    ],
    edges: [
      [1, 0],
      [0, 2],
      [1, 2],
      [0, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ],
    artPaths: [
      {
        // Hull
        points: [
          [-0.85, -0.25],
          [0.85, -0.25],
          [0.52, -0.78],
          [-0.55, -0.78],
        ],
        closed: true,
        fillAlpha: 0.09,
      },
      {
        // Main sail
        points: [
          [0, 0.85],
          [0.58, -0.1],
          [-0.52, -0.1],
        ],
        closed: true,
        fillAlpha: 0.09,
      },
    ],
  },
  {
    id: 'blades',
    name: 'The Twin Blades',
    subtitle: 'Oathkeepers',
    centerRaDeg: 112,
    centerDecDeg: -30,
    artRadiusDeg: 15,
    lore: 'Two crossed longswords in the southern sky, invoked when treaties are sworn by starlight.',
    color: '#c4b5fd',
    stars: [
      { name: 'Hilt-North', raDeg: 102, decDeg: -21, mag: 0.2, tint: '#fae8ff' },
      { raDeg: 122, decDeg: -21, mag: 0.22, tint: '#e0f2fe' },
      { raDeg: 112, decDeg: -30, mag: 0.16, tint: '#f8fafc' },
      { raDeg: 103, decDeg: -40, mag: 0.28, tint: '#f8fafc' },
      { raDeg: 121, decDeg: -40, mag: 0.28, tint: '#f8fafc' },
    ],
    edges: [
      [0, 2],
      [2, 4],
      [1, 2],
      [2, 3],
    ],
    artPaths: [
      {
        // Blade 1
        points: [
          [-0.78, 0.78],
          [-0.58, 0.78],
          [0.78, -0.62],
          [0.62, -0.78],
        ],
        closed: true,
        fillAlpha: 0.08,
      },
      {
        // Blade 2
        points: [
          [0.78, 0.78],
          [0.58, 0.78],
          [-0.78, -0.62],
          [-0.62, -0.78],
        ],
        closed: true,
        fillAlpha: 0.08,
      },
    ],
  },
];

/**
 * Converts a local (u, v) normalized art coordinate on a constellation into (RA, Dec) radians,
 * then projects it to horizontal sky coordinates so ghostly planetarium artwork moves & rotates with the stars.
 */
export function projectConstellationArtPoint(
  con: ConstellationDef,
  u: number,
  v: number,
  lstRad: number,
  latitudeDeg: number
): SkyVectorHorizontal {
  const decDeg = Math.max(-89.5, Math.min(89.5, con.centerDecDeg + v * con.artRadiusDeg));
  const cosDec = Math.max(0.18, Math.cos(con.centerDecDeg * DEG_TO_RAD));
  const raDeg = con.centerRaDeg + (u * con.artRadiusDeg) / cosDec;
  return starRaDecToHorizontal(raDeg * DEG_TO_RAD, decDeg * DEG_TO_RAD, lstRad, latitudeDeg);
}

// ============================================================================
// Alien Galaxy Cloud & Deep-Sky Coloured Nebula Definitions
// ============================================================================

export interface GalaxyCloudNode {
  raDeg: number;
  decDeg: number;
  radiusDeg: number;
  opacity: number;
  tint: string;
}

export interface GalaxyCloudDef {
  name: string;
  subtitle: string;
  lore: string;
  inclinationDeg: number;
  ascendingNodeDeg: number;
  nodes: GalaxyCloudNode[];
}

export interface ColouredNebulaDef {
  id: string;
  name: string;
  subtitle: string;
  lore: string;
  centerRaDeg: number;
  centerDecDeg: number;
  radiusMajorDeg: number;
  radiusMinorDeg: number;
  rotationDeg: number;
  coreColor: string;
  midColor: string;
  outerColor: string;
}

export const COLOURED_NEBULA: ColouredNebulaDef = {
  id: 'chrysalis_nebula',
  name: 'The Chrysalis Nebula',
  subtitle: 'The Prismatic Veil',
  lore: 'A luminous, multi-hued stellar nursery glowing with ionized rose, cyan, and violet gas, spanning over 14° in the northern night sky.',
  centerRaDeg: 218.0,
  centerDecDeg: 34.5,
  radiusMajorDeg: 8.2,
  radiusMinorDeg: 5.0,
  rotationDeg: 35,
  coreColor: '#f43f5e',
  midColor: '#06b6d4',
  outerColor: '#8b5cf6',
};

function generateGalaxyCloudNodes(incDeg = 58, nodeDeg = 64): GalaxyCloudNode[] {
  const nodes: GalaxyCloudNode[] = [];
  const iRad = incDeg * DEG_TO_RAD;
  const oRad = nodeDeg * DEG_TO_RAD;
  const ci = Math.cos(iRad);
  const si = Math.sin(iRad);
  const co = Math.cos(oRad);
  const so = Math.sin(oRad);
  const nodeCount = 120;

  for (let k = 0; k < nodeCount; k++) {
    const theta = (k / nodeCount) * Math.PI * 2;
    // The galactic disc equator lies strictly in the plane (bOffset = 0)
    // guaranteeing a mathematically straight great circle across the sky.
    const cu = Math.cos(theta);
    const su = Math.sin(theta);

    const gx = cu;
    const gy = su;

    const x = co * gx - so * (gy * ci);
    const y = so * gx + co * (gy * ci);
    const z = gy * si;

    const raDeg = ((Math.atan2(y, x) * (180 / Math.PI)) % 360 + 360) % 360;
    const decDeg = Math.asin(Math.max(-1, Math.min(1, z))) * (180 / Math.PI);

    // Angular separation from galactic core (at theta = 140 deg)
    const thetaDeg = (theta * (180 / Math.PI)) % 360;
    const deltaCore = Math.min(Math.abs(thetaDeg - 140), 360 - Math.abs(thetaDeg - 140));

    let radiusDeg = 16.0;
    let opacity = 0.055;
    let tint = '#bae6fd';

    if (deltaCore < 36) {
      // Galactic Core / Bulge
      radiusDeg = 18.0 + (1 - deltaCore / 36) * 7.0;
      opacity = 0.07 + (1 - deltaCore / 36) * 0.05;
      tint = deltaCore < 18 ? '#fef3c7' : '#fae8ff';
    } else if (thetaDeg >= 160 && thetaDeg <= 200) {
      // Dark Interstellar Dust Rift
      radiusDeg = 12.0;
      opacity = 0.035;
      tint = '#64748b';
    } else if (k % 2 === 0) {
      radiusDeg = 16.0;
      opacity = 0.052;
      tint = '#e0f2fe';
    } else {
      radiusDeg = 14.0;
      opacity = 0.046;
      tint = '#c7d2fe';
    }

    nodes.push({ raDeg, decDeg, radiusDeg, opacity, tint });
  }

  return nodes;
}

export const GALAXY_CORE_RA_DEG = 282.0;
export const GALAXY_CORE_DEC_DEG = -18.0;

export const GALAXY_CLOUD: GalaxyCloudDef = {
  name: 'The Astral River',
  subtitle: 'The Great Spiral Cloud',
  lore: 'The luminous, billowing galactic plane of our host galaxy, arching across the night sky with dust rifts and cosmic glows.',
  inclinationDeg: 58,
  ascendingNodeDeg: 64,
  nodes: generateGalaxyCloudNodes(58, 64),
};

// ============================================================================
// Consistent, Non-Repeating Star Catalog Generator
// ============================================================================

export interface FixedStar {
  raRad: number;
  decRad: number;
  raDeg: number;
  decDeg: number;
  mag: number; // 0 = brightest, 1 = faint
  tint: string;
  name?: string;
  constellationId?: string;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a full, consistent celestial star spread without repeating 4-star lattices.
 * Includes all fixed constellation stars and the central star of the Coloured Nebula,
 * filtering out very faint noise so every star is cleanly visible.
 */
export function buildConsistentStarCatalog(targetTotal = 480): FixedStar[] {
  const stars: FixedStar[] = [];

  // 1. Fixed Constellation Stars (preserved exactly)
  for (const con of WORLD_CONSTELLATIONS) {
    for (const st of con.stars) {
      stars.push({
        raDeg: st.raDeg,
        decDeg: st.decDeg,
        raRad: st.raDeg * DEG_TO_RAD,
        decRad: st.decDeg * DEG_TO_RAD,
        mag: Math.min(0.68, st.mag),
        tint: st.tint,
        name: st.name,
        constellationId: con.id,
      });
    }
  }

  // 2. Full spread of randomized field stars using Mulberry32 PRNG (zero repeating lattices)
  const rng = mulberry32(0x7a89b290);
  const SPECTRAL_TINTS = [
    '#ffffff',
    '#f8fafc',
    '#e0f2fe',
    '#bae6fd',
    '#fef08a',
    '#fed7aa',
    '#fecaca',
    '#f1f5f9',
    '#93c5fd',
    '#c7d2fe',
  ];

  const iRad = GALAXY_CLOUD.inclinationDeg * DEG_TO_RAD;
  const oRad = GALAXY_CLOUD.ascendingNodeDeg * DEG_TO_RAD;
  const ci = Math.cos(iRad);
  const si = Math.sin(iRad);
  const co = Math.cos(oRad);
  const so = Math.sin(oRad);

  const isTooClose = (raDeg: number, decDeg: number, minDistDeg: number): boolean => {
    const raR = raDeg * DEG_TO_RAD;
    const decR = decDeg * DEG_TO_RAD;
    const sinD = Math.sin(decR);
    const cosD = Math.cos(decR);
    const cosMin = Math.cos(minDistDeg * DEG_TO_RAD);

    for (const s of stars) {
      const dot = sinD * Math.sin(s.decRad) + cosD * Math.cos(s.decRad) * Math.cos(raR - s.raRad);
      if (dot > cosMin) return true;
    }
    return false;
  };

  const maxCloseCompanions = Math.floor(targetTotal * 0.04); // e.g. 19 stars (~3.95% < 5%)
  let closeCompanionCount = 0;

  let attempts = 0;
  while (stars.length < targetTotal && attempts < 25000) {
    attempts++;
    let raDeg: number;
    let decDeg: number;

    // Occasionally (< 5% of the time), generate a close companion near an existing star
    if (closeCompanionCount < maxCloseCompanions && stars.length >= 60 && rng() < 0.045) {
      const parent = stars[Math.floor(rng() * stars.length)];
      // Distance between 0.12° and 0.35° (distinct visible double star, no pixel overlap)
      const distDeg = 0.12 + rng() * 0.23;
      const distRad = distDeg * DEG_TO_RAD;
      const bearingRad = rng() * Math.PI * 2;

      const sp = Math.sin(parent.decRad);
      const cp = Math.cos(parent.decRad);
      const cd = Math.cos(distRad);
      const sd = Math.sin(distRad);

      const sinDecComp = sp * cd + cp * sd * Math.cos(bearingRad);
      const decCompRad = Math.asin(Math.max(-1, Math.min(1, sinDecComp)));
      const deltaRa = Math.atan2(
        Math.sin(bearingRad) * sd * cp,
        cd - sp * sinDecComp
      );
      const raCompRad = ((parent.raRad + deltaRa) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);

      raDeg = raCompRad * (180 / Math.PI);
      decDeg = decCompRad * (180 / Math.PI);

      // Must not be closer than 0.09° to any star
      if (isTooClose(raDeg, decDeg, 0.09)) continue;

      closeCompanionCount++;
      const mag = Math.min(0.74, parent.mag + 0.12 + rng() * 0.22);
      const tint = SPECTRAL_TINTS[Math.floor(rng() * SPECTRAL_TINTS.length)];
      stars.push({
        raDeg,
        decDeg,
        raRad: raDeg * DEG_TO_RAD,
        decRad: decDeg * DEG_TO_RAD,
        mag,
        tint,
      });
      continue;
    }

    // ~35% biased toward the galactic plane for a realistic starry Milky Way / alien galaxy spine
    if (rng() < 0.35) {
      const theta = rng() * Math.PI * 2;
      const bOffset = (rng() - 0.5) * 16 * DEG_TO_RAD;
      const cu = Math.cos(theta);
      const su = Math.sin(theta);
      const cb = Math.cos(bOffset);
      const sb = Math.sin(bOffset);

      const gx = cu * cb;
      const gy = su * cb;
      const gz = sb;

      const x = co * gx - so * (gy * ci - gz * si);
      const y = so * gx + co * (gy * ci - gz * si);
      const z = gy * si + gz * ci;

      decDeg = Math.asin(Math.max(-1, Math.min(1, z))) * (180 / Math.PI);
      raDeg = ((Math.atan2(y, x) * (180 / Math.PI)) % 360 + 360) % 360;
    } else {
      // Uniform sphere sampling
      raDeg = rng() * 360;
      const z = rng() * 2 - 1;
      decDeg = Math.asin(z) * (180 / Math.PI);
    }

    // Minimum angular separation to prevent accidental duplicate clusters
    if (isTooClose(raDeg, decDeg, 0.65)) continue;

    // Magnitude distribution: ignoring very faint stars (mag <= 0.74)
    const roll = rng();
    let mag: number;
    if (roll < 0.14) {
      mag = 0.08 + rng() * 0.20; // 1st / 2nd mag anchor star
    } else if (roll < 0.48) {
      mag = 0.28 + rng() * 0.24; // 3rd mag star
    } else {
      mag = 0.52 + rng() * 0.22; // 4th / 5th mag star
    }

    const tint = SPECTRAL_TINTS[Math.floor(rng() * SPECTRAL_TINTS.length)];
    stars.push({
      raDeg,
      decDeg,
      raRad: raDeg * DEG_TO_RAD,
      decRad: decDeg * DEG_TO_RAD,
      mag,
      tint,
    });
  }

  return stars;
}
