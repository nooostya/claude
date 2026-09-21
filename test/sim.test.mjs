import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { buildMap, MAP_DEFS } from '../src/game/maps.js';
import { BotBrain, botNames } from '../src/game/ai.js';
import { HEROES } from '../src/game/characters.js';
import { overlapsSolid } from '../src/game/physics.js';
import { blankInput } from '../src/game/fighter.js';
import { WEAPONS } from '../src/game/weapons.js';

function runMatch(mapId, seconds, { heroes = HEROES.map((h) => h.id), difficulty = 0.7 } = {}) {
  const world = new World(buildMap(mapId), { mode: 'local', timeLimit: 1e9, scoreLimit: 1e9 });
  const brains = new Map();
  const names = botNames(heroes.length);
  heroes.forEach((heroId, i) => {
    const f = world.addFighter({ id: i + 1, name: names[i], heroId, isBot: true });
    brains.set(f.id, new BotBrain(f, difficulty));
  });

  const dt = 1 / 60;
  const stats = { kills: 0, nan: 0, stuck: 0, maxProjectiles: 0, shots: 0 };
  for (let i = 0; i < seconds * 60; i++) {
    const inputs = new Map();
    for (const f of world.fighters) inputs.set(f.id, brains.get(f.id).update(dt, world));
    world.step(dt, inputs);
    stats.maxProjectiles = Math.max(stats.maxProjectiles, world.projectiles.length);
    for (const ev of world.drainEvents()) if (ev.type === 'kill') stats.kills++;
    for (const f of world.fighters) {
      if (![f.x, f.y, f.vx, f.vy, f.health, f.fuel].every(Number.isFinite)) stats.nan++;
      if (f.alive && overlapsSolid(f, world.map)) stats.stuck++;
    }
  }
  return { world, stats };
}

for (const def of MAP_DEFS) {
  test(`${def.id}: a 60s bot match stays numerically sane`, () => {
    const { world, stats } = runMatch(def.id, 60);
    assert.equal(stats.nan, 0, 'a fighter went NaN');
    // A rare one-frame overlap after blast knockback is fine; a wedged bot is not.
    assert.ok(stats.stuck < 60 * 60 * world.fighters.length * 0.005, `bots spent ${stats.stuck} frames inside walls`);
    assert.ok(stats.maxProjectiles < 400, 'projectiles are not being cleaned up');
    for (const f of world.fighters) {
      assert.ok(f.health <= f.maxHealth + 0.001, `${f.name} exceeded max health`);
      assert.ok(f.fuel >= 0 && f.fuel <= 1.001, `${f.name} has impossible fuel`);
      assert.ok(f.x > 0 && f.x < world.map.width, `${f.name} left the arena`);
    }
  });

  test(`${def.id}: bots actually fight`, () => {
    const { stats } = runMatch(def.id, 60);
    assert.ok(stats.kills > 0, 'no kills in a full minute of combat');
  });
}

test('every hero can use its ability without throwing', () => {
  const world = new World(buildMap('foundry'), { mode: 'local' });
  const fighters = HEROES.map((h, i) => world.addFighter({ id: i + 1, heroId: h.id, name: h.name }));
  const inputs = new Map();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 12; i++) {
    for (const f of fighters) {
      const inp = blankInput();
      inp.ability = f.abilityReady();
      inp.fire = i % 7 === 0;
      inp.aimX = f.x + 200; inp.aimY = f.y;
      inputs.set(f.id, inp);
    }
    world.step(dt, inputs);
    world.drainEvents();
  }
  for (const f of fighters) {
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), `${f.heroId} broke its position`);
  }
});

test('every weapon fires, reloads and runs dry without throwing', () => {
  for (const id of Object.keys(WEAPONS)) {
    const world = new World(buildMap('foundry'), { mode: 'local' });
    const a = world.addFighter({ id: 1, heroId: 'nova', name: 'A' });
    const b = world.addFighter({ id: 2, heroId: 'titan', name: 'B' });
    a.x = 400; a.y = world.map.groundBelow(400, 100) - a.hh - 1;
    b.x = a.x + 220; b.y = a.y;
    if (WEAPONS[id].slot === 'primary') a.givePrimary(id); else { a.slots.sidearm = { ...a.slots.sidearm, id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, reloading: 0 }; a.activeSlot = 'sidearm'; }
    const inputs = new Map();
    for (let i = 0; i < 60 * 8; i++) {
      a.spawnProtect = 0; b.spawnProtect = 0;
      const inp = blankInput();
      inp.fire = i % 2 === 0;        // release between shots so semi-autos cycle
      inp.aimX = b.x; inp.aimY = b.y;
      inputs.set(1, inp);
      inputs.set(2, blankInput());
      world.step(1 / 60, inputs);
      world.drainEvents();
    }
    assert.ok(Number.isFinite(a.x), `${id} broke the shooter`);
    assert.ok(b.deaths > 0 || b.health < b.maxHealth, `${id} never damaged a stationary target`);
  }
});

test('a match ends when the score limit is reached', () => {
  const world = new World(buildMap('undercity'), { mode: 'local', scoreLimit: 3, timeLimit: 1e9 });
  const a = world.addFighter({ id: 1, heroId: 'nova', name: 'A' });
  const b = world.addFighter({ id: 2, heroId: 'vex', name: 'B' });
  for (let i = 0; i < 3; i++) {
    b.spawnProtect = 0;
    world.damage(b, 9999, { byId: a.id, weapon: 'rifle' });
    if (!world.over) world.respawn(b);
  }
  assert.equal(world.over, true);
  assert.equal(world.winner?.id, a.id);
  assert.equal(a.kills, 3);
});

test('online mode reports hits on remote players instead of applying them', () => {
  const world = new World(buildMap('foundry'), { mode: 'online', localId: 1 });
  const me = world.addFighter({ id: 1, heroId: 'nova', name: 'ME', isLocal: true });
  const them = world.addFighter({ id: 2, heroId: 'bolt', name: 'THEM', isRemote: true });
  them.spawnProtect = 0;
  const before = them.health;
  world.damage(them, 40, { byId: me.id, weapon: 'rifle', x: them.x, y: them.y });
  const events = world.drainEvents();
  assert.equal(them.health, before, 'remote health must come from the owning client');
  assert.ok(events.some((e) => e.type === 'hitReport' && e.targetId === 2), 'no hit report emitted');
});

test('spawn protection and invulnerability block damage', () => {
  const world = new World(buildMap('foundry'), { mode: 'local' });
  const a = world.addFighter({ id: 1, heroId: 'nova', name: 'A' });
  const b = world.addFighter({ id: 2, heroId: 'nova', name: 'B' });
  assert.equal(world.damage(b, 50, { byId: a.id }), 0, 'spawn protection did not hold');
  b.spawnProtect = 0;
  assert.ok(world.damage(b, 50, { byId: a.id }) > 0, 'damage never lands');
});

test("Titan's armour reduces damage and Aegis blocks frontal fire", () => {
  const world = new World(buildMap('foundry'), { mode: 'local' });
  const t = world.addFighter({ id: 1, heroId: 'titan', name: 'T' });
  t.spawnProtect = 0;
  const plain = world.damage(t, 100, { byId: 2, x: t.x + 100, y: t.y });
  assert.ok(plain < 100 && plain > 50, `armour maths is off: ${plain}`);

  t.health = t.maxHealth;
  t.aimAngle = 0;                 // facing right
  t.ability.active = 1;
  t.shielded = true;
  const shielded = world.damage(t, 100, { byId: 2, x: t.x + 100, y: t.y });
  assert.ok(shielded < plain * 0.4, `Aegis barely helped: ${shielded} vs ${plain}`);
});
