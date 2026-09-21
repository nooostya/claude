// A flat, pooled particle system. Everything visual and non-gameplay lives
// here: sparks, smoke, blood mist, jet exhaust, shell casings, shockwaves.

import { rand, randInt, clamp, random } from '../core/math.js';

const MAX = 1400;

export class Particles {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX; i++) this.pool.push({ alive: false });
    this.cursor = 0;
  }

  _take() {
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;
      if (!p.alive) return p;
    }
    return this.pool[0]; // all busy: recycle the oldest slot
  }

  spawn(o) {
    const p = this._take();
    p.alive = true;
    p.kind = o.kind || 'spark';
    p.x = o.x; p.y = o.y;
    p.vx = o.vx || 0; p.vy = o.vy || 0;
    p.life = p.maxLife = o.life ?? 0.4;
    p.size = o.size ?? 2;
    p.color = o.color || '#fff';
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0.25;
    p.spin = o.spin ?? 0;
    p.rot = o.rot ?? 0;
    p.glow = o.glow ?? true;
    p.fade = o.fade ?? 1;
    return p;
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.vy += p.gravity * dt;
      const d = Math.pow(p.drag, dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }

  clear() {
    for (const p of this.pool) p.alive = false;
  }

  get active() {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }

  // ---- presets -------------------------------------------------------

  muzzle(x, y, angle, color, scale = 1) {
    this.spawn({
      kind: 'flash', x, y, life: 0.07, size: 14 * scale, color, rot: angle,
    });
    for (let i = 0; i < randInt(3, 5); i++) {
      const a = angle + rand(-0.35, 0.35);
      const s = rand(180, 520) * scale;
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.06, 0.18), size: rand(1.4, 3) * scale, color, drag: 0.02,
      });
    }
  }

  impact(x, y, angle, color = '#ffd9a0', n = 8) {
    for (let i = 0; i < n; i++) {
      const a = angle + Math.PI + rand(-1.0, 1.0);
      const s = rand(80, 420);
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.15, 0.45), size: rand(1, 2.6), color,
        gravity: 900, drag: 0.35,
      });
    }
    this.spawn({ kind: 'ring', x, y, life: 0.16, size: 9, color, glow: true });
  }

  blood(x, y, angle, color = '#ff4d6a', n = 12) {
    for (let i = 0; i < n; i++) {
      const a = angle + rand(-0.8, 0.8);
      const s = rand(60, 340);
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - rand(0, 90),
        life: rand(0.25, 0.6), size: rand(1.5, 3.6), color,
        gravity: 1100, drag: 0.5,
      });
    }
  }

  explosion(x, y, radius, color = '#ff9a4d') {
    const scale = radius / 110;
    this.spawn({ kind: 'blast', x, y, life: 0.34, size: radius, color });
    this.spawn({ kind: 'ring', x, y, life: 0.3, size: radius * 0.75, color: '#fff3c4' });
    for (let i = 0; i < Math.round(26 * scale); i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(120, 700) * scale;
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.2, 0.7), size: rand(2, 5) * scale, color: i % 3 ? color : '#fff0b0',
        gravity: 520, drag: 0.22,
      });
    }
    for (let i = 0; i < Math.round(12 * scale); i++) {
      const a = rand(0, Math.PI * 2);
      this.spawn({
        kind: 'smoke', x: x + Math.cos(a) * rand(0, radius * 0.4),
        y: y + Math.sin(a) * rand(0, radius * 0.4),
        vx: Math.cos(a) * rand(20, 90), vy: rand(-70, -20),
        life: rand(0.5, 1.2), size: rand(10, 24) * scale, color: '#6b5a66',
        drag: 0.4, glow: false,
      });
    }
  }

  jet(x, y, angle, color = '#8fd8ff', power = 1) {
    for (let i = 0; i < 2; i++) {
      const a = angle + rand(-0.22, 0.22);
      const s = rand(140, 330) * power;
      this.spawn({
        x: x + rand(-2, 2), y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.1, 0.26), size: rand(2, 4.5) * power,
        color: random() < 0.4 ? '#ffffff' : color, drag: 0.1,
      });
    }
  }

  trail(x, y, color, size = 2, life = 0.2) {
    this.spawn({ x, y, vx: rand(-14, 14), vy: rand(-14, 14), life, size, color, drag: 0.1 });
  }

  shell(x, y, dir, color = '#e0c070') {
    this.spawn({
      kind: 'shell', x, y, vx: -dir * rand(60, 150), vy: rand(-220, -120),
      life: rand(0.6, 1.1), size: 2.4, color, gravity: 1400, drag: 0.85,
      spin: rand(-22, 22), glow: false,
    });
  }

  spawnBurst(x, y, color) {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const s = rand(160, 300);
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.25, 0.5), size: rand(1.5, 3), color, drag: 0.08,
      });
    }
    this.spawn({ kind: 'ring', x, y, life: 0.4, size: 46, color });
  }

  lightning(x0, y0, x1, y1, color) {
    const segs = clamp(Math.round(Math.hypot(x1 - x0, y1 - y0) / 14), 3, 22);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      this.spawn({
        x: x0 + (x1 - x0) * t + rand(-9, 9),
        y: y0 + (y1 - y0) * t + rand(-9, 9),
        life: rand(0.08, 0.2), size: rand(1.5, 3.4), color, drag: 0.02,
      });
    }
  }
}
