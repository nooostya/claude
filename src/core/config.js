// Central tuning table. Everything gameplay-feel lives here so it can be
// balanced without hunting through the simulation code.

export const TILE = 32;

export const SIM = {
  step: 1 / 60,          // fixed simulation step
  maxStepsPerFrame: 5,   // spiral-of-death guard
};

export const PHYS = {
  gravity: 1750,
  maxFall: 1250,
  playerW: 22,
  playerH: 34,
  groundAccel: 3400,
  airAccel: 2100,
  moveMax: 250,
  groundDrag: 0.00008,   // fraction of velocity left after 1s
  airDrag: 0.22,
  jetThrust: 3150,
  jetMaxUp: 460,
  jumpImpulse: 470,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  wallSlideSpeed: 140,
};

export const FUEL = {
  max: 1,
  drain: 0.46,           // per second of thrust
  regen: 0.30,           // per second while not thrusting
  regenDelay: 0.45,      // pause before regen kicks in
  minToStart: 0.06,      // stops fuel-tapping at empty
};

export const COMBAT = {
  respawnTime: 2.6,
  spawnProtection: 1.6,
  meleeCooldown: 0.55,
  meleeRange: 44,
  meleeDamage: 34,
  meleeKnockback: 430,
  grenadeCooldown: 1.1,
  grenadeFuse: 1.8,
  grenadeDamage: 78,
  grenadeRadius: 118,
  grenadeStartAmmo: 3,
  grenadeMaxAmmo: 5,
  fallDamageSpeed: 1150,  // vy above this on landing hurts
  fallDamageScale: 0.055,
};

export const MATCH = {
  scoreLimit: 20,
  timeLimit: 300,
  pickupRespawn: 11,
  healthPackAmount: 45,
};

export const RENDER = {
  baseWidth: 1060,       // virtual viewport the camera frames
  baseHeight: 600,
  minZoom: 0.70,
  maxZoom: 1.65,
  cameraLag: 0.0008,     // fraction remaining after 1s
  shakeDecay: 0.0009,
  maxShake: 26,
};

export const NET = {
  sendRate: 20,          // client state updates per second
  snapshotRate: 20,      // server broadcasts per second
  interpDelay: 0.1,      // render remote players this far in the past
  timeout: 12,           // seconds before a silent peer is dropped
  defaultPort: 8080,
};

export const BOT = {
  reactionTime: [0.12, 0.34],
  aimError: [0.02, 0.10],   // radians, by difficulty
  aimSpeed: [7, 14],
  thinkInterval: 0.1,
};
