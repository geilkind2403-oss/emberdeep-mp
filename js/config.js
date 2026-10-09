'use strict';

const CFG = {
  drain: 1.0,
  darkDps: 3,
  player: {
    hp: 100,
    oil: 100,
    speed: 235,
    lightR: 150,
    burn: 5,
    flame: { dps: 65, range: 175, half: 0.42, cost: 16, kb: 620, heal: 0, crit: 0, critMult: 2.5 },
    surge: { cd: 7, dmg: 45, r: 230, kb: 340 },
    dash: { cd: 1.6, dur: 0.16, speed: 660 },
    invuln: 0.7
  },
  floorMax: 10
};

const ENEMY_DEFS = {
  shade:  { hp: 26, dmg: 10, speed: 72,  r: 14, ember: 1, pts: 10, eye: '#8fd0ff', name: 'Shade' },
  gleam:  { hp: 13, dmg: 7,  speed: 155, r: 9,  ember: 1, pts: 15, eye: '#ffe9a3', name: 'Gleamchaser' },
  hollow: { hp: 95, dmg: 16, speed: 46,  r: 21, ember: 2, pts: 30, eye: '#ff8a3d', name: 'Hollow', shards: 8 },
  douser: { hp: 36, dmg: 9,  speed: 88,  r: 12, ember: 2, pts: 25, eye: '#c48aff', name: 'Douser', ranged: true, fireCd: 2.4, projSpeed: 235 },
  wraith: { hp: 560,  dmg: 16, speed: 88, r: 34, ember: 8, pts: 300, eye: '#ff4d6d', name: 'WICK WRAITH', boss: 'wraith' },
  warden: { hp: 1600, dmg: 22, speed: 70, r: 46, ember: 15, pts: 800, eye: '#b06bff', name: 'THE WARDEN', boss: 'warden' }
};

const UPGRADES = [
  { id: 'heart',  name: 'Heart of the Wick', desc: '+25 max Vigor, restore 25 now', flavor: 'A wick that refuses to quit.', max: 3, apply: function(p){ p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
  { id: 'swift',  name: 'Swift Steps', desc: '+12% move speed', flavor: 'The dark can hear you coming.', max: 3, apply: function(p){ p.speed *= 1.12; } },
  { id: 'vessel', name: 'Oilskin Vessel', desc: '+30 max Oil, +30 Oil now', flavor: 'Never dry, never dark.', max: 3, apply: function(p){ p.maxOil += 30; p.oil = Math.min(p.maxOil, p.oil + 30); } },
  { id: 'thin',   name: 'Thin Flame', desc: 'Flame burns 15% less oil', flavor: 'A careful hand wastes nothing.', max: 3, apply: function(p){ p.flame.cost *= 0.85; } },
  { id: 'fanned', name: 'Fanned Flames', desc: '+30% flame damage', flavor: 'Breathe on it and it bites.', max: 3, apply: function(p){ p.flame.dps *= 1.3; } },
  { id: 'broad',  name: 'Broad Burn', desc: '+20% flame arc, +12 flame range', flavor: 'Let the whole wall catch.', max: 3, apply: function(p){ p.flame.half *= 1.2; p.flame.range += 12; } },
  { id: 'reach',  name: 'Lantern Reach', desc: '+25 light radius', flavor: 'Push the night a step farther back.', max: 3, apply: function(p){ p.lightR += 25; } },
  { id: 'deepfl', name: 'Deeper Flame', desc: '+4 shadow-burn per second', flavor: 'Old fire, old hunger.', max: 3, apply: function(p){ p.burn += 4; } },
  { id: 'surgeP', name: 'Ember Surge', desc: '+40 surge damage, +30 surge radius', flavor: 'One breath of the old sun.', max: 3, apply: function(p){ p.surge.dmg += 40; p.surge.r += 30; } },
  { id: 'ready',  name: 'Ready Hand', desc: '-1.2s Surge cooldown', flavor: 'Always coiled, never spent.', max: 3, apply: function(p){ p.surge.cd = Math.max(2.5, p.surge.cd - 1.2); } },
  { id: 'wind',   name: 'Second Wind', desc: '-0.4s Dash cooldown', flavor: 'You are a rumor that keeps moving.', max: 3, apply: function(p){ p.dash.cd = Math.max(0.6, p.dash.cd - 0.4); } },
  { id: 'thirst', name: 'Ember Thirst', desc: 'Kills restore 3 Vigor', flavor: 'What you kill feeds you.', max: 3, apply: function(p){ p.lifesteal += 3; } },
  { id: 'greed',  name: 'Greed', desc: '+25% embers collected', flavor: 'Light is currency down here.', max: 3, apply: function(p){ p.greed *= 1.25; } },
  { id: 'siphon', name: 'Oil Siphon', desc: 'Kills restore 4 Oil', flavor: 'Their darkness is also fuel.', max: 3, apply: function(p){ p.oilOnKill += 4; } },
  { id: 'thorns', name: 'Glass Thorns', desc: 'Contact with you wounds attackers for 12', flavor: 'Touch the light, cut your hand.', max: 2, apply: function(p){ p.thorns += 12; } },
  { id: 'mend',   name: 'Mending Wick', desc: 'Flaming heals you for 3/s', flavor: 'Warmth, and then repair.', max: 2, apply: function(p){ p.flame.heal += 3; } },
  { id: 'crit',   name: 'Critical Wick', desc: '+15% chance of 2.5× flame damage', flavor: 'The hottest moment is never planned.', max: 2, apply: function(p){ p.flame.crit += 0.15; } },
  { id: 'ward',   name: 'Amber Ward', desc: '+12% chance to negate a hit', flavor: 'The lantern remembers being a shield.', max: 2, apply: function(p){ p.ward += 0.12; } }
];

// Keeper classes: picked on the title screen, each with its own ability on E.
const CLASSES = {
  keeper: {
    name: 'WICKKEEPER', icon: '◈', role: 'The balanced lantern-bearer',
    hp: 100, speed: 1, light: 0, flameDps: 1, flameRange: 0, dashCd: 0,
    passive: 'No weakness, no favourite.',
    ability: { id: 'flare', name: 'FLARE BEACON', cd: 11, desc: 'Plant a beacon at the cursor: it lights the dark and burns shadows for 6s.' }
  },
  pyro: {
    name: 'PYROMANCER', icon: '✺', role: 'Mage of the old fire',
    hp: 80, speed: 1, light: 0, flameDps: 1.15, flameRange: 20, dashCd: 0,
    passive: '+15% flame damage, +20 flame range. Frail: 80 Vigor.',
    ability: { id: 'fireball', name: 'FIREBALL', cd: 3.5, cost: 6, desc: 'Hurl an exploding fireball at the cursor (6 oil).' }
  },
  guardian: {
    name: 'GUARDIAN', icon: '⬡', role: 'Shield of the descent',
    hp: 140, speed: 0.92, light: 0, flameDps: 1, flameRange: 0, dashCd: 0,
    passive: '140 Vigor, a little slower.',
    ability: { id: 'bulwark', name: 'BULWARK', cd: 14, desc: 'You and keepers nearby are untouchable for 3s; shadows are hurled back.' }
  },
  nightblade: {
    name: 'NIGHTBLADE', icon: '⟁', role: 'Blade between the shadows',
    hp: 85, speed: 1.15, light: 0, flameDps: 1, flameRange: 0, dashCd: -0.4,
    passive: '+15% speed, faster Wickstep. 85 Vigor.',
    ability: { id: 'blink', name: 'SHADOWSTEP', cd: 6, desc: 'Blink to the cursor; both ends burst with shadowfire.' }
  },
  lightbinder: {
    name: 'LIGHTBINDER', icon: '✚', role: 'Healer of the last light',
    hp: 95, speed: 1, light: 40, flameDps: 1, flameRange: 0, dashCd: 0,
    passive: '+40 light radius.',
    ability: { id: 'mend', name: 'MENDING LIGHT', cd: 13, desc: 'Restore 35 Vigor and 20 Oil to you and keepers nearby.' }
  }
};
const CLASS_IDS = Object.keys(CLASSES);

// Temporary power-ups: lying on every floor and dropped by fallen shadows.
const POWERUPS = {
  blaze:  { name: 'INFERNO',    desc: 'Flame burns twice as hot',  dur: 10, color: '#ff8a3d', icon: '♨' },
  haste:  { name: 'QUICKSTEP',  desc: '+40% move speed',           dur: 10, color: '#7ddcff', icon: '»' },
  aegis:  { name: 'AEGIS',      desc: 'Hits cannot touch you',     dur: 6,  color: '#f4e3a1', icon: '⬡' },
  well:   { name: 'WELLSPRING', desc: 'The lantern burns no oil',  dur: 10, color: '#83e3c2', icon: '◈' },
  magnet: { name: 'LODESTONE',  desc: 'Pickups drift toward you',  dur: 14, color: '#c48aff', icon: '✦' },
  nova:   { name: 'SUNBURST',   desc: 'One blast of the old sun',  dur: 0,  color: '#ffd98a', icon: '✹' }
};
const POWER_KINDS = Object.keys(POWERUPS);
// Timed states granted by skills rather than picked up.
const STATUS_FX = {
  dawn:  { name: 'DAWNBREAK', color: '#ffe08a', icon: '☀' },
  night: { name: 'NIGHTFALL', color: '#b18cff', icon: '☾' }
};
function buffDef(kind){ return POWERUPS[kind] || STATUS_FX[kind] || { name: String(kind).toUpperCase(), color: '#ffffff', icon: '✦' }; }

// Co-op difficulty: every keeper beyond the first makes the deep harder.
function teamScale(keepers){
  const k = Math.max(0, keepers - 1);
  return { hp: 1 + 0.35 * k, bossHp: 1 + 0.6 * k, dmg: 1 + 0.1 * k, count: 1 + 0.3 * k };
}

const FLOOR_NAMES = [
  'The Drowned Gallery',
  'The Candle Warrens',
  'Gilt Silt',
  'Hall of Small Teeth',
  'The Withheld Choir',
  'Brine Vaults',
  'The Hushing',
  'Reliquary of Ash',
  'The Long Grief',
  "The Warden's Rest"
];

function floorName(n){
  if(n >= 1 && n <= FLOOR_NAMES.length) return FLOOR_NAMES[n - 1];
  return 'The Deep Below, ' + n;
}

function bossForFloor(n){
  if(n === CFG.floorMax || (n > CFG.floorMax && n % 10 === 0)) return 'warden';
  if(n % 5 === 0) return 'wraith';
  return null;
}

function mobWeights(floor){
  return [
    ['shade', 50],
    ['gleam', Math.min(34, 14 + floor * 2)],
    ['hollow', floor >= 2 ? Math.min(30, 6 + floor) : 0],
    ['douser', floor >= 3 ? Math.min(28, floor * 2) : 0]
  ];
}

function pickMobType(floor, rng){
  const ws = mobWeights(floor);
  let total = 0;
  for(let i = 0; i < ws.length; i++) total += ws[i][1];
  let roll = rng.range(0, total);
  for(let i = 0; i < ws.length; i++){
    roll -= ws[i][1];
    if(roll <= 0) return ws[i][0];
  }
  return 'shade';
}
