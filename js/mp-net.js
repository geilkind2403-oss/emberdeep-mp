'use strict';
/* EMBERDEEP MP networking: GitHub Pages + PeerJS Cloud + WebRTC (P2P).
   Kein Server, keine Portfreigabe, kein VPN noetig.
   Protokoll (JSON):
   guest->host: {t:'hello', name}
   guest->host: {t:'input', k:{up,down,left,right,fire}, mx,my, seq}
   host->all:   {t:'lobby', players:[{id,name}], seed}
   host->all:   {t:'start', seed}
   host->all:   {t:'state', players, foods, enemies, time, alive}
   either:      {t:'bye'} */

var MP_PREFIX = 'emberdeep-mp-v1-';
var MP_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function mpMakeCode(){
  var s = '';
  for(var i=0;i<6;i++) s += MP_CODE_CHARS[(Math.random()*MP_CODE_CHARS.length)|0];
  return s;
}
function mpNormCode(s){
  return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
}

function MPNet(events){
  this.ev = events || {};
  this.peer = null;
  this.conns = {};   // peerId -> DataConnection (host only)
  this.conn = null;  // guest only: connection to host
  this.isHost = false;
  this.code = null;
  this.myId = null;
  this.myName = 'Wickkeeper';
  this.players = []; // [{id,name}]
  this.seed = (Math.random()*1e9)|0;
}
MPNet.prototype.emit = function(name, arg){
  if(this.ev[name]){ try{ this.ev[name](arg); }catch(e){ console.error(e); } }
};
MPNet.prototype.status = function(s){ this.emit('status', s); };

MPNet.prototype.destroy = function(){
  try{
    var self = this;
    Object.keys(this.conns).forEach(function(k){ try{ self.conns[k].close(); }catch(e){} });
    if(this.conn){ try{ this.conn.close(); }catch(e){} }
    if(this.peer){ try{ this.peer.destroy(); }catch(e){} }
  }catch(e){}
  this.peer=null; this.conns={}; this.conn=null;
};

MPNet.prototype.host = function(name){
  var self = this;
  this.destroy();
  this.myName = String(name||'Host').slice(0,16) || 'Host';
  this.isHost = true;
  this.code = mpMakeCode();
  this._openHost(this.code);
};
MPNet.prototype._openHost = function(code){
  var self = this;
  this.status('Erstelle Lobby ' + code + ' …');
  var peer = new Peer(MP_PREFIX + code, { debug: 0 });
  this.peer = peer;
  peer.on('open', function(id){
    self.myId = id;
    self.code = code;
    self.players = [{ id: id, name: self.myName }];
    self.status('Lobby offen. Code: ' + code + ' — teile den Invite-Link.');
    self.emit('lobby', { players: self.players, code: code, isHost: true });
    self.broadcastLobby();
  });
  peer.on('connection', function(c){ self._onHostConn(c); });
  peer.on('error', function(err){
    if(err && err.type === 'unavailable-id'){
      // Code belegt -> neuen wuerfeln
      self.code = mpMakeCode();
      try{ peer.destroy(); }catch(e){}
      self._openHost(self.code);
    } else {
      self.status('Netzfehler (Host): ' + ((err&&err.type)||err));
    }
  });
};

MPNet.prototype._onHostConn = function(c){
  var self = this;
  c.on('open', function(){
    self.conns[c.peer] = c;
    self.status('Spieler verbunden: ' + c.peer.slice(-4));
  });
  c.on('data', function(msg){
    if(!msg || !msg.t) return;
    if(msg.t === 'hello'){
      var name = String(msg.name||'Gast').slice(0,16);
      var exists = false;
      for(var i=0;i<self.players.length;i++) if(self.players[i].id===c.peer) exists=true;
      if(!exists) self.players.push({ id: c.peer, name: name });
      if(self.players.length > 8){
        try{ c.send({t:'bye', reason:'Lobby voll (8)'}); }catch(e){}
        try{ c.close(); }catch(e){}
        self.players = self.players.filter(function(p){ return p.id!==c.peer; });
        return;
      }
      self.broadcastLobby();
    } else if(msg.t === 'input'){
      self.emit('remoteInput', { id: c.peer, input: msg });
    } else if(msg.t === 'bye'){
      self.removePeer(c.peer);
    }
  });
  c.on('close', function(){ self.removePeer(c.peer); });
  c.on('error', function(){ self.removePeer(c.peer); });
};

MPNet.prototype.removePeer = function(pid){
  delete this.conns[pid];
  var before = this.players.length;
  this.players = this.players.filter(function(p){ return p.id!==pid; });
  if(this.players.length !== before){
    this.broadcastLobby();
    this.emit('peerLeft', pid);
  }
};

MPNet.prototype.broadcastLobby = function(){
  var msg = { t:'lobby', players: this.players, seed: this.seed, code: this.code };
  var self = this;
  Object.keys(this.conns).forEach(function(k){
    var c = self.conns[k];
    if(c && c.open){ try{ c.send(msg); }catch(e){} }
  });
  this.emit('lobby', { players: this.players, code: this.code, isHost: this.isHost });
};

MPNet.prototype.broadcast = function(msg){
  var self = this;
  Object.keys(this.conns).forEach(function(k){
    var c = self.conns[k];
    if(c && c.open){ try{ c.send(msg); }catch(e){} }
  });
};

MPNet.prototype.join = function(code, name){
  var self = this;
  code = mpNormCode(code);
  if(code.length !== 6){ this.status('Code muss 6 Zeichen haben.'); return; }
  this.destroy();
  this.myName = String(name||'Gast').slice(0,16) || 'Gast';
  this.isHost = false;
  this.code = code;
  this.status('Verbinde zu ' + code + ' …');
  var peer = new Peer({ debug: 0 });
  this.peer = peer;
  peer.on('open', function(id){
    self.myId = id;
    var c = peer.connect(MP_PREFIX + code, { reliable: true });
    self.conn = c;
    c.on('open', function(){
      self.status('Verbunden! Warte auf Host-Start.');
      try{ c.send({ t:'hello', name: self.myName }); }catch(e){}
    });
    c.on('data', function(msg){ self._onGuestData(msg); });
    c.on('close', function(){ self.status('Verbindung zum Host weg. Host offline?'); self.emit('hostLeft'); });
    c.on('error', function(){ self.status('Verbindung abgebrochen.'); });
  });
  peer.on('error', function(err){
    if(err && err.type === 'peer-unavailable'){
      self.status('Lobby ' + code + ' nicht gefunden. Code prüfen.');
    } else {
      self.status('Netzfehler (Join): ' + ((err&&err.type)||err));
    }
  });
};

MPNet.prototype._onGuestData = function(msg){
  if(!msg || !msg.t) return;
  if(msg.t === 'lobby'){
    this.players = msg.players || [];
    this.seed = msg.seed || this.seed;
    this.emit('lobby', { players: this.players, code: this.code, isHost: false });
  } else if(msg.t === 'start'){
    this.seed = msg.seed || this.seed;
    this.emit('start', { seed: this.seed });
  } else if(msg.t === 'state'){
    this.emit('state', msg);
  } else if(msg.t === 'bye'){
    this.status('Gekickt: ' + (msg.reason||'bye'));
  }
};

MPNet.prototype.sendInput = function(input){
  if(!this.isHost && this.conn && this.conn.open){
    try{ this.conn.send(input); }catch(e){}
  }
};
MPNet.prototype.sendStart = function(seed){
  if(this.isHost) this.broadcast({ t:'start', seed: seed });
};
