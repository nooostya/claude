// Small math/util helpers shared by every subsystem.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** Frame-rate independent exponential approach. `rate` = fraction remaining after 1s. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.pow(rate, dt));

// ---------------------------------------------------------------------------
// Randomness
//
// Gameplay randomness goes through `random()` rather than Math.random directly,
// so a run can be made reproducible from a seed (used by the Parlor
// integration). Unseeded, it is Math.random and the game behaves as before.
// ---------------------------------------------------------------------------

let _random = Math.random;
let _seed = null;

/** Make every subsequent gameplay roll reproducible from `seed`. */
export function setSeed(seed) {
  _seed = seed >>> 0;
  _random = mulberry32(_seed);
}

/** Go back to unseeded randomness. */
export function clearSeed() {
  _seed = null;
  _random = Math.random;
}

export const currentSeed = () => _seed;
export const random = () => _random();

export const rand = (a = 1, b) => (b === undefined ? random() * a : a + random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(random() * arr.length) | 0];
export const chance = (p) => random() < p;

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Shortest signed delta between two angles. */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function angleApproach(from, to, maxStep) {
  const d = angleDelta(from, to);
  return from + clamp(d, -maxStep, maxStep);
}

/** Axis-aligned box overlap. Boxes are centre + half-extents. */
export function overlaps(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
  return Math.abs(ax - bx) < ahw + bhw && Math.abs(ay - by) < ahh + bhh;
}

/** Does segment a->b intersect the centred AABB? Slab method. */
export function segmentHitsBox(x0, y0, x1, y1, bx, by, hw, hh) {
  const dx = x1 - x0, dy = y1 - y0;
  let tMin = 0, tMax = 1;
  for (const [p, d, lo, hi] of [
    [x0, dx, bx - hw, bx + hw],
    [y0, dy, by - hh, by + hh],
  ]) {
    if (Math.abs(d) < 1e-8) {
      if (p < lo || p > hi) return false;
    } else {
      let t1 = (lo - p) / d, t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}

/** Deterministic 32-bit PRNG so client and server can agree on layouts. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
