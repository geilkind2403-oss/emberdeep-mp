'use strict';
/* EMBERDEEP MP Arena: host-autoritativ, 2-8 Spieler, Invite-Codes.
   Host simuliert, Gaeste senden Input, empfangen State. */
(function(){
  var canvas = document.getElementById('mpCanvas');
  var ctx = canvas.getContext('2d');
  var elName = document.getElementById('mpName');
  var elJoinCode = document.getElementById('mpJoinCode');
  var elCode = document.getElementById('mpCode');
  var elPlayers = document.getElementById('mpPlayers');
  var elStatus = document.getElementById('mpStatus');
  var btnCreate = document.getElementById('btnCreate');
  var btnJoin = document.getElementById('btnJoin');
  var btnCopy = document.getElementById('btnCopy');
  var btnStart = document.getElementById('btnStart');

  var WORLD = { w: 1800, h: 1100 };
  var COLORS = ['#f5b349','#8fd0ff','#c48aff','#7dff9a','#ff8a7d','#ffe9a3','#ff6b9d','#7ddcff'];

  var net = null;
  var mode = 'lobby'; // lobby | playing
  var seed = 1;
  var rng = Math.random;

  var players = {};   // id -> {id,name,color,x,y,hp,maxHp,score,alive,respawnT,ang,flameCd,flash}
  var foods = [];     // {x,y}
  var enemies = [];   // {x,y,hp,maxHp,speed,r,seed}
  var remoteInputs = {}; // id -> last input (host only)
  var renderPos = {}; // id -> {rx,ry} (guest smoothing)
  var time = 0;
  var myId = null;
  var isHost = false;
  var spawnT = 0;
  var seq = 0;

  var keys = {};
  var mouse = { x: 0, y: 0, down: false };
  var cam = { x: WORLD.w/2, y: WORLD.h/2 };

  function mulberry32(a){
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function status(s){ elStatus.textContent = s; }
  function myName(){ return (elName.value || 'Wickkeeper').slice(0,16); }

  function ensureNet(){
    if(net) return net;
    net = new MPNet({
      status: status,
      lobby: function(info){
        myId = net.myId; isHost = info.isHost;
        syncLobbyUI(info);
      },
      state: function(s){ if(!isHost && mode==='playing') applyState(s); },
      start: function(s){ startGame(s.seed, false); },
      remoteInput: function(r){ remoteInputs[r.id] = r.input; },
      peerLeft: function(pid){ delete remoteInputs[pid]; },
      hostLeft: function(){ if(mode==='playing'){ mode='lobby'; status('Host weg — Lobby wartet. Erstelle eine neue oder joine neu.'); } }
    });
    return net;
  }

  function syncLobbyUI(info){
    var list = info.players || [];
    elCode.textContent = (info.code || '---').split('').join(' ');
    elPlayers.innerHTML = '';
    list.forEach(function(p, i){
      var li = document.createElement('li');
      li.textContent = (p.id === net.myId ? '● ' : '○ ') + p.name + (i===0 ? ' (Host)' : '');
      elPlayers.appendChild(li);
    });
    var canStart = info.isHost && list.length >= 1;
    btnStart.disabled = !canStart;
    btnCopy.disabled = !info.code;
    if(info.isHost) status('Lobby ' + info.code + ' offen — schick den Invite-Link an 1–7 Freunde.');
  }

  btnCreate.onclick = function(){
    ensureNet();
    net.host(myName());
    myId = null;
    setTimeout(function(){ myId = net.myId; }, 800);
  };
  btnJoin.onclick = function(){
    ensureNet();
    var c = elJoinCode.value;
    if(!c){ status('Bitte Invite-Code eingeben.'); return; }
    net.join(c, myName());
  };
  btnCopy.onclick = function(){
    if(!net || !net.code) return;
    var url = location.href.split('?')[0] + '?room=' + net.code;
    function done(){ status('Invite-Link kopiert: ' + url); }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done, function(){ prompt('Link kopieren:', url); });
    } else { prompt('Link kopieren:', url); }
  };
  btnStart.onclick = function(){
    if(!net || !net.isHost) return;
    seed = (Math.random()*1e9)|0;
    net.sendStart(seed);
    startGame(seed, true);
  };

  // ?room=CODE Auto-Fill
  (function(){
    try{
      var m = /[?&]room=([A-Za-z0-9]{6})/.exec(location.search);
      if(m){ elJoinCode.value = m[1].toUpperCase(); status('Code ' + m[1].toUpperCase() + ' erkannt — Name wählen, „Per Code joinen“.'); }
    }catch(e){}
  })();

  // ---- Input ----
  window.addEventListener('keydown', function(e){
    keys[e.code] = true;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(e.code)>=0) e.preventDefault();
  });
  window.addEventListener('keyup', function(e){ keys[e.code] = false; });
  canvas.addEventListener('mousemove', function(e){
    var r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', function(){ mouse.down = true; });
  window.addEventListener('mouseup', function(){ mouse.down = false; });

  function localInput(){
    var up = !!(keys.KeyW || keys.ArrowUp);
    var down = !!(keys.KeyS || keys.ArrowDown);
    var left = !!(keys.KeyA || keys.ArrowLeft);
    var right = !!(keys.KeyD || keys.ArrowRight);
    // Aim: Maus -> Welt via Kamera
    var scaleX = canvas.width / canvas.clientWidth;
    var scaleY = canvas.height / canvas.clientHeight;
    var mx = mouse.x * scaleX + (cam.x - canvas.width/2);
    var my = mouse.y * scaleY + (cam.y - canvas.height/2);
    var me = players[myId];
    var ang = me ? Math.atan2(my - me.y, mx - me.x) : 0;
    return { up:up, down:down, left:left, right:right, fire: !!mouse.down, ang: ang };
  }

  // ---- Game Setup ----
  function startGame(s, asHost){
    seed = s >>> 0 || 1;
    rng = mulberry32(seed);
    time = 0; spawnT = 0; enemies = []; foods = [];
    var list = (net && net.players && net.players.length) ? net.players : [{id: myId||'solo', name: myName()}];
    players = {}; renderPos = {};
    list.forEach(function(p, i){
      var id = p.id;
      players[id] = {
        id: id, name: String(p.name||('P'+(i+1))).slice(0,16),
        color: COLORS[i % COLORS.length],
        x: 300 + rng()*(WORLD.w-600), y: 300 + rng()*(WORLD.h-600),
        hp: 100, maxHp: 100, score: 0, alive: true, respawnT: 0, ang: 0, flameCd: 0, flash: 0
      };
      renderPos[id] = { rx: players[id].x, ry: players[id].y };
    });
    if(asHost && net){ myId = net.myId; }
    if(!myId && list[0]) myId = list[0].id;
    for(var i=0;i<70;i++) foods.push({ x: 60+rng()*(WORLD.w-120), y: 60+rng()*(WORLD.h-120) });
    mode = 'playing';
    status((asHost?'Host':'Gast') + ': Arena läuft — ' + Object.keys(players).length + ' Spieler.');
  }

  function applyState(s){
    time = s.time || 0;
    foods = s.foods || foods;
    enemies = s.enemies || enemies;
    (s.players||[]).forEach(function(sp){
      var p = players[sp.id];
      if(!p){
        players[sp.id] = sp;
        renderPos[sp.id] = { rx: sp.x, ry: sp.y };
      } else {
        p.x=sp.x; p.y=sp.y; p.hp=sp.hp; p.score=sp.score; p.alive=sp.alive; p.ang=sp.ang; p.name=sp.name;
      }
    });
  }

  function stateMsg(){
    var arr = Object.keys(players).map(function(k){ return players[k]; });
    return { t:'state', time: time, players: arr, foods: foods, enemies: enemies };
  }

  // ---- Host Simulation ----
  var lastBroadcast = 0, lastInputSend = 0, lastT = 0;
  function hostUpdate(dt){
    time += dt;
    var ids = Object.keys(players);
    // Inputs einsammeln (eigener Input direkt)
    var mine = localInput();
    if(myId && players[myId]) remoteInputs[myId] = { up:mine.up, down:mine.down, left:mine.left, right:mine.right, fire:mine.fire, ang:mine.ang };

    ids.forEach(function(id){
      var p = players[id];
      if(!p) return;
      if(p.flameCd>0) p.flameCd -= dt;
      if(p.flash>0) p.flash -= dt;
      if(!p.alive){
        p.respawnT -= dt;
        if(p.respawnT<=0){
          p.alive = true; p.hp = p.maxHp;
          p.x = 150+Math.random()*(WORLD.w-300); p.y = 150+Math.random()*(WORLD.h-300);
        }
        return;
      }
      var inp = remoteInputs[id] || {};
      var dx = ((inp.right?1:0)-(inp.left?1:0));
      var dy = ((inp.down?1:0)-(inp.up?1:0));
      if(dx&&dy){ dx*=0.7071; dy*=0.7071; }
      var sp = 300;
      p.x = Math.max(20, Math.min(WORLD.w-20, p.x + dx*sp*dt));
      p.y = Math.max(20, Math.min(WORLD.h-20, p.y + dy*sp*dt));
      if(typeof inp.ang === 'number') p.ang = inp.ang;
      // Flamme
      if(inp.fire && p.flameCd<=0){
        p.flameCd = 0.28; p.flash = 0.12;
        var range = 200, half = 0.5, dmg = 34;
        for(var i=enemies.length-1;i>=0;i--){
          var e = enemies[i];
          var d = Math.hypot(e.x-p.x, e.y-p.y);
          if(d < range + e.r){
            var a = Math.atan2(e.y-p.y, e.x-p.x);
            var diff = Math.atan2(Math.sin(a-p.ang), Math.cos(a-p.ang));
            if(Math.abs(diff) < half || d < 60){
              e.hp -= dmg;
              var kb = 260;
              e.x += Math.cos(a)*kb*dt*3; e.y += Math.sin(a)*kb*dt*3;
              if(e.hp<=0){ enemies.splice(i,1); p.score += 2; foods.push({x:e.x,y:e.y}); }
            }
          }
        }
      }
      // Futter
      for(var f=foods.length-1;f>=0;f--){
        var o = foods[f];
        if(Math.hypot(o.x-p.x, o.y-p.y) < 28){
          foods.splice(f,1);
          p.score += 1; p.hp = Math.min(p.maxHp, p.hp+4);
          foods.push({ x: 60+Math.random()*(WORLD.w-120), y: 60+Math.random()*(WORLD.h-120) });
          if(foods.length>90) foods.shift();
        }
      }
    });

    // Gegner spawnen
    spawnT -= dt;
    var aliveN = ids.filter(function(id){ return players[id].alive; }).length;
    var cap = Math.min(24, 5 + ids.length*2 + Math.floor(time/25));
    if(spawnT<=0 && enemies.length<cap && aliveN>0){
      spawnT = 1.1;
      var edge = (Math.random()*4)|0, ex=0, ey=0;
      if(edge===0){ ex=Math.random()*WORLD.w; ey=40; }
      else if(edge===1){ ex=WORLD.w-40; ey=Math.random()*WORLD.h; }
      else if(edge===2){ ex=Math.random()*WORLD.w; ey=WORLD.h-40; }
      else { ex=40; ey=Math.random()*WORLD.h; }
      var hp = 40 + time*1.2;
      enemies.push({ x:ex, y:ey, hp:hp, maxHp:hp, speed: 70+Math.min(90,time*0.8)+Math.random()*30, r: 14+Math.random()*8, seed: Math.random()*10 });
    }
    // Gegner bewegen + Kontakt
    enemies.forEach(function(e){
      var best=null, bd=1e9;
      ids.forEach(function(id){
        var p=players[id];
        if(!p.alive) return;
        var d=Math.hypot(p.x-e.x,p.y-e.y);
        if(d<bd){bd=d;best=p;}
      });
      if(best){
        var a=Math.atan2(best.y-e.y,best.x-e.x);
        var wob = Math.sin(time*3+e.seed)*0.4;
        e.x += Math.cos(a+wob)*e.speed*dt;
        e.y += Math.sin(a+wob)*e.speed*dt;
        e.x=Math.max(16,Math.min(WORLD.w-16,e.x)); e.y=Math.max(16,Math.min(WORLD.h-16,e.y));
        if(bd < e.r+16){
          best.hp -= 26*dt;
          best.x += Math.cos(a)*120*dt; best.y += Math.sin(a)*120*dt;
          if(best.hp<=0){
            best.alive=false; best.respawnT=3; best.score=Math.max(0,best.score-2);
            for(var k=0;k<2;k++) foods.push({x:best.x+(Math.random()-0.5)*60, y:best.y+(Math.random()-0.5)*60});
          }
        }
      }
    });

    // Broadcast 20 Hz
    if(time - lastBroadcast > 0.05){
      lastBroadcast = time;
      if(net) net.broadcast(stateMsg());
    }
  }

  // ---- Loop ----
  function frame(t){
    requestAnimationFrame(frame);
    if(mode!=='playing') return;
    if(!lastT) lastT = t;
    var dt = Math.min(0.05, (t-lastT)/1000 || 0.016);
    lastT = t;
    if(isHost){
      hostUpdate(dt);
    } else {
      // Input 20 Hz an Host
      var now = performance.now()/1000;
      if(now - lastInputSend > 0.05){
        lastInputSend = now;
        var inp = localInput();
        if(net) net.sendInput({ t:'input', up:inp.up, down:inp.down, left:inp.left, right:inp.right, fire:inp.fire, ang:inp.ang, seq: (++seq) });
      }
      time += dt;
      // Glättung
      Object.keys(players).forEach(function(id){
        var p=players[id], r=renderPos[id];
        if(!p||!r) return;
        var k = Math.min(1, 12*dt);
        r.rx += (p.x-r.rx)*k; r.ry += (p.y-r.ry)*k;
      });
    }
    // Kamera
    var me = players[myId] || players[Object.keys(players)[0]];
    if(me){
      var rp = renderPos[me.id] || {rx:me.x, ry:me.y};
      var tx = isHost ? me.x : rp.rx, ty = isHost ? me.y : rp.ry;
      cam.x += (tx-cam.x)*Math.min(1,8*dt);
      cam.y += (ty-cam.y)*Math.min(1,8*dt);
    }
    render(dt);
  }
  requestAnimationFrame(frame);

  // ---- Render ----
  function render(dt){
    ctx.fillStyle = '#0b101d';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    var ox = Math.max(0, Math.min(WORLD.w-canvas.width, cam.x-canvas.width/2));
    var oy = Math.max(0, Math.min(WORLD.h-canvas.height, cam.y-canvas.height/2));
    if(WORLD.w<canvas.width) ox = (WORLD.w-canvas.width)/2;
    if(WORLD.h<canvas.height) oy = (WORLD.h-canvas.height)/2;
    ctx.save();
    ctx.translate(-ox,-oy);

    // Grid
    ctx.strokeStyle = 'rgba(160,180,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for(var gx=0; gx<=WORLD.w; gx+=90){ ctx.moveTo(gx,0); ctx.lineTo(gx,WORLD.h); }
    for(var gy=0; gy<=WORLD.h; gy+=90){ ctx.moveTo(0,gy); ctx.lineTo(WORLD.w,gy); }
    ctx.stroke();
    ctx.strokeStyle = '#1c2540'; ctx.lineWidth = 8;
    ctx.strokeRect(4,4,WORLD.w-8,WORLD.h-8);

    // Foods
    foods.forEach(function(f){
      if(f.x<ox-20||f.x>ox+canvas.width+20||f.y<oy-20||f.y>oy+canvas.height+20) return;
      ctx.fillStyle = '#f5b349';
      ctx.save(); ctx.translate(f.x,f.y); ctx.rotate(Math.PI/4);
      ctx.fillRect(-5,-5,10,10);
      ctx.restore();
    });

    // Enemies
    enemies.forEach(function(e){
      if(e.x<ox-40||e.x>ox+canvas.width+40||e.y<oy-40||e.y>oy+canvas.height+40) return;
      var wob = 1+Math.sin(time*5+e.seed)*0.06;
      ctx.fillStyle = '#141b30';
      ctx.strokeStyle = 'rgba(140,160,220,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x,e.y,e.r*wob,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff5d7a';
      ctx.beginPath(); ctx.arc(e.x-4,e.y-2,3,0,Math.PI*2); ctx.arc(e.x+4,e.y-2,3,0,Math.PI*2); ctx.fill();
      // HP
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(e.x-16,e.y-e.r-10,32,4);
      ctx.fillStyle = '#ff5d7a'; ctx.fillRect(e.x-16,e.y-e.r-10,32*Math.max(0,e.hp/e.maxHp),4);
    });

    // Players
    Object.keys(players).forEach(function(id){
      var p = players[id];
      var r = renderPos[id] || {rx:p.x, ry:p.y};
      var px = isHost ? p.x : (id===myId ? r.rx : p.x);
      var py = isHost ? p.y : (id===myId ? r.ry : p.y);
      if(!p.alive){
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.font = '13px sans-serif'; ctx.textAlign='center';
        ctx.fillText(p.name+' respawnt…', p.x, p.y-24);
        return;
      }
      // Licht
      var g = ctx.createRadialGradient(px,py,0,px,py,150);
      g.addColorStop(0,'rgba(245,179,73,0.20)'); g.addColorStop(1,'rgba(245,179,73,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px,py,150,0,Math.PI*2); ctx.fill();
      // Flamme
      if(p.flash>0){
        ctx.save(); ctx.translate(px,py); ctx.rotate(p.ang);
        ctx.fillStyle = 'rgba(255,150,50,0.35)';
        ctx.beginPath(); ctx.moveTo(14,0); ctx.lineTo(200,90); ctx.lineTo(200,-90); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // Körper
      ctx.fillStyle = '#202a44';
      ctx.strokeStyle = p.color; ctx.lineWidth = (id===myId?3:2);
      ctx.beginPath(); ctx.arc(px,py,16,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(px+Math.cos(p.ang)*6, py+Math.sin(p.ang)*6, 5,0,Math.PI*2); ctx.fill();
      // Name + HP + Score
      ctx.fillStyle = '#efe8d2'; ctx.font = '13px sans-serif'; ctx.textAlign='center';
      ctx.fillText(p.name+' ◆'+p.score, px, py-26);
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(px-18,py+20,36,4);
      ctx.fillStyle = p.hp>30 ? '#7dff9a' : '#ff5d7a';
      ctx.fillRect(px-18,py+20,36*Math.max(0,p.hp/p.maxHp),4);
    });
    ctx.restore();

    // Scoreboard
    ctx.fillStyle = 'rgba(4,5,12,.65)'; ctx.fillRect(8,8,220,20+Object.keys(players).length*16);
    ctx.fillStyle = '#f5b349'; ctx.font = '12px monospace'; ctx.textAlign='left';
    ctx.fillText('ZEIT '+Math.floor(time)+'s', 14, 22);
    var y = 38;
    var sorted = Object.keys(players).map(function(k){return players[k];}).sort(function(a,b){return b.score-a.score;});
    sorted.forEach(function(p){
      ctx.fillStyle = p.color;
      ctx.fillText((p.id===myId?'> ':'')+p.name.slice(0,12)+' '+p.score, 14, y);
      y += 16;
    });
    if(mode==='playing' && Object.keys(players).length===0){
      ctx.fillStyle='#efe8d2'; ctx.textAlign='center';
      ctx.fillText('Warte auf Spieler…', canvas.width/2, 40);
    }
  }

  // Demo-Solo ohne Netz (zum Testen): Doppelklick startet lokal
  canvas.addEventListener('dblclick', function(){
    if(mode==='playing') return;
    isHost = true; myId = 'solo';
    net = net || { players: [{id:'solo', name: myName()}], broadcast:function(){}, sendStart:function(){} };
    net.players = [{id:'solo', name: myName()}];
    startGame((Math.random()*1e9)|0, true);
  });

  status('Bereit. Lobby erstellen oder Code eingeben. (Doppelklick auf Arena = Solo-Test)');
})();
