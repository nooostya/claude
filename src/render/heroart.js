// Every fighter and every gun is drawn from code — no sprite sheets.
// Each hero shares one skeleton but gets its own silhouette pieces, so the
// roster reads as six different people at a glance.

import { clamp, lerp, TAU } from '../core/math.js';

const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

function glow(ctx, color, blur, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// weapons, drawn pointing along +x with the grip near the origin
// ---------------------------------------------------------------------------
export function drawWeapon(ctx, id, pal, t = 0) {
  const body = '#20242f', edge = '#454c60', hot = pal.accent;
  ctx.lineWidth = 1;

  const barrel = (x, y, w, h, color = body) => { ctx.fillStyle = color; rr(ctx, x, y, w, h, Math.min(1.6, h / 2)); ctx.fill(); };

  switch (id) {
    case 'pistol':
      barrel(-2, -3, 17, 5);
      barrel(-3, -1, 6, 8, edge);
      ctx.fillStyle = hot; ctx.fillRect(12, -1.4, 3, 1.6);
      break;
    case 'machinePistol':
      barrel(-3, -3.2, 20, 5.4);
      barrel(-4, -1, 6, 9, edge);
      barrel(3, 1.5, 4, 7, edge);
      ctx.fillStyle = hot; ctx.fillRect(14, -1.6, 4, 1.8);
      break;
    case 'handCannon':
      barrel(-3, -4, 24, 7);
      barrel(-4, -1, 7, 10, edge);
      ctx.fillStyle = hot; ctx.fillRect(16, -2, 6, 2.2);
      ctx.fillStyle = edge; ctx.fillRect(2, -5.5, 8, 2);
      break;
    case 'scattergun':
      barrel(-3, -4.5, 22, 4);
      barrel(-3, -0.5, 22, 4);
      barrel(-5, 0, 7, 9, edge);
      ctx.fillStyle = hot; ctx.fillRect(18, -4.5, 2.5, 8);
      break;
    case 'smg':
      barrel(-6, -4, 28, 7);
      barrel(-8, -2, 7, 10, edge);
      barrel(0, 2.5, 5, 10, edge);
      ctx.fillStyle = edge; ctx.fillRect(-12, -3, 7, 4);
      ctx.fillStyle = hot; ctx.fillRect(19, -1.8, 5, 2);
      break;
    case 'rifle':
      barrel(-10, -4, 42, 7);
      barrel(-12, -2, 8, 10, edge);
      barrel(2, 2.5, 5, 11, edge);
      ctx.fillStyle = edge; ctx.fillRect(-17, -3.5, 8, 5);
      ctx.fillStyle = edge; ctx.fillRect(4, -7, 12, 3);      // scope rail
      ctx.fillStyle = hot; ctx.fillRect(28, -1.8, 6, 2);
      break;
    case 'shotgun':
      barrel(-10, -4.5, 44, 8);
      barrel(-13, -2, 8, 11, edge);
      barrel(10, 2.5, 12, 4, edge);                          // pump
      ctx.fillStyle = edge; ctx.fillRect(-18, -4, 9, 6);
      ctx.fillStyle = hot; ctx.fillRect(31, -2.4, 4, 3);
      break;
    case 'lmg':
      barrel(-12, -5, 48, 9);
      barrel(-14, -2, 8, 11, edge);
      barrel(-4, 3.5, 12, 11, edge);                         // box mag
      ctx.fillStyle = edge; ctx.fillRect(-20, -4, 10, 6);
      ctx.fillStyle = hot;
      for (let i = 0; i < 4; i++) ctx.fillRect(14 + i * 5, -6.4, 3, 2);
      ctx.fillRect(32, -2.2, 5, 2.4);
      break;
    case 'rail': {
      barrel(-14, -3.5, 54, 6);
      barrel(-16, -2, 8, 10, edge);
      const pulse = 0.5 + 0.5 * Math.sin(t * 7);
      ctx.fillStyle = hot;
      for (let i = 0; i < 5; i++) {
        ctx.globalAlpha = 0.45 + pulse * 0.55 * (1 - i / 5);
        ctx.fillRect(4 + i * 8, -6, 4, 11);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = edge; ctx.fillRect(-8, -8, 16, 3);
      break;
    }
    case 'rocket':
      barrel(-14, -6, 50, 12);
      barrel(-18, -8, 8, 16, edge);                          // rear flare
      barrel(-16, 2, 8, 10, edge);
      ctx.fillStyle = hot; ctx.fillRect(32, -5, 5, 10);
      ctx.fillStyle = edge; ctx.fillRect(0, -9, 14, 3);
      break;
    case 'plasma': {
      barrel(-10, -4.5, 40, 9);
      barrel(-12, -2, 8, 11, edge);
      const p = 0.5 + 0.5 * Math.sin(t * 11);
      glow(ctx, '#7ce0ff', 8 + p * 8, () => {
        ctx.fillStyle = '#7ce0ff';
        rr(ctx, 6, -3, 18, 6, 3); ctx.fill();
      });
      ctx.fillStyle = '#eaffff'; ctx.fillRect(26, -2, 6, 4);
      break;
    }
    default:
      barrel(-2, -3, 18, 5);
  }
}

// ---------------------------------------------------------------------------
// the fighter
// ---------------------------------------------------------------------------

/**
 * @param {object} d  { hero, facing, aimAngle, anim, thrusting, alive, cloak,
 *                      shielded, abilityId, abilityActive, weaponId, invuln,
 *                      time, scale }
 */
export function drawFighterArt(ctx, d) {
  const pal = d.hero.palette;
  const t = d.time || 0;
  const s = d.scale ?? 1;
  const facing = d.facing >= 0 ? 1 : -1;
  const walk = d.anim?.walk ?? 0;
  const airborne = !d.onGround;
  const moving = Math.abs(d.vx ?? 0) > 18;

  ctx.save();
  ctx.scale(s, s);

  const cloak = d.cloak ?? 0;
  if (cloak > 0.01) ctx.globalAlpha *= lerp(1, 0.16, cloak);

  // ---- jetpack (behind everything) ----
  ctx.save();
  ctx.scale(facing, 1);
  ctx.translate(-7, -4);
  ctx.fillStyle = pal.metal;
  rr(ctx, -5, -6, 9, 15, 3); ctx.fill();
  ctx.fillStyle = pal.suitDark;
  rr(ctx, -3.5, -4, 6, 11, 2); ctx.fill();
  ctx.fillStyle = pal.accent;
  ctx.fillRect(-3, -2.5, 5, 1.6);
  ctx.fillRect(-4, 9, 7, 3);
  ctx.restore();

  if (d.thrusting) drawThrust(ctx, facing, t, pal, d.abilityId === 'afterburn' && d.abilityActive);

  // ---- legs ----
  const stride = moving ? Math.sin(walk) : 0;
  const tuck = airborne ? 4 : 0;
  ctx.save();
  ctx.scale(facing, 1);
  drawLeg(ctx, pal, 2, stride, tuck, airborne);
  drawLeg(ctx, pal, -2, -stride, tuck * 0.6, airborne);
  ctx.restore();

  // ---- torso ----
  ctx.save();
  ctx.scale(facing, 1);
  ctx.rotate((d.anim?.lean ?? 0) * facing * 0.7 + (airborne ? -0.12 : 0));

  ctx.fillStyle = pal.suit;
  rr(ctx, -7, -12, 14, 18, 5); ctx.fill();
  ctx.fillStyle = pal.suitDark;
  rr(ctx, -7, -2, 14, 8, 4); ctx.fill();
  // chest light
  glow(ctx, pal.glow, 7, () => {
    ctx.fillStyle = pal.accent;
    rr(ctx, -3, -8, 6, 4, 2); ctx.fill();
  });

  drawStyleTorso(ctx, d.hero.style, pal, t, airborne);

  // ---- head ----
  ctx.save();
  ctx.translate(1.5, -16);
  ctx.fillStyle = pal.suitDark;
  ctx.beginPath(); ctx.arc(0, 0, 7.2, 0, TAU); ctx.fill();
  ctx.fillStyle = pal.suit;
  ctx.beginPath(); ctx.arc(-0.6, -0.6, 6.4, 0, TAU); ctx.fill();
  glow(ctx, pal.visor, 9, () => {
    ctx.fillStyle = pal.visor;
    rr(ctx, 0.5, -3.2, 6.4, 4.2, 2); ctx.fill();
  });
  drawStyleHead(ctx, d.hero.style, pal, t);
  ctx.restore();

  ctx.restore(); // torso

  // ---- weapon arm, driven by true aim angle ----
  drawArm(ctx, d, pal, t);

  // ---- state overlays ----
  if (d.shielded) drawShield(ctx, d, pal, t);
  if (d.invuln > 0) {
    ctx.globalAlpha *= 0.55;
    glow(ctx, '#ffffff', 16, () => {
      ctx.strokeStyle = '#dff3ff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, -4, 20, 0, TAU); ctx.stroke();
    });
  }
  if (d.abilityActive && d.abilityId === 'overcharge') {
    glow(ctx, '#9ee6ff', 14, () => {
      ctx.strokeStyle = '#9ee6ff'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const a = t * 6 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.arc(0, -4, 17 + Math.sin(t * 9 + i) * 2, a, a + 1.1);
        ctx.stroke();
      }
    });
  }

  ctx.restore();
}

function drawLeg(ctx, pal, ox, stride, tuck, airborne) {
  const knee = airborne ? 5 - tuck : 8;
  const foot = airborne ? 9 - tuck : 15;
  ctx.save();
  ctx.translate(ox, 4);
  ctx.rotate(stride * 0.5);
  ctx.strokeStyle = pal.suitDark;
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(stride * 1.5, knee);
  ctx.lineTo(stride * 3.5, foot);
  ctx.stroke();
  ctx.fillStyle = pal.metal;
  rr(ctx, stride * 3.5 - 3.4, foot - 1.4, 7, 3.4, 1.6); ctx.fill();
  ctx.restore();
}

function drawArm(ctx, d, pal, t) {
  const a = d.aimAngle;
  const left = Math.cos(a) < 0;
  const shoulderY = -7;
  const recoil = (d.anim?.recoil ?? 0) * 4;
  const reach = 13 - recoil;

  const hx = Math.cos(a) * reach;
  const hy = shoulderY + Math.sin(a) * reach;

  // support arm reads as a second hand on the barrel
  ctx.strokeStyle = pal.suitDark;
  ctx.lineCap = 'round';
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(-2, shoulderY + 1);
  ctx.lineTo(hx * 0.72, hy * 0.72 + 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(a);
  if (left) ctx.scale(1, -1);
  drawWeapon(ctx, d.weaponId, pal, t);
  if ((d.anim?.muzzle ?? 0) > 0) {
    glow(ctx, pal.accent, 16, () => {
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath();
      ctx.moveTo(24, 0); ctx.lineTo(34, -5); ctx.lineTo(44, 0); ctx.lineTo(34, 5);
      ctx.closePath(); ctx.fill();
    });
  }
  ctx.restore();

  ctx.strokeStyle = pal.suit;
  ctx.lineWidth = 4.6;
  ctx.beginPath();
  ctx.moveTo(0, shoulderY);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  glow(ctx, pal.glow, 5, () => {
    ctx.fillStyle = pal.trim;
    ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, TAU); ctx.fill();
  });
}

function drawThrust(ctx, facing, t, pal, boosted) {
  const n = boosted ? 3 : 2;
  const len = (boosted ? 26 : 16) + Math.sin(t * 40) * 4;
  ctx.save();
  ctx.translate(-7 * facing, 9);
  glow(ctx, boosted ? '#ff7a3d' : pal.visor, 18, () => {
    for (let i = 0; i < n; i++) {
      const w = 4.6 - i * 1.2;
      const l = len * (1 - i * 0.24);
      ctx.fillStyle = i === 0 ? (boosted ? '#ffd27a' : '#ffffff') : (boosted ? '#ff7a3d' : pal.visor);
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(0, l * 0.6, 0, l);
      ctx.quadraticCurveTo(0, l * 0.6, w, 0);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.restore();
}

// ---- per-hero silhouette pieces --------------------------------------------

function drawStyleTorso(ctx, style, pal, t, airborne) {
  switch (style) {
    case 'ninja': {                                  // trailing scarf
      const sway = Math.sin(t * 6) * 3;
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.moveTo(-4, -11);
      ctx.quadraticCurveTo(-16, -9 + sway, -22, -2 + sway * 1.6);
      ctx.quadraticCurveTo(-15, -6 + sway, -4, -7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = pal.trim;
      ctx.fillRect(-7, -12, 14, 2);
      break;
    }
    case 'mech':                                     // shoulder plates + antenna
      ctx.fillStyle = pal.metal;
      rr(ctx, -11, -13, 8, 8, 3); ctx.fill();
      rr(ctx, 3, -13, 8, 8, 3); ctx.fill();
      ctx.fillStyle = pal.accent;
      ctx.fillRect(-10, -12, 6, 1.6);
      ctx.fillRect(4, -12, 6, 1.6);
      ctx.strokeStyle = pal.metal; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(7, -13); ctx.lineTo(11, -24); ctx.stroke();
      glow(ctx, pal.accent, 8, () => {
        ctx.fillStyle = pal.accent;
        ctx.beginPath(); ctx.arc(11, -24, 1.7, 0, TAU); ctx.fill();
      });
      break;
    case 'pilot': {                                  // open jacket + hip scarf
      ctx.fillStyle = pal.trim;
      ctx.beginPath();
      ctx.moveTo(-7, -12); ctx.lineTo(-2, -12); ctx.lineTo(-4, 4); ctx.lineTo(-8, 3);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(7, -12); ctx.lineTo(2, -12); ctx.lineTo(4, 4); ctx.lineTo(8, 3);
      ctx.closePath(); ctx.fill();
      const sway = Math.sin(t * 5) * 2.5;
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.moveTo(-5, 3); ctx.quadraticCurveTo(-13, 8 + sway, -16, 15 + sway);
      ctx.quadraticCurveTo(-9, 8 + sway, -3, 5); ctx.closePath(); ctx.fill();
      break;
    }
    case 'samurai':                                  // shoulder guard + sheath
      ctx.fillStyle = pal.suitDark;
      ctx.beginPath();
      ctx.moveTo(-12, -12); ctx.lineTo(-2, -13); ctx.lineTo(-3, -5); ctx.lineTo(-12, -4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = pal.accent;
      ctx.fillRect(-11, -11, 8, 1.8);
      ctx.save();
      ctx.rotate(0.5);
      ctx.fillStyle = pal.trim;
      rr(ctx, -16, 4, 20, 2.6, 1.3); ctx.fill();
      ctx.fillStyle = pal.accent;
      ctx.fillRect(2, 3.6, 4, 3.4);
      ctx.restore();
      break;
    case 'hacker': {                                 // hood + floating data motes
      ctx.fillStyle = pal.suitDark;
      ctx.beginPath();
      ctx.moveTo(-8, -10); ctx.quadraticCurveTo(0, -26, 8, -10);
      ctx.quadraticCurveTo(0, -15, -8, -10); ctx.closePath(); ctx.fill();
      glow(ctx, pal.glow, 7, () => {
        ctx.fillStyle = pal.accent;
        for (let i = 0; i < 3; i++) {
          const a = t * 2.2 + (i * TAU) / 3;
          ctx.fillRect(Math.cos(a) * 13 - 1, -6 + Math.sin(a) * 9, 2.2, 2.2);
        }
      });
      break;
    }
    case 'runner': {                                 // speed trim + arc coil
      ctx.fillStyle = pal.accent;
      ctx.fillRect(-7, -9, 14, 1.6);
      ctx.fillRect(-7, -5, 10, 1.4);
      const p = 0.5 + 0.5 * Math.sin(t * 12);
      glow(ctx, pal.glow, 6 + p * 8, () => {
        ctx.strokeStyle = pal.trim; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, -3, 9, -0.6, 2.2); ctx.stroke();
      });
      break;
    }
  }
}

function drawStyleHead(ctx, style, pal, t) {
  switch (style) {
    case 'ninja':                                    // headband tails
      ctx.fillStyle = pal.accent;
      ctx.fillRect(-6.5, -4.5, 13, 2);
      ctx.beginPath();
      ctx.moveTo(-6, -4); ctx.lineTo(-13, -1 + Math.sin(t * 7) * 2); ctx.lineTo(-6, -1.5);
      ctx.closePath(); ctx.fill();
      break;
    case 'mech':                                     // brow bar
      ctx.fillStyle = pal.metal;
      rr(ctx, -6.5, -6.5, 13, 3.4, 1.5); ctx.fill();
      ctx.fillStyle = pal.accent; ctx.fillRect(-5, -5.8, 10, 1.2);
      break;
    case 'pilot':                                    // goggle strap + earcup
      ctx.strokeStyle = pal.trim; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, -1.5, 7, 0.3, 2.9); ctx.stroke();
      ctx.fillStyle = pal.metal;
      ctx.beginPath(); ctx.arc(-5, -1, 2.8, 0, TAU); ctx.fill();
      break;
    case 'samurai': {                                // crest horns
      ctx.fillStyle = pal.trim;
      ctx.beginPath();
      ctx.moveTo(-1, -6); ctx.quadraticCurveTo(-8, -15, -2, -9);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, -6); ctx.quadraticCurveTo(9, -15, 3, -9);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = pal.accent; ctx.fillRect(-5, -6.5, 10, 1.6);
      break;
    }
    case 'hacker': {                                 // scrolling glyph strip
      ctx.fillStyle = pal.accent;
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x = 0.8 + ((i * 2 + t * 9) % 6);
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 8 + i);
        ctx.fillRect(x, -2.6, 1.1, 1.1);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'runner':                                   // swept fin
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.moveTo(-2, -6); ctx.lineTo(-11, -3); ctx.lineTo(-2, -2.5);
      ctx.closePath(); ctx.fill();
      break;
  }
}

function drawShield(ctx, d, pal, t) {
  const a = d.aimAngle;
  const arc = d.hero.ability.arc || 1.5;
  ctx.save();
  ctx.translate(0, -4);
  ctx.rotate(a);
  glow(ctx, pal.accent, 16, () => {
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 14);
    ctx.beginPath(); ctx.arc(0, 0, 26, -arc / 2, arc / 2); ctx.stroke();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = pal.accent;
    ctx.beginPath(); ctx.arc(0, 0, 26, -arc / 2, arc / 2); ctx.lineTo(0, 0); ctx.fill();
  });
  ctx.restore();
}

/** Larger, idle-posed version for menus and the character select. */
export function drawHeroPortrait(ctx, hero, t, scale = 3, aim = -0.15) {
  drawFighterArt(ctx, {
    hero,
    facing: 1,
    aimAngle: aim,
    anim: { walk: t * 2, lean: 0, recoil: 0, muzzle: 0 },
    vx: 0, onGround: true,
    thrusting: false,
    alive: true,
    cloak: 0,
    shielded: false,
    abilityId: hero.ability.id,
    abilityActive: false,
    weaponId: hero.sidearm,
    invuln: 0,
    time: t,
    scale,
  });
}
