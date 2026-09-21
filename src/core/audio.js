// Every sound is synthesised at runtime — no audio files ship with the game.
// Sounds are positional: volume and stereo pan come from the camera.

import { clamp, rand } from './math.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.muted = false;
    this.listener = { x: 0, y: 0, range: 1500 };
    this.jetGain = null;
    this.music = null;
    this.musicOn = true;
    this._lastPlay = new Map();
  }

  /** Must be called from a user gesture, per browser autoplay policy. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);

    // one shared noise buffer, reused by every noise-based sound
    const len = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._buildJetLoop();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  setListener(x, y) { this.listener.x = x; this.listener.y = y; }

  _spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x;
    const dy = pos.y - this.listener.y;
    const d = Math.hypot(dx, dy);
    const gain = clamp(1 - d / this.listener.range, 0, 1) ** 1.6;
    const pan = clamp(dx / 700, -1, 1);
    return { gain, pan };
  }

  _out(pos, gain) {
    const s = this._spatial(pos);
    const total = gain * s.gain;
    if (total < 0.004) return null;
    const g = this.ctx.createGain();
    g.gain.value = total;
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = s.pan; g.connect(p); p.connect(this.sfxBus); }
    else g.connect(this.sfxBus);
    return g;
  }

  _tone(o) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.endFreq), t + o.dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + (o.attack ?? 0.004));
    env.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
    return env;
  }

  _noise(o) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const filt = this.ctx.createBiquadFilter();
    filt.type = o.filter || 'bandpass';
    filt.frequency.setValueAtTime(o.freq, t);
    if (o.endFreq) filt.frequency.exponentialRampToValueAtTime(Math.max(20, o.endFreq), t + o.dur);
    filt.Q.value = o.q ?? 1;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + (o.attack ?? 0.003));
    env.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    src.connect(filt); filt.connect(env);
    src.start(t);
    src.stop(t + o.dur + 0.02);
    return env;
  }

  /** Cheap throttle so a 900rpm LMG does not stack 15 voices per frame. */
  _throttle(name, ms) {
    const now = performance.now();
    const last = this._lastPlay.get(name) || 0;
    if (now - last < ms) return false;
    this._lastPlay.set(name, now);
    return true;
  }

  play(name, pos = null, opts = {}) {
    if (!this.enabled || this.muted) return;
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const fn = this.sounds[name];
    if (!fn) return;
    const out = this._out(pos, opts.gain ?? 1);
    if (!out) return;
    fn.call(this, out, opts);
  }

  get sounds() {
    if (this._sounds) return this._sounds;
    const S = {};

    S.pistol = (out) => {
      this._noise({ freq: 2200, endFreq: 500, dur: 0.1, q: 0.8 }).connect(out);
      this._tone({ freq: 340, endFreq: 70, dur: 0.1, type: 'square' }).connect(out);
    };
    S.smg = (out) => {
      if (!this._throttle('smg', 28)) return;
      this._noise({ freq: 2600, endFreq: 700, dur: 0.07, q: 1.2 }).connect(out);
      this._tone({ freq: 260, endFreq: 80, dur: 0.07, type: 'sawtooth' }).connect(out);
    };
    S.rifle = (out) => {
      if (!this._throttle('rifle', 34)) return;
      this._noise({ freq: 1800, endFreq: 380, dur: 0.14, q: 0.7 }).connect(out);
      this._tone({ freq: 420, endFreq: 60, dur: 0.12, type: 'square' }).connect(out);
    };
    S.cannon = (out) => {
      this._noise({ freq: 900, endFreq: 140, dur: 0.3, q: 0.5 }).connect(out);
      this._tone({ freq: 190, endFreq: 38, dur: 0.28, type: 'square' }).connect(out);
    };
    S.shotgun = (out) => {
      this._noise({ freq: 1400, endFreq: 180, dur: 0.32, q: 0.4 }).connect(out);
      this._tone({ freq: 150, endFreq: 40, dur: 0.24, type: 'sawtooth' }).connect(out);
    };
    S.rail = (out) => {
      this._tone({ freq: 180, endFreq: 3200, dur: 0.16, type: 'sawtooth', attack: 0.05 }).connect(out);
      this._noise({ freq: 5200, endFreq: 900, dur: 0.4, q: 3 }).connect(out);
    };
    S.rocket = (out) => {
      this._noise({ freq: 700, endFreq: 2600, dur: 0.5, q: 0.6, attack: 0.02 }).connect(out);
      this._tone({ freq: 120, endFreq: 300, dur: 0.4, type: 'sawtooth' }).connect(out);
    };
    S.plasma = (out) => {
      if (!this._throttle('plasma', 40)) return;
      this._tone({ freq: 900, endFreq: 2400, dur: 0.14, type: 'triangle' }).connect(out);
      this._noise({ freq: 3400, endFreq: 1200, dur: 0.12, q: 5 }).connect(out);
    };
    S.explosion = (out, o = {}) => {
      const scale = o.scale ?? 1;
      this._noise({ freq: 700 * scale, endFreq: 60, dur: 0.75, q: 0.35, filter: 'lowpass' }).connect(out);
      this._tone({ freq: 110, endFreq: 26, dur: 0.6, type: 'sine' }).connect(out);
      this._noise({ freq: 3000, endFreq: 400, dur: 0.22, q: 0.8 }).connect(out);
    };
    S.impact = (out) => {
      if (!this._throttle('impact', 22)) return;
      this._noise({ freq: 3600, endFreq: 1200, dur: 0.06, q: 2 }).connect(out);
    };
    S.hit = (out) => {
      this._tone({ freq: 900, endFreq: 1500, dur: 0.05, type: 'square' }).connect(out);
      this._noise({ freq: 1800, endFreq: 500, dur: 0.08, q: 1.5 }).connect(out);
    };
    S.hurt = (out) => {
      this._tone({ freq: 260, endFreq: 120, dur: 0.18, type: 'sawtooth' }).connect(out);
      this._noise({ freq: 700, endFreq: 200, dur: 0.16, q: 1 }).connect(out);
    };
    S.death = (out) => {
      this._tone({ freq: 420, endFreq: 48, dur: 0.7, type: 'sawtooth' }).connect(out);
      this._noise({ freq: 1400, endFreq: 90, dur: 0.6, q: 0.6 }).connect(out);
    };
    S.melee = (out) => {
      this._noise({ freq: 1200, endFreq: 4200, dur: 0.14, q: 2, attack: 0.01 }).connect(out);
    };
    S.blade = (out) => {
      this._tone({ freq: 1800, endFreq: 420, dur: 0.3, type: 'triangle' }).connect(out);
      this._noise({ freq: 5000, endFreq: 800, dur: 0.28, q: 4 }).connect(out);
    };
    S.pickup = (out) => {
      this._tone({ freq: 620, endFreq: 1240, dur: 0.12, type: 'triangle' }).connect(out);
      this._tone({ freq: 930, endFreq: 1860, dur: 0.16, type: 'sine' }).connect(out);
    };
    S.reload = (out) => {
      this._noise({ freq: 900, endFreq: 500, dur: 0.07, q: 3 }).connect(out);
      this._tone({ freq: 200, endFreq: 140, dur: 0.06, type: 'square' }).connect(out);
    };
    S.ability = (out) => {
      this._tone({ freq: 300, endFreq: 1400, dur: 0.3, type: 'triangle', attack: 0.02 }).connect(out);
      this._noise({ freq: 1200, endFreq: 4000, dur: 0.3, q: 2 }).connect(out);
    };
    S.blocked = (out) => {
      this._tone({ freq: 1400, endFreq: 900, dur: 0.12, type: 'square' }).connect(out);
      this._noise({ freq: 2600, endFreq: 1600, dur: 0.1, q: 6 }).connect(out);
    };
    S.spawn = (out) => {
      this._tone({ freq: 160, endFreq: 800, dur: 0.35, type: 'sine', attack: 0.03 }).connect(out);
    };
    S.ui = (out) => {
      this._tone({ freq: 880, endFreq: 1180, dur: 0.05, type: 'square' }).connect(out);
    };
    S.uiBack = (out) => {
      this._tone({ freq: 500, endFreq: 320, dur: 0.07, type: 'square' }).connect(out);
    };
    S.countdown = (out) => {
      this._tone({ freq: 700, endFreq: 700, dur: 0.12, type: 'square' }).connect(out);
    };
    S.victory = (out) => {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => {
          if (!this.ctx) return;
          const g = this._out(null, 0.5);
          if (g) this._tone({ freq: f, dur: 0.4, type: 'triangle' }).connect(g);
        }, i * 130);
      });
    };
    S.defeat = (out) => {
      [520, 430, 330, 220].forEach((f, i) => {
        setTimeout(() => {
          if (!this.ctx) return;
          const g = this._out(null, 0.5);
          if (g) this._tone({ freq: f, dur: 0.45, type: 'sawtooth' }).connect(g);
        }, i * 160);
      });
    };

    this._sounds = S;
    return S;
  }

  // ---- continuous jetpack roar ---------------------------------------
  _buildJetLoop() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 480;
    filt.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(filt); filt.connect(g); g.connect(this.sfxBus);
    src.start();
    this.jetGain = g;
    this.jetFilter = filt;
  }

  setJet(active, boosted = false) {
    if (!this.ctx || !this.jetGain) return;
    const t = this.ctx.currentTime;
    const target = active ? (boosted ? 0.16 : 0.09) : 0;
    this.jetGain.gain.setTargetAtTime(target, t, 0.05);
    this.jetFilter.frequency.setTargetAtTime(boosted ? 760 : 480, t, 0.1);
  }

  // ---- background music ----------------------------------------------
  startMusic() {
    if (!this.ctx || this.music || !this.musicOn) return;
    const root = 55;                       // A1
    const scale = [0, 3, 5, 7, 10, 12, 15];
    let step = 0;
    const tick = () => {
      if (!this.music) return;
      const t = this.ctx.currentTime;
      const note = root * Math.pow(2, scale[step % scale.length] / 12) * (step % 14 < 7 ? 2 : 4);

      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = note;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.connect(g); g.connect(this.musicBus);
      osc.start(t); osc.stop(t + 0.45);

      if (step % 4 === 0) {                // kick
        const k = this.ctx.createOscillator();
        k.type = 'sine';
        k.frequency.setValueAtTime(110, t);
        k.frequency.exponentialRampToValueAtTime(34, t + 0.18);
        const kg = this.ctx.createGain();
        kg.gain.setValueAtTime(0.9, t);
        kg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        k.connect(kg); kg.connect(this.musicBus);
        k.start(t); k.stop(t + 0.24);
      }
      if (step % 8 === 4) {                // hat
        const s = this.ctx.createBufferSource();
        s.buffer = this.noiseBuffer;
        const f = this.ctx.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = 7000;
        const hg = this.ctx.createGain();
        hg.gain.setValueAtTime(0.25, t);
        hg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        s.connect(f); f.connect(hg); hg.connect(this.musicBus);
        s.start(t); s.stop(t + 0.08);
      }
      step++;
      this.music = setTimeout(tick, 250);
    };
    this.music = setTimeout(tick, 0);
  }

  stopMusic() {
    if (this.music) clearTimeout(this.music);
    this.music = null;
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicOn) this.startMusic(); else this.stopMusic();
    return this.musicOn;
  }
}

/** Map a world event stream onto sound cues. */
export function playEvents(audio, events, world) {
  for (const ev of events) {
    switch (ev.type) {
      case 'shot': audio.play(ev.sfx, { x: ev.x, y: ev.y }, { gain: 0.8 }); break;
      case 'explosion': audio.play('explosion', ev, { gain: 1, scale: ev.radius / 110 }); break;
      case 'impact': audio.play(ev.target ? 'hit' : 'impact', ev, { gain: ev.target ? 0.9 : 0.45 }); break;
      case 'hit': if (ev.local) audio.play('hurt', null, { gain: 0.7 }); break;
      case 'kill': audio.play('death', ev, { gain: 0.85 }); break;
      case 'melee': audio.play('melee', ev, { gain: 0.7 }); break;
      case 'grenade': audio.play('reload', ev, { gain: 0.6 }); break;
      case 'pickup': audio.play('pickup', ev.local ? null : { x: 0, y: 0 }, { gain: ev.local ? 0.8 : 0.2 }); break;
      case 'blocked': audio.play('blocked', ev, { gain: 0.7 }); break;
      case 'respawn': audio.play('spawn', ev, { gain: 0.5 }); break;
      case 'deflect': audio.play('blade', ev, { gain: 0.7 }); break;
    }
  }
}
