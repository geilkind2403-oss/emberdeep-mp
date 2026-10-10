'use strict';
/* EMBERDEEP music: THE WARDEN's score (floor 10), synthesized live with WebAudio.
   Tallow's theme (d minor, quarters): D4 F4 A4 G4 | F4 E4 C#4 D4, major with F#4.
   Keeper motif: the rising octave G3 -> G4.
   corridor 60 4/4 music box (setProximity) | waltz 96 3/4 phase 1
   ward 120 phase 2 | tallow 150 phase 3 (setTranspose, UNDYING)
   wicks 140 phase 4 (setLayers 0..8, D major once 7 are lit) | rest 72 spared.
   Timing: a 25 ms timer schedules 16th steps 0.12 s ahead. The audio clock is the
   master: beat 0 lies at fight time startBt, a step at fight time nb plays at
   anchorAudio + (nb - anchorBt). Re-anchor only on > 80 ms drift (the step cursor
   never replays), skip steps already past, and schedule nothing while the fight
   clock is NaN or stands still (paused).
   Path: track gain -> bus 0.16 (duck) -> lowpass (muffle) -> compressor -> SFX.master,
   with a shared convolver room feeding the bus (stop(0) cuts its tail too).
   play() of a new id resets layers and transpose. Without a running AudioContext
   every call is silent (a requested track starts on the beat once audio runs),
   and no call ever throws. */

(function(){
  const BUS = 0.16;    // music bus gain
  const AHEAD = 0.12;  // s scheduled ahead of the audio clock
  const DRIFT = 0.08;  // s of fight-clock drift before re-anchoring
  const STILL = 0.1;   // s without fight-clock movement = paused

  function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }
  function num(v){ return typeof v === 'number' ? v : NaN; }
  function trk(id){ return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TRACKS, id) ? TRACKS[id] : null; }

  // Chords (MIDI): r = bass root, v = mid voicing, q = third above the root.
  const CH = {
    Dm: { r: 38, q: 3, v: [57, 62, 65] },
    D:  { r: 38, q: 4, v: [57, 62, 66] },
    Bb: { r: 34, q: 4, v: [58, 62, 65] },
    C:  { r: 36, q: 4, v: [55, 60, 64] },
    A:  { r: 33, q: 4, v: [57, 61, 64] },
    Eb: { r: 39, q: 4, v: [58, 63, 67] },
    Cd: { r: 37, q: 3, v: [55, 61, 64] }, // C#dim
    Bm: { r: 35, q: 3, v: [59, 62, 66] },
    G:  { r: 31, q: 4, v: [55, 59, 62] }
  };
  function up(v, n){ return v.map(function(m){ return m + n; }); }
  function octUp(bar){ return bar.map(function(n){ return [n[0], n[1] + 12, n[2]]; }); }

  // Phrases: one array per bar of [step, midi, length in steps] (16th steps).
  const MOTIF_A = [[0, 62, 4], [4, 65, 4], [8, 69, 4], [12, 67, 4]];
  const MOTIF_B = [[0, 65, 4], [4, 64, 4], [8, 61, 4], [12, 62, 4]];

  // Music box, one note per beat (0 = rest), 8 bars.
  const CORRIDOR_BOX = [74, 77, 81, 79, 77, 76, 73, 74, 69, 0, 0, 0, 0, 0, 70, 0,
                        74, 77, 81, 79, 77, 76, 73, 69, 62, 0, 0, 0, 0, 0, 0, 0];
  const CORRIDOR_PAD = [[50, 57], [46, 53], [50, 57], [45, 52]];
  const REST_BOX = [74, 78, 81, 79, 78, 76, 73, 74, 83, 81, 79, 78, 76, 0, 73, 0,
                    74, 78, 81, 79, 78, 76, 73, 74, 71, 74, 79, 78, 74, 0, 0, 0];

  const WALTZ = ['Dm', 'Bb', 'C', 'A'];
  const WALTZ_LEAD = [ // bars 5-8, 3/4: the motif as half + quarter
    [[0, 74, 8], [8, 77, 4]], [[0, 81, 8], [8, 79, 4]],
    [[0, 77, 8], [8, 76, 4]], [[0, 73, 8], [8, 74, 4]]
  ];

  const WARD = ['Dm', 'Dm', 'Bb', 'A'];
  const WARD_LEAD = [MOTIF_A, MOTIF_B,
    [[0, 70, 4], [4, 69, 4], [8, 67, 4], [12, 65, 4]], [[0, 64, 8], [8, 61, 4], [12, 64, 4]],
    MOTIF_A, MOTIF_B,
    [[0, 74, 4], [4, 72, 4], [8, 70, 4], [12, 69, 4]], [[0, 69, 12], [12, 73, 4]]];

  const TALLOW = ['Dm', 'Eb', 'Dm', 'Cd'];
  const TALLOW_BASS = [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 0, 12, 0, 12];
  const TALLOW_LEAD = [
    [[0, 74, 3], [3, 74, 1], [4, 81, 4], [8, 79, 2], [10, 77, 2], [12, 76, 4]],
    [[0, 75, 4], [4, 74, 2], [6, 70, 2], [8, 67, 6], [14, 70, 2]],
    octUp(MOTIF_A), octUp(MOTIF_B),
    [[0, 74, 3], [3, 74, 1], [4, 81, 4], [8, 79, 2], [10, 81, 2], [12, 82, 4]],
    [[0, 79, 4], [4, 77, 2], [6, 75, 2], [8, 74, 4], [12, 70, 4]],
    [[0, 74, 2], [2, 77, 2], [4, 81, 2], [6, 79, 2], [8, 77, 2], [10, 76, 2], [12, 73, 2], [14, 74, 2]],
    [[0, 73, 2], [2, 76, 2], [4, 79, 2], [6, 82, 2], [8, 85, 2], [10, 82, 2], [12, 79, 2], [14, 76, 2]]
  ];

  const WICKS_MIN = ['Dm', 'A', 'Bb', 'C'];
  const WICKS_MAJ = ['D', 'A', 'Bm', 'G'];
  const WICKS_LEAD_MIN = [octUp(MOTIF_A), octUp(MOTIF_B),
    [[0, 82, 6], [6, 81, 2], [8, 77, 4], [12, 81, 4]], [[0, 79, 6], [6, 77, 2], [8, 76, 8]]];
  const WICKS_LEAD_MAJ = [
    [[0, 74, 4], [4, 78, 4], [8, 81, 4], [12, 79, 4]], [[0, 78, 4], [4, 76, 4], [8, 73, 4], [12, 74, 4]],
    [[0, 83, 6], [6, 81, 2], [8, 78, 4], [12, 81, 4]], [[0, 79, 6], [6, 78, 2], [8, 76, 8]]];
  const ARP = [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 4, 3, 2, 1];

  const REST = ['D', 'Bm', 'G', 'A', 'D', 'Bm', 'G', 'D'];

  // Lead voices: [type, semitones, cents].
  const TRI = [['triangle', 0, 0]];
  const SQ_OCT = [['square', 0, 0], ['square', 12, 4]];
  const SAW_SQ = [['sawtooth', 0, 0], ['square', 0, 7]];
  const SQ = [['square', 0, 0]];

  // Per-track insert chains: lowpass (+ optional waveshaper drive) -> post gain.
  const FX = {
    tri:   { lp: 5000, q: 0.5, post: 1, rv: 1, echo: 1 },
    sq:    { lp: 2600, q: 0.7, post: 1, rv: 1, echo: 1 },
    dlead: { lp: 3200, q: 0.9, post: 0.16, shape: 2.5, rv: 1, echo: 1 },
    dbass: { lp: 1100, q: 1.2, post: 0.24, shape: 5 },
    sbass: { lp: 500, q: 2.5, post: 1 },
    wbass: { lp: 650, q: 1.5, post: 1 },
    arp:   { lp: 3500, q: 0.7, post: 1, rv: 1, echo: 1 },
    horn:  { lp: 1100, q: 0.8, post: 1, rv: 1 }
  };

  // Each track: fn(M, s, i, t) plays 16th step i (from beat 0) at audio time t.
  function corridor(M, s, i, t){
    if(i % 4) return;
    const q = (i / 4) % 32, m = CORRIDOR_BOX[q];
    if(m) M._box(s, m, t + Math.random() * 0.012, 0.2 * (0.85 + Math.random() * 0.3));
    if(q % 8 === 0) M._pad(s, CORRIDOR_PAD[q / 8], 'sine', t, 3.5, 6, 4, 0.03);
  }

  function waltz(M, s, i, t){
    const b = Math.floor(i / 12) % 8, p = i % 12, ch = CH[WALTZ[b % 4]], beat = s.step * 4;
    if(p === 0){
      M._bass(s, ch.r + 12, t, beat * 1.3, 0.3, 'triangle', s.out);
      M._bass(s, ch.r, t, beat * 1.3, 0.2, 'sine', s.out);
      if(b % 2 === 0) M._bell(s, ch.r + 36, t, 0.06, 3);
    }
    if(p === 4 || p === 8) M._organ(s, ch.v, t, beat * 0.5, 0.03, 900);
    if(b === 3 && p % 4 === 0) M._box(s, [81, 85, 88][p / 4], t, 0.09);
    if(b >= 4) M._phrase(s, WALTZ_LEAD[b - 4], p, function(m, d){ M._lead(s, m, t, d * 0.92, 0.17, TRI, M._fx(s, 'tri'), 14); });
  }

  function ward(M, s, i, t){
    const b = Math.floor(i / 16), p = i % 16, bb = b % 4, ch = CH[WARD[bb]];
    if(p === 0 || p === 8 || (bb === 3 && p === 14)) M._kick(s, t, 0.8);
    if(p % 2 === 0) M._hat(s, t, p % 4 === 2 ? 0.12 : 0.07);
    if(p === 4 || p === 12) M._chain(s, t, 1.1);
    if(p % 2 === 0) M._bass(s, ch.r + [0, 0, ch.q, 2][(p / 2) % 4], t, s.step * 1.7, 0.3, 'sawtooth', M._fx(s, 'sbass'));
    if(p === 0) M._organ(s, ch.v, t, s.step * 15.5, 0.018, 900);
    M._phrase(s, WARD_LEAD[b % 8], p, function(m, d){ M._lead(s, m, t, d * 0.85, 0.045, SQ_OCT, M._fx(s, 'sq'), 0); });
  }

  function tallow(M, s, i, t){
    const b = Math.floor(i / 16), p = i % 16, ch = CH[TALLOW[b % 4]];
    if(p % 4 === 0) M._kick(s, t, 0.85);
    if(p === 4 || p === 12) M._snare(s, t, 0.8);
    M._hat(s, t, p % 4 === 2 ? 0.1 : p % 2 ? 0.035 : 0.06, p === 14 ? 0.07 : 0.02);
    if(p === 0 && b % 8 === 0) M._crash(s, t, 0.22);
    M._bass(s, ch.r + TALLOW_BASS[p], t, s.step * 0.75, 0.6, 'sawtooth', M._fx(s, 'dbass'));
    if(p === 0) M._choir(s, up(ch.v, 12), t, s.step * 16, 0.024);
    M._phrase(s, TALLOW_LEAD[b % 8], p, function(m, d){ M._lead(s, m, t, d * 0.88, 0.4, SAW_SQ, M._fx(s, 'dlead'), 0); });
  }

  function wicks(M, s, i, t){
    const b = Math.floor(i / 16), p = i % 16, bb = b % 4, L = M.layers;
    if(p === 0){
      const maj = L >= 7;
      if(maj && s.major === false) M._crash(s, t, 0.25);
      s.major = maj;
    }
    const ch = CH[(s.major ? WICKS_MAJ : WICKS_MIN)[bb]];
    if(p % 4 === 0) M._kick(s, t, 0.8);
    if(p % 2 === 0) M._bass(s, ch.r + [0, 12, 0, 12, 0, 12, 7, 12][p / 2], t, s.step * 1.6, 0.28, 'sawtooth', M._fx(s, 'wbass'));
    if(L >= 1){
      if(p % 4 === 2) M._hat(s, t, 0.11, 0.045);
      if(p === 4 || p === 12) M._snare(s, t, 0.6);
    }
    if(L >= 2 && p === 0) M._organ(s, ch.v, t, s.step * 15.5, 0.02, 900);
    if(L >= 3){
      M._phrase(s, (s.major ? WICKS_LEAD_MAJ : WICKS_LEAD_MIN)[bb], p, function(m, d){
        M._lead(s, m, t, d * 0.9, 0.065, SQ, M._fx(s, 'sq'), 12);
        if(L >= 8) M._lead(s, m + 12, t, d * 0.9, 0.11, TRI, M._fx(s, 'tri'), 12);
      });
    }
    if(L >= 4 && bb % 2 === 1 && p % 8 === 0) M._horn(s, p ? 67 : 55, t, s.step * 7.5, 0.12);
    if(L >= 5 && p === 0) M._choir(s, up(L >= 7 ? ch.v.slice(1) : ch.v, 12), t, s.step * 16, 0.02);
    if(L >= 6 && p === 0) M._bell(s, ch.r + 36, t, 0.05, 2.5);
    if(L >= 7){
      const tones = up(ch.v, 12).concat(up(ch.v, 24));
      M._pluck(s, tones[ARP[p]], t, 0.035, 0.06, 'square', M._fx(s, 'arp'));
    }
  }

  function rest(M, s, i, t){
    const b = Math.floor(i / 16) % 8, p = i % 16, ch = CH[REST[b]];
    if(p % 4 === 0){
      const m = REST_BOX[b * 4 + p / 4];
      if(m) M._box(s, m, t + Math.random() * 0.01, 0.17 * (0.9 + Math.random() * 0.2));
    }
    if(p === 0){
      M._organ(s, [ch.r + 12].concat(ch.v), t, s.step * 15.5, 0.013, 700);
      M._choir(s, up(ch.v, 12), t, s.step * 16, 0.018);
      if(b === 7) M._bell(s, 74, t, 0.05, 3.5);
    }
  }

  // bar = beats per bar; rv = room send; echo = dotted-8th echo level; gain = track trim.
  const TRACKS = {
    corridor: { bpm: 60, bar: 4, fn: corridor, rv: 0.6, echo: 0.3, gain: 1, prox: true },
    waltz:    { bpm: 96, bar: 3, fn: waltz, rv: 0.4, echo: 0.2, gain: 0.5 },
    ward:     { bpm: 120, bar: 4, fn: ward, rv: 0.25, echo: 0.16, gain: 0.42 },
    tallow:   { bpm: 150, bar: 4, fn: tallow, rv: 0.2, echo: 0.12, gain: 0.32 },
    wicks:    { bpm: 140, bar: 4, fn: wicks, rv: 0.3, echo: 0.15, gain: 0.38 },
    rest:     { bpm: 72, bar: 4, fn: rest, rv: 0.55, echo: 0.2, gain: 1 }
  };

  class MusicEngine {
    constructor(){
      this.want = null;  // requested track { id, bt, clock }
      this.cur = null;   // playing instance
      this.timer = 0;
      this.layers = 0;
      this.trans = 0;
      this.prox = 0;
      this.ducked = false;
      this.duckAt = false;
      this.bus = null;
      this.lp = null;
      this.comp = null;
      this.verb = null;
      this.ret = null;
      this.curves = {};
    }

    // ---- API ----
    play(id, startBt, clock){
      try{
        if(!trk(id)) return;
        const bt = num(startBt), w = this.want;
        const fn = typeof clock === 'function' ? clock : null;
        if(w && w.id === id && (Math.abs(w.bt - bt) < 0.02 || (w.bt !== w.bt && bt !== bt))){
          w.clock = fn;
          return;
        }
        if(!w || w.id !== id){ this.layers = 0; this.trans = 0; }
        this.want = { id: id, bt: bt, clock: fn };
        this._drop(0.15);
        this._timer(true);
        this._tick();
      }catch(e){}
    }
    stop(fade){
      try{
        this.want = null;
        this._timer(false);
        fade = num(fade);
        fade = fade >= 0 ? clamp(fade, 0.02, 30) : 1;
        const had = !!this.cur;
        this._drop(fade);
        if(had && fade < 0.1) this._cutRoom(fade);
      }catch(e){}
    }
    current(){ return this.want ? this.want.id : null; }
    bpm(id){ const t = trk(id); return t ? t.bpm : 120; }
    beatsPerBar(id){ const t = trk(id); return t ? t.bar : 4; }
    setLayers(n){
      n = Math.floor(num(n));
      this.layers = n > 0 ? Math.min(n, 8) : 0;
    }
    setTranspose(semi){
      try{
        semi = Math.round(num(semi));
        semi = semi === semi ? clamp(semi, -12, 12) : 0;
        if(semi === this.trans) return;
        this.trans = semi;
        const s = this.cur;
        if(!s || !this._ok()) return;
        const now = SFX.ctx.currentTime;
        s.live.forEach(function(o){
          if(o.tr0 !== undefined) o.detune.setTargetAtTime(o.det0 + 100 * (semi - o.tr0), now, 0.015);
        });
      }catch(e){}
    }
    setProximity(v){
      try{
        v = num(v);
        this.prox = v === v ? clamp(v, 0, 1) : 0;
        this._prox();
      }catch(e){}
    }
    duck(on){
      try{
        this.ducked = !!on;
        this._duck();
      }catch(e){}
    }
    muffle(sec){
      try{
        sec = num(sec);
        if(!(sec > 0) || !this.bus || !this._ok()) return;
        sec = Math.min(sec, 10);
        const f = this.lp.frequency, now = SFX.ctx.currentTime;
        f.cancelScheduledValues(now);
        f.setValueAtTime(clamp(f.value, 900, 18000), now);
        f.exponentialRampToValueAtTime(900, now + 0.04);
        f.setValueAtTime(900, now + 0.04 + sec);
        f.exponentialRampToValueAtTime(18000, now + 0.4 + sec);
      }catch(e){}
    }

    // ---- scheduling ----
    _ok(){
      const S = window.SFX;
      return !!(S && S.ctx && S.master && S.noiseBuf && S.ctx.state === 'running');
    }
    _timer(on){
      if(on && !this.timer) this.timer = setInterval(() => this._tick(), 25);
      if(!on && this.timer){ clearInterval(this.timer); this.timer = 0; }
    }
    _tick(){
      try{
        const w = this.want;
        if(!w){ this._timer(false); return; }
        if(!this._ok()) return;
        this._bus();
        this._duck();
        let s = this.cur;
        if(!s) s = this.cur = this._make(w);
        this._prox();
        s.clock = w.clock;
        const now = SFX.ctx.currentTime;
        let clk = NaN;
        try{ if(s.clock) clk = num(s.clock()); }catch(e){}
        if(!isFinite(clk) || !isFinite(s.bt)){ s.aA = null; return; }
        if(clk !== s.lastClk){ s.lastClk = clk; s.lastMove = now; }
        else if(now - s.lastMove > STILL) return; // paused: no new notes
        if(s.aA === null || Math.abs(clk - (s.aB + now - s.aA)) > DRIFT){
          s.aA = now; s.aB = clk;
          const k = Math.ceil((clk - s.bt) / s.step - 1e-6);
          // Keep the cursor on the grid: skip forward, never replay small rewinds.
          if(s.next === null || k > s.next || k < s.next - s.spb) s.next = k;
        }
        this._fill(s, now, now + AHEAD);
      }catch(e){}
    }
    // Plays every step whose audio time lies in [from, to); older steps are skipped.
    _fill(s, from, to){
      const k = Math.ceil((s.aB + (from - s.aA) - s.bt) / s.step - 1e-6);
      if(s.next < k) s.next = k;
      for(let n = 0; n < 64; n++){
        const at = s.aA + (s.bt + s.next * s.step - s.aB);
        if(at >= to) break;
        if(s.next >= 0){
          try{ s.tr.fn(this, s, s.next, Math.max(at, from)); }catch(e){}
        }
        s.next++;
      }
    }
    _level(s){ return s.tr.gain * (s.tr.prox ? 0.3 + 0.7 * this.prox : 1); }
    // The game calls setProximity and duck every frame: params change only on a real
    // change, and one made while audio was not running lands on the next tick.
    _prox(){
      const s = this.cur;
      if(!s || !s.tr.prox || !this._ok()) return;
      const g = this._level(s);
      if(Math.abs(g - s.lvl) < 0.005) return;
      s.lvl = g;
      s.out.gain.setTargetAtTime(g, SFX.ctx.currentTime, 0.12);
    }
    _duck(){
      if(!this.bus || this.duckAt === this.ducked || !this._ok()) return;
      this.duckAt = this.ducked;
      const p = this.bus.gain, now = SFX.ctx.currentTime;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(BUS * (this.ducked ? 0.5 : 1), now, 0.06);
    }
    _bus(){
      const c = SFX.ctx;
      if(this.bus && this.bus.context === c) return;
      this.cur = null;
      this.bus = c.createGain();
      this.bus.gain.value = BUS * (this.ducked ? 0.5 : 1);
      this.duckAt = this.ducked;
      this.lp = c.createBiquadFilter();
      this.lp.type = 'lowpass'; this.lp.frequency.value = 18000; this.lp.Q.value = 0.5;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -18; this.comp.knee.value = 12; this.comp.ratio.value = 3;
      this.comp.attack.value = 0.006; this.comp.release.value = 0.25;
      this.bus.connect(this.lp); this.lp.connect(this.comp); this.comp.connect(SFX.master);
      this._room(this._ir(c));
    }
    // Shared room: convolver -> return gain -> bus.
    _room(ir){
      const c = SFX.ctx;
      this.verb = c.createConvolver();
      this.verb.buffer = ir;
      this.ret = c.createGain();
      this.verb.connect(this.ret); this.ret.connect(this.bus);
    }
    // Hard stop: fade the room's tail out with the music and start a fresh room.
    _cutRoom(fade){
      if(!this.verb || !window.SFX || SFX.ctx !== this.verb.context) return;
      const v = this.verb, r = this.ret, p = r.gain, now = SFX.ctx.currentTime;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(0, now + fade);
      setTimeout(function(){ try{ v.disconnect(); r.disconnect(); }catch(e){} }, fade * 1000 + 100);
      this._room(v.buffer);
    }
    _make(w){
      const c = SFX.ctx, tr = TRACKS[w.id];
      const s = {
        id: w.id, tr: tr, bt: w.bt, clock: w.clock, step: 15 / tr.bpm, spb: tr.bar * 4,
        aA: null, aB: 0, next: null, lastClk: NaN, lastMove: 0,
        live: new Set(), nodes: [], fx: {}, lfo: {}, major: undefined, echo: null
      };
      s.lvl = this._level(s);
      s.out = c.createGain(); s.out.gain.value = s.lvl; s.out.connect(this.bus);
      s.rv = c.createGain(); s.rv.gain.value = tr.rv; s.rv.connect(this.verb);
      s.nodes.push(s.out, s.rv);
      if(tr.echo){
        // Dotted-8th echo, darkened on every repeat.
        const dl = c.createDelay(2), lp = c.createBiquadFilter(), fb = c.createGain(), wet = c.createGain();
        s.echo = c.createGain();
        dl.delayTime.value = s.step * 3;
        lp.type = 'lowpass'; lp.frequency.value = 2400;
        fb.gain.value = 0.3; wet.gain.value = tr.echo;
        s.echo.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(s.out);
        s.nodes.push(s.echo, dl, lp, fb, wet);
      }
      return s;
    }
    _drop(fade){
      const s = this.cur;
      this.cur = null;
      if(!s || !window.SFX || !SFX.ctx) return;
      const now = SFX.ctx.currentTime, end = now + fade;
      [s.out.gain, s.rv.gain].forEach(function(p){
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(0, end);
      });
      const cut = end + 0.02;
      s.live.forEach(function(o){ try{ if(!(o.end <= cut)) o.stop(cut); }catch(e){} });
      setTimeout(function(){
        s.nodes.forEach(function(n){ try{ n.disconnect(); }catch(e){} });
      }, (fade + 0.3) * 1000);
    }
    _fx(s, key){
      if(s.fx[key]) return s.fx[key];
      const c = SFX.ctx, cfg = FX[key], f = c.createBiquadFilter(), post = c.createGain();
      f.type = 'lowpass'; f.frequency.value = cfg.lp; f.Q.value = cfg.q;
      post.gain.value = cfg.post;
      let input = f;
      if(cfg.shape){
        const sh = c.createWaveShaper();
        sh.curve = this._curve(cfg.shape); sh.oversample = '2x';
        sh.connect(f); input = sh; s.nodes.push(sh);
      }
      f.connect(post); post.connect(s.out);
      if(cfg.rv) post.connect(s.rv);
      if(cfg.echo && s.echo) post.connect(s.echo);
      s.nodes.push(f, post);
      return (s.fx[key] = input);
    }
    _curve(k){
      if(this.curves[k]) return this.curves[k];
      const n = 1024, a = new Float32Array(n), norm = Math.tanh(k);
      for(let i = 0; i < n; i++) a[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / norm;
      return (this.curves[k] = a);
    }
    // Stereo room impulse: noise that darkens as it decays (~2 s).
    _ir(c){
      const sr = c.sampleRate, n = Math.floor(sr * 2.2), b = c.createBuffer(2, n, sr);
      for(let ch = 0; ch < 2; ch++){
        const d = b.getChannelData(ch);
        let lp = 0;
        for(let i = 0; i < n; i++){
          const x = i / sr;
          lp += (0.6 - 0.24 * x) * ((Math.random() * 2 - 1) - lp);
          d[i] = lp * Math.exp(-x * 3.2) * (x < 0.015 ? x / 0.015 : 1);
        }
      }
      return b;
    }

    // ---- instruments (s = playing instance, t = audio time) ----
    _phrase(s, bar, p, play){
      if(!bar) return;
      for(let k = 0; k < bar.length; k++) if(bar[k][0] === p) play(bar[k][1], bar[k][2] * s.step);
    }
    _hz(m){ return 440 * Math.pow(2, (m + this.trans - 69) / 12); }
    // Pitched oscillator, tracked so transpose can retune it and a switch can cut it.
    // `tail` nodes are disconnected (functions called) when it ends.
    _osc(s, type, m, det, t, end, dest, tail){
      const o = SFX.ctx.createOscillator();
      o.type = type;
      o.frequency.value = this._hz(m);
      o.detune.value = det;
      o.det0 = det; o.tr0 = this.trans; o.end = end;
      o.connect(dest);
      o.start(t); o.stop(end);
      s.live.add(o);
      o.onended = function(){
        s.live.delete(o);
        o.disconnect();
        if(tail) tail.forEach(function(n){ if(typeof n === 'function') n(); else n.disconnect(); });
      };
      return o;
    }
    // Vibrato: one free-running LFO per track and rate feeds a per-note depth gain
    // (cents). Returns [depth gain, cleanup for the note's tail].
    _vib(s, rate, depth, t, ramp){
      const c = SFX.ctx;
      let o = s.lfo[rate];
      if(!o){
        o = s.lfo[rate] = c.createOscillator();
        o.frequency.value = rate;
        o.start();
        s.live.add(o); s.nodes.push(o);
      }
      const g = c.createGain();
      if(ramp){ g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(depth, t + ramp); }
      else g.gain.value = depth;
      o.connect(g);
      return [g, function(){ try{ o.disconnect(g); }catch(e){} g.disconnect(); }];
    }
    // Linear attack a, then exponential decay with time constant k.
    _env(t, v, a, k){
      const g = SFX.ctx.createGain(), p = g.gain;
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(v, t + a);
      p.setTargetAtTime(0, t + a, k);
      return g;
    }
    // Attack a, hold until d, release over ~r.
    _sus(t, v, a, d, r){
      const g = SFX.ctx.createGain(), p = g.gain;
      d = Math.max(d, a);
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(v, t + a);
      p.setValueAtTime(v, t + d);
      p.setTargetAtTime(0, t + d, r / 5);
      return g;
    }
    // Music box: sine plus tine partials x4 and x5.95, short decay, slightly worn tuning.
    _box(s, m, t, v){
      const det = (Math.random() - 0.5) * 10;
      const g = this._env(t, v, 0.003, 0.5), g2 = this._env(t, v * 0.25, 0.002, 0.12), g3 = this._env(t, v * 0.12, 0.002, 0.06);
      g.connect(s.out); g2.connect(s.out); g3.connect(s.out);
      g.connect(s.rv); g2.connect(s.rv);
      if(s.echo) g.connect(s.echo);
      this._osc(s, 'sine', m, det, t, t + 2.6, g, [g]);
      this._osc(s, 'sine', m + 24, det, t, t + 0.75, g2, [g2]);
      this._osc(s, 'sine', m + 30.87, det, t, t + 0.4, g3, [g3]);
    }
    // Bell: partials 1 / 2 / 2.76 / 5.4, upper ones die first.
    _bell(s, m, t, v, ring){
      [[0, 1, 1], [12, 0.55, 0.6], [17.58, 0.4, 0.4], [29.19, 0.22, 0.22]].forEach((pp) => {
        const k = ring * pp[2] / 5, g = this._env(t, v * pp[1], 0.002, k);
        g.connect(s.out); g.connect(s.rv);
        this._osc(s, 'sine', m + pp[0], 0, t, t + k * 6, g, [g]);
      });
    }
    // Organ: two saws per note at +-7 cents through one lowpass.
    _organ(s, notes, t, d, v, lp){
      const c = SFX.ctx, f = c.createBiquadFilter(), g = this._sus(t, v, 0.025, d, 0.15), end = t + d + 0.2;
      f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.6;
      f.connect(g); g.connect(s.out); g.connect(s.rv);
      notes.forEach((m, i) => {
        this._osc(s, 'sawtooth', m, -7, t, end, f, null);
        this._osc(s, 'sawtooth', m, 7, t, end, f, i === notes.length - 1 ? [f, g] : null);
      });
    }
    // Choir: four sines per note at 0 / +-6 / +12 cents, bandpass 700 Hz, 5 Hz vibrato.
    _choir(s, notes, t, d, v){
      const c = SFX.ctx, f = c.createBiquadFilter(), end = t + d + 0.6;
      const g = this._sus(t, v, Math.min(0.4, d * 0.3), d, 0.5);
      f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7;
      f.connect(g); g.connect(s.out); g.connect(s.rv);
      const vib = this._vib(s, 5, 10, t, 0);
      notes.forEach((m, i) => {
        [0, 6, -6, 12].forEach((dt, j) => {
          const last = i === notes.length - 1 && j === 3;
          vib[0].connect(this._osc(s, 'sine', m, dt, t, end, f, last ? [f, g, vib[1]] : null).detune);
        });
      });
    }
    _pad(s, notes, type, t, a, d, r, v){
      const g = this._sus(t, v, a, d, r), end = t + d + r;
      g.connect(s.out); g.connect(s.rv);
      notes.forEach((m, i) => this._osc(s, type, m, i * 3, t, end, g, i === notes.length - 1 ? [g] : null));
    }
    _bass(s, m, t, d, v, type, dest){
      const g = this._sus(t, v, 0.005, d, 0.06);
      g.connect(dest);
      this._osc(s, type, m, 0, t, t + d + 0.08, g, [g]);
    }
    _lead(s, m, t, d, v, voices, dest, vib){
      const g = this._sus(t, v, 0.01, d, 0.1), end = t + d + 0.12;
      g.connect(dest);
      const lv = vib && d > 0.3 ? this._vib(s, 5.5, vib, t, Math.min(0.35, d * 0.6)) : null;
      voices.forEach((vc, i) => {
        const tail = i === voices.length - 1 ? (lv ? [g, lv[1]] : [g]) : null;
        const o = this._osc(s, vc[0], m + vc[1], vc[2], t, end, g, tail);
        if(lv) lv[0].connect(o.detune);
      });
    }
    _pluck(s, m, t, v, k, type, dest){
      const g = this._env(t, v, 0.002, k);
      g.connect(dest);
      this._osc(s, type, m, 0, t, t + k * 6, g, [g]);
    }
    // Keeper horn: a soft saw through a dark lowpass, swelling in.
    _horn(s, m, t, d, v){
      const g = this._sus(t, v, 0.07, d, 0.2);
      g.connect(this._fx(s, 'horn'));
      this._osc(s, 'sawtooth', m, 0, t, t + d + 0.25, g, [g]);
    }
    _kick(s, t, v){
      const c = SFX.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.01, 0.1);
      o.connect(g); g.connect(s.out);
      o.start(t); o.stop(t + 0.6);
      o.onended = function(){ o.disconnect(); g.disconnect(); };
      this._noise(s, t, 'highpass', 2500, 0.7, 0.006, v * 0.25);
    }
    _snare(s, t, v){
      const c = SFX.ctx, o = c.createOscillator(), g = this._env(t, v * 0.35, 0.002, 0.04);
      o.type = 'triangle';
      o.frequency.setValueAtTime(210, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
      o.connect(g); g.connect(s.out);
      o.start(t); o.stop(t + 0.3);
      o.onended = function(){ o.disconnect(); g.disconnect(); };
      this._noise(s, t, 'bandpass', 1900, 0.8, 0.055, v);
    }
    _hat(s, t, v, k){ this._noise(s, t, 'highpass', 7000, 0.8, k || 0.022, v); }
    // Chain percussion: two quick narrow-band clinks.
    _chain(s, t, v){
      this._noise(s, t, 'bandpass', 3500, 8, 0.035, v);
      this._noise(s, t + 0.028, 'bandpass', 3900, 8, 0.025, v * 0.6);
    }
    _crash(s, t, v){ this._noise(s, t, 'highpass', 4500, 0.6, 0.45, v, true); }
    _noise(s, t, type, f, q, k, v, wet){
      const c = SFX.ctx, src = c.createBufferSource(), fl = c.createBiquadFilter(), g = this._env(t, v, 0.001, k);
      src.buffer = SFX.noiseBuf; src.loop = true;
      fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      src.connect(fl); fl.connect(g); g.connect(s.out);
      if(wet) g.connect(s.rv);
      src.start(t, Math.random() * 0.9);
      src.stop(t + k * 6 + 0.01);
      src.onended = function(){ src.disconnect(); fl.disconnect(); g.disconnect(); };
    }
  }

  window.Music = new MusicEngine();
})();
