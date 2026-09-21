// Arenas are authored as rectangles and rasterised into a tile grid.
// Tile values: 0 = air, 1 = solid, 2 = one-way platform (drop through with S).

import { TILE } from '../core/config.js';

export const EMPTY = 0, SOLID = 1, PLATFORM = 2;

const MAPS = [
  {
    id: 'foundry',
    name: 'Skyfall Foundry',
    subtitle: 'Industrial · 3 tiers',
    w: 84, h: 38,
    theme: {
      sky: ['#131a2e', '#1d2440', '#2b2340'],
      fog: '#2a3254', grid: '#2f3a63',
      block: '#39456f', blockLit: '#4d5c8f', blockDark: '#222a48',
      edge: '#6fa8ff', accent: '#ff7ad0', star: '#8fb6ff',
    },
    // [x, y, w, h] in tiles
    solid: [
      [0, 0, 84, 2], [0, 36, 84, 2], [0, 0, 2, 38], [82, 0, 2, 38],
      // ground bumps
      [2, 33, 12, 3], [70, 33, 12, 3],
      [20, 34, 44, 2],
      // central foundry tower
      [38, 20, 8, 14], [36, 20, 12, 2],
      [40, 12, 4, 8], [37, 10, 10, 2],
      // side pylons
      [10, 24, 8, 3], [66, 24, 8, 3],
      [6, 14, 6, 2], [72, 14, 6, 2],
      // upper catwalk anchors
      [18, 8, 5, 2], [61, 8, 5, 2],
      // low cover
      [26, 31, 3, 3], [55, 31, 3, 3],
      [16, 30, 2, 4], [66, 30, 2, 4],
    ],
    platforms: [
      [4, 28, 10], [70, 28, 10],
      [20, 27, 9], [55, 27, 9],
      [30, 24, 8], [46, 24, 8],
      [12, 19, 10], [62, 19, 10],
      [24, 15, 10], [50, 15, 10],
      [34, 7, 16],
      [4, 9, 8], [72, 9, 8],
      [28, 30, 6], [50, 30, 6],
    ],
    spawns: [
      [6, 31], [78, 31], [44, 9], [8, 26], [76, 26],
      [26, 13], [58, 13], [42, 5], [14, 17], [70, 17],
      [33, 28], [51, 28],
    ],
    crates: [[42, 5], [8, 7], [76, 7], [27, 13], [57, 13], [33, 23], [13, 23], [69, 23]],
    health: [[6, 26], [78, 26], [42, 9], [31, 22], [53, 22]],
  },
  {
    id: 'orbital',
    name: 'Orbital Yard',
    subtitle: 'Open sky · vertical',
    w: 76, h: 44,
    theme: {
      sky: ['#0a1026', '#141c3c', '#241a3e'],
      fog: '#1d2647', grid: '#27345f',
      block: '#2e3a63', blockLit: '#44548a', blockDark: '#1b2340',
      edge: '#7ce0ff', accent: '#ffd166', star: '#bcd8ff',
    },
    solid: [
      [0, 0, 76, 2], [0, 42, 76, 2], [0, 0, 2, 44], [74, 0, 2, 44],
      [2, 39, 18, 3], [56, 39, 18, 3],
      [30, 40, 16, 2],
      // floating slabs
      [8, 32, 12, 2], [56, 32, 12, 2],
      [30, 34, 16, 2], [34, 36, 8, 2],
      [20, 26, 10, 2], [46, 26, 10, 2],
      [4, 20, 10, 2], [62, 20, 10, 2],
      [32, 19, 12, 2], [36, 21, 4, 4],
      [16, 13, 12, 2], [48, 13, 12, 2],
      [30, 7, 16, 2],
      [2, 28, 4, 2], [70, 28, 4, 2],
    ],
    platforms: [
      [22, 30, 8], [46, 30, 8],
      [10, 27, 8], [58, 27, 8],
      [28, 23, 6], [42, 23, 6],
      [16, 17, 9], [51, 17, 9],
      [6, 12, 8], [62, 12, 8],
      [24, 10, 8], [44, 10, 8],
      [34, 4, 8],
      [4, 35, 8], [64, 35, 8],
    ],
    spawns: [
      [6, 37], [70, 37], [37, 33], [12, 30], [62, 30],
      [24, 24], [50, 24], [8, 18], [66, 18], [37, 17],
      [20, 11], [54, 11], [37, 5],
    ],
    crates: [[37, 5], [10, 10], [64, 10], [22, 21], [51, 21], [37, 32], [5, 26], [69, 26]],
    health: [[6, 33], [68, 33], [37, 12], [26, 28], [48, 28]],
  },
  {
    id: 'undercity',
    name: 'Undercity',
    subtitle: 'Close quarters · brutal',
    w: 68, h: 30,
    theme: {
      sky: ['#1a0f1e', '#2a1426', '#1b1030'],
      fog: '#33193a', grid: '#432452',
      block: '#4a2a52', blockLit: '#653a70', blockDark: '#2c1732',
      edge: '#ff6ad5', accent: '#7ce0ff', star: '#ffa8e8',
    },
    solid: [
      [0, 0, 68, 2], [0, 28, 68, 2], [0, 0, 2, 30], [66, 0, 2, 30],
      // pillars
      [12, 18, 4, 10], [52, 18, 4, 10],
      [24, 20, 4, 8], [40, 20, 4, 8],
      [32, 24, 4, 4],
      // mid deck
      [8, 15, 14, 2], [46, 15, 14, 2],
      [28, 13, 12, 2],
      // upper ribs
      [4, 8, 10, 2], [54, 8, 10, 2],
      [22, 7, 8, 2], [38, 7, 8, 2],
      [30, 4, 8, 2],
      // floor teeth
      [18, 26, 3, 2], [47, 26, 3, 2],
    ],
    platforms: [
      [4, 23, 7], [57, 23, 7],
      [17, 22, 6], [45, 22, 6],
      [29, 18, 10],
      [14, 12, 8], [46, 12, 8],
      [24, 10, 6], [38, 10, 6],
      [4, 5, 8], [56, 5, 8],
      [30, 25, 4],
    ],
    spawns: [
      [5, 26], [62, 26], [34, 22], [9, 21], [58, 21],
      [20, 14], [47, 14], [6, 12], [61, 12], [34, 16],
      [26, 6], [41, 6], [34, 3],
    ],
    crates: [[34, 3], [7, 6], [60, 6], [20, 20], [47, 20], [34, 11]],
    health: [[5, 20], [62, 20], [34, 17], [17, 25], [50, 25]],
  },
];

function rasterize(def) {
  const grid = Array.from({ length: def.h }, () => new Uint8Array(def.w));
  for (const [x, y, w, h] of def.solid) {
    for (let ty = y; ty < y + h; ty++) {
      if (ty < 0 || ty >= def.h) continue;
      for (let tx = x; tx < x + w; tx++) {
        if (tx < 0 || tx >= def.w) continue;
        grid[ty][tx] = SOLID;
      }
    }
  }
  for (const [x, y, w] of def.platforms) {
    for (let tx = x; tx < x + w; tx++) {
      if (tx < 0 || tx >= def.w) continue;
      if (grid[y][tx] === EMPTY) grid[y][tx] = PLATFORM;
    }
  }
  return grid;
}

const toWorld = (pts) => pts.map(([x, y]) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }));

export class GameMap {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.subtitle = def.subtitle;
    this.theme = def.theme;
    this.tw = def.w;
    this.th = def.h;
    this.width = def.w * TILE;
    this.height = def.h * TILE;
    this.grid = rasterize(def);
    this.spawns = toWorld(def.spawns);
    this.crateSpots = toWorld(def.crates);
    this.healthSpots = toWorld(def.health);
  }

  tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.tw || ty >= this.th) return SOLID;
    return this.grid[ty][tx];
  }

  isSolid(tx, ty) {
    return this.tileAt(tx, ty) === SOLID;
  }

  /** Solid at a world point (ignores one-way platforms). */
  solidAtPoint(x, y) {
    return this.isSolid(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  /** True if any solid tile blocks the straight line between two world points. */
  lineBlocked(x0, y0, x1, y1, step = TILE * 0.45) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAtPoint(x0 + dx * t, y0 + dy * t)) return true;
    }
    return false;
  }

  /** Nearest ground surface Y below a world point, or map floor. */
  groundBelow(x, y) {
    const tx = Math.floor(x / TILE);
    for (let ty = Math.floor(y / TILE); ty < this.th; ty++) {
      if (this.tileAt(tx, ty) !== EMPTY) return ty * TILE;
    }
    return this.height;
  }
}

export const MAP_DEFS = MAPS;
export const buildMap = (id) => new GameMap(MAPS.find((m) => m.id === id) || MAPS[0]);
export const mapList = () => MAPS.map((m) => ({ id: m.id, name: m.name, subtitle: m.subtitle }));
