// Projectiles and world pickups. These are dumb data holders — the World owns
// their update loop because collision needs the full fighter list.

import { WEAPONS } from './weapons.js';

let nextId = 1;
export const freshId = () => nextId++;

export class Projectile {
  constructor(o) {
    this.id = freshId();
    this.type = o.type || 'bullet';       // bullet | rocket | plasma | grenade
    this.x = o.x; this.y = o.y;
    this.px = o.x; this.py = o.y;         // previous position, for sweep tests
    this.vx = o.vx; this.vy = o.vy;
    this.damage = o.damage;
    this.ownerId = o.ownerId;
    this.ownerTeam = o.ownerTeam ?? -1;
    this.weaponId = o.weaponId || null;
    this.life = o.life ?? 1.2;
    this.gravity = o.gravity ?? 0;
    this.explosive = o.explosive || null;
    this.knockback = o.knockback ?? 0;
    this.color = o.color || '#fff';
    this.width = o.width ?? 2.4;
    this.tracer = o.tracer ?? 12;
    this.pierce = o.pierce ?? 0;
    this.bounce = o.bounce ?? 0;
    this.fuse = o.fuse ?? 0;
    this.spin = 0;
    this.rot = Math.atan2(o.vy, o.vx);
    this.hitIds = new Set();
    this.dead = false;
    this.chain = o.chain || null;         // Bolt's Overcharge rider
    this.remote = !!o.remote;             // spawned from a network event
    // Visual-only projectiles come from another client. They are drawn and
    // they explode for show, but they never deal damage here: the shooter's
    // own client resolves its hits and reports them to the server.
    this.visualOnly = !!o.visualOnly;
  }
}

export function bulletFromWeapon(weapon, opts) {
  const w = typeof weapon === 'string' ? WEAPONS[weapon] : weapon;
  return new Projectile({
    type: w.kind === 'projectile' ? (w.id === 'rocket' ? 'rocket' : 'plasma') : 'bullet',
    weaponId: w.id,
    life: w.life,
    gravity: w.gravity || 0,
    explosive: w.explosive || null,
    knockback: w.knockback || 0,
    color: w.color,
    width: w.width,
    tracer: w.tracer ?? 12,
    pierce: w.pierce || 0,
    ...opts,
  });
}

export const PICKUP_KINDS = {
  weapon: { label: 'WEAPON', color: '#7ce0ff', radius: 17 },
  health: { label: 'MEDKIT', color: '#3dff9a', radius: 15 },
  ammo: { label: 'AMMO', color: '#ffd166', radius: 14 },
  grenade: { label: 'NADES', color: '#ff8a5c', radius: 14 },
};

export class Pickup {
  constructor(kind, x, y, opts = {}) {
    this.id = freshId();
    // Stable across clients: derived from the map's authored spot list, not
    // from a runtime counter, so `netId` can be used as a wire identifier.
    this.netId = opts.netId || `${kind[0]}${opts.index ?? 0}`;
    this.kind = kind;
    this.x = x; this.y = y;
    this.homeX = x; this.homeY = y;
    this.weaponId = opts.weaponId || null;
    this.amount = opts.amount || 0;
    this.active = true;
    this.timer = 0;
    this.bob = Math.random() * Math.PI * 2;
    this.spin = 0;
    this.radius = PICKUP_KINDS[kind].radius;
    this.requested = 0;
  }

  consume(respawn) {
    this.active = false;
    this.timer = respawn;
  }
}
