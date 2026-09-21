// Weapon definitions. `kind` selects how a shot is resolved:
//   bullet     - travelling projectile, straight line, dies on impact
//   projectile - travelling projectile affected by gravity/explodes
//   hitscan    - instant beam, resolved the frame it is fired

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', short: 'P9', kind: 'bullet', slot: 'sidearm',
    damage: 19, rpm: 360, auto: false, spread: 0.014, pellets: 1,
    speed: 1450, life: 1.1, mag: 12, reload: 0.95, reserve: Infinity,
    recoil: 55, aimKick: 0.035, knockback: 90,
    tracer: 13, width: 2.4, color: '#ffe9a8', sfx: 'pistol',
  },
  machinePistol: {
    id: 'machinePistol', name: 'Sidewinder', short: 'SW', kind: 'bullet', slot: 'sidearm',
    damage: 10, rpm: 780, auto: true, spread: 0.055, pellets: 1,
    speed: 1300, life: 0.9, mag: 22, reload: 1.1, reserve: Infinity,
    recoil: 32, aimKick: 0.022, knockback: 55,
    tracer: 11, width: 2.1, color: '#ffd27a', sfx: 'smg',
  },
  handCannon: {
    id: 'handCannon', name: 'Verdict .50', short: 'V50', kind: 'bullet', slot: 'sidearm',
    damage: 42, rpm: 150, auto: false, spread: 0.012, pellets: 1,
    speed: 1700, life: 1.2, mag: 6, reload: 1.35, reserve: Infinity,
    recoil: 150, aimKick: 0.075, knockback: 240,
    tracer: 17, width: 3.2, color: '#ffc46b', sfx: 'cannon',
  },
  scattergun: {
    id: 'scattergun', name: 'Coilshot', short: 'CS', kind: 'bullet', slot: 'sidearm',
    damage: 9, rpm: 105, auto: false, spread: 0.17, pellets: 6,
    speed: 1180, life: 0.34, mag: 5, reload: 1.5, reserve: Infinity,
    recoil: 210, aimKick: 0.07, knockback: 120,
    tracer: 9, width: 2.2, color: '#ffb0d8', sfx: 'shotgun',
  },
  smg: {
    id: 'smg', name: 'Wasp SMG', short: 'SMG', kind: 'bullet', slot: 'primary',
    damage: 12, rpm: 920, auto: true, spread: 0.05, pellets: 1,
    speed: 1400, life: 1.0, mag: 34, reload: 1.35, reserve: 136,
    recoil: 34, aimKick: 0.018, knockback: 60,
    tracer: 12, width: 2.2, color: '#a8f0ff', sfx: 'smg',
  },
  rifle: {
    id: 'rifle', name: 'Vanguard AR', short: 'AR', kind: 'bullet', slot: 'primary',
    damage: 18, rpm: 610, auto: true, spread: 0.027, pellets: 1,
    speed: 1750, life: 1.3, mag: 30, reload: 1.6, reserve: 120,
    recoil: 60, aimKick: 0.026, knockback: 95,
    tracer: 16, width: 2.6, color: '#b6ffb0', sfx: 'rifle',
  },
  shotgun: {
    id: 'shotgun', name: 'Breaker 12', short: 'SG', kind: 'bullet', slot: 'primary',
    damage: 11, rpm: 80, auto: false, spread: 0.155, pellets: 9,
    speed: 1250, life: 0.42, mag: 6, reload: 2.0, reserve: 30,
    recoil: 330, aimKick: 0.1, knockback: 150,
    tracer: 10, width: 2.4, color: '#ffd0a0', sfx: 'shotgun',
  },
  lmg: {
    id: 'lmg', name: 'Hailstorm', short: 'LMG', kind: 'bullet', slot: 'primary',
    damage: 15, rpm: 740, auto: true, spread: 0.032, spreadGrow: 0.008, spreadMax: 0.12,
    pellets: 1, speed: 1650, life: 1.3, mag: 75, reload: 3.1, reserve: 225,
    recoil: 62, aimKick: 0.02, knockback: 105,
    tracer: 15, width: 2.8, color: '#ffe066', sfx: 'rifle',
  },
  rail: {
    id: 'rail', name: 'Longshot Rail', short: 'RAIL', kind: 'hitscan', slot: 'primary',
    damage: 88, rpm: 48, auto: false, spread: 0.002, pellets: 1,
    range: 2600, pierce: 3, mag: 5, reload: 2.3, reserve: 20,
    recoil: 240, aimKick: 0.05, knockback: 320,
    width: 3.5, color: '#c9a8ff', sfx: 'rail',
  },
  rocket: {
    id: 'rocket', name: 'Havoc RPG', short: 'RPG', kind: 'projectile', slot: 'primary',
    damage: 42, rpm: 46, auto: false, spread: 0.01, pellets: 1,
    speed: 780, life: 3.2, gravity: 180, mag: 1, reload: 2.4, reserve: 6,
    recoil: 260, aimKick: 0.06, knockback: 0,
    explosive: { radius: 128, damage: 84, knockback: 640 },
    width: 6, color: '#ff8a5c', sfx: 'rocket',
  },
  plasma: {
    id: 'plasma', name: 'Ion Lance', short: 'ION', kind: 'projectile', slot: 'primary',
    damage: 30, rpm: 210, auto: true, spread: 0.02, pellets: 1,
    speed: 980, life: 1.8, gravity: 0, mag: 20, reload: 1.9, reserve: 80,
    recoil: 80, aimKick: 0.03, knockback: 200,
    explosive: { radius: 58, damage: 20, knockback: 240 },
    width: 5, color: '#7ce0ff', sfx: 'plasma',
  },
};

/** Weapons that can appear in world crates, with relative drop weights. */
export const PRIMARY_DROPS = [
  ['smg', 16], ['rifle', 16], ['shotgun', 13], ['lmg', 10],
  ['rail', 8], ['plasma', 9], ['rocket', 6],
];

export function rollPrimary(rng = Math.random) {
  const total = PRIMARY_DROPS.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [id, w] of PRIMARY_DROPS) {
    r -= w;
    if (r <= 0) return id;
  }
  return 'smg';
}

export const shotInterval = (w) => 60 / w.rpm;

/** Fresh ammo record for a weapon id. */
export function makeAmmo(id) {
  const w = WEAPONS[id];
  return { id, mag: w.mag, reserve: w.reserve, reloading: 0, heat: 0, cooldown: 0 };
}
