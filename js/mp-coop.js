'use strict';
/* EMBERDEEP CO-OP: same dungeon, same floors, shared run, invite codes.
   The host simulates the world (enemies, damage, oil, pickups, vents). Guests
   move their own keeper locally, so walking has no network lag, and send
   position + input; the host answers with snapshots that guests smooth out.
   Team rules: score and embers are shared, the host picks one boon for the
   whole team, fallen guests respawn after 5s, the run ends when the host falls.

   Game messages (transport messages live in mp-net.js):
   host->guest: start | floor {floor, seed, upg, keepers} | state {st, ...} |
                upg-open {ids} | end {kind} | title | say {msg}
   guest->host: in {x, y, tp, mx, my, a, f, s, dt} */

var COOP_SNAP_MS = 66;      // ~15 snapshots per second
var COOP_INPUT_MS = 33;     // ~30 inputs per second
var COOP_INPUT_STALE = 500; // ms; older input counts as "let go"

function Coop(game){
  const self = this;
  this.game = game;
  this.isHost = false;
  this.runSeed = 0;
  this.mates = new Map();     // host: id -> simulated keeper | guest: id -> render shell
  this.inputs = {};           // host: id -> latest input
  this.lastSnap = 0;
  this.pickupSig = '';        // host: pickups are only sent when they change
  this.hostState = 'playing'; // guest: what the host's game is doing
  this.enemyMap = new Map();  // guest: id -> enemy shell
  this.stats = {};            // guest: id -> keeper stats from the last floor message
  this.fresh = false;         // guest: next snapshot is the first of a floor (no fx)
  this.surgeTap = false;      // guest: remembers taps shorter than one input interval
  this.banner = '';
  this.net = new MPNet({
    status: function(s){ self.uiStatus(s); },
    lobby: function(info){ self.onLobby(info); },
    message: function(msg, from){ self.onMessage(msg, from); },
    peerJoined: function(id){ self.onPeerJoined(id); },
    peerLeft: function(id){ self.onPeerLeft(id); },
    closed: function(reason){ self.onClosed(reason); }
  });
  this.wireUi();
  setInterval(function(){ self.netTick(); }, COOP_INPUT_MS);
  window.addEventListener('pagehide', function(){ self.net.leave(); });
}
Coop.prototype.active = function(){ return this.game.coop === this; };
Coop.prototype.say = function(msg){
  this.game.toast(msg);
  if(this.isHost) this.net.broadcast({ t: 'say', msg: msg });
};
Coop.prototype.myName = function(){
  return mpCleanName(document.getElementById('coopName').value, 'Wickkeeper');
};

// ---------- Lobby UI ----------
Coop.prototype.ui = function(){
  const $ = function(id){ return document.getElementById(id); };
  return { invite: $('coopInvite'), players: $('coopPlayers'), status: $('coopStatus'), code: $('coopCode'),
    host: $('btnCoopHost'), join: $('btnCoopJoin'), copy: $('btnCoopCopy'), start: $('btnCoopStart'), leave: $('btnCoopLeave') };
};
Coop.prototype.uiStatus = function(s){ this.ui().status.textContent = s; };
Coop.prototype.inviteUrl = function(){ return location.origin + location.pathname + '?room=' + this.net.code; };
Coop.prototype.refreshUi = function(){
  const u = this.ui(), net = this.net, on = net.connected();
  u.invite.innerHTML = '';
  if(on){
    u.invite.append('Code ');
    const b = document.createElement('b');
    b.textContent = net.code;
    u.invite.appendChild(b);
  } else u.invite.textContent = 'No lobby yet.';
  u.copy.disabled = !on;
  u.start.disabled = !(on && net.isHost);
  u.leave.disabled = !net.peer;
  u.players.innerHTML = '';
  net.players.forEach(function(p, i){
    const li = document.createElement('li');
    li.textContent = p.name + (i === 0 ? ' (Host)' : '') + (p.id === net.myId ? ' · you' : '');
    li.style.color = p.color;
    u.players.appendChild(li);
  });
};
Coop.prototype.onLobby = function(info){
  this.refreshUi();
  if(this.active()){
    // a keeper may have joined/renamed mid-run; keep the shells' labels current
    const self = this;
    info.players.forEach(function(p){
      const m = self.mates.get(p.id);
      if(m){ m.name = p.name; m.color = p.color; }
    });
    return;
  }
  this.uiStatus(info.isHost
    ? 'Lobby ' + info.code + ' offen (' + info.players.length + '/' + MP_MAX_PLAYERS + ') — schick den Invite-Link an deine Keeper.'
    : 'Verbunden mit Lobby ' + info.code + ' — warte auf den Host.');
};
Coop.prototype.wireUi = function(){
  const self = this, u = this.ui();
  function withPeer(fn){
    SFX.init(); // the click is the user gesture that unlocks audio for the run
    self.uiStatus('Lade Netzwerk …');
    mpLoadPeer(function(err){
      if(err) self.uiStatus('FEHLER: ' + err.message);
      else { fn(); self.refreshUi(); }
    });
  }
  function join(){
    const code = mpNormCode(u.code.value);
    if(code.length !== 6){ self.uiStatus('Code muss 6 Zeichen haben.'); return; }
    withPeer(function(){ self.isHost = false; self.net.join(code, self.myName()); });
  }
  u.host.addEventListener('click', function(){
    withPeer(function(){ self.isHost = true; self.net.host(self.myName()); });
  });
  u.join.addEventListener('click', join);
  u.code.addEventListener('keydown', function(e){ if(e.key === 'Enter') join(); });
  u.copy.addEventListener('click', function(){
    if(!self.net.connected()) return;
    const url = self.inviteUrl();
    function done(){ self.uiStatus('Invite-Link kopiert: ' + url); }
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function(){ prompt('Link kopieren:', url); });
    else prompt('Link kopieren:', url);
  });
  u.start.addEventListener('click', function(){ self.startAsHost(); });
  u.leave.addEventListener('click', function(){
    self.net.leave();
    self.refreshUi();
    self.uiStatus('Lobby verlassen.');
  });
  window.addEventListener('keydown', function(e){ if(e.code === 'Space') self.surgeTap = true; });
  const m = /[?&]room=([A-Za-z0-9]{6})/i.exec(location.search);
  if(m){
    u.code.value = m[1].toUpperCase();
    this.uiStatus('Code ' + u.code.value + ' erkannt — Name wählen, dann Join.');
  }
  this.refreshUi();
};

// ---------- Run lifecycle ----------
Coop.prototype.startAsHost = function(){
  if(!this.net.isHost || !this.net.connected()) return;
  SFX.init(); SFX.start();
  this.isHost = true;
  this.game.coop = this;
  document.body.classList.remove('coop-guest');
  this.game.startRun();
};
// Called by Game.startRun on the host: fresh keepers and a fresh dungeon for everyone.
Coop.prototype.onRunStart = function(){
  this.runSeed = (Math.random() * 0x7fffffff) >>> 0;
  this.mates = new Map();
  this.inputs = {};
  this.net.broadcast({ t: 'start' });
  return this.runSeed;
};
Coop.prototype.endRun = function(){
  if(this.game.coop === this) this.game.coop = null;
  this.mates = new Map();
  this.inputs = {};
  this.enemyMap = new Map();
  document.body.classList.remove('coop-guest');
  this.setBanner('');
  this.refreshUi();
};
// Called by Game.toTitle: the host takes everyone back to the lobby, a guest leaves it.
Coop.prototype.onTitle = function(){
  if(this.isHost){
    this.net.broadcast({ t: 'title' });
    this.uiStatus('Lobby ' + this.net.code + ' ist weiter offen — Start co-op für den nächsten Abstieg.');
  } else {
    this.net.leave();
    this.uiStatus('Lobby verlassen.');
  }
  this.endRun();
};
Coop.prototype.onClosed = function(reason){
  const wasActive = this.active();
  this.endRun();
  if(wasActive) this.game.toTitle();
  this.uiStatus(reason);
};

// ---------- Host ----------
// Keeps one simulated keeper per guest in the lobby. Late joiners get the boons
// the team already picked.
Coop.prototype.syncMates = function(){
  const g = this.game, self = this, seen = {};
  this.net.players.forEach(function(p){
    if(p.id === self.net.myId){
      g.P.id = p.id; g.P.name = p.name; g.P.color = p.color;
      return;
    }
    seen[p.id] = true;
    let m = self.mates.get(p.id);
    if(!m){
      m = g.makePlayer();
      m.id = p.id;
      m.alive = true;
      UPGRADES.forEach(function(u){ for(let i = 0; i < (g.upgLevels[u.id] || 0); i++) u.apply(m); });
      self.mates.set(p.id, m);
    }
    m.name = p.name; m.color = p.color;
  });
  this.mates.forEach(function(m, id){
    if(!seen[id]){ self.mates.delete(id); delete self.inputs[id]; }
  });
};
Coop.prototype.onPeerJoined = function(id){
  if(!this.active()) return;
  this.syncMates();
  const m = this.mates.get(id);
  this.net.sendTo(id, { t: 'start' });
  this.net.sendTo(id, this.floorMsg());
  this.pickupSig = '';
  if(m) this.say(m.name + ' joins the descent.');
};
Coop.prototype.onPeerLeft = function(id){
  delete this.inputs[id];
  const m = this.mates.get(id);
  if(!m) return;
  this.mates.delete(id);
  if(this.active()) this.say(m.name + ' has left the descent.');
};
Coop.prototype.keeperStats = function(p){
  return { id: p.id, x: Math.round(p.x), y: Math.round(p.y), tp: p.tp,
    speed: p.speed, lightR: p.lightR, maxHp: p.maxHp, maxOil: p.maxOil,
    flame: { range: p.flame.range, half: p.flame.half },
    surge: { r: p.surge.r, cd: p.surge.cd },
    dash: { cd: p.dash.cd, dur: p.dash.dur, speed: p.dash.speed } };
};
Coop.prototype.floorMsg = function(){
  const g = this.game;
  return { t: 'floor', floor: g.floor, seed: g.runSeed >>> 0, upg: g.upgLevels,
    keepers: g.allPlayers().map(this.keeperStats, this) };
};
Coop.prototype.onFloor = function(){
  this.pickupSig = '';
  this.lastSnap = 0;
  this.net.broadcast(this.floorMsg());
};
Coop.prototype.onUpgradeOpen = function(ids){ this.net.broadcast({ t: 'upg-open', ids: ids }); };
Coop.prototype.onEnd = function(kind){ this.net.broadcast({ t: 'end', kind: kind }); };
Coop.prototype.inputFor = function(m){
  const inp = this.inputs[m.id];
  if(!inp) return { mx: 0, my: 0, aim: m.aim, fire: false, surge: false, dashT: 0 };
  const live = performance.now() - inp.at < COOP_INPUT_STALE;
  // A position sent before the guest saw the latest teleport is stale.
  const placed = inp.tp === m.tp;
  return { mx: live ? inp.mx : 0, my: live ? inp.my : 0, aim: inp.a,
    fire: live && !!inp.f, surge: live && !!inp.s, dashT: live ? inp.dt : 0,
    x: placed ? inp.x : undefined, y: placed ? inp.y : undefined };
};
Coop.prototype.snapshot = function(){
  const g = this.game, W = g.world;
  if(g.state !== 'playing' || !W) return { t: 'state', st: g.state };
  const r = Math.round, r1 = function(v){ return Math.round(v * 10) / 10; }, r2 = function(v){ return Math.round(v * 100) / 100; };
  const msg = { t: 'state', st: 'playing', score: r(g.score), embers: r(g.embers),
    gate: W.gateOpen ? 1 : 0, left: W.spawnsLeft,
    keepers: g.allPlayers().map(function(p){
      return { id: p.id, x: r(p.x), y: r(p.y), a: r2(p.aim), w: r1(p.walk || 0), hp: r1(p.hp), oil: r1(p.oil),
        f: p.flameOn ? 1 : 0, sg: r2(p.surgeT), scd: r1(p.surgeCdT), iv: r1(p.invulnT), sn: r1(p.snuffT || 0),
        dead: p.alive === false ? 1 : 0, rs: r1(p.respawnT || 0), tp: p.tp };
    }),
    enemies: g.enemies.map(function(e){
      const o = { id: e.id, k: e.type, x: r(e.x), y: r(e.y), hp: r(e.hp), mh: e.maxHp, fl: r2(e.flash) };
      if(e.isBoss){ o.pt = e.pat; o.tx = r(e.tx); o.ty = r(e.ty); }
      return o;
    }),
    shots: g.shots.map(function(s){ return [r(s.x), r(s.y), r(s.vx), r(s.vy), s.r, s.kind === 'shard' ? 1 : 0, s.color]; }),
    vents: W.vents.map(function(v){ return [v.active ? 1 : 0, r(v.fuel), r1(v.refillT || 0)]; })
  };
  const sig = W.pickups.length + ':' + W.pickups.reduce(function(a, p){ return a + p.x * 3 + p.y; }, 0);
  if(sig !== this.pickupSig){
    this.pickupSig = sig;
    msg.pickups = W.pickups.map(function(p){ return [p.type, r(p.x), r(p.y), p.val, r1(p.t || 0)]; });
  }
  return msg;
};
// Runs on a timer (not the render loop) so a hidden tab still answers at ~1Hz.
Coop.prototype.netTick = function(){
  if(!this.active()) return;
  if(this.isHost){
    const now = performance.now();
    if(now - this.lastSnap < COOP_SNAP_MS - 5) return;
    this.lastSnap = now;
    this.net.broadcast(this.snapshot());
  } else {
    this.sendInput();
  }
};

// ---------- Guest ----------
Coop.prototype.sendInput = function(){
  const g = this.game, P = g.P, k = g.keys;
  if(!P) return;
  const live = g.state === 'playing' && this.hostState === 'playing' && P.alive !== false;
  const surge = live && (!!k.Space || this.surgeTap);
  this.surgeTap = false;
  this.net.send({ t: 'in', x: Math.round(P.x), y: Math.round(P.y), tp: P.tp,
    mx: live ? (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) : 0,
    my: live ? (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0) : 0,
    a: Math.round(P.aim * 100) / 100, f: live && P.flameOn ? 1 : 0, s: surge ? 1 : 0,
    dt: Math.round(P.dashT * 100) / 100 });
};
Coop.prototype.onMessage = function(msg, from){
  if(this.isHost){
    if(msg.t === 'in'){ msg.at = performance.now(); this.inputs[from] = msg; }
    return;
  }
  if(msg.t === 'start'){ this.beginGuestRun(); return; }
  if(msg.t === 'floor'){ this.onFloorMsg(msg); return; }
  if(!this.active()) return;
  const g = this.game;
  if(msg.t === 'state') this.applyState(msg);
  else if(msg.t === 'upg-open') g.showUpgrade(msg.ids);
  else if(msg.t === 'end'){ if(msg.kind === 'victory') g.victory(); else g.gameOver(); }
  else if(msg.t === 'title'){
    this.endRun();
    g.toTitle();
    this.uiStatus('Der Host ist zurück in der Lobby — warte auf den nächsten Start.');
  }
  else if(msg.t === 'say') g.toast(msg.msg || '');
};
Coop.prototype.beginGuestRun = function(){
  const g = this.game;
  this.isHost = false;
  g.coop = this;
  document.body.classList.add('coop-guest');
  g.stopInput();
  g.state = 'title'; g.world = null; g.P = null;
  g.floor = 0; g.score = 0; g.embers = 0; g.upgLevels = {}; g.t = 0;
  this.mates = new Map();
  this.enemyMap = new Map();
  this.hostState = 'playing';
  this.uiStatus('Der Host startet den Abstieg …');
};
Coop.prototype.applyStats = function(p, st){
  p.speed = st.speed; p.lightR = st.lightR; p.maxHp = st.maxHp; p.maxOil = st.maxOil;
  Object.assign(p.flame, st.flame); Object.assign(p.surge, st.surge); Object.assign(p.dash, st.dash);
};
Coop.prototype.newShell = function(id){
  const st = this.stats[id], info = this.net.players.find(function(p){ return p.id === id; }) || {};
  const m = { id: id, name: info.name || 'Keeper', color: info.color || '#8fd0ff',
    x: 0, y: 0, nx: 0, ny: 0, aim: 0, walk: 0, hp: 1, oil: 1, tp: 0, alive: true,
    flame: {}, surge: {}, dash: {} };
  this.applyStats(m, st || this.keeperStats(this.game.makePlayer()));
  return m;
};
Coop.prototype.onFloorMsg = function(msg){
  const g = this.game, self = this, myId = this.net.myId;
  if(!this.active()) this.beginGuestRun();
  g.runSeed = msg.seed >>> 0;
  g.floor = msg.floor - 1;
  g.upgLevels = msg.upg || {};
  this.stats = {};
  msg.keepers.forEach(function(k){ self.stats[k.id] = k; });
  this.mates = new Map();
  this.enemyMap = new Map();
  this.fresh = true;
  this.hostState = 'playing';
  g.nextFloor();
  msg.keepers.forEach(function(k){
    const p = k.id === myId ? g.P : self.newShell(k.id);
    self.applyStats(p, k);
    p.x = p.nx = k.x; p.y = p.ny = k.y; p.tp = k.tp;
    if(p !== g.P) self.mates.set(k.id, p);
  });
  g.cam = { x: g.P.x, y: g.P.y };
  if(g.world.boss) SFX.bossRoar();
  this.uiStatus('Floor ' + msg.floor + ' — gleiche Karte wie beim Host.');
};
Coop.prototype.applyState = function(s){
  const g = this.game;
  this.hostState = s.st;
  if(s.st !== 'playing' || !g.world || !g.P) return;
  const W = g.world, fresh = this.fresh;
  this.fresh = false;
  g.score = s.score; g.embers = s.embers; W.spawnsLeft = s.left;
  if(s.gate && !W.gateOpen && !fresh){
    SFX.gateOpen();
    g.toast('THE STAIR OPENS');
    g.burst(W.gate.x, W.gate.y, '#ffd98a', 1.6, 26, 6, 1);
    g.effect(W.gate.x, W.gate.y, '#ffd98a', 140);
  }
  W.gateOpen = !!s.gate;
  this.applyKeepers(s.keepers, fresh);
  this.applyEnemies(s.enemies, fresh);
  g.shots = s.shots.map(function(a){
    return { x: a[0], y: a[1], vx: a[2], vy: a[3], r: a[4], kind: a[5] ? 'shard' : 'orb', color: a[6], dead: false };
  });
  s.vents.forEach(function(a, i){
    const v = W.vents[i];
    if(v){ v.active = !!a[0]; v.fuel = a[1]; v.refillT = a[2]; }
  });
  if(s.pickups) this.applyPickups(s.pickups, fresh);
};
Coop.prototype.applyKeepers = function(list, fresh){
  const g = this.game, P = g.P, myId = this.net.myId, self = this, seen = {};
  list.forEach(function(k){
    if(k.id === myId){
      if(k.tp !== P.tp){ P.x = k.x; P.y = k.y; P.tp = k.tp; }
      else if(!fresh && k.hp < P.hp - 2){
        g.hurtT = 0.6; g.shake += 2.5; SFX.hurt();
        g.burst(P.x, P.y, '#ff4d6d', 1, 10, 4, 0.5);
      }
      P.hp = k.hp; P.oil = k.oil; P.surgeT = k.sg; P.surgeCdT = k.scd;
      P.invulnT = k.iv; P.snuffT = k.sn; P.alive = !k.dead; P.respawnT = k.rs;
      return;
    }
    seen[k.id] = true;
    let m = self.mates.get(k.id);
    if(!m){ m = self.newShell(k.id); self.mates.set(k.id, m); m.tp = -1; }
    if(k.tp !== m.tp){ m.x = k.x; m.y = k.y; }
    m.nx = k.x; m.ny = k.y; m.tp = k.tp;
    m.aim = k.a; m.walk = k.w; m.hp = k.hp; m.oil = k.oil; m.flameOn = !!k.f;
    m.surgeT = k.sg; m.invulnT = k.iv; m.snuffT = k.sn; m.alive = !k.dead; m.respawnT = k.rs;
  });
  this.mates.forEach(function(m, id){ if(!seen[id]) self.mates.delete(id); });
};
Coop.prototype.applyEnemies = function(list, fresh){
  const g = this.game, prev = this.enemyMap, next = new Map();
  list.forEach(function(se){
    let e = prev.get(se.id);
    if(!e){
      const d = ENEMY_DEFS[se.k] || ENEMY_DEFS.shade;
      e = { id: se.id, type: se.k, d: d, r: d.r, isBoss: !!d.boss, seed: (se.id * 2.399) % 10,
        x: se.x, y: se.y, pat: 'drift', tx: se.x, ty: se.y, kb: { x: 0, y: 0 }, dead: false };
      if(!fresh) g.spawnFx(e);
    }
    e.nx = se.x; e.ny = se.y; e.hp = se.hp; e.maxHp = se.mh; e.flash = se.fl;
    if(e.isBoss){ e.pat = se.pt; e.tx = se.tx; e.ty = se.ty; }
    next.set(se.id, e);
  });
  // The host only removes enemies when they die.
  if(!fresh) prev.forEach(function(e, id){ if(!next.has(id)) g.killFx(e); });
  this.enemyMap = next;
  g.enemies = Array.from(next.values());
};
Coop.prototype.applyPickups = function(list, fresh){
  const g = this.game, P = g.P, W = g.world;
  const next = list.map(function(a){ return { type: a[0], x: a[1], y: a[2], val: a[3], t: a[4] }; });
  if(!fresh){
    const keep = {};
    next.forEach(function(p){ keep[p.type + Math.round(p.x) + ',' + Math.round(p.y)] = true; });
    W.pickups.forEach(function(p){
      if(keep[p.type + Math.round(p.x) + ',' + Math.round(p.y)]) return;
      g.pickupFx(p);
      if(dist(P.x, P.y, p.x, p.y) > 60) return; // someone else took it
      if(p.type === 'ember') SFX.pick();
      else if(p.type === 'oil') SFX.oilPick();
      else SFX.wickPick();
    });
  }
  W.pickups = next;
};
// Every frame on guests: ease shells toward the latest snapshot, fly shots on.
Coop.prototype.smooth = function(dt){
  const g = this.game, k = 1 - Math.exp(-15 * dt);
  function ease(o){
    if(Math.abs(o.nx - o.x) + Math.abs(o.ny - o.y) > 250){ o.x = o.nx; o.y = o.ny; }
    else { o.x += (o.nx - o.x) * k; o.y += (o.ny - o.y) * k; }
  }
  this.mates.forEach(ease);
  g.enemies.forEach(function(e){ ease(e); e.flash = Math.max(0, e.flash - dt); });
  g.shots.forEach(function(s){ s.x += s.vx * dt; s.y += s.vy * dt; });
  const P = g.P;
  this.setBanner(this.hostState === 'pause' ? 'HOST PAUSED · THE DARK WAITS'
    : P.alive === false ? 'YOU ARE DOWN · BACK IN ' + Math.ceil(P.respawnT || 0) + 's' : '');
};
Coop.prototype.setBanner = function(text){
  if(text === this.banner) return;
  this.banner = text;
  const el = document.getElementById('coopBanner');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
};

// Surface script errors in the lobby box: players often test without a console.
window.addEventListener('error', function(e){
  const el = document.getElementById('coopStatus');
  if(el) el.textContent = 'JS-Fehler: ' + e.message + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno;
});
