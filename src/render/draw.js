// World renderer: background, terrain, entities, effects. Screen-space UI
// lives in hud.js.

import { TILE } from '../core/config.js';
import { clamp, lerp, mulberry32, TAU } from '../core/math.js';
import { SOLID, PLATFORM } from '../game/maps.js';
import { PICKUP_KINDS } from '../game/entities.js';
import { WEAPONS } from '../game/weapons.js';
import { drawFighterArt, drawWeapon } from './heroart.js';

export class Renderer {
  constructor() {
    this.fx = [];          // transient visuals fed by world events
    this.floaters = [];    // damage numbers
    this.stars = null;
    this.starsFor = null;
    this.time = 0;
  }

  reset() { this.fx = []; this.floaters = []; this.stars = null; this.starsFor = null; }

  // ---- event ingestion ------------------------------------------------
  ingest(events, world) {
    for (const ev of events) {
      switch (ev.type) {
        case 'beam':
          this.fx.push({ kind: 'beam', ...ev, life: ev.life, maxLife: ev.life });
          break;
        case 'explosion':
          this.fx.push({ kind: 'shock', x: ev.x, y: ev.y, r: ev.radius, life: 0.34, maxLife: 0.34 });
          break;
        case 'chain':
          this.fx.push({ kind: 'chain', ...ev, life: 0.18, maxLife: 0.18 });
          break;
        case 'melee': {
          const f = world.fighterById(ev.id);
          this.fx.push({ kind: 'slash', x: ev.x, y: ev.y, angle: ev.angle, life: 0.18, maxLife: 0.18,
            color: f ? f.hero.palette.trim : '#fff' });
          break;
        }
        case 'hit':
          if (ev.byId != null && world.localId === ev.byId) {
            this.floaters.push({ x: ev.x, y: ev.y, v: Math.round(ev.amount), life: 0.8, maxLife: 0.8 });
            this.fx.push({ kind: 'marker', x: ev.x, y: ev.y, life: 0.22, maxLife: 0.22 });
          }
          break;
        case 'blocked':
          this.fx.push({ kind: 'blocked', x: ev.x, y: ev.y, life: 0.3, maxLife: 0.3 });
          break;
      }
    }
  }

  update(dt) {
    this.time += dt;
    for (const f of this.fx) f.life -= dt;
    this.fx = this.fx.filter((f) => f.life > 0);
    for (const f of this.floaters) { f.life -= dt; f.y -= dt * 34; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  // ---- main draw ------------------------------------------------------
  draw(ctx, world, cam, cw, ch) {
    const map = world.map;
    this.drawBackground(ctx, world, cam, cw, ch);

    ctx.save();
    cam.apply(ctx, cw, ch);
    const b = cam.bounds;

    this.drawTerrain(ctx, map, b);
    this.drawPickups(ctx, world, b);
    this.drawProjectiles(ctx, world, b);
    this.drawParticles(ctx, world, b);
    this.drawFighters(ctx, world, b);
    this.drawFx(ctx, b);
    this.drawFloaters(ctx);
    this.drawVignetteEdges(ctx, map);

    ctx.restore();
  }

  // ---- background -----------------------------------------------------
  drawBackground(ctx, world, cam, cw, ch) {
    const th = world.map.theme;
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.55, th.sky[1]);
    g.addColorStop(1, th.sky[2]);
    cam.reset(ctx);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);

    if (!this.stars || this.starsFor !== world.map.id) this.buildStars(world.map);

    // three parallax layers of distant lights
    for (let layer = 0; layer < 3; layer++) {
      const p = 0.12 + layer * 0.14;
      const ox = -cam.x * p, oy = -cam.y * p;
      ctx.save();
      ctx.globalAlpha = 0.25 + layer * 0.2;
      ctx.fillStyle = th.star;
      for (const s of this.stars[layer]) {
        const x = ((s.x + ox) % cw + cw) % cw;
        const y = ((s.y + oy) % ch + ch) % ch;
        const tw = 0.6 + 0.4 * Math.sin(this.time * s.tw + s.p);
        ctx.globalAlpha = (0.2 + layer * 0.18) * tw;
        ctx.fillRect(x, y, s.r, s.r);
      }
      ctx.restore();
    }

    // far skyline silhouettes
    ctx.save();
    const ox = -cam.x * 0.28;
    ctx.fillStyle = th.fog;
    ctx.globalAlpha = 0.34;
    for (const t of this.towers) {
      const x = ((t.x + ox) % (cw + 400) + cw + 400) % (cw + 400) - 200;
      ctx.fillRect(x, ch - t.h, t.w, t.h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = th.edge;
      for (let i = 0; i < t.lights; i++) {
        ctx.fillRect(x + 4 + (i % 3) * 7, ch - t.h + 10 + Math.floor(i / 3) * 14, 3, 4);
      }
      ctx.fillStyle = th.fog;
      ctx.globalAlpha = 0.34;
    }
    ctx.restore();

    // haze fades the skyline's base into the sky so it never competes with
    // the arena geometry drawn on top of it
    const haze = ctx.createLinearGradient(0, ch * 0.2, 0, ch);
    haze.addColorStop(0, 'rgba(0,0,0,0)');
    haze.addColorStop(1, th.sky[2]);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  buildStars(map) {
    const rng = mulberry32(map.id.split('').reduce((a, c) => a + c.charCodeAt(0), 7));
    this.stars = [];
    for (let layer = 0; layer < 3; layer++) {
      const arr = [];
      for (let i = 0; i < 90; i++) {
        arr.push({
          x: rng() * 2200, y: rng() * 1400,
          r: layer === 2 ? 2 : 1 + Math.round(rng()),
          tw: 1 + rng() * 3, p: rng() * TAU,
        });
      }
      this.stars.push(arr);
    }
    this.towers = [];
    for (let i = 0; i < 16; i++) {
      this.towers.push({
        x: rng() * 2400, w: 40 + rng() * 90, h: 120 + rng() * 380,
        lights: 3 + Math.floor(rng() * 9),
      });
    }
    this.starsFor = map.id;
  }

  // ---- terrain --------------------------------------------------------
  drawTerrain(ctx, map, b) {
    const tx0 = clamp(Math.floor(b.x0 / TILE), 0, map.tw - 1);
    const tx1 = clamp(Math.ceil(b.x1 / TILE), 0, map.tw);
    const ty0 = clamp(Math.floor(b.y0 / TILE), 0, map.th - 1);
    const ty1 = clamp(Math.ceil(b.y1 / TILE), 0, map.th);
    const th = map.theme;

    // Bodies. Tiles touching air are lit; buried tiles stay dark, which makes
    // large structures read as one mass instead of a grid of cells.
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        if (map.tileAt(tx, ty) !== SOLID) continue;
        const x = tx * TILE, y = ty * TILE;
        const up = map.tileAt(tx, ty - 1) === SOLID;
        const down = map.tileAt(tx, ty + 1) === SOLID;
        const left = map.tileAt(tx - 1, ty) === SOLID;
        const right = map.tileAt(tx + 1, ty) === SOLID;
        const buried = up && down && left && right;

        ctx.fillStyle = buried ? th.blockDark : th.block;
        ctx.fillRect(x, y, TILE, TILE);

        if (!up) {
          ctx.fillStyle = th.blockLit;
          ctx.fillRect(x, y, TILE, 5);
        }
        if (buried && ((tx + ty) & 1) === 0) {
          // sparse rivets give big masses some texture without gridding them
          ctx.fillStyle = th.block;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x + TILE / 2 - 1.5, y + TILE / 2 - 1.5, 3, 3);
          ctx.globalAlpha = 1;
        }
      }
    }

    // exposed edges get a lit rim; this is what sells the neon look
    ctx.lineWidth = 2;
    ctx.strokeStyle = th.edge;
    ctx.shadowColor = th.edge;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        if (map.tileAt(tx, ty) !== SOLID) continue;
        const x = tx * TILE, y = ty * TILE;
        if (map.tileAt(tx, ty - 1) !== SOLID) { ctx.moveTo(x, y + 1); ctx.lineTo(x + TILE, y + 1); }
        if (map.tileAt(tx, ty + 1) !== SOLID) { ctx.moveTo(x, y + TILE - 1); ctx.lineTo(x + TILE, y + TILE - 1); }
        if (map.tileAt(tx - 1, ty) !== SOLID) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + TILE); }
        if (map.tileAt(tx + 1, ty) !== SOLID) { ctx.moveTo(x + TILE - 1, y); ctx.lineTo(x + TILE - 1, y + TILE); }
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // one-way platforms
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        if (map.tileAt(tx, ty) !== PLATFORM) continue;
        const x = tx * TILE, y = ty * TILE;
        ctx.fillStyle = th.blockLit;
        ctx.fillRect(x, y + 2, TILE, 7);
        ctx.fillStyle = th.accent;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(x, y + 2, TILE, 2);
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x + 6, y + 9, TILE - 12, 3);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---- entities -------------------------------------------------------
  drawPickups(ctx, world, b) {
    for (const p of world.pickups) {
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
      const meta = PICKUP_KINDS[p.kind];
      const bob = Math.sin(p.bob) * 3;

      if (!p.active) {
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.strokeRect(p.x - 12, p.y - 12 + bob, 24, 24);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y + bob);
      ctx.shadowColor = meta.color;
      ctx.shadowBlur = 14;

      ctx.fillStyle = 'rgba(12,16,30,0.85)';
      ctx.beginPath(); ctx.roundRect(-14, -14, 28, 28, 6); ctx.fill();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-14, -14, 28, 28, 6); ctx.stroke();
      ctx.shadowBlur = 0;

      if (p.kind === 'weapon') {
        ctx.save();
        ctx.scale(0.52, 0.52); ctx.translate(-6, 0);
        drawWeapon(ctx, p.weaponId, { accent: meta.color, metal: '#6a7490' }, this.time);
        ctx.restore();
      } else if (p.kind === 'health') {
        ctx.fillStyle = meta.color;
        ctx.fillRect(-3, -9, 6, 18);
        ctx.fillRect(-9, -3, 18, 6);
      } else if (p.kind === 'ammo') {
        ctx.fillStyle = meta.color;
        for (let i = 0; i < 3; i++) ctx.fillRect(-8 + i * 6, -7, 4, 14);
      } else {
        ctx.fillStyle = meta.color;
        ctx.beginPath(); ctx.arc(0, 1, 7, 0, TAU); ctx.fill();
        ctx.fillRect(-2, -10, 4, 4);
      }

      // rotating containment ring
      ctx.strokeStyle = meta.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, 19, p.spin, p.spin + 1.6);
      ctx.arc(0, 0, 19, p.spin + Math.PI, p.spin + Math.PI + 1.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  drawProjectiles(ctx, world, b) {
    for (const p of world.projectiles) {
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
      ctx.save();
      ctx.translate(p.x, p.y);

      if (p.type === 'grenade') {
        ctx.rotate(p.spin);
        ctx.shadowColor = '#ff9a4d'; ctx.shadowBlur = 10;
        ctx.fillStyle = '#3c4250';
        ctx.beginPath(); ctx.roundRect(-5, -6, 10, 12, 4); ctx.fill();
        ctx.fillStyle = (p.fuse % 0.25) < 0.12 ? '#ff4d4d' : '#ffb02e';
        ctx.fillRect(-2, -8, 4, 3);
        ctx.restore();
        continue;
      }

      ctx.rotate(p.rot);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      if (p.type === 'rocket') {
        ctx.fillStyle = '#d9e2f5';
        ctx.beginPath(); ctx.roundRect(-9, -3, 18, 6, 3); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(3, -4); ctx.lineTo(3, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffd27a';
        ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(-19, 0); ctx.lineTo(-9, 3); ctx.closePath(); ctx.fill();
      } else if (p.type === 'plasma') {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(0, 0, 9, 4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(1, 0, 4, 1.8, 0, 0, TAU); ctx.fill();
      } else {
        const grad = ctx.createLinearGradient(-p.tracer, 0, 3, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, p.color);
        ctx.fillStyle = grad;
        ctx.fillRect(-p.tracer, -p.width / 2, p.tracer + 3, p.width);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, -p.width / 2 + 0.4, 3, p.width - 0.8);
      }
      ctx.restore();
    }
  }

  drawParticles(ctx, world, b) {
    ctx.save();
    for (const p of world.particles.pool) {
      if (!p.alive) continue;
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
      const k = p.life / p.maxLife;
      ctx.globalAlpha = clamp(k * p.fade, 0, 1);

      switch (p.kind) {
        case 'ring':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - k), 0, TAU); ctx.stroke();
          break;
        case 'blast': {
          const r = p.size * (1.15 - k * 0.9);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, 'rgba(255,255,230,' + (0.9 * k).toFixed(3) + ')');
          g.addColorStop(0.45, p.color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
          break;
        }
        case 'smoke':
          ctx.globalAlpha = k * 0.34;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.7 - k), 0, TAU); ctx.fill();
          break;
        case 'flash':
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(p.size, -p.size * 0.42);
          ctx.lineTo(p.size * 1.5, 0); ctx.lineTo(p.size, p.size * 0.42);
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        case 'shell':
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-2, -1, 4, 2);
          ctx.restore();
          break;
        default:
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.restore();
  }

  drawFighters(ctx, world, b) {
    for (const f of world.fighters) {
      if (!f.alive) continue;
      if (f.x < b.x0 - 60 || f.x > b.x1 + 60 || f.y < b.y0 - 60 || f.y > b.y1 + 60) continue;

      ctx.save();
      ctx.translate(f.x, f.y);

      if (f.spawnProtect > 0) {
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(this.time * 18);
        ctx.strokeStyle = '#9ecbff';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0, -4, 23, 0, TAU); ctx.stroke();
      }
      if (f.anim.hurt > 0) {
        ctx.shadowColor = '#ff3b5c';
        ctx.shadowBlur = 18 * f.anim.hurt;
      }

      drawFighterArt(ctx, {
        hero: f.hero,
        facing: f.facing,
        aimAngle: f.aimAngle,
        anim: f.anim,
        vx: f.vx,
        onGround: f.onGround,
        thrusting: f.thrusting,
        alive: f.alive,
        cloak: f.isLocal ? Math.min(f.cloak, 0.72) : f.cloak,
        shielded: f.shielded,
        abilityId: f.ability.def.id,
        abilityActive: f.ability.active > 0,
        weaponId: f.weaponId,
        invuln: f.invuln,
        time: this.time,
        scale: 1,
      });
      ctx.restore();

      this.drawNameplate(ctx, f, world);
    }
  }

  drawNameplate(ctx, f, world) {
    if (f.isLocal || f.cloak > 0.5) return;
    const y = f.y - 34;
    const w = 40;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(8,10,20,0.6)';
    ctx.fillRect(f.x - w / 2, y, w, 4);
    const frac = clamp(f.health / f.maxHealth, 0, 1);
    ctx.fillStyle = f.isBot ? '#ff6a6a' : '#5ee08a';
    ctx.fillRect(f.x - w / 2 + 1, y + 1, (w - 2) * frac, 2);
    ctx.globalAlpha = 0.75;
    ctx.font = '600 9px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = f.hero.palette.trim;
    ctx.fillText(f.name, f.x, y - 4);
    ctx.restore();
  }

  drawFx(ctx, b) {
    for (const f of this.fx) {
      const k = f.life / f.maxLife;
      ctx.save();
      switch (f.kind) {
        case 'beam': {
          ctx.globalAlpha = k;
          ctx.shadowColor = f.color; ctx.shadowBlur = 20;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = f.width * (0.4 + k);
          ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = f.width * 0.35 * k;
          ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.stroke();
          break;
        }
        case 'chain':
          ctx.globalAlpha = k;
          ctx.strokeStyle = '#9ee6ff';
          ctx.shadowColor = '#9ee6ff'; ctx.shadowBlur = 14;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.stroke();
          break;
        case 'shock':
          ctx.globalAlpha = k * 0.7;
          ctx.strokeStyle = '#ffe6a8';
          ctx.lineWidth = 3 * k;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.25 - k), 0, TAU); ctx.stroke();
          break;
        case 'slash': {
          ctx.globalAlpha = k;
          ctx.translate(f.x, f.y); ctx.rotate(f.angle);
          ctx.strokeStyle = f.color;
          ctx.shadowColor = f.color; ctx.shadowBlur = 12;
          ctx.lineWidth = 3 * k + 1;
          ctx.beginPath(); ctx.arc(-16, 0, 30, -0.8, 0.8); ctx.stroke();
          break;
        }
        case 'marker': {
          ctx.globalAlpha = k;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          const r = 8 + (1 - k) * 5;
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            ctx.beginPath();
            ctx.moveTo(f.x + sx * r, f.y + sy * r);
            ctx.lineTo(f.x + sx * (r + 5), f.y + sy * (r + 5));
            ctx.stroke();
          }
          break;
        }
        case 'blocked':
          ctx.globalAlpha = k;
          ctx.strokeStyle = '#9ecbff';
          ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.arc(f.x, f.y - 4, 24 * (1.3 - k), 0, TAU); ctx.stroke();
          break;
      }
      ctx.restore();
    }
  }

  drawFloaters(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      const k = f.life / f.maxLife;
      ctx.globalAlpha = clamp(k * 1.4, 0, 1);
      ctx.font = `700 ${13 + (1 - k) * 4}px "Rajdhani", system-ui, sans-serif`;
      ctx.fillStyle = '#fff1b8';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeText(f.v, f.x, f.y);
      ctx.fillText(f.v, f.x, f.y);
    }
    ctx.restore();
  }

  /** Dim anything outside the arena so the borders read as solid. */
  drawVignetteEdges(ctx, map) {
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,14,0.85)';
    const pad = 4000;
    ctx.fillRect(-pad, -pad, pad, map.height + pad * 2);
    ctx.fillRect(map.width, -pad, pad, map.height + pad * 2);
    ctx.fillRect(-pad, -pad, map.width + pad * 2, pad);
    ctx.fillRect(-pad, map.height, map.width + pad * 2, pad);
    ctx.restore();
  }
}
