'use strict';

class SfxEngine {
  constructor(){
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.last = {};
    this.flameSrc = null;
    this.flameGain = null;
  }
  init(){
    if(this.ctx){
      if(this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._drone();
  }
  _drone(){
    const c = this.ctx;
    const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = 52;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 52.6;
    const g = c.createGain(); g.gain.value = 0.045;
    this.droneGain = g;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11;
    const lg = c.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start();
  }
  gate(name, ms){
    const n = performance.now();
    if(this.last[name] && n - this.last[name] < ms) return false;
    this.last[name] = n;
    return true;
  }
  tone(o){
    if(!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f), t);
    if(o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.d || 0.2));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.v || 0.2, t + (o.a || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.d || 0.2));
    osc.connect(g); g.connect(this.master);
    osc.start(t);
    osc.stop(t + (o.d || 0.2) + 0.05);
  }
  noiseHit(o){
    if(!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter();
    f.type = o.ft || 'bandpass';
    f.frequency.setValueAtTime(o.f || 800, t);
    if(o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.d || 0.3));
    f.Q.value = o.q || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.v || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.d || 0.3));
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + (o.d || 0.3) + 0.1);
  }
  click(){ if(this.gate('ui', 50)) this.tone({ f: 660, f2: 920, d: 0.09, v: 0.12, type: 'triangle' }); }
  start(){
    this.tone({ f: 196, f2: 392, d: 0.5, v: 0.22, type: 'triangle' });
    this.tone({ f: 98, f2: 196, d: 0.8, v: 0.18, at: 0.12 });
  }
  pick(){ if(this.gate('pick', 70)) this.tone({ f: 880 + Math.random() * 240, f2: 1350, d: 0.12, v: 0.1, type: 'triangle' }); }
  oilPick(){ if(this.gate('oil', 120)) this.tone({ f: 392, f2: 660, d: 0.2, v: 0.14 }); }
  wickPick(){
    this.tone({ f: 523, f2: 784, d: 0.2, v: 0.14 });
    this.tone({ f: 659, f2: 988, d: 0.26, v: 0.1, at: 0.06 });
  }
  hitE(){ if(this.gate('hitE', 60)) this.tone({ f: 300, f2: 180, d: 0.07, v: 0.1, type: 'square' }); }
  kill(){
    this.tone({ f: 220, f2: 55, d: 0.26, v: 0.2, type: 'sawtooth' });
    this.noiseHit({ f: 900, f2: 200, d: 0.2, v: 0.15 });
  }
  hurt(){
    this.tone({ f: 160, f2: 65, d: 0.3, v: 0.28, type: 'sawtooth' });
    this.noiseHit({ f: 300, f2: 80, d: 0.25, v: 0.18, ft: 'lowpass' });
  }
  dash(){ this.noiseHit({ f: 600, f2: 2400, d: 0.16, v: 0.13 }); }
  surge(){
    this.tone({ f: 70, f2: 38, d: 0.5, v: 0.36 });
    this.noiseHit({ f: 250, f2: 90, d: 0.45, v: 0.28, ft: 'lowpass' });
  }
  flameOn(){
    if(this.flameSrc || !this.ctx) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    g.gain.linearRampToValueAtTime(0.2, c.currentTime + 0.09);
    this.flameSrc = src; this.flameGain = g;
  }
  flameOff(){
    if(!this.flameSrc || !this.ctx) return;
    const c = this.ctx, g = this.flameGain, s = this.flameSrc;
    g.gain.setTargetAtTime(0, c.currentTime, 0.05);
    setTimeout(function(){ try{ s.stop(); }catch(e){} }, 300);
    this.flameSrc = null; this.flameGain = null;
  }
  gateOpen(){
    [262, 330, 392].forEach(function(f, i){
      SFX.tone({ f: f, f2: f * 1.02, d: 0.45, v: 0.14, at: i * 0.1, type: 'triangle' });
    });
  }
  floor(){
    this.tone({ f: 131, f2: 98, d: 0.6, v: 0.22 });
    this.noiseHit({ f: 200, f2: 60, d: 0.5, v: 0.14, ft: 'lowpass' });
  }
  upgrade(){
    [523, 659, 784, 1047].forEach(function(f, i){
      SFX.tone({ f: f, d: 0.2, v: 0.1, at: i * 0.07, type: 'triangle' });
    });
  }
  ability(){
    this.tone({ f: 330, f2: 990, d: 0.25, v: 0.14, type: 'triangle' });
    this.noiseHit({ f: 1200, f2: 300, d: 0.25, v: 0.1 });
  }
  // One letter of boss speech.
  voice(f){
    if(!this.gate('voice', 28)) return;
    this.tone({ f: f * (0.96 + Math.random() * 0.08), d: 0.05, v: 0.055, type: 'square' });
  }
  alt(){
    if(!this.gate('alt', 80)) return;
    this.tone({ f: 520, f2: 260, d: 0.12, v: 0.1, type: 'triangle' });
    this.noiseHit({ f: 2200, f2: 700, d: 0.12, v: 0.07 });
  }
  ult(){
    this.tone({ f: 110, f2: 440, d: 0.7, v: 0.22, type: 'sawtooth' });
    this.noiseHit({ f: 400, f2: 3000, d: 0.6, v: 0.16 });
    [523, 784, 1047].forEach(function(f, i){
      SFX.tone({ f: f, d: 0.35, v: 0.09, at: 0.1 + i * 0.08, type: 'triangle' });
    });
  }
  power(){
    [440, 554, 659, 880].forEach(function(f, i){
      SFX.tone({ f: f, f2: f * 1.5, d: 0.18, v: 0.1, at: i * 0.05, type: 'triangle' });
    });
  }
  bossRoar(){
    this.tone({ f: 55, f2: 38, d: 1.2, v: 0.38, type: 'sawtooth' });
    this.noiseHit({ f: 120, f2: 40, d: 1, v: 0.28, ft: 'lowpass' });
  }
  snuff(){
    this.tone({ f: 420, f2: 55, d: 0.7, v: 0.24, type: 'sawtooth' });
    this.noiseHit({ f: 500, f2: 60, d: 0.6, v: 0.18, ft: 'lowpass' });
  }
  over(){
    [392, 330, 262, 196].forEach(function(f, i){
      SFX.tone({ f: f, f2: f * 0.94, d: 0.42, v: 0.18, at: i * 0.2, type: 'triangle' });
    });
  }
  win(){
    [262, 330, 392, 523, 659, 784].forEach(function(f, i){
      SFX.tone({ f: f, d: 0.32, v: 0.15, at: i * 0.11, type: 'triangle' });
    });
  }

  // ---- THE WARDEN fight cues ----
  // Filtered one-shot: oscillator (o.type, o.f -> o.f2) or noise (o.noise) through
  // a filter (o.ft, o.ff -> o.ff2, o.q); attack o.a, hold until o.d, release o.r.
  _shaped(o){
    if(!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + (o.at || 0), d = o.d || 0.3, a = Math.min(o.a || 0.01, d), r = o.r || 0.05;
    const v = o.v || 0.2;
    let src;
    if(o.noise){
      src = c.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
    } else {
      src = c.createOscillator();
      src.type = o.type || 'sine';
      src.frequency.setValueAtTime(Math.max(1, o.f), t);
      if(o.f2) src.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + d);
    }
    const f = c.createBiquadFilter();
    f.type = o.ft || 'lowpass';
    f.frequency.setValueAtTime(o.ff || 2000, t);
    if(o.ff2) f.frequency.exponentialRampToValueAtTime(o.ff2, t + d);
    f.Q.value = o.q || 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.setValueAtTime(v, t + d);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + r);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + d + r + 0.05);
  }
  bell(){
    if(!this.ctx || !this.gate('bell', 150)) return;
    this.tone({ f: 196, d: 1.6, v: 0.16 });
    this.tone({ f: 392, d: 1.1, v: 0.08 });
    this.tone({ f: 290, d: 0.8, v: 0.06 });
  }
  // "Blue" cue: stand still.
  chime(){
    if(!this.ctx || !this.gate('chime', 60)) return;
    this.tone({ f: 1320, d: 0.45, v: 0.16, type: 'triangle', a: 0.004 });
    this.tone({ f: 2640, d: 0.22, v: 0.04, a: 0.004 });
  }
  // "Orange" cue: keep moving.
  crackle(){
    if(!this.ctx || !this.gate('crackle', 60)) return;
    for(let i = 0; i < 6; i++){
      this.noiseHit({ f: 1800 * (0.9 + Math.random() * 0.2), q: 1.2, d: 0.04 + Math.random() * 0.03, v: 0.5, at: i * 0.028 + Math.random() * 0.012 });
    }
  }
  horn(){
    if(!this.ctx || !this.gate('horn', 200)) return;
    this._shaped({ type: 'sawtooth', f: 110, d: 0.9, a: 0.12, r: 0.35, v: 0.2, ff: 600, q: 1.2 });
    this._shaped({ type: 'sawtooth', f: 110.7, d: 0.9, a: 0.12, r: 0.35, v: 0.12, ff: 600, q: 1.2 });
  }
  lampCharge(d){
    if(!this.ctx || !this.gate('lamp', 80)) return;
    d = Math.min(5, Math.max(0.1, +d || 1));
    this._shaped({ type: 'sawtooth', f: 300, f2: 900, d: d, a: d * 0.9, r: 0.06, v: 0.08, ff: 1200, ff2: 3500, q: 2 });
  }
  beamFire(){
    if(!this.ctx || !this.gate('beam', 80)) return;
    this.noiseHit({ f: 2600, f2: 500, d: 0.45, v: 0.26, q: 0.6 });
    this.tone({ f: 80, f2: 42, d: 0.5, v: 0.36 });
  }
  chainRattle(){
    if(!this.ctx || !this.gate('chain', 150)) return;
    for(let i = 0; i < 6; i++){
      const at = i * 0.045 + Math.random() * 0.015;
      this.noiseHit({ f: 900 * (0.85 + Math.random() * 0.3), q: 1.6, d: 0.07, v: 0.6, at: at });
      this.noiseHit({ f: 2800 * (0.9 + Math.random() * 0.2), q: 5, d: 0.04, v: 0.35, at: at });
    }
  }
  encounterBlip(){
    if(!this.ctx || !this.gate('blip', 30)) return;
    this.tone({ f: 880, d: 0.035, v: 0.1, type: 'square', a: 0.003 });
  }
  whoosh(){
    if(!this.ctx || !this.gate('whoosh', 60)) return;
    this._shaped({ noise: true, ft: 'bandpass', ff: 3000, ff2: 300, q: 1.1, d: 0.32, a: 0.08, r: 0.06, v: 0.3 });
  }
  candleTick(f){
    if(!this.ctx || !this.gate('tick', 25)) return;
    f = +f;
    this.tone({ f: f > 20 && f < 20000 ? f : 1800, d: 0.03, v: 0.05, type: 'triangle', a: 0.002 });
  }
  slam(){
    if(!this.ctx || !this.gate('slam', 80)) return;
    this.tone({ f: 90, f2: 45, d: 0.55, v: 0.42 });
    this.noiseHit({ f: 3000, f2: 900, d: 0.1, v: 0.3, q: 0.8 });
    this.noiseHit({ f: 240, f2: 60, d: 0.4, v: 0.26, ft: 'lowpass' });
  }
  inhale(d){
    if(!this.ctx || !this.gate('inhale', 200)) return;
    d = Math.min(6, Math.max(0.1, +d || 1));
    this._shaped({ noise: true, ff: 200, ff2: 1200, q: 0.9, d: d, a: d * 0.85, r: 0.12, v: 0.2 });
  }
  glassBreak(){
    if(!this.ctx || !this.gate('glass', 100)) return;
    this.noiseHit({ f: 4000, f2: 2500, d: 0.35, v: 0.28, q: 0.9 });
    this.noiseHit({ f: 7000, d: 0.08, v: 0.2, ft: 'highpass' });
    [1870, 2490, 3320].forEach(function(f, i){
      SFX.tone({ f: f, f2: f * 0.98, d: 0.5 - i * 0.1, v: 0.045, at: 0.01 + i * 0.025 });
    });
  }
  heartbeat(){
    if(!this.ctx || !this.gate('heart', 300)) return;
    this.tone({ f: 62, f2: 45, d: 0.2, v: 0.38 });
    this.tone({ f: 120, f2: 90, d: 0.1, v: 0.06 });
    this.tone({ f: 55, f2: 40, d: 0.24, v: 0.3, at: 0.24 });
  }
  kindle(){
    if(!this.ctx || !this.gate('kindle', 120)) return;
    [587, 740, 880, 1175].forEach(function(f, i){
      SFX.tone({ f: f, f2: f * 1.004, d: 0.8, v: 0.06, at: i * 0.045, type: i % 2 ? 'sine' : 'triangle' });
    });
    this.noiseHit({ f: 6000, d: 0.5, v: 0.04, q: 0.8, at: 0.05 });
  }
  // A swell that cuts off like reversed audio, then a heartbeat.
  refuse(){
    if(!this.ctx || !this.gate('refuse', 400)) return;
    this._shaped({ type: 'triangle', f: 147, f2: 220, d: 0.7, a: 0.7, r: 0.03, v: 0.14, ff: 1500 });
    this._shaped({ noise: true, ff: 300, ff2: 2600, q: 0.8, d: 0.7, a: 0.7, r: 0.03, v: 0.16 });
    this.tone({ f: 62, f2: 45, d: 0.2, v: 0.36, at: 0.78 });
    this.tone({ f: 55, f2: 40, d: 0.24, v: 0.28, at: 1.02 });
  }
  narrClick(){
    if(!this.ctx || !this.gate('narr', 50)) return;
    this.tone({ f: 1200, d: 0.02, v: 0.06, type: 'triangle', a: 0.002 });
  }
  // One letter of Tallow's speech.
  voiceT(){
    if(!this.ctx || !this.gate('voiceT', 28)) return;
    const f = 220 * (0.94 + Math.random() * 0.12);
    this.tone({ f: f, d: 0.06, v: 0.11, a: 0.004 });
    this.tone({ f: f * 2, d: 0.04, v: 0.025, a: 0.004 });
  }
  // Ramp the ambient drone (normal 0.045) to v over s seconds. At 0 it is
  // unplugged once faded, since its LFO would otherwise keep it breathing.
  droneTo(v, s){
    if(!this.ctx || !this.droneGain) return;
    const g = this.droneGain, p = g.gain, now = this.ctx.currentTime;
    v = Math.min(1, Math.max(0, +v || 0));
    s = Math.min(60, Math.max(0.02, +s || 0));
    clearTimeout(this.droneCut);
    if(this.droneOff && v < 0.001) return;
    p.cancelScheduledValues(now);
    if(this.droneOff){
      g.connect(this.master);
      this.droneOff = false;
      p.setValueAtTime(0, now);
    } else p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(v, now + s);
    if(v < 0.001){
      this.droneCut = setTimeout(() => { g.disconnect(); this.droneOff = true; }, s * 1000 + 50);
    }
  }
}
window.SFX = new SfxEngine();
