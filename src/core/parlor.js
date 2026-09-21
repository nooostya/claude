// Parlor integration.
//
// Parlor injects `window.Parlor` before the game scripts. When it is absent the
// game runs exactly as it always did — every method here becomes a no-op and
// the normal title screen flow takes over.
//
// The bridge deliberately knows nothing about the Game class; it talks to a
// small host interface so it can be unit tested without a DOM:
//
//   host.parlorStartRun(seed, autoStart)  reset to a fresh run on this seed
//   host.parlorStopRun()                  stop gameplay/timers, show the result
//   host.parlorScore()                    the current native score

/** Game-local player identifier. Signals integration; it does not authenticate. */
export const PLAYER_ID = 'player-1';

/**
 * Parlor may hand us a number or a string. Fold either into a uint32 the
 * game's PRNG can use.
 */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Math.floor(Math.abs(seed)) >>> 0;
  }
  const text = String(seed ?? '');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class ParlorBridge {
  constructor(host, sdk) {
    this.host = host;
    this.sdk = sdk || null;
    this.available = !!(this.sdk
      && typeof this.sdk.onRoundStart === 'function'
      && typeof this.sdk.onRoundEnd === 'function'
      && typeof this.sdk.reportScore === 'function');

    this.seed = null;        // applied at match start, so menus cannot consume it
    this.active = false;     // a Parlor round is in progress
    this.finalized = false;  // this round has been submitted, by us or by Parlor
    this.lastScore = null;
  }

  /** Register once. Returns true when running inside Parlor. */
  init() {
    if (!this.available) return false;
    try {
      if (typeof this.sdk.player === 'function') this.sdk.player(PLAYER_ID);
      this.sdk.onRoundStart((seed, context) => this._roundStart(seed, context));
      this.sdk.onRoundEnd(() => this._roundEndedByParlor());
    } catch (err) {
      console.warn('[parlor] integration disabled:', err);
      this.available = false;
      return false;
    }
    return true;
  }

  _roundStart(seed, context) {
    this.seed = normalizeSeed(seed);
    this.active = true;
    this.finalized = false;
    this.lastScore = null;
    // Missing context means autoStart true.
    const autoStart = context?.autoStart !== false;
    try {
      this.host.parlorStartRun(this.seed, autoStart);
    } catch (err) {
      console.warn('[parlor] could not start the run:', err);
    }
  }

  /** Parlor ended the round: report where we got to and stop playing. */
  _roundEndedByParlor() {
    if (this.available && this.active) {
      this._send(this._hostScore(), true);
    }
    // Parlor is finalizing, so we must not submit a game-over back to it.
    this.finalized = true;
    this.active = false;
    try {
      this.host.parlorStopRun();
    } catch (err) {
      console.warn('[parlor] could not stop the run:', err);
    }
  }

  _hostScore() {
    const score = this.host.parlorScore();
    return Number.isFinite(score) ? score : 0;
  }

  _send(score, force = false) {
    if (!Number.isFinite(score)) return;
    if (!force && score === this.lastScore) return;
    this.lastScore = score;
    try {
      this.sdk.reportScore(score);
    } catch (err) {
      console.warn('[parlor] reportScore failed:', err);
    }
  }

  /** Called when gameplay starts and whenever the native score changes. */
  reportScore(score, force = false) {
    if (!this.available || !this.active) return;
    this._send(score, force);
  }

  /**
   * Definitive defeat or completion. Reports the final score and submits the
   * game over exactly once; safe to call again.
   */
  finish(score) {
    if (!this.available || !this.active || this.finalized) return;
    this._send(score, true);
    this.finalized = true;
    this.active = false;
    try {
      this.sdk.onRoundEnd();
    } catch (err) {
      console.warn('[parlor] onRoundEnd failed:', err);
    }
  }
}
