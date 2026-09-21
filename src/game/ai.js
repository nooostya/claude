// Bot brains. Each bot produces the same input struct a human keyboard would,
// so bots and players go through exactly one movement/combat code path.

import { BOT, TILE, COMBAT } from '../core/config.js';
import { clamp, rand, chance, dist, angleApproach, angleDelta, lerp, pick, random, TAU } from '../core/math.js';
import { WEAPONS } from './weapons.js';
import { blankInput } from './fighter.js';

// Preferred engagement distance per weapon, in pixels.
const IDEAL_RANGE = {
  scattergun: 120, shotgun: 130, machinePistol: 250, smg: 260,
  pistol: 300, handCannon: 320, rifle: 400, lmg: 420,
  plasma: 380, rocket: 460, rail: 620,
};

export const DIFFICULTIES = [
  { id: 'recruit', name: 'Recruit', value: 0.15 },
  { id: 'soldier', name: 'Soldier', value: 0.45 },
  { id: 'veteran', name: 'Veteran', value: 0.7 },
  { id: 'elite', name: 'Elite', value: 0.88 },
  { id: 'nightmare', name: 'Nightmare', value: 1 },
];

export class BotBrain {
  constructor(fighter, difficulty = 0.6) {
    this.f = fighter;
    this.d = clamp(difficulty, 0, 1);
    this.input = blankInput();
    this.think = 0;
    this.target = null;
    this.goal = null;          // { x, y, kind }
    this.aim = 0;
    this.strafe = chance(0.5) ? 1 : -1;
    this.strafeTimer = rand(0.6, 1.8);
    this.reactTimer = 0;
    this.jetUrge = 0;
    this.panic = 0;
    this.grenadeTimer = rand(3, 9);
    this.wanderX = fighter.x;
  }

  get reaction() { return lerp(BOT.reactionTime[0], BOT.reactionTime[1], 1 - this.d); }
  get aimError() { return lerp(BOT.aimError[1], BOT.aimError[0], this.d); }
  get aimSpeed() { return lerp(BOT.aimSpeed[0], BOT.aimSpeed[1], this.d); }

  update(dt, world) {
    const f = this.f;
    const inp = this.input;
    for (const k of ['left', 'right', 'jet', 'down', 'fire', 'melee', 'grenade', 'ability', 'reload', 'swap']) {
      inp[k] = false;
    }
    if (!f.alive) return inp;

    this.think -= dt;
    this.strafeTimer -= dt;
    this.reactTimer -= dt;
    this.grenadeTimer -= dt;
    this.panic = Math.max(0, this.panic - dt);
    if (world.time - f.lastHitAt < 0.4) this.panic = 1.2;

    if (this.think <= 0) {
      this.think = BOT.thinkInterval + rand(0, 0.06);
      this._retarget(world);
      this._chooseGoal(world);
    }
    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(0.5, 1.6);
      this.strafe = chance(0.5) ? 1 : -1;
    }

    const tgt = this.target && this.target.alive ? this.target : null;
    const visible = tgt && !world.map.lineBlocked(f.x, f.y - 4, tgt.x, tgt.y - 4);

    this._aim(dt, world, tgt, visible);
    this._navigate(dt, world, tgt, visible);
    this._combat(dt, world, tgt, visible);

    return inp;
  }

  _retarget(world) {
    const f = this.f;
    let best = null, bestScore = Infinity;
    for (const o of world.fighters) {
      if (o === f || !o.alive) continue;
      if (f.team >= 0 && o.team === f.team) continue;
      const d = dist(f.x, f.y, o.x, o.y);
      const blocked = world.map.lineBlocked(f.x, f.y - 4, o.x, o.y - 4);
      // prefer whoever is visible and close; strongly prefer whoever shot us
      let score = d + (blocked ? 900 : 0);
      if (o.id === f.lastHitBy && world.time - f.lastHitAt < 4) score -= 700;
      if (o.health < o.maxHealth * 0.35) score -= 250;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (best !== this.target) this.reactTimer = this.reaction;
    this.target = best;
  }

  _chooseGoal(world) {
    const f = this.f;
    const needWeapon = !f.slots.primary;
    const needHealth = f.health < f.maxHealth * 0.45;
    const needAmmo = f.slots.primary && f.slots.primary.reserve <= 0 && f.slots.primary.mag <= 0;

    let best = null, bestScore = Infinity;
    for (const p of world.pickups) {
      if (!p.active) continue;
      let want = 0.25;
      if (p.kind === 'weapon' && needWeapon) want = 2.4;
      else if (p.kind === 'health' && needHealth) want = 3.0;
      else if (p.kind === 'ammo' && (needAmmo || needWeapon)) want = 1.4;
      else if (p.kind === 'grenade' && f.grenades === 0) want = 1.0;
      if (want < 0.3) continue;
      const d = dist(f.x, f.y, p.x, p.y);
      if (d > 1000) continue;
      const score = d / want;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    this.goal = best ? { x: best.x, y: best.y, kind: best.kind, urgent: bestScore < 260 } : null;
    if (!this.target && !this.goal && Math.abs(f.x - this.wanderX) < 60) {
      this.wanderX = clamp(f.x + rand(-700, 700), 80, world.map.width - 80);
    }
  }

  _aim(dt, world, tgt, visible) {
    const f = this.f;
    const inp = this.input;
    let desired = this.aim;

    if (tgt) {
      const w = f.weapon;
      let px = tgt.x, py = tgt.y - 4;
      // lead the shot for travelling projectiles
      if (w.kind !== 'hitscan' && w.speed) {
        const t = dist(f.x, f.y, tgt.x, tgt.y) / w.speed;
        px += tgt.vx * t * lerp(0.35, 1.0, this.d);
        py += tgt.vy * t * lerp(0.35, 1.0, this.d) + (w.gravity ? 0.5 * w.gravity * t * t : 0);
      }
      desired = Math.atan2(py - (f.y - 4), px - f.x);
      desired += Math.sin(world.time * 3.1 + f.id) * this.aimError;
    } else if (this.goal) {
      desired = Math.atan2(this.goal.y - f.y, this.goal.x - f.x);
    } else {
      desired = Math.atan2(0, this.wanderX - f.x || 1);
    }

    this.aim = angleApproach(this.aim, desired, this.aimSpeed * dt);
    inp.aimX = f.x + Math.cos(this.aim) * 400;
    inp.aimY = f.y - 4 + Math.sin(this.aim) * 400;
  }

  _navigate(dt, world, tgt, visible) {
    const f = this.f;
    const inp = this.input;
    const map = world.map;

    let goalX = f.x, goalY = f.y;
    let engaged = false;

    if (this.goal && (!tgt || this.goal.urgent || !visible)) {
      goalX = this.goal.x; goalY = this.goal.y;
    } else if (tgt) {
      engaged = true;
      const ideal = IDEAL_RANGE[f.weaponId] ?? 320;
      const d = dist(f.x, f.y, tgt.x, tgt.y);
      const toward = Math.sign(tgt.x - f.x) || 1;
      if (d > ideal * 1.25) goalX = f.x + toward * 260;
      else if (d < ideal * 0.6) goalX = f.x - toward * 220;
      else goalX = f.x + this.strafe * 190;
      goalY = tgt.y - 40;
      if (!visible) { goalX = tgt.x; goalY = tgt.y - 30; }
    } else {
      goalX = this.wanderX;
      goalY = f.y;
    }

    const dx = goalX - f.x;
    if (dx < -14) inp.left = true;
    else if (dx > 14) inp.right = true;

    // ---- vertical: jetpack decisions ----
    const wantUp = (f.y - goalY) < -30;
    const headroom = !map.solidAtPoint(f.x, f.y - f.hh - 26);
    const groundY = map.groundBelow(f.x, f.y + f.hh + 2);
    const dropAhead = map.groundBelow(f.x + (inp.left ? -46 : inp.right ? 46 : 0), f.y) - f.y;
    const wallAhead = (inp.left && map.solidAtPoint(f.x - f.hw - 8, f.y)) ||
                      (inp.right && map.solidAtPoint(f.x + f.hw + 8, f.y));

    this.jetUrge = Math.max(0, this.jetUrge - dt);
    if (wantUp && headroom) this.jetUrge = 0.28;
    if (wallAhead && headroom) this.jetUrge = 0.34;
    if (dropAhead > 240 && engaged) this.jetUrge = 0.2;
    if (f.y + f.hh > groundY - 6 && f.vy > 600) this.jetUrge = 0.3;   // arrest a hard fall
    if (this.panic > 0 && chance(0.45 * this.d)) this.jetUrge = 0.22;  // jink when shot at

    // never burn the tank dry unless we are about to eat the floor
    const emergency = f.vy > 700 && (groundY - (f.y + f.hh)) < 220;
    if ((this.jetUrge > 0 && f.fuel > 0.22) || (emergency && f.fuel > 0.04)) inp.jet = true;

    // drop through a platform to chase someone below
    if (tgt && tgt.y > f.y + 70 && f.onGround && chance(0.06)) inp.down = true;
  }

  _combat(dt, world, tgt, visible) {
    const f = this.f;
    const inp = this.input;
    const a = f.ammo;
    const w = f.weapon;

    // reload when it is safe, or when dry
    if (a.mag === 0) inp.reload = true;
    else if (a.mag < WEAPONS[a.id].mag * 0.3 && (!tgt || !visible)) inp.reload = true;

    if (f.slots.primary && f.activeSlot === 'sidearm' && f.slots.primary.mag > 0) {
      inp.swap = chance(0.35);
    }

    if (!tgt || !visible || this.reactTimer > 0) {
      this._ability(world, tgt, visible, false);
      return;
    }

    const d = dist(f.x, f.y, tgt.x, tgt.y);
    const err = Math.abs(angleDelta(this.aim, Math.atan2(tgt.y - 4 - (f.y - 4), tgt.x - f.x)));
    const tolerance = clamp(Math.atan2(tgt.hh * 1.5, Math.max(60, d)), 0.03, 0.5);

    if (d < COMBAT.meleeRange * 0.85 && f.meleeTimer <= 0 && chance(0.5 + this.d * 0.4)) {
      inp.melee = true;
    }
    if (err < tolerance && a.mag > 0 && a.reloading <= 0) {
      inp.fire = w.auto ? true : chance(0.55 + this.d * 0.4);
    }
    if (this.grenadeTimer <= 0 && f.grenades > 0 && d > 180 && d < 640 && chance(0.4)) {
      inp.grenade = true;
      this.grenadeTimer = rand(4, 11) / (0.5 + this.d);
    }

    this._ability(world, tgt, visible, true);
  }

  _ability(world, tgt, visible, inCombat) {
    const f = this.f;
    if (!f.abilityReady() || chance(1 - this.d * 0.9)) return;
    const d = tgt ? dist(f.x, f.y, tgt.x, tgt.y) : Infinity;
    const hurt = f.health < f.maxHealth * 0.4;
    let want = false;

    switch (f.ability.def.id) {
      case 'dash':       want = (hurt && d < 420) || (inCombat && d > 380 && visible); break;
      case 'aegis':      want = inCombat && visible && d < 700; break;
      case 'afterburn':  want = (f.fuel < 0.3 && !f.onGround) || (inCombat && d < 260); break;
      case 'iaido':      want = d < 190; break;
      case 'ghost':      want = hurt || (!visible && !!tgt && d < 600); break;
      case 'overcharge': want = inCombat && visible && d < 620; break;
    }
    if (want) this.input.ability = true;
  }
}

/** Pool of bot callsigns, so a match roster reads like a match roster. */
const NAMES = [
  'RIPTIDE', 'HAVOC', 'SABLE', 'ZEPHYR', 'CINDER', 'RONIN', 'ECHO', 'MAVERICK',
  'GLITCH', 'TALON', 'ONYX', 'QUASAR', 'VIPER', 'ASH', 'SPECTRE', 'JUNO',
  'KILOWATT', 'HEX', 'DRIFT', 'SOLSTICE', 'RAZOR', 'NYX', 'PIXEL', 'TEMPO',
];

export function botNames(n, taken = []) {
  const pool = NAMES.filter((x) => !taken.includes(x));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (pool.length === 0) { out.push(`BOT-${i + 1}`); continue; }
    out.push(pool.splice((random() * pool.length) | 0, 1)[0]);
  }
  return out;
}
