// The hero roster. Each fighter has its own silhouette, palette, stat line and
// an active ability on a cooldown. Stats are multipliers on the base tuning in
// core/config.js unless the field name says otherwise.

export const HEROES = [
  {
    id: 'nova',
    name: 'NOVA',
    title: 'Neon Ninja',
    blurb: 'Glass cannon. Blinks through bullets and punishes anyone who blinks back.',
    style: 'ninja',
    sidearm: 'machinePistol',
    palette: {
      suit: '#1b1f3a', suitDark: '#10122a', accent: '#ff2e88',
      visor: '#4dfff0', glow: '#ff2e88', trim: '#ff7ab8', metal: '#5a6398',
    },
    stats: { health: 88, speed: 1.18, fuel: 1.0, fuelRegen: 1.15, damage: 1.0, armor: 0, melee: 1.15 },
    ability: {
      id: 'dash', name: 'Phase Dash', cooldown: 4.5, duration: 0.18,
      desc: 'Blink along your aim. Untouchable mid-blink.',
      speed: 1150, invuln: 0.26,
    },
  },
  {
    id: 'titan',
    name: 'TITAN',
    title: 'Bulwark Mech',
    blurb: 'Walking fortress. Slow to move, slower to die, hits like a dropped anvil.',
    style: 'mech',
    sidearm: 'handCannon',
    palette: {
      suit: '#3c4250', suitDark: '#252a36', accent: '#ffb02e',
      visor: '#ff6a3d', glow: '#ffb02e', trim: '#ffd27a', metal: '#8d97ab',
    },
    stats: { health: 148, speed: 0.84, fuel: 0.85, fuelRegen: 0.85, damage: 1.0, armor: 0.18, melee: 1.3 },
    ability: {
      id: 'aegis', name: 'Aegis Shield', cooldown: 12, duration: 3.4,
      desc: 'Deploy a frontal barrier that eats incoming fire.',
      arc: 1.5, absorb: 0.85,
    },
  },
  {
    id: 'ember',
    name: 'EMBER',
    title: 'Rogue Pilot',
    blurb: 'Lives in the air. Burns fuel like it is free, because for her it nearly is.',
    style: 'pilot',
    sidearm: 'scattergun',
    palette: {
      suit: '#4a2340', suitDark: '#2c1428', accent: '#ff5f3d',
      visor: '#ffe27a', glow: '#ff7a3d', trim: '#ffa94d', metal: '#a0657d',
    },
    stats: { health: 100, speed: 1.05, fuel: 1.45, fuelRegen: 1.5, damage: 1.0, armor: 0, melee: 1.0 },
    ability: {
      id: 'afterburn', name: 'Afterburn', cooldown: 13, duration: 3.2,
      desc: 'Unlimited thrust and a burning contrail that scorches chasers.',
      thrust: 1.35, burnDamage: 34, burnRadius: 30,
    },
  },
  {
    id: 'kage',
    name: 'KAGE',
    title: 'Cyber Samurai',
    blurb: 'Closes the gap and ends the argument. His blade answers bullets in kind.',
    style: 'samurai',
    sidearm: 'pistol',
    palette: {
      suit: '#2b1230', suitDark: '#180a1c', accent: '#c7343f',
      visor: '#ff4d5e', glow: '#ff4d5e', trim: '#f0e0c0', metal: '#7a6a8a',
    },
    stats: { health: 116, speed: 1.0, fuel: 1.0, fuelRegen: 1.0, damage: 1.0, armor: 0.06, melee: 1.9 },
    ability: {
      id: 'iaido', name: 'Iaido Slash', cooldown: 7, duration: 0.42,
      desc: 'A lunging cut that deflects every shot it touches.',
      lunge: 780, damage: 78, range: 82, arc: 1.9,
    },
  },
  {
    id: 'vex',
    name: 'VEX',
    title: 'Void Hacker',
    blurb: 'You will not see her coming. You will barely see her leaving.',
    style: 'hacker',
    sidearm: 'pistol',
    palette: {
      suit: '#1a2b33', suitDark: '#0d1a20', accent: '#3dffb0',
      visor: '#9dff5e', glow: '#3dffb0', trim: '#7affd4', metal: '#4d7a80',
    },
    stats: { health: 92, speed: 1.08, fuel: 1.05, fuelRegen: 1.2, damage: 1.09, armor: 0, melee: 1.0 },
    ability: {
      id: 'ghost', name: 'Ghost Protocol', cooldown: 14, duration: 4.5,
      desc: 'Bend light around yourself and move faster. Firing breaks the veil.',
      speed: 1.3, alpha: 0.14,
    },
  },
  {
    id: 'bolt',
    name: 'BOLT',
    title: 'Storm Runner',
    blurb: 'Overclocked from the ribs out. Everything he shoots gets an extra jolt.',
    style: 'runner',
    sidearm: 'machinePistol',
    palette: {
      suit: '#152a4a', suitDark: '#0b172c', accent: '#4dc4ff',
      visor: '#ffffff', glow: '#4dc4ff', trim: '#9ee6ff', metal: '#5f84b8',
    },
    stats: { health: 106, speed: 1.12, fuel: 1.0, fuelRegen: 1.0, damage: 1.0, armor: 0, melee: 1.0 },
    ability: {
      id: 'overcharge', name: 'Overcharge', cooldown: 13, duration: 3.6,
      desc: 'Double fire rate and every round arcs lightning into nearby foes.',
      fireRate: 2.0, arcDamage: 11, arcRange: 155,
    },
  },
];

export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
export const getHero = (id) => HERO_BY_ID[id] || HEROES[0];
