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
    this.zones = []; // flare beacons and other lingering class effects
    this.particles = [];
    this.effects = [];
    this.trails = [];
    this.hurtT = 0;
    this.cls = 'keeper';
    try{ const c = localStorage.getItem('emberdeep_class'); if(CLASSES[c]) this.cls = c; }catch(e){}
    this._trailClock = 0;
    this._flameOn = false;
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.t = 0;
    this.score = 0;
    this.embers = 0;
    this.last = 0;
    this.resetRunXp();
    this.talkQueue = [];
    this.talkNow = null;
    this.initInput();
    this.initButtons();
    window.addEventListener('pagehide', () => this.bankXp());
  }

  // Boon levels belong to the local keeper (each co-op keeper has their own).
  get upgLevels(){ return (this.P && this.P.upg) || {}; }

  stopInput(){
    this.keys = {}; this.mouse.down = false; this.mouse.alt = false;
    if(this.P) this.P.flameOn = false;
    this._flameOn = false; SFX.flameOff();
  }
  pause(){
    if(this.state !== 'playing') return;
    // The false ending and the closing scene keep running; the pause waits for them.
    if(this.warden && (this.warden.s === WS.FAKE || this.warden.s === WS.RESOLVE)){ this._pauseQ = true; return; }
    this._pauseQ = false;
    this.state = 'pause';
    document.getElementById('pauseStats').textContent = 'FLOOR ' + this.floor + ' · SCORE ' + Math.round(this.score);
    this.showScreen('screen-pause');
  }
  resume(){ this._pauseQ = false; this.state = 'playing'; this.stopInput(); this.showScreen(null); }
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
    return (0.25 + 0.75 * Math.pow(frac, 0.5)) * (P.snuffT > 0 ? 0.45 : 1) * (P.buffs && P.buffs.dawn > 0 ? 1.8 : 1);
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

  // Boss speech in an Undertale-style box: typed letter by letter with a voice
  // blip, pausing at punctuation. o: {v voice Hz (0 = narrator), f face glyph,
  // m 'box'|'narr'|'bark'|'soul', sp letters per second, who, local}.
  // The host's lines are mirrored to guests.
  talk(text, o){
    if(!o || typeof o !== 'object') o = { v: o };
    if(!o.local && this.coop && this.coop.isHost){
      const msg = Object.assign({}, o);
      delete msg.local;
      this.coop.net.broadcast({ t: 'talk', s: text, o: msg });
    }
    if(o.sfx && SFX[o.sfx]) SFX[o.sfx]();
    if(o.m === 'bark'){ if(this.warden) this.warden.bark(text, o.who); return; }
    if(o.m === 'soul'){ this.soulLine(text); return; }
    // A guest only ever trails the host's dialogue: a new host line retires the old ones.
    if(o.host) this.dropHostTalk(0.25);
    this.talkQueue.push({ text: text, v: o.v === undefined ? 140 : o.v, f: o.f || '', m: o.m || 'box', sp: o.sp || 32, who: o.who || '', host: !!o.host });
  }
  // Retire mirrored host lines; the current one finishes within `grace` seconds.
  dropHostTalk(grace){
    this.talkQueue = this.talkQueue.filter(function(q){ return !q.host; });
    const T = this.talkNow;
    if(!T || !T.host) return;
    if(grace > 0 && T.toks){
      T.shown = T.toks.length;
      this.renderTalk(T);
      T.hold = Math.max(T.hold, 0.9 + T.n * 0.02 - grace);
      return;
    }
    this.talkNow = null;
    const el = document.getElementById('talk');
    if(el && !this.talkQueue.length) el.classList.add('hidden');
  }
  talking(){ return !!this.talkNow || this.talkQueue.length > 0; }
  // Enter or Z: show the whole line, then move on. In co-op only the host
  // skips, and the skip reaches everyone through the next line.
  skipTalk(){
    const T = this.talkNow;
    if(!T || T.m === 'bark' || this.isGuest()) return;
    if(T.shown < T.toks.length){ T.shown = T.toks.length; this.renderTalk(T); return; }
    this.talkNow = null;
    this.talkSkipped = true;
    if(!this.talkQueue.length) document.getElementById('talk').classList.add('hidden');
    if(this.coop && this.coop.isHost) this.coop.net.broadcast({ t: 'talk', clear: 1 });
  }
  clearTalk(){
    this.talkQueue = [];
    this.talkNow = null;
    const el = document.getElementById('talk');
    if(el) el.classList.add('hidden');
  }
  soulLine(text){
    const el = document.getElementById('soulLine');
    if(!el) return;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }
  updateTalk(dt){
    let T = this.talkNow;
    const box = document.getElementById('talk');
    if(!T){
      if(!this.talkQueue.length) return;
      T = this.talkNow = Object.assign(this.talkQueue.shift(), { shown: 0, wait: 0, hold: 0 });
      T.toks = talkTokens(T.text);
      T.n = T.toks.filter(function(k){ return k.ch; }).length;
      box.classList.remove('hidden');
      box.classList.toggle('talk--narr', T.m === 'narr');
      box.querySelector('.talk-face').textContent = T.f || '';
    }
    if(T.shown < T.toks.length){
      T.wait -= dt;
      while(T.wait <= 0 && T.shown < T.toks.length){
        const tok = T.toks[T.shown++];
        T.wait += talkCharDelay(tok, T.sp);
        if(!tok.ch || tok.ch === ' ' || tok.ch === '.') continue;
        if(T.who === 'T' && SFX.voiceT) SFX.voiceT();
        else if(T.v) SFX.voice(T.v);
        else if(T.shown % 2 && SFX.narrClick) SFX.narrClick();
      }
      this.renderTalk(T);
      return;
    }
    T.hold += dt;
    if(T.hold > 0.9 + T.n * 0.02){
      this.talkNow = null;
      if(!this.talkQueue.length) box.classList.add('hidden');
    }
  }
  renderTalk(T){
    const esc = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }, cls = { b: 'c-b', o: 'c-o', y: 'c-y', s: 'shake' };
    let html = '', open = '';
    for(let i = 0; i < T.shown; i++){
      const tok = T.toks[i];
      if(!tok.ch) continue;
      const c = cls[tok.cls] || '';
      if(c !== open){ if(open) html += '</span>'; if(c) html += '<span class="' + c + '">'; open = c; }
      const ch = esc[tok.ch] || tok.ch;
      html += c === 'shake' ? '<i style="animation-delay:-' + (i % 7) * 0.07 + 's">' + ch + '</i>' : ch;
    }
    if(open) html += '</span>';
    document.getElementById('talkText').innerHTML = html;
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
    ['KeyW','KeyA','KeyS','KeyD','KeyE','KeyQ','KeyZ','KeyR','KeyG','KeyF','Enter','Space','ShiftLeft','ShiftRight','KeyP','Escape'].forEach(function(code){ kmap[code] = true; });
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
      if((e.code === 'Enter' || e.code === 'KeyZ') && !e.repeat && this.state === 'playing') this.skipTalk();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if(e.button === 0) this.mouse.down = true;
      if(e.button === 2) this.mouse.alt = true;
    });
    window.addEventListener('mouseup', (e) => {
      if(e.button === 0) this.mouse.down = false;
      if(e.button === 2) this.mouse.alt = false;
    });
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
    $('btnStart').addEventListener('click', function(){ SFX.init(); SFX.start(); game.enterHub(); });
    $('btnShopBack').addEventListener('click', function(){ SFX.click(); game.backToHub(); });
    $('btnRetry').addEventListener('click', function(){ SFX.click(); game.startRun(); });
    $('btnOverTitle').addEventListener('click', function(){ SFX.click(); if(game.coop) game.toTitle(); else game.enterHub(); });
    $('btnEndless').addEventListener('click', function(){ SFX.click(); game.endless(); });
    $('btnVicTitle').addEventListener('click', function(){ SFX.click(); if(game.coop) game.toTitle(); else game.enterHub(); });
    $('btnResume').addEventListener('click', function(){ SFX.click(); game.resume(); });
    $('btnPauseRestart').addEventListener('click', function(){ SFX.click(); game.startRun(); });
    $('btnPauseTitle').addEventListener('click', function(){ SFX.click(); game.toTitle(); });
    $('btnClass').addEventListener('click', function(){ SFX.click(); game.showClassPicker(); });
    $('btnClassBack').addEventListener('click', function(){ SFX.click(); game.menuBack(); });
    $('btnTree').addEventListener('click', function(){ SFX.click(); game.showTree(); });
    $('btnFakeOn').addEventListener('click', function(){ this.textContent = 'THERE IS NOWHERE LEFT TO DESCEND'; SFX.snuff(); });
    $('btnTreeBack').addEventListener('click', function(){ SFX.click(); game.menuBack(); });
    $('btnTreeReset').addEventListener('click', function(){
      SFX.click();
      Progress.reset(game.cls);
      game.progressChanged();
      game.showTree();
    });
    this.updateClassButton();
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
    const ids = ['screen-title','screen-class','screen-tree','screen-upgrade','screen-over','screen-victory','screen-pause','screen-shop'];
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

  // ---- Keeper classes ----
  showClassPicker(){
    const game = this, wrap = document.getElementById('classCards');
    wrap.innerHTML = '';
    CLASS_IDS.forEach(function(id, i){
      const C = CLASSES[id], card = document.createElement('button');
      card.type = 'button';
      card.className = 'card class-card' + (id === game.cls ? ' chosen' : '');
      const icon = document.createElement('div');
      icon.className = 'boon-icon'; icon.textContent = C.icon; icon.setAttribute('aria-hidden', 'true');
      const number = document.createElement('span');
      number.className = 'boon-index'; number.textContent = '0' + (i + 1);
      const h3 = document.createElement('h3'); h3.textContent = C.name;
      const flav = document.createElement('div'); flav.className = 'flav'; flav.textContent = C.role + ' · LV ' + Progress.level(id);
      const ab = document.createElement('div'); ab.className = 'desc';
      ab.textContent = 'E · ' + C.ability.name + ' — ' + C.ability.desc + ' (' + C.ability.cd + 's)';
      const pas = document.createElement('div'); pas.className = 'desc class-passive'; pas.textContent = C.passive;
      [icon, number, h3, flav, ab, pas].forEach(function(el){ card.appendChild(el); });
      card.addEventListener('click', function(){
        SFX.click();
        game.setClass(id);
        game.menuBack();
      });
      wrap.appendChild(card);
    });
    this.showScreen('screen-class');
  }
  setClass(id){
    if(!CLASSES[id]) return;
    this.cls = id;
    try{ localStorage.setItem('emberdeep_class', id); }catch(e){}
    this.progressChanged();
  }
  // Class, tree or skin changed: refresh the title and tell the lobby.
  progressChanged(){
    this.updateClassButton();
    if(this.lobby) this.lobby.onClassChanged(this.cls);
  }
  progInfo(){
    const c = Progress.of(this.cls);
    return { cls: this.cls, tree: c.tree, skin: c.skin };
  }
  updateClassButton(){
    const C = CLASSES[this.cls], pts = Progress.points(this.cls);
    document.getElementById('btnClass').textContent = C.icon + '  ' + C.name + ' · LV ' + Progress.level(this.cls) + ' · E ' + C.ability.name + ' — CHANGE';
    document.getElementById('btnTree').textContent = '✦  SKILL TREE' + (pts > 0 ? ' · ' + pts + ' POINT' + (pts > 1 ? 'S' : '') + ' TO SPEND' : '');
    document.getElementById('btnTree').classList.toggle('has-points', pts > 0);
  }

  // ---- Skill tree ----
  showTree(){
    const game = this, cls = this.cls, C = CLASSES[cls], T = SKILL_TREES[cls], prog = Progress.of(cls);
    const info = Progress.info(cls), pts = Progress.points(cls);
    const el = function(tag, cn, text){
      const e = document.createElement(tag);
      if(cn) e.className = cn;
      if(text !== undefined) e.textContent = text;
      return e;
    };
    const tabs = document.getElementById('treeTabs');
    tabs.innerHTML = '';
    CLASS_IDS.forEach(function(id){
      const b = el('button', 'tree-tab' + (id === cls ? ' on' : ''), CLASSES[id].icon + ' ' + CLASSES[id].name + ' · ' + Progress.level(id));
      b.type = 'button';
      if(Progress.points(id) > 0) b.classList.add('has-points');
      b.addEventListener('click', function(){ SFX.click(); game.setClass(id); game.showTree(); });
      tabs.appendChild(b);
    });
    document.getElementById('treeTitle').textContent = C.icon + ' ' + C.name + ' · LEVEL ' + info.level;
    document.getElementById('treeXpFill').style.width = (info.need ? clamp(info.into / info.need, 0, 1) * 100 : 100) + '%';
    document.getElementById('treeXpText').textContent = info.need
      ? Math.floor(info.into) + ' / ' + info.need + ' XP TO LEVEL ' + (info.level + 1)
      : 'MAX LEVEL';
    document.getElementById('treePoints').textContent = pts > 0 ? pts + ' POINT' + (pts > 1 ? 'S' : '') + ' TO SPEND' : 'NO POINTS LEFT · PLAY TO LEVEL UP';
    const cols = document.getElementById('treeCols');
    cols.innerHTML = '';
    TREE_BRANCHES.forEach(function(b){
      const col = el('div', 'tree-col');
      const head = el('div', 'tree-head');
      head.appendChild(el('span', '', b.name));
      head.appendChild(el('kbd', '', b.key));
      col.appendChild(head);
      b.slots.forEach(function(slot, i){
        const N = T.nodes[slot], rank = prog.tree[slot] || 0, max = SLOT_MAX[slot];
        const open = i === 0 || (prog.tree[b.slots[i - 1]] || 0) > 0;
        const can = Progress.canRank(cls, slot);
        const node = el('button', 'tree-node' + (rank >= max ? ' maxed' : '') + (!open ? ' locked' : '') + (can ? ' can' : '') + (slot === 'a1' || slot === 'c2' ? ' unlock' : ''));
        node.type = 'button';
        node.dataset.slot = slot;
        node.disabled = !can;
        const top = el('div', 'tree-node-top');
        top.appendChild(el('b', '', N.name));
        const pips = el('span', 'pips');
        for(let r = 0; r < max; r++){
          const dot = el('i');
          if(r < rank) dot.classList.add('on');
          pips.appendChild(dot);
        }
        top.appendChild(pips);
        node.appendChild(top);
        node.appendChild(el('div', 'tree-desc', N.desc));
        node.addEventListener('click', function(){
          if(!Progress.rankUp(cls, slot)) return;
          SFX.upgrade();
          game.progressChanged();
          game.showTree();
          const again = document.querySelector('.tree-node[data-slot="' + slot + '"]');
          if(again) again.focus({preventScroll:true});
        });
        col.appendChild(node);
      });
      cols.appendChild(col);
    });
    const skins = document.getElementById('treeSkins');
    skins.innerHTML = '';
    SKINS.forEach(function(S){
      const unlocked = Progress.skinUnlocked(cls, S.id);
      const b = el('button', 'skin' + (prog.skin === S.id ? ' on' : '') + (unlocked ? '' : ' locked'));
      b.type = 'button';
      b.disabled = !unlocked;
      const sw = el('i', 'swatch');
      sw.style.background = 'linear-gradient(135deg,' + S.cloak[0] + ',' + S.cloak[1] + ' 55%,' + S.fire.mid + ')';
      b.appendChild(sw);
      b.appendChild(el('span', '', unlocked ? S.name : S.flag ? '???' : 'LV ' + S.lvl));
      b.title = unlocked ? S.name : S.flag ? 'Found at the bottom of the deep.' : S.name + ' · unlocks at level ' + S.lvl;
      b.addEventListener('click', function(){
        if(!Progress.setSkin(cls, S.id)) return;
        SFX.click();
        game.progressChanged();
        game.showTree();
      });
      skins.appendChild(b);
    });
    const reset = document.getElementById('btnTreeReset');
    reset.disabled = treeSpent(prog.tree) === 0;
    if(document.getElementById('screen-tree').classList.contains('hidden')) this.showScreen('screen-tree');
  }

  // ---- Run XP: banked into the played class at every floor and run end ----
  resetRunXp(sync){
    this.floorsCleared = 0;
    this.xpBonus = 0;
    this.xpBanked = 0;
    this.xpGained = 0;
    this.embersBanked = 0;
    this.runCls = this.cls;
    this.runLevelFrom = Progress.level(this.cls);
    this.xpSync = !!sync; // co-op guest: the first snapshot sets the baseline
  }
  runXp(){ return Math.round(this.score) + XP_PER_FLOOR * this.floorsCleared + this.xpBonus; }
  bankXp(){
    if(this.xpSync || !this.runCls) return;
    const eg = Math.round(this.embers) - (this.embersBanked || 0);
    if(eg > 0){ this.embersBanked = (this.embersBanked || 0) + eg; Progress.addEmbers(eg); }
    const gain = this.runXp() - this.xpBanked;
    if(gain <= 0) return;
    this.xpBanked += gain;
    this.xpGained += gain;
    const r = Progress.addXp(this.runCls, gain);
    if(r.to <= r.from) return null;
    const skin = SKINS.filter(function(S){ return S.lvl > r.from && S.lvl <= r.to; }).pop();
    const msg = CLASSES[r.cls].name + ' · LEVEL ' + r.to + (skin ? ' · ' + skin.name + ' SKIN' : '');
    SFX.win();
    this.toast(msg);
    this.updateClassButton();
    return msg;
  }
  xpRows(){
    const lv = Progress.level(this.runCls), C = CLASSES[this.runCls];
    return [['XP', '+' + this.xpGained], [C.name, 'LV ' + lv + (lv > this.runLevelFrom ? '  ▲ ' + (lv - this.runLevelFrom) : '')]];
  }

  startRun(){
    if(this.isGuest()) return; // the host drives co-op runs
    this.bankXp();
    this.stopInput(); this.P = null; this.t = 0; this.shake = 0;
    this.floor = 0;
    this.score = 0;
    this.embers = 0;
    this.resetRunXp();
    this.runKills = 0;
    this.wardenEnding = null;
    this._pauseQ = false;
    this.runSeed = this.coop ? this.coop.onRunStart() : (Date.now() >>> 0);
    this.nextFloor();
  }

  // `tree` and `skin` default to the local profile; co-op mates bring their own.
  makePlayer(cls, tree, skin, gear){
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
    const C = CLASSES[cls] || CLASSES.keeper;
    P.cls = CLASSES[cls] ? cls : 'keeper';
    P.hp = P.maxHp = C.hp;
    P.speed *= C.speed;
    P.lightR += C.light;
    P.flame.dps *= C.flameDps;
    P.flame.range += C.flameRange;
    P.dash.cd = Math.max(0.6, P.dash.cd + C.dashCd);
    P.eCdT = 0;
    P.gear = sanitizeGear(gear !== undefined ? gear : (Progress.of(P.cls), Progress.data.gear));
    P.maxHp += 15 * P.gear.heart; P.maxOil += 15 * P.gear.flask;
    P.bowCdT = P.bombCdT = 0;
    const own = Progress.of(P.cls);
    P.sk = sanitizeTree(P.cls, tree !== undefined ? tree : own.tree);
    P.skin = skinById(skin !== undefined ? skin : own.skin).id;
    this.applySkills(P);
    return P;
  }
  // Skill tree effects that are plain numbers; behaviours read P.sk directly.
  applySkills(P){
    const r = function(slot){ return P.sk[slot] || 0; }, c1 = r('c1');
    if(P.cls === 'keeper'){ P.maxHp += 10 * c1; P.maxOil += 10 * c1; }
    else if(P.cls === 'pyro') P.flame.dps *= 1 + 0.08 * c1;
    else if(P.cls === 'guardian') P.maxHp += 20 * c1;
    else if(P.cls === 'nightblade'){ P.speed *= 1 + 0.05 * c1; P.dash.cd = Math.max(0.5, P.dash.cd - 0.1 * c1); }
    else if(P.cls === 'lightbinder'){ P.lightR += 15 * c1; P.maxOil += 8 * c1; }
    P.hp = P.maxHp; P.oil = P.maxOil;
    P.eCd = CLASSES[P.cls].ability.cd * (1 - 0.1 * r('b1'));
    P.ePow = 1 + 0.2 * r('b1');
    const A = SKILL_TREES[P.cls].alt;
    P.alt = r('a1') > 0 ? A : null;
    P.altCd = A.cd * (1 - 0.08 * r('a2'));
    P.altPow = 1 + 0.2 * r('a2');
    P.altCdT = 0;
    P.ultOn = r('c2') > 0;
    P.ultPow = 1 + 0.25 * r('c3');
    P.ultRate = 1 + 0.15 * r('c3');
    P.ult = 0;
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
    if(this.world && this.world.hub){
      p.hp = p.maxHp; p.x = HUB.spawn.x; p.y = HUB.spawn.y; p.tp = (p.tp || 0) + 1; p.invulnT = 2;
      this.toast('THE VILLAGE CARRIES YOU HOME');
      return;
    }
    if(this.warden && this.warden.brain && this.warden.brain.onKeeperDown(p)) return;
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
    if(this.state !== 'playing' || this.allPlayers().some(function(k){ return k.alive !== false; })) return;
    if(this.warden && this.warden.brain && this.warden.brain.onTeamWipe()) return;
    this.gameOver();
  }
  // A slain boss brings fallen keepers back next to `at` with full vigor and oil;
  // the fall costs them two random boon levels.
  reviveFallen(at){
    const fallen = this.allPlayers().filter(function(p){ return p.alive === false; });
    fallen.forEach((p, i) => {
      const levels = [], lost = [];
      for(const id in p.upg) for(let n = 0; n < p.upg[id]; n++) levels.push(id);
      for(let n = 0; n < 2 && levels.length; n++) lost.push(levels.splice((Math.random() * levels.length) | 0, 1)[0]);
      const fresh = this.makePlayer(p.cls, p.sk, p.skin, p.gear);
      ['id', 'name', 'color', 'tp'].forEach(function(k){ fresh[k] = p[k]; });
      Object.assign(p, fresh);
      levels.forEach(id => this.applyUpgrade(UPGRADES.find(function(u){ return u.id === id; }), p, true));
      p.hp = p.maxHp; p.oil = p.maxOil;
      p.walk = 0; p.snuffT = 0; p.invulnT = 2;
      const a = i / fallen.length * TAU;
      p.x = at.x + Math.cos(a) * 45; p.y = at.y + Math.sin(a) * 45;
      this.constrainKeeper(p);
      p.tp++;
      this.burst(p.x, p.y, '#ffd98a', 1.4, 20, 5, 0.9);
      this.effect(p.x, p.y, '#ffd98a', 110);
      const names = lost.map(function(id){ return UPGRADES.find(function(u){ return u.id === id; }).name.toUpperCase(); });
      this.coop.say((p.name || 'Keeper') + ' returns' + (names.length ? ' · lost ' + names.join(' & ') : ''));
    });
    if(fallen.length) this.coop.onStatsChanged();
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
    if(W.arena) arenaClamp(W, p, 13);
    const passes = W.arena ? 2 : 1;
    for(let pass = 0; pass < passes; pass++){
      for(let i = 0; i < W.obstacles.length; i++){
        const hit = resolveCircleRect(p.x, p.y, 13, W.obstacles[i]);
        if(hit){ p.x += hit.dx; p.y += hit.dy; }
      }
      // The Ward is the bullet box: nobody leaves it while it stands.
      const V = this.warden, br = V ? V.boxR() : Infinity;
      if(br < 2000){
        const C = WARDEN.C, dx = p.x - C.x, dy = p.y - C.y, d = Math.hypot(dx, dy) || 1, lim = br - 13;
        if(d > lim){ p.x = C.x + dx / d * lim; p.y = C.y + dy / d * lim; }
      }
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
      m.moving = !!(inp.mx || inp.my) || inp.dashT > 0;
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
    const locked = this.warden && this.warden.locksActions();
    if(live) this.moveKeeper(P, inp, dt);
    P.flameOn = live && !locked && inp.fire && P.oil > 0;
    this.flameSound(P.flameOn);
    if(P.flameOn) this.emitFlame(P, dt);
    if(this.warden){
      if(live && !locked && inp.surge && !this._surgeHeld && P.surgeCdT <= 0 && P.oil > 0) this.warden.clearAt(P.x, P.y, P.surge.r * 0.6, true);
      this._surgeHeld = inp.surge;
      this.warden.update(dt);
    }
    coop.smooth(dt);
    coop.refreshBanner();
    this.fuelStatus = this.fuelPrompt(P);
    this.updateFx(dt);
  }
  applyUpgrade(u, p, quiet){
    p = p || this.P;
    p.upg[u.id] = (p.upg[u.id] || 0) + 1;
    u.apply(p);
    if(p === this.P && !quiet) this.toast(u.name.toUpperCase());
  }
  nextFloor(){
    const guest = this.isGuest();
    let levelMsg = null;
    if(this.floor > 0){ this.floorsCleared++; levelMsg = this.bankXp(); }
    this.floor++;
    this.rng = new Rng(((this.runSeed || 0) + this.floor * 7919) >>> 0);
    this.world = generateFloor(this.floor, this.rng);
    const W = this.world;
    this.enemies = [];
    this.shots = [];
    this.zones = [];
    this.particles = [];
    this.effects = []; this.trails = []; this.hurtT = 0;
    this.clearTalk();
    this._trailClock = 0;
    this.P = this.P || this.makePlayer(this.cls);
    if(this.coop && !guest) this.coop.syncMates();
    if(this.warden) this.leaveWarden();
    this.warden = W.arena ? new WardenView(this) : null;
    if(!W.arena && window.Music) Music.stop(1);
    this.inputLock = false;
    const keepers = this.allPlayers();
    keepers.forEach((p, i) => {
      p.candleUsed = false; p.refused = false; p._wHit = null; p._wViol = null; p.owT = 0; p.lowered = false;
      this.placeKeeper(p, i, keepers.length);
      p.surgeT = p.surgeCdT = p.dashT = p.dashCdT = p.invulnT = 0;
      p.snuffT = 0;
      p.walk = 0;
      p.eCdT = 0;
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
    this.toast(levelMsg || 'FLOOR ' + W.num);
    if(this.coop && !guest) this.coop.onFloor();
  }
  spawnFloorEnemies(){
    const W = this.world, P = this.P, keepers = this.allPlayers();
    for(let i = 0; i < W.initial; i++){
      const s = spreadSpot(W, this.rng, keepers, this.enemies, 380, Infinity);
      this.spawnEnemy(pickMobType(this.floor, this.rng), s.x, s.y);
    }
    if(W.arena){
      const e = new Enemy(this, 'warden', W.arena.throne.x, W.arena.throne.y);
      this.enemies.push(e);
      new WardenBrain(this, e, this.warden);
    } else if(W.boss){
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
    if(!e.isBoss) this.runKills = (this.runKills || 0) + 1;
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
      if(K.ultOn) K.ult = Math.min(100, (K.ult || 0) + e.d.pts * 0.4 * K.ultRate);
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
    if(this.warden && this.warden.calm()) return;
    if(P.buffs.aegis > 0){
      this.burst(P.x, P.y, POWERUPS.aegis.color, 0.8, 6, 3, 0.35);
      P.invulnT = 0.25;
      if(P.spikeT > 0 && src && !src.dead && src.hp !== undefined){
        this.hurtEnemy(src, P.spikeDmg, 'thorns', P.spikeBy || P);
        src.flash = 0.3;
        if(src.hp <= 0) this.killEnemy(src, P.spikeBy || P);
      }
      return;
    }
    if(P.ward > 0 && Math.random() < P.ward){
      this.burst(P.x, P.y, '#ffd98a', 1, 8, 4, 0.4);
      if(local) SFX.hitE();
      P.invulnT = P.invuln;
      return;
    }
    if(this.warden && this.warden.brain && this.warden.brain.beforeLethal(P, amount)) return;
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
      this.hurtEnemy(src, P.thorns, 'thorns', P);
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
    this.leaveWarden();
    this.bankXp();
    const s = this.fillStats('overStats', [['FLOOR', this.floor], ['SCORE', Math.round(this.score)], ['EMBERS', Math.round(this.embers)]].concat(this.xpRows()));
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
    if(this.wardenEnding !== 'slain') SFX.win();
    this.xpBonus += XP_VICTORY;
    this.bankXp();
    if(this.score > this.best){
      this.best = Math.round(this.score);
      try{ localStorage.setItem('emberdeep_best', String(this.best)); }catch(e){}
    }
    this.fillStats('vicStats', [['SCORE', Math.round(this.score)], ['EMBERS', Math.round(this.embers)]].concat(this.xpRows()));
    const end = this.wardenEnding, $ = function(id){ return document.getElementById(id); };
    $('vicEyebrow').textContent = end === 'spared' ? 'AND THE DEEP REMEMBERS WARMTH' : 'AND THE DEEP REMEMBERS LIGHT';
    $('vicTitle').textContent = end === 'spared' ? 'THE WARDEN RESTS' : 'THE WARDEN FALLS';
    $('vicSub').textContent = end === 'spared'
      ? 'Tallow carries your flame up the stair. One by one, the beacons wake. Somewhere far above, someone sees a light, and is not afraid.'
      : end === 'slain' ? 'The stair blazes like a struck sun. The deep is lit from the bottom up. There is no one left down here to see it.'
      : 'The stair blazes like a struck sun. For the first time in a thousand years, the deep is lit from the bottom up.';
    if(end){
      const skin = end === 'spared' ? 'tallow' : 'cinder';
      if(!Progress.data.flags[skin]){
        Progress.data.flags[skin] = true;
        Progress.save();
        this.fillStats('vicStats', [['SCORE', Math.round(this.score)], ['EMBERS', Math.round(this.embers)]].concat(this.xpRows(), [['NEW SKIN', skinById(skin).name]]));
      }
    }
    this.showScreen('screen-victory');
    if(this.coop && this.coop.isHost) this.coop.onEnd('victory');
  }

  // Wickhollow, the village above the deep: between runs, single keeper.
  enterHub(){
    if(this.coop){ this.startRun(); return; }
    this.bankXp();
    this.clearTalk();
    this.leaveWarden();
    this.stopInput(); this.t = 0; this.shake = 0;
    this.floor = 0; this.score = 0; this.embers = 0;
    this.resetRunXp();
    this.runKills = 0;
    this.rng = new Rng((Date.now() >>> 0) ^ 0x5eed);
    this.world = generateHub();
    this.warden = null;
    this.enemies = []; this.shots = []; this.zones = []; this.particles = []; this.effects = []; this.trails = [];
    this.P = this.makePlayer(this.cls);
    this.cam = { x: this.P.x, y: this.P.y };
    this.state = 'playing';
    this.showScreen(null);
    this.toast('WICKHOLLOW');
  }
  // Leaving a village menu: rebuild the keeper so class, tree and gear apply.
  backToHub(){
    const W = this.world, old = this.P;
    if(!W || !W.hub){ this.showScreen('screen-title'); return; }
    this.bankXp();
    this.P = this.makePlayer(this.cls);
    if(old){ this.P.x = old.x; this.P.y = old.y + 20; }
    this.state = 'playing';
    this.showScreen(null);
  }
  menuBack(){ if(this.state === 'hubmenu') this.backToHub(); else this.showScreen('screen-title'); }

  toTitle(){
    this.bankXp();
    this.clearTalk();
    this.leaveWarden();
    if(this.coop) this.coop.onTitle();
    this.state = 'title';
    this.world = null;
    this.P = null;
    this.enemies = [];
    this.shots = [];
    this.particles = [];
    this.updateBestLine();
    this.updateClassButton();
    this.showScreen('screen-title');
  }

  // Leaving the arena: the music and the scene dressing stop with it.
  leaveWarden(){
    if(window.Music) Music.stop(0.6);
    if(SFX.droneTo) SFX.droneTo(0.045, 1);
    this.inputLock = false;
    const lb = document.getElementById('letterbox'), fv = document.getElementById('fakeVictory');
    if(lb) lb.classList.remove('on');
    if(fv) fv.classList.add('hidden');
    ['fade', 'bossCard'].forEach(function(id){ const el = document.getElementById(id); if(el) el.classList.remove('on'); });
    document.body.classList.remove('warden-scene');
    document.title = 'EMBERDEEP — A Descent in the Dark';
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
    if(W.hub){ this.startRun(); return; }
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
      const sleeping = W.vents.filter(function(v){ return !v.active && !v.dead; });
      const target = sleeping.length ? pick(sleeping) : pick(W.vents.filter(function(v){ return !v.dead; }));
      if(target) this.wakeFuelVent(target, true);
      W.ventCycleT = rand(8, 15);
    }

    const keepers = this.allPlayers().filter(function(p){ return p.hp > 0; });
    let hasActive = false;
    for(let i = 0; i < W.vents.length; i++){
      const v = W.vents[i];
      if(v.dead) continue;
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
    const alive = W.vents.filter(function(v){ return !v.dead; });
    if(!hasActive && alive.length){
      const next = alive.reduce(function(a, b){ return a.refillT < b.refillT ? a : b; });
      this.wakeFuelVent(next, false);
    }
    this.fuelStatus = this.fuelPrompt(this.P);
  }
  // HUD hint for the vent next to the local keeper.
  fuelPrompt(P){
    if(this.world.hub) return Hub.prompt(this);
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
    if(this.inputLock) return { mx: 0, my: 0, aim: P.aim, fire: false, surge: false, dash: false, ability: false, alt: false, ult: false, tx: P.x, ty: P.y };
    return {
      mx: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      my: (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0),
      aim: Math.atan2(this.mouse.y + origin.y - P.y, this.mouse.x + origin.x - P.x),
      fire: !!this.mouse.down,
      surge: !!k.Space,
      dash: !!(k.ShiftLeft || k.ShiftRight),
      ability: !!k.KeyE,
      alt: !!this.mouse.alt,
      ult: !!k.KeyQ,
      bow: !!k.KeyR,
      bomb: !!k.KeyG,
      tx: this.mouse.x + origin.x,
      ty: this.mouse.y + origin.y
    };
  }
  decayFeedback(dt){
    this.shake = Math.max(0, this.shake - 14 * dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
  }
  followCamera(dt){
    const P = this.focusKeeper(), follow = this.R.reducedMotion ? 1 : 1 - Math.exp(-12 * dt);
    let tx = P.x, ty = P.y;
    const V = this.warden;
    if(V && V.fightActive()){
      const br = Math.min(V.boxR(), WARDEN.openR), k = 2 * br + 100 <= Math.min(this.R.w, this.R.h) ? 0.6 : 0.25;
      const e = V.locksActions() && this.enemies.find(function(x){ return x.type === 'warden'; });
      // Scenes frame the speaker; fights lean toward the middle of the hall.
      if(e){ tx = lerp(P.x, e.x, 0.5); ty = lerp(P.y, e.y, 0.5); }
      else { tx = lerp(P.x, WARDEN.C.x, k); ty = lerp(P.y, WARDEN.C.y, k); }
    }
    this.cam.x = lerp(this.cam.x, tx, follow);
    this.cam.y = lerp(this.cam.y, ty, follow);
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
    p.moving = mvl > 0 || p.dashT > 0;
    if(local && this.warden) this.warden.pullAt(p, dt);
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
    const local = p === this.P, V = this.warden;
    if(V && V.locksActions()) inp = Object.assign({}, inp, { fire: false, surge: false, ability: false, alt: false, ult: false });
    else if(V && V.blocksUlt()) inp = Object.assign({}, inp, { ult: false, ability: V.s === WS.MERCY ? false : inp.ability });
    const calm = V && V.calm() || this.world && this.world.hub;
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
    p.eCdT = Math.max(0, (p.eCdT || 0) - dt);
    p.altCdT = Math.max(0, (p.altCdT || 0) - dt);
    p.spikeT = Math.max(0, (p.spikeT || 0) - dt);
    if(p.ultOn) p.ult = Math.min(100, (p.ult || 0) + 0.5 * p.ultRate * dt);
    if(inp.ability && p.eCdT <= 0) this.useAbility(p, inp);
    if(inp.alt && p.alt && p.altCdT <= 0) this.useAlt(p, inp);
    if(inp.ult && p.ultOn && p.ult >= 100) this.useUlt(p, inp);
    if(inp.surge && p.surgeCdT <= 0 && p.oil > 0) this.surge(p);
    Gear.act(this, p, inp, dt);

    if(!freeOil && !calm) p.oil = Math.max(0, p.oil - CFG.drain * dt);
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

    if(p.oil <= 0 && !calm){
      p.oil = 0;
      if(V && V.brain && V.brain.beforeLethal(p, CFG.darkDps * dt)) return;
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
    if(this.warden) this.warden.clearAt(p.x, p.y, p.surge.r * 0.6);
  }
  // Damages and shoves every enemy within `r` of `at` (default: the keeper `p`,
  // who also gets the kill) and snuffs enemy shots there.
  blast(p, r, dmg, kb, at){
    at = at || p;
    let kills = 0;
    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(e.dead) continue;
      const d = dist(at.x, at.y, e.x, e.y);
      if(d < r + e.r){
        this.hurtEnemy(e, dmg, 'blast', p);
        e.flash = 0.3;
        const dx = e.x - at.x, dy = e.y - at.y;
        const dd = Math.hypot(dx, dy) || 1;
        e.kb.x += (dx / dd) * kb;
        e.kb.y += (dy / dd) * kb;
        if(e.hp <= 0){ this.killEnemy(e, p); kills++; }
      }
    }
    for(let i = 0; i < this.shots.length; i++){
      const s = this.shots[i];
      if(s.kind !== 'orb' && s.kind !== 'shard') continue;
      if(dist(at.x, at.y, s.x, s.y) < r) s.dead = true;
    }
    return kills;
  }
  // Class ability on E. Runs on the host like every other source of damage.
  useAbility(p, inp){
    const ab = CLASSES[p.cls].ability, free = p.buffs.well > 0, sk = p.sk || {}, pow = p.ePow || 1;
    if(ab.cost && !free && p.oil < ab.cost) return;
    const tx = inp.tx !== undefined ? inp.tx : p.x + Math.cos(p.aim) * 200;
    const ty = inp.ty !== undefined ? inp.ty : p.y + Math.sin(p.aim) * 200;
    const ang = Math.atan2(ty - p.y, tx - p.x), far = dist(p.x, p.y, tx, ty);
    p.eCdT = p.eCd || ab.cd;
    if(ab.cost && !free) p.oil -= ab.cost;
    if(ab.id === 'flare'){
      const d = Math.min(far, 320);
      const z = { kind: 'flare', x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d, r: 170, t: 6, max: 6, owner: p,
        dps: (24 + 3 * this.floor) * pow, pull: sk.b2 ? 70 : 0, oil: 4 * (sk.b3 || 0) };
      this.zones.push(z);
      this.abilityFx(z.x, z.y, '#ffb35c', 170);
    } else if(ab.id === 'fireball'){
      const sp = 560;
      this.shots.push({ x: p.x + Math.cos(ang) * 18, y: p.y + Math.sin(ang) * 18, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        r: 8, dmg: (55 + 9 * this.floor) * pow, life: Math.max(60, Math.min(far, 620)) / sp, color: '#ff7a2f', kind: 'fire', owner: p, dead: false,
        cluster: !!sk.b2, storm: sk.b3 || 0 });
    } else if(ab.id === 'bulwark'){
      const dur = 3 * pow;
      this.allPlayers().forEach(k => {
        if(k.alive === false || dist(k.x, k.y, p.x, p.y) >= 170) return;
        k.buffs.aegis = Math.max(k.buffs.aegis || 0, dur);
        if(sk.b2){ k.hp = Math.min(k.maxHp, k.hp + 20); this.floatText(k.x, k.y, '+20 VIGOR', '#98d9bc'); }
        if(sk.b3){ k.spikeT = dur; k.spikeDmg = 25 * sk.b3; k.spikeBy = p; }
      });
      this.blast(p, 170, 10 * pow, 760 * pow);
      this.abilityFx(p.x, p.y, POWERUPS.aegis.color, 170);
    } else if(ab.id === 'blink'){
      const d = Math.min(far, 280), dmg = (35 + 6 * this.floor) * pow * this.dmgMult(p);
      let kills = this.blast(p, 80, dmg, 300);
      this.abilityFx(p.x, p.y, '#b18cff', 80);
      p.x += Math.cos(ang) * d; p.y += Math.sin(ang) * d;
      this.constrainKeeper(p);
      p.tp++; // co-op guests snap to the new spot
      p.invulnT = Math.max(p.invulnT, 0.35);
      kills += this.blast(p, 90, dmg, 360);
      this.abilityFx(p.x, p.y, '#b18cff', 90);
      if(sk.b2 && kills > 0) p.eCdT = 0.4;
      if(sk.b3){ p.buffs.night = 3; p.nightMult = 1 + 0.25 * sk.b3; }
    } else if(ab.id === 'mend'){
      const heal = Math.round(35 * pow), oil = Math.round(20 * pow);
      this.allPlayers().forEach(k => {
        if(k.alive === false || dist(k.x, k.y, p.x, p.y) > 230) return;
        k.hp = Math.min(k.maxHp, k.hp + heal);
        k.oil = Math.min(k.maxOil, k.oil + oil);
        if(sk.b2) k.buffs.aegis = Math.max(k.buffs.aegis || 0, 2);
        this.floatText(k.x, k.y, '+' + heal + ' VIGOR', '#98d9bc');
      });
      if(sk.b3) this.zones.push({ kind: 'mend', x: p.x, y: p.y, r: 150, t: 2 + 2 * sk.b3, max: 2 + 2 * sk.b3, owner: p, heal: 8 * pow, oil: 4 });
      this.abilityFx(p.x, p.y, '#98d9bc', 230);
    }
    if(p === this.P) SFX.ability();
  }
  // Skill-tree attack on the right mouse button (unlocked by a1).
  useAlt(p, inp){
    const A = p.alt, free = p.buffs.well > 0, sk = p.sk, f = this.floor, a = p.aim;
    if(A.cost && !free && p.oil < A.cost) return;
    if(A.cost && !free) p.oil -= A.cost;
    p.altCdT = p.altCd;
    const pow = p.altPow * this.dmgMult(p);
    if(p.cls === 'keeper'){
      const n = [1, 3, 5][sk.a3 || 0];
      for(let i = 0; i < n; i++) this.playerShot(p, a + (i - (n - 1) / 2) * 0.13, { speed: 760, dmg: (18 + 3 * f) * pow, pierce: 3, life: 0.65, r: 6, color: '#ffe7a6' });
    } else if(p.cls === 'pyro'){
      this.beam(p, a, 440, 18, (30 + 5 * f) * pow, sk.a3 ? (6 + 2 * f) * sk.a3 : 0);
    } else if(p.cls === 'guardian'){
      this.arcBlast(p, a, 125, 1.0, (25 + 4 * f) * pow, 900, 0.7 * (sk.a3 || 0));
    } else if(p.cls === 'nightblade'){
      const n = sk.a3 ? 5 : 3;
      for(let i = 0; i < n; i++) this.playerShot(p, a + (i - (n - 1) / 2) * 0.17, { speed: 820, dmg: (14 + 3 * f) * pow, pierce: sk.a3 >= 2 ? 1 : 0, life: 0.5, r: 5, color: '#c9a8ff' });
    } else if(p.cls === 'lightbinder'){
      const n = sk.a3 >= 2 ? 2 : 1;
      for(let i = 0; i < n; i++){
        const ma = a + (n > 1 ? (i ? 0.3 : -0.3) : 0);
        this.zones.push({ kind: 'mote', x: p.x + Math.cos(ma) * 20, y: p.y + Math.sin(ma) * 20, vx: Math.cos(ma) * 150, vy: Math.sin(ma) * 150,
          r: 70, t: 3.5, max: 3.5, owner: p, dps: (16 + 3 * f) * pow, heal: 6 * p.altPow, oil: sk.a3 ? 4 : 0 });
      }
    }
    if(p === this.P) SFX.alt();
  }
  // Ultimate on Q (unlocked by c2): charged by kills, spent whole.
  useUlt(p, inp){
    p.ult = 0;
    const pow = p.ultPow, f = this.floor, sk = p.sk, U = SKILL_TREES[p.cls].ult;
    const tx = inp.tx !== undefined ? inp.tx : p.x + Math.cos(p.aim) * 200;
    const ty = inp.ty !== undefined ? inp.ty : p.y + Math.sin(p.aim) * 200;
    if(p.cls === 'keeper'){
      p.buffs.dawn = 6;
      p.dawnBurn = 6 * pow;
      p.hp = Math.min(p.maxHp, p.hp + 30 * pow);
      this.abilityFx(p.x, p.y, '#ffe08a', 260);
    } else if(p.cls === 'pyro'){
      this.zones.push({ kind: 'meteor', x: tx, y: ty, r: 210, t: 3, max: 3, owner: p, every: 0.25, tick: 0, dmg: (60 + 8 * f) * pow });
    } else if(p.cls === 'guardian'){
      this.allPlayers().forEach(function(k){ if(k.alive !== false) k.buffs.aegis = Math.max(k.buffs.aegis || 0, 4 * pow); });
      this.enemies.forEach(e => { if(!e.dead && dist(p.x, p.y, e.x, e.y) < 330 + e.r) this.stun(e, 1.5); });
      this.blast(p, 330, (40 + 6 * f) * pow, 1100);
      this.abilityFx(p.x, p.y, POWERUPS.aegis.color, 330);
    } else if(p.cls === 'nightblade'){
      const dmg = (60 + 10 * f) * pow * this.dmgMult(p), near = e => dist(p.x, p.y, e.x, e.y);
      const targets = this.enemies.filter(e => !e.dead && !e.untargetable && near(e) < 520).sort((a, b) => near(a) - near(b)).slice(0, 6 + (sk.c3 || 0));
      this.abilityFx(p.x, p.y, '#b18cff', 70);
      targets.forEach(e => {
        if(e.dead) return;
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        p.x = e.x + Math.cos(a) * (e.r + 16); p.y = e.y + Math.sin(a) * (e.r + 16);
        this.constrainKeeper(p);
        this.abilityFx(e.x, e.y, '#b18cff', 60);
        this.blast(p, 60, dmg, 380, { x: e.x, y: e.y });
      });
      p.tp++;
      p.invulnT = Math.max(p.invulnT, 1);
    } else if(p.cls === 'lightbinder'){
      this.zones.push({ kind: 'sanct', x: p.x, y: p.y, r: 250, t: 7, max: 7, owner: p, dps: (14 + 2 * f) * pow, heal: 10 * pow, oil: 6 * pow, slow: true });
      this.abilityFx(p.x, p.y, '#98d9bc', 250);
    }
    if(p === this.P){ SFX.ult(); this.shake += 5; this.toast(U.name); }
    else if(this.coop && this.coop.isHost) this.coop.net.sendTo(p.id, { t: 'say', msg: U.name });
  }
  // Flame and skill damage bonus from Nightfall and Dawnbreak.
  dmgMult(p){
    return (p.buffs.night > 0 ? p.nightMult || 1 : 1) * (p.buffs.dawn > 0 ? 1.3 : 1);
  }
  // Every hit on a shadow goes through here: a boss can be shielded (talking,
  // changing phase) or held at an HP floor until its script lets it fall.
  hurtEnemy(e, dmg, src, by){
    if(e.brain){ dmg = e.brain.onHurt(dmg, src || 'misc', by); if(!(dmg > 0)) return; }
    else if(e.shieldT > 0) return;
    e.hp -= dmg;
    if(e.hpFloor > 0 && e.hp < e.hpFloor) e.hp = e.hpFloor;
  }
  stun(e, t){ if(!e.isBoss) e.stunT = Math.max(e.stunT || 0, t); }
  ignite(e, dps, t, by){
    if(!(e.burnT > 0) || dps >= e.burnDps) e.burnDps = dps;
    e.burnT = Math.max(e.burnT || 0, t);
    e.burnBy = by;
  }
  // A piercing keeper projectile ('bolt'); `pierce` extra shadows it passes through.
  playerShot(p, ang, o){
    this.shots.push({ x: p.x + Math.cos(ang) * 16, y: p.y + Math.sin(ang) * 16, vx: Math.cos(ang) * o.speed, vy: Math.sin(ang) * o.speed,
      r: o.r, dmg: o.dmg, life: o.life, color: o.color, kind: 'bolt', pierce: o.pierce, hit: [], owner: p, dead: false });
  }
  // Instant line from the keeper along `ang`, stopped by the first wall.
  beam(p, ang, len, width, dmg, burnDps){
    const ex = Math.cos(ang), ey = Math.sin(ang);
    let reach = len;
    for(let d = 20; d < len; d += 12){
      if(inAnyObstacle(this.world.obstacles, p.x + ex * d, p.y + ey * d, 0)){ reach = d; break; }
    }
    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(e.dead) continue;
      const rx = e.x - p.x, ry = e.y - p.y, along = rx * ex + ry * ey;
      if(along < 0 || along > reach + e.r || Math.abs(rx * ey - ry * ex) > width + e.r) continue;
      this.hurtEnemy(e, dmg, 'beam', p);
      e.flash = 0.3;
      if(e.hp <= 0){ this.killEnemy(e, p); continue; }
      if(burnDps) this.ignite(e, burnDps, 3, p);
    }
    this.beamFx(p.x + ex * 14, p.y + ey * 14, p.x + ex * reach, p.y + ey * reach, '#ff7a2f');
  }
  // Short frontal arc: damage, a hard shove and an optional stun; it also swats shots.
  arcBlast(p, ang, range, half, dmg, kb, stunT){
    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
      if(d > range + e.r || Math.abs(angleDiff(Math.atan2(dy, dx), ang)) > half + e.r / d) continue;
      this.hurtEnemy(e, dmg, 'melee', p);
      e.flash = 0.3;
      e.kb.x += dx / d * kb;
      e.kb.y += dy / d * kb;
      if(stunT) this.stun(e, stunT);
      if(e.hp <= 0) this.killEnemy(e, p);
    }
    for(let i = 0; i < this.shots.length; i++){
      const s = this.shots[i];
      if((s.kind === 'orb' || s.kind === 'shard') && dist(p.x, p.y, s.x, s.y) < range + 20 &&
        Math.abs(angleDiff(Math.atan2(s.y - p.y, s.x - p.x), ang)) < half + 0.3) s.dead = true;
    }
    this.abilityFx(p.x + Math.cos(ang) * 65, p.y + Math.sin(ang) * 65, '#f4e3a1', 75);
    if(p === this.P) this.shake += 2;
  }
  beamFx(x, y, x2, y2, color){
    if(this.effects.length >= 80) this.effects.shift();
    this.effects.push({ kind: 'beam', x, y, x2, y2, color, life: 0.3, maxLife: 0.3 });
    if(this.coop && this.coop.isHost) this.coop.net.broadcast({ t: 'fx', k: 'beam', x: Math.round(x), y: Math.round(y), x2: Math.round(x2), y2: Math.round(y2), c: color });
  }
  // Ring + sparks; co-op guests get the same through the host.
  abilityFx(x, y, color, r){
    this.effect(x, y, color, r);
    this.burst(x, y, color, 1.2, 18, 4, 0.7);
    if(this.coop && this.coop.isHost) this.coop.broadcastFx(x, y, color, r);
  }
  explodeFireball(s){
    this.blast(s.owner, 105, s.dmg, 420, s);
    this.abilityFx(s.x, s.y, s.color, 105);
    if(s.cluster){
      for(let i = 0; i < 3; i++){
        const a = i / 3 * TAU + rand(-0.3, 0.3), at = { x: s.x + Math.cos(a) * 75, y: s.y + Math.sin(a) * 75 };
        this.blast(s.owner, 65, s.dmg * 0.4, 260, at);
        this.abilityFx(at.x, at.y, '#ff9a3d', 65);
      }
    }
    if(s.storm) this.zones.push({ kind: 'pool', x: s.x, y: s.y, r: 95, t: 1 + 2 * s.storm, max: 1 + 2 * s.storm, owner: s.owner, dps: 18 + 3 * this.floor });
    SFX.noiseHit({ f: 300, f2: 70, d: 0.35, v: 0.22, ft: 'lowpass' });
  }
  // Lingering skill areas: they burn, pull or slow shadows and mend keepers inside.
  updateZones(dt){
    const W = this.world, keepers = this.allPlayers();
    for(let i = 0; i < this.zones.length; i++){
      const z = this.zones[i];
      z.t -= dt;
      if(z.vx || z.vy){
        z.x += z.vx * dt; z.y += z.vy * dt;
        if(inAnyObstacle(W.obstacles, z.x, z.y, 0) || z.x < 20 || z.y < 20 || z.x > W.w - 20 || z.y > W.h - 20){ z.vx = z.vy = 0; }
      }
      if(z.kind === 'meteor'){
        z.tick -= dt;
        while(z.tick <= 0 && z.t > 0){
          z.tick += z.every;
          const a = rand(0, TAU), d = Math.sqrt(Math.random()) * z.r, at = { x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d };
          this.blast(z.owner, 85, z.dmg, 420, at);
          this.abilityFx(at.x, at.y, '#ff7a2f', 85);
          if(z.owner === this.P) this.shake += 1.5;
        }
        continue;
      }
      for(let j = 0; j < this.enemies.length && z.dps; j++){
        const e = this.enemies[j];
        if(e.dead) continue;
        const d = dist(z.x, z.y, e.x, e.y);
        if(d > z.r + e.r) continue;
        this.hurtEnemy(e, z.dps * dt, 'zone', z.owner);
        e.flash = Math.max(e.flash, 0.15);
        if(z.slow) e.slowT = 0.25;
        if(z.pull && !e.isBoss && d > 12){ e.x += (z.x - e.x) / d * z.pull * dt; e.y += (z.y - e.y) / d * z.pull * dt; }
        if(e.hp <= 0) this.killEnemy(e, z.owner);
      }
      if(!z.heal && !z.oil) continue;
      for(let k = 0; k < keepers.length; k++){
        const q = keepers[k];
        if(q.alive === false || q.hp <= 0 || dist(z.x, z.y, q.x, q.y) > z.r) continue;
        if(z.heal) q.hp = Math.min(q.maxHp, q.hp + z.heal * dt);
        if(z.oil) q.oil = Math.min(q.maxOil, q.oil + z.oil * dt);
      }
    }
    this.zones = this.zones.filter(function(z){ return z.t > 0; });
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
    const sparks = skinById(p.skin).fire.sparks;
    p.emberClock = (p.emberClock || 0) + dt;
    const interval = this.R.reducedMotion ? 0.07 : 0.018;
    while(p.emberClock >= interval){
      p.emberClock -= interval;
      if(this.particles.length >= 450) continue;
      const angle = p.aim + rand(-p.flame.half, p.flame.half) * 0.85;
      const sp = rand(260, 420), life = rand(0.22, 0.45);
      this.particles.push({ x:p.x+Math.cos(p.aim)*17, y:p.y+Math.sin(p.aim)*17,
        vx:Math.cos(angle)*sp, vy:Math.sin(angle)*sp, life, maxLife:life,
        size:rand(1.5,3.5), color:pick(sparks) });
    }
  }
  burnCone(p, dt){
    const dmg = p.flame.dps * dt * (p.buffs.blaze > 0 ? 2 : 1) * this.dmgMult(p);
    for(let i = 0; i < this.enemies.length; i++){
      const e = this.enemies[i];
      if(e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if(d > p.flame.range + e.r) continue;
      const ea = Math.atan2(dy, dx);
      if(Math.abs(angleDiff(ea, p.aim)) > p.flame.half + e.r / (d || 1)) continue;
      const crit = Math.random() < (p.flame.crit || 0);
      this.hurtEnemy(e, dmg * (crit ? p.flame.critMult : 1), 'flame', p);
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
    this.updateTalk(dt);
    if(this.isGuest()){ this.updateGuest(dt); return; }
    if(this._pauseQ && !(this.warden && (this.warden.s === WS.FAKE || this.warden.s === WS.RESOLVE))){
      this.pause();
      if(this.state !== 'playing') return;
    }
    const W = this.world, P = this.P;
    if(!W || !P || P.hp <= 0 && !this.coop) return;

    this.decayFeedback(dt);
    this.followCamera(dt);
    const inp = this.localInput(), alive = P.alive !== false;
    if(alive) this.moveKeeper(P, inp, dt);
    if(W.hub) Hub.update(this, dt);
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
    this.updateZones(dt);
    if(this.warden){ this.warden.update(dt); if(this.state !== 'playing') return; }
    this.enemies = this.enemies.filter(function(e){ return !e.dead; });

    W.spawnT -= dt;
    if(W.spawnT <= 0 && W.spawnsLeft > 0){
      W.spawnT = W.spawnInterval; W.spawnsLeft--;
      const living = this.allPlayers().filter(function(k){ return k.alive !== false; });
      const spot = spreadSpot(W, this.rng, living.length ? living : [P], this.enemies, 420, 1200);
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
      if(s.kind === 'bomb'){ Gear.tickBomb(this, s, dt); continue; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      s.dead = inAnyObstacle(W.obstacles, s.x, s.y, s.r) || s.life <= 0 || s.x < 0 || s.x > W.w || s.y < 0 || s.y > W.h;
      if(s.kind === 'bolt'){
        for(let ei = 0; ei < this.enemies.length && !s.dead; ei++){
          const e = this.enemies[ei];
          if(e.dead || s.hit.indexOf(e.id) >= 0 || dist(s.x, s.y, e.x, e.y) >= s.r + e.r) continue;
          s.hit.push(e.id);
          this.hurtEnemy(e, s.dmg, 'shot', s.owner);
          e.flash = 0.25;
          e.kb.x += s.vx * 0.25; e.kb.y += s.vy * 0.25;
          this.burst(s.x, s.y, s.color, 0.5, 5, 3, 0.3);
          if(e.hp <= 0) this.killEnemy(e, s.owner);
          if(s.pierce-- <= 0) s.dead = true;
        }
        continue;
      }
      if(s.kind === 'fire'){
        for(let ei = 0; ei < this.enemies.length && !s.dead; ei++){
          const e = this.enemies[ei];
          if(!e.dead && dist(s.x, s.y, e.x, e.y) < s.r + e.r) s.dead = true;
        }
        if(s.dead) this.explodeFireball(s);
        continue;
      }
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
