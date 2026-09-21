// Online multiplayer client.
//
// Each client simulates its own fighter authoritatively and publishes state at
// NET.sendRate. Remote fighters are rendered NET.interpDelay seconds in the
// past and interpolated between snapshots, which hides ordinary jitter.
// Hits we land are reported to the server; hits we take arrive as `hurt`.

import { NET, COMBAT } from '../core/config.js';
import { clamp, lerp, angleDelta } from '../core/math.js';
import { WEAPONS } from '../game/weapons.js';
import { bulletFromWeapon, Projectile } from '../game/entities.js';

export class NetClient {
  constructor() {
    this.ws = null;
    this.world = null;
    this.localId = null;
    this.connected = false;
    this.status = { ok: false, text: 'offline' };
    this.buffers = new Map();       // playerId -> [{ t, s }]
    this.roster = new Map();        // playerId -> summary
    this.sendAccum = 0;
    this.ping = 0;
    this.serverTimeLeft = null;
    this.onWelcome = () => {};
    this.onRoster = () => {};
    this.onKill = () => {};
    this.onOver = () => {};
    this.onReset = () => {};
    this.onChat = () => {};
    this.onClose = () => {};
    this._pingTimer = null;
  }

  static defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  connect(url, { name, hero, room }) {
    return new Promise((resolve, reject) => {
      let target;
      try {
        target = new URL(url);
      } catch {
        reject(new Error('That does not look like a server address.'));
        return;
      }
      target.searchParams.set('room', room || 'arena');

      this.status = { ok: false, text: 'connecting…' };
      let ws;
      try {
        ws = new WebSocket(target.toString());
      } catch (err) {
        reject(new Error('Could not open a connection: ' + err.message));
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => {
        if (!this.connected) { ws.close(); reject(new Error('Connection timed out.')); }
      }, 8000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        this.status = { ok: true, text: 'connected' };
        this.send({ t: 'join', name, hero, room });
        this._pingTimer = setInterval(() => this.send({ t: 'ping', s: Date.now() }), 2500);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        if (!this.connected) reject(new Error('Could not reach that server.'));
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        this.connected = false;
        this.status = { ok: false, text: 'disconnected' };
        if (this._pingTimer) clearInterval(this._pingTimer);
        this.onClose();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          this.localId = msg.id;
          resolve(msg);
        }
        this._handle(msg);
      };
    });
  }

  disconnect() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    if (this.ws && this.ws.readyState <= 1) this.ws.close(1000, 'left');
    this.ws = null;
    this.connected = false;
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  attach(world) {
    this.world = world;
    world.localId = this.localId;
  }

  // ------------------------------------------------------------------
  // inbound
  // ------------------------------------------------------------------
  _handle(msg) {
    const w = this.world;
    switch (msg.t) {
      case 'welcome':
        for (const p of msg.players) this.roster.set(p.id, p);
        this.onWelcome(msg);
        break;

      case 'joined':
        this.roster.set(msg.player.id, msg.player);
        this._ensureFighter(msg.player);
        this.onRoster([...this.roster.values()]);
        break;

      case 'left':
        this.roster.delete(msg.id);
        this.buffers.delete(msg.id);
        if (w) w.removeFighter(msg.id);
        this.onRoster([...this.roster.values()]);
        break;

      case 'snap': {
        const now = performance.now() / 1000;
        this.serverTimeLeft = msg.tl;
        for (const [idStr, s] of Object.entries(msg.p)) {
          const id = Number(idStr);
          if (id === this.localId) continue;
          if (!this.buffers.has(id)) this.buffers.set(id, []);
          const buf = this.buffers.get(id);
          buf.push({ t: now, s });
          while (buf.length > 24) buf.shift();
          const info = this.roster.get(id);
          if (info) this._ensureFighter(info);
        }
        break;
      }

      case 'shoot': {
        if (!w || msg.from === this.localId) return;
        const weapon = WEAPONS[msg.w];
        if (!weapon) return;
        const p = bulletFromWeapon(weapon, {
          x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
          damage: 0, ownerId: msg.from, ownerTeam: -1, visualOnly: true,
        });
        w.spawnProjectile(p);
        const f = w.fighterById(msg.from);
        if (f) { f.anim.muzzle = 0.06; f.anim.recoil = 1; }
        w.particles.muzzle(msg.x, msg.y, Math.atan2(msg.vy, msg.vx), weapon.color);
        w.emit({ type: 'shot', x: msg.x, y: msg.y, sfx: weapon.sfx });
        break;
      }

      case 'beam': {
        if (!w || msg.from === this.localId) return;
        const weapon = WEAPONS[msg.w] || WEAPONS.rail;
        w.emit({
          type: 'beam', x0: msg.x, y0: msg.y, x1: msg.x1, y1: msg.y1,
          color: weapon.color, width: weapon.width, life: 0.16,
        });
        w.emit({ type: 'shot', x: msg.x, y: msg.y, sfx: weapon.sfx });
        break;
      }

      case 'fx': {
        if (!w || msg.from === this.localId) return;
        if (msg.k === 'grenade') {
          w.spawnProjectile(new Projectile({
            type: 'grenade', x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
            damage: 0, ownerId: msg.from, life: COMBAT.grenadeFuse + 0.2,
            fuse: COMBAT.grenadeFuse, color: '#ff9a4d', width: 5, visualOnly: true,
          }));
        } else if (msg.k === 'melee') {
          w.emit({ type: 'melee', x: msg.x, y: msg.y, angle: Math.atan2(msg.vy, msg.vx), id: msg.from });
        } else if (msg.k === 'ability') {
          const f = w.fighterById(msg.from);
          if (f) w.particles.spawnBurst(msg.x, msg.y, f.hero.palette.glow);
        }
        break;
      }

      case 'hurt': {
        // Another client landed a shot on us. We are authoritative over our own
        // health, so apply it here through the normal damage path.
        if (!w) return;
        const me = w.localFighter;
        if (!me || !me.alive) return;
        const src = w.fighterById(msg.by);
        w.damage(me, msg.amount, {
          byId: msg.by, weapon: msg.weapon,
          x: src ? src.x : me.x, y: src ? src.y : me.y,
          angle: src ? Math.atan2(me.y - src.y, me.x - src.x) : 0,
          knockback: WEAPONS[msg.weapon]?.knockback ?? 0,
        });
        break;
      }

      case 'kill': {
        for (const s of msg.scores || []) {
          this.roster.set(s.id, s);
          const f = this.world?.fighterById(s.id);
          if (f) { f.kills = s.kills; f.deaths = s.deaths; }
        }
        if (w) {
          w.killFeed.push({
            killer: msg.killerName, killerHero: msg.killerHero,
            victim: msg.victimName, victimHero: msg.victimHero,
            weapon: msg.weapon, life: 5,
          });
          w.killFeed = w.killFeed.slice(-5);
        }
        this.onKill(msg);
        break;
      }

      case 'pickup':
        if (w) w.applyPickupGrant(msg.netId, msg.by, msg.weaponId);
        break;

      case 'pickupReady':
        if (w) w.applyPickupReady(msg.netId, msg.weaponId);
        break;

      case 'over':
        for (const s of msg.scores || []) this.roster.set(s.id, s);
        if (w) {
          w.over = true;
          w.winner = w.fighterById(msg.winner) || null;
        }
        this.onOver(msg);
        break;

      case 'reset':
        for (const s of msg.scores || []) this.roster.set(s.id, s);
        this.onReset(msg);
        break;

      case 'chat':
        this.onChat(msg);
        break;

      case 'pong':
        this.ping = Date.now() - msg.s;
        this.status = { ok: true, text: `online · ${this.ping} ms · ${this.roster.size} players` };
        break;
    }
  }

  _ensureFighter(info) {
    const w = this.world;
    if (!w || info.id === this.localId) return;
    let f = w.fighterById(info.id);
    if (!f) {
      f = w.addFighter({
        id: info.id, name: info.name, heroId: info.hero, isRemote: true,
      });
    }
    f.kills = info.kills ?? f.kills;
    f.deaths = info.deaths ?? f.deaths;
  }

  // ------------------------------------------------------------------
  // outbound + interpolation, driven from the game loop
  // ------------------------------------------------------------------
  update(dt) {
    if (!this.world) return;
    this._interpolate();

    this.sendAccum += dt;
    const interval = 1 / NET.sendRate;
    if (this.sendAccum >= interval) {
      this.sendAccum = 0;
      const me = this.world.localFighter;
      if (me && this.connected) this.send({ t: 'state', s: me.netState() });
    }
  }

  _interpolate() {
    const now = performance.now() / 1000 - NET.interpDelay;
    for (const [id, buf] of this.buffers) {
      const f = this.world.fighterById(id);
      if (!f || buf.length === 0) continue;

      let a = null, b = null;
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= now) { a = buf[i]; b = buf[i + 1] || null; break; }
      }
      if (!a) a = buf[0];

      if (a && b) {
        const span = b.t - a.t;
        const k = span > 0 ? clamp((now - a.t) / span, 0, 1) : 0;
        f.applyNetState(a.s);
        f.x = lerp(a.s.x, b.s.x, k);
        f.y = lerp(a.s.y, b.s.y, k);
        f.vx = lerp(a.s.vx, b.s.vx, k);
        f.vy = lerp(a.s.vy, b.s.vy, k);
        f.aimAngle = a.s.a + angleDelta(a.s.a, b.s.a) * k;
      } else if (a) {
        // Ran out of buffer: extrapolate briefly rather than freezing.
        const ahead = clamp(now - a.t, 0, 0.25);
        f.applyNetState(a.s);
        f.x += a.s.vx * ahead;
        f.y += a.s.vy * ahead;
      }
    }
  }

  /** Forward simulation events the other clients need to see. */
  publishEvents(events) {
    if (!this.connected) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'hitReport':
          this.send({ t: 'hit', target: ev.targetId, amount: ev.amount, weapon: ev.weapon });
          break;
        case 'pickupRequest':
          this.send({ t: 'grab', netId: ev.netId });
          break;
        case 'kill':
          if (ev.victimId === this.localId) {
            this.send({ t: 'died', by: ev.killerId, weapon: ev.weapon });
          }
          break;
        case 'grenade':
          if (ev.id === this.localId) {
            const p = this.world.projectiles[this.world.projectiles.length - 1];
            if (p) this.send({ t: 'fx', k: 'grenade', x: p.x, y: p.y, vx: p.vx, vy: p.vy });
          }
          break;
        case 'melee':
          if (ev.id === this.localId) {
            this.send({ t: 'fx', k: 'melee', x: ev.x, y: ev.y, vx: Math.cos(ev.angle), vy: Math.sin(ev.angle) });
          }
          break;
      }
    }
  }

  /** Called by World.onShot for the local player. */
  publishShot(fighter, weapon, muzzle) {
    if (!this.connected || fighter.id !== this.localId) return;
    if (weapon.kind === 'hitscan') return;   // sent as a beam instead
    this.send({
      t: 'shoot', w: weapon.id,
      x: Math.round(muzzle.x), y: Math.round(muzzle.y),
      vx: Math.round(Math.cos(muzzle.a) * weapon.speed),
      vy: Math.round(Math.sin(muzzle.a) * weapon.speed),
    });
  }

  publishBeam(weapon, x0, y0, x1, y1) {
    if (!this.connected) return;
    this.send({
      t: 'beam', w: weapon.id,
      x: Math.round(x0), y: Math.round(y0),
      x1: Math.round(x1), y1: Math.round(y1),
    });
  }

  publishAbility(fighter) {
    if (!this.connected || fighter.id !== this.localId) return;
    this.send({ t: 'fx', k: 'ability', x: Math.round(fighter.x), y: Math.round(fighter.y) });
  }
}
