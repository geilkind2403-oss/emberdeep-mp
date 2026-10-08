'use strict';
/* EMBERDEEP co-op transport: GitHub Pages + PeerJS cloud signalling + WebRTC (P2P).
   No own server, no port forwarding, no VPN.
   The host's peer id is MP_PREFIX + 6-char invite code; guests connect to it.
   Transport messages (game messages live in mp-coop.js):
   guest->host: {t:'hello', name, v}   {t:'bye'}   {t:'ping'}
   host->guest: {t:'lobby', players:[{id,name,color}], code}   {t:'bye', reason}   {t:'ping'} */

var MP_PROTOCOL = 3;
var MP_PREFIX = 'emberdeep-mp-v' + MP_PROTOCOL + '-';
var MP_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var MP_MAX_PLAYERS = 8;
var MP_OPEN_TIMEOUT = 12000; // ms until "server/lobby not reachable"
var MP_SILENCE_LIMIT = 12000; // ms without any message before a peer counts as gone
var MP_COLORS = ['#f5b349','#8fd0ff','#c48aff','#7dff9a','#ff8a7d','#ffe9a3','#ff6b9d','#7ddcff'];
var MP_PEERJS_URLS = [
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
];

function mpMakeCode(){
  var s = '';
  for(var i=0;i<6;i++) s += MP_CODE_CHARS[(Math.random()*MP_CODE_CHARS.length)|0];
  return s;
}
function mpNormCode(s){
  return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
}
function mpCleanName(s, fallback){
  return String(s||'').trim().slice(0,16) || fallback;
}
function mpErr(err){
  return (err && (err.type || err.message)) || String(err);
}

// PeerJS is loaded on demand; if one CDN is blocked the next one is tried.
var mpPeerLib = { loading: false, waiting: [] };
function mpLoadPeer(cb){
  if(typeof Peer !== 'undefined'){ cb(null); return; }
  mpPeerLib.waiting.push(cb);
  if(mpPeerLib.loading) return;
  mpPeerLib.loading = true;
  var i = 0;
  function done(err){
    mpPeerLib.loading = false;
    mpPeerLib.waiting.splice(0).forEach(function(f){ f(err); });
  }
  (function next(){
    if(i >= MP_PEERJS_URLS.length){ done(new Error('PeerJS konnte nicht geladen werden (unpkg.com und cdn.jsdelivr.net blockiert? Adblock/Firewall prüfen).')); return; }
    var s = document.createElement('script');
    s.src = MP_PEERJS_URLS[i++];
    s.onload = function(){ if(typeof Peer !== 'undefined') done(null); else next(); };
    s.onerror = next;
    document.head.appendChild(s);
  })();
}

function MPNet(events){
  this.ev = events || {};
  this.peer = null;
  this.conns = {};    // host: peerId -> DataConnection
  this.lastSeen = {}; // host: peerId -> ms of last message
  this.conn = null;   // guest: connection to the host
  this.lastHostMsg = 0;
  this.isHost = false;
  this.code = null;
  this.myId = null;
  this.myName = 'Wickkeeper';
  this.players = [];  // [{id,name,color}], host first
  this.timer = null;
}
MPNet.prototype.emit = function(name){
  var fn = this.ev[name];
  if(!fn) return;
  try{ fn.apply(null, Array.prototype.slice.call(arguments, 1)); }catch(e){ console.error(e); }
};
MPNet.prototype.status = function(s){ this.emit('status', s); };
MPNet.prototype.connected = function(){
  return this.isHost ? !!this.myId : !!(this.conn && this.conn.open);
};

// Leaves the lobby (host: closes it for everyone). The goodbye gets a moment to flush.
MPNet.prototype.leave = function(){
  if(!this.peer) return;
  if(this.isHost) this.broadcast({ t: 'bye', reason: 'Der Host hat die Lobby geschlossen.' });
  else this.send({ t: 'bye' });
  var peer = this.peer;
  setTimeout(function(){ try{ peer.destroy(); }catch(e){} }, 200);
  clearInterval(this.timer);
  this.peer = null; this.conns = {}; this.lastSeen = {}; this.conn = null;
  this.myId = null; this.code = null; this.players = []; this.isHost = false;
};

MPNet.prototype._startHeartbeat = function(){
  var self = this;
  clearInterval(this.timer);
  this.timer = setInterval(function(){ self._heartbeat(); }, 1000);
};
MPNet.prototype._heartbeat = function(){
  var now = Date.now(), self = this;
  if(this.isHost){
    Object.keys(this.conns).forEach(function(id){
      if(now - (self.lastSeen[id] || now) > MP_SILENCE_LIMIT){
        try{ self.conns[id].close(); }catch(e){}
        self._dropPeer(id);
      }
    });
    this.broadcast({ t: 'ping' });
  } else if(this.conn && this.conn.open){
    this.send({ t: 'ping' });
    if(now - this.lastHostMsg > MP_SILENCE_LIMIT) this._lost('Der Host antwortet nicht mehr.');
  }
};

// ---------- Host ----------
MPNet.prototype.host = function(name){
  this.leave();
  this.isHost = true;
  this.myName = mpCleanName(name, 'Host');
  this._openHost(mpMakeCode());
};
MPNet.prototype._openHost = function(code){
  var self = this;
  this.code = code;
  this.status('Erstelle Lobby ' + code + ' …');
  var peer = new Peer(MP_PREFIX + code, { debug: 0 });
  this.peer = peer;
  setTimeout(function(){
    if(self.peer === peer && !self.myId) self.status('PeerServer antwortet nicht (0.peerjs.com). Adblock/VPN/Firewall prüfen und nochmal versuchen.');
  }, MP_OPEN_TIMEOUT);
  peer.on('open', function(id){
    if(self.peer !== peer) return;
    self.myId = id;
    self.players = [{ id: id, name: self.myName, color: MP_COLORS[0] }];
    self._startHeartbeat();
    self.broadcastLobby();
  });
  peer.on('connection', function(c){ if(self.peer === peer) self._onHostConn(c); });
  // Losing the signalling server only blocks new joins; reconnect quietly.
  peer.on('disconnected', function(){
    setTimeout(function(){ if(self.peer === peer && !peer.destroyed) peer.reconnect(); }, 1500);
  });
  peer.on('error', function(err){
    if(self.peer !== peer) return;
    if(err && err.type === 'unavailable-id'){
      // Code already taken -> roll a new one
      try{ peer.destroy(); }catch(e){}
      self._openHost(mpMakeCode());
    } else {
      self.status('Netzfehler (Host): ' + mpErr(err));
    }
  });
};

MPNet.prototype._onHostConn = function(c){
  var self = this;
  c.on('data', function(msg){
    if(!msg || !msg.t) return;
    self.lastSeen[c.peer] = Date.now();
    if(msg.t === 'hello') self._onHello(c, msg);
    else if(msg.t === 'bye'){ if(self.conns[c.peer] === c) self._dropPeer(c.peer); }
    else if(msg.t !== 'ping' && self.conns[c.peer] === c) self.emit('message', msg, c.peer);
  });
  c.on('close', function(){ if(self.conns[c.peer] === c) self._dropPeer(c.peer); });
  c.on('error', function(){ if(self.conns[c.peer] === c) self._dropPeer(c.peer); });
};
MPNet.prototype._onHello = function(c, msg){
  if(msg.v !== MP_PROTOCOL){ this._reject(c, 'Andere Spielversion als der Host — Seite neu laden (Strg+F5).'); return; }
  var known = this.players.some(function(p){ return p.id === c.peer; });
  if(!known && this.players.length >= MP_MAX_PLAYERS){ this._reject(c, 'Lobby voll (' + MP_MAX_PLAYERS + ').'); return; }
  this.conns[c.peer] = c;
  if(!known) this.players.push({ id: c.peer, name: mpCleanName(msg.name, 'Gast'), color: this._freeColor() });
  this.broadcastLobby();
  if(!known) this.emit('peerJoined', c.peer);
};
MPNet.prototype._reject = function(c, reason){
  try{ c.send({ t: 'bye', reason: reason }); }catch(e){}
  setTimeout(function(){ try{ c.close(); }catch(e){} }, 300);
};
MPNet.prototype._freeColor = function(){
  var used = this.players.map(function(p){ return p.color; });
  for(var i = 0; i < MP_COLORS.length; i++) if(used.indexOf(MP_COLORS[i]) < 0) return MP_COLORS[i];
  return MP_COLORS[this.players.length % MP_COLORS.length];
};
MPNet.prototype._dropPeer = function(pid){
  delete this.conns[pid];
  delete this.lastSeen[pid];
  var before = this.players.length;
  this.players = this.players.filter(function(p){ return p.id !== pid; });
  if(this.players.length !== before){
    this.broadcastLobby();
    this.emit('peerLeft', pid);
  }
};

MPNet.prototype.broadcastLobby = function(){
  this.broadcast({ t: 'lobby', players: this.players, code: this.code });
  this.emit('lobby', { players: this.players, code: this.code, isHost: true });
};
MPNet.prototype.broadcast = function(msg){
  var self = this;
  Object.keys(this.conns).forEach(function(k){ self.sendTo(k, msg); });
};
MPNet.prototype.sendTo = function(id, msg){
  var c = this.conns[id];
  if(c && c.open){ try{ c.send(msg); }catch(e){} }
};

// ---------- Guest ----------
MPNet.prototype.join = function(code, name){
  var self = this;
  code = mpNormCode(code);
  if(code.length !== 6){ this.status('Code muss 6 Zeichen haben.'); return; }
  this.leave();
  this.isHost = false;
  this.myName = mpCleanName(name, 'Gast');
  this.code = code;
  this.status('Verbinde zu ' + code + ' …');
  var peer = new Peer({ debug: 0 });
  this.peer = peer;
  setTimeout(function(){
    if(self.peer === peer && !self.connected()) self.status('Keine Verbindung zu Lobby ' + code + '. Code prüfen — der Host muss die Lobby offen haben.');
  }, MP_OPEN_TIMEOUT);
  peer.on('open', function(id){
    if(self.peer !== peer) return;
    self.myId = id;
    var c = peer.connect(MP_PREFIX + code, { reliable: true });
    self.conn = c;
    c.on('open', function(){
      if(self.conn !== c) return;
      self.lastHostMsg = Date.now();
      self.status('Verbunden — warte auf den Host.');
      c.send({ t: 'hello', name: self.myName, v: MP_PROTOCOL });
      self._startHeartbeat();
    });
    c.on('data', function(msg){ if(self.conn === c) self._onGuestData(msg); });
    c.on('close', function(){ if(self.conn === c) self._lost('Verbindung zum Host getrennt.'); });
    c.on('error', function(err){ if(self.conn === c) self._lost('Verbindung abgebrochen: ' + mpErr(err)); });
  });
  peer.on('error', function(err){
    if(self.peer !== peer) return;
    if(err && err.type === 'peer-unavailable') self._lost('Lobby ' + code + ' nicht gefunden. Code prüfen.');
    else if(!self.connected()) self.status('Netzfehler (Join): ' + mpErr(err));
  });
};
MPNet.prototype._onGuestData = function(msg){
  if(!msg || !msg.t) return;
  this.lastHostMsg = Date.now();
  if(msg.t === 'lobby'){
    this.players = msg.players || [];
    this.emit('lobby', { players: this.players, code: this.code, isHost: false });
  } else if(msg.t === 'bye'){
    this._lost(msg.reason || 'Vom Host getrennt.');
  } else if(msg.t !== 'ping'){
    this.emit('message', msg);
  }
};
// Guest lost the host: tear down and report once.
MPNet.prototype._lost = function(reason){
  this.leave();
  this.status(reason);
  this.emit('closed', reason);
};
MPNet.prototype.send = function(msg){
  if(!this.isHost && this.conn && this.conn.open){
    try{ this.conn.send(msg); }catch(e){}
  }
};

mpLoadPeer(function(){}); // warm up so the first click does not wait for the CDN
