'use strict';
/* EMBERDEEP CO-OP: same dungeon, same floors, shared run, invite codes.
   The host simulates the world (enemies, damage, oil, pickups, vents). Guests
   move their own keeper locally, so walking has no network lag, and send
   position + input; the host answers with snapshots that guests smooth out.
   Team rules: score and embers are shared; vigor, oil, boons and power-ups are
   each keeper's own. A fallen keeper watches until the team slays the next
   boss, then returns without boons. The run ends when every keeper has fallen.
   Every extra keeper makes the shadows tougher and more numerous (teamScale).

   Game messages (transport messages live in mp-net.js):
   host->guest: start | floor {floor, seed, keepers} | stats {keepers} | state {st, ...} |
                upg-open {ids, secs} | end {kind} | title | say {msg}
   host->guest also: fx {x, y, c, r} (ability rings) | fx {k:'beam', x, y, x2, y2, c}
   guest->host: in {x, y, tp, mx, my, a, f, s, dt, e, r, q, cx, cy} | pick {id}
   Skill trees and skins travel with the lobby (mp-net.js); the host builds each
   guest's keeper from them and runs their attacks and ultimates. */
var COOP_SHOT_KINDS = ['orb', 'shard', 'fire', 'bolt'];
var COOP_ZONE_KINDS = ['flare', 'pool', 'mend', 'mote', 'meteor', 'sanct'];

var COOP_SNAP_MS = 66;      // ~15 snapshots per second
var COOP_INPUT_MS = 33;     // ~30 inputs per second
var COOP_INPUT_STALE = 500; // ms; older input counts as "let go"
var COOP_BOON_SECONDS = 30; // a boon is picked for whoever has not chosen by then

function Coop(game){
  const self = this;
  this.game = game;
  this.isHost = false;
  this.runSeed = 0;
  this.mates = new Map();     // host: id -> simulated keeper | guest: id -> render shell
  this.inputs = {};           // host: id -> latest input
  this.lastSnap = 0;
  this.pickupSig = '';        // host: pickups are only sent when they change
  this.boons = null;          // host: {pending: {keeperId: [boon ids]}, deadline}
  this.boonDeadline = 0;      // guest: when the host auto-picks for us
  this.hostState = 'playing'; // guest: what the host's game is doing
  this.enemyMap = new Map();  // guest: id -> enemy shell
  this.stats = {};            // guest: id -> keeper stats from the last floor message
  this.fresh = false;         // guest: next snapshot is the first of a floor (no fx)
  this.surgeTap = false;      // guest: remembers taps shorter than one input interval
  this.abilityTap = false;
  this.altTap = false;
  this.ultTap = false;
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
Coop.prototype.onClassChanged = function(){
  if(this.net.connected()) this.net.setClass(this.game.progInfo());
};
Coop.prototype.broadcastFx = function(x, y, color, r){
  this.net.broadcast({ t: 'fx', x: Math.round(x), y: Math.round(y), c: color, r: r });
};
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
    li.textContent = (CLASSES[p.cls] || CLASSES.keeper).icon + ' ' + p.name + (i === 0 ? ' (Host)' : '') + (p.id === net.myId ? ' · you' : '');
    li.title = (CLASSES[p.cls] || CLASSES.keeper).name;
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
  const n = info.players.length, scale = teamScale(n);
  const hard = n > 1 ? ' · Gegner ×' + scale.hp.toFixed(2) + ' Leben, ×' + scale.count.toFixed(1) + ' Anzahl' : ' · teile den Invite-Link';
  this.uiStatus((info.isHost ? 'Lobby offen (' + n + '/' + MP_MAX_PLAYERS + ')' : 'Verbunden (' + n + '/' + MP_MAX_PLAYERS + ') · warte auf den Host') + hard);
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
    withPeer(function(){ self.isHost = false; self.net.join(code, self.myName(), self.game.progInfo()); });
  }
  u.host.addEventListener('click', function(){
    withPeer(function(){ self.isHost = true; self.net.host(self.myName(), self.game.progInfo()); });
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
  window.addEventListener('keydown', function(e){
    if(e.code === 'Space') self.surgeTap = true;
    if(e.code === 'KeyE') self.abilityTap = true;
    if(e.code === 'KeyQ') self.ultTap = true;
  });
  this.game.canvas.addEventListener('mousedown', function(e){ if(e.button === 2) self.altTap = true; });
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
  this.boons = null;
  this.net.broadcast({ t: 'start' });
  return this.runSeed;
};
Coop.prototype.endRun = function(){
  if(this.game.coop === this) this.game.coop = null;
  this.mates = new Map();
  this.inputs = {};
  this.enemyMap = new Map();
  this.boons = null;
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
// Keeps one simulated keeper per guest in the lobby. Late joiners start fresh.
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
      m = g.makePlayer(p.cls, p.tree || {}, p.skin);
      m.id = p.id;
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
  if(!this.active()) return;
  this.say(m.name + ' has left the descent.');
  if(this.boons){ delete this.boons.pending[id]; this.checkBoonsDone(); }
  this.game.checkTeamWipe();
};
Coop.prototype.keeperStats = function(p){
  return { id: p.id, x: Math.round(p.x), y: Math.round(p.y), tp: p.tp, upg: p.upg, cls: p.cls, skin: p.skin,
    speed: p.speed, lightR: p.lightR, maxHp: p.maxHp, maxOil: p.maxOil,
    flame: { range: p.flame.range, half: p.flame.half },
    surge: { r: p.surge.r, cd: p.surge.cd },
    dash: { cd: p.dash.cd, dur: p.dash.dur, speed: p.dash.speed } };
};
Coop.prototype.floorMsg = function(){
  const g = this.game;
  return { t: 'floor', floor: g.floor, seed: g.runSeed >>> 0,
    keepers: g.allPlayers().map(this.keeperStats, this) };
};
Coop.prototype.onFloor = function(){
  this.pickupSig = '';
  this.lastSnap = 0;
  this.net.broadcast(this.floorMsg());
};
// Boons after a floor: every living keeper gets their own hand of three.
Coop.prototype.beginBoonRound = function(){
  const g = this.game, self = this;
  this.boons = { pending: {}, deadline: performance.now() + COOP_BOON_SECONDS * 1000 };
  g.allPlayers().forEach(function(p){
    if(p.alive === false) return;
    const ids = g.rollBoons(p).map(function(u){ return u.id; });
    if(!ids.length) return;
    self.boons.pending[p.id] = ids;
    if(p !== g.P) self.net.sendTo(p.id, { t: 'upg-open', ids: ids, secs: COOP_BOON_SECONDS });
  });
  if(!Object.keys(this.boons.pending).length){ this.boons = null; g.nextFloor(); return; }
  g.showUpgrade(this.boons.pending[g.P.id] || []);
};
Coop.prototype.pickBoon = function(id){
  if(this.isHost) this.resolvePick(this.game.P, id);
  else this.net.send({ t: 'pick', id: id });
};
Coop.prototype.resolvePick = function(p, id){
  const b = this.boons, offered = b && b.pending[p.id];
  if(!offered || offered.indexOf(id) < 0) return;
  delete b.pending[p.id];
  this.game.applyUpgrade(UPGRADES.find(function(u){ return u.id === id; }), p);
  this.checkBoonsDone();
};
Coop.prototype.checkBoonsDone = function(){
  if(!this.boons || Object.keys(this.boons.pending).length) return;
  this.boons = null;
  this.game.nextFloor();
};
Coop.prototype.keeperById = function(id){
  return id === this.game.P.id ? this.game.P : this.mates.get(id);
};
Coop.prototype.tickBoons = function(){
  const g = this.game, now = performance.now();
  if(g.state !== 'upgrade') return;
  if(this.isHost && this.boons){
    if(now > this.boons.deadline){
      const pending = this.boons.pending, self = this;
      Object.keys(pending).forEach(function(id){
        const p = self.keeperById(id);
        if(p) self.resolvePick(p, pick(pending[id]));
        else if(self.boons) delete self.boons.pending[id];
      });
      this.checkBoonsDone();
      return;
    }
    const left = Math.ceil((this.boons.deadline - now) / 1000), n = Object.keys(this.boons.pending).length;
    if(!g.boonChosen && this.boons.pending[g.P.id]) g.setBoonNote('Your boon is yours alone · auto-pick in ' + left + 's');
    else g.setBoonNote('Waiting for ' + n + ' keeper' + (n > 1 ? 's' : '') + ' · auto-pick in ' + left + 's');
  } else if(!this.isHost && this.boonDeadline && !g.boonChosen){
    g.setBoonNote('Your boon is yours alone · auto-pick in ' + Math.max(0, Math.ceil((this.boonDeadline - now) / 1000)) + 's');
  }
};
Coop.prototype.onStatsChanged = function(){
  this.net.broadcast({ t: 'stats', keepers: this.game.allPlayers().map(this.keeperStats, this) });
};
Coop.prototype.onEnd = function(kind){ this.net.broadcast({ t: 'end', kind: kind }); };
Coop.prototype.inputFor = function(m){
  const inp = this.inputs[m.id];
  if(!inp) return { mx: 0, my: 0, aim: m.aim, fire: false, surge: false, dashT: 0 };
  const live = performance.now() - inp.at < COOP_INPUT_STALE;
  // A position sent before the guest saw the latest teleport is stale.
  const placed = inp.tp === m.tp;
  return { mx: live ? inp.mx : 0, my: live ? inp.my : 0, aim: inp.a,
    fire: live && !!inp.f, surge: live && !!inp.s, dashT: live ? inp.dt : 0,
    ability: live && !!inp.e, alt: live && !!inp.r, ult: live && !!inp.q, tx: inp.cx, ty: inp.cy,
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
        f: p.flameOn ? 1 : 0, sg: r2(p.surgeT), scd: r1(p.surgeCdT), ecd: r1(p.eCdT || 0), iv: r1(p.invulnT), sn: r1(p.snuffT || 0),
        dead: p.alive === false ? 1 : 0, tp: p.tp, bf: roundBuffs(p.buffs), acd: r1(p.altCdT || 0), u: r(p.ult || 0) };
    }),
    enemies: g.enemies.map(function(e){
      const o = { id: e.id, k: e.type, x: r(e.x), y: r(e.y), hp: r(e.hp), mh: e.maxHp, fl: r2(e.flash) };
      if(e.isBoss){ o.pt = e.pat; o.tx = r(e.tx); o.ty = r(e.ty); }
      if(e.stunT > 0) o.st = 1;
      if(e.burnT > 0) o.bu = 1;
      return o;
    }),
    shots: g.shots.map(function(s){ return [r(s.x), r(s.y), r(s.vx), r(s.vy), s.r, COOP_SHOT_KINDS.indexOf(s.kind), s.color]; }),
    zones: g.zones.map(function(z){ return [r(z.x), r(z.y), z.r, r1(z.t), z.max, COOP_ZONE_KINDS.indexOf(z.kind)]; }),
    vents: W.vents.map(function(v){ return [v.active ? 1 : 0, r(v.fuel), r1(v.refillT || 0)]; })
  };
  const sig = W.pickups.length + ':' + W.pickups.reduce(function(a, p){ return a + p.x * 3 + p.y; }, 0);
  if(sig !== this.pickupSig){
    this.pickupSig = sig;
    msg.pickups = W.pickups.map(function(p){ return [p.id, p.type, r(p.x), r(p.y), p.val, r1(p.t || 0), p.kind]; });
  }
  return msg;
};
function roundBuffs(b){
  const out = {};
  for(const k in b) out[k] = Math.round(b[k] * 10) / 10;
  return out;
}
// Runs on a timer (not the render loop) so a hidden tab still answers at ~1Hz.
Coop.prototype.netTick = function(){
  if(!this.active()) return;
  this.tickBoons();
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
  const surge = live && (!!k.Space || this.surgeTap), ability = live && (!!k.KeyE || this.abilityTap);
  const alt = live && (!!g.mouse.alt || this.altTap), ult = live && (!!k.KeyQ || this.ultTap);
  this.surgeTap = this.abilityTap = this.altTap = this.ultTap = false;
  const o = g.cameraOrigin();
  this.net.send({ t: 'in', x: Math.round(P.x), y: Math.round(P.y), tp: P.tp,
    e: ability ? 1 : 0, r: alt ? 1 : 0, q: ult ? 1 : 0, cx: Math.round(g.mouse.x + o.x), cy: Math.round(g.mouse.y + o.y),
    mx: live ? (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) : 0,
    my: live ? (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0) : 0,
    a: Math.round(P.aim * 100) / 100, f: live && P.flameOn ? 1 : 0, s: surge ? 1 : 0,
    dt: Math.round(P.dashT * 100) / 100 });
};
Coop.prototype.onMessage = function(msg, from){
  if(this.isHost){
    if(msg.t === 'in'){ msg.at = performance.now(); this.inputs[from] = msg; }
    else if(msg.t === 'pick' && this.mates.has(from)) this.resolvePick(this.mates.get(from), msg.id);
    return;
  }
  if(msg.t === 'start'){ this.beginGuestRun(); return; }
  if(msg.t === 'floor'){ this.onFloorMsg(msg); return; }
  if(!this.active()) return;
  const g = this.game;
  if(msg.t === 'state') this.applyState(msg);
  else if(msg.t === 'upg-open'){
    this.boonDeadline = performance.now() + msg.secs * 1000;
    g.showUpgrade(msg.ids);
  }
  else if(msg.t === 'stats') this.applyKeeperStats(msg.keepers);
  else if(msg.t === 'end'){ if(msg.kind === 'victory') g.victory(); else g.gameOver(); }
  else if(msg.t === 'title'){
    this.endRun();
    g.toTitle();
    this.uiStatus('Der Host ist zurück in der Lobby — warte auf den nächsten Start.');
  }
  else if(msg.t === 'say') g.toast(msg.msg || '');
  else if(msg.t === 'fx' && msg.k === 'beam'){
    g.effects.push({ kind: 'beam', x: msg.x, y: msg.y, x2: msg.x2, y2: msg.y2, color: msg.c, life: 0.3, maxLife: 0.3 });
    if(g.P && dist(g.P.x, g.P.y, msg.x, msg.y) < 700) SFX.alt();
  }
  else if(msg.t === 'fx'){
    g.effect(msg.x, msg.y, msg.c, msg.r);
    g.burst(msg.x, msg.y, msg.c, 1.2, 18, 4, 0.7);
    if(g.P && dist(g.P.x, g.P.y, msg.x, msg.y) < 700) SFX.ability();
  }
};
Coop.prototype.beginGuestRun = function(){
  const g = this.game;
  g.bankXp(); // whatever the last run earned, before it is reset
  this.isHost = false;
  g.coop = this;
  document.body.classList.add('coop-guest');
  g.stopInput();
  g.state = 'title'; g.world = null; g.P = null;
  g.floor = 0; g.score = 0; g.embers = 0; g.t = 0;
  g.resetRunXp(true);
  this.mates = new Map();
  this.enemyMap = new Map();
  this.hostState = 'playing';
  this.uiStatus('Der Host startet den Abstieg …');
};
Coop.prototype.applyStats = function(p, st){
  p.upg = st.upg || {};
  p.cls = st.cls || 'keeper';
  p.skin = skinById(st.skin).id;
  p.speed = st.speed; p.lightR = st.lightR; p.maxHp = st.maxHp; p.maxOil = st.maxOil;
  Object.assign(p.flame, st.flame); Object.assign(p.surge, st.surge); Object.assign(p.dash, st.dash);
};
Coop.prototype.newShell = function(id){
  const st = this.stats[id], info = this.net.players.find(function(p){ return p.id === id; }) || {};
  const m = { id: id, name: info.name || 'Keeper', color: info.color || '#8fd0ff',
    x: 0, y: 0, nx: 0, ny: 0, aim: 0, walk: 0, hp: 1, oil: 1, tp: 0, alive: true,
    flame: {}, surge: {}, dash: {}, buffs: {} };
  this.applyStats(m, st || this.keeperStats(this.game.makePlayer()));
  return m;
};
Coop.prototype.onFloorMsg = function(msg){
  const g = this.game, self = this, myId = this.net.myId;
  if(!this.active()) this.beginGuestRun();
  g.runSeed = msg.seed >>> 0;
  g.floor = msg.floor - 1;
  this.boonDeadline = 0;
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
// Stats change on revival (boons are lost); positions come with the snapshots.
Coop.prototype.applyKeeperStats = function(list){
  const g = this.game, self = this;
  list.forEach(function(k){
    self.stats[k.id] = k;
    const p = k.id === self.net.myId ? g.P : self.mates.get(k.id);
    if(p) self.applyStats(p, k);
  });
};
Coop.prototype.applyState = function(s){
  const g = this.game;
  this.hostState = s.st;
  if(s.st !== 'playing' || !g.world || !g.P) return;
  const W = g.world, fresh = this.fresh;
  this.fresh = false;
  g.score = s.score; g.embers = s.embers; W.spawnsLeft = s.left;
  if(g.xpSync){ g.xpSync = false; g.xpBanked = g.runXp(); } // a late joiner earns from here on
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
    return { x: a[0], y: a[1], vx: a[2], vy: a[3], r: a[4], kind: COOP_SHOT_KINDS[a[5]] || 'orb', color: a[6], dead: false };
  });
  g.zones = (s.zones || []).map(function(a){
    return { kind: COOP_ZONE_KINDS[a[5]] || 'flare', x: a[0], y: a[1], r: a[2], t: a[3], max: a[4] };
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
      for(const b in k.bf){
        if(P.buffs[b] > 0 || fresh || !POWERUPS[b]) continue;
        SFX.power();
        g.toast(POWERUPS[b].name);
      }
      P.hp = k.hp; P.oil = k.oil; P.surgeT = k.sg; P.surgeCdT = k.scd;
      P.invulnT = k.iv; P.snuffT = k.sn; P.alive = !k.dead; P.buffs = k.bf; P.eCdT = k.ecd;
      P.altCdT = k.acd || 0; P.ult = k.u || 0;
      return;
    }
    seen[k.id] = true;
    let m = self.mates.get(k.id);
    if(!m){ m = self.newShell(k.id); self.mates.set(k.id, m); m.tp = -1; }
    if(k.tp !== m.tp){ m.x = k.x; m.y = k.y; }
    m.nx = k.x; m.ny = k.y; m.tp = k.tp;
    m.aim = k.a; m.walk = k.w; m.hp = k.hp; m.oil = k.oil; m.flameOn = !!k.f;
    m.surgeT = k.sg; m.invulnT = k.iv; m.snuffT = k.sn; m.alive = !k.dead; m.buffs = k.bf;
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
    e.stunT = se.st ? 1 : 0; e.burnT = se.bu ? 1 : 0;
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
  const next = list.map(function(a){ return { id: a[0], type: a[1], x: a[2], y: a[3], val: a[4], t: a[5], kind: a[6] }; });
  if(!fresh){
    const keep = {};
    next.forEach(function(p){ keep[p.id] = true; });
    W.pickups.forEach(function(p){
      if(keep[p.id]) return;
      g.pickupFx(p);
      if(dist(P.x, P.y, p.x, p.y) > 60) return; // someone else took it
      if(p.type === 'ember') SFX.pick();
      else if(p.type === 'oil') SFX.oilPick();
      else if(p.type === 'wick') SFX.wickPick();
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
};
Coop.prototype.refreshBanner = function(){
  const P = this.game.P;
  this.setBanner(!this.isHost && this.hostState === 'pause' ? 'HOST PAUSED · THE DARK WAITS'
    : P.alive === false ? 'YOU HAVE FALLEN · ' + this.reviveHint()
    : !this.isHost && this.hostState === 'upgrade' ? 'YOUR TEAM IS CHOOSING BOONS' : '');
};
Coop.prototype.reviveHint = function(){
  const g = this.game, boss = g.enemies.find(function(e){ return e.isBoss; });
  if(boss) return 'BACK WHEN ' + boss.d.name + ' FALLS';
  let n = g.floor + 1;
  while(!bossForFloor(n)) n++;
  return 'BACK AFTER THE BOSS OF FLOOR ' + n;
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
