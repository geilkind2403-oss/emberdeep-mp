'use strict';

function makeOrb(x, y, vx, vy, dmg, color, r){
  return { x: x, y: y, vx: vx, vy: vy, r: r || 7, dmg: dmg, life: 4, color: color || '#c48aff', kind: 'orb', dead: false };
}

function makeShard(x, y, vx, vy, dmg){
  return { x: x, y: y, vx: vx, vy: vy, r: 5, dmg: dmg, life: 1.7, color: '#ff8a3d', kind: 'shard', dead: false };
}

class Enemy {
  constructor(G, type, x, y){
    const d = ENEMY_DEFS[type];
    const f = G.floor;
    this.type = type;
    this.d = d;
    this.x = x; this.y = y;
    this.r = d.r;
    const hpScale = d.boss ? 1 + 0.16 * Math.max(0, f - CFG.floorMax) : 1 + 0.16 * (f - 1);
    const dmgScale = 1 + 0.09 * (f - 1);
    this.maxHp = Math.round(d.hp * hpScale);
    this.hp = this.maxHp;
    this.dmg = d.dmg * dmgScale;
    this.speed = d.speed * (1 + Math.min(0.5, (f - 1) * 0.015));
    this.isBoss = !!d.boss;
    this.seed = Math.random() * 10;
    this.flash = 0;
    this.kb = { x: 0, y: 0 };
    this.fireCd = rand(1, 2.4);
    this.dead = false;
    this.pat = 'drift';
    this.patT = 2 + Math.random() * 1.5;
    this.tx = x; this.ty = y;
    this.chargeV = { x: 0, y: 0 };
    this.phase = 1;
  }

  moveToward(G, P, ang, sp, dt){
    this.x += Math.cos(ang) * sp * dt + this.kb.x * dt;
    this.y += Math.sin(ang) * sp * dt + this.kb.y * dt;
  }

  constrain(G){
    const w = G.world;
    this.x = clamp(this.x, 18, w.w - 18);
    this.y = clamp(this.y, 18, w.h - 18);
    for(let i = 0; i < w.obstacles.length; i++){
      const hit = resolveCircleRect(this.x, this.y, this.r, w.obstacles[i]);
      if(hit){ this.x += hit.dx; this.y += hit.dy; }
    }
  }

  bossAI(dt, G){
    const P = G.nearestPlayer(this.x, this.y) || G.P;
    const isWarden = this.d.boss === 'warden';
    this.patT -= dt;
    const dx = P.x - this.x, dy = P.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const dirx = dx / d, diry = dy / d;
    this.phase = this.hp > this.maxHp * 0.66 ? 1 : (this.hp > this.maxHp * 0.33 ? 2 : 3);
    const fast = this.phase >= 3;

    switch(this.pat){
      case 'drift': {
        const sp = (isWarden ? 58 : 86) * (fast ? 1.5 : 1);
        const wob = Math.sin(G.t * 1.1 + this.seed) * 0.5;
        const a = Math.atan2(diry, dirx) + wob;
        this.moveToward(G, P, a, sp, dt);
        if(this.patT <= 0){
          const opts = ['charge', 'summon', 'snuff'];
          if(isWarden && this.phase >= 2) opts.push('nova');
          if(fast && Math.random() < 0.4) opts.push('charge');
          const next = pick(opts);
          if(next === 'charge'){ this.pat = 'telegraph'; this.patT = 0.75; this.tx = P.x; this.ty = P.y; }
          else { this.pat = next + 'T'; this.patT = 0.85; }
        }
        break;
      }
      case 'telegraph':
        if(isWarden && fast){ this.tx = lerp(this.tx, P.x, 0.03); this.ty = lerp(this.ty, P.y, 0.03); }
        if(this.patT <= 0){
          this.pat = 'charge';
          this.patT = 0.55;
          const a = Math.atan2(this.ty - this.y, this.tx - this.x);
          this.chargeV = { x: Math.cos(a), y: Math.sin(a) };
          G.shake += 3;
          SFX.noiseHit({ f: 150, f2: 60, d: 0.4, v: 0.25, ft: 'lowpass' });
        }
        break;
      case 'charge': {
        const sp = isWarden ? 740 : 580;
        this.x += (this.chargeV.x * sp + this.kb.x) * dt;
        this.y += (this.chargeV.y * sp + this.kb.y) * dt;
        if(Math.random() < 0.6) G.burst(this.x, this.y, '#2a1430', 1, 30, 5, 0.4);
        if(this.patT <= 0){ this.pat = 'drift'; this.patT = fast ? 0.7 : 1.5 + Math.random() * 0.8; }
        break;
      }
      case 'summonT':
        if(this.patT <= 0){
          const n = isWarden ? 2 + this.phase : 3;
          G.bossSummon(this, n);
          this.pat = 'drift';
          this.patT = fast ? 1 : 2;
        }
        break;
      case 'snuffT':
        if(this.patT <= 0){
          G.snuffPlayer(isWarden ? 5 : 4, isWarden ? 16 : 10, this, P);
          this.pat = 'drift';
          this.patT = 2.2;
        }
        break;
      case 'novaT':
        if(this.patT <= 0){
          G.bossNova(this, 8 + this.phase * 4);
          this.pat = 'drift';
          this.patT = 1.6;
        }
        break;
    }
  }

  update(dt, G){
    if(this.dead) return;
    const P = G.nearestPlayer(this.x, this.y) || G.P;
    if(!P) return;
    this.flash = Math.max(0, this.flash - dt);
    const k = Math.exp(-5 * dt);
    this.kb.x *= k; this.kb.y *= k;

    const dx = P.x - this.x, dy = P.y - this.y;
    let d = Math.hypot(dx, dy) || 1;

    if(this.isBoss){
      this.bossAI(dt, G);
    } else {
      const ang = Math.atan2(dy, dx) + Math.sin(G.t * 1.3 + this.seed) * 0.55;
      let sp = this.speed;
      if(this.d.ranged){
        if(d > 380) sp *= 1.15;
        else if(d < 210) sp *= -0.75;
        else sp *= 0.2;
        this.fireCd -= dt;
        if(this.fireCd <= 0 && d < 540){
          this.fireCd = this.d.fireCd;
          const a = Math.atan2(dy, dx);
          const ps = this.d.projSpeed;
          G.shots.push(makeOrb(this.x + Math.cos(a) * 16, this.y + Math.sin(a) * 16, Math.cos(a) * ps, Math.sin(a) * ps, this.dmg));
        }
      }
      this.moveToward(G, P, ang, sp, dt);
    }
    this.constrain(G);
    d = dist(P.x, P.y, this.x, this.y);

    const lightR = P.lightR * G.lightMult(P);
    if(P.oil > 0 && d < lightR + this.r * 0.5){
      this.hp -= P.burn * dt;
      this.flash = Math.max(this.flash, 0.25);
      if(this.hp <= 0){ G.killEnemy(this, P); return; }
    }

    if(d < this.r + 15){
      G.damagePlayer(this.dmg, this, P);
    }
  }
}
