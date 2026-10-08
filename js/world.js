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

function generateFloor(num, rng){
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
