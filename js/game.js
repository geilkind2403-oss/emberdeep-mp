'use strict';

class Game {
  constructor(canvas, renderer){
    this.canvas = canvas;
    this.R = renderer || new Renderer(canvas);
    this.keys = {};
    this.mouse = { x: 0, y: 0 };
    this.best = 0;
    try{ this.best = parseInt(localStorage.getItem('emberdeep_best') || '0', 10) || 0; }catch(e){}
    this.state = 'title';
    this.coop = null;
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
    this._emberClock = 0;
    this._trailClock = 0;
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.t = 0;
    this.score = 0;
    this.embers = 0;
    this.upgLevels = {};
    this.last = 0;
    this._toastT = 0;
    this.initInput();
    this.initButtons();
  }

  stopInput(){
    this.keys = {}; this.mouse.down = false;
    if(this.P) this.P.flameOn = false;
    this._flameOn = false; SFX.flameOff();
  }
  pause(){
    if(this.state !== 'playing') return;
    this.state = 'pause';
    document.getElementById('pauseStats').textContent = 'FLOOR ' + this.floor + ' · SCORE ' + this.score;
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
    this._toastT = this.t;
  }

  initInput(){
    const kmap = {};
    ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','KeyP','Escape'].forEach(function(code){ kmap[code] = true; });
    window.addEventListener('keydown', (function(game){
      return function(e){
        if(kmap[e.code]){
          game.keys[e.code] = true;
          if(e.code === 'KeyP' || e.code === 'Escape'){
            if(!e.repeat){
              if(game.state === 'playing') game.pause();
              else if(game.state === 'pause') game.resume();
            }
            e.preventDefault();
          }
          if(e.code === 'Space' && game.state === 'playing') e.preventDefault();
        }
      };
    })(this));
    window.addEventListener('keyup', (function(game){
      return function(e){ game.keys[e.code] = false; };
    })(this));
    this.canvas.addEventListener('mousemove', (function(game){
      return function(e){
        const r = game.canvas.getBoundingClientRect();
        game.mouse.x = e.clientX - r.left;
        game.mouse.y = e.clientY - r.top;
      };
    })(this));
    this.canvas.addEventListener('mousedown', (function(game){
      return function(e){
        if(e.button === 0) game.mouse.down = true;
      };
    })(this));
    window.addEventListener('mouseup', (function(game){
      return function(e){
        if(e.button === 0) game.mouse.down = false;
      };
    })(this));
    window.addEventListener('blur', () => { this.stopInput(); this.pause(); });
    document.addEventListener('visibilitychange', () => { if(document.hidden){ this.stopInput(); this.pause(); } });
    this.canvas.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    window.addEventListener('resize', (function(game){ return function(){ game.R.resize(); }; })(this));
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
    const hud = document.getElementById('hud');
    this._hudEl = hud;
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
      const first = document.getElementById(name).querySelector('button');
      if(first) first.focus({preventScroll:true});
    }
  }

  startRun(){
    this.stopInput(); this.P = null; this.t = 0; this.shake = 0;
    this.floor = 0;
    this.score = 0;
    this.embers = 0;
    this.upgLevels = {};
    if(this.coop && this.coop.isHost && this.coop.runSeed) this.runSeed = this.coop.runSeed >>> 0;
    else if(!this.coop) this.runSeed = (Date.now() >>> 0);
    this.nextFloor();
    this.state = 'playing';
    this.showScreen(null);
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
    return P;
  }

  // ---- CO-OP ----
  coopMates(){
    if(!this.coop || !this.coop.mates) return [];
    const out = [];
    this.coop.mates.forEach(function(m){ out.push(m); });
    return out;
  }
  allPlayers(){
    const ps = this.P ? [this.P] : [];
    const mates = this.coopMates();
    for(let i = 0; i < mates.length; i++) ps.push(mates[i]);
    return ps;
  }
  nearestPlayer(x, y){
    const ps = this.allPlayers();
    let best = null, bd = Infinity;
    for(let i = 0; i < ps.length; i++){
      const p = ps[i];
      if(!p || p.hp <= 0 || p.dead) continue;
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if(d < bd){ bd = d; best = p; }
    }
    return best || this.P;
  }
  mateDown(m){
    m.hp = 0; m.alive = false; m.respawnT = 5; m.flameOn = false;
    this.burst(m.x, m.y, '#ff4d6d', 1.4, 18, 5, 0.8);
    this.effect(m.x, m.y, '#ff4d6d', 90);
    if(this.coop) this.coop.say((m.name || 'Keeper') + ' is down — respawn in 5s');
  }
  updateMate(m, dt){
    const W = this.world;
    const inp = (this.coop && this.coop.inputs[m.id]) || {};
    if(m.flameCd > 0) m.flameCd -= dt;
    if(m.flashT > 0) m.flashT -= dt;
    if(m.alive === false){
      m.respawnT -= dt;
      if(m.respawnT <= 0 && W){
        m.alive = true; m.hp = m.maxHp; m.oil = Math.max(m.oil, m.maxOil * 0.5);
        m.x = W.spawn.x; m.y = W.spawn.y;
      }
      return;
    }
    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if(dx && dy){ dx *= 0.7071; dy *= 0.7071; }
    if(typeof inp.ang === 'number') m.aim = inp.ang;
    if(dx || dy) m.walk = (m.walk || 0) + dt * 16;
    if(m.dashT > 0){
      m.x += m.dashDir.x * m.dash.speed * dt;
      m.y += m.dashDir.y * m.dash.speed * dt;
    } else if(dx || dy){
      m.x += dx * m.speed * dt;
      m.y += dy * m.speed * dt;
    }
    m.x = clamp(m.x, 18, W.w - 18);
    m.y = clamp(m.y, 18, W.h - 18);
    for(let i = 0; i < W.obstacles.length; i++){
      const hit = resolveCircleRect(m.x, m.y, 13, W.obstacles[i]);
      if(hit){ m.x += hit.dx; m.y += hit.dy; }
    }
    m.surgeT = Math.max(0, (m.surgeT || 0) - dt);
    m.surgeCdT = Math.max(0, (m.surgeCdT || 0) - dt);
    m.dashT = Math.max(0, (m.dashT || 0) - dt);
    m.dashCdT = Math.max(0, (m.dashCdT || 0) - dt);
    m.invulnT = Math.max(0, (m.invulnT || 0) - dt);
    m.snuffT = Math.max(0, (m.snuffT || 0) - dt);
    if(inp.surge && m.surgeCdT <= 0 && m.oil > 0 && !m._surgeHeld){
      m.surgeCdT = m.surge.cd; m.surgeT = 0.6;
      m.oil = Math.max(0, m.oil - 5);
      this.burst(m.x, m.y, '#ffd98a', 1.5, 24, 6, 0.9);
      for(let i = 0; i < this.enemies.length; i++){
        const e = this.enemies[i];
        if(e.dead) continue;
        const d = dist(m.x, m.y, e.x, e.y);
        if(d < m.surge.r + e.r){
          e.hp -= m.surge.dmg; e.flash = 0.3;
          const ddx = e.x - m.x, ddy = e.y - m.y, dd = Math.hypot(ddx, ddy) || 1;
          e.kb.x += (ddx / dd) * m.surge.kb; e.kb.y += (ddy / dd) * m.surge.kb;
          if(e.hp <= 0) this.killEnemy(e, m);
        }
      }
      for(let i = 0; i < this.shots.length; i++){
        const s = this.shots[i];
        if((s.kind === 'orb' || s.kind === 'shard') && dist(m.x, m.y, s.x, s.y) < m.surge.r) s.dead = true;
      }
    }
    m._surgeHeld = !!inp.surge;
    if(inp.dash && m.dashCdT <= 0 && !m._dashHeld){
      m.dashCdT = m.dash.cd; m.dashT = m.dash.dur;
      m.invulnT = Math.max(m.invulnT, m.dash.dur);
      m.dashDir = { x: dx || Math.cos(m.aim), y: dy || Math.sin(m.aim) };
      const mdl = Math.hypot(m.dashDir.x, m.dashDir.y) || 1;
      m.dashDir.x /= mdl; m.dashDir.y /= mdl;
    }
    m._dashHeld = !!inp.dash;
    m.oil = Math.max(0, m.oil - CFG.drain * dt);
    m.flameOn = !!inp.fire && m.oil > 0;
    if(m.flameOn){
      m.oil = Math.max(0, m.oil - m.flame.cost * dt);
      const dmg = m.flame.dps * dt;
      for(let i = 0; i < this.enemies.length; i++){
        const e = this.enemies[i];
        if(e.dead) continue;
        const ex = e.x - m.x, ey = e.y - m.y;
        const d = Math.hypot(ex, ey);
        if(d > m.flame.range + e.r) continue;
        const ea = Math.atan2(ey, ex);
        if(Math.abs(angleDiff(ea, m.aim)) > m.flame.half + e.r / (d || 1)) continue;
        e.hp -= dmg;
        e.flash = Math.max(e.flash, 0.2);
        e.kb.x += ex / (d || 1) * m.flame.kb * dt;
        e.kb.y += ey / (d || 1) * m.flame.kb * dt;
        if(e.hp <= 0) this.killEnemy(e, m);
      }
    }
    if(m.oil <= 0){
      m.oil = 0;
      m.hp -= CFG.darkDps * dt;
      if(m.hp <= 0){ this.mateDown(m); return; }
    }
    for(let i = 0; i < W.pickups.length; i++){
      const pk = W.pickups[i];
      if(pk.taken) continue;
      if(dist(m.x, m.y, pk.x, pk.y) < 26){
        pk.taken = true;
        if(pk.type === 'ember') this.embers += pk.val * (m.greed || 1);
        else if(pk.type === 'oil') m.oil = Math.min(m.maxOil, m.oil + pk.val);
        else m.hp = Math.min(m.maxHp, m.hp + pk.val);
        this.burst(pk.x, pk.y, '#ffd98a', 0.7, 8, 3, 0.5);
      }
    }
    if(W.gateOpen && dist(m.x, m.y, W.gate.x, W.gate.y) < 55) this.stepGate();
  }
  updateMates(dt){
    const mates = this.coopMates();
    for(let i = 0; i < mates.length; i++){
      if(this.state !== 'playing') return;
      this.updateMate(mates[i], dt);
    }
    if(this.coop) this.coop.tick(dt);
  }
  updateGuest(dt){
    this.t += dt;
    this.shake = Math.max(0, this.shake - 14 * dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    const P = this.P;
    if(P && this.world){
      const follow = this.R.reducedMotion ? 1 : 1 - Math.exp(-12 * dt);
      this.cam.x = lerp(this.cam.x, P.x, follow);
      this.cam.y = lerp(this.cam.y, P.y, follow);
      const origin = this.cameraOrigin();
      P.aim = Math.atan2(this.mouse.y + origin.y - P.y, this.mouse.x + origin.x - P.x);
    }
    for(let i = 0; i < this.particles.length; i++){
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.exp(-3 * dt); p.vy *= Math.exp(-3 * dt);
      p.life -= dt;
    }
    this.particles = this.particles.filter(function(p){ return p.life > 0; });
    this.effects.forEach(function(e){ e.life -= dt; });
    this.effects = this.effects.filter(function(e){ return e.life > 0; });
    if(this.coop) this.coop.tick(dt);
  }
  applyUpgrade(u){
    this.upgLevels[u.id] = (this.upgLevels[u.id] || 0) + 1;
    u.apply(this.P);
    const mates = this.coopMates();
    for(let i = 0; i < mates.length; i++){
      try{ u.apply(mates[i]); }catch(e){}
    }
    this.toast(u.name.toUpperCase());
  }
  nextFloor(){
    this.floor++;
    this.rng = new Rng(((this.runSeed || 0) + this.floor * 7919) >>> 0);
    this.world = generateFloor(this.floor, this.rng);
    const W = this.world;
    this.enemies = [];
    this.shots = [];
    this.particles = [];
    this.effects = []; this.trails = []; this.hurtT = 0;
    this._emberClock = this._trailClock = 0;
    this.shots.length = 0;
    this.P = this.P || this.makePlayer();
    this.P.x = W.spawn.x; this.P.y = W.spawn.y;
    this.P.surgeT = this.P.surgeCdT = this.P.dashT = this.P.dashCdT = this.P.invulnT = 0;
    this.P.snuffT = 0;
    this.P.walk = 0;
    this.stopInput();
    W.spawnsLeft = W.boss ? 0 : W.quota - W.initial;
    W.spawnT = W.spawnInterval;
    const P = this.P;
    P.oil = Math.min(P.maxOil, P.oil + 30);
    for(let i = 0; i < W.initial; i++){
      const s = placeMobSpot(W, new Rng(this.floor * 7919 + i), P.x, P.y);
      this.spawnEnemy(pickMobType(this.floor, new Rng(this.floor * 31 + i)), s.x, s.y);
    }
    if(W.boss){
      const spot = freeSpot(W.w, W.h, W.obstacles, this.rng, 400, P.x, P.y, ENEMY_DEFS[W.boss].r + 5);
      const boss = new Enemy(this, W.boss, spot.x, spot.y);
      this.enemies.push(boss);
      SFX.bossRoar();
    }
    this.cam = { x: W.spawn.x, y: W.spawn.y };
    const origin = this.cameraOrigin();
    this.mouse.x = this.P.x - origin.x + 90;
    this.mouse.y = this.P.y - origin.y;
    this.state = 'playing';
    this.showScreen(null);
    SFX.floor();
    this.toast('FLOOR ' + W.num);
    if(this.coop && this.coop.isHost) this.coop.onFloor();
  }

  boss(){
    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(e.isBoss && !e.dead) return e;
    }
    return null;
  }

  spawnEnemy(type, x, y){
    const e = new Enemy(this, type, x, y);
    this.enemies.push(e);
    this.burst(x, y, '#2a1430', 1, 12, 5, 0.5);
    this.effect(x, y, e.d.eye, e.r * 2.5);
    return e;
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
    this.shake += 2;
  }

  killEnemy(e, killer){
    if(e.dead) return;
    e.dead = true;
    const K = killer || this.P;
    const mult = (K && K.greed) || 1;
    this.score += e.d.pts;
    this.embers += Math.round(e.d.ember * mult);
    this.world.pickups.push({ type: 'oil', x: e.x, y: e.y, val: e.isBoss ? 60 : 14, t: this.t });
    const P = K || this.P;
    if(P){
      P.hp = Math.min(P.maxHp, P.hp + (P.lifesteal || 0));
      P.oil = Math.min(P.maxOil, P.oil + (P.oilOnKill || 0));
    }
    SFX.kill();
    this.burst(e.x, e.y, '#ff8a3d', e.isBoss ? 2 : 1, e.isBoss ? 34 : 14, e.isBoss ? 8 : 4, 0.8);
    this.effect(e.x, e.y, e.d.eye, e.isBoss ? 150 : 42);
    this.floatText(e.x, e.y, '+' + e.d.pts, '#efd29a');
    this.shake += e.isBoss ? 4 : 1;
    if(e.d.shards){
      const n = e.d.shards;
      for(let i = 0; i < n; i++){
        const a = i / n * TAU + Math.random() * 0.4;
        const sp = 140 + Math.random() * 60;
        this.shots.push(makeShard(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, e.dmg * 0.6));
      }
    }
    if(e.isBoss){
      SFX.bossRoar();
      this.shake += 6;
    }
  }

  damagePlayer(amount, src, target){
    const P = target || this.P;
    if(!P || P.hp <= 0) return;
    if(P.hp <= 0 || P.invulnT > 0 || P.dashT > 0) return;
    if(P.ward > 0 && Math.random() < P.ward){
      this.burst(P.x, P.y, '#ffd98a', 1, 8, 4, 0.4);
      SFX.hitE();
      P.invulnT = P.invuln;
      return;
    }
    P.hp -= amount;
    this.hurtT = 0.6;
    P.invulnT = Math.max(P.invulnT, P.invuln);
    if(src && src.kb){
      const dx = P.x - src.x, dy = P.y - src.y;
      const d = Math.hypot(dx, dy) || 1;
      P.x += dx / d * 6;
      P.y += dy / d * 6;
    }
    SFX.hurt();
    this.shake += 2.5;
    this.burst(P.x, P.y, '#ff4d6d', 1, 10, 4, 0.5);
    if(P.thorns > 0 && src && !src.dead && src.hp !== undefined){
      src.hp -= P.thorns;
      if(src.hp <= 0) this.killEnemy(src, P);
    }
    if(P.hp <= 0){
      P.hp = 0;
      if(P !== this.P && this.coop){ this.mateDown(P); return; }
      this.gameOver();
    }
  }

  gameOver(){
    this.state = 'over';
    SFX.over();
    const s = document.getElementById('overStats');
    s.innerHTML = '';
    const rows = [['FLOOR', this.floor], ['SCORE', Math.round(this.score)], ['EMBERS', Math.round(this.embers)]];
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
    const isBest = this.score > this.best;
    if(isBest){
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
    const s = document.getElementById('vicStats');
    s.innerHTML = '';
    const rows = [['SCORE', Math.round(this.score)], ['EMBERS', Math.round(this.embers)]];
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
    this.showScreen('screen-victory');
    if(this.coop && this.coop.isHost) this.coop.onEnd('victory');
  }

  toTitle(){
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

  showUpgrade(){
    const game = this;
    this.state = 'upgrade';
    const pool = UPGRADES.filter(function(u){
      return !game.upgLevels[u.id] || game.upgLevels[u.id] < u.max;
    });
    const picks = [];
    const pool2 = pool.slice();
    while(picks.length < 3 && pool2.length){
      const i = (Math.random() * pool2.length) | 0;
      picks.push(pool2.splice(i, 1)[0]);
    }
    const wrap = document.getElementById('upgradeCards');
    wrap.innerHTML = '';
    if(!picks.length){ this.nextFloor(); return; }
    if(this.coop && this.coop.isHost) this.coop.onUpgradeOpen(picks.map(function(u){ return u.id; }));
    for(let i = 0; i < picks.length; i++){
      (function(u){
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'card';
        const symbols = {heart:'♡',swift:'↗',vessel:'♜',thin:'♧',fanned:'♨',broad:'✺',reach:'☼',deepfl:'♜',surgeP:'✹',ready:'◷',wind:'≋',thirst:'♧',greed:'◆',siphon:'◈',thorns:'✧',mend:'✚',crit:'✴',ward:'⬡'};
        const icon = document.createElement('div');
        icon.className = 'boon-icon'; icon.textContent = symbols[u.id] || '✧';
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
        card.addEventListener('click', function(){
          if(game.state !== 'upgrade') return;
          SFX.upgrade();
          game.applyUpgrade(u);
          if(game.coop && game.coop.isHost) game.coop.onUpgradePick(u.id);
          game.nextFloor();
        });
        wrap.appendChild(card);
      })(picks[i]);
    }
    this.showScreen('screen-upgrade');
  }

  endless(){
    this.world.gateOpen = true;
    this.nextFloor();
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
        this.world.pickups.push({
          type: 'oil', source: 'vent', val: 12,
          x: vent.x + Math.cos(a) * 34, y: vent.y + Math.sin(a) * 34,
          t: this.t
        });
      }
    }
  }

  updateFuelVents(dt){
    const W = this.world, P = this.P;
    this.fuelStatus = null;
    if(!W.vents.length) return;

    W.ventCycleT -= dt;
    if(W.ventCycleT <= 0){
      const sleeping = W.vents.filter(function(v){ return !v.active; });
      const target = sleeping.length ? pick(sleeping) : pick(W.vents);
      this.wakeFuelVent(target, true);
      W.ventCycleT = rand(8, 15);
    }

    let hasActive = false;
    for(let i = 0; i < W.vents.length; i++){
      const v = W.vents[i];
      const d = dist(P.x, P.y, v.x, v.y);
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
        if(d < 62){
          const need = Math.max(0, P.maxOil - P.oil);
          const amount = Math.min(need, v.fuel, 34 * dt);
          if(amount > 0){
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
          this.fuelStatus = v.fuel > 0
            ? '◈ REFILLING · ' + Math.ceil(v.fuel) + ' FUEL LEFT'
            : '◈ FUEL VENT EMPTY';
        } else if(d < 115){
          this.fuelStatus = '◈ ACTIVE FUEL VENT · MOVE CLOSER';
        }
        if(v.fuel <= 0){
          v.fuel = 0; v.active = false; v.refillT = rand(9, 17);
          this.effect(v.x, v.y, '#476f69', 48);
        }
      } else {
        v.active = false;
        v.refillT = Math.max(0, (v.refillT !== undefined ? v.refillT : rand(8, 15)) - dt);
        if(d < 82) this.fuelStatus = '◈ VENT RECHARGING · ' + Math.ceil(v.refillT) + 's';
        if(v.refillT <= 0) this.wakeFuelVent(v, true);
      }
    }
    if(!hasActive){
      const next = W.vents.reduce(function(a, b){ return a.refillT < b.refillT ? a : b; });
      this.wakeFuelVent(next, false);
    }
  }

  update(dt){
    if(this.state !== 'playing') return;
    this.t += dt;
    const W = this.world, P = this.P;
    if(this.coop && !this.coop.isHost){ this.updateGuest(dt); return; }
    if(!W || !P || P.hp <= 0) return;

    this.shake = Math.max(0, this.shake - 14 * dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    const follow = this.R.reducedMotion ? 1 : 1 - Math.exp(-12 * dt);
    this.cam.x = lerp(this.cam.x, P.x, follow);
    this.cam.y = lerp(this.cam.y, P.y, follow);

    const mvx = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const mvy = (this.keys['KeyS'] ? 1 : 0) - (this.keys['KeyW'] ? 1 : 0);
    const mvl = Math.hypot(mvx, mvy) || 1;
    const origin = this.cameraOrigin();
    P.aim = Math.atan2(this.mouse.y + origin.y - P.y, this.mouse.x + origin.x - P.x);

    const speed = P.speed * (P.dashT > 0 ? (P.dash.speed / P.speed) : 1);
    if(mvx || mvy) P.walk = (P.walk || 0) + dt * 16;
    if(P.dashT > 0 && !this.R.reducedMotion){
      this._trailClock += dt;
      if(this._trailClock >= 0.022){
        this._trailClock %= 0.022;
        this.trails.push({ x:P.x, y:P.y, aim:P.aim, life:0.28, maxLife:0.28 });
      }
    }
    if(P.dashT > 0){
      P.x += P.dashDir.x * P.dash.speed * dt;
      P.y += P.dashDir.y * P.dash.speed * dt;
    } else if(mvx || mvy){
      P.x += (mvx / mvl) * speed * dt;
      P.y += (mvy / mvl) * speed * dt;
    }
    P.x = clamp(P.x, 18, W.w - 18);
    P.y = clamp(P.y, 18, W.h - 18);
    for(let i = 0; i < W.obstacles.length; i++){
      const hit = resolveCircleRect(P.x, P.y, 13, W.obstacles[i]);
      if(hit){ P.x += hit.dx; P.y += hit.dy; }
    }

    P.surgeT = Math.max(0, P.surgeT - dt);
    P.surgeCdT = Math.max(0, P.surgeCdT - dt);
    P.dashT = Math.max(0, P.dashT - dt);
    P.dashCdT = Math.max(0, P.dashCdT - dt);
    P.invulnT = Math.max(0, P.invulnT - dt);
    P.snuffT = Math.max(0, (P.snuffT || 0) - dt);

    this.updateFuelVents(dt);

    if(this.keys['Space'] && P.surgeCdT <= 0 && P.oil > 0){
      P.surgeCdT = P.surge.cd;
      P.surgeT = 0.6;
      P.oil = Math.max(0, P.oil - 5);
      SFX.surge();
      this.shake += 3;
      this.burst(P.x, P.y, '#ffd98a', 1.5, 24, 6, 0.9);
      for(let i = 0; i < this.enemies.length; i++){
        const e = this.enemies[i];
        if(e.dead) continue;
        const d = dist(P.x, P.y, e.x, e.y);
        if(d < P.surge.r + e.r){
          e.hp -= P.surge.dmg;
          e.flash = 0.3;
          const dx = e.x - P.x, dy = e.y - P.y;
          const dd = Math.hypot(dx, dy) || 1;
          e.kb.x += (dx / dd) * P.surge.kb;
          e.kb.y += (dy / dd) * P.surge.kb;
          if(e.hp <= 0) this.killEnemy(e, P);
        }
      }
      for(let i = 0; i < this.shots.length; i++){
        const s = this.shots[i];
        if(s.kind !== 'orb' && s.kind !== 'shard') continue;
        if(dist(P.x, P.y, s.x, s.y) < P.surge.r) s.dead = true;
      }
    }

    if((this.keys['ShiftLeft'] || this.keys['ShiftRight']) && P.dashCdT <= 0){
      P.dashCdT = P.dash.cd;
      P.dashT = P.dash.dur;
      P.invulnT = Math.max(P.invulnT, P.dash.dur);
      const mdx = (mvx || 0), mdy = (mvy || 0);
      const mdl = Math.hypot(mdx, mdy);
      P.dashDir = { x: mdl > 0 ? mdx / mdl : Math.cos(P.aim), y: mdl > 0 ? mdy / mdl : Math.sin(P.aim) };
      SFX.dash();
      this.burst(P.x, P.y, '#ffd98a', 0.6, 10, 3, 0.4);
    }

    P.oil = Math.max(0, P.oil - CFG.drain * dt);
    P.flameOn = !!this.mouse.down && P.oil > 0;
    if(P.flameOn){
      P.oil = Math.max(0, P.oil - P.flame.cost * dt);
      if(P.flame.heal > 0) P.hp = Math.min(P.maxHp, P.hp + P.flame.heal * dt);
      if(!this._flameOn) SFX.flameOn();
      this._flameOn = true;
    } else {
      if(this._flameOn) SFX.flameOff();
      this._flameOn = false;
    }

    if(P.flameOn && P.oil > 0){
      this._emberClock += dt;
      const interval = this.R.reducedMotion ? 0.07 : 0.018;
      while(this._emberClock >= interval){
        this._emberClock -= interval;
        if(this.particles.length >= 450) continue;
        const angle = P.aim + rand(-P.flame.half, P.flame.half) * 0.85;
        const sp = rand(260, 420), life = rand(0.22, 0.45);
        this.particles.push({ x:P.x+Math.cos(P.aim)*17, y:P.y+Math.sin(P.aim)*17,
          vx:Math.cos(angle)*sp, vy:Math.sin(angle)*sp, life, maxLife:life,
          size:rand(1.5,3.5), color:pick(['#ffcb70','#e8943e','#ffe7a6']) });
      }
      const dmg = P.flame.dps * dt;
      for(let i = 0; i < this.enemies.length; i++){
        const e = this.enemies[i];
        if(e.dead) continue;
        const dx = e.x - P.x, dy = e.y - P.y;
        const d = Math.hypot(dx, dy);
        if(d > P.flame.range + e.r) continue;
        const ea = Math.atan2(dy, dx);
        if(Math.abs(angleDiff(ea, P.aim)) > P.flame.half + e.r / (d || 1)) continue;
        const crit = Math.random() < (P.flame.crit || 0);
        const dd = dmg * (crit ? P.flame.critMult : 1);
        e.hp -= dd;
        e.flash = Math.max(e.flash, 0.2);
        e.kb.x += dx / (d || 1) * P.flame.kb * dt;
        e.kb.y += dy / (d || 1) * P.flame.kb * dt;
        if(crit){
          SFX.hitE();
          this.burst(e.x, e.y, '#ffd98a', 0.8, 6, 3, 0.4);
        }
        if(e.hp <= 0) this.killEnemy(e, P);
      }
    }

    if(P.oil <= 0){
      P.oil = 0;
      P.hp -= CFG.darkDps * dt;
      if(P.hp <= 0){
        P.hp = 0;
        this.gameOver();
        return;
      }
    }

    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(!e.dead){
        e.update(dt, this);
        if(this.state !== 'playing') return;
      }
    }
    if(this.coop && this.coop.isHost) this.updateMates(dt);
    this.enemies = this.enemies.filter(function(e){ return !e.dead; });

    W.spawnT -= dt;
    if(W.spawnT <= 0 && W.spawnsLeft > 0){
      W.spawnT = W.spawnInterval; W.spawnsLeft--;
      const spot = placeMobSpot(W, this.rng, P.x, P.y);
      this.spawnEnemy(pickMobType(this.floor, this.rng), spot.x, spot.y);
    }
    if(!W.gateOpen && W.spawnsLeft === 0 && this.enemies.length === 0) this.stepGate();
    if(W.gateOpen){
      const ps = this.allPlayers();
      for(let gi = 0; gi < ps.length; gi++){
        const gp = ps[gi];
        if(gp.hp > 0 && dist(gp.x, gp.y, W.gate.x, W.gate.y) < 55){ this.stepGate(); return; }
      }
    }

    for(let i = 0; i < W.pickups.length; i++){
      const pk = W.pickups[i];
      if(pk.taken) continue;
      const ps = this.allPlayers();
      for(let pi = 0; pi < ps.length; pi++){
        const taker = ps[pi];
        if(taker.hp <= 0 || dist(taker.x, taker.y, pk.x, pk.y) >= 26) continue;
        pk.taken = true;
        if(pk.type === 'ember'){
          this.embers += pk.val * (taker.greed || 1);
          SFX.pick();
        } else if(pk.type === 'oil'){
          taker.oil = Math.min(taker.maxOil, taker.oil + pk.val);
          SFX.oilPick();
        } else {
          taker.hp = Math.min(taker.maxHp, taker.hp + pk.val);
          SFX.wickPick();
        }
        this.burst(pk.x, pk.y, '#ffd98a', 0.7, 8, 3, 0.5);
        this.effect(pk.x, pk.y, pk.type === 'wick' ? '#98d9bc' : '#eec480', 25);
        if(pk.type !== 'ember') this.floatText(pk.x, pk.y, '+' + pk.val + (pk.type === 'oil' ? ' OIL' : ' VIGOR'), pk.type === 'wick' ? '#98d9bc' : '#eec480');
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
        const ps = this.allPlayers();
        for(let qi = 0; qi < ps.length; qi++){
          const qp = ps[qi];
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
  try{
  const canvas = document.getElementById('view');
  game = new Game(canvas, new Renderer(canvas));
  game.updateBestLine();
  game.showScreen('screen-title');
  game.last = performance.now() / 1000;
  game.run();
  }catch(err){
    try{
      const el = document.getElementById('coopStatus');
      if(el) el.textContent = 'GAME-INIT-FEHLER: ' + ((err && err.message) || err);
    }catch(_){}
    throw err;
  }
});
