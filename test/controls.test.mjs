import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchButtonLayout, THUMB_ZONES } from '../src/core/input.js';
import { DIFFICULTIES } from '../src/game/ai.js';
import { BOT, RENDER } from '../src/core/config.js';
import { Camera } from '../src/render/camera.js';

// Real phone viewports, both orientations.
const SCREENS = [
  ['iPhone SE landscape', 667, 375], ['iPhone SE portrait', 375, 667],
  ['iPhone 14 landscape', 844, 390], ['iPhone 14 portrait', 390, 844],
  ['Pixel 7 landscape', 915, 412], ['Pixel 7 portrait', 412, 915],
  ['small phone portrait', 320, 568], ['tablet landscape', 1180, 820],
];

for (const [name, cw, ch] of SCREENS) {
  test(`${name}: touch buttons stay out of the thumb zones`, () => {
    const zones = THUMB_ZONES(cw, ch);
    for (const b of touchButtonLayout(cw, ch)) {
      for (const z of zones) {
        // nearest point on the zone rectangle to the button centre
        const nx = Math.max(z.x0, Math.min(b.x, z.x1));
        const ny = Math.max(z.y0, Math.min(b.y, z.y1));
        const d = Math.hypot(b.x - nx, b.y - ny);
        assert.ok(d > b.r, `button ${b.label} (r=${b.r.toFixed(0)}) is ${d.toFixed(0)}px from a thumb zone`);
      }
    }
  });

  test(`${name}: touch buttons are fully on screen`, () => {
    for (const b of touchButtonLayout(cw, ch)) {
      assert.ok(b.x - b.r >= 0 && b.x + b.r <= cw, `button ${b.label} is off screen horizontally`);
      assert.ok(b.y - b.r >= 0 && b.y + b.r <= ch, `button ${b.label} is off screen vertically`);
    }
  });

  test(`${name}: touch buttons do not overlap each other`, () => {
    const all = touchButtonLayout(cw, ch);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
        assert.ok(d > all[i].r + all[j].r - 2, `${all[i].label} and ${all[j].label} overlap`);
      }
    }
  });

  test(`${name}: the camera frames a usable slice of the arena`, () => {
    const cam = new Camera();
    cam.resize(cw, ch, 2);
    assert.ok(cam.zoom >= RENDER.minZoom && cam.zoom <= RENDER.maxZoom, 'zoom out of range');
    // enough world visible to see someone coming, and characters big enough to read
    assert.ok(cam.viewW >= 480, `only ${Math.round(cam.viewW)}px of world width visible`);
    assert.ok(cam.viewH >= 330, `only ${Math.round(cam.viewH)}px of world height visible`);
    assert.ok(cam.zoom >= 0.55, 'fighters would be too small to see');
  });
}

// ---------------------------------------------------------------------------
// difficulty has to actually move, in the right direction
// ---------------------------------------------------------------------------

test('difficulty values are ordered and span the full range', () => {
  const values = DIFFICULTIES.map((d) => d.value);
  assert.equal(values[0], 0);
  assert.equal(values[values.length - 1], 1);
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] > values[i - 1], `${DIFFICULTIES[i].id} is not harder than ${DIFFICULTIES[i - 1].id}`);
  }
});

test('every bot axis gets harder as difficulty rises', () => {
  const at = (pair, d) => pair[1] + (pair[0] - pair[1]) * d;
  for (let i = 1; i < DIFFICULTIES.length; i++) {
    const lo = DIFFICULTIES[i - 1].value, hi = DIFFICULTIES[i].value;
    const label = `${DIFFICULTIES[i - 1].id} -> ${DIFFICULTIES[i].id}`;
    assert.ok(at(BOT.aimError, hi) < at(BOT.aimError, lo), `${label}: aim should get tighter`);
    assert.ok(at(BOT.aimSpeed, hi) > at(BOT.aimSpeed, lo), `${label}: tracking should get faster`);
    assert.ok(at(BOT.reactionTime, hi) < at(BOT.reactionTime, lo), `${label}: reaction should get quicker`);
    assert.ok(at(BOT.burstOn, hi) > at(BOT.burstOn, lo), `${label}: bursts should get longer`);
    assert.ok(at(BOT.burstOff, hi) < at(BOT.burstOff, lo), `${label}: pauses should get shorter`);
    assert.ok(at(BOT.damageScale, hi) > at(BOT.damageScale, lo), `${label}: damage should rise`);
    assert.ok(at(BOT.focusLimit, hi) > at(BOT.focusLimit, lo), `${label}: more bots should swarm`);
  }
  assert.equal(at(BOT.damageScale, 1), 1, 'the hardest tier must deal full weapon damage');
});

// ---------------------------------------------------------------------------
// ...and that it changes the outcome of an actual match
// ---------------------------------------------------------------------------
import { World } from '../src/game/world.js';
import { buildMap } from '../src/game/maps.js';
import { BotBrain } from '../src/game/ai.js';
import { HEROES } from '../src/game/characters.js';
import { setSeed, clearSeed } from '../src/core/math.js';

/**
 * Score a player against bots of one difficulty. The "player" aims like a
 * human but is exempt from the bot-only handicaps (damage scaling, burst
 * discipline) — otherwise it gets nerfed alongside its opponents and the
 * measurement says nothing.
 */
function playerVsBots(difficulty, { seconds = 45, bots = 5, seeds = [11, 27] } = {}) {
  let kills = 0, deaths = 0;
  for (const seed of seeds) {
    setSeed(seed);
    const world = new World(buildMap('foundry'), { mode: 'local', timeLimit: 1e9, scoreLimit: 1e9 });
    const brains = new Map();

    const human = world.addFighter({ id: 1, name: 'HUMAN', heroId: 'nova', isBot: true });
    const hb = new BotBrain(human, 0.6);
    Object.defineProperty(hb, 'aimError', { get: () => 0.06 });
    Object.defineProperty(hb, 'aimSpeed', { get: () => 8 });
    Object.defineProperty(hb, 'reaction', { get: () => 0.3 });
    Object.defineProperty(hb, 'firing', { get: () => true, set: () => {} });
    human.outgoingDamageScale = 1;
    human.isBot = false;
    brains.set(human.id, hb);

    for (let i = 0; i < bots; i++) {
      const f = world.addFighter({ id: 10 + i, name: `B${i}`, heroId: HEROES[(i + 1) % 6].id, isBot: true });
      brains.set(f.id, new BotBrain(f, difficulty));
    }
    for (let i = 0; i < seconds * 60; i++) {
      const inputs = new Map();
      for (const f of world.fighters) inputs.set(f.id, brains.get(f.id).update(1 / 60, world));
      world.step(1 / 60, inputs);
      world.drainEvents();
    }
    kills += human.kills;
    deaths += human.deaths;
    clearSeed();
  }
  return { kills, deaths, kd: deaths ? kills / deaths : kills };
}

test('the easiest tier is decisively easier than the hardest', () => {
  const easy = playerVsBots(0);
  const hard = playerVsBots(1);
  assert.ok(easy.kd > hard.kd * 2,
    `Recruit K/D ${easy.kd.toFixed(2)} should far exceed Nightmare K/D ${hard.kd.toFixed(2)}`);
  assert.ok(easy.deaths < hard.deaths,
    `a player should die less against Recruit (${easy.deaths}) than Nightmare (${hard.deaths})`);
});

test('the default tier lets a player come out ahead but still lose fights', () => {
  const r = playerVsBots(0.3);   // DEFAULT_DIFFICULTY = soldier
  assert.ok(r.kd > 1.2, `default is still punishing: K/D ${r.kd.toFixed(2)}`);
  assert.ok(r.deaths > 0, 'the default should not be a walkover');
});
