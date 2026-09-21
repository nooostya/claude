import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParlorBridge, normalizeSeed, PLAYER_ID } from '../src/core/parlor.js';
import { setSeed, clearSeed, random } from '../src/core/math.js';
import { World } from '../src/game/world.js';
import { buildMap } from '../src/game/maps.js';
import { BotBrain } from '../src/game/ai.js';
import { HEROES } from '../src/game/characters.js';

/** A stand-in for window.Parlor that records everything it is asked to do. */
function fakeSdk() {
  const calls = { player: [], scores: [], roundEnd: 0, onStart: [], onEnd: [] };
  return {
    calls,
    player: (id) => calls.player.push(id),
    reportScore: (s) => calls.scores.push(s),
    onRoundStart: (cb) => calls.onStart.push(cb),
    onRoundEnd: (cb) => { if (cb) calls.onEnd.push(cb); else calls.roundEnd++; },
    fireStart: (seed, ctx) => calls.onStart[0](seed, ctx),
    fireEnd: () => calls.onEnd[0](),
  };
}

function fakeHost(score = 0) {
  return {
    score,
    started: [],
    stopped: 0,
    parlorStartRun(seed, autoStart) { this.started.push({ seed, autoStart }); },
    parlorStopRun() { this.stopped++; },
    parlorScore() { return this.score; },
  };
}

test('with no window.Parlor the bridge is inert', () => {
  const host = fakeHost();
  const bridge = new ParlorBridge(host, undefined);
  assert.equal(bridge.available, false);
  assert.equal(bridge.init(), false);
  bridge.reportScore(5);
  bridge.finish(9);
  assert.equal(host.started.length, 0);
  assert.equal(host.stopped, 0);
});

test('init registers the player and both handlers exactly once', () => {
  const sdk = fakeSdk();
  const bridge = new ParlorBridge(fakeHost(), sdk);
  assert.equal(bridge.init(), true);
  assert.deepEqual(sdk.calls.player, [PLAYER_ID]);
  assert.match(PLAYER_ID, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(sdk.calls.onStart.length, 1);
  assert.equal(sdk.calls.onEnd.length, 1);
  assert.equal(sdk.calls.roundEnd, 0, 'init must not submit a game over');
});

test('autoStart false follows the original opening flow', () => {
  const sdk = fakeSdk();
  const host = fakeHost();
  new ParlorBridge(host, sdk).init();
  sdk.fireStart(42, { autoStart: false });
  assert.deepEqual(host.started, [{ seed: 42, autoStart: false }]);
});

test('autoStart true, and missing context, start gameplay directly', () => {
  for (const ctx of [{ autoStart: true }, undefined, null, {}]) {
    const sdk = fakeSdk();
    const host = fakeHost();
    new ParlorBridge(host, sdk).init();
    sdk.fireStart(7, ctx);
    assert.equal(host.started[0].autoStart, true, `context ${JSON.stringify(ctx)}`);
  }
});

test('scores are reported on change, deduped, and only during a round', () => {
  const sdk = fakeSdk();
  const bridge = new ParlorBridge(fakeHost(), sdk);
  bridge.init();

  bridge.reportScore(3);
  assert.deepEqual(sdk.calls.scores, [], 'no reporting outside a round');

  sdk.fireStart(1, { autoStart: true });
  bridge.reportScore(0, true);
  bridge.reportScore(0);          // unchanged, skipped
  bridge.reportScore(1);
  bridge.reportScore(1);          // unchanged, skipped
  bridge.reportScore(2);
  bridge.reportScore(1);          // scores may go down (suicide); still reported
  bridge.reportScore(NaN);        // never report a non-finite value
  bridge.reportScore(Infinity);
  assert.deepEqual(sdk.calls.scores, [0, 1, 2, 1]);
});

test('a definitive finish reports the final score and submits once', () => {
  const sdk = fakeSdk();
  const bridge = new ParlorBridge(fakeHost(), sdk);
  bridge.init();
  sdk.fireStart(1, { autoStart: true });
  bridge.reportScore(4);
  bridge.finish(6);
  bridge.finish(6);               // idempotent
  bridge.finish(99);
  assert.deepEqual(sdk.calls.scores, [4, 6]);
  assert.equal(sdk.calls.roundEnd, 1, 'game over must be submitted exactly once');
});

test('a platform-forced end reports and stops without submitting back', () => {
  const sdk = fakeSdk();
  const host = fakeHost(11);
  const bridge = new ParlorBridge(host, sdk);
  bridge.init();
  sdk.fireStart(1, { autoStart: true });
  bridge.reportScore(5);

  sdk.fireEnd();
  assert.deepEqual(sdk.calls.scores, [5, 11], 'latest score is reported');
  assert.equal(host.stopped, 1, 'gameplay must stop');
  assert.equal(sdk.calls.roundEnd, 0, 'must not submit a game over to Parlor');

  bridge.finish(11);              // the game noticing afterwards changes nothing
  assert.equal(sdk.calls.roundEnd, 0);
});

test('a fresh round resets the guard so the next run can finish', () => {
  const sdk = fakeSdk();
  const bridge = new ParlorBridge(fakeHost(), sdk);
  bridge.init();

  sdk.fireStart(1, { autoStart: true });
  bridge.finish(3);
  assert.equal(sdk.calls.roundEnd, 1);

  sdk.fireStart(2, { autoStart: true });
  assert.equal(bridge.finalized, false);
  assert.equal(bridge.active, true);
  bridge.reportScore(0, true);
  bridge.finish(8);
  assert.equal(sdk.calls.roundEnd, 2);
  assert.deepEqual(sdk.calls.scores, [3, 0, 8]);
});

test('seeds fold to a uint32 from numbers or strings', () => {
  assert.equal(normalizeSeed(12345), 12345);
  assert.equal(normalizeSeed(-3.7), 3);
  assert.equal(normalizeSeed('abc'), normalizeSeed('abc'));
  assert.notEqual(normalizeSeed('abc'), normalizeSeed('abd'));
  for (const v of [undefined, null, NaN, 'x', 2 ** 40]) {
    const n = normalizeSeed(v);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, `bad seed for ${v}`);
  }
});

// ---------------------------------------------------------------------------
// the seed must actually drive gameplay
// ---------------------------------------------------------------------------

function runSeededMatch(seed, seconds = 12) {
  setSeed(seed);
  const world = new World(buildMap('foundry'), { mode: 'local', timeLimit: 1e9, scoreLimit: 1e9 });
  const brains = new Map();
  HEROES.slice(0, 4).forEach((h, i) => {
    const f = world.addFighter({ id: i + 1, name: `B${i}`, heroId: h.id, isBot: true });
    brains.set(f.id, new BotBrain(f, 0.7));
  });
  for (let i = 0; i < seconds * 60; i++) {
    const inputs = new Map();
    for (const f of world.fighters) inputs.set(f.id, brains.get(f.id).update(1 / 60, world));
    world.step(1 / 60, inputs);
    world.drainEvents();
  }
  clearSeed();
  return world.fighters.map((f) => `${f.kills}/${f.deaths}/${f.x.toFixed(2)}/${f.y.toFixed(2)}`).join('|');
}

test('the same seed reproduces the same run', () => {
  assert.equal(runSeededMatch(987654), runSeededMatch(987654));
});

test('different seeds produce different runs', () => {
  assert.notEqual(runSeededMatch(1), runSeededMatch(2));
});

test('clearSeed restores unseeded randomness', () => {
  setSeed(5);
  const a = random();
  setSeed(5);
  assert.equal(random(), a, 'reseeding should repeat');
  clearSeed();
  const samples = new Set();
  for (let i = 0; i < 50; i++) samples.add(random());
  assert.ok(samples.size > 40, 'unseeded randomness should vary');
});
