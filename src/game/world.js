// The simulation. Owns the map, fighters, projectiles, pickups and match
// state, and is the single place that decides damage outcomes.
//
// Authority model:
//   local mode  - this world decides everything.
//   online mode - each client simulates its own fighter and its own bullets.
//                 Hits on remote players are *reported* (never applied here);
//                 the victim's client applies them and republishes its health.
//                 Remote-owned projectiles are visual only. See src/net/.

import { COMBAT, MATCH, PHYS, TILE } from '../core/config.js';
import { clamp, rand, randInt, dist, dist2, random, segmentHitsBox, TAU } from '../core/math.js';
import { WEAPONS, rollPrimary } from './weapons.js';
import { Projectile, Pickup } from './entities.js';
import { Particles } from './particles.js';
import { Fighter, blankInput } from './fighter.js';
import { moveBody, raycast } from './physics.js';

export class World {
  constructor(map, opts = {}) {
    this.map = map;
    this.mode = opts.mode || 'local';        // 'local' | 'online'
    this.fighters = [];
    this.projectiles = [];
    this.pickups = [];
    this.particles = new Particles();
    this.events = [];
    this.time = 0;
    this.scoreLimit = opts.scoreLimit ?? MATCH.scoreLimit;
    this.timeLeft = opts.timeLimit ?? MATCH.timeLimit;
    this.over = false;
    this.winner = null;
    this.shake = 0;
    this.slowmo = 0;
    this.localId = opts.localId ?? null;
    this.seed = opts.seed ?? 1;
    this.killFeed = [];
    this._resetPickups();
  }

  get localFighter() { return this.fighters.find((f) => f.id === this.localId) || null; }
  fighterById(id) { return this.fighters.find((f) => f.id === id) || null; }
  get livingOpponentsOf() { return (f) => this.fighters.filter((o) => o !== f && o.alive); }

  emit(ev) { this.events.push(ev); return ev; }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------------
  // setup
  // ------------------------------------------------------------------
  addFighter(opts) {
    const f = new Fighter(opts);
    const spawn = this.pickSpawn();
    f.x = spawn.x; f.y = spawn.y;
    this.fighters.push(f);
    this.particles.spawnBurst(f.x, f.y, f.hero.palette.glow);
    return f;
  }

  removeFighter(id) {
    const i = this.fighters.findIndex((f) => f.id === id);
    if (i >= 0) this.fighters.splice(i, 1);
  }

  _resetPickups() {
    this.pickups = [];
    const m = this.map;
    m.crateSpots.forEach((s, i) => {
      const kind = i % 4 === 3 ? 'ammo' : 'weapon';
      this.pickups.push(new Pickup(kind, s.x, s.y, {
        weaponId: rollPrimary(), netId: `c${i}`, index: i,
      }));
    });
    m.healthSpots.forEach((s, i) => {
      const kind = i % 3 === 2 ? 'grenade' : 'health';
      this.pickups.push(new Pickup(kind, s.x, s.y, {
        amount: MATCH.healthPackAmount, netId: `h${i}`, index: i,
      }));
    });
  }

  /** Spawn point furthest from every living fighter. */
  pickSpawn(forFighter = null) {
    const spawns = this.map.spawns;
    let best = spawns[0], bestScore = -Infinity;
    for (const s of spawns) {
      let score = rand(0, 90); // jitter so repeat spawns are not identical
      for (const f of this.fighters) {
        if (!f.alive || f === forFighter) continue;
        score += Math.min(900, dist(s.x, s.y, f.x, f.y));
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // main step
  // ------------------------------------------------------------------
  step(dt, inputs) {
    if (this.over) { this.particles.update(dt); return; }
    this.time += dt;
    if (this.timeLeft > 0) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) this.finish(this._leader());
    }
    this.shake = Math.max(0, this.shake - dt * 46);
    this.slowmo = Math.max(0, this.slowmo - dt);

    for (const f of this.fighters) {
      if (f.isRemote) { this._stepRemote(f, dt); continue; }
      const input = inputs.get(f.id) || blankInput();
      f.update(dt, input, this);
      f.dropEmptyPrimary();
      if (!f.alive && f.respawnTimer <= 0) this.respawn(f);
      this._clampToMap(f);
    }

    this._stepProjectiles(dt);
    this._stepPickups(dt);
    this.particles.update(dt);
    if (this.killFeed.length) {
      for (const k of this.killFeed) k.life -= dt;
      this.killFeed = this.killFeed.filter((k) => k.life > 0).slice(-5);
    }
  }

  /** Remote fighters are driven by the network; we only run cosmetics. */
  _stepRemote(f, dt) {
    f.anim.walk += Math.abs(f.vx) * dt * 0.035;
    f.anim.hurt = Math.max(0, f.anim.hurt - dt * 3);
    f.anim.muzzle = Math.max(0, f.anim.muzzle - dt);
    f.spawnProtect = Math.max(0, f.spawnProtect - dt);
    if (f.thrusting && f.alive) {
      this.particles.jet(f.x + rand(-4, 4), f.y + f.hh - 4, Math.PI / 2 + rand(-0.3, 0.3), f.hero.palette.visor);
    }
  }

  _clampToMap(f) {
    f.x = clamp(f.x, f.hw + 2, this.map.width - f.hw - 2);
    if (f.y > this.map.height + 200) {
      // fell out of the world somehow: treat as a suicide rather than wedging
      this.damage(f, 9999, { cause: 'void' });
    }
  }

  // ------------------------------------------------------------------
  // projectiles
  // ------------------------------------------------------------------
  spawnProjectile(p) {
    this.projectiles.push(p);
    return p;
  }

  _stepProjectiles(dt) {
    const keep = [];
    for (const p of this.projectiles) {
      if (this._stepProjectile(p, dt)) keep.push(p);
    }
    this.projectiles = keep;
  }

  _stepProjectile(p, dt) {
    p.life -= dt;
    if (p.life <= 0 || p.dead) {
      if (p.type === 'grenade') this._detonate(p);
      return false;
    }

    if (p.type === 'grenade') return this._stepGrenade(p, dt);

    // Fast projectiles are sub-stepped so nothing tunnels through thin walls.
    const speed = Math.hypot(p.vx, p.vy);
    const steps = clamp(Math.ceil((speed * dt) / (TILE * 0.5)), 1, 8);
    const sdt = dt / steps;

    for (let i = 0; i < steps; i++) {
      p.px = p.x; p.py = p.y;
      if (p.gravity) p.vy += p.gravity * sdt;
      p.x += p.vx * sdt;
      p.y += p.vy * sdt;
      p.rot = Math.atan2(p.vy, p.vx);

      if (p.type !== 'bullet') {
        this.particles.trail(p.x, p.y, p.color, p.type === 'rocket' ? 3.2 : 2.4, 0.22);
      }

      if (this.map.solidAtPoint(p.x, p.y)) {
        this._projectileImpact(p, p.px, p.py, null);
        return false;
      }
      if (this._projectileHitsFighter(p)) return false;
    }
    return true;
  }

  _stepGrenade(p, dt) {
    p.fuse -= dt;
    p.vy += PHYS.gravity * 0.62 * dt;
    p.spin += p.vx * dt * 0.02;
    const body = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, hw: 5, hh: 5, dropThrough: false };
    const hit = moveBody(body, this.map, dt);
    p.x = body.x; p.y = body.y; p.vx = body.vx; p.vy = body.vy;
    if (hit.down || hit.up) { p.vy = -hit.landedAt * 0.42 || p.vy * -0.42; p.vx *= 0.72; }
    if (hit.left || hit.right) p.vx *= -0.52;
    if (random() < 0.3) this.particles.trail(p.x, p.y, '#ff9a4d', 1.8, 0.18);
    if (p.fuse <= 0) {
      this._detonate(p);
      return false;
    }
    return true;
  }

  _detonate(p) {
    if (p.visualOnly) {
      this.particles.explosion(p.x, p.y, COMBAT.grenadeRadius, '#ff9a4d');
      this.addShake(10);
      this.emit({ type: 'explosion', x: p.x, y: p.y, radius: COMBAT.grenadeRadius });
      return;
    }
    this.explode(p.x, p.y, COMBAT.grenadeRadius, COMBAT.grenadeDamage, p);
  }

  _projectileHitsFighter(p) {
    for (const f of this.fighters) {
      if (!f.alive || f.id === p.ownerId || p.hitIds.has(f.id)) continue;
      if (p.ownerTeam >= 0 && f.team === p.ownerTeam) continue;
      if (!segmentHitsBox(p.px, p.py, p.x, p.y, f.x, f.y, f.hw + 2, f.hh + 2)) continue;

      // Kage's Iaido deflects anything that reaches him during the slash.
      if (f.deflecting && !p.explosive && !p.visualOnly) {
        p.vx *= -1; p.vy *= -1;
        p.ownerId = f.id; p.ownerTeam = f.team;
        p.hitIds.clear();
        p.damage *= 1.25;
        p.color = f.hero.palette.accent;
        this.particles.impact(p.x, p.y, Math.atan2(p.vy, p.vx), f.hero.palette.accent, 10);
        this.emit({ type: 'deflect', x: p.x, y: p.y });
        return false;
      }

      p.hitIds.add(f.id);
      this._projectileImpact(p, p.x, p.y, f);
      if (p.explosive) return true;
      if (p.pierce > 0) { p.pierce--; return false; }
      return true;
    }
    return false;
  }

  _projectileImpact(p, x, y, target) {
    if (p.visualOnly) {
      if (p.explosive) {
        this.particles.explosion(x, y, p.explosive.radius, p.color);
        this.addShake(clamp(p.explosive.radius * 0.1, 3, 14));
        this.emit({ type: 'explosion', x, y, radius: p.explosive.radius });
      } else {
        this.particles.impact(x, y, Math.atan2(p.vy, p.vx), p.color, 7);
      }
      return;
    }
    if (p.explosive) {
      this.explode(x, y, p.explosive.radius, p.explosive.damage, p);
      return;
    }
    const angle = Math.atan2(p.vy, p.vx);
    if (target) {
      const dealt = this.damage(target, p.damage, {
        byId: p.ownerId, weapon: p.weaponId, x, y, angle, knockback: p.knockback,
      });
      if (dealt > 0) {
        this.particles.blood(x, y, angle, target.hero.palette.accent, 10);
        if (p.chain) this._chainLightning(p, target);
      }
    } else {
      this.particles.impact(x, y, angle, p.color, 7);
    }
    this.emit({ type: 'impact', x, y, target: !!target, weapon: p.weaponId });
  }

  _chainLightning(p, from) {
    const def = p.chain;
    let best = null, bestD = def.arcRange * def.arcRange;
    for (const f of this.fighters) {
      if (!f.alive || f.id === p.ownerId || f.id === from.id) continue;
      const d = dist2(from.x, from.y, f.x, f.y);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (!best) return;
    this.particles.lightning(from.x, from.y, best.x, best.y, '#9ee6ff');
    this.damage(best, def.arcDamage, { byId: p.ownerId, weapon: 'overcharge', x: best.x, y: best.y, angle: 0 });
    this.emit({ type: 'chain', x0: from.x, y0: from.y, x1: best.x, y1: best.y });
  }

  // ------------------------------------------------------------------
  // instant-hit and area weapons
  // ------------------------------------------------------------------
  hitscan(shooter, x, y, angle, weapon, damage) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const wall = raycast(this.map, x, y, dx, dy, weapon.range, 8);

    const hits = [];
    for (const f of this.fighters) {
      if (!f.alive || f.id === shooter.id) continue;
      if (shooter.team >= 0 && f.team === shooter.team) continue;
      if (!segmentHitsBox(x, y, wall.x, wall.y, f.x, f.y, f.hw + 2, f.hh + 2)) continue;
      hits.push({ f, d: dist2(x, y, f.x, f.y) });
    }
    hits.sort((a, b) => a.d - b.d);

    let endX = wall.x, endY = wall.y;
    let remaining = (weapon.pierce || 0) + 1;
    for (const h of hits) {
      if (remaining-- <= 0) break;
      const dealt = this.damage(h.f, damage, {
        byId: shooter.id, weapon: weapon.id, x: h.f.x, y: h.f.y, angle,
        knockback: weapon.knockback,
      });
      if (dealt > 0) this.particles.blood(h.f.x, h.f.y, angle, h.f.hero.palette.accent, 14);
      endX = h.f.x; endY = h.f.y;
    }
    if (remaining > 0) { endX = wall.x; endY = wall.y; }
    if (wall.hit) this.particles.impact(wall.x, wall.y, angle, weapon.color, 10);

    this.emit({
      type: 'beam', x0: x, y0: y, x1: wall.x, y1: wall.y,
      color: weapon.color, width: weapon.width, life: 0.16,
      byId: shooter.id, weapon: weapon.id,
    });
    this.addShake(7);
  }

  explode(x, y, radius, damage, src = null) {
    this.particles.explosion(x, y, radius, src?.color || '#ff9a4d');
    this.addShake(clamp(radius * 0.16, 6, 22));
    this.emit({ type: 'explosion', x, y, radius });

    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = dist(x, y, f.x, f.y);
      if (d > radius) continue;
      if (this.map.lineBlocked(x, y, f.x, f.y)) continue;
      const falloff = 1 - Math.pow(d / radius, 1.6);
      const selfHit = src && f.id === src.ownerId;
      const dealt = damage * falloff * (selfHit ? 0.45 : 1);
      const kb = (src?.explosive?.knockback ?? 520) * falloff;
      this.damage(f, dealt, {
        byId: src?.ownerId ?? null, weapon: src?.weaponId || 'grenade',
        x, y, angle: Math.atan2(f.y - y, f.x - x), knockback: kb, blast: true,
      });
    }
  }

  melee(attacker) {
    const range = COMBAT.meleeRange;
    const dmg = COMBAT.meleeDamage * (attacker.stats.melee || 1);
    const ax = attacker.x + Math.cos(attacker.aimAngle) * range * 0.6;
    const ay = attacker.y - 4 + Math.sin(attacker.aimAngle) * range * 0.6;
    this.emit({ type: 'melee', x: ax, y: ay, angle: attacker.aimAngle, id: attacker.id });
    this.particles.impact(ax, ay, attacker.aimAngle + Math.PI, attacker.hero.palette.trim, 6);

    let landed = false;
    for (const f of this.fighters) {
      if (!f.alive || f.id === attacker.id) continue;
      if (attacker.team >= 0 && f.team === attacker.team) continue;
      if (dist(ax, ay, f.x, f.y) > range) continue;
      const dealt = this.damage(f, dmg, {
        byId: attacker.id, weapon: 'melee', x: f.x, y: f.y,
        angle: attacker.aimAngle, knockback: COMBAT.meleeKnockback,
      });
      if (dealt > 0) { landed = true; this.particles.blood(f.x, f.y, attacker.aimAngle, f.hero.palette.accent, 12); }
    }
    if (landed) this.addShake(6);
  }

  iaidoSweep(attacker) {
    const def = attacker.ability.def;
    attacker._iaidoHits = attacker._iaidoHits || new Set();
    for (const f of this.fighters) {
      if (!f.alive || f.id === attacker.id || attacker._iaidoHits.has(f.id)) continue;
      if (attacker.team >= 0 && f.team === attacker.team) continue;
      if (dist(attacker.x, attacker.y, f.x, f.y) > def.range) continue;
      attacker._iaidoHits.add(f.id);
      this.damage(f, def.damage, {
        byId: attacker.id, weapon: 'iaido', x: f.x, y: f.y,
        angle: attacker.aimAngle, knockback: 520,
      });
      this.particles.blood(f.x, f.y, attacker.aimAngle, '#ff4d5e', 18);
      this.addShake(9);
    }
    if (attacker.ability.active <= 0) attacker._iaidoHits = null;
  }

  burnAura(source, damage, radius) {
    for (const f of this.fighters) {
      if (!f.alive || f.id === source.id) continue;
      if (source.team >= 0 && f.team === source.team) continue;
      if (dist(source.x, source.y, f.x, f.y) > radius) continue;
      this.damage(f, damage, {
        byId: source.id, weapon: 'afterburn', x: f.x, y: f.y,
        angle: Math.atan2(f.y - source.y, f.x - source.x), knockback: 40,
      });
    }
  }

  throwGrenade(thrower) {
    const a = thrower.aimAngle;
    const speed = 640;
    const g = new Projectile({
      type: 'grenade',
      x: thrower.x + Math.cos(a) * 20, y: thrower.y - 6 + Math.sin(a) * 20,
      vx: Math.cos(a) * speed + thrower.vx * 0.4,
      vy: Math.sin(a) * speed - 130 + thrower.vy * 0.4,
      damage: COMBAT.grenadeDamage,
      ownerId: thrower.id, ownerTeam: thrower.team,
      life: COMBAT.grenadeFuse + 0.2,
      fuse: COMBAT.grenadeFuse,
      weaponId: 'grenade',
      color: '#ff9a4d', width: 5,
      explosive: { radius: COMBAT.grenadeRadius, damage: COMBAT.grenadeDamage, knockback: 540 },
    });
    this.spawnProjectile(g);
    this.emit({ type: 'grenade', x: g.x, y: g.y, id: thrower.id });
  }

  // ------------------------------------------------------------------
  // damage / death
  // ------------------------------------------------------------------
  damage(target, amount, info = {}) {
    if (!target.alive || this.over || amount <= 0) return 0;
    const mul = target.damageMultiplierFrom(info.x ?? target.x, info.y ?? target.y);
    if (mul <= 0) {
      this.emit({ type: 'blocked', x: target.x, y: target.y, id: target.id });
      this.particles.spawnBurst(target.x, target.y, '#9ecbff');
      return 0;
    }
    const dealt = amount * mul;

    // Online: the victim's own client is the authority on its health.
    if (this.mode === 'online' && target.isRemote) {
      this.emit({
        type: 'hitReport', targetId: target.id, amount: dealt,
        weapon: info.weapon, byId: info.byId,
      });
      target.anim.hurt = 1;
      return dealt;
    }

    target.health -= dealt;
    target.anim.hurt = 1;
    target.lastHitBy = info.byId ?? null;
    target.lastHitAt = this.time;

    if (info.knockback) {
      const a = info.angle ?? 0;
      const k = info.knockback * (info.blast ? 1 : 0.6);
      target.vx += Math.cos(a) * k;
      target.vy += Math.sin(a) * k - (info.blast ? 90 : 40);
    }

    const attacker = info.byId != null ? this.fighterById(info.byId) : null;
    if (attacker && attacker.id !== target.id) attacker.damageDealt += dealt;

    this.emit({
      type: 'hit', x: info.x ?? target.x, y: info.y ?? target.y,
      amount: dealt, targetId: target.id, byId: info.byId, weapon: info.weapon,
      local: target.isLocal,
    });

    if (target.health <= 0) this.kill(target, info);
    return dealt;
  }

  kill(target, info = {}) {
    if (!target.alive) return;
    target.alive = false;
    target.health = 0;
    target.deaths++;
    target.streak = 0;
    target.respawnTimer = COMBAT.respawnTime;
    target.ability.active = 0;
    target.deflecting = false;
    target.shielded = false;

    const killer = info.byId != null && info.byId !== target.id ? this.fighterById(info.byId) : null;

    // Online, the server owns the scoreboard and the kill feed: it echoes an
    // authoritative `kill` message to everyone. Scoring here too would double
    // count on the victim's client, which is the one that runs this path.
    const serverScores = this.mode === 'online';
    if (!serverScores) {
      if (killer) {
        killer.kills++;
      } else {
        target.kills = Math.max(0, target.kills - 1); // suicide costs a point
      }
      this.killFeed.push({
        killer: killer ? killer.name : null,
        killerHero: killer ? killer.heroId : null,
        victim: target.name,
        victimHero: target.heroId,
        weapon: info.weapon || info.cause || 'unknown',
        life: 5,
      });
    }
    if (killer) killer.streak++;

    this.particles.explosion(target.x, target.y, 64, target.hero.palette.accent);
    this.particles.blood(target.x, target.y, -Math.PI / 2, target.hero.palette.accent, 26);
    this.addShake(target.isLocal ? 18 : 9);

    this.emit({
      type: 'kill', victimId: target.id, killerId: killer?.id ?? null,
      weapon: info.weapon || info.cause, x: target.x, y: target.y,
      streak: killer?.streak ?? 0,
    });

    if (!serverScores && killer && killer.kills >= this.scoreLimit) this.finish(killer);
  }

  respawn(f) {
    const spawn = this.pickSpawn(f);
    f.reset(spawn);
    this.particles.spawnBurst(f.x, f.y, f.hero.palette.glow);
    this.emit({ type: 'respawn', id: f.id, x: f.x, y: f.y });
  }

  _leader() {
    return this.fighters.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0] || null;
  }

  finish(winner) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.emit({ type: 'matchOver', winnerId: winner?.id ?? null });
  }

  // ------------------------------------------------------------------
  // pickups
  // ------------------------------------------------------------------
  _stepPickups(dt) {
    for (const p of this.pickups) {
      p.bob += dt * 2.4;
      p.spin += dt * 1.1;
      if (p.requested > 0) p.requested -= dt;
      if (!p.active) {
        if (this.mode === 'online') continue;   // server drives respawns
        p.timer -= dt;
        if (p.timer <= 0) {
          p.active = true;
          if (p.kind === 'weapon') p.weaponId = rollPrimary();
          this.particles.spawnBurst(p.x, p.y, '#7ce0ff');
          this.emit({ type: 'pickupReady', id: p.id });
        }
        continue;
      }
      for (const f of this.fighters) {
        if (!f.alive || f.isRemote) continue;
        if (Math.abs(f.x - p.x) > p.radius + f.hw) continue;
        if (Math.abs(f.y - p.y) > p.radius + f.hh) continue;
        if (this.mode === 'online') {
          // The server decides who gets it, so all clients stay in agreement.
          if (p.requested <= 0 && this.wouldTake(f, p)) {
            p.requested = 0.5;
            this.emit({ type: 'pickupRequest', netId: p.netId, by: f.id });
          }
          break;
        }
        if (this.grantPickup(f, p)) break;
      }
    }
  }

  /** Would this fighter benefit from the pickup? Avoids spamming grab requests. */
  wouldTake(f, p) {
    switch (p.kind) {
      case 'weapon': return true;
      case 'health': return f.health < f.maxHealth;
      case 'grenade': return f.grenades < COMBAT.grenadeMaxAmmo;
      case 'ammo': return true;
      default: return false;
    }
  }

  /** Server-confirmed grab (online mode). */
  applyPickupGrant(netId, byId, weaponId) {
    const p = this.pickups.find((x) => x.netId === netId);
    if (!p) return;
    if (weaponId) p.weaponId = weaponId;
    const f = this.fighterById(byId);
    if (f && !f.isRemote) this.grantPickup(f, p);
    else {
      p.consume(MATCH.pickupRespawn);
      this.particles.spawnBurst(p.x, p.y, p.kind === 'health' ? '#3dff9a' : '#7ce0ff');
    }
  }

  /** Server-confirmed respawn (online mode). */
  applyPickupReady(netId, weaponId) {
    const p = this.pickups.find((x) => x.netId === netId);
    if (!p) return;
    p.active = true;
    p.timer = 0;
    if (weaponId) p.weaponId = weaponId;
    this.particles.spawnBurst(p.x, p.y, '#7ce0ff');
  }

  grantPickup(f, p) {
    let took = false;
    switch (p.kind) {
      case 'weapon':
        f.givePrimary(p.weaponId);
        took = true;
        break;
      case 'health':
        if (f.health < f.maxHealth) {
          f.health = Math.min(f.maxHealth, f.health + p.amount);
          took = true;
        }
        break;
      case 'ammo':
        took = f.giveAmmo();
        break;
      case 'grenade':
        if (f.grenades < COMBAT.grenadeMaxAmmo) {
          f.grenades = Math.min(COMBAT.grenadeMaxAmmo, f.grenades + 2);
          took = true;
        }
        break;
    }
    if (!took) return false;
    p.consume(MATCH.pickupRespawn);
    this.particles.spawnBurst(p.x, p.y, p.kind === 'health' ? '#3dff9a' : '#7ce0ff');
    this.emit({ type: 'pickup', kind: p.kind, id: p.id, netId: p.netId, by: f.id, weaponId: p.weaponId, local: f.isLocal });
    return true;
  }

  /** Server-driven pickup state (online mode). */
  applyPickupState(id, active, weaponId) {
    const p = this.pickups.find((x) => x.id === id);
    if (!p) return;
    p.active = active;
    if (weaponId) p.weaponId = weaponId;
    if (!active) p.timer = MATCH.pickupRespawn;
  }

  addShake(v) { this.shake = Math.min(28, this.shake + v); }

  // hooks the game layer overrides for audio / networking
  onShot() {}
  onAbility() {}
}
