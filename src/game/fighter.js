// A fighter is any combatant: the local player, a remote peer, or a bot.
// It owns movement, fuel, weapon handling and its hero ability. Damage and
// scoring are routed through the World so one place decides the outcome.

import { PHYS, FUEL, COMBAT, TILE } from '../core/config.js';
import { clamp, damp, rand, sign, angleApproach, TAU } from '../core/math.js';
import { WEAPONS, makeAmmo, shotInterval } from './weapons.js';
import { getHero } from './characters.js';
import { moveBody } from './physics.js';
import { bulletFromWeapon } from './entities.js';

export const blankInput = () => ({
  left: false, right: false, jet: false, down: false,
  fire: false, melee: false, grenade: false, ability: false,
  reload: false, swap: false,
  aimX: 0, aimY: 0,
});

export class Fighter {
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name || 'Fighter';
    this.heroId = opts.heroId || 'nova';
    this.hero = getHero(this.heroId);
    this.isBot = !!opts.isBot;
    this.isLocal = !!opts.isLocal;
    this.isRemote = !!opts.isRemote;
    this.team = opts.team ?? -1;
    this.difficulty = opts.difficulty ?? 1;

    this.hw = PHYS.playerW / 2;
    this.hh = PHYS.playerH / 2;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.onWall = 0;
    this.dropThrough = false;
    this.facing = 1;
    this.aimAngle = 0;
    this.aimPunch = 0;

    this.maxHealth = this.hero.stats.health;
    this.health = this.maxHealth;
    this.alive = true;
    this.respawnTimer = 0;
    this.spawnProtect = COMBAT.spawnProtection;

    this.fuel = FUEL.max;
    this.fuelDelay = 0;
    this.thrusting = false;

    this.slots = { primary: null, sidearm: makeAmmo(this.hero.sidearm) };
    this.activeSlot = 'sidearm';
    this.grenades = COMBAT.grenadeStartAmmo;

    this.fireTimer = 0;
    this.meleeTimer = 0;
    this.grenadeTimer = 0;
    this.heat = 0;
    this.wasFiring = false;

    this.ability = {
      def: this.hero.ability,
      cooldown: 0,
      active: 0,
      dirX: 1, dirY: 0,
    };
    this.invuln = 0;
    this.deflecting = false;
    this.shielded = false;
    this.cloak = 0;        // 0 = visible, 1 = fully cloaked
    this.burnTick = 0;

    // Scaled down for low-difficulty bots so the weapon tables stay honest.
    this.outgoingDamageScale = 1;
    this.brain = null;

    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.damageDealt = 0;
    this.lastHitBy = null;
    this.lastHitAt = -99;

    // purely cosmetic state consumed by the renderer
    this.anim = { walk: 0, lean: 0, hurt: 0, recoil: 0, land: 0, muzzle: 0 };
    this.input = blankInput();
  }

  get stats() { return this.hero.stats; }
  get weaponId() { return this.slots[this.activeSlot]?.id || this.hero.sidearm; }
  get weapon() { return WEAPONS[this.weaponId]; }
  get ammo() { return this.slots[this.activeSlot] || this.slots.sidearm; }
  get moveSpeed() {
    let m = this.stats.speed;
    if (this.ability.active > 0 && this.ability.def.id === 'ghost') m *= this.ability.def.speed;
    return PHYS.moveMax * m;
  }

  // ------------------------------------------------------------------
  // main update
  // ------------------------------------------------------------------
  update(dt, input, world) {
    this.input = input;

    if (!this.alive) {
      this.respawnTimer -= dt;
      this.anim.hurt = Math.max(0, this.anim.hurt - dt * 2);
      return;
    }

    this.spawnProtect = Math.max(0, this.spawnProtect - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    this.grenadeTimer = Math.max(0, this.grenadeTimer - dt);
    this.ability.cooldown = Math.max(0, this.ability.cooldown - dt);
    this.aimPunch = damp(this.aimPunch, 0, 0.0001, dt);
    this.anim.hurt = Math.max(0, this.anim.hurt - dt * 3);
    this.anim.recoil = damp(this.anim.recoil, 0, 0.00002, dt);
    this.anim.muzzle = Math.max(0, this.anim.muzzle - dt);
    this.anim.land = Math.max(0, this.anim.land - dt * 3);

    this._aim(input);
    this._ability(dt, input, world);
    this._move(dt, input, world);
    this._weapons(dt, input, world);
    this._cosmetics(dt);
  }

  _aim(input) {
    const dx = input.aimX - this.x;
    const dy = input.aimY - (this.y - 4);
    if (dx * dx + dy * dy > 4) this.aimAngle = Math.atan2(dy, dx);
    if (Math.abs(dx) > 6) this.facing = dx < 0 ? -1 : 1;
  }

  _move(dt, input, world) {
    const map = world.map;
    const dashing = this.ability.active > 0 && this.ability.def.id === 'dash';
    const lunging = this.ability.active > 0 && this.ability.def.id === 'iaido';

    if (dashing || lunging) {
      // Ability-driven motion overrides normal control for its duration.
      const spd = dashing ? this.ability.def.speed : this.ability.def.lunge;
      this.vx = this.ability.dirX * spd;
      this.vy = this.ability.dirY * spd * 0.85;
    } else {
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const accel = this.onGround ? PHYS.groundAccel : PHYS.airAccel;
      const max = this.moveSpeed;
      if (dir !== 0) {
        this.vx += dir * accel * dt;
        if (Math.abs(this.vx) > max) this.vx = sign(this.vx) * Math.max(max, Math.abs(this.vx) * Math.pow(0.02, dt));
      } else {
        this.vx = damp(this.vx, 0, this.onGround ? PHYS.groundDrag : PHYS.airDrag, dt);
      }

      // ---- jetpack ----
      const burning = this.ability.active > 0 && this.ability.def.id === 'afterburn';
      const canThrust = burning || this.fuel > (this.thrusting ? 0 : FUEL.minToStart);
      this.thrusting = input.jet && canThrust;
      if (this.thrusting) {
        const mult = burning ? this.ability.def.thrust : 1;
        this.vy -= PHYS.jetThrust * mult * dt;
        if (this.vy < -PHYS.jetMaxUp * mult) this.vy = -PHYS.jetMaxUp * mult;
        if (!burning) {
          this.fuel = Math.max(0, this.fuel - (FUEL.drain / this.stats.fuel) * dt);
          this.fuelDelay = FUEL.regenDelay;
        }
        world.particles.jet(
          this.x + rand(-4, 4), this.y + this.hh - 4, Math.PI / 2 + rand(-0.3, 0.3),
          burning ? '#ff9a4d' : this.hero.palette.visor, burning ? 1.5 : 1,
        );
      } else {
        this.fuelDelay = Math.max(0, this.fuelDelay - dt);
        if (this.fuelDelay <= 0) {
          this.fuel = Math.min(FUEL.max, this.fuel + FUEL.regen * this.stats.fuelRegen * dt);
        }
      }

      this.vy += PHYS.gravity * dt;
      if (this.vy > PHYS.maxFall) this.vy = PHYS.maxFall;

      // Wall slide takes the sting out of vertical arenas.
      if (!this.onGround && this.onWall !== 0 && this.vy > PHYS.wallSlideSpeed && dir === this.onWall) {
        this.vy = PHYS.wallSlideSpeed;
      }
    }

    this.dropThrough = input.down && !this.thrusting;
    const hit = moveBody(this, map, dt);

    if (hit.down && hit.landedAt > 400) {
      this.anim.land = Math.min(1, hit.landedAt / 900);
      if (hit.landedAt > COMBAT.fallDamageSpeed && !dashing) {
        const dmg = (hit.landedAt - COMBAT.fallDamageSpeed) * COMBAT.fallDamageScale;
        if (dmg > 2) world.damage(this, dmg, { cause: 'fall' });
      }
      world.particles.impact(this.x, this.y + this.hh, -Math.PI / 2, '#cbd5f0', 5);
    }
    if ((hit.left || hit.right) && (dashing || lunging)) this.ability.active = 0;
  }

  _weapons(dt, input, world) {
    const a = this.ammo;
    const w = this.weapon;

    if (input.swap) this.swapSlot();
    if (input.reload) this.startReload();

    if (a.reloading > 0) {
      a.reloading -= dt;
      if (a.reloading <= 0) this.finishReload();
    }

    // sustained-fire bloom
    this.heat = input.fire ? Math.min(1, this.heat + dt * 1.6) : Math.max(0, this.heat - dt * 2.4);

    const overcharged = this.ability.active > 0 && this.ability.def.id === 'overcharge';
    const rateMul = overcharged ? this.ability.def.fireRate : 1;

    const wantsFire = input.fire && (w.auto || !this.wasFiring);
    if (wantsFire && this.fireTimer <= 0 && a.reloading <= 0) {
      if (a.mag > 0) {
        this.shoot(world);
        this.fireTimer = shotInterval(w) / rateMul;
      } else {
        this.startReload();
      }
    }
    this.wasFiring = input.fire;

    if (input.melee && this.meleeTimer <= 0) {
      this.meleeTimer = COMBAT.meleeCooldown;
      world.melee(this);
    }
    if (input.grenade && this.grenadeTimer <= 0 && this.grenades > 0) {
      this.grenadeTimer = COMBAT.grenadeCooldown;
      this.grenades--;
      world.throwGrenade(this);
    }
  }

  _cosmetics(dt) {
    const speed = Math.abs(this.vx);
    this.anim.walk += (this.onGround ? speed : speed * 0.25) * dt * 0.035;
    const target = clamp(this.vx / PHYS.moveMax, -1, 1) * 0.22;
    this.anim.lean = damp(this.anim.lean, target, 0.0005, dt);
    if (this.ability.active > 0 && this.ability.def.id === 'ghost') {
      this.cloak = damp(this.cloak, 1, 0.0005, dt);
    } else {
      this.cloak = damp(this.cloak, 0, 0.0001, dt);
    }
  }

  // ------------------------------------------------------------------
  // weapons
  // ------------------------------------------------------------------
  muzzlePoint() {
    const w = this.weapon;
    const len = w.kind === 'hitscan' ? 30 : 26;
    const a = this.aimAngle;
    return {
      x: this.x + Math.cos(a) * len,
      y: this.y - 4 + Math.sin(a) * len,
      a,
    };
  }

  shoot(world) {
    const w = this.weapon;
    const a = this.ammo;
    a.mag--;
    this.spawnProtect = 0;
    if (this.ability.active > 0 && this.ability.def.id === 'ghost') this.ability.active = 0;

    const m = this.muzzlePoint();
    const bloom = (w.spread || 0) + (w.spreadGrow ? Math.min(w.spreadMax, this.heat * w.spreadMax) : 0);
    const overcharged = this.ability.active > 0 && this.ability.def.id === 'overcharge';
    const dmgMul = this.stats.damage;

    for (let i = 0; i < (w.pellets || 1); i++) {
      const ang = m.a + this.aimPunch + rand(-bloom, bloom);
      if (w.kind === 'hitscan') {
        world.hitscan(this, m.x, m.y, ang, w, w.damage * dmgMul);
      } else {
        const p = bulletFromWeapon(w, {
          x: m.x, y: m.y,
          vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
          damage: w.damage * dmgMul,
          ownerId: this.id, ownerTeam: this.team,
          chain: overcharged ? this.ability.def : null,
        });
        world.spawnProjectile(p);
      }
    }

    // recoil pushes the shooter, which is a core part of jetpack duelling
    const kick = w.recoil * (this.onGround ? 0.55 : 1);
    this.vx -= Math.cos(m.a) * kick;
    this.vy -= Math.sin(m.a) * kick * 0.62;
    this.aimPunch += rand(-1, 1) * w.aimKick;
    this.anim.recoil = 1;
    this.anim.muzzle = 0.06;

    world.particles.muzzle(m.x, m.y, m.a, w.color, w.pellets > 3 ? 1.6 : 1);
    if (w.kind !== 'hitscan') world.particles.shell(this.x, this.y - 6, this.facing);
    world.onShot(this, w, m, overcharged);
  }

  startReload() {
    const a = this.ammo;
    const w = WEAPONS[a.id];
    if (a.reloading > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
    a.reloading = w.reload;
    return true;
  }

  finishReload() {
    const a = this.ammo;
    const w = WEAPONS[a.id];
    const need = w.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    if (a.reserve !== Infinity) a.reserve -= take;
    a.reloading = 0;
    this.heat = 0;
  }

  swapSlot() {
    if (!this.slots.primary) return;
    this.activeSlot = this.activeSlot === 'primary' ? 'sidearm' : 'primary';
    this.fireTimer = Math.max(this.fireTimer, 0.22);
    this.heat = 0;
  }

  givePrimary(weaponId) {
    this.slots.primary = makeAmmo(weaponId);
    this.activeSlot = 'primary';
    this.fireTimer = Math.max(this.fireTimer, 0.25);
    this.heat = 0;
  }

  /** Called when a primary runs completely dry. */
  dropEmptyPrimary() {
    const p = this.slots.primary;
    if (!p) return;
    if (p.mag <= 0 && p.reserve <= 0 && p.reloading <= 0) {
      this.slots.primary = null;
      this.activeSlot = 'sidearm';
    }
  }

  giveAmmo() {
    let gave = false;
    for (const slot of ['primary', 'sidearm']) {
      const a = this.slots[slot];
      if (!a || a.reserve === Infinity) continue;
      const w = WEAPONS[a.id];
      const before = a.reserve;
      a.reserve = Math.min(w.reserve, a.reserve + Math.ceil(w.reserve * 0.5));
      if (a.reserve !== before) gave = true;
    }
    if (this.grenades < COMBAT.grenadeMaxAmmo) { this.grenades++; gave = true; }
    return gave;
  }

  // ------------------------------------------------------------------
  // ability
  // ------------------------------------------------------------------
  _ability(dt, input, world) {
    const ab = this.ability;
    const def = ab.def;

    if (ab.active > 0) {
      ab.active -= dt;
      if (def.id === 'iaido') {
        this.deflecting = true;
        world.iaidoSweep(this);
      }
      if (def.id === 'aegis') this.shielded = true;
      if (def.id === 'afterburn') {
        this.burnTick -= dt;
        world.particles.jet(this.x + rand(-6, 6), this.y + rand(-6, 10), rand(0, TAU), '#ff7a3d', 1.2);
        if (this.burnTick <= 0) {
          this.burnTick = 0.25;
          world.burnAura(this, def.burnDamage * 0.25, def.burnRadius + 24);
        }
      }
      if (ab.active <= 0) {
        this.deflecting = false;
        this.shielded = false;
        ab.active = 0;
      }
      return;
    }

    this.deflecting = false;
    this.shielded = false;

    if (input.ability && ab.cooldown <= 0) {
      ab.cooldown = def.cooldown;
      ab.active = def.duration;
      ab.dirX = Math.cos(this.aimAngle);
      ab.dirY = Math.sin(this.aimAngle);
      if (def.id === 'dash') {
        this.invuln = def.invuln;
        world.particles.spawnBurst(this.x, this.y, this.hero.palette.accent);
      }
      if (def.id === 'iaido') world.particles.spawnBurst(this.x, this.y, this.hero.palette.accent);
      if (def.id === 'aegis' || def.id === 'overcharge' || def.id === 'afterburn' || def.id === 'ghost') {
        world.particles.spawnBurst(this.x, this.y, this.hero.palette.glow);
      }
      world.onAbility(this, def);
    }
  }

  abilityReady() { return this.ability.cooldown <= 0 && this.alive; }

  /** Fraction of damage that gets through defensive state, 0..1. */
  damageMultiplierFrom(srcX, srcY) {
    if (this.invuln > 0 || this.spawnProtect > 0) return 0;
    let mul = 1 - (this.stats.armor || 0);
    if (this.shielded) {
      const toSrc = Math.atan2(srcY - this.y, srcX - this.x);
      let d = Math.abs(((toSrc - this.aimAngle + Math.PI * 3) % TAU) - Math.PI);
      if (d < this.ability.def.arc / 2) mul *= 1 - this.ability.def.absorb;
    }
    return Math.max(0, mul);
  }

  reset(spawn) {
    this.x = spawn.x; this.y = spawn.y;
    this.vx = 0; this.vy = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.fuel = FUEL.max;
    this.fuelDelay = 0;
    this.spawnProtect = COMBAT.spawnProtection;
    this.invuln = 0;
    this.heat = 0;
    this.slots.primary = null;
    this.slots.sidearm = makeAmmo(this.hero.sidearm);
    this.activeSlot = 'sidearm';
    this.grenades = COMBAT.grenadeStartAmmo;
    this.ability.active = 0;
    this.ability.cooldown = 0;
    this.deflecting = false;
    this.shielded = false;
    this.cloak = 0;
    this.respawnTimer = 0;
    this.anim.hurt = 0;
  }

  /** Compact state for the wire. */
  netState() {
    return {
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      vx: Math.round(this.vx), vy: Math.round(this.vy),
      a: Math.round(this.aimAngle * 100) / 100,
      f: this.facing,
      hp: Math.round(this.health),
      al: this.alive ? 1 : 0,
      fu: Math.round(this.fuel * 100) / 100,
      th: this.thrusting ? 1 : 0,
      w: this.weaponId,
      ab: this.ability.active > 0 ? 1 : 0,
      ck: Math.round(this.cloak * 100) / 100,
    };
  }

  applyNetState(s) {
    this.x = s.x; this.y = s.y;
    this.vx = s.vx; this.vy = s.vy;
    this.aimAngle = s.a;
    this.facing = s.f;
    this.health = s.hp;
    this.alive = !!s.al;
    this.fuel = s.fu;
    this.thrusting = !!s.th;
    this.cloak = s.ck ?? 0;
    this.ability.active = s.ab ? 0.2 : 0;
    if (s.w && this.weaponId !== s.w) {
      if (WEAPONS[s.w]?.slot === 'primary') { this.slots.primary = makeAmmo(s.w); this.activeSlot = 'primary'; }
      else { this.slots.sidearm = makeAmmo(s.w); this.activeSlot = 'sidearm'; }
    }
  }
}
