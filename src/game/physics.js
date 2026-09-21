// Tile collision. Bodies are centre-anchored AABBs; X and Y are resolved
// separately so a body slides along walls instead of catching on corners.

import { TILE } from '../core/config.js';
import { SOLID, PLATFORM } from './maps.js';

const EPS = 0.001;

function tileRange(lo, hi) {
  return [Math.floor(lo / TILE), Math.floor((hi - EPS) / TILE)];
}

/**
 * Integrate a body against the map for one step.
 * body: { x, y, vx, vy, hw, hh, onGround, onWall, dropThrough }
 * Returns a summary of what it touched this step.
 */
export function moveBody(body, map, dt) {
  const hit = { left: false, right: false, up: false, down: false, landedAt: 0 };
  const prevBottom = body.y + body.hh;

  // ---- horizontal ----
  body.x += body.vx * dt;
  if (body.vx !== 0) {
    const [ty0, ty1] = tileRange(body.y - body.hh, body.y + body.hh);
    if (body.vx > 0) {
      const tx = Math.floor((body.x + body.hw - EPS) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (map.tileAt(tx, ty) === SOLID) {
          body.x = tx * TILE - body.hw - EPS;
          body.vx = 0; hit.right = true;
          break;
        }
      }
    } else {
      const tx = Math.floor((body.x - body.hw) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (map.tileAt(tx, ty) === SOLID) {
          body.x = (tx + 1) * TILE + body.hw + EPS;
          body.vx = 0; hit.left = true;
          break;
        }
      }
    }
  }

  // ---- vertical ----
  body.y += body.vy * dt;
  const [tx0, tx1] = tileRange(body.x - body.hw, body.x + body.hw);
  if (body.vy > 0) {
    const ty = Math.floor((body.y + body.hh - EPS) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = map.tileAt(tx, ty);
      const solid = t === SOLID;
      // One-way platforms only stop a body that was fully above them and is
      // not deliberately dropping through.
      const oneWay = t === PLATFORM && !body.dropThrough && prevBottom <= ty * TILE + 1;
      if (solid || oneWay) {
        body.y = ty * TILE - body.hh - EPS;
        hit.down = true;
        hit.landedAt = body.vy;
        body.vy = 0;
        break;
      }
    }
  } else if (body.vy < 0) {
    const ty = Math.floor((body.y - body.hh) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (map.tileAt(tx, ty) === SOLID) {
        body.y = (ty + 1) * TILE + body.hh + EPS;
        body.vy = 0; hit.up = true;
        break;
      }
    }
  }

  body.onGround = hit.down;
  body.onWall = hit.left ? -1 : hit.right ? 1 : 0;
  return hit;
}

/** Push a body out of any solid tile it is already overlapping (post-teleport). */
export function unstick(body, map) {
  if (!overlapsSolid(body, map)) return true;
  for (let r = 1; r <= 6; r++) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const nx = body.x + dx * r * TILE * 0.5;
      const ny = body.y + dy * r * TILE * 0.5;
      const probe = { ...body, x: nx, y: ny };
      if (!overlapsSolid(probe, map)) {
        body.x = nx; body.y = ny;
        return true;
      }
    }
  }
  return false;
}

export function overlapsSolid(body, map) {
  const [tx0, tx1] = tileRange(body.x - body.hw, body.x + body.hw);
  const [ty0, ty1] = tileRange(body.y - body.hh, body.y + body.hh);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (map.tileAt(tx, ty) === SOLID) return true;
    }
  }
  return false;
}

/**
 * March a point along a ray, stopping at the first solid tile.
 * Returns { x, y, hit } where x,y is the impact (or ray end).
 */
export function raycast(map, x0, y0, dx, dy, maxDist, step = 6) {
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;
  let travelled = 0;
  let px = x0, py = y0;
  while (travelled < maxDist) {
    const next = Math.min(step, maxDist - travelled);
    const cx = px + nx * next, cy = py + ny * next;
    if (map.solidAtPoint(cx, cy)) return { x: px, y: py, hit: true, dist: travelled };
    px = cx; py = cy;
    travelled += next;
  }
  return { x: px, y: py, hit: false, dist: travelled };
}
