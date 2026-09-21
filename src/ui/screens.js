// DOM menus: main menu, hero select / loadout, controls, pause and results.
// The hero portraits are drawn with the same code that draws them in-game.

import { HEROES, getHero } from '../game/characters.js';
import { mapList } from '../game/maps.js';
import { WEAPONS } from '../game/weapons.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from '../game/ai.js';
import { drawHeroPortrait } from '../render/heroart.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const STAT_ROWS = [
  { key: 'health', label: 'HEALTH', max: 160, fmt: (v) => Math.round(v) },
  { key: 'speed', label: 'SPEED', max: 1.25, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'fuel', label: 'JET FUEL', max: 1.5, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'armor', label: 'ARMOUR', max: 0.2, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'melee', label: 'MELEE', max: 2, fmt: (v) => `${Math.round(v * 100)}%` },
];

export class UI {
  constructor(game) {
    this.game = game;
    this.current = 'menu';
    this.heroId = localStorage.getItem('nm.hero') || HEROES[0].id;
    this.mode = 'single';
    this.portraits = [];
    this.stageCtx = null;
    this.t = 0;
    this._build();
  }

  // ------------------------------------------------------------------
  _build() {
    this.buildHeroGrid();
    this.buildSelects();
    this.bindButtons();
    this.selectHero(this.heroId);
    this.restorePrefs();

    const stage = $('#hero-stage');
    const dpr = Math.min(2, devicePixelRatio || 1);
    stage.width = 260 * dpr;
    stage.height = 260 * dpr;
    this.stageCtx = stage.getContext('2d');
    this.stageCtx.scale(dpr, dpr);
  }

  buildHeroGrid() {
    const grid = $('#hero-grid');
    grid.innerHTML = '';
    this.portraits = [];
    const dpr = Math.min(2, devicePixelRatio || 1);

    for (const hero of HEROES) {
      const card = document.createElement('button');
      card.className = 'hero-card';
      card.type = 'button';
      card.dataset.hero = hero.id;
      card.style.setProperty('--accent', hero.palette.accent);
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-label', `${hero.name}, ${hero.title}`);

      const canvas = document.createElement('canvas');
      canvas.width = 78 * dpr;
      canvas.height = 78 * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const name = document.createElement('div');
      name.className = 'hc-name';
      name.textContent = hero.name;
      name.style.color = hero.palette.trim;

      const title = document.createElement('div');
      title.className = 'hc-title';
      title.textContent = hero.title;

      card.append(canvas, name, title);
      card.addEventListener('click', () => {
        this.selectHero(hero.id);
        this.game.audio.play('ui');
      });
      grid.append(card);
      this.portraits.push({ hero, ctx });
    }
  }

  buildSelects() {
    const mapSel = $('#sel-map');
    mapSel.innerHTML = '<option value="random">Random</option>';
    for (const m of mapList()) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.name} — ${m.subtitle}`;
      mapSel.append(o);
    }

    const botSel = $('#sel-bots');
    botSel.innerHTML = '';
    for (let i = 1; i <= 7; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${i} bot${i > 1 ? 's' : ''}`;
      if (i === 5) o.selected = true;
      botSel.append(o);
    }

    const diffSel = $('#sel-diff');
    diffSel.innerHTML = '';
    for (const d of DIFFICULTIES) {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name;
      if (d.id === DEFAULT_DIFFICULTY) o.selected = true;
      diffSel.append(o);
    }

    const scoreSel = $('#sel-score');
    scoreSel.innerHTML = '';
    for (const n of [5, 10, 15, 20, 30, 50]) {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = `${n} kills`;
      if (n === 20) o.selected = true;
      scoreSel.append(o);
    }

    $('#inp-server').value = localStorage.getItem('nm.server') || defaultServer();
    $('#inp-name').value = localStorage.getItem('nm.name') || '';
    $('#inp-room').value = localStorage.getItem('nm.room') || 'arena';
  }

  bindButtons() {
    $$('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const a = el.dataset.action;
        this.game.audio.init();
        this.game.audio.play(a === 'back' ? 'uiBack' : 'ui');
        this.game.onUiAction(a);
      });
    });

    $$('[data-toggle]').forEach((el) => {
      el.addEventListener('click', () => {
        this.game.audio.init();
        this.game.onToggle(el.dataset.toggle, el);
      });
    });

    $('#btn-start').addEventListener('click', () => {
      this.game.audio.init();
      this.game.audio.play('ui');
      this.game.startFromLoadout();
    });

    for (const [id, key] of [['#inp-server', 'nm.server'], ['#inp-name', 'nm.name'], ['#inp-room', 'nm.room']]) {
      $(id).addEventListener('change', (e) => localStorage.setItem(key, e.target.value.trim()));
    }
    for (const [id, key] of [['#sel-map', 'nm.map'], ['#sel-bots', 'nm.bots'], ['#sel-diff', 'nm.diff'], ['#sel-score', 'nm.score']]) {
      $(id).addEventListener('change', (e) => localStorage.setItem(key, e.target.value));
    }
  }

  restorePrefs() {
    for (const [id, key] of [['#sel-map', 'nm.map'], ['#sel-bots', 'nm.bots'], ['#sel-diff', 'nm.diff'], ['#sel-score', 'nm.score']]) {
      const v = localStorage.getItem(key);
      if (v != null && $(id).querySelector(`option[value="${CSS.escape(v)}"]`)) $(id).value = v;
    }
  }

  // ------------------------------------------------------------------
  selectHero(id) {
    this.heroId = id;
    localStorage.setItem('nm.hero', id);
    const hero = getHero(id);

    $$('.hero-card').forEach((c) => c.classList.toggle('selected', c.dataset.hero === id));

    $('#hero-name').textContent = hero.name;
    $('#hero-name').style.color = hero.palette.trim;
    $('#hero-title').textContent = hero.title;
    $('#hero-blurb').textContent = hero.blurb;
    $('#ability-name').textContent = hero.ability.name;
    $('#ability-desc').textContent = hero.ability.desc;
    $('#ability-cd').textContent = `${hero.ability.cooldown}s COOLDOWN`;

    const w = WEAPONS[hero.sidearm];
    $('#sidearm').innerHTML = `SIGNATURE SIDEARM &nbsp;<b>${w.name}</b> &nbsp;·&nbsp; ${w.damage} dmg &nbsp;·&nbsp; ${w.rpm} rpm &nbsp;·&nbsp; ∞ reserve`;

    const stats = $('#hero-stats');
    stats.innerHTML = '';
    for (const row of STAT_ROWS) {
      const v = hero.stats[row.key] ?? 0;
      const el = document.createElement('div');
      el.className = 'stat';
      el.innerHTML = `<span>${row.label}</span>
        <span class="track"><span class="fill" style="width:${Math.min(100, (v / row.max) * 100)}%;
          background:linear-gradient(90deg, ${hero.palette.accent}, ${hero.palette.trim})"></span></span>
        <span class="val">${row.fmt(v)}</span>`;
      stats.append(el);
    }
  }

  /** Called every animation frame while a menu is up. */
  tickPortraits(dt) {
    this.t += dt;
    for (const { hero, ctx } of this.portraits) {
      ctx.clearRect(0, 0, 78, 78);
      ctx.save();
      ctx.translate(39, 52);
      drawHeroPortrait(ctx, hero, this.t + hero.id.length, 1.28, -0.2);
      ctx.restore();
    }
    if (this.stageCtx && this.current === 'loadout') {
      const ctx = this.stageCtx;
      ctx.clearRect(0, 0, 260, 260);
      const hero = getHero(this.heroId);
      ctx.save();
      ctx.translate(130, 176);
      const aim = Math.sin(this.t * 0.7) * 0.5 - 0.1;
      drawHeroPortrait(ctx, hero, this.t, 3.3, aim);
      ctx.restore();
      // ground glow
      ctx.save();
      const g = ctx.createRadialGradient(130, 182, 4, 130, 182, 82);
      g.addColorStop(0, hero.palette.glow + '55');
      g.addColorStop(1, 'transparent');
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = g;
      ctx.fillRect(0, 120, 260, 140);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------
  show(name) {
    this.current = name;
    for (const id of ['menu', 'loadout', 'controls']) {
      $(`#screen-${id}`).classList.toggle('hidden', id !== name);
    }
    document.body.classList.toggle('menu', name !== 'game');
    if (name === 'game') {
      $('#screen-menu').classList.add('hidden');
      $('#screen-loadout').classList.add('hidden');
      $('#screen-controls').classList.add('hidden');
    }
  }

  setMode(mode) {
    this.mode = mode;
    $('#setup-solo').classList.toggle('hidden', mode !== 'single');
    $('#setup-online').classList.toggle('hidden', mode !== 'online');
    $('#loadout-title').textContent = mode === 'online' ? 'ONLINE — CHOOSE YOUR FIGHTER' : 'CHOOSE YOUR FIGHTER';
    $('#btn-start').textContent = mode === 'online' ? 'CONNECT' : 'DEPLOY';
    $('#loadout-hint').textContent = mode === 'online'
      ? 'Run `npm start` on the host machine, then share its address.'
      : 'Tip: recoil pushes you backwards — use it to change direction mid-air.';
  }

  loadoutValues() {
    return {
      heroId: this.heroId,
      mapId: $('#sel-map').value,
      bots: Number($('#sel-bots').value),
      difficulty: $('#sel-diff').value,
      scoreLimit: Number($('#sel-score').value),
      name: ($('#inp-name').value || '').trim() || 'PILOT',
      server: ($('#inp-server').value || '').trim() || defaultServer(),
      room: ($('#inp-room').value || '').trim() || 'arena',
    };
  }

  setPause(on) { $('#screen-pause').classList.toggle('hidden', !on); }

  showConnecting(on, text = 'CONNECTING…') {
    $('#connecting').classList.toggle('hidden', !on);
    $('#connecting-text').textContent = text;
  }

  toast(msg, ms = 4200) {
    const el = $('#error-toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  showResults(world, localId) {
    const rows = world.fighters.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const me = rows.find((f) => f.id === localId);
    const won = world.winner && world.winner.id === localId;

    $('#results-title').textContent = won ? 'VICTORY' : (world.winner ? 'DEFEAT' : 'MATCH OVER');
    $('#results-title').style.color = won ? 'var(--green)' : 'var(--red)';
    $('#results-sub').textContent = world.winner
      ? `${world.winner.name} takes ${world.map.name}`
      : `Time up on ${world.map.name}`;

    const table = $('#results-table');
    table.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'res-row head';
    head.innerHTML = `<span>#</span><span>FIGHTER</span><span>HERO</span>
      <span class="num">K</span><span class="num">D</span><span class="num">DMG</span>`;
    table.append(head);

    rows.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'res-row' + (f.id === localId ? ' me' : '');
      row.innerHTML = `<span class="rank">${i + 1}</span>
        <span>${escapeHtml(f.name)}${f.isBot ? ' · BOT' : ''}</span>
        <span class="hero" style="color:${f.hero.palette.accent}">${f.hero.name}</span>
        <span class="num">${f.kills}</span>
        <span class="num">${f.deaths}</span>
        <span class="num">${Math.round(f.damageDealt)}</span>`;
      table.append(row);
    });

    $('#screen-results').classList.remove('hidden');
    return { won, me };
  }

  hideResults() { $('#screen-results').classList.add('hidden'); }
}

function defaultServer() {
  if (location.protocol === 'file:') return 'ws://localhost:8080';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
