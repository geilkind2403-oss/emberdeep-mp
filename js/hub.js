'use strict';
/* Wickhollow: the last village above the deep, ringed by the Emberwood.
   A hub between runs. Walk to a door and press F: the smith forges gear for
   embers, the hall of the old flame holds the skill tree, the lodge changes
   your keeper, the elder talks. Shadows haunt the eastern wood (XP and
   embers), and the cave in the north leads down into the Emberdeep. */

// Gear bought at the smithy with banked embers; it comes along on every run.
const GEAR = {
  bow: { name: "HUNTER'S BOW", icon: '➹', key: 'R', tiers: [
    { price: 60,  dmg: 26, cd: 0.6,  speed: 820, pierce: 0, n: 1, desc: 'R: loose an arrow at the cursor.' },
    { price: 150, dmg: 40, cd: 0.5,  speed: 900, pierce: 1, n: 1, desc: 'Heavier arrows that pierce a shadow.' },
    { price: 320, dmg: 52, cd: 0.42, speed: 980, pierce: 2, n: 3, desc: 'Three arrows at once.' }
  ] },
  bombs: { name: 'EMBER BOMBS', icon: '✹', key: 'G', tiers: [
    { price: 90,  dmg: 70,  cd: 5,   r: 105, burn: 0, desc: 'G: lob a bomb at the cursor. Short fuse, big bang.' },
    { price: 210, dmg: 105, cd: 4.2, r: 125, burn: 0, desc: 'Bigger blast, shorter cooldown.' },
    { price: 400, dmg: 150, cd: 3.5, r: 145, burn: 1, desc: 'The blast sets shadows ablaze.' }
  ] },
  heart: { name: 'WICK HEART', icon: '♥', tiers: [
    { price: 80, desc: '+15 max Vigor.' }, { price: 160, desc: '+15 max Vigor.' }, { price: 280, desc: '+15 max Vigor.' }, { price: 440, desc: '+15 max Vigor.' }
  ] },
  flask: { name: 'OIL FLASK', icon: '◈', tiers: [
    { price: 70, desc: '+15 max Oil.' }, { price: 150, desc: '+15 max Oil.' }, { price: 260, desc: '+15 max Oil.' }
  ] }
};
const GEAR_IDS = Object.keys(GEAR);
function gearMax(id){ return GEAR[id] ? GEAR[id].tiers.length : 0; }
function sanitizeGear(g){
  const out = {};
  GEAR_IDS.forEach(function(id){ out[id] = clamp(Math.floor(+(g && g[id]) || 0), 0, gearMax(id)); });
  return out;
}

const HUB = {
  w: 2400, h: 1800,
  spawn: { x: 1100, y: 1390 },
  cave: { x: 1100, y: 190 },
  wood: { x: 1780, y: 640, w: 520, h: 680 }, // the haunted part of the Emberwood
  houses: [
    { id: 'smith',   name: 'THE SMITHY',            x: 600,  y: 520,  w: 260, h: 170, roof: '#6e3426', wall: '#4a3a30', npc: 'Brannoc', skin: 'blood' },
    { id: 'trainer', name: 'HALL OF THE OLD FLAME', x: 1340, y: 520,  w: 260, h: 170, roof: '#3b4f7a', wall: '#3c3a44', npc: 'Maelis',  skin: 'moon' },
    { id: 'lodge',   name: "KEEPERS' LODGE",        x: 600,  y: 1120, w: 240, h: 160, roof: '#3f6a4c', wall: '#3e3a32', npc: 'Odo',     skin: 'verd' },
    { id: 'elder',   name: "ELDER'S HUT",           x: 1360, y: 1130, w: 220, h: 150, roof: '#7a6a3a', wall: '#40382c', npc: 'Wenna',   skin: 'sun' }
  ]
};
HUB.houses.forEach(function(H){ H.door = { x: H.x + H.w / 2, y: H.y + H.h + 14 }; });

const ELDER_LINES = [
  "Another keeper. The cave in the north swallowed the last three. {y}Mind the dark{/y}.",
  'Embers you carry back up are worth more than gold here. {o}Brannoc{/o} will forge you something with them.',
  '{b}Maelis{/b} keeps the old flame in her hall. Every level the deep teaches you, she turns into a new trick.',
  "Shadows crawl out of the {o}eastern wood{/o} at dusk. Burn a few, if your lantern needs the practice.",
  "If the keeper you are sits wrong on you, {y}Odo's lodge{/y} can fit you for another.",
  'Down at the bottom waits the Warden. Some say he is cruel. I think he is only tired.'
];

function inRect(x, y, r, pad){ return x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad; }

function generateHub(){
  const rng = new Rng(4242), obstacles = [], trees = [];
  HUB.houses.forEach(function(H){ obstacles.push({ x: H.x, y: H.y, w: H.w, h: H.h, house: H.id }); });
  obstacles.push({ x: 1070, y: 930, w: 60, h: 60, well: true });
  const clear = [
    { x: 480, y: 430, w: 1240, h: 1100 },   // village
    { x: 1010, y: 120, w: 180, h: 330 },    // path to the cave
    { x: 1700, y: 900, w: 120, h: 120 },    // path into the wood
    { x: 1000, y: 1500, w: 200, h: 300 }    // south road
  ];
  for(let y = 40; y < HUB.h; y += 70){
    for(let x = 40; x < HUB.w; x += 70){
      const tx = x + rng.range(-24, 24), ty = y + rng.range(-24, 24);
      if(clear.some(function(c){ return inRect(tx, ty, c, 40); })) continue;
      if(inRect(tx, ty, HUB.wood, -30) && rng.next() < 0.75) continue; // the haunted wood is sparse
      if(dist(tx, ty, HUB.cave.x, HUB.cave.y) < 150) continue;
      const r = rng.range(26, 42);
      trees.push({ x: tx, y: ty, r: r, hue: rng.int(0, 3) });
      obstacles.push({ x: tx - 11, y: ty - 11, w: 22, h: 22, tree: true });
    }
  }
  return {
    num: 0, hub: true, w: HUB.w, h: HUB.h,
    obstacles: obstacles, trees: trees, pickups: [], nextPickupId: 1,
    vents: [], ventCycleT: 1e9, decor: [], props: [],
    spawn: { x: HUB.spawn.x, y: HUB.spawn.y }, gate: { x: HUB.cave.x, y: HUB.cave.y }, gateOpen: true,
    quota: 0, initial: 0, spawnsLeft: 0, spawnInterval: 99, spawnT: 99, boss: null
  };
}

const Hub = {
  // Static ground, paths, houses and trees, baked once.
  bake(R, W){
    const canvas = document.createElement('canvas'); canvas.width = W.w; canvas.height = W.h;
    const c = canvas.getContext('2d'), rng = new Rng(77);
    c.fillStyle = '#17261a'; c.fillRect(0, 0, W.w, W.h);
    for(let i = 0; i < 900; i++){
      c.fillStyle = rng.pick(['#1c2e1f', '#142217', '#203324', '#1a2a1b']);
      c.beginPath(); c.ellipse(rng.range(0, W.w), rng.range(0, W.h), rng.range(20, 70), rng.range(10, 40), rng.range(0, TAU), 0, TAU); c.fill();
    }
    // Paths: packed earth between the doors, the well, the cave and the wood.
    c.lineCap = 'round'; c.lineJoin = 'round';
    const path = function(pts, w){
      [[w + 10, '#2b2418'], [w, '#4a3d29'], [w * 0.55, '#56482f']].forEach(function(s){
        c.strokeStyle = s[1]; c.lineWidth = s[0]; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
        for(let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.stroke();
      });
    };
    path([[1100, 1800], [1100, 1390], [1100, 960], [1100, 200]], 70);
    path([[730, 720], [730, 820], [1100, 960], [1470, 820], [1470, 720]], 48);
    path([[720, 1320], [800, 1180], [1100, 960], [1400, 1180], [1470, 1310]], 44);
    path([[1100, 960], [1780, 960], [2040, 980]], 46);
    c.fillStyle = '#3e3526'; c.beginPath(); c.arc(1100, 960, 170, 0, TAU); c.fill();
    for(let i = 0; i < 120; i++){
      const a = rng.range(0, TAU), r = rng.range(0, 160);
      c.fillStyle = rng.pick(['#4b4030', '#55483a', '#3a3125']);
      c.fillRect(1100 + Math.cos(a) * r - 9, 960 + Math.sin(a) * r - 6, 18, 12);
    }
    // Flowers and grass tufts.
    for(let i = 0; i < 500; i++){
      const x = rng.range(0, W.w), y = rng.range(0, W.h);
      if(rng.next() < 0.3){ c.fillStyle = rng.pick(['#e8d27a', '#c86b8a', '#8fb7e8', '#f2efe0']); c.fillRect(x, y, 3, 3); }
      else { c.strokeStyle = '#2c4a2c'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 3, y - 7); c.moveTo(x, y); c.lineTo(x + 3, y - 6); c.stroke(); }
    }
    // The cave mouth into the deep.
    const C = HUB.cave;
    c.fillStyle = '#2a2a2e'; c.beginPath(); c.ellipse(C.x, C.y - 10, 150, 95, 0, 0, TAU); c.fill();
    c.fillStyle = '#3b3b40'; c.beginPath(); c.ellipse(C.x, C.y - 22, 120, 70, 0, Math.PI, TAU); c.fill();
    c.fillStyle = '#050608'; c.beginPath(); c.ellipse(C.x, C.y, 70, 48, 0, 0, TAU); c.fill();
    // The well.
    c.fillStyle = '#5a5650'; c.beginPath(); c.arc(1100, 960, 34, 0, TAU); c.fill();
    c.fillStyle = '#0e1a22'; c.beginPath(); c.arc(1100, 960, 22, 0, TAU); c.fill();
    c.strokeStyle = '#6b4a2a'; c.lineWidth = 5; c.beginPath(); c.moveTo(1066, 930); c.lineTo(1134, 930); c.stroke();
    // Houses: walls, roof with ridge, lit windows, door and sign.
    HUB.houses.forEach(function(H){
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(H.x + 10, H.y + 14, H.w, H.h);
      c.fillStyle = H.wall; c.fillRect(H.x, H.y + H.h * 0.45, H.w, H.h * 0.55);
      c.fillStyle = H.roof; c.fillRect(H.x - 12, H.y, H.w + 24, H.h * 0.5);
      c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(H.x - 12, H.y + H.h * 0.25, H.w + 24, H.h * 0.25);
      c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 2;
      for(let x = H.x - 4; x < H.x + H.w + 12; x += 18){ c.beginPath(); c.moveTo(x, H.y + 2); c.lineTo(x, H.y + H.h * 0.5 - 2); c.stroke(); }
      c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(H.x - 12, H.y + H.h * 0.24, H.w + 24, 4);
      [0.2, 0.8].forEach(function(f){ c.fillStyle = '#ffcf7a'; c.fillRect(H.x + H.w * f - 14, H.y + H.h * 0.6, 28, 22); c.fillStyle = '#6b4a2a'; c.fillRect(H.x + H.w * f - 1, H.y + H.h * 0.6, 2, 22); });
      c.fillStyle = '#2a1a10'; c.fillRect(H.door.x - 20, H.y + H.h - 44, 40, 44);
      c.fillStyle = '#ffcf7a'; c.beginPath(); c.arc(H.door.x + 12, H.y + H.h - 22, 3, 0, TAU); c.fill();
    });
    // Trees last, so the canopies sit over the grass.
    W.trees.forEach(function(T){
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(T.x + 8, T.y + 10, T.r, T.r * 0.7, 0, 0, TAU); c.fill();
      c.fillStyle = '#3b2a1c'; c.fillRect(T.x - 6, T.y - 4, 12, 18);
      const g = ['#1f4a2c', '#24522f', '#1b3f2a', '#2a5a34'][T.hue];
      c.fillStyle = g; c.beginPath(); c.arc(T.x, T.y - 12, T.r, 0, TAU); c.fill();
      c.fillStyle = 'rgba(160,220,140,.12)'; c.beginPath(); c.arc(T.x - T.r * 0.3, T.y - 12 - T.r * 0.3, T.r * 0.55, 0, TAU); c.fill();
    });
    R.worldCache = { world: W, canvas: canvas };
  },
  // Villagers at their doors, signs and the prompt for the nearest door.
  draw(c, R, G, t){
    const P = G.P, near = this.nearDoor(G);
    HUB.houses.forEach(function(H){
      const nx = H.door.x - 46, ny = H.door.y + 6;
      R.keeper(c, nx, ny, Math.atan2(P.y - ny, P.x - nx), Math.sin(t * 2 + nx) * 0.3, t, false, true, H.skin);
      c.font = '700 13px Cinzel, Georgia, serif'; c.textAlign = 'center';
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(H.door.x - 92, H.y - 30, 184, 22);
      c.fillStyle = near === H ? '#ffd98a' : '#d8c9a8'; c.fillText(H.name, H.door.x, H.y - 14);
    });
    c.font = '700 14px Cinzel, Georgia, serif'; c.textAlign = 'center'; c.fillStyle = '#ffb35c';
    c.fillText('THE EMBERDEEP', HUB.cave.x, HUB.cave.y - 120);
  },
  nearDoor(G){
    const P = G.P;
    if(!P) return null;
    let best = null, bd = 70;
    HUB.houses.forEach(function(H){ const d = dist(P.x, P.y, H.door.x, H.door.y); if(d < bd){ bd = d; best = H; } });
    return best;
  },
  prompt(G){
    const H = this.nearDoor(G);
    if(H) return 'F · ' + (H.id === 'elder' ? 'TALK TO ' + H.npc.toUpperCase() : 'ENTER ' + H.name);
    if(dist(G.P.x, G.P.y, HUB.cave.x, HUB.cave.y) < 260) return '◈ WALK INTO THE CAVE TO DESCEND';
    return null;
  },
  objective(){ return 'F AT A DOOR · THE CAVE LEADS DOWN'; },
  // Peace in the village; a few shadows in the eastern wood for practice.
  update(G, dt){
    const W = G.world, P = G.P;
    G.allPlayers().forEach(function(p){ if(!inRect(p.x, p.y, HUB.wood, 0)) p.oil = Math.min(p.maxOil, p.oil + 30 * dt); });
    W.spawnT -= dt;
    if(W.spawnT <= 0 && G.enemies.length < 5){
      W.spawnT = 7;
      const x = G.rng.range(HUB.wood.x + 80, HUB.wood.x + HUB.wood.w - 60), y = G.rng.range(HUB.wood.y + 60, HUB.wood.y + HUB.wood.h - 60);
      if(!inAnyObstacle(W.obstacles, x, y, 30) && dist(x, y, P.x, P.y) > 260) G.spawnEnemy(G.rng.next() < 0.7 ? 'shade' : 'gleam', x, y);
    }
    // Shadows do not leave the wood.
    G.enemies.forEach(function(e){ e.x = Math.max(e.x, HUB.wood.x - 40); });
    const f = !!G.keys.KeyF;
    if(f && !G._fHeld && G.state === 'playing'){
      const H = this.nearDoor(G);
      if(H) this.enter(G, H);
    }
    G._fHeld = f;
  },
  enter(G, H){
    SFX.click();
    if(H.id === 'elder'){
      if(G.talking()) return;
      const i = (G._elderI || 0) % ELDER_LINES.length;
      G._elderI = i + 1;
      G.talk(ELDER_LINES[i], { m: 'box', f: '◇', v: 120, who: 'W' });
      return;
    }
    G.bankXp();
    G.state = 'hubmenu';
    if(H.id === 'trainer') G.showTree();
    else if(H.id === 'lodge') G.showClassPicker();
    else this.openShop(G);
  },
  openShop(G){
    const wrap = document.getElementById('shopCards'), purse = Progress.purse();
    document.getElementById('shopPurse').textContent = '◆ ' + purse + ' EMBERS';
    wrap.innerHTML = '';
    GEAR_IDS.forEach(function(id){
      const D = GEAR[id], have = Progress.gearOf(id), T = D.tiers[have], card = document.createElement('button');
      card.type = 'button';
      card.className = 'card shop-card' + (T && purse >= T.price ? '' : ' locked');
      const tiers = D.tiers.map(function(x, i){ return i < have ? '◆' : '◇'; }).join(' ');
      card.innerHTML = '<div class="boon-icon">' + D.icon + '</div><h3>' + D.name + '</h3>' +
        '<div class="flav">' + tiers + (D.key ? ' · KEY ' + D.key : '') + '</div>' +
        '<div class="desc">' + (T ? T.desc : 'Mastered. Brannoc has nothing left to teach this.') + '</div>' +
        '<div class="price">' + (T ? (have ? 'UPGRADE · ' : 'BUY · ') + '◆ ' + T.price : 'MAX') + '</div>';
      card.addEventListener('click', function(){
        if(!T || Progress.purse() < T.price){ SFX.snuff(); return; }
        Progress.buyGear(id, T.price);
        SFX.upgrade();
        G.toast(D.name + (have ? ' · TIER ' + (have + 1) : ' FORGED'));
        Hub.openShop(G);
      });
      wrap.appendChild(card);
    });
    G.showScreen('screen-shop');
  }
};

// Gear in the keeper's hands: the bow fires bolts, bombs are lobbed shots
// that burst when the fuse runs out. Host-side, like every other attack.
const Gear = {
  act(G, p, inp, dt){
    p.bowCdT = Math.max(0, (p.bowCdT || 0) - dt);
    p.bombCdT = Math.max(0, (p.bombCdT || 0) - dt);
    const g = p.gear || {};
    if(inp.bow && g.bow > 0 && p.bowCdT <= 0){
      const T = GEAR.bow.tiers[g.bow - 1];
      p.bowCdT = T.cd;
      for(let i = 0; i < T.n; i++) G.playerShot(p, p.aim + (i - (T.n - 1) / 2) * 0.13, { speed: T.speed, r: 5, dmg: T.dmg * G.dmgMult(p), life: 1.2, color: '#e6f2b0', pierce: T.pierce });
      if(p === G.P) SFX.alt();
    }
    if(inp.bomb && g.bombs > 0 && p.bombCdT <= 0){
      const T = GEAR.bombs.tiers[g.bombs - 1], tx = inp.tx !== undefined ? inp.tx : p.x + Math.cos(p.aim) * 200, ty = inp.ty !== undefined ? inp.ty : p.y + Math.sin(p.aim) * 200;
      const d = Math.min(320, dist(p.x, p.y, tx, ty)), a = Math.atan2(ty - p.y, tx - p.x), fuse = 0.85;
      p.bombCdT = T.cd;
      G.shots.push({ kind: 'bomb', x: p.x, y: p.y, vx: Math.cos(a) * d / fuse, vy: Math.sin(a) * d / fuse, r: 9, life: fuse, color: '#ff8a3d',
        dmg: T.dmg * G.dmgMult(p), br: T.r, burn: T.burn, owner: p, dead: false, hit: [] });
      if(p === G.P) SFX.dash();
    }
  },
  tickBomb(G, s, dt){
    const W = G.world, nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
    if(!inAnyObstacle(W.obstacles, nx, ny, s.r)){ s.x = nx; s.y = ny; } else { s.vx *= -0.3; s.vy *= -0.3; }
    s.life -= dt;
    if(s.life > 0) return;
    s.dead = true;
    G.blast(s.owner, s.br, s.dmg, 420, { x: s.x, y: s.y });
    if(s.burn) G.enemies.forEach(function(e){ if(!e.dead && dist(s.x, s.y, e.x, e.y) < s.br + e.r) G.ignite(e, 12, 3, s.owner); });
    G.effect(s.x, s.y, '#ff8a3d', s.br * 1.2);
    G.burst(s.x, s.y, '#ffb35c', 1.6, 26, 6, 0.7);
    G.shake += 6;
    SFX.noiseHit({ f: 180, f2: 50, d: 0.45, v: 0.32, ft: 'lowpass' });
    if(G.coop && G.coop.isHost) G.coop.broadcastFx(s.x, s.y, '#ff8a3d', s.br * 1.2);
  }
};
