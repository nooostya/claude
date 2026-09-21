// Screen-space HUD. Drawn with the canvas transform reset, in CSS pixels.

import { clamp, formatTime, TAU } from '../core/math.js';
import { WEAPONS } from '../game/weapons.js';
import { COMBAT, MATCH } from '../core/config.js';
import { SOLID } from '../game/maps.js';
import { drawWeapon } from './heroart.js';

const FONT = '"Rajdhani", "Segoe UI", system-ui, sans-serif';
const panel = (ctx, x, y, w, h, r = 8, fill = 'rgba(9,12,24,0.66)') => {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
};

export class Hud {
  constructor() {
    this.showScoreboard = false;
    this.time = 0;
    this.toast = null;
    this.hitFlash = 0;
    this.killPop = 0;
    this.killPopText = '';
  }

  setToast(text, life = 2.2) { this.toast = { text, life, maxLife: life }; }

  ingest(events, world) {
    for (const ev of events) {
      if (ev.type === 'hit' && ev.local) this.hitFlash = 1;
      if (ev.type === 'kill') {
        if (ev.killerId === world.localId && ev.victimId !== world.localId) {
          this.killPop = 1.1;
          this.killPopText = ev.streak >= 5 ? `${ev.streak} KILL STREAK` : 'ELIMINATED';
        }
      }
      if (ev.type === 'pickup' && ev.local) {
        const label = ev.kind === 'weapon' ? WEAPONS[ev.weaponId].name : ev.kind.toUpperCase();
        this.setToast(`PICKED UP  ${label}`, 1.6);
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.2);
    this.killPop = Math.max(0, this.killPop - dt);
    if (this.toast) {
      this.toast.life -= dt;
      if (this.toast.life <= 0) this.toast = null;
    }
  }

  draw(ctx, world, cam, cw, ch, opts = {}) {
    const me = world.localFighter;
    cam.reset(ctx);
    ctx.textBaseline = 'alphabetic';

    if (this.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,40,70,${0.22 * this.hitFlash})`;
      ctx.fillRect(0, 0, cw, ch);
    }
    if (me && me.alive && me.health < me.maxHealth * 0.3) {
      const p = 0.12 + 0.08 * Math.sin(this.time * 6);
      const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.62);
      g.addColorStop(0, 'rgba(255,0,40,0)');
      g.addColorStop(1, `rgba(255,0,40,${p})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }

    this.drawOffscreenMarkers(ctx, world, cam, cw, ch);
    if (me) this.drawCrosshair(ctx, me, opts.pointer, cw, ch);
    this.drawTopBar(ctx, world, cw);
    if (me) this.drawPlayerPanel(ctx, me, cw, ch);
    this.drawKillFeed(ctx, world, cw);
    this.drawMinimap(ctx, world, cw, ch);
    if (me && !me.alive) this.drawRespawn(ctx, me, world, cw, ch);
    this.drawToast(ctx, cw, ch);
    this.drawKillPop(ctx, cw, ch);
    if (this.showScoreboard || world.over) this.drawScoreboard(ctx, world, cw, ch);
    if (opts.netStatus) this.drawNetStatus(ctx, opts.netStatus, cw);
  }

  // ---- crosshair ------------------------------------------------------
  drawCrosshair(ctx, me, pointer, cw, ch) {
    if (!pointer) return;
    const w = me.weapon;
    const spread = (w.spread || 0) + (w.spreadGrow ? Math.min(w.spreadMax, me.heat * w.spreadMax) : 0);
    const r = 7 + spread * 260 + me.heat * 4;
    const x = pointer.x, y = pointer.y;
    ctx.save();
    ctx.strokeStyle = me.alive ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * r, y + dy * r);
      ctx.lineTo(x + dx * (r + 7), y + dy * (r + 7));
      ctx.stroke();
    }
    ctx.fillStyle = me.hero.palette.accent;
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---- top bar --------------------------------------------------------
  drawTopBar(ctx, world, cw) {
    const w = 260, h = 44, x = cw / 2 - w / 2, y = 10;
    panel(ctx, x, y, w, h, 10);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7ce0ff';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(formatTime(world.timeLeft), cw / 2, y + 28);
    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = 'rgba(180,200,235,0.7)';
    ctx.fillText(`FIRST TO ${world.scoreLimit}`, cw / 2, y + 38);

    const ranked = world.fighters.slice().sort((a, b) => b.kills - a.kills);
    const me = world.localFighter;
    const leader = ranked[0];
    ctx.textAlign = 'right';
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = '#ffd166';
    if (leader) ctx.fillText(`${leader.name} ${leader.kills}`, x - 14, y + 28);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9ee6ff';
    if (me) ctx.fillText(`YOU ${me.kills}`, x + w + 14, y + 28);
  }

  // ---- bottom-left player panel --------------------------------------
  drawPlayerPanel(ctx, me, cw, ch) {
    const x = 18, y = ch - 104, w = 292, h = 86;
    panel(ctx, x, y, w, h, 12);

    // hero chip
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x + 8, y + 8, 56, 70, 8); ctx.clip();
    ctx.fillStyle = me.hero.palette.suitDark;
    ctx.fillRect(x + 8, y + 8, 56, 70);
    ctx.fillStyle = me.hero.palette.accent;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x + 8, y + 8, 56, 70);
    ctx.restore();
    ctx.strokeStyle = me.hero.palette.accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.roundRect(x + 8, y + 8, 56, 70, 8); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = me.hero.palette.trim;
    ctx.fillText(me.hero.name, x + 36, y + 26);
    ctx.font = `600 8px ${FONT}`;
    ctx.fillStyle = 'rgba(200,215,240,0.6)';
    ctx.fillText(me.hero.title.toUpperCase(), x + 36, y + 37);

    // ability ring
    const ab = me.ability;
    const cx = x + 36, cy = y + 58, r = 13;
    const ready = ab.cooldown <= 0;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 4; ctx.stroke();
    if (!ready) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - ab.cooldown / ab.def.cooldown));
      ctx.strokeStyle = me.hero.palette.accent; ctx.lineWidth = 4; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = me.hero.palette.accent;
      ctx.shadowColor = me.hero.palette.glow;
      ctx.shadowBlur = 8 + 4 * Math.sin(this.time * 6);
      ctx.lineWidth = 4; ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.font = `700 10px ${FONT}`;
    ctx.fillStyle = ready ? '#ffffff' : 'rgba(210,225,250,0.55)';
    ctx.fillText(ready ? 'Q' : Math.ceil(ab.cooldown), cx, cy + 3.5);

    // health + fuel bars
    const bx = x + 74, bw = w - 86;
    this.bar(ctx, bx, y + 12, bw, 13, me.health / me.maxHealth, '#ff4d6a', '#ff96ab',
      `${Math.max(0, Math.ceil(me.health))}`, 'HP');
    this.bar(ctx, bx, y + 31, bw, 9, me.fuel, '#4dc4ff', '#a8ecff', '', 'FUEL',
      me.fuel < 0.15 ? 0.4 + 0.6 * Math.abs(Math.sin(this.time * 9)) : 1);

    // weapon
    const a = me.ammo;
    const wd = WEAPONS[a.id];
    ctx.textAlign = 'left';
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = '#e8f1ff';
    ctx.fillText(wd.name, bx, y + 60);
    ctx.textAlign = 'right';
    ctx.font = `700 19px ${FONT}`;
    ctx.fillStyle = a.mag === 0 ? '#ff5f6a' : '#ffd166';
    const reserve = a.reserve === Infinity ? '∞' : a.reserve;
    ctx.fillText(`${a.mag}`, x + w - 46, y + 62);
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = 'rgba(200,215,240,0.6)';
    ctx.fillText(`/ ${reserve}`, x + w - 12, y + 62);

    if (a.reloading > 0) {
      const p = 1 - a.reloading / wd.reload;
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(bx, y + 66, bw, 4);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(bx, y + 66, bw * p, 4);
      ctx.textAlign = 'left';
      ctx.font = `700 10px ${FONT}`;
      ctx.fillText('RELOADING', bx, y + 80);
    } else {
      ctx.textAlign = 'left';
      ctx.font = `600 10px ${FONT}`;
      ctx.fillStyle = 'rgba(200,215,240,0.5)';
      const other = me.activeSlot === 'primary' ? WEAPONS[me.slots.sidearm.id].short
        : me.slots.primary ? WEAPONS[me.slots.primary.id].short : '—';
      ctx.fillText(`[E] ${other}`, bx, y + 78);
    }

    // grenades
    ctx.textAlign = 'right';
    for (let i = 0; i < COMBAT.grenadeMaxAmmo; i++) {
      ctx.fillStyle = i < me.grenades ? '#ff9a4d' : 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(x + w - 14 - i * 12, y + 76, 4, 0, TAU);
      ctx.fill();
    }
  }

  bar(ctx, x, y, w, h, frac, color, lightColor, text, label, alpha = 1) {
    frac = clamp(frac, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, color);
    g.addColorStop(1, lightColor);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(h, w * frac), h, h / 2); ctx.fill();
    if (text) {
      ctx.textAlign = 'left';
      ctx.font = `700 ${h - 2}px ${FONT}`;
      ctx.fillStyle = 'rgba(8,10,20,0.85)';
      ctx.fillText(text, x + 7, y + h - 2.5);
    }
    if (label) {
      ctx.textAlign = 'right';
      ctx.font = `700 8px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(label, x + w - 6, y + h - 2.5);
    }
    ctx.restore();
  }

  // ---- kill feed ------------------------------------------------------
  drawKillFeed(ctx, world, cw) {
    ctx.textAlign = 'right';
    let y = 70;
    for (const k of world.killFeed.slice().reverse()) {
      const a = clamp(k.life, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `600 13px ${FONT}`;
      const weapon = WEAPONS[k.weapon]?.short || (k.weapon || '').toUpperCase();
      const killer = k.killer || 'THE VOID';
      const text = `${killer}  ▸ ${weapon} ▸  ${k.victim}`;
      const w = ctx.measureText(text).width;
      panel(ctx, cw - 18 - w - 16, y - 14, w + 16, 20, 5, 'rgba(9,12,24,0.55)');
      ctx.fillStyle = '#cfe0ff';
      ctx.fillText(text, cw - 26, y);
      y += 24;
      ctx.globalAlpha = 1;
    }
  }

  // ---- minimap --------------------------------------------------------
  drawMinimap(ctx, world, cw, ch) {
    const map = world.map;
    const maxW = 172, maxH = 108;
    const s = Math.min(maxW / map.width, maxH / map.height);
    const w = map.width * s, h = map.height * s;
    const x = cw - w - 18, y = ch - h - 18;

    panel(ctx, x - 6, y - 6, w + 12, h + 12, 8);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(120,160,230,0.32)';
    const step = 2;
    for (let ty = 0; ty < map.th; ty += step) {
      for (let tx = 0; tx < map.tw; tx += step) {
        if (map.tileAt(tx, ty) === SOLID) ctx.fillRect(tx * 32, ty * 32, 32 * step, 32 * step);
      }
    }
    ctx.restore();

    for (const p of world.pickups) {
      if (!p.active) continue;
      ctx.fillStyle = p.kind === 'health' ? 'rgba(61,255,154,0.8)' : 'rgba(124,224,255,0.65)';
      ctx.fillRect(x + p.x * s - 1.5, y + p.y * s - 1.5, 3, 3);
    }
    for (const f of world.fighters) {
      if (!f.alive) continue;
      const fx = x + f.x * s, fy = y + f.y * s;
      ctx.beginPath();
      ctx.arc(fx, fy, f.isLocal ? 3.6 : 2.8, 0, TAU);
      ctx.fillStyle = f.isLocal ? '#ffffff' : f.hero.palette.accent;
      ctx.fill();
      if (f.isLocal) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + Math.cos(f.aimAngle) * 8, fy + Math.sin(f.aimAngle) * 8);
        ctx.stroke();
      }
    }
  }

  // ---- offscreen threat markers --------------------------------------
  drawOffscreenMarkers(ctx, world, cam, cw, ch) {
    const me = world.localFighter;
    if (!me) return;
    const pad = 44;
    for (const f of world.fighters) {
      if (f === me || !f.alive || f.cloak > 0.5) continue;
      const p = cam.worldToScreen(f.x, f.y, cw, ch);
      if (p.x > pad && p.x < cw - pad && p.y > pad && p.y < ch - pad) continue;
      const ang = Math.atan2(f.y - me.y, f.x - me.x);
      const ex = clamp(p.x, pad, cw - pad);
      const ey = clamp(p.y, pad, ch - pad);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = f.hero.palette.accent;
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---- overlays -------------------------------------------------------
  drawRespawn(ctx, me, world, cw, ch) {
    ctx.fillStyle = 'rgba(6,8,18,0.5)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center';
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = '#ff6a7d';
    ctx.fillText('YOU WERE ELIMINATED', cw / 2, ch / 2 - 34);
    ctx.font = `700 64px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(Math.max(1, Math.ceil(me.respawnTimer)), cw / 2, ch / 2 + 28);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = 'rgba(200,215,240,0.6)';
    ctx.fillText('RESPAWNING', cw / 2, ch / 2 + 50);
  }

  drawToast(ctx, cw, ch) {
    if (!this.toast) return;
    const a = clamp(this.toast.life / 0.4, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = `700 14px ${FONT}`;
    const w = ctx.measureText(this.toast.text).width + 28;
    panel(ctx, cw / 2 - w / 2, ch - 150, w, 28, 14);
    ctx.fillStyle = '#9ee6ff';
    ctx.fillText(this.toast.text, cw / 2, ch - 131);
    ctx.restore();
  }

  drawKillPop(ctx, cw, ch) {
    if (this.killPop <= 0) return;
    const k = this.killPop / 1.1;
    ctx.save();
    ctx.globalAlpha = clamp(k * 1.6, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = `700 ${26 + (1 - k) * 8}px ${FONT}`;
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = '#ff7a3d'; ctx.shadowBlur = 16;
    ctx.fillText(this.killPopText, cw / 2, ch * 0.32);
    ctx.restore();
  }

  drawNetStatus(ctx, status, cw) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = status.ok ? 'rgba(140,220,180,0.75)' : 'rgba(255,140,140,0.9)';
    ctx.fillText(status.text, 20, 26);
    ctx.restore();
  }

  drawScoreboard(ctx, world, cw, ch) {
    const rows = world.fighters.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const w = 460, rowH = 30;
    const h = 92 + rows.length * rowH;
    const x = cw / 2 - w / 2, y = ch / 2 - h / 2;

    ctx.fillStyle = 'rgba(5,7,16,0.72)';
    ctx.fillRect(0, 0, cw, ch);
    panel(ctx, x, y, w, h, 14, 'rgba(12,16,32,0.96)');
    ctx.strokeStyle = 'rgba(124,224,255,0.3)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = '#7ce0ff';
    ctx.fillText(world.over ? 'MATCH OVER' : 'SCOREBOARD', cw / 2, y + 32);
    if (world.over && world.winner) {
      ctx.font = `700 14px ${FONT}`;
      ctx.fillStyle = '#ffd166';
      ctx.fillText(`${world.winner.name} WINS`, cw / 2, y + 52);
    } else {
      ctx.font = `600 11px ${FONT}`;
      ctx.fillStyle = 'rgba(200,215,240,0.55)';
      ctx.fillText(world.map.name.toUpperCase(), cw / 2, y + 50);
    }

    const cols = [x + 22, x + 56, x + 210, x + 300, x + 360, x + 424];
    ctx.font = `700 10px ${FONT}`;
    ctx.fillStyle = 'rgba(200,215,240,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('#', cols[0], y + 76);
    ctx.fillText('FIGHTER', cols[1], y + 76);
    ctx.fillText('HERO', cols[2], y + 76);
    ctx.textAlign = 'right';
    ctx.fillText('K', cols[3], y + 76);
    ctx.fillText('D', cols[4], y + 76);
    ctx.fillText('DMG', cols[5], y + 76);

    rows.forEach((f, i) => {
      const ry = y + 96 + i * rowH;
      if (f.isLocal) {
        ctx.fillStyle = 'rgba(124,224,255,0.1)';
        ctx.beginPath(); ctx.roundRect(x + 10, ry - 16, w - 20, rowH - 4, 6); ctx.fill();
      }
      ctx.textAlign = 'left';
      ctx.font = `700 13px ${FONT}`;
      ctx.fillStyle = i === 0 ? '#ffd166' : 'rgba(200,215,240,0.7)';
      ctx.fillText(`${i + 1}`, cols[0], ry);
      ctx.fillStyle = f.isLocal ? '#ffffff' : '#cfe0ff';
      ctx.fillText(f.name + (f.isBot ? '  ·BOT' : ''), cols[1], ry);
      ctx.fillStyle = f.hero.palette.accent;
      ctx.font = `600 12px ${FONT}`;
      ctx.fillText(f.hero.name, cols[2], ry);
      ctx.textAlign = 'right';
      ctx.font = `700 13px ${FONT}`;
      ctx.fillStyle = '#e8f1ff';
      ctx.fillText(f.kills, cols[3], ry);
      ctx.fillStyle = 'rgba(200,215,240,0.6)';
      ctx.fillText(f.deaths, cols[4], ry);
      ctx.fillText(Math.round(f.damageDealt), cols[5], ry);
    });

    if (!world.over) {
      ctx.textAlign = 'center';
      ctx.font = `600 10px ${FONT}`;
      ctx.fillStyle = 'rgba(200,215,240,0.4)';
      ctx.fillText('HOLD TAB', cw / 2, y + h - 12);
    }
  }
}
