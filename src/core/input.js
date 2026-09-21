// Input sources: keyboard + mouse, touch dual-stick (Mini-Militia style), and
// gamepad. All three collapse into the one input struct the Fighter consumes.

import { clamp, TAU } from './math.js';
import { blankInput } from '../game/fighter.js';

export const DEFAULT_BINDINGS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jet: ['KeyW', 'ArrowUp', 'Space'],
  down: ['KeyS', 'ArrowDown'],
  melee: ['KeyF'],
  grenade: ['KeyG'],
  ability: ['KeyQ', 'ShiftLeft'],
  reload: ['KeyR'],
  swap: ['KeyE'],
  scoreboard: ['Tab'],
  pause: ['Escape'],
  mute: ['KeyM'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered this frame
    this.bindings = DEFAULT_BINDINGS;
    this.mouse = { x: 0, y: 0, down: false, right: false };
    this.touch = { enabled: false, move: null, aim: null, buttons: {} };
    this.gamepadIndex = null;
    this.pad = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, fire: false, buttons: {} };
    this.lastSource = 'keyboard';
    this._install();
  }

  _install() {
    const c = this.canvas;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.lastSource = 'keyboard';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });

    // Canvas coordinates in CSS pixels, robust to the element being scaled.
    const toLocal = (e) => {
      const r = c.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (c.clientWidth / (r.width || 1)),
        y: (e.clientY - r.top) * (c.clientHeight / (r.height || 1)),
      };
    };

    c.addEventListener('mousemove', (e) => {
      const p = toLocal(e);
      this.mouse.x = p.x; this.mouse.y = p.y;
      this.lastSource = 'keyboard';
    });
    c.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.right = true;
      const p = toLocal(e);
      this.mouse.x = p.x; this.mouse.y = p.y;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.right = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- touch ----
    const handleTouch = (e) => {
      e.preventDefault();
      this.touch.enabled = true;
      this.lastSource = 'touch';
      const r = c.getBoundingClientRect();
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const active = { move: null, aim: null, buttons: {} };

      for (const t of e.touches) {
        const x = (t.clientX - r.left) * (cw / (r.width || 1));
        const y = (t.clientY - r.top) * (ch / (r.height || 1));
        const btn = this._buttonAt(x, y, cw, ch);
        if (btn) { active.buttons[btn] = true; continue; }
        const side = x < cw / 2 ? 'move' : 'aim';
        if (!active[side]) {
          const existing = this.touch[side];
          const origin = existing && existing.id === t.identifier
            ? existing.origin
            : { x, y };
          active[side] = { id: t.identifier, origin, x, y };
        }
      }
      this.touch.move = active.move;
      this.touch.aim = active.aim;
      this.touch.buttons = active.buttons;
    };
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      c.addEventListener(ev, handleTouch, { passive: false });
    }

    addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  // touch action buttons, laid out above the right stick
  buttonLayout(cw, ch) {
    const r = 30;
    const bx = cw - 74, by = ch - 210;
    return [
      { id: 'ability', label: 'Q', x: bx, y: by, r },
      { id: 'grenade', label: 'G', x: bx - 72, y: by + 6, r: 26 },
      { id: 'melee', label: 'F', x: bx - 16, y: by - 62, r: 26 },
      { id: 'reload', label: 'R', x: bx - 82, y: by - 56, r: 24 },
      { id: 'swap', label: 'E', x: 92, y: ch - 210, r: 24 },
    ];
  }

  _buttonAt(x, y, cw, ch) {
    for (const b of this.buttonLayout(cw, ch)) {
      if ((x - b.x) ** 2 + (y - b.y) ** 2 < (b.r + 8) ** 2) return b.id;
    }
    return null;
  }

  isDown(action) {
    return (this.bindings[action] || []).some((k) => this.keys.has(k));
  }

  wasPressed(action) {
    return (this.bindings[action] || []).some((k) => this.pressed.has(k));
  }

  endFrame() { this.pressed.clear(); }

  _pollGamepad() {
    if (this.gamepadIndex == null || !navigator.getGamepads) return false;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return false;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    const ax = gp.axes;
    this.pad.move = { x: dz(ax[0] || 0), y: dz(ax[1] || 0) };
    this.pad.aim = { x: dz(ax[2] || 0), y: dz(ax[3] || 0) };
    const b = gp.buttons;
    this.pad.buttons = {
      fire: (b[7]?.value || 0) > 0.3 || b[5]?.pressed,
      jet: b[0]?.pressed || (b[6]?.value || 0) > 0.3,
      melee: b[2]?.pressed,
      grenade: b[1]?.pressed || b[4]?.pressed,
      ability: b[3]?.pressed,
      reload: b[9]?.pressed || b[2]?.pressed,
      swap: b[8]?.pressed,
    };
    const any = Math.abs(this.pad.move.x) + Math.abs(this.pad.aim.x) > 0.1 ||
      Object.values(this.pad.buttons).some(Boolean);
    if (any) this.lastSource = 'gamepad';
    return true;
  }

  /**
   * Build the frame's input for the local fighter.
   * `toWorld(sx, sy)` converts screen pixels to world space.
   */
  build(fighter, toWorld, cw, ch) {
    const inp = blankInput();
    this._pollGamepad();

    // ---- keyboard / mouse ----
    inp.left = this.isDown('left');
    inp.right = this.isDown('right');
    inp.jet = this.isDown('jet');
    inp.down = this.isDown('down');
    inp.fire = this.mouse.down;
    inp.melee = this.isDown('melee') || this.mouse.right;
    inp.grenade = this.wasPressed('grenade');
    inp.ability = this.wasPressed('ability');
    inp.reload = this.wasPressed('reload');
    inp.swap = this.wasPressed('swap');
    const mw = toWorld(this.mouse.x, this.mouse.y);
    inp.aimX = mw.x; inp.aimY = mw.y;

    // ---- gamepad overlay ----
    if (this.lastSource === 'gamepad' && fighter) {
      const p = this.pad;
      if (p.move.x < -0.2) inp.left = true;
      if (p.move.x > 0.2) inp.right = true;
      if (p.buttons.jet || p.move.y < -0.55) inp.jet = true;
      if (p.move.y > 0.55) inp.down = true;
      if (p.buttons.melee) inp.melee = true;
      if (p.buttons.grenade) inp.grenade = true;
      if (p.buttons.ability) inp.ability = true;
      if (p.buttons.reload) inp.reload = true;
      if (p.buttons.swap) inp.swap = true;
      const m = Math.hypot(p.aim.x, p.aim.y);
      if (m > 0.25) {
        inp.aimX = fighter.x + (p.aim.x / m) * 300;
        inp.aimY = fighter.y - 4 + (p.aim.y / m) * 300;
        if (m > 0.62) inp.fire = true;
      }
      if (p.buttons.fire) inp.fire = true;
    }

    // ---- touch ----
    if (this.touch.enabled && fighter) {
      const stick = (s, max = 58) => {
        if (!s) return null;
        let dx = s.x - s.origin.x, dy = s.y - s.origin.y;
        const m = Math.hypot(dx, dy);
        if (m > max) { dx = (dx / m) * max; dy = (dy / m) * max; }
        return { x: dx / max, y: dy / max, m: Math.min(1, m / max) };
      };
      const mv = stick(this.touch.move);
      if (mv) {
        if (mv.x < -0.22) inp.left = true;
        if (mv.x > 0.22) inp.right = true;
        if (mv.y < -0.35) inp.jet = true;
        if (mv.y > 0.5) inp.down = true;
      }
      const am = stick(this.touch.aim);
      if (am && am.m > 0.2) {
        const len = Math.hypot(am.x, am.y) || 1;
        inp.aimX = fighter.x + (am.x / len) * 320;
        inp.aimY = fighter.y - 4 + (am.y / len) * 320;
        if (am.m > 0.45) inp.fire = true;
      }
      const b = this.touch.buttons;
      if (b.melee) inp.melee = true;
      if (b.grenade && !this._prevTouchButtons?.grenade) inp.grenade = true;
      if (b.ability && !this._prevTouchButtons?.ability) inp.ability = true;
      if (b.reload && !this._prevTouchButtons?.reload) inp.reload = true;
      if (b.swap && !this._prevTouchButtons?.swap) inp.swap = true;
      this._prevTouchButtons = { ...b };
    }

    return inp;
  }

  /** Where the crosshair should be drawn, in screen pixels. */
  pointerScreen(fighter, toScreen, cw, ch) {
    if (this.touch.enabled && this.touch.aim && fighter) {
      const p = toScreen(fighter.x + Math.cos(fighter.aimAngle) * 260,
                         fighter.y - 4 + Math.sin(fighter.aimAngle) * 260);
      return p;
    }
    if (this.lastSource === 'gamepad' && fighter) {
      return toScreen(fighter.x + Math.cos(fighter.aimAngle) * 260,
                      fighter.y - 4 + Math.sin(fighter.aimAngle) * 260);
    }
    return { x: this.mouse.x, y: this.mouse.y };
  }

  drawTouchControls(ctx, cw, ch, dpr = 1) {
    if (!this.touch.enabled) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ring = (s, color) => {
      if (!s) return;
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.origin.x, s.origin.y, 58, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.4;
      let dx = s.x - s.origin.x, dy = s.y - s.origin.y;
      const m = Math.hypot(dx, dy);
      if (m > 58) { dx = (dx / m) * 58; dy = (dy / m) * 58; }
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(s.origin.x + dx, s.origin.y + dy, 24, 0, TAU); ctx.fill();
    };
    ring(this.touch.move, '#7ce0ff');
    ring(this.touch.aim, '#ff7ad0');

    ctx.font = '700 15px "Rajdhani", system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const b of this.buttonLayout(cw, ch)) {
      const held = this.touch.buttons[b.id];
      ctx.globalAlpha = held ? 0.55 : 0.22;
      ctx.fillStyle = '#0d1424';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#9ee6ff'; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = held ? 1 : 0.6;
      ctx.fillStyle = '#cfe8ff';
      ctx.fillText(b.label, b.x, b.y + 5);
    }
    ctx.restore();
  }
}
