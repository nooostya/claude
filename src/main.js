// Entry point: canvas setup, the fixed-timestep loop, and the state machine
// that moves between the attract screen, a solo match and an online match.

import { SIM, NET, MATCH } from './core/config.js';
import { clamp, pick } from './core/math.js';
import { Input } from './core/input.js';
import { Audio, playEvents } from './core/audio.js';
import { World } from './game/world.js';
import { buildMap, mapList } from './game/maps.js';
import { BotBrain, botNames, DIFFICULTIES } from './game/ai.js';
import { HEROES, getHero } from './game/characters.js';
import { blankInput } from './game/fighter.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/draw.js';
import { Hud } from './render/hud.js';
import { NetClient } from './net/client.js';
import { UI } from './ui/screens.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.cw = 0; this.ch = 0;

    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.camera = new Camera();
    this.renderer = new Renderer();
    this.hud = new Hud();
    this.ui = new UI(this);
    this.net = null;

    this.state = 'menu';         // menu | playing | results
    this.paused = false;
    this.world = null;
    this.brains = new Map();
    this.localId = 1;
    this.accumulator = 0;
    this.lastTs = 0;
    this.demoFocus = null;
    this.demoSwitch = 0;
    this.resultsTimer = 0;
    this.settings = {
      sfx: localStorage.getItem('nm.sfx') !== 'off',
      music: localStorage.getItem('nm.music') !== 'off',
    };

    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.isOnline) this.setPaused(true);
    });

    this.ui.show('menu');
    this.syncToggleChips();
    this.startDemo();
    requestAnimationFrame((t) => this.loop(t));
  }

  get isOnline() { return !!this.net && this.net.connected; }

  // ------------------------------------------------------------------
  resize() {
    const dpr = clamp(devicePixelRatio || 1, 1, 2);
    this.cw = Math.floor(innerWidth);
    this.ch = Math.floor(innerHeight);
    this.canvas.width = Math.floor(this.cw * dpr);
    this.canvas.height = Math.floor(this.ch * dpr);
    this.canvas.style.width = this.cw + 'px';
    this.canvas.style.height = this.ch + 'px';
    this.dpr = dpr;
    this.camera.resize(this.cw, this.ch, dpr);
  }

  // ------------------------------------------------------------------
  // world construction
  // ------------------------------------------------------------------
  makeWorld(mapId, opts = {}) {
    const id = mapId === 'random' || !mapId ? pick(mapList()).id : mapId;
    const world = new World(buildMap(id), {
      mode: opts.mode || 'local',
      scoreLimit: opts.scoreLimit ?? MATCH.scoreLimit,
      timeLimit: opts.timeLimit ?? MATCH.timeLimit,
    });

    world.onShot = (fighter, weapon, muzzle) => {
      world.emit({ type: 'shot', x: muzzle.x, y: muzzle.y, sfx: weapon.sfx });
      if (this.net) this.net.publishShot(fighter, weapon, muzzle);
    };
    world.onAbility = (fighter, def) => {
      this.audio.play(def.id === 'iaido' ? 'blade' : 'ability', { x: fighter.x, y: fighter.y });
      if (this.net) this.net.publishAbility(fighter);
    };

    this.renderer.reset();
    this.camera.snapNext = true;
    return world;
  }

  addBots(world, count, difficultyId, excludeHeroes = []) {
    const diff = DIFFICULTIES.find((d) => d.id === difficultyId) || DIFFICULTIES[1];
    const names = botNames(count);
    const pool = HEROES.filter((h) => !excludeHeroes.includes(h.id));
    for (let i = 0; i < count; i++) {
      const hero = pool.length ? pool[i % pool.length] : HEROES[i % HEROES.length];
      const f = world.addFighter({
        id: 1000 + i, name: names[i], heroId: hero.id, isBot: true,
      });
      const jitter = (Math.random() - 0.5) * 0.14;
      this.brains.set(f.id, new BotBrain(f, clamp(diff.value + jitter, 0, 1)));
    }
  }

  // ------------------------------------------------------------------
  // attract screen: a live bot match behind the menus
  // ------------------------------------------------------------------
  startDemo() {
    this.brains.clear();
    this.world = this.makeWorld('random', { scoreLimit: 999, timeLimit: 99999 });
    this.localId = null;
    this.world.localId = null;
    this.addBots(this.world, 6, 'veteran');
    this.demoFocus = this.world.fighters[0];
    this.demoSwitch = 5;
  }

  // ------------------------------------------------------------------
  // solo
  // ------------------------------------------------------------------
  startSolo(cfg) {
    this.teardownNet();
    this.brains.clear();
    this.world = this.makeWorld(cfg.mapId, { scoreLimit: cfg.scoreLimit });
    this.localId = 1;
    this.world.localId = 1;

    this.world.addFighter({
      id: 1, name: cfg.name || 'YOU', heroId: cfg.heroId, isLocal: true,
    });
    this.addBots(this.world, cfg.bots, cfg.difficulty, [cfg.heroId]);

    this.state = 'playing';
    this.paused = false;
    this.ui.show('game');
    this.ui.hideResults();
    this.ui.setPause(false);
    this.hud.setToast(`${this.world.map.name.toUpperCase()} · FIRST TO ${cfg.scoreLimit}`, 3);
    this.audio.init();
    if (this.settings.music) this.audio.startMusic();
    this.lastCfg = { ...cfg, kind: 'solo' };
  }

  // ------------------------------------------------------------------
  // online
  // ------------------------------------------------------------------
  async startOnline(cfg) {
    this.teardownNet();
    this.ui.showConnecting(true, 'CONNECTING…');
    const net = new NetClient();
    this.net = net;

    try {
      const welcome = await net.connect(cfg.server, {
        name: cfg.name, hero: cfg.heroId, room: cfg.room,
      });
      this.ui.showConnecting(false);
      this.buildOnlineWorld(welcome, cfg);
    } catch (err) {
      this.ui.showConnecting(false);
      this.ui.toast(`${err.message}  Start a server with: npm start`);
      this.net = null;
      return;
    }

    net.onClose = () => {
      if (this.state === 'playing') {
        this.ui.toast('Disconnected from the server.');
        this.quitToMenu();
      }
    };
    net.onOver = () => { this.finishMatch(); };
    net.onReset = (msg) => {
      this.ui.hideResults();
      this.buildOnlineWorld({ ...msg, id: net.localId, players: [...net.roster.values()] }, cfg, true);
      this.state = 'playing';
    };
    net.onKill = (msg) => {
      if (msg.killer === net.localId && msg.victim !== net.localId) {
        this.hud.killPop = 1.1;
        this.hud.killPopText = 'ELIMINATED';
      }
    };

    this.lastCfg = { ...cfg, kind: 'online' };
  }

  buildOnlineWorld(welcome, cfg, isReset = false) {
    this.brains.clear();
    this.world = this.makeWorld(welcome.map, {
      mode: 'online',
      scoreLimit: welcome.scoreLimit ?? MATCH.scoreLimit,
      timeLimit: welcome.timeLeft ?? MATCH.timeLimit,
    });
    this.localId = welcome.id;
    this.world.localId = welcome.id;

    this.world.addFighter({
      id: welcome.id, name: cfg.name, heroId: cfg.heroId, isLocal: true,
    });
    for (const p of welcome.players || []) {
      if (p.id === welcome.id) continue;
      const f = this.world.addFighter({ id: p.id, name: p.name, heroId: p.hero, isRemote: true });
      f.kills = p.kills || 0;
      f.deaths = p.deaths || 0;
    }
    for (const p of welcome.pickups || []) {
      const target = this.world.pickups.find((x) => x.netId === p.netId);
      if (target) { target.active = p.active; if (p.weaponId) target.weaponId = p.weaponId; }
    }

    this.net.attach(this.world);
    this.state = 'playing';
    this.paused = false;
    this.ui.show('game');
    this.ui.setPause(false);
    this.hud.setToast(isReset ? 'NEW MATCH' : `ONLINE · ${this.world.map.name.toUpperCase()}`, 3);
    this.audio.init();
    if (this.settings.music) this.audio.startMusic();
  }

  teardownNet() {
    if (this.net) { this.net.disconnect(); this.net = null; }
  }

  // ------------------------------------------------------------------
  // UI actions
  // ------------------------------------------------------------------
  onUiAction(action) {
    switch (action) {
      case 'single': this.ui.setMode('single'); this.ui.show('loadout'); break;
      case 'online': this.ui.setMode('online'); this.ui.show('loadout'); break;
      case 'controls': this.ui.show('controls'); break;
      case 'back': this.ui.show('menu'); break;
      case 'resume': this.setPaused(false); break;
      case 'restart': this.setPaused(false); this.restart(); break;
      case 'quit': this.quitToMenu(); break;
      case 'rematch': this.ui.hideResults(); this.restart(); break;
      case 'cancel-connect':
        this.teardownNet();
        this.ui.showConnecting(false);
        break;
    }
  }

  onToggle(which, el) {
    if (which === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
      return;
    }
    this.settings[which] = !this.settings[which];
    localStorage.setItem(`nm.${which}`, this.settings[which] ? 'on' : 'off');
    if (which === 'sfx') this.audio.setMuted(!this.settings.sfx);
    if (which === 'music') {
      this.audio.musicOn = this.settings.music;
      if (this.settings.music) this.audio.startMusic(); else this.audio.stopMusic();
    }
    this.syncToggleChips();
  }

  syncToggleChips() {
    for (const [key, sel] of [['sfx', '[data-toggle="sfx"]'], ['music', '[data-toggle="music"]']]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.classList.toggle('off', !this.settings[key]);
      const b = el.querySelector('b');
      if (b) b.textContent = this.settings[key] ? 'ON' : 'OFF';
    }
    this.audio.setMuted(!this.settings.sfx);
    this.audio.musicOn = this.settings.music;
  }

  startFromLoadout() {
    const cfg = this.ui.loadoutValues();
    if (this.ui.mode === 'online') this.startOnline(cfg);
    else this.startSolo(cfg);
  }

  restart() {
    if (!this.lastCfg) { this.quitToMenu(); return; }
    this.ui.hideResults();
    if (this.lastCfg.kind === 'online') this.startOnline(this.lastCfg);
    else this.startSolo(this.lastCfg);
  }

  quitToMenu() {
    this.teardownNet();
    this.state = 'menu';
    this.paused = false;
    this.ui.setPause(false);
    this.ui.hideResults();
    this.ui.show('menu');
    this.audio.setJet(false);
    this.startDemo();
  }

  setPaused(on) {
    if (this.state !== 'playing') return;
    this.paused = on;
    this.ui.setPause(on);
    if (on) this.audio.setJet(false);
  }

  finishMatch() {
    if (this.state === 'results') return;
    this.state = 'results';
    this.audio.setJet(false);
    const { won } = this.ui.showResults(this.world, this.localId);
    this.audio.play(won ? 'victory' : 'defeat');
  }

  // ------------------------------------------------------------------
  // loop
  // ------------------------------------------------------------------
  loop(ts) {
    requestAnimationFrame((t) => this.loop(t));
    const now = ts / 1000;
    let dt = this.lastTs ? now - this.lastTs : 0;
    this.lastTs = now;
    dt = Math.min(dt, 0.25);

    this.update(dt);
    this.render(dt);
    this.input.endFrame();
  }

  update(dt) {
    const world = this.world;
    if (!world) return;

    const playing = this.state === 'playing' && !this.paused;
    const demo = this.state === 'menu';

    // global hotkeys
    if (this.state === 'playing') {
      if (this.input.wasPressed('pause')) this.setPaused(!this.paused);
      if (this.input.wasPressed('mute')) this.onToggle('sfx');
      this.hud.showScoreboard = this.input.isDown('scoreboard');
    }

    if (playing || demo) {
      this.accumulator += dt;
      const step = SIM.step;
      let steps = 0;
      while (this.accumulator >= step && steps < SIM.maxStepsPerFrame) {
        this.simulate(step, demo);
        this.accumulator -= step;
        steps++;
      }
      if (steps === SIM.maxStepsPerFrame) this.accumulator = 0;
    }

    // camera
    const focus = demo ? this.demoFocus : world.localFighter;
    if (demo) {
      this.demoSwitch -= dt;
      if (this.demoSwitch <= 0 || !this.demoFocus?.alive) {
        const alive = world.fighters.filter((f) => f.alive);
        this.demoFocus = alive.length ? pick(alive) : world.fighters[0];
        this.demoSwitch = 5 + Math.random() * 4;
      }
    }
    const aimBias = !demo && focus ? { x: focus.input.aimX, y: focus.input.aimY } : null;
    this.camera.follow(focus, world.map, dt, aimBias);
    this.camera.update(dt, world.shake);
    if (focus) this.audio.setListener(focus.x, focus.y);

    this.renderer.update(dt);
    this.hud.update(dt);
    if (this.state !== 'playing') this.ui.tickPortraits(dt);

    if (this.net) {
      this.net.update(dt);
      if (this.net.serverTimeLeft != null) {
        world.timeLeft = this.net.serverTimeLeft;
      }
    }

    if (this.state === 'playing' && world.over) {
      this.resultsTimer += dt;
      if (this.resultsTimer > 1.4) { this.resultsTimer = 0; this.finishMatch(); }
    }
  }

  simulate(step, demo) {
    const world = this.world;
    const inputs = new Map();

    for (const f of world.fighters) {
      if (f.isRemote) continue;
      if (f.isLocal && !demo) {
        inputs.set(f.id, this.input.build(
          f,
          (sx, sy) => this.camera.screenToWorld(sx, sy, this.cw, this.ch),
          this.cw, this.ch,
        ));
      } else {
        const brain = this.brains.get(f.id);
        inputs.set(f.id, brain ? brain.update(step, world) : blankInput());
      }
    }

    world.step(step, inputs);

    const events = world.drainEvents();
    if (events.length) {
      this.renderer.ingest(events, world);
      this.hud.ingest(events, world);
      if (this.settings.sfx) playEvents(this.audio, events, world);
      if (this.net) {
        this.net.publishEvents(events);
        for (const ev of events) {
          if (ev.type === 'beam' && ev.byId === this.localId) {
            this.net.publishBeam({ id: ev.weapon }, ev.x0, ev.y0, ev.x1, ev.y1);
          }
        }
      }
    }

    const me = world.localFighter;
    this.audio.setJet(
      !!me && me.thrusting && !demo,
      !!me && me.ability.active > 0 && me.ability.def.id === 'afterburn',
    );
  }

  render(dt) {
    const ctx = this.ctx;
    const world = this.world;
    if (!world) return;

    // Everything downstream draws in CSS pixels; Camera.reset/apply fold in
    // the device pixel ratio so the game is crisp on high-density screens.
    this.renderer.draw(ctx, world, this.camera, this.cw, this.ch);
    this.camera.reset(ctx);

    if (this.state === 'menu') {
      // dim the attract match so the menu stays readable
      ctx.fillStyle = 'rgba(6,8,18,0.42)';
      ctx.fillRect(0, 0, this.cw, this.ch);
      return;
    }

    const pointer = this.input.pointerScreen(
      world.localFighter,
      (wx, wy) => this.camera.worldToScreen(wx, wy, this.cw, this.ch),
      this.cw, this.ch,
    );
    this.hud.draw(ctx, world, this.camera, this.cw, this.ch, {
      pointer,
      netStatus: this.net ? this.net.status : null,
    });
    this.input.drawTouchControls(ctx, this.cw, this.ch, this.dpr);
  }
}

const game = new Game();
window.__neonMilitia = game;   // handy for debugging from the console
