'use strict';

const BOON_SYMBOLS = {heart:'♡',swift:'↗',vessel:'♜',thin:'♧',fanned:'♨',broad:'✺',reach:'☼',deepfl:'♜',surgeP:'✹',ready:'◷',wind:'≋',thirst:'♧',greed:'◆',siphon:'◈',thorns:'✧',mend:'✚',crit:'✴',ward:'⬡'};

class Game {
  constructor(canvas, renderer){
    this.canvas = canvas;
    this.R = renderer || new Renderer(canvas);
    this.keys = {};
    this.mouse = { x: 0, y: 0 };
    this.best = 0;
    try{ this.best = parseInt(localStorage.getItem('emberdeep_best') || '0', 10) || 0; }catch(e){}
    this.state = 'title';
    this.coop = null; // the Coop session while a co-op run is active
    this.runSeed = (Date.now() >>> 0);
    this.floor = 0;
    this.world = null;
    this.P = null;
    this.enemies = [];
    this.shots = [];
    this.particles = [];
    this.effects = [];
    this.trails = [];
    this.hurtT = 0;
    this._trailClock = 0;
    this._flameOn = false;
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.t = 0;
    this.score = 0;
    this.embers = 0;
    this.last = 0;
    this.initInput();
    this.initButtons();
  }

  // Boon levels belong to the local keeper (each co-op keeper has their own).
  get upgLevels(){ return (this.P && this.P.upg) || {}; }

  stopInput(){
    this.keys = {}; this.mouse.down = false;
    if(this.P) this.P.flameOn = false;
    this._flameOn = false; SFX.flameOff();
  }
  pause(){
    if(this.state !== 'playing') return;
    this.state = 'pause';
    document.getElementById('pauseStats').textContent = 'FLOOR ' + this.floor + ' · SCORE ' + Math.round(this.score);
    this.showScreen('screen-pause');
  }
  resume(){ this.state = 'playing'; this.stopInput(); this.showScreen(null); }
  cameraOrigin(){
    const W = this.world, R = this.R;
    return {
      x: W.w <= R.w ? (W.w - R.w) / 2 : clamp(this.cam.x - R.w / 2, 0, W.w - R.w),
      y: W.h <= R.h ? (W.h - R.h) / 2 : clamp(this.cam.y - R.h / 2, 0, W.h - R.h)
    };
  }

  lightMult(pl){
    const P = pl || this.P;
    if(!P) return 1;
    const frac = clamp(P.oil / P.maxOil, 0, 1);
    return (0.25 + 0.75 * Math.pow(frac, 0.5)) * (P.snuffT > 0 ? 0.45 : 1);
  }

  burst(x, y, color, scale, count, size, life){
    scale = scale || 1;
    count = count || 10;
    size = size || 4;
    life = life || 0.6;
    count = Math.min(this.R.reducedMotion ? Math.ceil(count * 0.4) : count, 450 - this.particles.length);
    for(let i = 0; i < count; i++){
      const a = Math.random() * TAU;
      const sp = (0.6 + Math.random()) * 140 * scale;
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: life * (0.6 + Math.random() * 0.7),
        maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color: color || '#ffb347'
      });
    }
  }

  effect(x, y, color, radius){
    if(this.effects.length >= 80) this.effects.shift();
    this.effects.push({ kind: 'ring', x, y, color, r: radius, life: 0.45, maxLife: 0.45 });
  }

  floatText(x, y, text, color){
    if(this.effects.length >= 80) this.effects.shift();
    this.effects.push({ kind: 'text', x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  toast(text){
    const el = document.getElementById('toast');
    if(!el) return;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  initInput(){
    const kmap = {};
    ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','KeyP','Escape'].forEach(function(code){ kmap[code] = true; });
    window.addEventListener('keydown', (e) => {
      if(!kmap[e.code] || e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      if(e.code === 'KeyP' || e.code === 'Escape'){
        if(!e.repeat){
          if(this.state === 'playing') this.pause();
          else if(this.state === 'pause') this.resume();
        }
        e.preventDefault();
      }
      if(e.code === 'Space' && this.state === 'playing') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    this.canvas.addEventListener('mousedown', (e) => { if(e.button === 0) this.mouse.down = true; });
    window.addEventListener('mouseup', (e) => { if(e.button === 0) this.mouse.down = false; });
    // In co-op, a host clicking into another window must not freeze everyone.
    // Hidden tabs stop rendering anyway, so the host pauses there; guests just let go.
    window.addEventListener('blur', () => { this.stopInput(); if(!this.coop) this.pause(); });
    document.addEventListener('visibilitychange', () => {
      if(!document.hidden) return;
      this.stopInput();
      if(!this.isGuest()) this.pause();
    });
    this.canvas.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    window.addEventListener('resize', () => this.R.resize());
  }

  initButtons(){
    const $ = function(id){ return document.getElementById(id); };
    const game = this;
    $('btnStart').addEventListener('click', function(){ SFX.init(); SFX.start(); game.startRun(); });
    $('btnRetry').addEventListener('click', function(){ SFX.click(); game.startRun(); });
    $('btnOverTitle').addEventListener('click', function(){ SFX.click(); game.toTitle(); });
    $('btnEndless').addEventListener('click', function(){ SFX.click(); game.endless(); });
    $('btnVicTitle').addEventListener('click', function(){ SFX.click(); game.toTitle(); });
    $('btnResume').addEventListener('click', function(){ SFX.click(); game.resume(); });
    $('btnPauseRestart').addEventListener('click', function(){ SFX.click(); game.startRun(); });
    $('btnPauseTitle').addEventListener('click', function(){ SFX.click(); game.toTitle(); });
    $('btnMotion').addEventListener('click', function(){
      game.R.reducedMotion = !game.R.reducedMotion;
      game.R.applyMotion();
      try{ localStorage.setItem('emberdeep_motion', game.R.reducedMotion ? 'reduced' : 'full'); }catch(e){}
      if(game.state === 'playing') game.canvas.focus({preventScroll:true});
    });
    this._hudEl = $('hud');
  }

  showScreen(name){
    document.body.classList.toggle('in-game', name === null);
    const ids = ['screen-title','screen-upgrade','screen-over','screen-victory','screen-pause'];
    for(let i = 0; i < ids.length; i++){
      document.getElementById(ids[i]).classList.toggle('hidden', ids[i] !== name);
    }
    if(name !== null) this.stopInput();
    if(this._hudEl){
      this._hudEl.classList.toggle('hidden', name !== null);
    }
    if(name === null) this.canvas.focus({preventScroll:true});
    else {
      const first = document.getElementById(name).querySelector('button:not([disabled])');
      if(first) first.focus({preventScroll:true});
    }
  }

  startRun(){
    if(this.isGuest()) return; // the host drives co-op runs
    this.stopInput(); this.P = null; this.t = 0; this.shake = 0;
    this.floor = 0;
    this.score = 0;
    this.embers = 0;
    this.runSeed = this.coop ? this.coop.onRunStart() : (Date.now() >>> 0);
    this.nextFloor();
  }

  makePlayer(){
    const W = this.world;
    const base = {
      x: W.spawn.x, y: W.spawn.y,
      hp: CFG.player.hp, maxHp: CFG.player.hp,
      oil: CFG.player.oil, maxOil: CFG.player.oil,
      speed: CFG.player.speed,
      lightR: CFG.player.lightR,
      burn: CFG.player.burn,
      flame: { dps: CFG.player.flame.dps, range: CFG.player.flame.range, half: CFG.player.flame.half, cost: CFG.player.flame.cost, kb: CFG.player.flame.kb, heal: CFG.player.flame.heal, crit: CFG.player.flame.crit, critMult: CFG.player.flame.critMult },
      surge: { cd: CFG.player.surge.cd, dmg: CFG.player.surge.dmg, r: CFG.player.surge.r, kb: CFG.player.surge.kb },
      dash: { cd: CFG.player.dash.cd, dur: CFG.player.dash.dur, speed: CFG.player.dash.speed },
      invuln: CFG.player.invuln
    };
    const P = {};
    for(const k in base){
      if(base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) P[k] = Object.assign({}, base[k]);
      else P[k] = base[k];
    }
    P.greed = 1; P.lifesteal = 0; P.oilOnKill = 0; P.thorns = 0; P.ward = 0;
    P.aim = 0;
    P.flameOn = false;
    P.surgeT = 0;
    P.surgeCdT = 0;
    P.dashT = 0;
    P.dashCdT = 0;
    P.invulnT = 0;
    P.dashDir = { x: 1, y: 0 };
    P.fuelFxT = 0;
    P.tp = 0; // bumped on every teleport (floor start, revive) so co-op guests can snap
    P.alive = true;
    P.upg = {};   // boon levels
    P.buffs = {}; // power-up kind -> seconds left
    return P;
  }

  // ---- CO-OP ----
  isGuest(){ return !!(this.coop && !this.coop.isHost); }
  coopMates(){ return this.coop ? Array.from(this.coop.mates.values()) : []; }
  allPlayers(){
    const mates = this.coopMates();
    return this.P ? [this.P].concat(mates) : mates;
  }
  nearestPlayer(x, y){
    const ps = this.allPlayers();
    let best = null, bd = Infinity;
    for(let i = 0; i < ps.length; i++){
      const p = ps[i];
      if(p.hp <= 0) continue;
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if(d < bd){ bd = d; best = p; }
    }
    return best || this.P;
  }
  // Solo: the run ends. Co-op: the keeper falls and watches until the team slays
  // the next boss; the run ends once every keeper has fallen.
  keeperDown(p){
    p.hp = 0;
    if(!this.coop){ this.gameOver(); return; }
    p.alive = false; p.flameOn = false; p.buffs = {};
    if(p === this.P) this.stopInput();
    this.burst(p.x, p.y, '#ff4d6d', 1.4, 18, 5, 0.8);
    this.effect(p.x, p.y, '#ff4d6d', 90);
    this.coop.say((p.name || 'Keeper') + ' has fallen');
    this.checkTeamWipe();
  }
  checkTeamWipe(){
    if(this.state === 'playing' && !this.allPlayers().some(function(k){ return k.alive !== false; })) this.gameOver();
  }
  // A slain boss brings fallen keepers back next to `at` — fresh, without their boons.
  reviveFallen(at){
    const fallen = this.allPlayers().filter(function(p){ return p.alive === false; });
    fallen.forEach((p, i) => {
      const fresh = this.makePlayer();
      ['id', 'name', 'color', 'tp'].forEach(function(k){ fresh[k] = p[k]; });
      Object.assign(p, fresh);
      p.walk = 0; p.snuffT = 0; p.invulnT = 2;
      const a = i / fallen.length * TAU;
      p.x = at.x + Math.cos(a) * 45; p.y = at.y + Math.sin(a) * 45;
      this.constrainKeeper(p);
      p.tp++;
      this.burst(p.x, p.y, '#ffd98a', 1.4, 20, 5, 0.9);
      this.effect(p.x, p.y, '#ffd98a', 110);
    });
    if(fallen.length){
      this.coop.say('THE FALLEN RETURN');
      this.coop.onStatsChanged();
    }
  }
  // Fallen keepers watch a living teammate.
  focusKeeper(){
    const P = this.P;
    if(P.alive !== false) return P;
    return this.coopMates().find(function(m){ return m.alive !== false; }) || P;
  }
  teamSize(){ return this.allPlayers().length || 1; }
  // Puts a keeper on the floor spawn; co-op keepers fan out around it.
  placeKeeper(p, i, n){
    const W = this.world, a = i / Math.max(1, n) * TAU;
    p.x = W.spawn.x + (i ? Math.cos(a) * 34 : 0);
    p.y = W.spawn.y + (i ? Math.sin(a) * 34 : 0);
    this.constrainKeeper(p);
    p.tp = (p.tp || 0) + 1;
  }
  constrainKeeper(p){
    const W = this.world;
    p.x = clamp(p.x, 18, W.w - 18);
    p.y = clamp(p.y, 18, W.h - 18);
    for(let i = 0; i < W.obstacles.length; i++){
      const hit = resolveCircleRect(p.x, p.y, 13, W.obstacles[i]);
      if(hit){ p.x += hit.dx; p.y += hit.dy; }
    }
  }
  // Host side: guests move their own keeper, the host eases toward the reported
  // spot and runs everything that deals damage or spends oil.
  updateMates(dt){
    const mates = this.coopMates();
    for(let i = 0; i < mates.length && this.state === 'playing'; i++){
      const m = mates[i];
      if(m.alive === false) continue;
      const inp = this.coop.inputFor(m);
      if(inp.x !== undefined){
        const k = 1 - Math.exp(-25 * dt);
        m.x += (inp.x - m.x) * k;
        m.y += (inp.y - m.y) * k;
      }
      if(inp.mx || inp.my) m.walk = (m.walk || 0) + dt * 16;
      m.dashT = inp.dashT;
      this.actKeeper(m, inp, dt);
    }
  }
  // Guests only simulate their own movement; the world comes from host snapshots.
  updateGuest(dt){
    const P = this.P, coop = this.coop;
    if(!P || !this.world) return;
    this.decayFeedback(dt);
    this.followCamera(dt);
    const inp = this.localInput();
    P.aim = inp.aim;
    const live = coop.hostState === 'playing' && P.alive !== false;
    if(live) this.moveKeeper(P, inp, dt);
    P.flameOn = live && inp.fire && P.oil > 0;
    this.flameSound(P.flameOn);
    if(P.flameOn) this.emitFlame(P, dt);
    coop.smooth(dt);
    coop.refreshBanner();
    this.fuelStatus = this.fuelPrompt(P);
    this.updateFx(dt);
  }
  applyUpgrade(u, p){
    p = p || this.P;
    p.upg[u.id] = (p.upg[u.id] || 0) + 1;
    u.apply(p);
    if(p === this.P) this.toast(u.name.toUpperCase());
  }
  nextFloor(){
    const guest = this.isGuest();
    this.floor++;
    this.rng = new Rng(((this.runSeed || 0) + this.floor * 7919) >>> 0);
    this.world = generateFloor(this.floor, this.rng);
    const W = this.world;
    this.enemies = [];
    this.shots = [];
    this.particles = [];
    this.effects = []; this.trails = []; this.hurtT = 0;
    this._trailClock = 0;
    this.P = this.P || this.makePlayer();
    if(this.coop && !guest) this.coop.syncMates();
    const keepers = this.allPlayers();
    keepers.forEach((p, i) => {
      this.placeKeeper(p, i, keepers.length);
      p.surgeT = p.surgeCdT = p.dashT = p.dashCdT = p.invulnT = 0;
      p.snuffT = 0;
      p.walk = 0;
      p.buffs = {};
      if(p.alive !== false) p.oil = Math.min(p.maxOil, p.oil + 30);
    });
    this.stopInput();
    // Every extra keeper brings more shadows.
    const scale = teamScale(keepers.length);
    W.quota = Math.round(W.quota * scale.count);
    W.initial = Math.round(W.initial * scale.count);
    W.spawnsLeft = W.boss ? 0 : W.quota - W.initial;
    W.spawnT = W.spawnInterval;
    if(!guest) this.spawnFloorEnemies();
    this.cam = { x: this.P.x, y: this.P.y };
    const origin = this.cameraOrigin();
    this.mouse.x = this.P.x - origin.x + 90;
    this.mouse.y = this.P.y - origin.y;
    this.state = 'playing';
    this.showScreen(null);
    SFX.floor();
    this.toast('FLOOR ' + W.num);
    if(this.coop && !guest) this.coop.onFloor();
  }
  spawnFloorEnemies(){
    const W = this.world, P = this.P;
    for(let i = 0; i < W.initial; i++){
      const s = placeMobSpot(W, new Rng(this.floor * 7919 + i), P.x, P.y);
      this.spawnEnemy(pickMobType(this.floor, new Rng(this.floor * 31 + i)), s.x, s.y);
    }
    if(W.boss){
      const spot = freeSpot(W.w, W.h, W.obstacles, this.rng, 400, P.x, P.y, ENEMY_DEFS[W.boss].r + 5);
      this.enemies.push(new Enemy(this, W.boss, spot.x, spot.y));
      SFX.bossRoar();
    }
  }

  spawnEnemy(type, x, y){
    const e = new Enemy(this, type, x, y);
    this.enemies.push(e);
    this.spawnFx(e);
    return e;
  }
  spawnFx(e){
    this.burst(e.x, e.y, '#2a1430', 1, 12, 5, 0.5);
    this.effect(e.x, e.y, e.d.eye, e.r * 2.5);
  }

  bossSummon(e, n){
    SFX.snuff();
    this.burst(e.x, e.y, e.d.eye, 1.4, 20, 6, 0.7);
    for(let i = 0; i < n; i++){
      const s = placeMobSpot(this.world, this.rng, e.x, e.y);
      this.spawnEnemy('shade', s.x, s.y);
    }
  }

  bossNova(e, n){
    SFX.noiseHit({ f: 200, f2: 60, d: 0.5, v: 0.3, ft: 'lowpass' });
    for(let i = 0; i < n; i++){
      const a = i / n * TAU;
      const ps = 190;
      this.shots.push(makeOrb(e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, Math.cos(a) * ps, Math.sin(a) * ps, e.dmg * 0.8, e.d.eye));
    }
  }

  snuffPlayer(amount, oilDrain, src, target){
    const P = target || this.P;
    if(!P || P.hp <= 0) return;
    P.snuffT = Math.max(P.snuffT || 0, amount);
    P.oil = Math.max(0, P.oil - oilDrain);
    SFX.snuff();
    this.burst(P.x, P.y, '#2a1430', 1, 16, 5, 0.7);
    if(P === this.P) this.shake += 2;
  }

  killEnemy(e, killer){
    if(e.dead) return;
    e.dead = true;
    const K = killer || this.P;
    this.score += e.d.pts;
    this.embers += Math.round(e.d.ember * ((K && K.greed) || 1));
    this.addPickup({ type: 'oil', x: e.x, y: e.y, val: e.isBoss ? 60 : 14, t: this.t });
    const drops = e.isBoss ? 2 : (Math.random() < 0.06 ? 1 : 0);
    for(let i = 0; i < drops; i++){
      const a = Math.random() * TAU;
      this.addPickup({ type: 'power', kind: pick(POWER_KINDS), x: e.x + Math.cos(a) * 40, y: e.y + Math.sin(a) * 40, val: 0, t: this.t });
    }
    if(K){
      K.hp = Math.min(K.maxHp, K.hp + (K.lifesteal || 0));
      K.oil = Math.min(K.maxOil, K.oil + (K.oilOnKill || 0));
    }
    this.killFx(e);
    if(e.d.shards){
      const n = e.d.shards;
      for(let i = 0; i < n; i++){
        const a = i / n * TAU + Math.random() * 0.4;
        const sp = 140 + Math.random() * 60;
        this.shots.push(makeShard(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, e.dmg * 0.6));
      }
    }
    if(e.isBoss && this.coop) this.reviveFallen(K && K.alive !== false ? K : e);
  }
  addPickup(pk){
    pk.id = this.world.nextPickupId++;
    this.world.pickups.push(pk);
    return pk;
  }
  // Death feedback; co-op guests replay it when an enemy vanishes from a snapshot.
  killFx(e){
    SFX.kill();
    this.burst(e.x, e.y, '#ff8a3d', e.isBoss ? 2 : 1, e.isBoss ? 34 : 14, e.isBoss ? 8 : 4, 0.8);
    this.effect(e.x, e.y, e.d.eye, e.isBoss ? 150 : 42);
    this.floatText(e.x, e.y, '+' + e.d.pts, '#efd29a');
    this.shake += e.isBoss ? 4 : 1;
    if(e.isBoss){
      SFX.bossRoar();
      this.shake += 6;
    }
  }

  damagePlayer(amount, src, target){
    const P = target || this.P, local = P === this.P;
    if(!P || P.hp <= 0 || P.invulnT > 0 || P.dashT > 0) return;
    if(P.buffs.aegis > 0){
      this.burst(P.x, P.y, POWERUPS.aegis.color, 0.8, 6, 3, 0.35);
      P.invulnT = 0.25;
      return;
    }
    if(P.ward > 0 && Math.random() < P.ward){
      this.burst(P.x, P.y, '#ffd98a', 1, 8, 4, 0.4);
      if(local) SFX.hitE();
      P.invulnT = P.invuln;
      return;
    }
    P.hp -= amount;
    P.invulnT = Math.max(P.invulnT, P.invuln);
    if(src && src.kb){
      const dx = P.x - src.x, dy = P.y - src.y;
      const d = Math.hypot(dx, dy) || 1;
      P.x += dx / d * 6;
      P.y += dy / d * 6;
    }
    if(local){
      this.hurtT = 0.6;
      SFX.hurt();
      this.shake += 2.5;
    }
    this.burst(P.x, P.y, '#ff4d6d', 1, 10, 4, 0.5);
    if(P.thorns > 0 && src && !src.dead && src.hp !== undefined){
      src.hp -= P.thorns;
      if(src.hp <= 0) this.killEnemy(src, P);
    }
    if(P.hp <= 0) this.keeperDown(P);
  }

  fillStats(id, rows){
    const s = document.getElementById(id);
    s.innerHTML = '';
    for(let i = 0; i < rows.length; i++){
      const d = document.createElement('div');
      const l = document.createElement('span');
      l.textContent = rows[i][0];
      const v = document.createElement('b');
      v.textContent = rows[i][1];
      d.appendChild(l);
      d.appendChild(v);
      s.appendChild(d);
    }
    return s;
  }

  gameOver(){
    this.state = 'over';
    SFX.over();
    const s = this.fillStats('overStats', [['FLOOR', this.floor], ['SCORE', Math.round(this.score)], ['EMBERS', Math.round(this.embers)]]);
    if(this.score > this.best){
      this.best = Math.round(this.score);
      try{ localStorage.setItem('emberdeep_best', String(this.best)); }catch(e){}
      const nb = document.createElement('div');
      nb.className = 'newbest';
      nb.textContent = 'NEW BEST';
      s.appendChild(nb);
    }
    this.showScreen('screen-over');
    if(this.coop && this.coop.isHost) this.coop.onEnd('over');
  }

  victory(){
    this.state = 'victory';
    SFX.win();
    if(this.score > this.best){
      this.best = Math.round(this.score);
      try{ localStorage.setItem('emberdeep_best', String(this.best)); }catch(e){}
    }
    this.fillStats('vicStats', [['SCORE', Math.round(this.score)], ['EMBERS', Math.round(this.embers)]]);
    this.showScreen('screen-victory');
    if(this.coop && this.coop.isHost) this.coop.onEnd('victory');
  }

  toTitle(){
    if(this.coop) this.coop.onTitle();
    this.state = 'title';
    this.world = null;
    this.P = null;
    this.enemies = [];
    this.shots = [];
    this.particles = [];
    this.updateBestLine();
    this.showScreen('screen-title');
  }

  updateBestLine(){
    const el = document.getElementById('bestLine');
    if(el) el.textContent = this.best > 0 ? 'BEST  ' + this.best : '';
  }

  // Three random boons the keeper has not maxed yet.
  rollBoons(p){
    const pool = UPGRADES.filter(function(u){ return (p.upg[u.id] || 0) < u.max; });
    const picks = [];
    while(picks.length < 3 && pool.length) picks.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
    return picks;
  }
  // Boon choice. Solo rolls here; in co-op the host rolls one hand per keeper
  // (`ids`) and every keeper picks their own.
  showUpgrade(ids){
    const game = this;
    this.state = 'upgrade';
    this.boonChosen = false;
    const picks = ids ? ids.map(function(id){ return UPGRADES.find(function(u){ return u.id === id; }); }).filter(Boolean)
      : this.rollBoons(this.P);
    if(!picks.length && !this.coop){ this.nextFloor(); return; }
    const wrap = document.getElementById('upgradeCards');
    wrap.innerHTML = '';
    this.setBoonNote(!this.coop ? 'The stair hums. Take one gift and descend.'
      : picks.length ? 'Your boon is yours alone.' : 'Your teammates are choosing their boons…');
    for(let i = 0; i < picks.length; i++){
      (function(u){
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card';
        card.dataset.id = u.id;
        const icon = document.createElement('div');
        icon.className = 'boon-icon'; icon.textContent = BOON_SYMBOLS[u.id] || '✧';
        icon.setAttribute('aria-hidden', 'true'); card.appendChild(icon);
        const number = document.createElement('span');
        number.className = 'boon-index'; number.textContent = '0' + (i + 1);
        card.appendChild(number);
        const h3 = document.createElement('h3');
        h3.textContent = u.name;
        card.appendChild(h3);
        const flav = document.createElement('div');
        flav.className = 'flav';
        flav.textContent = u.flavor;
        card.appendChild(flav);
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = u.desc;
        card.appendChild(desc);
        const pips = document.createElement('div');
        pips.className = 'pips';
        const cur = game.upgLevels[u.id] || 0;
        for(let p = 0; p < u.max; p++){
          const dot = document.createElement('i');
          if(p < cur) dot.classList.add('on');
          pips.appendChild(dot);
        }
        card.appendChild(pips);
        card.addEventListener('click', function(){ game.chooseBoon(u, card); });
        wrap.appendChild(card);
      })(picks[i]);
    }
    this.showScreen('screen-upgrade');
  }
  chooseBoon(u, card){
    if(this.state !== 'upgrade' || this.boonChosen) return;
    this.boonChosen = true;
    SFX.upgrade();
    if(!this.coop){
      this.applyUpgrade(u);
      this.nextFloor();
      return;
    }
    card.classList.add('chosen');
    document.querySelectorAll('#upgradeCards .card').forEach(function(c){ c.disabled = true; });
    this.setBoonNote('Waiting for the other keepers…');
    this.coop.pickBoon(u.id);
  }
  setBoonNote(text){
    const el = document.getElementById('upgradeSub');
    if(el.textContent !== text) el.textContent = text;
  }

  endless(){
    if(!this.isGuest()) this.nextFloor();
  }

  stepGate(){
    const W = this.world;
    if(!W.gateOpen){
      W.gateOpen = true;
      SFX.gateOpen();
      this.toast('THE STAIR OPENS');
      this.burst(W.gate.x, W.gate.y, '#ffd98a', 1.6, 26, 6, 1);
      this.effect(W.gate.x, W.gate.y, '#ffd98a', 140);
      return;
    }
    if(this.floor === CFG.floorMax) this.victory();
    else if(this.coop) this.coop.beginBoonRound();
    else this.showUpgrade();
  }

  wakeFuelVent(vent, dropFuel){
    vent.active = true;
    vent.fuel = vent.maxFuel;
    vent.refillT = 0;
    vent.spurtT = 0.05;
    this.effect(vent.x, vent.y, '#83e3c2', 78);
    this.burst(vent.x, vent.y, '#83e3c2', 0.65, 14, 3, 0.7);
    if(dropFuel){
      const looseFuel = this.world.pickups.filter(function(p){ return p.source === 'vent' && !p.taken; }).length;
      if(looseFuel < 6){
        const a = Math.random() * TAU;
        this.addPickup({
          type: 'oil', source: 'vent', val: 12,
          x: vent.x + Math.cos(a) * 34, y: vent.y + Math.sin(a) * 34,
          t: this.t
        });
      }
    }
  }

  updateFuelVents(dt){
    const W = this.world;
    this.fuelStatus = null;
    if(!W.vents.length) return;

    W.ventCycleT -= dt;
    if(W.ventCycleT <= 0){
      const sleeping = W.vents.filter(function(v){ return !v.active; });
      const target = sleeping.length ? pick(sleeping) : pick(W.vents);
      this.wakeFuelVent(target, true);
      W.ventCycleT = rand(8, 15);
    }

    const keepers = this.allPlayers().filter(function(p){ return p.hp > 0; });
    let hasActive = false;
    for(let i = 0; i < W.vents.length; i++){
      const v = W.vents[i];
      if(v.active && v.fuel > 0){
        hasActive = true;
        v.spurtT -= dt;
        if(v.spurtT <= 0){
          v.spurtT = rand(0.45, 1.15);
          const n = this.R.reducedMotion ? 1 : 3;
          for(let p = 0; p < n && this.particles.length < 450; p++){
            const life = rand(0.45, 0.8);
            this.particles.push({
              x: v.x + rand(-10, 10), y: v.y - 8,
              vx: rand(-25, 25), vy: rand(-115, -70),
              life: life, maxLife: life, size: rand(2, 4), color: '#83e3c2'
            });
          }
        }
        for(let k = 0; k < keepers.length; k++){
          const P = keepers[k];
          if(dist(P.x, P.y, v.x, v.y) >= 62) continue;
          const amount = Math.min(Math.max(0, P.maxOil - P.oil), v.fuel, 34 * dt);
          if(amount <= 0) continue;
          P.oil += amount;
          v.fuel -= amount;
          P.fuelFxT = (P.fuelFxT || 0) - dt;
          if(P.fuelFxT <= 0){
            P.fuelFxT = this.R.reducedMotion ? 0.18 : 0.07;
            const life = 0.35;
            this.particles.push({ x:v.x, y:v.y, vx:(P.x-v.x)*2.2, vy:(P.y-v.y)*2.2,
              life:life, maxLife:life, size:3, color:'#9cf3d2' });
          }
        }
        if(v.fuel <= 0){
          v.fuel = 0; v.active = false; v.refillT = rand(9, 17);
          this.effect(v.x, v.y, '#476f69', 48);
        }
      } else {
        v.active = false;
        v.refillT = Math.max(0, (v.refillT !== undefined ? v.refillT : rand(8, 15)) - dt);
        if(v.refillT <= 0) this.wakeFuelVent(v, true);
      }
    }
    if(!hasActive){
      const next = W.vents.reduce(function(a, b){ return a.refillT < b.refillT ? a : b; });
      this.wakeFuelVent(next, false);
    }
    this.fuelStatus = this.fuelPrompt(this.P);
  }
  // HUD hint for the vent next to the local keeper.
  fuelPrompt(P){
    let msg = null;
    this.world.vents.forEach(function(v){
      const d = dist(P.x, P.y, v.x, v.y);
      if(v.active && v.fuel > 0){
        if(d < 62) msg = '◈ REFILLING · ' + Math.ceil(v.fuel) + ' FUEL LEFT';
        else if(d < 115) msg = '◈ ACTIVE FUEL VENT · MOVE CLOSER';
      } else if(d < 82){
        msg = '◈ VENT RECHARGING · ' + Math.ceil(v.refillT || 0) + 's';
      }
    });
    return msg;
  }

  localInput(){
    const k = this.keys, P = this.P, origin = this.cameraOrigin();
    return {
      mx: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      my: (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0),
      aim: Math.atan2(this.mouse.y + origin.y - P.y, this.mouse.x + origin.x - P.x),
      fire: !!this.mouse.down,
      surge: !!k.Space,
      dash: !!(k.ShiftLeft || k.ShiftRight)
    };
  }
  decayFeedback(dt){
    this.shake = Math.max(0, this.shake - 14 * dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
  }
  followCamera(dt){
    const P = this.focusKeeper(), follow = this.R.reducedMotion ? 1 : 1 - Math.exp(-12 * dt);
    this.cam.x = lerp(this.cam.x, P.x, follow);
    this.cam.y = lerp(this.cam.y, P.y, follow);
  }
  flameSound(on){
    if(on && !this._flameOn) SFX.flameOn();
    else if(!on && this._flameOn) SFX.flameOff();
    this._flameOn = on;
  }

  // Movement and dash. The host runs it for its own keeper, guests for theirs.
  moveKeeper(p, inp, dt){
    const local = p === this.P;
    const mvl = Math.hypot(inp.mx, inp.my);
    p.aim = inp.aim;
    if(mvl) p.walk = (p.walk || 0) + dt * 16;
    if(p.dashT > 0 && local && !this.R.reducedMotion){
      this._trailClock += dt;
      if(this._trailClock >= 0.022){
        this._trailClock %= 0.022;
        this.trails.push({ x:p.x, y:p.y, aim:p.aim, life:0.28, maxLife:0.28 });
      }
    }
    if(p.dashT > 0){
      p.x += p.dashDir.x * p.dash.speed * dt;
      p.y += p.dashDir.y * p.dash.speed * dt;
    } else if(mvl){
      const speed = p.speed * (p.buffs.haste > 0 ? 1.4 : 1);
      p.x += (inp.mx / mvl) * speed * dt;
      p.y += (inp.my / mvl) * speed * dt;
    }
    this.constrainKeeper(p);

    p.dashT = Math.max(0, p.dashT - dt);
    p.dashCdT = Math.max(0, p.dashCdT - dt);
    if(inp.dash && p.dashCdT <= 0){
      p.dashCdT = p.dash.cd;
      p.dashT = p.dash.dur;
      p.invulnT = Math.max(p.invulnT, p.dash.dur);
      p.dashDir = { x: mvl > 0 ? inp.mx / mvl : Math.cos(p.aim), y: mvl > 0 ? inp.my / mvl : Math.sin(p.aim) };
      if(local) SFX.dash();
      this.burst(p.x, p.y, '#ffd98a', 0.6, 10, 3, 0.4);
    }
  }

  // Timers, surge, flame, oil and darkness. Host only: this is where damage happens.
  actKeeper(p, inp, dt){
    const local = p === this.P;
    p.aim = inp.aim;
    p.surgeT = Math.max(0, p.surgeT - dt);
    p.surgeCdT = Math.max(0, p.surgeCdT - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.snuffT = Math.max(0, (p.snuffT || 0) - dt);
    for(const k in p.buffs){
      p.buffs[k] -= dt;
      if(p.buffs[k] <= 0) delete p.buffs[k];
    }
    const freeOil = p.buffs.well > 0;
    if(inp.surge && p.surgeCdT <= 0 && p.oil > 0) this.surge(p);

    if(!freeOil) p.oil = Math.max(0, p.oil - CFG.drain * dt);
    p.flameOn = !!inp.fire && p.oil > 0;
    if(p.flameOn){
      if(!freeOil) p.oil = Math.max(0, p.oil - p.flame.cost * dt);
      if(p.flame.heal > 0) p.hp = Math.min(p.maxHp, p.hp + p.flame.heal * dt);
    }
    if(local) this.flameSound(p.flameOn);
    if(p.flameOn && p.oil > 0){
      this.emitFlame(p, dt);
      this.burnCone(p, dt);
    }

    if(p.oil <= 0){
      p.oil = 0;
      p.hp -= CFG.darkDps * dt;
      if(p.hp <= 0) this.keeperDown(p);
    }
  }
  surge(p){
    p.surgeCdT = p.surge.cd;
    p.surgeT = 0.6;
    if(!(p.buffs.well > 0)) p.oil = Math.max(0, p.oil - 5);
    if(p === this.P){
      SFX.surge();
      this.shake += 3;
    }
    this.burst(p.x, p.y, '#ffd98a', 1.5, 24, 6, 0.9);
    this.blast(p, p.surge.r, p.surge.dmg, p.surge.kb);
  }
  // Damages and shoves every enemy in range and snuffs enemy shots.
  blast(p, r, dmg, kb){
    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(e.dead) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if(d < r + e.r){
        e.hp -= dmg;
        e.flash = 0.3;
        const dx = e.x - p.x, dy = e.y - p.y;
        const dd = Math.hypot(dx, dy) || 1;
        e.kb.x += (dx / dd) * kb;
        e.kb.y += (dy / dd) * kb;
        if(e.hp <= 0) this.killEnemy(e, p);
      }
    }
    for(let i = 0; i < this.shots.length; i++){
      const s = this.shots[i];
      if(s.kind !== 'orb' && s.kind !== 'shard') continue;
      if(dist(p.x, p.y, s.x, s.y) < r) s.dead = true;
    }
  }
  grantPower(p, kind){
    const def = POWERUPS[kind];
    if(kind === 'nova'){
      this.blast(p, 320, 90 + 12 * this.floor, 520);
      this.effect(p.x, p.y, def.color, 320);
      if(p === this.P) this.shake += 5;
    } else {
      p.buffs[kind] = def.dur;
      if(kind === 'well') p.oil = Math.min(p.maxOil, p.oil + 30);
    }
    if(p === this.P){
      SFX.power();
      this.toast(def.name);
    }
  }
  emitFlame(p, dt){
    p.emberClock = (p.emberClock || 0) + dt;
    const interval = this.R.reducedMotion ? 0.07 : 0.018;
    while(p.emberClock >= interval){
      p.emberClock -= interval;
      if(this.particles.length >= 450) continue;
      const angle = p.aim + rand(-p.flame.half, p.flame.half) * 0.85;
      const sp = rand(260, 420), life = rand(0.22, 0.45);
      this.particles.push({ x:p.x+Math.cos(p.aim)*17, y:p.y+Math.sin(p.aim)*17,
        vx:Math.cos(angle)*sp, vy:Math.sin(angle)*sp, life, maxLife:life,
        size:rand(1.5,3.5), color:pick(['#ffcb70','#e8943e','#ffe7a6']) });
    }
  }
  burnCone(p, dt){
    const dmg = p.flame.dps * dt * (p.buffs.blaze > 0 ? 2 : 1);
    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if(d > p.flame.range + e.r) continue;
      const ea = Math.atan2(dy, dx);
      if(Math.abs(angleDiff(ea, p.aim)) > p.flame.half + e.r / (d || 1)) continue;
      const crit = Math.random() < (p.flame.crit || 0);
      e.hp -= dmg * (crit ? p.flame.critMult : 1);
      e.flash = Math.max(e.flash, 0.2);
      e.kb.x += dx / (d || 1) * p.flame.kb * dt;
      e.kb.y += dy / (d || 1) * p.flame.kb * dt;
      if(crit){
        if(p === this.P) SFX.hitE();
        this.burst(e.x, e.y, '#ffd98a', 0.8, 6, 3, 0.4);
      }
      if(e.hp <= 0) this.killEnemy(e, p);
    }
  }

  update(dt){
    if(this.state !== 'playing') return;
    this.t += dt;
    if(this.isGuest()){ this.updateGuest(dt); return; }
    const W = this.world, P = this.P;
    if(!W || !P || P.hp <= 0 && !this.coop) return;

    this.decayFeedback(dt);
    this.followCamera(dt);
    const inp = this.localInput(), alive = P.alive !== false;
    if(alive) this.moveKeeper(P, inp, dt);
    this.updateFuelVents(dt);
    if(alive) this.actKeeper(P, inp, dt);
    if(this.state !== 'playing') return;
    if(this.coop){
      this.updateMates(dt);
      if(this.state !== 'playing') return;
      this.coop.refreshBanner();
    }

    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(!e.dead){
        e.update(dt, this);
        if(this.state !== 'playing') return;
      }
    }
    this.enemies = this.enemies.filter(function(e){ return !e.dead; });

    W.spawnT -= dt;
    if(W.spawnT <= 0 && W.spawnsLeft > 0){
      W.spawnT = W.spawnInterval; W.spawnsLeft--;
      const near = this.focusKeeper();
      const spot = placeMobSpot(W, this.rng, near.x, near.y);
      this.spawnEnemy(pickMobType(this.floor, this.rng), spot.x, spot.y);
    }
    if(!W.gateOpen && W.spawnsLeft === 0 && this.enemies.length === 0) this.stepGate();
    const keepers = this.allPlayers();
    if(W.gateOpen){
      for(let i = 0; i < keepers.length; i++){
        const k = keepers[i];
        if(k.hp > 0 && dist(k.x, k.y, W.gate.x, W.gate.y) < 55){ this.stepGate(); return; }
      }
    }

    const magnets = keepers.filter(function(k){ return k.hp > 0 && k.buffs.magnet > 0; });
    for(let i = 0; i < W.pickups.length; i++){
      const pk = W.pickups[i];
      for(let mi = 0; mi < magnets.length; mi++){
        const m = magnets[mi], d = dist(m.x, m.y, pk.x, pk.y);
        if(d > 280 || d < 1) continue;
        const step = Math.min(d, 480 * dt);
        pk.x += (m.x - pk.x) / d * step;
        pk.y += (m.y - pk.y) / d * step;
        break;
      }
      for(let pi = 0; pi < keepers.length; pi++){
        const taker = keepers[pi], local = taker === P;
        if(taker.hp <= 0 || dist(taker.x, taker.y, pk.x, pk.y) >= 26) continue;
        pk.taken = true;
        if(pk.type === 'ember'){
          this.embers += pk.val * (taker.greed || 1);
          if(local) SFX.pick();
        } else if(pk.type === 'oil'){
          taker.oil = Math.min(taker.maxOil, taker.oil + pk.val);
          if(local) SFX.oilPick();
        } else if(pk.type === 'power'){
          this.grantPower(taker, pk.kind);
        } else {
          taker.hp = Math.min(taker.maxHp, taker.hp + pk.val);
          if(local) SFX.wickPick();
        }
        this.pickupFx(pk);
        break;
      }
    }
    W.pickups = W.pickups.filter(pk => !pk.taken);

    for(let i = 0; i < this.shots.length; i++){
      const s = this.shots[i];
      if(s.dead) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      s.dead = inAnyObstacle(W.obstacles, s.x, s.y, s.r) || s.life <= 0 || s.x < 0 || s.x > W.w || s.y < 0 || s.y > W.h;
      if(!s.dead && (s.kind === 'orb' || s.kind === 'shard')){
        for(let qi = 0; qi < keepers.length; qi++){
          const qp = keepers[qi];
          if(qp.hp > 0 && dist(s.x, s.y, qp.x, qp.y) < s.r + 13){
            this.damagePlayer(s.dmg, null, qp);
            s.dead = true;
            break;
          }
        }
        if(s.dead && this.state !== 'playing') return;
      }
    }
    this.shots = this.shots.filter(function(s){ return !s.dead; });
    this.updateFx(dt);
  }
  pickupFx(pk){
    if(pk.type === 'power'){
      const def = POWERUPS[pk.kind];
      this.burst(pk.x, pk.y, def.color, 1.1, 16, 4, 0.7);
      this.effect(pk.x, pk.y, def.color, 60);
      this.floatText(pk.x, pk.y, def.name, def.color);
      return;
    }
    this.burst(pk.x, pk.y, '#ffd98a', 0.7, 8, 3, 0.5);
    this.effect(pk.x, pk.y, pk.type === 'wick' ? '#98d9bc' : '#eec480', 25);
    if(pk.type !== 'ember') this.floatText(pk.x, pk.y, '+' + pk.val + (pk.type === 'oil' ? ' OIL' : ' VIGOR'), pk.type === 'wick' ? '#98d9bc' : '#eec480');
  }
  updateFx(dt){
    for(let i = 0; i < this.particles.length; i++){
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-3 * dt);
      p.vy *= Math.exp(-3 * dt);
      p.life -= dt;
    }
    this.particles = this.particles.filter(function(p){ return p.life > 0; });
    this.effects.forEach(e => e.life -= dt);
    this.effects = this.effects.filter(e => e.life > 0);
    this.trails.forEach(e => e.life -= dt);
    this.trails = this.trails.filter(e => e.life > 0);
  }

  run(){
    const now = performance.now() / 1000;
    let dt = now - (this.last || now);
    this.last = now;
    dt = Math.min(dt, 0.05);
    if(this.state === 'playing') this.update(dt);
    this.R.render(this, dt);
    requestAnimationFrame(() => this.run());
  }
}

let game = null;
window.addEventListener('DOMContentLoaded', function(){
  const canvas = document.getElementById('view');
  game = new Game(canvas, new Renderer(canvas));
  game.updateBestLine();
  game.showScreen('screen-title');
  game.last = performance.now() / 1000;
  game.run();
  // Co-op is wired here, after the game exists (mp-coop.js loads after this file).
  if(typeof Coop === 'function') game.lobby = new Coop(game);
});
