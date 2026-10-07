'use strict';
const TAU = Math.PI * 2;

function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }
function lerp(a, b, t){ return a + (b - a) * t; }
function rand(a, b){ return a + Math.random() * (b - a); }
function randInt(a, b){ return Math.floor(rand(a, b + 1)); }
function pick(arr){ return arr[(Math.random() * arr.length) | 0]; }
function dist(x1, y1, x2, y2){ return Math.hypot(x2 - x1, y2 - y1); }
function angleTo(x1, y1, x2, y2){ return Math.atan2(y2 - y1, x2 - x1); }
function angleDiff(a, b){
  let d = (a - b) % TAU;
  if(d > Math.PI) d -= TAU;
  if(d < -Math.PI) d += TAU;
  return d;
}

class Rng {
  constructor(seed){ this.s = (seed >>> 0) || 1; }
  next(){
    let t = (this.s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b){ return a + this.next() * (b - a); }
  int(a, b){ return Math.floor(this.range(a, b + 1)); }
  pick(arr){ return arr[this.int(0, arr.length - 1)]; }
  chance(p){ return this.next() < p; }
}

function overlapRects(a, b, pad){
  pad = pad || 0;
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x &&
         a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

function pointInRect(x, y, rc, pad){
  pad = pad || 0;
  return x > rc.x - pad && x < rc.x + rc.w + pad && y > rc.y - pad && y < rc.y + rc.h + pad;
}

function resolveCircleRect(cx, cy, r, rc){
  const px = clamp(cx, rc.x, rc.x + rc.w);
  const py = clamp(cy, rc.y, rc.y + rc.h);
  let dx = cx - px, dy = cy - py;
  const d2 = dx * dx + dy * dy;
  if(d2 >= r * r) return null;
  if(d2 === 0){
    const left = cx - rc.x, right = rc.x + rc.w - cx, top = cy - rc.y, bot = rc.y + rc.h - cy;
    const m = Math.min(left, right, top, bot);
    if(m === left) return { dx: -(left + r), dy: 0 };
    if(m === right) return { dx: right + r, dy: 0 };
    if(m === top) return { dx: 0, dy: -(top + r) };
    return { dx: 0, dy: bot + r };
  }
  const d = Math.sqrt(d2);
  const nx = dx / d, ny = dy / d;
  const push = r - d;
  return { dx: nx * push, dy: ny * push };
}
