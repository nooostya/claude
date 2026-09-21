import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_DEFS, buildMap, SOLID } from '../src/game/maps.js';
import { TILE } from '../src/core/config.js';

// A player occupies roughly two tiles vertically, so every authored spawn and
// pickup spot needs its own tile plus the one above it clear.
for (const def of MAP_DEFS) {
  test(`${def.id}: spawns are in open air`, () => {
    const map = buildMap(def.id);
    for (const [tx, ty] of def.spawns) {
      assert.notEqual(map.tileAt(tx, ty), SOLID, `spawn ${tx},${ty} is inside a wall`);
      assert.notEqual(map.tileAt(tx, ty - 1), SOLID, `spawn ${tx},${ty} has no headroom`);
    }
  });

  test(`${def.id}: pickup spots are reachable`, () => {
    const map = buildMap(def.id);
    for (const key of ['crates', 'health']) {
      for (const [tx, ty] of def[key]) {
        assert.notEqual(map.tileAt(tx, ty), SOLID, `${key} ${tx},${ty} is inside a wall`);
      }
    }
  });

  test(`${def.id}: arena is sealed by a solid border`, () => {
    const map = buildMap(def.id);
    for (let x = 0; x < map.tw; x++) {
      assert.equal(map.tileAt(x, 0), SOLID, `ceiling gap at x=${x}`);
      assert.equal(map.tileAt(x, map.th - 1), SOLID, `floor gap at x=${x}`);
    }
    for (let y = 0; y < map.th; y++) {
      assert.equal(map.tileAt(0, y), SOLID, `left wall gap at y=${y}`);
      assert.equal(map.tileAt(map.tw - 1, y), SOLID, `right wall gap at y=${y}`);
    }
  });

  test(`${def.id}: every spawn has ground beneath it`, () => {
    const map = buildMap(def.id);
    for (const s of map.spawns) {
      const g = map.groundBelow(s.x, s.y);
      assert.ok(g < map.height, `spawn at ${s.x},${s.y} floats over the void`);
      assert.ok(g - s.y < 26 * TILE, `spawn at ${s.x},${s.y} is a very long drop`);
    }
  });

  test(`${def.id}: spawns are spread out`, () => {
    const map = buildMap(def.id);
    assert.ok(map.spawns.length >= 8, 'needs at least 8 spawn points');
    for (let i = 0; i < map.spawns.length; i++) {
      for (let j = i + 1; j < map.spawns.length; j++) {
        const d = Math.hypot(map.spawns[i].x - map.spawns[j].x, map.spawns[i].y - map.spawns[j].y);
        assert.ok(d > TILE * 2, `spawns ${i} and ${j} are on top of each other`);
      }
    }
  });
}
