'use strict';
/* EMBERDEEP CO-OP: gleiches Spiel, gleiche Floors, Invite-Codes.
   Host simuliert alles (P + Mates + Gegner), Gaeste senden Input
   und bekommen Snapshots. Team-Regeln:
   - Score/Ember geteilt, Upgrades waehlt der Host und gelten fuer alle
   - Mates respawnen nach 5s am Spawn; stirbt der Host, endet der Run */

var COOP_COLORS = ['#8fd0ff','#c48aff','#7dff9a','#ff8a7d','#ffe9a3','#ff6b9d','#7ddcff','#f5b349'];

function Coop(game){
  this.game = game;
  this.net = null;
  this.isHost = false;
  this.runSeed = 0;
  this.mates = new Map(); // host: id -> player obj | guest: id -> mate shell
  this.inputs = {};       // host: id -> last input
  this.lastSnap = 0;
  this.lastInput = 0;
  this.seq = 0;
  this.prev = { surge: false, dash: false };
}
Coop.prototype.say = function(msg){
  this.game.toast(msg);
  if(this.isHost && this.net) this.net.broadcast({ t: 'say', msg: msg });
};
Coop.prototype.myName = function(){
  const el = document.getElementById('coopName');
  return ((el && el.value) || 'Wickkeeper').slice(0, 16);
};
Coop.prototype.ensureNet = function(){
  if(this.net) return this.net;
  const self = this;
  this.net = new MPNet({
    status: function(s){ self.uiStatus(s); },
    lobby: function(info){ self.onLobby(info); },
    state: function(s){ if(!self.isHost) self.applyState(s); },
    start: function(s){ self.onStartMsg(s.seed); },
    remoteInput: function(r){ self.inputs[r.id] = r.input; },
    peerLeft: function(pid){
      delete self.inputs[pid];
      if(self.isHost && self.mates.has(pid)){
        self.mates.delete(pid);
        self.say('A keeper has left the descent.');
      }
    },
    hostLeft: function(){
      if(!self.isHost && self.game.coop){
        self.uiStatus('Host weg — erstelle eine neue Lobby oder joine neu.');
        self.game.coop = null;
      }
    }
  });
  // Gast-Nachrichten (floor / upg / end / say) kommen als 'state'-fremde Pakete:
  const origGuest = this.net._onGuestData.bind(this.net);
  this.net._onGuestData = function(msg){
    if(!msg || !msg.t) return;
    if(msg.t === 'floor') self.onFloorMsg(msg);
    else if(msg.t === 'upg-open') self.onUpgOpen(msg);
    else if(msg.t === 'upg-pick') self.onUpgPick(msg);
    else if(msg.t === 'end') self.onEndMsg(msg);
    else if(msg.t === 'say') self.game.toast(msg.msg || '');
    else origGuest(msg);
  };
  return this.net;
};

// ---------- Lobby UI ----------
Coop.prototype.ui = function(){
  const $ = function(id){ return document.getElementById(id); };
  return { invite: $('coopInvite'), players: $('coopPlayers'), status: $('coopStatus'),
    copy: $('btnCoopCopy'), start: $('btnCoopStart'), code: $('coopCode') };
};
Coop.prototype.uiStatus = function(s){
  const u = this.ui();
  if(u.status) u.status.textContent = s;
};
Coop.prototype.onLobby = function(info){
  const u = this.ui();
  const code = info.code || (this.net && this.net.code);
  if(u.invite) u.invite.textContent = code ? ('Invite: ' + location.href.split('?')[0] + '?room=' + code) : 'No lobby yet.';
  if(u.players){
    u.players.innerHTML = '';
    (info.players || []).forEach(function(p, i){
      const li = document.createElement('li');
      li.textContent = (p.name || ('P' + (i + 1))) + (i === 0 ? ' (Host)' : '');
      li.style.color = COOP_COLORS[i % COOP_COLORS.length];
      u.players.appendChild(li);
    });
  }
  if(u.copy) u.copy.disabled = !code;
  if(u.start) u.start.disabled = !(info.isHost && (info.players || []).length >= 1);
  if(info.isHost) this.syncMates();
  this.uiStatus(info.isHost
    ? ('Lobby ' + code + ' offen — schick den Invite-Link an deine Keeper.')
    : 'Verbunden. Warte auf Host-Start.');
};
Coop.prototype.wireUi = function(){
  const self = this;
  const $ = function(id){ return document.getElementById(id); };
  $('btnCoopHost').addEventListener('click', function(){
    self.isHost = true;
    self.ensureNet().host(self.myName());
  });
  $('btnCoopJoin').addEventListener('click', function(){
    const c = ($('coopCode').value || '').trim();
    if(c.length !== 6){ self.uiStatus('Code muss 6 Zeichen haben.'); return; }
    self.isHost = false;
    self.ensureNet().join(c, self.myName());
  });
  $('btnCoopCopy').addEventListener('click', function(){
    if(!self.net || !self.net.code) return;
    const url = location.href.split('?')[0] + '?room=' + self.net.code;
    function done(){ self.uiStatus('Invite-Link kopiert: ' + url); }
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function(){ prompt('Link kopieren:', url); });
    else prompt('Link kopieren:', url);
  });
  $('btnCoopStart').addEventListener('click', function(){ self.startAsHost(); });
  try{
    const m = /[?&]room=([A-Za-z0-9]{6})/i.exec(location.search);
    if(m){ $('coopCode').value = m[1].toUpperCase(); self.uiStatus('Code ' + m[1].toUpperCase() + ' erkannt — Name waehlen, Join.'); }
  }catch(e){}
};

// ---------- Start ----------
Coop.prototype.startAsHost = function(){
  if(!this.net || !this.net.isHost) return;
  this.isHost = true;
  this.runSeed = (Math.random() * 0x7fffffff) >>> 0;
  this.mates = new Map();
  this.inputs = {};
  this.game.coop = this;
  this.net.sendStart(this.runSeed);
  this.syncMates();
  if(this.game.P) this.game.P.name = this.myName();
  this.game.startRun();
  this.say('Co-op descent begins — ' + this.net.players.length + ' keepers.');
};
Coop.prototype.onStartMsg = function(seed){
  this.isHost = false;
  this.runSeed = seed >>> 0;
  this.mates = new Map();
  this.game.coop = this;
  if(this.game.P) this.game.P.name = this.myName();
  this.uiStatus('Host startet … warte auf Floor.');
};
Coop.prototype.syncMates = function(){
  if(!this.isHost || !this.net || !this.game.world) return;
  const self = this;
  const list = this.net.players || [];
  const seen = {};
  list.forEach(function(p, i){
    if(p.id === self.net.myId) return;
    seen[p.id] = true;
    if(!self.mates.has(p.id)){
      const m = self.game.makePlayer();
      m.id = p.id;
      m.name = String(p.name || 'Keeper').slice(0, 16);
      m.color = COOP_COLORS[i % COOP_COLORS.length];
      m.alive = true;
      self.mates.set(p.id, m);
    } else {
      self.mates.get(p.id).name = String(p.name || 'Keeper').slice(0, 16);
    }
  });
  Array.from(this.mates.keys()).forEach(function(id){
    if(!seen[id]){ self.mates.delete(id); delete self.inputs[id]; }
  });
};

// ---------- Host: Broadcasts ----------
Coop.prototype.onFloor = function(){
  this.syncMates();
  if(this.net) this.net.broadcast({ t: 'floor', floor: this.game.floor, runSeed: this.game.runSeed >>> 0 });
  this.tickForce();
};
Coop.prototype.onUpgradeOpen = function(ids){
  if(this.net) this.net.broadcast({ t: 'upg-open', ids: ids });
};
Coop.prototype.onUpgradePick = function(id){
  if(this.net) this.net.broadcast({ t: 'upg-pick', id: id });
};
Coop.prototype.onEnd = function(kind){
  if(this.net) this.net.broadcast({ t: 'end', kind: kind });
};
Coop.prototype.snapPlayer = function(p){
  return { id: p.id || 'host', name: p.name || 'Keeper', color: p.color || '#f5b349',
    x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, oil: p.oil, maxOil: p.maxOil,
    aim: p.aim, flameOn: !!p.flameOn, surgeT: p.surgeT || 0, walk: p.walk || 0,
    alive: p.alive !== false, respawnT: p.respawnT || 0, invulnT: p.invulnT || 0,
    lightR: p.lightR, surge: { r: (p.surge && p.surge.r) || 0 }, flame: { range: (p.flame && p.flame.range) || 0 } };
};
Coop.prototype.gather = function(){
  const g = this.game;
  const ps = [this.snapPlayer(Object.assign({ id: this.net.myId, name: this.myName() }, g.P))];
  this.mates.forEach(function(m){ ps.push(this.snapPlayer(m)); }, this);
  return { t: 'state', floor: g.floor, runSeed: g.runSeed >>> 0, time: g.t,
    state: g.state, score: g.score, embers: g.embers,
    gateOpen: !!(g.world && g.world.gateOpen), players: ps,
    enemies: g.enemies.map(function(e){
      return { type: e.type, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, r: e.r,
        flash: e.flash, seed: e.seed, pat: e.pat, patT: e.patT, tx: e.tx, ty: e.ty,
        isBoss: !!e.isBoss, dmg: e.dmg, speed: e.speed };
    }),
    shots: g.shots.map(function(s){ return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, r: s.r, dmg: s.dmg, life: s.life, color: s.color, kind: s.kind }; }),
    pickups: g.world.pickups.map(function(p){ return { type: p.type, x: p.x, y: p.y, val: p.val, t: p.t || 0 }; })
  };
};
Coop.prototype.tickForce = function(){ this.lastSnap = -10; };
Coop.prototype.tick = function(dt){
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  if(this.isHost){
    if(now - this.lastSnap > 1 / 12){
      this.lastSnap = now;
      if(this.net && this.game.state === 'playing') this.net.broadcast(this.gather());
      else if(this.net) this.net.broadcast({ t: 'state', floor: this.game.floor, runSeed: this.game.runSeed >>> 0, time: this.game.t, state: this.game.state, score: this.game.score, embers: this.game.embers, gateOpen: !!(this.game.world && this.game.world.gateOpen), players: [], enemies: [], shots: [], pickups: [] });
    }
  } else {
    if(now - this.lastInput > 1 / 20){
      this.lastInput = now;
      const g = this.game, k = g.keys || {};
      const surge = !!(k.Space), dash = !!(k.ShiftLeft || k.ShiftRight);
      const msg = { t: 'input', seq: (++this.seq),
        up: !!(k.KeyW), down: !!(k.KeyS), left: !!(k.KeyA), right: !!(k.KeyD),
        fire: !!(g.mouse && g.mouse.down), ang: g.P ? g.P.aim : 0,
        surge: surge && !this.prev.surge, dash: dash && !this.prev.dash };
      this.prev.surge = surge; this.prev.dash = dash;
      if(this.net) this.net.sendInput(msg);
    }
  }
};

// ---------- Guest: Apply ----------
Coop.prototype.onFloorMsg = function(msg){
  const g = this.game;
  g.runSeed = msg.runSeed >>> 0;
  this.runSeed = g.runSeed;
  g.floor = (msg.floor | 0) - 1;
  g.nextFloor();
  if(g.P) g.P.name = this.myName();
  this.uiStatus('Floor ' + msg.floor + ' — gleiche Karte wie beim Host.');
};
Coop.prototype.applyState = function(s){
  const g = this.game;
  if(typeof s.runSeed === 'number') g.runSeed = s.runSeed >>> 0;
  g.score = s.score || 0; g.embers = s.embers || 0; g.t = s.time || 0;
  if(s.floor && s.floor !== g.floor && g.world){
    // Floor-Desync (z.B. Spaet-Join): baue deterministisch nach
    g.floor = s.floor - 1;
    g.nextFloor();
  }
  if(!g.world) return;
  g.world.gateOpen = !!s.gateOpen;
  const myId = this.net.myId;
  (s.players || []).forEach(function(sp){
    if(sp.id === myId || (!sp.id && !myId)){
      if(g.P) Object.assign(g.P, { x: sp.x, y: sp.y, hp: sp.hp, maxHp: sp.maxHp, oil: sp.oil, maxOil: sp.maxOil, aim: sp.ang !== undefined ? sp.ang : sp.aim, flameOn: sp.flameOn, surgeT: sp.surgeT, walk: sp.walk, invulnT: sp.invulnT });
    } else {
      let m = this.mates.get(sp.id);
      if(!m){
        m = { id: sp.id, walk: 0, dashDir: { x: 1, y: 0 }, dash: { cd: 1.6, dur: 0.16, speed: 660 }, surge: { r: 230 }, flame: { range: 175 } };
        this.mates.set(sp.id, m);
      }
      Object.assign(m, sp);
    }
  }, this);
  g.enemies = (s.enemies || []).map(function(se){
    const d = ENEMY_DEFS[se.type] || ENEMY_DEFS.shade;
    return { type: se.type, d: d, x: se.x, y: se.y, hp: se.hp, maxHp: se.maxHp, r: se.r || d.r,
      flash: se.flash || 0, seed: se.seed || 0, pat: se.pat || 'drift', patT: se.patT || 0,
      tx: se.tx || 0, ty: se.ty || 0, dead: false, isBoss: !!se.isBoss, kb: { x: 0, y: 0 } };
  });
  g.shots = (s.shots || []).map(function(ss){
    return { x: ss.x, y: ss.y, vx: ss.vx, vy: ss.vy, r: ss.r, dmg: ss.dmg, life: ss.life, color: ss.color, kind: ss.kind, dead: false };
  });
  g.world.pickups = (s.pickups || []).map(function(sp){
    return { type: sp.type, x: sp.x, y: sp.y, val: sp.val, t: sp.t || 0, taken: false };
  });
  if(s.state && s.state !== g.state && (s.state === 'playing')){
    g.state = 'playing';
    g.showScreen(null);
  }
};
Coop.prototype.onUpgOpen = function(msg){
  this.uiStatus('Host waehlt ein Team-Upgrade …');
  this.game.toast('HOST CHOOSES A TEAM BOON');
};
Coop.prototype.onUpgPick = function(msg){
  const u = (typeof UPGRADES !== 'undefined' ? UPGRADES : []).find(function(x){ return x.id === msg.id; });
  if(!u) return;
  this.game.applyUpgrade(u);
  this.uiStatus('Team-Boon: ' + u.name);
};
Coop.prototype.onEndMsg = function(msg){
  if(msg.kind === 'victory') this.game.victory();
  else this.game.gameOver();
};

window.Coop = Coop;
document.addEventListener('DOMContentLoaded', function(){
  try{
    if(typeof game !== 'undefined' && game && !game.coopUi){
      game.coopUi = new Coop(game);
      game.coopUi.wireUi();
    }
  }catch(e){ console.error('coop init', e); }
});
