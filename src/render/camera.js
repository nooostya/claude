import { RENDER } from '../core/config.js';
import { clamp, damp, rand } from '../core/math.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.zoom = 1;
    this.shake = 0;
    this.ox = 0; this.oy = 0;   // shake offset
    this.viewW = RENDER.baseWidth;
    this.viewH = RENDER.baseHeight;
    this.dpr = 1;
    this.snapNext = true;
  }

  resize(cw, ch, dpr = 1) {
    this.dpr = dpr;
    this.zoom = clamp(Math.min(cw / RENDER.baseWidth, ch / RENDER.baseHeight), RENDER.minZoom, RENDER.maxZoom);
    this.viewW = cw / this.zoom;
    this.viewH = ch / this.zoom;
  }

  /** Follow a fighter, biased slightly toward where they are aiming. */
  follow(target, map, dt, aimBias = null) {
    if (!target) return;
    let tx = target.x, ty = target.y - 18;
    if (aimBias) {
      tx += clamp(aimBias.x - target.x, -260, 260) * 0.22;
      ty += clamp(aimBias.y - target.y, -200, 200) * 0.18;
    }
    tx += clamp(target.vx * 0.16, -90, 90);
    ty += clamp(target.vy * 0.1, -80, 80);

    if (this.snapNext) { this.x = tx; this.y = ty; this.snapNext = false; }
    else {
      this.x = damp(this.x, tx, RENDER.cameraLag, dt);
      this.y = damp(this.y, ty, RENDER.cameraLag, dt);
    }
    this.clamp(map);
  }

  clamp(map) {
    const hw = this.viewW / 2, hh = this.viewH / 2;
    this.x = map.width <= this.viewW ? map.width / 2 : clamp(this.x, hw, map.width - hw);
    this.y = map.height <= this.viewH ? map.height / 2 : clamp(this.y, hh, map.height - hh);
  }

  update(dt, shakeAmount) {
    this.shake = Math.max(this.shake, shakeAmount);
    this.shake = damp(this.shake, 0, RENDER.shakeDecay, dt);
    if (this.shake > 0.2) {
      const s = Math.min(RENDER.maxShake, this.shake);
      this.ox = rand(-s, s);
      this.oy = rand(-s, s);
    } else { this.ox = 0; this.oy = 0; }
  }

  /** Reset to CSS-pixel space: 1 unit = 1 CSS pixel, origin top-left. */
  reset(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Switch to world space. */
  apply(ctx, cw, ch) {
    const k = this.zoom * this.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.translate(cw / (2 * this.zoom) - this.x + this.ox, ch / (2 * this.zoom) - this.y + this.oy);
  }

  screenToWorld(sx, sy, cw, ch) {
    return {
      x: (sx - cw / 2) / this.zoom + this.x - this.ox,
      y: (sy - ch / 2) / this.zoom + this.y - this.oy,
    };
  }

  worldToScreen(wx, wy, cw, ch) {
    return {
      x: (wx - this.x + this.ox) * this.zoom + cw / 2,
      y: (wy - this.y + this.oy) * this.zoom + ch / 2,
    };
  }

  get bounds() {
    return {
      x0: this.x - this.viewW / 2 - 64, x1: this.x + this.viewW / 2 + 64,
      y0: this.y - this.viewH / 2 - 64, y1: this.y + this.viewH / 2 + 64,
    };
  }
}
