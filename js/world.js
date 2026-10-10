'use strict';

function gateOnEdge(edge, w, h, rng){
  if(edge === 0) return { x: rng.range(170, w - 170), y: 84 };
  if(edge === 1) return { x: w - 84, y: rng.range(170, h - 170) };
  if(edge === 2) return { x: rng.range(170, w - 170), y: h - 84 };
  return { x: 84, y: rng.range(170, h - 170) };
}

function inAnyObstacle(rcList, x, y, pad){
  for(let i = 0; i < rcList.length; i++){
    const o = rcList[i];
    if(x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
  }
  return false;
}

function freeSpot(w, h, obstacles, rng, minSpawnDist, sx, sy, pad = 34){
  for(let i = 0; i < 60; i++){
    const x = rng.range(90, w - 90);
    const y = rng.range(90, h - 90);
    if(inAnyObstacle(obstacles, x, y, pad)) continue;
    if(minSpawnDist > 0 && sx !== undefined && dist(x, y, sx, sy) < minSpawnDist) continue;
    return { x: x, y: y };
  }
  for(let y = 70; y < h - 70; y += 40){
    for(let x = 70; x < w - 70; x += 40){
      if(!inAnyObstacle(obstacles, x, y, pad)) return { x, y };
    }
  }
  throw new Error('No free floor space');
}

// Set dressing: every floor leans on its own themed props; lit props glow in the dark.
const FLOOR_PROPS = [
  ['puddle', 'chain', 'bones'],    // The Drowned Gallery
  ['candles', 'urn', 'rug'],       // The Candle Warrens
  ['crystal', 'crate', 'urn'],     // Gilt Silt
  ['bones', 'roots', 'bones'],     // Hall of Small Teeth
  ['statue', 'candles', 'rug'],    // The Withheld Choir
  ['puddle', 'chain', 'crate'],    // Brine Vaults
  ['shrooms', 'roots', 'bones'],   // The Hushing
  ['urn', 'candles', 'bones'],     // Reliquary of Ash
  ['statue', 'bones', 'shrooms'],  // The Long Grief
  ['statue', 'candles', 'crystal'] // The Warden's Rest
];
const PROP_KINDS = ['bones', 'urn', 'crate', 'rug', 'puddle', 'chain', 'statue', 'roots', 'candles', 'crystal', 'shrooms'];
const LIT_PROPS = { candles: { color: '#ffb35c', r: 70 }, crystal: { color: '#7fd8ff', r: 78 }, shrooms: { color: '#9cf3a8', r: 62 } };

// The Warden's Rest (floor 10): a corridor with the last candle, then a round
// hall with eight pillars, four braziers and the throne. Geometry is fixed;
// only the dressing comes from the seed, so every client builds the same room.
const ARENA = { cx: 900, cy: 860, floorR: 620, corridor: { x: 760, y: 1400, w: 280, h: 930 } };
function generateWardenArena(num, rng){
  const C = { x: ARENA.cx, y: ARENA.cy }, deg = Math.PI / 180;
  const obstacles = [];
  for(let k = 0; k < 8; k++){
    const a = (22.5 + k * 45) * deg, x = C.x + Math.cos(a) * 230, y = C.y + Math.sin(a) * 230;
    obstacles.push({ x: x - 24, y: y - 24, w: 48, h: 48, pillar: k, dyn: true });
  }
  const vents = [{ x: 900, y: 2090, fuel: 90, maxFuel: 90, refillT: 0, spurtT: 0.5, active: true, seed: rng.range(0, TAU), corridor: true }];
  [45, 135, 225, 315].forEach(function(d){
    vents.push({ x: C.x + Math.cos(d * deg) * 540, y: C.y + Math.sin(d * deg) * 540, fuel: 0, maxFuel: rng.range(70, 90),
      refillT: rng.range(5, 14), spurtT: rng.range(0.4, 2), active: false, seed: rng.range(0, TAU) });
  });
  const pickups = [{ type: 'oil', x: 840, y: 2000, val: 28, t: 0 }, { type: 'oil', x: 960, y: 2000, val: 28, t: 1 }];
  for(let i = 0; i < 12; i++) pickups.push({ type: 'ember', x: rng.range(790, 1010), y: rng.range(1480, 2280), val: rng.int(1, 3), t: rng.range(0, 9) });
  pickups.push({ type: 'power', kind: rng.pick(['blaze', 'haste', 'well']), x: 830, y: 1880, val: 0, t: 2 });
  pickups.push({ type: 'power', kind: rng.pick(['blaze', 'haste', 'well']), x: 970, y: 1880, val: 0, t: 3 });
  pickups.forEach(function(p, i){ p.id = i + 1; });
  const props = [];
  for(let i = 0; i < 26; i++){
    const a = rng.range(0, TAU), r = rng.range(560, 600);
    props.push({ kind: rng.pick(['statue', 'chain', 'bones', 'bones', 'urn']), x: C.x + Math.cos(a) * r, y: C.y + Math.sin(a) * r, a: rng.range(0, TAU), s: rng.range(0.85, 1.15), seed: rng.range(0, 99) });
  }
  for(let i = 0; i < 10; i++){
    props.push({ kind: rng.pick(['bones', 'chain', 'puddle']), x: rng.range(780, 1020), y: rng.range(1500, 2300), a: rng.range(0, TAU), s: rng.range(0.8, 1.1), seed: rng.range(0, 99) });
  }
  props.sort(function(a, b){ return (a.kind === 'puddle' ? 0 : 1) - (b.kind === 'puddle' ? 0 : 1); });
  const shards = [];
  for(let i = 0; i < 7 && shards.length < 7; i++){
    for(let tries = 0; tries < 20; tries++){
      const a = rng.range(0, TAU), r = rng.range(150, 500), x = C.x + Math.cos(a) * r, y = C.y + Math.sin(a) * r;
      if(!inAnyObstacle(obstacles, x, y, 40)){ shards.push({ x: x, y: y }); break; }
    }
  }
  const candles = [];
  for(let j = 0; j < 16; j++){ const a = (11.25 + j * 22.5) * deg; candles.push({ x: C.x + Math.cos(a) * 598, y: C.y + Math.sin(a) * 598 }); }
  return {
    num: num, w: 1800, h: 2400,
    obstacles: obstacles, pickups: pickups, nextPickupId: pickups.length + 1,
    vents: vents, ventCycleT: 1e9,
    spawn: { x: 900, y: 2240 }, gate: { x: 900, y: 272 },
    decor: [], props: props,
    quota: 0, initial: 0, spawnInterval: 99, boss: 'warden',
    gateOpen: false, spawnsLeft: 0, spawnT: 0,
    arena: {
      cx: C.x, cy: C.y, floorR: ARENA.floorR, corridor: ARENA.corridor, sealed: false,
      throne: { x: 900, y: 372 }, candle: { x: 900, y: 1650 },
      braziers: [0, 90, 180, 270].map(function(d){ return { x: C.x + Math.cos(d * deg) * 170, y: C.y + Math.sin(d * deg) * 170, lit: true, prog: 0 }; }),
      candles: candles, candlesLit: 16, shards: shards, dark: 0.80, gateGlow: 0, pm: 255
    }
  };
}
// Keeps a point on the arena floor: the round hall, plus the corridor until the
// wax wall seals it.
function arenaClamp(W, o, pad){
  const A = W.arena, cr = A.corridor;
  const dx = o.x - A.cx, dy = o.y - A.cy, d = Math.hypot(dx, dy) || 1, lim = A.floorR - pad;
  if(d <= lim) return;
  const inCorr = !A.sealed && o.x >= cr.x + pad && o.x <= cr.x + cr.w - pad && o.y >= cr.y && o.y <= cr.y + cr.h - pad;
  if(inCorr) return;
  const cx = A.cx + dx / d * lim, cy = A.cy + dy / d * lim;
  if(A.sealed){ o.x = cx; o.y = cy; return; }
  const rx = clamp(o.x, cr.x + pad, cr.x + cr.w - pad), ry = clamp(o.y, cr.y, cr.y + cr.h - pad);
  if(dist(o.x, o.y, rx, ry) < dist(o.x, o.y, cx, cy)){ o.x = rx; o.y = ry; }
  else { o.x = cx; o.y = cy; }
}
// Removes the pillars whose bit is clear in `mask` (they burst between phases).
function applyPillarMask(W, mask){
  W.obstacles = W.obstacles.filter(function(o){ return o.pillar === undefined || (mask >> o.pillar) & 1; });
  W.arena.pm = mask;
}

function generateFloor(num, rng){
  if(num === CFG.floorMax) return generateWardenArena(num, rng);
  const w = Math.min(2300, 1500 + num * 45);
  const h = Math.min(1500, 950 + num * 30);
  const obstacles = [];
  const target = Math.min(12, 5 + num);
  for(let i = 0; i < target * 8 && obstacles.length < target; i++){
    const ow = rng.range(70, 190);
    const oh = rng.range(70, 190);
    const rc = { w: ow, h: oh, x: rng.range(110, w - 110 - ow), y: rng.range(110, h - 110 - oh) };
    let ok = true;
    for(let j = 0; j < obstacles.length; j++){
      if(overlapRects(rc, obstacles[j], 50)) { ok = false; break; }
    }
    if(ok) obstacles.push(rc);
  }

  const edge = rng.int(0, 3);
  const gate = gateOnEdge(edge, w, h, rng);
  const corners = [
    { x: 115, y: 115 },
    { x: w - 115, y: 115 },
    { x: w - 115, y: h - 115 },
    { x: 115, y: h - 115 }
  ];
  let bestC = corners[0], bestD = -1;
  for(let i = 0; i < 4; i++){
    const d = dist(corners[i].x, corners[i].y, gate.x, gate.y);
    if(d > bestD){ bestD = d; bestC = corners[i]; }
  }
  const spawn = {
    x: clamp(bestC.x + rng.range(-70, 70), 70, w - 70),
    y: clamp(bestC.y + rng.range(-70, 70), 70, h - 70)
  };
  if(inAnyObstacle(obstacles, spawn.x, spawn.y, 40)){
    Object.assign(spawn, freeSpot(w, h, obstacles, rng, 0));
  }

  const vents = [];
  const nVents = 3 + Math.min(3, Math.floor(num / 2));
  for(let i = 0; i < nVents * 4 && vents.length < nVents; i++){
    const e = rng.int(0, 3);
    let x, y;
    if(e === 0){ x = rng.range(140, w - 140); y = 60; }
    else if(e === 1){ x = w - 60; y = rng.range(140, h - 140); }
    else if(e === 2){ x = rng.range(140, w - 140); y = h - 60; }
    else { x = 60; y = rng.range(140, h - 140); }
    if(vents.some(function(v){ return dist(v.x, v.y, x, y) < 260; })) continue;
    if(dist(x, y, spawn.x, spawn.y) < 200) continue;
    vents.push({
      x: clamp(x, 40, w - 40), y: clamp(y, 40, h - 40),
      fuel: rng.range(35, 75), maxFuel: rng.range(65, 95),
      refillT: 0, spurtT: rng.range(0.4, 2.2), active: true,
      seed: rng.range(0, TAU)
    });
  }
  // One random vent begins charged. More vents wake up at random while playing.
  if(vents.length){
    const firstVent = rng.int(0, vents.length - 1);
    for(let i = 0; i < vents.length; i++){
      vents[i].active = i === firstVent;
      vents[i].fuel = i === firstVent ? vents[i].maxFuel : 0;
      vents[i].refillT = i === firstVent ? 0 : rng.range(5, 14);
    }
  }

  const pickups = [];
  const nEmbers = Math.min(34, 8 + num * 2);
  for(let i = 0; i < nEmbers; i++){
    const s = freeSpot(w, h, obstacles, rng, 150, spawn.x, spawn.y);
    pickups.push({ type: 'ember', x: s.x, y: s.y, val: rng.int(1, 3), t: rng.range(0, 9) });
  }
  for(let i = 0; i < 3; i++){
    const s = freeSpot(w, h, obstacles, rng, 240, spawn.x, spawn.y);
    pickups.push({ type: 'oil', x: s.x, y: s.y, val: 28, t: rng.range(0, 9) });
  }
  const oilNear = { x: clamp(spawn.x + (w / 2 - spawn.x) * 0.5 + 60, 80, w - 80), y: clamp(spawn.y + (h / 2 - spawn.y) * 0.5 + 40, 80, h - 80) };
  if(!inAnyObstacle(obstacles, oilNear.x, oilNear.y, 30)){
    pickups.push({ type: 'oil', x: oilNear.x, y: oilNear.y, val: 28, t: 0 });
  }
  const nWick = 1 + (num % 4 === 0 ? 1 : 0);
  for(let i = 0; i < nWick; i++){
    const s = freeSpot(w, h, obstacles, rng, 300, spawn.x, spawn.y);
    pickups.push({ type: 'wick', x: s.x, y: s.y, val: 24, t: rng.range(0, 9) });
  }
  const nPower = Math.min(4, 2 + Math.floor(num / 3));
  for(let i = 0; i < nPower; i++){
    const s = freeSpot(w, h, obstacles, rng, 260, spawn.x, spawn.y);
    pickups.push({ type: 'power', kind: rng.pick(POWER_KINDS), x: s.x, y: s.y, val: 0, t: rng.range(0, 9) });
  }
  pickups.forEach(function(p, i){ p.id = i + 1; });

  const decor = [];
  const nDec = 18 + Math.min(14, num);
  for(let i = 0; i < nDec; i++){
    const s = freeSpot(w, h, obstacles, rng, 0, spawn.x, spawn.y);
    decor.push({
      x: s.x, y: s.y, r: rng.range(6, 15),
      c: rng.pick(['#232c46', '#2a3352', '#2b2a4d', '#22304a']),
      a: rng.range(0, TAU)
    });
  }

  const theme = FLOOR_PROPS[(num - 1) % FLOOR_PROPS.length];
  const props = [];
  const nProps = Math.round(w * h / 36000);
  for(let i = 0; i < nProps; i++){
    const kind = rng.chance(0.55) ? rng.pick(theme) : rng.pick(PROP_KINDS);
    const pad = kind === 'rug' ? 70 : kind === 'statue' ? 44 : 26;
    const s = freeSpot(w, h, obstacles, rng, 110, spawn.x, spawn.y, pad);
    props.push({ kind: kind, x: s.x, y: s.y, a: rng.range(0, TAU), s: rng.range(0.85, 1.25), seed: rng.range(0, 99) });
  }
  // Enough little lights that the dark always has something to find.
  const litKinds = Object.keys(LIT_PROPS);
  const themeLit = theme.filter(function(k){ return LIT_PROPS[k]; });
  for(let lit = props.filter(function(p){ return LIT_PROPS[p.kind]; }).length; lit < 7; lit++){
    const s = freeSpot(w, h, obstacles, rng, 110, spawn.x, spawn.y, 26);
    props.push({ kind: rng.pick(themeLit.length ? themeLit : litKinds), x: s.x, y: s.y, a: rng.range(0, TAU), s: rng.range(0.85, 1.2), seed: rng.range(0, 99) });
  }
  // Flat props first so everything else is drawn on top of them.
  props.sort(function(a, b){ return (a.kind === 'rug' || a.kind === 'puddle' ? 0 : 1) - (b.kind === 'rug' || b.kind === 'puddle' ? 0 : 1); });

  const boss = bossForFloor(num);
  const quota = Math.min(30, 8 + num * 2);
  const initial = boss ? 3 : Math.ceil(quota * 0.6);

  return {
    num: num,
    w: w, h: h,
    obstacles: obstacles,
    pickups: pickups,
    nextPickupId: pickups.length + 1,
    vents: vents,
    ventCycleT: rng.range(8, 14),
    spawn: spawn,
    gate: gate,
    decor: decor,
    props: props,
    quota: quota,
    initial: initial,
    spawnInterval: Math.max(1.2, 2.6 - num * 0.1),
    boss: boss,
    gateOpen: false,
    spawnsLeft: 0,
    spawnT: 0
  };
}

function placeMobSpot(world, rng, px, py){
  for(let i = 0; i < 50; i++){
    const x = rng.range(80, world.w - 80);
    const y = rng.range(80, world.h - 80);
    if(inAnyObstacle(world.obstacles, x, y, 28)) continue;
    const d = dist(x, y, px, py);
    if(d > 300 && d < 900) return { x: x, y: y };
  }
  return freeSpot(world.w, world.h, world.obstacles, rng, 300, px, py);
}

// A free spot away from the keepers that, among a handful of candidates, lies
// farthest from other shadows — so spawns cover the whole floor instead of
// clumping. `farLimit` keeps timed spawns from appearing absurdly far away.
function spreadSpot(world, rng, keepers, enemies, minKeeperDist, farLimit){
  let best = null, bestScore = -Infinity;
  for(let i = 0; i < 16; i++){
    const x = rng.range(80, world.w - 80), y = rng.range(80, world.h - 80);
    if(inAnyObstacle(world.obstacles, x, y, 30)) continue;
    let dk = Infinity, de = 600;
    for(let k = 0; k < keepers.length; k++) dk = Math.min(dk, dist(x, y, keepers[k].x, keepers[k].y));
    if(dk < minKeeperDist) continue;
    for(let e = 0; e < enemies.length; e++) de = Math.min(de, dist(x, y, enemies[e].x, enemies[e].y));
    const score = de - Math.max(0, dk - farLimit) * 0.6;
    if(score > bestScore){ bestScore = score; best = { x: x, y: y }; }
  }
  return best || placeMobSpot(world, rng, keepers[0].x, keepers[0].y);
}
