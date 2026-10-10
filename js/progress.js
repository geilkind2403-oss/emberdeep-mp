'use strict';
/* Keeper progression. Every class levels up on its own: a run's score plus a
   bonus per floor cleared becomes XP for the class that was played. Each level
   past the first is one point for that class's skill tree; level 20 fills it.
   Skins unlock along the way. Everything lives in localStorage. */

const LEVEL_MAX = 20;
const PROGRESS_KEY = 'emberdeep_progress';
const XP_PER_FLOOR = 100;
const XP_VICTORY = 500;

// XP for the step from `level` to `level + 1`.
function xpStep(level){ return 200 + 150 * (level - 1); }
function levelFromXp(xp){
  let lv = 1;
  while(lv < LEVEL_MAX && xp >= xpStep(lv)){ xp -= xpStep(lv); lv++; }
  return { level: lv, into: xp, need: lv < LEVEL_MAX ? xpStep(lv) : 0 };
}

// Every class shares the same tree shape, so the generic slots (a1 unlock,
// a2 attack power, b1 ability power, c2 unlock, c3 ultimate power) are coded
// once in game.js; a3, b2, b3 and c1 are each class's own.
const TREE_BRANCHES = [
  { id: 'a', name: 'ATTACK', key: 'RMB', slots: ['a1', 'a2', 'a3'] },
  { id: 'b', name: 'ABILITY', key: 'E', slots: ['b1', 'b2', 'b3'] },
  { id: 'c', name: 'ULTIMATE', key: 'Q', slots: ['c1', 'c2', 'c3'] }
];
const SLOT_MAX = { a1: 1, a2: 3, a3: 2, b1: 3, b2: 1, b3: 2, c1: 3, c2: 1, c3: 3 }; // 19 points = LEVEL_MAX - 1
const TREE_SLOTS = Object.keys(SLOT_MAX);

const SKILL_TREES = {
  keeper: {
    alt: { name: 'WICK BOLT', icon: '➶', cd: 0.9, cost: 3 },
    ult: { name: 'DAWNBREAK', icon: '☀' },
    nodes: {
      a1: { name: 'Wick Bolt', desc: 'RMB: loose a bolt of light that pierces three shadows.' },
      a2: { name: 'Honed Wick', desc: 'Per rank: +20% Wick Bolt damage, −8% cooldown.' },
      a3: { name: 'Prism', desc: 'Rank 1: three bolts at once. Rank 2: five.' },
      b1: { name: 'Bright Beacon', desc: 'Per rank: +20% Flare Beacon damage, −10% cooldown.' },
      b2: { name: 'Lodestar', desc: 'The beacon drags shadows toward its heart.' },
      b3: { name: 'Hearth', desc: 'Per rank: keepers inside the beacon regain 4 oil/s.' },
      c1: { name: 'Steady Wick', desc: 'Per rank: +10 max Vigor, +10 max Oil.' },
      c2: { name: 'Dawnbreak', desc: 'Q ULTIMATE: for 6s your lantern burns like the sun. Double light, six-fold light burn, +30% damage, heals 30.' },
      c3: { name: 'High Sun', desc: 'Per rank: +25% Dawnbreak power, charges 15% faster.' }
    }
  },
  pyro: {
    alt: { name: 'SEARING RAY', icon: '⟿', cd: 1.6, cost: 5 },
    ult: { name: 'METEOR RAIN', icon: '☄' },
    nodes: {
      a1: { name: 'Searing Ray', desc: 'RMB: a beam that scorches every shadow in a line.' },
      a2: { name: 'Focused Lens', desc: 'Per rank: +20% Searing Ray damage, −8% cooldown.' },
      a3: { name: 'Scorch', desc: 'The ray sets shadows ablaze for 3s. More burn per rank.' },
      b1: { name: 'Fuel the Fire', desc: 'Per rank: +20% Fireball damage, −10% cooldown.' },
      b2: { name: 'Cluster', desc: 'Fireballs burst into three smaller blasts.' },
      b3: { name: 'Firestorm', desc: 'Fireballs leave burning ground: 3s, 5s at rank 2.' },
      c1: { name: 'Kindled Soul', desc: 'Per rank: +8% flame damage.' },
      c2: { name: 'Meteor Rain', desc: 'Q ULTIMATE: twelve meteors crash down around the cursor over 3s.' },
      c3: { name: 'Starfall', desc: 'Per rank: +25% Meteor Rain damage, charges 15% faster.' }
    }
  },
  guardian: {
    alt: { name: 'SHIELD SLAM', icon: '◭', cd: 2.2, cost: 0 },
    ult: { name: 'FORTRESS', icon: '⛫' },
    nodes: {
      a1: { name: 'Shield Slam', desc: 'RMB: a short, crushing arc that hurls shadows away.' },
      a2: { name: 'Heavy Hands', desc: 'Per rank: +20% Shield Slam damage, −8% cooldown.' },
      a3: { name: 'Concussion', desc: 'Per rank: slammed shadows are stunned for 0.7s.' },
      b1: { name: 'Steadfast', desc: 'Per rank: +20% Bulwark duration and shove, −10% cooldown.' },
      b2: { name: 'Rally', desc: 'Bulwark restores 20 Vigor to every keeper inside.' },
      b3: { name: 'Spiked Ward', desc: 'Per rank: shadows striking a warded keeper take 25 damage.' },
      c1: { name: 'Iron Wick', desc: 'Per rank: +20 max Vigor.' },
      c2: { name: 'Fortress', desc: 'Q ULTIMATE: every keeper is untouchable for 4s; a shockwave stuns and hurls back the shadows around you.' },
      c3: { name: 'Unbroken', desc: 'Per rank: +25% Fortress power, charges 15% faster.' }
    }
  },
  nightblade: {
    alt: { name: 'SHADOW DAGGERS', icon: '⟊', cd: 1.1, cost: 2 },
    ult: { name: 'THOUSAND CUTS', icon: '⚔' },
    nodes: {
      a1: { name: 'Shadow Daggers', desc: 'RMB: throw a fan of three daggers.' },
      a2: { name: 'Whetstone', desc: 'Per rank: +20% dagger damage, −8% cooldown.' },
      a3: { name: 'Barbed Fan', desc: 'Rank 1: five daggers. Rank 2: daggers pierce a second shadow.' },
      b1: { name: 'Keen Edge', desc: 'Per rank: +20% Shadowstep damage, −10% cooldown.' },
      b2: { name: 'Reaper', desc: 'A kill with Shadowstep makes it ready again.' },
      b3: { name: 'Nightfall', desc: 'Per rank: after Shadowstep you deal +25% damage for 3s.' },
      c1: { name: 'Quickblood', desc: 'Per rank: +5% move speed, −0.1s Wickstep cooldown.' },
      c2: { name: 'Thousand Cuts', desc: 'Q ULTIMATE: flicker through up to six shadows, striking each one.' },
      c3: { name: 'Death by Inches', desc: 'Per rank: +25% Thousand Cuts damage, one more target, charges 15% faster.' }
    }
  },
  lightbinder: {
    alt: { name: 'SUNMOTE', icon: '☉', cd: 3, cost: 4 },
    ult: { name: 'SANCTUARY', icon: '✴' },
    nodes: {
      a1: { name: 'Sunmote', desc: 'RMB: a slow orb of light that burns shadows and mends keepers it passes.' },
      a2: { name: 'Brighter Mote', desc: 'Per rank: +20% Sunmote power, −8% cooldown.' },
      a3: { name: 'Twin Suns', desc: 'Rank 1: motes also refill oil. Rank 2: cast two motes.' },
      b1: { name: 'Radiance', desc: 'Per rank: +20% Mending Light, −10% cooldown.' },
      b2: { name: 'Blessing', desc: 'Mending Light also grants 2s of Aegis.' },
      b3: { name: 'Afterglow', desc: 'Mending Light leaves a healing glow: 4s, 6s at rank 2.' },
      c1: { name: 'Clear Glass', desc: 'Per rank: +15 light radius, +8 max Oil.' },
      c2: { name: 'Sanctuary', desc: 'Q ULTIMATE: a great circle of light for 7s. Keepers inside heal and refuel; shadows inside burn and slow.' },
      c3: { name: 'Hallowed', desc: 'Per rank: +25% Sanctuary power, charges 15% faster.' }
    }
  }
};

// Skins unlock per class with that class's level.
const DEFAULT_FIRE = { core: '#fff0b0', mid: '#ffce63', edge: '#f18b28', tail: '#ee6515', glow: '#ffdc88', sparks: ['#ffcb70', '#e8943e', '#ffe7a6'] };
const SKINS = [
  { id: 'ash', name: 'ASHEN', lvl: 1, cloak: ['#384d4b', '#819283', '#b4b69b'], hood: '#c0bf9f', trim: '#bfa879', lamp: '#ffb953', fire: DEFAULT_FIRE },
  { id: 'verd', name: 'VERDIGRIS', lvl: 5, cloak: ['#1d3f37', '#4f8f78', '#a6d6bd'], hood: '#c4e2cf', trim: '#7fc4a4', lamp: '#ffc36b', fire: DEFAULT_FIRE },
  { id: 'blood', name: 'BLOODWICK', lvl: 10, cloak: ['#3d1a20', '#8c3a3f', '#d0857a'], hood: '#e2b9a8', trim: '#d16d5f', lamp: '#ff6a4d',
    fire: { core: '#ffd0c0', mid: '#ff7a5c', edge: '#d9322a', tail: '#a0141e', glow: '#ff9a80', sparks: ['#ff8a6b', '#d93a2a', '#ffc2a8'] } },
  { id: 'moon', name: 'MOONLIT', lvl: 15, cloak: ['#1c2742', '#53699e', '#b8c8ee'], hood: '#dbe4ff', trim: '#9fb6ff', lamp: '#8fd0ff',
    fire: { core: '#e8f6ff', mid: '#8fd0ff', edge: '#3f7dff', tail: '#2a4fd0', glow: '#bfe6ff', sparks: ['#9fd8ff', '#4a8dff', '#e2f3ff'] } },
  { id: 'sun', name: 'SUNFORGED', lvl: 20, cloak: ['#5a4316', '#c39a3c', '#ffe39b'], hood: '#fff1c9', trim: '#ffd36b', lamp: '#fff0a8', aura: true,
    fire: { core: '#ffffff', mid: '#fff0a0', edge: '#ffc43d', tail: '#ff9a1f', glow: '#fff6cf', sparks: ['#fff3c0', '#ffc43d', '#ffffff'] } },
  // Earned at the bottom of the deep, for every class: one per ending.
  { id: 'tallow', name: "TALLOW'S WICK", lvl: 1, flag: 'tallow', cloak: ['#2a1d3d', '#6b4a9a', '#c9b2ef'], hood: '#e6dcff', trim: '#ffd36b', lamp: '#ffe14d',
    fire: { core: '#ffffff', mid: '#ffe14d', edge: '#ffb347', tail: '#c98a2a', glow: '#fff3b0', sparks: ['#ffe14d', '#fff3b0', '#ffffff'] } },
  { id: 'cinder', name: 'CINDERBORN', lvl: 1, flag: 'cinder', cloak: ['#0b0b0e', '#2b2328', '#5a4a4f'], hood: '#9a8f92', trim: '#ff6a3d', lamp: '#ff6a3d',
    fire: { core: '#ffe0d0', mid: '#ff6a3d', edge: '#c42a12', tail: '#5a0a05', glow: '#ff9a7a', sparks: ['#ff6a3d', '#3a2a2a', '#ffb39a'] } }
];
function skinOpen(S, lv){ return S.flag ? !!(Progress.data && Progress.data.flags && Progress.data.flags[S.flag]) : S.lvl <= lv; }
function skinById(id){ return SKINS.find(function(s){ return s.id === id; }) || SKINS[0]; }

// Clamps a tree (possibly from another player) to valid ranks, a filled
// predecessor per branch and the point budget.
function sanitizeTree(cls, tree, budget){
  const out = {};
  if(budget === undefined) budget = LEVEL_MAX - 1;
  if(!SKILL_TREES[cls] || !tree || typeof tree !== 'object') return out;
  TREE_BRANCHES.forEach(function(b){
    b.slots.forEach(function(slot, i){
      let r = Math.floor(+tree[slot] || 0);
      r = clamp(r, 0, SLOT_MAX[slot]);
      if(i > 0 && !out[b.slots[i - 1]]) r = 0;
      r = Math.min(r, budget);
      budget -= r;
      if(r > 0) out[slot] = r;
    });
  });
  return out;
}
function treeSpent(tree){
  let n = 0;
  for(const k in tree) n += tree[k];
  return n;
}

const Progress = {
  data: null,
  blank(){
    const d = { v: 1, classes: {}, flags: {} };
    CLASS_IDS.forEach(function(id){ d.classes[id] = { xp: 0, tree: {}, skin: 'ash' }; });
    return d;
  },
  load(){
    let raw = null;
    try{ raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null'); }catch(e){}
    const out = this.blank();
    if(raw && raw.flags && typeof raw.flags === 'object') for(const k in raw.flags) out.flags[k] = !!raw.flags[k];
    this.data = out;
    if(raw && raw.classes){
      CLASS_IDS.forEach(function(id){
        const c = raw.classes[id], o = out.classes[id];
        if(!c) return;
        o.xp = Math.max(0, Math.floor(+c.xp || 0));
        const lv = levelFromXp(o.xp).level;
        o.tree = sanitizeTree(id, c.tree, lv - 1);
        o.skin = skinOpen(skinById(c.skin), lv) ? skinById(c.skin).id : 'ash';
      });
    }
    this.data = out;
    return out;
  },
  save(){ try{ localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.data)); }catch(e){} },
  of(cls){
    if(!this.data) this.load();
    return this.data.classes[cls] || this.data.classes.keeper;
  },
  info(cls){ return levelFromXp(this.of(cls).xp); },
  level(cls){ return this.info(cls).level; },
  points(cls){ return this.level(cls) - 1 - treeSpent(this.of(cls).tree); },
  canRank(cls, slot){
    const tree = this.of(cls).tree, b = TREE_BRANCHES.find(function(x){ return x.slots.indexOf(slot) >= 0; });
    if(!b || this.points(cls) <= 0 || (tree[slot] || 0) >= SLOT_MAX[slot]) return false;
    const i = b.slots.indexOf(slot);
    return i === 0 || (tree[b.slots[i - 1]] || 0) > 0;
  },
  rankUp(cls, slot){
    if(!this.canRank(cls, slot)) return false;
    const tree = this.of(cls).tree;
    tree[slot] = (tree[slot] || 0) + 1;
    this.save();
    return true;
  },
  reset(cls){ this.of(cls).tree = {}; this.save(); },
  skinUnlocked(cls, id){ return skinById(id).id === id && skinOpen(skinById(id), this.level(cls)); },
  setSkin(cls, id){
    if(!this.skinUnlocked(cls, id)) return false;
    this.of(cls).skin = id;
    this.save();
    return true;
  },
  // Returns the level before and after, for level-up feedback.
  addXp(cls, amount){
    const c = this.of(cls), from = this.level(cls);
    c.xp += Math.max(0, Math.round(amount));
    this.save();
    return { cls: cls, from: from, to: this.level(cls) };
  }
};
