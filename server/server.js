// Neon Militia server: serves the static game and hosts online deathmatch
// rooms. No npm dependencies — see server/ws.js for the WebSocket layer.
//
// Authority split (documented in README):
//   * Each client simulates its own fighter and its own bullets.
//   * A shooter reports hits; the server clamps the damage against the
//     weapon's real numbers and forwards it to the victim, whose client
//     applies it and republishes its health.
//   * The server alone owns scores, pickups, the match clock and map rotation.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachWebSocket } from './ws.js';
import { WEAPONS } from '../src/game/weapons.js';
import { COMBAT, MATCH, NET } from '../src/core/config.js';
import { MAP_DEFS } from '../src/game/maps.js';
import { HERO_BY_ID, HEROES } from '../src/game/characters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || NET.defaultPort;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------------
// static file serving
// ---------------------------------------------------------------------------
async function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const target = path.join(ROOT, path.normalize(urlPath));
  if (!target.startsWith(ROOT + path.sep) && target !== ROOT) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

// ---------------------------------------------------------------------------
// damage validation
// ---------------------------------------------------------------------------
const SPECIAL_DAMAGE = {
  melee: COMBAT.meleeDamage * 2.2,          // Kage's melee multiplier
  grenade: COMBAT.grenadeDamage * 1.15,
  iaido: 100,
  afterburn: 24,
  overcharge: 24,
};

function maxDamageFor(weaponId) {
  const w = WEAPONS[weaponId];
  if (w) return Math.max(w.damage, w.explosive?.damage ?? 0) * 1.6;
  return SPECIAL_DAMAGE[weaponId] ?? 60;
}

const clean = (s, max = 18) =>
  String(s ?? '').replace(/[^\w \-.!?]/g, '').trim().slice(0, max);

// ---------------------------------------------------------------------------
// rooms
// ---------------------------------------------------------------------------
let nextPlayerId = 1;

class Player {
  constructor(conn, room) {
    this.id = nextPlayerId++;
    this.conn = conn;
    this.room = room;
    this.name = `PILOT-${this.id}`;
    this.heroId = 'nova';
    this.kills = 0;
    this.deaths = 0;
    this.damage = 0;
    this.state = null;
    this.lastSeen = Date.now();
    this.joined = false;
    this.msgWindow = { t: Date.now(), n: 0 };
  }

  summary() {
    return {
      id: this.id, name: this.name, hero: this.heroId,
      kills: this.kills, deaths: this.deaths, damage: Math.round(this.damage),
    };
  }
}

class Room {
  constructor(name) {
    this.name = name;
    this.players = new Map();
    this.mapIndex = Math.floor(Math.random() * MAP_DEFS.length);
    this.scoreLimit = MATCH.scoreLimit;
    this.timeLeft = MATCH.timeLimit;
    this.over = false;
    this.restartIn = 0;
    this.pickups = this.freshPickups();
    this.lastTick = Date.now();
  }

  get mapId() { return MAP_DEFS[this.mapIndex].id; }

  freshPickups() {
    const def = MAP_DEFS[this.mapIndex];
    const list = new Map();
    def.crates.forEach((_, i) => {
      list.set(`c${i}`, { netId: `c${i}`, kind: i % 4 === 3 ? 'ammo' : 'weapon', active: true, timer: 0, weaponId: randomPrimary() });
    });
    def.health.forEach((_, i) => {
      list.set(`h${i}`, { netId: `h${i}`, kind: i % 3 === 2 ? 'grenade' : 'health', active: true, timer: 0, weaponId: null });
    });
    return list;
  }

  broadcast(msg, exceptId = null) {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      p.conn.send(text);
    }
  }

  add(player) {
    this.players.set(player.id, player);
  }

  remove(playerId) {
    this.players.delete(playerId);
    this.broadcast({ t: 'left', id: playerId });
  }

  roster() {
    return [...this.players.values()].filter((p) => p.joined).map((p) => p.summary());
  }

  sendWelcome(player) {
    player.conn.sendJson({
      t: 'welcome',
      id: player.id,
      room: this.name,
      map: this.mapId,
      scoreLimit: this.scoreLimit,
      timeLeft: Math.round(this.timeLeft),
      players: this.roster(),
      pickups: [...this.pickups.values()].map((p) => ({ netId: p.netId, active: p.active, weaponId: p.weaponId })),
    });
  }

  registerKill(victim, killerId, weapon) {
    victim.deaths++;
    const killer = killerId != null ? this.players.get(killerId) : null;
    if (killer && killer.id !== victim.id) killer.kills++;
    else victim.kills = Math.max(0, victim.kills - 1);

    this.broadcast({
      t: 'kill',
      victim: victim.id, victimName: victim.name, victimHero: victim.heroId,
      killer: killer?.id ?? null, killerName: killer?.name ?? null, killerHero: killer?.heroId ?? null,
      weapon,
      scores: this.roster(),
    });

    if (killer && killer.kills >= this.scoreLimit) this.endMatch(killer);
  }

  endMatch(winner) {
    if (this.over) return;
    this.over = true;
    this.restartIn = 10;
    this.broadcast({ t: 'over', winner: winner?.id ?? null, scores: this.roster() });
  }

  nextMatch() {
    this.mapIndex = (this.mapIndex + 1) % MAP_DEFS.length;
    this.timeLeft = MATCH.timeLimit;
    this.over = false;
    this.pickups = this.freshPickups();
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; p.damage = 0; }
    this.broadcast({
      t: 'reset',
      map: this.mapId,
      timeLeft: Math.round(this.timeLeft),
      scores: this.roster(),
      pickups: [...this.pickups.values()].map((p) => ({ netId: p.netId, active: p.active, weaponId: p.weaponId })),
    });
  }

  tick(dt) {
    if (this.over) {
      this.restartIn -= dt;
      if (this.restartIn <= 0 && this.players.size > 0) this.nextMatch();
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      const best = [...this.players.values()].sort((a, b) => b.kills - a.kills)[0];
      this.endMatch(best);
      return;
    }
    for (const p of this.pickups.values()) {
      if (p.active) continue;
      p.timer -= dt;
      if (p.timer <= 0) {
        p.active = true;
        if (p.kind === 'weapon') p.weaponId = randomPrimary();
        this.broadcast({ t: 'pickupReady', netId: p.netId, weaponId: p.weaponId });
      }
    }
  }

  snapshot() {
    const players = {};
    for (const p of this.players.values()) {
      if (p.joined && p.state) players[p.id] = p.state;
    }
    return { t: 'snap', p: players, tl: Math.round(this.timeLeft) };
  }
}

const PRIMARY_IDS = Object.values(WEAPONS).filter((w) => w.slot === 'primary').map((w) => w.id);
const randomPrimary = () => PRIMARY_IDS[(Math.random() * PRIMARY_IDS.length) | 0];

const rooms = new Map();
const getRoom = (name) => {
  const key = clean(name, 16).toLowerCase() || 'arena';
  if (!rooms.has(key)) rooms.set(key, new Room(key));
  return rooms.get(key);
};

// ---------------------------------------------------------------------------
// message handling
// ---------------------------------------------------------------------------
function handleMessage(player, raw) {
  // crude flood guard
  const now = Date.now();
  if (now - player.msgWindow.t > 1000) { player.msgWindow = { t: now, n: 0 }; }
  if (++player.msgWindow.n > 240) return;

  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;
  player.lastSeen = now;
  const room = player.room;

  switch (msg.t) {
    case 'join': {
      player.name = clean(msg.name) || player.name;
      player.heroId = HERO_BY_ID[msg.hero] ? msg.hero : HEROES[0].id;
      player.joined = true;
      room.sendWelcome(player);
      room.broadcast({ t: 'joined', player: player.summary() }, player.id);
      break;
    }

    case 'state': {
      if (!player.joined || !msg.s || typeof msg.s !== 'object') break;
      const s = msg.s;
      // keep only known fields, and only finite numbers
      player.state = {
        x: num(s.x), y: num(s.y), vx: num(s.vx), vy: num(s.vy),
        a: num(s.a), f: s.f === -1 ? -1 : 1, hp: num(s.hp),
        al: s.al ? 1 : 0, fu: clamp01(s.fu), th: s.th ? 1 : 0,
        w: WEAPONS[s.w] ? s.w : 'pistol',
        ab: s.ab ? 1 : 0, ck: clamp01(s.ck),
      };
      break;
    }

    case 'shoot':
    case 'beam':
    case 'fx':
      if (!player.joined) break;
      room.broadcast({ ...sanitizeFx(msg), from: player.id }, player.id);
      break;

    case 'hit': {
      if (!player.joined || room.over) break;
      const victim = room.players.get(msg.target);
      if (!victim || victim.id === player.id) break;
      const weapon = typeof msg.weapon === 'string' ? msg.weapon.slice(0, 20) : 'unknown';
      const amount = Math.min(Math.max(0, num(msg.amount)), maxDamageFor(weapon));
      if (amount <= 0) break;
      player.damage += amount;
      victim.conn.sendJson({ t: 'hurt', by: player.id, amount, weapon });
      break;
    }

    case 'died': {
      if (!player.joined || room.over) break;
      const weapon = typeof msg.weapon === 'string' ? msg.weapon.slice(0, 20) : 'unknown';
      const killerId = room.players.has(msg.by) ? msg.by : null;
      room.registerKill(player, killerId, weapon);
      break;
    }

    case 'grab': {
      if (!player.joined || room.over) break;
      const p = room.pickups.get(String(msg.netId).slice(0, 8));
      if (!p || !p.active) break;
      p.active = false;
      p.timer = MATCH.pickupRespawn;
      room.broadcast({ t: 'pickup', netId: p.netId, by: player.id, weaponId: p.weaponId });
      break;
    }

    case 'chat': {
      if (!player.joined) break;
      const text = clean(msg.text, 90);
      if (text) room.broadcast({ t: 'chat', from: player.id, name: player.name, text });
      break;
    }

    case 'ping':
      player.conn.sendJson({ t: 'pong', s: msg.s });
      break;
  }
}

const num = (v) => (Number.isFinite(v) ? v : 0);
const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

function sanitizeFx(msg) {
  return {
    t: msg.t,
    x: num(msg.x), y: num(msg.y),
    vx: num(msg.vx), vy: num(msg.vy),
    x1: num(msg.x1), y1: num(msg.y1),
    w: typeof msg.w === 'string' ? msg.w.slice(0, 20) : 'pistol',
    k: typeof msg.k === 'string' ? msg.k.slice(0, 12) : 'bullet',
  };
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
export function createServer() {
  const server = http.createServer(serveStatic);

  attachWebSocket(server, (conn, req) => {
    const url = new URL(req.url, 'http://localhost');
    const room = getRoom(url.searchParams.get('room') || 'arena');
    const player = new Player(conn, room);
    room.add(player);

    conn.on('message', (raw) => {
      try { handleMessage(player, raw); }
      catch (err) { console.error('message error:', err.message); }
    });
    conn.on('close', () => room.remove(player.id));
    conn.on('error', () => room.remove(player.id));
  });

  // fixed-rate room tick + snapshot broadcast
  let last = Date.now();
  const tick = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    for (const [key, room] of rooms) {
      room.tick(dt);
      if (room.players.size === 0) {
        rooms.delete(key);
        continue;
      }
      for (const p of room.players.values()) {
        if (now - p.lastSeen > NET.timeout * 1000) {
          p.conn.close(1001, 'timeout');
          room.remove(p.id);
        }
      }
      const snap = JSON.stringify(room.snapshot());
      for (const p of room.players.values()) p.conn.send(snap);
    }
  }, 1000 / NET.snapshotRate);

  const keepalive = setInterval(() => {
    for (const room of rooms.values()) {
      for (const p of room.players.values()) p.conn.ping();
    }
  }, 5000);

  server.on('close', () => { clearInterval(tick); clearInterval(keepalive); });
  return server;
}

// Listen only when run directly, so tests can import this module freely.
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  createServer().listen(PORT, HOST, () => {
    console.log(`\n  NEON MILITIA\n`);
    console.log(`  Play:    http://localhost:${PORT}`);
    console.log(`  Online:  ws://localhost:${PORT}  (rooms via ?room=name)`);
    console.log(`  Maps:    ${MAP_DEFS.map((m) => m.id).join(', ')}\n`);
  });
}

export { rooms, Room, maxDamageFor, serveStatic };
