'use strict';

class SfxEngine {
  constructor(){
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
    this.last = {};
    this.flameSrc = null;
    this.flameGain = null;
    this.flameFilt = null;
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
    this.master.gain.value = this.muted ? 0 : 0.5;
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
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11;
    const lg = c.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start();
  }
  setMuted(m){
    this.muted = m;
    if(this.master) this.master.gain.value = m ? 0 : 0.5;
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
    this.flameSrc = src; this.flameGain = g; this.flameFilt = f;
  }
  flameOff(){
    if(!this.flameSrc || !this.ctx) return;
    const c = this.ctx, g = this.flameGain, s = this.flameSrc;
    g.gain.setTargetAtTime(0, c.currentTime, 0.05);
    setTimeout(function(){ try{ s.stop(); }catch(e){} }, 300);
    this.flameSrc = null; this.flameGain = null; this.flameFilt = null;
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
  heart(){
    this.tone({ f: 55, f2: 40, d: 0.15, v: 0.24 });
    this.tone({ f: 55, f2: 42, d: 0.16, at: 0.18, v: 0.18 });
  }
}
window.SFX = new SfxEngine();
