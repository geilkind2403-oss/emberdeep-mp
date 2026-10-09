'use strict';
/* THE WARDEN (floor 10): an Undertale-style encounter in its own arena.
   WardenBrain (host only) runs the fight as a state machine and emits pattern
   descriptors. Every client keeps a WardenView that rebuilds the same bullets
   from those descriptors over the shared fight clock `bt` (positions are pure
   functions of time, nothing is stepped), draws them and checks hits on its
   own keeper only: blue/orange depend on real input, which only the owner
   knows. Guests report their hits to the host ('ow'), which applies damage. */

const WS = { DORMANT: 0, ENCOUNTER: 1, TALK: 2, ATTACK: 3, OPENING: 4, SHIFT: 5, FAKE: 6, RISE: 7, KINDLE: 8, MERCY: 9, SPARED: 10, SLAIN: 11, RESOLVE: 12, GONE: 13 };
const WK = { RING: 1, WALLS: 2, KEYS: 3, CHARGE: 4, BEAMS: 5, CAGE: 6, BANDS: 7, EYES: 8, FAN: 9, SPIRAL: 10, HAND: 11, GONER: 12 };
const WARDEN = {
  C: { x: 900, y: 860 }, openR: 580, boxT: 0.8, hp: 4000,
  gate: [0.70, 0.40, 0], veil: [0.5, 0.5, 0.6], openMult: 1.5, openingT: [3.0, 2.5, 2.0],
  // Damage as a share of the Warden's hit: orb, large orb, coloured, beam, zone, body.
  F: [0.25, 0.30, 0.35, 0.55, 0.65, 0.75],
  hurtR: 9, solidR: 13, colorGrace: 0.06, hitGap: 0.3, drawCap: 260
};
const WCOL = ['#c58cff', '#7ddcff', '#ff8a3d', '#f4f1ff']; // violet, blue (be still), orange (keep moving), white
const WTRACKS = ['', 'corridor', 'waltz', 'ward', 'tallow', 'wicks', 'rest'];
const WBPM = { corridor: 60, waltz: 96, ward: 120, tallow: 150, wicks: 140, rest: 72 };
const WPHASE_ATTACKS = [null, ['BELL', 'HUSH', 'TRAIL', 'LANTERN'], ['CAGE', 'SCALES', 'LIGHTSOUT', 'SENTENCE'], ['VIGIL', 'HUSHEMBER', 'HAND', 'TOLL']];
const WP4_LOOP = ['LESSON', 'ECHOBELL', 'GONER', 'ECHOSENT', 'LESSON', 'ECHOVIGIL', 'GONER'];
const W_ATTACK_NAMES = { BELL: 'TOLLING BELL', HUSH: 'THE HUSH', TRAIL: 'PROCESSION', LANTERN: 'GAOL LANTERNS', CAGE: 'CAGE OF WICKS', SCALES: 'THE SCALES',
  LIGHTSOUT: 'LIGHTS OUT', SENTENCE: 'SENTENCE', VIGIL: 'THOUSAND-YEAR VIGIL', HUSHEMBER: 'HUSH AND EMBER', HAND: 'WHAT I KEEP', TOLL: 'LAST TOLL',
  LESSON: 'LAST LESSON', ECHOBELL: 'ECHO OF THE BELL', GONER: 'GONER TIDE', ECHOSENT: 'ECHO OF THE SENTENCE', ECHOVIGIL: 'ECHO OF THE VIGIL' };
const W_PILLARS = (function(){
  const out = [];
  for(let k = 0; k < 8; k++){
    const a = (22.5 + k * 45) * Math.PI / 180;
    out.push({ x: 900 + Math.cos(a) * 230 - 24, y: 860 + Math.sin(a) * 230 - 24, w: 48, h: 48 });
  }
  return out;
})();
const DEG = Math.PI / 180;
function wrapA(a){ a = (a + Math.PI) % TAU; return (a < 0 ? a + TAU : a) - Math.PI; }
function wardenBoxR(ph, n){
  const k = Math.max(0, n - 1), R1 = Math.min(440, 320 + 20 * k);
  return ph === 1 ? R1 : ph === 2 ? R1 - 20 : ph === 3 ? R1 - 40 : Math.min(420, 300 + 20 * k);
}

// ---------- Script (English, like the rest of the game) ----------
// who: W Warden, T Tallow, N narrator. f: face glyph. sp: letters per second.
const WLINES = {
  'd.floor': ['N', '* The air down here smells of cold wax.'],
  'd.names': ['N', '* Names are scratched into the floor. Hundreds. The newest are still sharp.'],
  'd.candle': ['N', '* The last candle gutters in the cold. Knowing what waits beyond fills you with {y}RESOLVE{/y}.'],
  'd.idle': ['W', 'Come closer. My eyes aren\'t what they were.', '◇'],
  'i.0': ['N', '* THE WARDEN blocks the way.'],
  'i.1': ['W', 'So. Another lantern on my stair.', '◇'],
  'i.1c': ['W', '{N} lanterns on my stair. You brought a whole sunrise.', '◇'],
  'i.1m': ['W', 'Back again? I remember your light.', '◇'],
  'i.1x': ['W', '...You again. I remember the cold.', '◈'],
  'i.1s': ['W', 'You again. ...Strange. I remember being warm.', '◇'],
  'i.2': ['W', 'Ten floors. {kills} shadows. I felt every single one go out.', '◇'],
  'i.3': ['W', 'Do you know what a beacon is, keeper? A promise. \'Come down. It\'s safe.\'', '◇'],
  'i.4': ['W', 'I snuffed them. All of them. So nobody would believe it again.', '◆'],
  'i.5': ['W', '...And still, you came.', '◇'],
  'i.6keeper': ['W', 'A Wickkeeper. Like me. Like all of them.', '◇'],
  'i.6pyro': ['W', 'A Pyromancer. You\'d burn the whole deep just to stay warm.', '◇'],
  'i.6guardian': ['W', 'A Guardian. Who are you protecting? There\'s no one left.', '◇'],
  'i.6nightblade': ['W', 'A Nightblade. You move like the dark. Careful. It notices.', '◇'],
  'i.6lightbinder': ['W', 'A Lightbinder. A healer. ...Then heal THEM.', '◇'],
  'i.7': ['N', '* Something golden glows at your feet. {y}SPARE{/y}.'],
  'i.8': ['W', 'No. Not that. Not here.', '◆'],
  'i.9': ['N', '* THE WARDEN - ATK 22 DEF 99. Has not slept in a thousand years.'],
  'i.10': ['W', 'Lift your lantern, keeper. Let\'s see how long your oil lasts.', '◆'],
  'p1.bell': ['W', 'Hold still. I\'ll make it quick.'],
  'p1.hush0': ['W', '{b}Blue{/b} is the hush. Be still, and it passes.', '◇'],
  'p1.hush': ['W', 'Be {b}STILL{/b}.'],
  'p1.proc': ['W', 'Walk with me.'],
  'p1.lan0': ['W', 'Mind the lanterns. They mind you.'],
  'p1.op0': ['W', 'You learn quickly. They all did.'],
  'p1.op1': ['W', 'Go on. Hit me. I\'ve been hit before.'],
  'p1.op2': ['W', 'You walk like Margot. She didn\'t listen either.'],
  'p1.blue3': ['W', 'Blue. Means. {b}STILL{/b}.'],
  'i1.1': ['N', '* The Warden\'s lantern flickers. The braziers go out, one by one.'],
  'i1.2': ['W', 'You burn hot. They all burned hot, at first.', '◇'],
  'i1.3': ['W', 'The stair behind you is still there. Go home, keeper. Please.', '◇'],
  'i1.4': ['W', '...No? Then I\'ll make the dark smaller. Small enough that you can\'t get lost in it.', '◆'],
  'i1.5': ['N', '* The WARD closes. The chains are cold to the touch.'],
  'i1.6': ['W', 'Get up. I\'m not finished with you.', '◆'],
  'p2.cage': ['W', 'Smaller. Smaller.'],
  'p2.ember0': ['W', '{o}Orange{/o} is the ember. Keep it burning. Keep moving.', '◇'],
  'p2.scales': ['W', 'Still. Now {o}RUN{/o}.'],
  'p2.lo0': ['W', 'You know what that bar is really counting, don\'t you?'],
  'p2.lo': ['W', 'Can you see me? No? Good.'],
  'p2.relit': ['W', '...You relit it. Of course you did.'],
  'p2.sent': ['W', 'Every light that came down here went OUT.'],
  'p2.op0': ['W', 'Turn AROUND.'],
  'p2.op1': ['W', 'Stop. Stop BURNING them.'],
  'p2.op2': ['W', 'I was a keeper too, you know. I had a name. I had-'],
  'i2.1': ['N', '* The Warden stops. A crack runs through his lantern-glass.'],
  'i2.2': ['W', 'Look at the corner of your eye, keeper. \'Souls claimed.\'', '◈'],
  'i2.3': ['W', 'You\'ve been counting them the whole way down.', '◈'],
  'i2.4': ['W', 'Every shadow, on every floor... was a keeper. Like you. Their oil ran out.', '◈'],
  'i2.5': ['W', 'I couldn\'t bring them back. So I kept them. In here. Every. One.', '◈'],
  'i2.6': ['W', 'My name was {y}TALLOW{/y}. I lit the first beacon.', '◈', 18],
  'i2.7': ['W', 'And I was the first one to go dark.', '◈', 18],
  'i2.8': ['N', '* You feel every shadow you burned watching you.'],
  'i2.9': ['W', '{s}{kills} of them. I won\'t let you burn the rest.{/s}', '◆', 45],
  'p3.vigil': ['W', 'I held the dark for a THOUSAND YEARS!'],
  'p3.he': ['W', 'Hold still. ...Now RUN.'],
  'p3.hand0': ['W', 'That one isn\'t mine - MOVE!'],
  'p3.hand': ['W', 'They\'re pushing. They want OUT.'],
  'p3.toll': ['W', 'Nine hundred and... ninety... nine...'],
  'p3.op0': ['W', 'Why won\'t you just GO OUT?'],
  'p3.op1': ['W', 'Don\'t look at that bar. Look at ME.'],
  'p3.undying': ['W', '{s}NO. NOT YET. I CAN HOLD ON FOR ONE. MORE. MINUTE.{/s}', '◈', 45],
  'b.floor1': ['W', 'Not yet. Let me finish my dance.'],
  'b.floor2': ['W', 'Not yet.'],
  'b.floor3': ['W', 'Don\'t look at that bar. Look at ME.'],
  'b.ult': ['W', 'A little sunrise. How rude.'],
  'b.fall': ['W', 'One less light. Sleep, little sun.'],
  'f.1': ['W', '...Ah. There it is. The cold.', '◈', 18],
  'f.2': ['T', '...keeper? I can\'t... hold them anymore.', '✧'],
  'f.3': ['N', '* The thousand wicks rise.'],
  'f.4': ['T', 'They\'re not angry. They\'re just cold. Like I was.', '✧'],
  'f.5': ['T', 'Don\'t burn them. Find them. Hold your light close.', '✧'],
  'p4.through': ['N', '* Your flame passes right through. There is nothing there to burn.'],
  'p4.goner': ['T', 'It\'s breathing in. Hold on!'],
  'p4.echo': ['T', 'That one was mine. I\'m sorry.'],
  'p4.help': ['T', 'Let me help. Just a little.'],
  'p4.refused': ['N', '* But it refused.'],
  'm.0': ['N', '* The thousand wicks settle. Only a small light is left.'],
  'm.1': ['T', '...So. You found them. All of them.', '✧'],
  'm.2': ['T', 'Go on, keeper. One breath of flame, and it\'s over.', '✧'],
  'm.3': ['T', 'Or... I suppose... you could put that lantern down.', '✧'],
  'm.ask': ['T', '...Is that your answer?'],
  'm.wait1': ['T', '...Take your time. I\'ve waited a thousand years.'],
  's.1': ['T', '...Huh. Nobody ever tried that.', '✧'],
  's.2': ['T', 'Could you share a little? Just a little. I\'ve forgotten what warm feels like.', '✧'],
  's.3': ['T', '...oh. It\'s warm.', '✧', 18],
  's.4': ['T', 'Go on. I\'ll keep the stair lit behind you. That\'s a promise I can keep.', '✧'],
  's.5': ['N', '* TALLOW rests.'],
  'x.0': ['N', '* Someone chose.'],
  'x.1': ['T', '...Right. Of course.', '✧'],
  'x.2': ['T', 'Keep it lit, keeper. Someone has to.', '✧'],
  'x.3': ['N', '* The last light down here goes out with him.'],
  'r.1': ['N', '* Your lantern refuses to go out. Stay {y}RESOLVED{/y}.'],
  'r.2': ['W', 'Back already? I felt you go out. Don\'t do that again.']
};
const WSOULS = [
  'MARGOT · Floor 1, The Drowned Gallery · "First one down after Tallow. Told him I\'d be fine."',
  'BRAM · Floor 2, The Candle Warrens · "Three steps from the vent. Three."',
  'PIP · Floor 4, Hall of Small Teeth · "I wasn\'t scared. I just wanted to go home."',
  'ISOLDE · Floor 5, The Withheld Choir · "We sang so the dark would know where we were."',
  'EDDA · Floor 6, Brine Vaults · "Tell my sister the water was warm."',
  'WREN · Floor 8, Reliquary of Ash · "Keep it lit. Someone has to."',
  'OLD CALLOWAY · Floor 9, The Long Grief · "I only sat down to rest."',
  'HOB · Floor 3, Gilt Silt · "It was shiny. It was so shiny."',
  'SABLE · Floor 7, The Hushing · "I was quiet. It found me anyway."',
  'CORIN · Floor 2 · "I came back for the others."',
  'LOTTE · Floor 4 · "It sounded like my mother."',
  'TAMSIN · Floor 6 · "The tide took my oil. Then the rest."',
  'ANSEL · Floor 5 · "I carried two lanterns. Neither was enough."',
  'FENWICK · Floor 9 · "I counted to a thousand. Then I stopped."'
];
const WVOICE = { W: 98, T: 220, N: 0 };

// Letters per second, punctuation pauses and the hold after the last letter:
// the host paces scenes with this, the DOM box types with the same numbers.
function talkTokens(text){
  const out = [];
  let cls = '', i = 0;
  while(i < text.length){
    if(text[i] === '{'){
      const end = text.indexOf('}', i);
      if(end > i){
        const tag = text.slice(i + 1, end);
        if(tag === '|') out.push({ pause: 0.4 });
        else if(tag[0] === '/') cls = '';
        else cls = tag;
        i = end + 1;
        continue;
      }
    }
    out.push({ ch: text[i], cls: cls });
    i++;
  }
  return out;
}
function talkCharDelay(tok, sp){
  if(tok.pause) return tok.pause;
  const ch = tok.ch;
  return ch === '.' || ch === '!' || ch === '?' ? 0.28 : ch === ',' ? 0.12 : 1 / sp;
}
function talkDur(text, sp){
  const toks = talkTokens(text);
  let d = 0, n = 0;
  toks.forEach(function(t){ d += talkCharDelay(t, sp || 32); if(t.ch) n++; });
  return d + 0.9 + n * 0.02;
}

// Remembers the encounter across runs: greetings change, the title remembers.
const WardenMemory = {
  load(){
    try{ return Object.assign({ met: 0, spared: 0, slain: 0, last: '' }, JSON.parse(localStorage.getItem('emberdeep_warden') || '{}')); }
    catch(e){ return { met: 0, spared: 0, slain: 0, last: '' }; }
  },
  save(m){ try{ localStorage.setItem('emberdeep_warden', JSON.stringify(m)); }catch(e){} }
};

// ---------- Deterministic pattern builders ----------
function rayRectT(x, y, vx, vy, o){
  let t0 = 0, t1 = Infinity;
  if(Math.abs(vx) < 1e-9){ if(x < o.x || x > o.x + o.w) return Infinity; }
  else {
    let a = (o.x - x) / vx, b = (o.x + o.w - x) / vx;
    if(a > b){ const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  if(Math.abs(vy) < 1e-9){ if(y < o.y || y > o.y + o.h) return Infinity; }
  else {
    let a = (o.y - y) / vy, b = (o.y + o.h - y) / vy;
    if(a > b){ const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t0 <= t1 ? t0 : Infinity;
}
// Time until a straight mover leaves the circle of radius L around the hall centre.
function circleExitT(x, y, vx, vy, L){
  const C = WARDEN.C, px = x - C.x, py = y - C.y;
  const a = vx * vx + vy * vy, b = 2 * (px * vx + py * vy), c = px * px + py * py - L * L;
  const disc = b * b - 4 * a * c;
  if(a < 1e-9 || disc < 0) return 0;
  return Math.max(0, (-b + Math.sqrt(disc)) / (2 * a));
}
function linBullet(ts, x, y, ang, sp, r, col, fi, R, pm, life){
  const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
  let u = Math.min(life || 99, circleExitT(x, y, vx, vy, R + 20));
  for(let k = 0; k < 8 && pm; k++){
    if((pm >> k) & 1){ const t = rayRectT(x, y, vx, vy, W_PILLARS[k]); if(t < u) u = t; }
  }
  return { ts: ts, te: ts + u, kt: Infinity, mo: 0, x0: x, y0: y, vx: vx, vy: vy, r: r, col: col, f: fi };
}
function bulletPos(b, u, out){
  const w = u - b.ts;
  if(b.mo === 0){ out.x = b.x0 + b.vx * w; out.y = b.y0 + b.vy * w; return out; }
  const rr = b.r0 + b.vr * w;
  let a = b.a0 + b.w * w;
  if(b.mo === 2) a += b.amp * Math.sin(TAU * b.hz * w + b.ph);
  else if(b.mo === 3) a = b.a0 + b.lw * Math.log(b.r0 / Math.max(1, rr));
  out.x = b.cx + Math.cos(a) * rr; out.y = b.cy + Math.sin(a) * rr;
  return out;
}
function ringGapSkip(off, half){ return half > 0 && Math.abs(wrapA(off)) < half - 1e-6; }

const WBUILD = {};
WBUILD[WK.RING] = function(d, o){
  // q: rings, interval, slots, gapSlots, gapStepDeg, speed, orbR, col, fi, wedge, spawnR, swell
  const q = d.q, sp = q[5] * d.v / 100, slotW = TAU / q[2], half = q[3] * slotW / 2;
  for(let j = 0; j < q[0]; j++){
    const ts = q[11] + j * q[1], gc = (d.a + j * q[4]) * DEG;
    for(let i = 0; i < q[2]; i++){
      const off = (i + 0.5) * slotW;
      if(ringGapSkip(off, half)) continue;
      const ang = gc + off;
      o.b.push(linBullet(ts, d.x + Math.cos(ang) * q[10], d.y + Math.sin(ang) * q[10], ang, sp, q[6], q[7], q[8], d.R, d.pm, 9));
    }
    if(q[9]) o.h.push({ ty: 'wedge', tw: ts - 0.7, te: ts + 0.25, x: d.x, y: d.y, a: gc, half: half });
  }
  if(q[11]) o.h.push({ ty: 'swell', tw: Math.max(0, q[11] - 1.5), te: q[11], x: d.x, y: d.y });
};
WBUILD[WK.WALLS] = function(d, o){
  // q: speed, thick, n, then (delay, angleDeg, col) per wall
  const sp = d.q[0] * d.v / 100, L = d.R + 20;
  for(let j = 0; j < d.q[2]; j++){
    const del = d.q[3 + j * 3], a = d.q[4 + j * 3] * DEG, col = d.q[5 + j * 3];
    o.h.push({ ty: 'wall', tw: del - 0.8, ts: del, te: del + 2 * L / sp, nx: Math.cos(a), ny: Math.sin(a), cx: d.x, cy: d.y,
      d0: -L, vd: sp, thick: d.q[1], col: col, f: col ? 2 : 1, L: L });
  }
};
WBUILD[WK.KEYS] = function(d, o){
  // q: count, drift speed. White keys sink from the far edge across the hall.
  const rng = new Rng(d.s), n = d.q[0], a = d.a * DEG, nx = Math.cos(a), ny = Math.sin(a), sp = d.q[1] * d.v / 100;
  for(let i = 0; i < n; i++){
    const u = (-0.8 + 1.6 * (i + 0.5) / n) * d.R + rng.range(-20, 20);
    const sx = d.x - nx * (d.R - 20) - ny * u, sy = d.y - ny * (d.R - 20) + nx * u;
    const b = linBullet(0.8, sx, sy, a, sp, 7, 3, 0, d.R, 0, 2 * d.R / sp);
    b.tw = 0;
    o.b.push(b);
  }
};
WBUILD[WK.CHARGE] = function(d, o){
  // q: length, speed, warn. The Warden himself charges; wax wicks along the path fire later.
  const a = d.a * DEG, len = d.q[0], dur = len / (d.q[1] * d.v / 100), warn = d.q[2];
  const x1 = d.x + Math.cos(a) * len, y1 = d.y + Math.sin(a) * len;
  o.h.push({ ty: 'solid', tw: 0, ts: warn, te: warn + dur, x0: d.x, y0: d.y, x1: x1, y1: y1, rad: 46, f: 5 });
  for(let s = 60; s < len; s += 60){
    const wx = d.x + Math.cos(a) * s, wy = d.y + Math.sin(a) * s, fire = warn + dur + 0.5;
    o.h.push({ ty: 'wick', tw: warn + dur * s / len, te: fire, x: wx, y: wy });
    [-1, 1].forEach(function(side){ o.b.push(linBullet(fire, wx, wy, a + side * Math.PI / 2, 120 * d.v / 100, 6, 0, 0, d.R, d.pm, 1.8)); });
  }
};
WBUILD[WK.BEAMS] = function(d, o){
  // q: warn, fire, width, n, then (x, y, angleDeg) per lantern
  const warn = d.q[0], fire = d.q[1], len = 2 * d.R + 60;
  for(let j = 0; j < d.q[3]; j++){
    const x = d.q[4 + j * 3], y = d.q[5 + j * 3], a = d.q[6 + j * 3] * DEG;
    o.h.push({ ty: 'beam', tw: 0, tf: warn, te: warn + fire, tg: warn + fire + 0.25, x: x, y: y, a: a, w: d.q[2], len: len, f: 3 });
  }
};
WBUILD[WK.CAGE] = function(d, o){
  // q: R0, Rmin, shrink, hold, grow, salvos, interval, speed, bandAt, bandSpeed, gapDeg
  const q = d.q, sp = q[7] * d.v / 100, C = WARDEN.C;
  const boxAt = function(u){
    const a = 0.6, b = a + q[2], c = b + q[3], e = c + q[4];
    return u < a ? q[0] : u < b ? lerp(q[0], q[1], (u - a) / q[2]) : u < c ? q[1] : u < e ? lerp(q[1], q[0], (u - c) / q[4]) : q[0];
  };
  o.h.push({ ty: 'rim', tw: 0, te: 0.6, r: q[0] });
  for(let s = 0; s < q[5]; s++){
    const ts = 0.6 + s * q[6], sr = boxAt(ts) + 17;
    for(let j = 0; j < 8; j++){
      const a = (d.a + j * 45 + (s % 2) * 22.5) * DEG, x = C.x + Math.cos(a) * sr, y = C.y + Math.sin(a) * sr;
      o.b.push(linBullet(ts, x, y, a + Math.PI, sp, 7, 0, 0, d.R + 40, 0, (sr - 50) / sp));
      o.h.push({ ty: 'wickglow', tw: ts - 0.45, te: ts, x: x, y: y });
    }
  }
  const r0 = boxAt(q[8]) + 12;
  o.h.push({ ty: 'band', tw: q[8] - 0.8, ts: q[8], te: q[8] + (r0 - 40) / q[9], cx: C.x, cy: C.y, r0: r0, vr: -q[9], thick: 14, col: 0,
    gapA: (d.a + 180) * DEG, gapW: q[10] * DEG, f: 1 });
  o.boxAt = boxAt;
};
WBUILD[WK.BANDS] = function(d, o){
  // q: r0, vr, thick, gapWDeg, n, then (delay, col, gapDeg) per band
  const q = d.q, vr = q[1] * d.v / 100;
  for(let j = 0; j < q[4]; j++){
    const del = q[5 + j * 3], col = q[6 + j * 3];
    const off = dist(d.x, d.y, WARDEN.C.x, WARDEN.C.y);
    const reach = vr > 0 ? off + d.R + 20 - q[0] : q[0] - 30;
    o.h.push({ ty: 'band', tw: del - 0.8, ts: del, te: del + reach / Math.abs(vr), cx: d.x, cy: d.y, r0: q[0], vr: vr, thick: q[2], col: col,
      gapA: q[7 + j * 3] * DEG, gapW: q[3] * DEG, f: col ? 2 : 1 });
  }
};
WBUILD[WK.EYES] = function(d, o){
  // q: slots, gapSlots, gap1Deg, gap2Deg, gap3Deg, speed, wobble, hz. The eyes open 0.8 s before they bite.
  const q = d.q, slotW = TAU / q[0], half = q[1] * slotW / 2, rimR = d.R + 18, sp = q[5] * d.v / 100, C = WARDEN.C;
  for(let i = 0; i < q[0]; i++){
    const a = i * slotW;
    if(ringGapSkip(a - q[2] * DEG, half) || ringGapSkip(a - q[3] * DEG, half) || ringGapSkip(a - q[4] * DEG, half)) continue;
    o.b.push({ ts: 0.8, te: 0.8 + (rimR - 50) / sp, kt: Infinity, tw: 0, mo: 2, cx: C.x, cy: C.y, r0: rimR, vr: -sp, a0: a, w: 0,
      amp: q[6], hz: q[7], ph: i * 1.7, r: 8, col: 0, f: 0, eye: 1 });
  }
};
WBUILD[WK.FAN] = function(d, o){
  // q: warn, count, spreadDeg, speed, orbR
  const q = d.q, a = d.a * DEG;
  o.h.push({ ty: 'eye', tw: 0, te: q[0], x: d.x, y: d.y, a: a });
  for(let i = 0; i < q[1]; i++){
    o.b.push(linBullet(q[0], d.x, d.y, a + (i - (q[1] - 1) / 2) * q[2] * DEG, q[3] * d.v / 100, q[4], 0, 0, d.R, d.pm, 4));
  }
};
WBUILD[WK.SPIRAL] = function(d, o){
  // q: armsA, rotA, armsB, rotB, every, speed, spawnR, seg1, pause, seg2, tele
  const q = d.q, sp = q[5] * d.v / 100, groups = [[q[0], q[1], 0], [q[2], q[3], 90]];
  const angles = [];
  groups.forEach(function(g){
    for(let i = 0; i < g[0]; i++){
      const base = (d.a + g[2] + i * 360 / g[0]) * DEG, rot = g[1] * DEG;
      angles.push([base, rot]);
      for(let t = 0; t < q[7] + q[8] + q[9] - 1e-6; t += q[4]){
        if(t > q[7] - 1e-6 && t < q[7] + q[8] - 1e-6) continue;
        const ang = t <= q[7] ? base + rot * t : base + rot * q[7] - rot * (t - q[7] - q[8]);
        o.b.push(linBullet(q[10] + t, d.x + Math.cos(ang) * q[6], d.y + Math.sin(ang) * q[6], ang, sp, 6, 0, 0, d.R, d.pm, 6));
      }
    }
  });
  o.h.push({ ty: 'guide', tw: 0, te: q[10], x: d.x, y: d.y, arms: angles, len: d.R });
};
WBUILD[WK.HAND] = function(d, o){
  // q: warn, radius, ringN, ringSpeed. A hand from outside the Ward slams where you stood.
  const q = d.q;
  o.h.push({ ty: 'zone', tw: 0, th: q[0], te: q[0] + 0.15, x: d.x, y: d.y, r: q[1], f: 4 });
  for(let i = 0; i < q[2]; i++){
    const a = (d.a + i * 360 / q[2]) * DEG;
    o.b.push(linBullet(q[0] + 0.15, d.x, d.y, a, q[3] * d.v / 100, 7, 0, 0, d.R, 0, 3));
  }
};
WBUILD[WK.GONER] = function(d, o){
  // q: R0, inward speed, swirl, n, spawnSpan, exhaleAt, slots, gapSlots, exhaleSpeed, pullDur, pullSpeed
  const q = d.q, C = WARDEN.C;
  for(let j = 0; j < q[3]; j++){
    const ts = j * q[4] / q[3];
    o.b.push({ ts: ts, te: ts + (q[0] - 60) / q[1], kt: Infinity, mo: 3, cx: C.x, cy: C.y, r0: q[0], vr: -q[1], a0: (d.a + j * 15) * DEG, w: 0, lw: q[2], r: 7, col: 0, f: 0 });
  }
  o.h.push({ ty: 'pull', tw: 0, ts: 0, te: q[9], v: q[10] });
  const slotW = TAU / q[6], half = q[7] * slotW / 2, g = d.a * DEG;
  for(let i = 0; i < q[6]; i++){
    const off = (i + 0.5) * slotW;
    if(ringGapSkip(off, half) || ringGapSkip(off - Math.PI, half)) continue;
    const a = g + off;
    o.b.push(linBullet(q[5], C.x + Math.cos(a) * 30, C.y + Math.sin(a) * 30, a, q[8] * d.v / 100, 7, 0, 0, d.R, 0, 4));
  }
};
function buildPattern(d){
  const o = { b: [], h: [], dur: 0 };
  const fn = WBUILD[d.k];
  if(fn) fn(d, o);
  if(o.b.length > 200) o.b.length = 200;
  o.b.forEach(function(b){ o.dur = Math.max(o.dur, b.te); });
  o.h.forEach(function(h){ o.dur = Math.max(o.dur, h.te, h.tg || 0); });
  return o;
}
function descToArr(d){ return [d.id, d.k, d.s, Math.round(d.t0 * 1000) / 1000, Math.round(d.x), Math.round(d.y), Math.round(d.a * 100) / 100, Math.round(d.R), d.pm, d.v, d.q]; }
function descFromArr(a){ return { id: a[0], k: a[1], s: a[2], t0: a[3], x: a[4], y: a[5], a: a[6], R: a[7], pm: a[8], v: a[9], q: a[10] || [] }; }

// ---------- WardenView: every client ----------
class WardenView {
  constructor(G){
    this.G = G;
    this.W = G.world;
    this.A = G.world.arena;
    this.bt = 0;
    this.s = WS.DORMANT; this.sb = 0; this.ph = 0;
    this.box = [WARDEN.openR, WARDEN.openR, 0, 0];
    this.boxOn = false;
    this.pats = new Map();  // id -> {d, p}
    this.clr = [];          // [patId, x, y, r, bt]
    this.clrSeen = new Set();
    this.at = ''; this.atT = -9;
    this.fl = 0; this.nm = 0; this.mu = null; this.en = '';
    this.so = []; this.mp = []; this.mk = 0; this.nSouls = 0;
    this.barks = [];
    this.hpLock = 0;
    this.br = [1, 1, 1, 1]; this.bp = [0, 0, 0, 0];
    this.plate = null;
    this.fakeShown = 0;
    this.prevS = -1;
    this.tmp = { x: 0, y: 0 };
    this.lastHitT = -9;
    this.brain = null;
  }
  get C(){ return WARDEN.C; }
  fightActive(){ return this.s >= WS.TALK && this.s !== WS.GONE; }
  // Scenes: nobody fights, oil does not burn, nothing hurts.
  calm(){ const s = this.s; return s === WS.ENCOUNTER || s === WS.TALK || s === WS.SHIFT || s === WS.FAKE || s === WS.RISE || s === WS.MERCY || s >= WS.SPARED; }
  locksActions(){
    const s = this.s;
    if(s === WS.MERCY) return !(this.fl & 64);
    return s === WS.ENCOUNTER || s === WS.TALK || s === WS.SHIFT || s === WS.FAKE || s === WS.RISE || s === WS.RESOLVE || s >= WS.SPARED;
  }
  blocksUlt(){ return this.locksActions() || this.s === WS.MERCY; }
  boxR(){
    if(!this.boxOn) return Infinity;
    const b = this.box, u = b[3] > 0 ? clamp((this.bt - b[2]) / b[3], 0, 1) : 1;
    return lerp(b[0], b[1], u);
  }
  boxMoving(){ const b = this.box; return b[3] > 0 && this.bt >= b[2] && this.bt < b[2] + b[3]; }
  dark(){ return this.A.dark; }
  addPattern(d){
    if(this.pats.has(d.id)) return;
    this.pats.set(d.id, { d: d, p: buildPattern(d) });
  }
  // Surge clears violet and white orbs it touches (only those).
  clearAt(x, y, r, local){
    const bt = this.bt, pos = this.tmp;
    this.pats.forEach(function(P){
      const u = bt - P.d.t0;
      P.p.b.forEach(function(b){
        if((b.col !== 0 && b.col !== 3) || u < b.ts || u >= b.te || u >= b.kt) return;
        bulletPos(b, u, pos);
        if(dist(pos.x, pos.y, x, y) < r + b.r) b.kt = u;
      });
    });
    if(!local){
      this.clr.push([0, Math.round(x), Math.round(y), Math.round(r), Math.round(bt * 1000) / 1000]);
      if(this.clr.length > 24) this.clr.shift();
    }
  }
  applyClear(c){
    const key = c.join(',');
    if(this.clrSeen.has(key)) return;
    this.clrSeen.add(key);
    const pos = this.tmp;
    this.pats.forEach(function(P){
      const u = c[4] - P.d.t0;
      P.p.b.forEach(function(b){
        if((b.col !== 0 && b.col !== 3) || u < b.ts || u >= b.te || u >= b.kt) return;
        bulletPos(b, u, pos);
        if(dist(pos.x, pos.y, c[1], c[2]) < c[3] + b.r) b.kt = u;
      });
    });
  }
  // Where the Warden is while a charge descriptor drives him (all clients agree).
  chargePos(){
    let out = null;
    const bt = this.bt;
    this.pats.forEach(function(P){
      if(P.d.k !== WK.CHARGE) return;
      const h = P.p.h[0], u = bt - P.d.t0;
      if(u < 0 || u > h.te + 0.6) return;
      const f = clamp((u - h.ts) / (h.te - h.ts), 0, 1);
      out = { x: lerp(h.x0, h.x1, f), y: lerp(h.y0, h.y1, f), moving: u >= h.ts && u < h.te };
    });
    return out;
  }
  pullAt(p, dt){
    const bt = this.bt, C = WARDEN.C;
    this.pats.forEach(function(P){
      P.p.h.forEach(function(h){
        if(h.ty !== 'pull') return;
        const u = bt - P.d.t0;
        if(u < h.ts || u >= h.te) return;
        const dx = C.x - p.x, dy = C.y - p.y, d = Math.hypot(dx, dy);
        if(d > 30){ p.x += dx / d * h.v * dt; p.y += dy / d * h.v * dt; }
      });
    });
  }
  // Hit checks for one keeper; `report(patId, idx, f)` applies or forwards each hit.
  checkHits(p, moving, dt, report){
    if(!this.fightActive() || p.alive === false || p.hp <= 0) return;
    p._wHit = p._wHit || new Set();
    p._wViol = p._wViol || {};
    p.owT = Math.max(0, (p.owT || 0) - dt);
    if(this.calm()) return;
    const bt = this.bt, pos = this.tmp, HR = WARDEN.hurtR, SR = WARDEN.solidR;
    const immune = p.invulnT > 0 || p.dashT > 0 || p.owT > 0;
    const self = this;
    this.pats.forEach(function(P){
      const d = P.d, u = bt - d.t0;
      if(u < -0.5 || u > P.p.dur + 0.5) return;
      const bs = P.p.b;
      for(let i = 0; i < bs.length; i++){
        const b = bs[i];
        if(u < b.ts || u >= b.te || u >= b.kt) continue;
        bulletPos(b, u, pos);
        const rr = b.r + HR;
        if((pos.x - p.x) * (pos.x - p.x) + (pos.y - p.y) * (pos.y - p.y) >= rr * rr) continue;
        const key = d.id + ':' + i;
        if(immune || p._wHit.has(key)) continue;
        p._wHit.add(key);
        report(d.id, i, b.f);
        return;
      }
      const hs = P.p.h;
      for(let i = 0; i < hs.length; i++){
        const h = hs[i], over = self.overlap(h, u, p);
        const key = d.id + ':h' + i;
        if(!over){ if(p._wViol[key]) p._wViol[key] = 0; continue; }
        if(h.col === 1 || h.col === 2){
          const breaking = h.col === 1 ? moving : !moving;
          if(!breaking){ p._wViol[key] = 0; continue; }
          p._wViol[key] = (p._wViol[key] || 0) + dt;
          if(p._wViol[key] < WARDEN.colorGrace) continue;
        }
        if(immune || p._wHit.has(key)) continue;
        p._wHit.add(key);
        report(d.id, -1 - i, h.f);
        return;
      }
    });
  }
  overlap(h, u, p){
    const SR = WARDEN.solidR;
    if(h.ty === 'wall'){
      if(u < h.ts || u >= h.te) return false;
      const dd = h.d0 + h.vd * (u - h.ts), s = (p.x - h.cx) * h.nx + (p.y - h.cy) * h.ny;
      return Math.abs(s - dd) < h.thick / 2 + SR;
    }
    if(h.ty === 'band'){
      if(u < h.ts || u >= h.te) return false;
      const r = h.r0 + h.vr * (u - h.ts), dx = p.x - h.cx, dy = p.y - h.cy, dp = Math.hypot(dx, dy);
      if(Math.abs(dp - r) >= h.thick / 2 + SR) return false;
      if(h.gapW > 0 && Math.abs(wrapA(Math.atan2(dy, dx) - h.gapA)) < h.gapW / 2 - Math.asin(Math.min(1, SR / Math.max(r, 1)))) return false;
      return true;
    }
    if(h.ty === 'beam'){
      if(u < h.tf || u >= h.te) return false;
      const ex = Math.cos(h.a), ey = Math.sin(h.a), rx = p.x - h.x, ry = p.y - h.y, along = rx * ex + ry * ey;
      if(along < 0 || along > h.len) return false;
      return Math.abs(rx * ey - ry * ex) < h.w / 2 + SR;
    }
    if(h.ty === 'zone') return u >= h.th && u < h.te && dist(p.x, p.y, h.x, h.y) < h.r + SR;
    if(h.ty === 'solid'){
      if(u < h.ts || u >= h.te) return false;
      const f = (u - h.ts) / (h.te - h.ts), x = lerp(h.x0, h.x1, f), y = lerp(h.y0, h.y1, f);
      return dist(p.x, p.y, x, y) < h.rad + SR;
    }
    return false;
  }
  // Was item `idx` of pattern `id` able to hurt around host time `u`? (guest reports)
  itemActive(id, idx){
    const P = this.pats.get(id);
    if(!P) return -1;
    const u = this.bt - P.d.t0, slack = 0.4;
    if(idx >= 0){
      const b = P.p.b[idx];
      return b && u >= b.ts - slack && u < Math.min(b.te, b.kt) + slack ? b.f : -1;
    }
    const h = P.p.h[-1 - idx];
    if(!h) return -1;
    const a = h.ty === 'beam' ? h.tf : h.ty === 'zone' ? h.th : h.ts;
    return u >= a - slack && u < h.te + slack ? h.f : -1;
  }
  bark(text, who){
    this.barks = this.barks.filter(function(b){ return b.who !== (who || 'W'); });
    this.barks.push({ text: text.replace(/\{[^}]*\}/g, ''), who: who || 'W', t: this.bt });
  }
  // ---- per frame (host and guests) ----
  update(dt){
    const G = this.G;
    if(!this.brain) this.bt += dt;
    const bt = this.bt;
    this.pats.forEach((P, id) => { if(bt - P.d.t0 > P.p.dur + 1) this.pats.delete(id); });
    this.barks = this.barks.filter(b => bt - b.t < 2.2);
    if(this.s !== this.prevS){ this.onState(this.prevS, this.s); this.prevS = this.s; }
    this.stateFx(dt);
    // Own keeper: hits are checked here, on the machine that knows the input.
    const P = G.P;
    if(P){
      const brain = this.brain;
      this.checkHits(P, !!P.moving, dt, (pid, idx, f) => {
        if(brain) brain.applyHit(P, f);
        else if(G.coop) G.coop.net.send({ t: 'ow', p: pid, i: idx });
        P.owT = WARDEN.hitGap;
        this.lastHitT = bt;
        if(window.Music) Music.muffle(0.4);
      });
    }
    if(window.Music){
      const key = this.mu ? this.mu.join(':') : '';
      if(key !== this.muKey){
        this.muKey = key;
        if(this.mu) Music.play(WTRACKS[this.mu[0]], this.mu[1], () => (this.G.warden === this ? this.bt : NaN));
        else if(this.s !== WS.FAKE && this.s !== WS.ENCOUNTER) Music.stop(1.2);
      }
      if(this.mu && WTRACKS[this.mu[0]] === 'corridor' && P) Music.setProximity(clamp((2300 - P.y) / 800, 0, 1));
      Music.duck(!!G.talkNow && G.talkNow.m !== 'bark');
    }
  }
  // Client-side reactions to a state change (sounds, overlays, letterbox).
  onState(from, to){
    const lb = document.getElementById('letterbox');
    const scene = to === WS.ENCOUNTER || to === WS.TALK || to === WS.SHIFT || to === WS.RISE || to === WS.FAKE || to === WS.RESOLVE;
    if(lb) lb.classList.toggle('on', scene);
    document.body.classList.toggle('warden-scene', scene);
    const G = this.G;
    if(to === WS.ENCOUNTER){
      SFX.encounterBlip && SFX.encounterBlip();
      if(window.Music) Music.stop(0);
      this.flash = 0.3;
    }
    if(to === WS.FAKE){
      if(window.Music) Music.stop(0);
      G.shake += 6;
      this.flash = 0.6;
    }
    if(to === WS.RESOLVE){ const f = document.getElementById('fade'); if(f) f.classList.add('on'); }
    if(from === WS.RESOLVE){ const f = document.getElementById('fade'); if(f) f.classList.remove('on'); }
    if(to === WS.SLAIN && SFX.droneTo) SFX.droneTo(0, 2);
    if(to === WS.GONE || to === WS.DORMANT) document.title = 'EMBERDEEP — A Descent in the Dark';
    else if(this.fightActive()) document.title = 'EMBERDEEP — he is waiting';
  }
  stateFx(dt){
    const G = this.G, u = this.bt - this.sb;
    this.flash = Math.max(0, (this.flash || 0) - dt * 3);
    // The fake victory screen: it looks real, then it cracks.
    const fv = document.getElementById('fakeVictory');
    if(fv){
      const show = this.s === WS.FAKE && u >= 2.0 && u < 7.6;
      if(show && fv.classList.contains('hidden')){
        fv.classList.remove('hidden', 'cracking', 'shatter');
        const xp = G.runXp() - G.xpBanked + XP_VICTORY;
        G.fillStats('fakeStats', [['SCORE', Math.round(G.score)], ['EMBERS', Math.round(G.embers)], ['XP', '+' + Math.max(0, xp)]]);
        const btn = document.getElementById('btnFakeOn');
        btn.textContent = 'KEEP DESCENDING';
        G.stopInput();
      }
      if(show && u >= 5.0 && !fv.classList.contains('cracking')){ fv.classList.add('cracking'); SFX.heartbeat && SFX.heartbeat(); }
      if(show && u >= 7.0 && !fv.classList.contains('shatter')){ fv.classList.add('shatter'); SFX.glassBreak && SFX.glassBreak(); G.shake += 8; }
      if(!show && !fv.classList.contains('hidden')) fv.classList.add('hidden');
    }
    G.inputLock = this.s === WS.FAKE && u >= 2.0 && u < 7.6;
    const name = document.getElementById('bossCard');
    if(name){
      const on = this.s === WS.TALK && u < 2.2 && this.brain ? true : this.s === WS.TALK && u < 2.2;
      name.classList.toggle('on', on);
    }
  }
  // ---- network ----
  snap(){
    const r1 = function(v){ return Math.round(v * 10) / 10; };
    const pats = [];
    this.pats.forEach(function(P){ pats.push(descToArr(P.d)); });
    return { s: this.s, sb: Math.round(this.sb * 1000) / 1000, ph: this.ph, bt: Math.round(this.bt * 1000) / 1000,
      box: [Math.round(this.box[0]), Math.round(this.box[1]), Math.round(this.box[2] * 1000) / 1000, this.box[3]], bo: this.boxOn ? 1 : 0,
      pm: this.A.pm, br: this.br, bp: this.bp.map(Math.round), dk: Math.round(this.A.dark * 100), cl: this.A.candlesLit,
      at: this.at, atT: r1(this.atT), fl: this.fl, nm: this.nm, mu: this.mu, en: this.en, sl: this.A.sealed ? 1 : 0, gg: r1(this.A.gateGlow),
      pats: pats, clr: this.clr, so: this.so, ns: this.nSouls, mp: this.mp, mk: this.mk, hl: this.hpLock, pl: this.plate };
  }
  apply(w){
    const G = this.G;
    const err = (w.bt + 0.04) - this.bt;
    if(Math.abs(err) > 0.3) this.bt = w.bt + 0.04;
    else this.bt += err * 0.15;
    this.s = w.s; this.sb = w.sb; this.ph = w.ph;
    this.box = w.box; this.boxOn = !!w.bo;
    if(w.pm !== this.A.pm) applyPillarMask(this.W, w.pm);
    this.br = w.br; this.bp = w.bp;
    this.A.braziers.forEach((b, i) => { b.lit = !!w.br[i]; b.prog = (w.bp[i] || 0) / 100; });
    this.A.dark = w.dk / 100; this.A.candlesLit = w.cl; this.A.sealed = !!w.sl; this.A.gateGlow = w.gg;
    if(w.at !== this.at || w.atT !== this.atT){ this.at = w.at; this.atT = w.atT; }
    this.fl = w.fl; this.nm = w.nm; this.mu = w.mu; this.en = w.en || '';
    this.so = w.so || []; this.nSouls = w.ns || 0; this.mp = w.mp || []; this.mk = w.mk || 0; this.hpLock = w.hl || 0; this.plate = w.pl || null;
    const keep = new Set();
    (w.pats || []).forEach(a => { keep.add(a[0]); this.addPattern(descFromArr(a)); });
    (w.clr || []).forEach(c => this.applyClear(c));
    if(w.en) G.wardenEnding = w.en;
  }
  // ---- HUD (boss bar, objective) ----
  hud(){
    const e = this.G.enemies.find(function(x){ return x.type === 'warden'; });
    const s = this.s;
    if(!e || s === WS.DORMANT || s === WS.ENCOUNTER || s >= WS.SPARED && s !== WS.RESOLVE) return null;
    const names = ['THE WARDEN', 'TALLOW', 'THE THOUSAND WICKS', 'TALLOW'];
    const subs = ['', 'KEEPER OF THE LAST DOOR', 'THE WARD CLOSES', 'THE FIRST KEEPER', 'KINDLED', 'STAND WITH HIM · OR STRIKE'];
    let name = names[this.nm] || 'THE WARDEN', frac = clamp(e.hp / e.maxHp, 0, 1), sub = subs[Math.min(this.ph, 3)] || '';
    if(s === WS.KINDLE){
      const lit = this.so.filter(function(x){ return x[1] === 1; }).length;
      name = 'THE THOUSAND WICKS'; frac = 1 - lit / Math.max(1, this.so.length); sub = 'KINDLED ' + lit + '/' + this.so.length;
    } else if(s === WS.MERCY){ name = 'TALLOW'; sub = subs[5]; frac = 0.004; }
    else if(s === WS.FAKE){ frac = clamp(1 - (this.bt - this.sb - 0.6) / 0.6, 0, 1) * frac; }
    return { name: name, sub: sub, frac: frac, locked: this.hpLock && (s === WS.ATTACK || s === WS.OPENING), open: s === WS.OPENING,
      veil: s === WS.ATTACK, gold: s === WS.MERCY, callout: this.bt - this.atT < 1.8 ? this.at : '', pips: this.ph };
  }
  objective(){
    const s = this.s;
    if(s === WS.DORMANT) return 'WALK ON';
    if(s === WS.KINDLE) return 'HOLD YOUR LIGHT TO THE LOST · ' + this.so.filter(function(x){ return x[1] === 1; }).length + '/' + this.so.length;
    if(s === WS.MERCY) return (this.fl & 64) ? 'STAND WITH HIM · LANTERN LOWERED   ·   OR STRIKE' : '...';
    if(s >= WS.SPARED && s !== WS.RESOLVE) return this.G.world.gateOpen ? 'THE STAIR IS LIT · DESCEND' : '...';
    if(s === WS.OPENING) return 'STRIKE NOW';
    return 'ENDURE THE WARDEN';
  }
  // Soul positions are a pure function of the fight clock (no network needed).
  soulPos(i, out){
    const C = WARDEN.C, R = wardenBoxR(4, this.nKeepers || 1), sd = this.soulSeed || 1;
    const rng = new Rng((sd + i * 977) >>> 0), w1 = rng.range(0.3, 0.52), w2 = rng.range(0.3, 0.52), p1 = rng.range(0, TAU), p2 = rng.range(0, TAU);
    const s = this.so[i];
    if(s && s[1] === 1){
      const a = this.bt * 0.8 + i * TAU / Math.max(1, this.so.length);
      out.x = C.x + Math.cos(a) * 90; out.y = C.y + Math.sin(a) * 90;
    } else {
      const tt = this.bt;
      out.x = C.x + 0.7 * R * Math.sin(w1 * tt + p1); out.y = C.y + 0.7 * R * Math.sin(w2 * tt + p2);
    }
    return out;
  }
}

// ---------- WardenBrain: host only ----------
class WardenBrain {
  constructor(G, e, view){
    this.G = G; this.e = e; this.V = view;
    view.brain = this;
    e.brain = this;
    e.untargetable = false;
    const W = G.world;
    this.fightSeed = ((G.runSeed || 0) + W.num * 7919 + 0x7A11) >>> 0;
    this.rng = new Rng(this.fightSeed ^ 0x5741);
    this.patN = 0;
    this.n = 1;
    this.mem = WardenMemory.load();
    this.used = {};
    this.seq = [];
    this.seqT = 0;
    this.prog = null;
    this.cycle = [];
    this.cycleDone = false;
    this.extra = 0;
    this.last = '';
    this.tollDone = false;
    this.undying = false;
    this.opBark = 0;
    this.resolveUsed = false;
    this.home = { x: 900, y: 372 };
    this.goal = { x: 900, y: 372, sp: 0 };
    this.sitting = true;
    this.trigger = null;
    this.namesSaid = false;
    this.idleSaid = false;
    this.barkCd = {};
    this.vel = {};
    this.kindleT = 0;
    this.helpT = 0;
    this.bottleT = 0;
    this.mercyT = 0;
    this.strike = {};
    this.spareT = {};
    this.endT = 0;
    this.e.x = this.home.x; this.e.y = this.home.y;
    this.e.hp = this.e.maxHp = WARDEN.hp;
    this.e.hpFloor = 1;
    this.blueHits = {};
    this.setState(WS.DORMANT);
    this.music('corridor');
    this.play([0.8, 'd.floor']);
  }
  get bt(){ return this.V.bt; }
  keepers(){ return this.G.allPlayers(); }
  living(){ return this.keepers().filter(function(k){ return k.alive !== false && k.hp > 0; }); }
  wd(){
    const f = this.G.floor, k = Math.max(0, this.n - 1);
    return 22 * (1 + 0.09 * (f - 1)) * Math.min(1 + 0.1 * k, 1.2);
  }
  setState(s){
    const V = this.V;
    V.s = s; V.sb = this.bt;
    this.stateT = 0;
  }
  setBox(r0, r1, dur){ this.V.box = [r0, r1, this.bt, dur]; }
  // ---- talking ----
  line(id){
    const L = WLINES[id];
    if(!L) return null;
    const G = this.G;
    const text = L[1].replace('{N}', String(this.n)).replace('{kills}', String(G.runKills || 0));
    return { who: L[0], text: text, f: L[2] || (L[0] === 'T' ? '✧' : L[0] === 'N' ? '' : '◇'), sp: L[3] || 32 };
  }
  say(id, mode){
    const L = this.line(id);
    if(!L) return 0;
    this.G.talk(L.text, { v: WVOICE[L.who], f: L.f, m: mode || (L.who === 'N' ? 'narr' : 'box'), sp: L.sp, who: L.who });
    return mode === 'bark' ? 0 : talkDur(L.text, L.sp) + 0.2;
  }
  bark(id, cd){
    if(cd && this.barkCd[id] > this.bt) return;
    if(cd) this.barkCd[id] = this.bt + cd;
    this.say(id, 'bark');
  }
  // A scene is a list of steps: line ids, waits and functions, played in order.
  play(steps, done){ this.seq = steps.slice(); this.seqDone = done; this.seqT = 0; }
  runSeq(dt){
    this.seqT -= dt;
    // A line the host skipped (Enter/Z) ends early; the next one follows right away.
    if(this.waitTalk && this.seqT > 0.25 && !this.G.talking() && this.G.talkSkipped){ this.seqT = 0.25; this.G.talkSkipped = false; }
    if(this.seqT <= 0) this.waitTalk = false;
    while(this.seqT <= 0){
      if(!this.seq.length){
        const d = this.seqDone; this.seqDone = null;
        if(d) d();
        return;
      }
      const st = this.seq.shift();
      if(typeof st === 'number') this.seqT += st;
      else if(typeof st === 'function'){ const r = st(); if(typeof r === 'number') this.seqT += r; }
      else { this.seqT += this.say(st); this.waitTalk = true; }
    }
  }
  // ---- patterns ----
  emit(k, t0, x, y, a, q, v){
    const d = { id: ++this.patN, k: k, s: (this.fightSeed ^ Math.imul(this.patN, 2654435761)) >>> 0, t0: t0, x: x, y: y, a: a,
      R: this.curR, pm: this.G.world.arena.pm, v: v || this.v, q: q };
    this.V.addPattern(d);
    return d;
  }
  beatAlign(t){
    const mu = this.V.mu;
    if(!mu) return t;
    const beat = 60 / (WBPM[WTRACKS[mu[0]]] || 120);
    return mu[1] + Math.ceil((t - mu[1]) / beat - 1e-6) * beat;
  }
  music(id){
    const idx = WTRACKS.indexOf(id);
    if(idx < 0){ this.V.mu = null; if(window.Music) Music.stop(1); return; }
    const beat = 60 / WBPM[id];
    this.V.mu = [idx, Math.ceil((this.bt + 0.3) / beat) * beat];
  }
  // Round robin over the living keepers in a stable order.
  target(){
    const ks = this.living();
    if(!ks.length) return this.G.P;
    this.rr = ((this.rr || 0) + 1) % ks.length;
    return ks[this.rr];
  }
  rimToward(p, jitter){
    const C = WARDEN.C, a = Math.atan2(p.y - C.y, p.x - C.x) + this.rng.range(-jitter, jitter) * DEG, r = this.curR + 30;
    return { x: C.x + Math.cos(a) * r, y: C.y + Math.sin(a) * r };
  }
  predict(p, lead){
    const v = this.vel[p.id || 'me'] || { x: 0, y: 0 };
    return { x: p.x + v.x * lead, y: p.y + v.y * lead };
  }
  trackVel(dt){
    this.keepers().forEach(k => {
      const id = k.id || 'me', prev = this.vel[id] || { x: 0, y: 0, px: k.x, py: k.y };
      const vx = (k.x - prev.px) / Math.max(dt, 1e-3), vy = (k.y - prev.py) / Math.max(dt, 1e-3);
      this.vel[id] = { x: lerp(prev.x, vx, 0.25), y: lerp(prev.y, vy, 0.25), px: k.x, py: k.y };
    });
  }
  applyHit(k, fi){
    if(!(k.hp > 0) || k.alive === false || k.owT > 0) return;
    this.G.damagePlayer(WARDEN.F[fi] * this.wd(), null, k);
    k.owT = WARDEN.hitGap;
  }
  onGuestHit(mate, pid, idx){
    if(!mate || mate.alive === false || mate.owT > 0 || this.V.calm()) return;
    const fi = this.V.itemActive(pid, idx);
    if(fi < 0) return;
    this.applyHit(mate, fi);
  }
  // ---- damage to the Warden ----
  onHurt(dmg, src, by){
    const s = this.V.s;
    if(s === WS.MERCY){
      if(!by || src === 'aura' || src === 'dot' || src === 'thorns' || !(this.V.fl & 64)) return 0;
      const id = by.id || 'me', now = this.bt;
      const st = this.strike[id] || (this.strike[id] = { v: 0, last: -9 });
      if(src === 'flame' || src === 'zone') st.v += 1.5 * Math.min(0.1, dmg / Math.max(1, (by.flame && by.flame.dps) || 60));
      else if(now - st.last > 0.2){ st.v += 0.5; st.last = now; }
      if(st.v >= 0.3 && !this.askSaid){ this.askSaid = true; this.bark('m.ask'); }
      return 0;
    }
    if(s === WS.ATTACK){
      const ph = Math.min(3, this.V.ph);
      return dmg * (this.extra >= 2 ? 1 : WARDEN.veil[ph - 1]);
    }
    if(s === WS.OPENING) return dmg * WARDEN.openMult;
    if(s === WS.KINDLE && src === 'flame' && by === this.G.P && !this.throughSaid){ this.throughSaid = true; this.G.talk(this.line('p4.through').text, { m: 'narr', local: true }); }
    return 0;
  }
  // ---- keeper hooks ----
  beforeLethal(p, amount){
    if(this.V.s !== WS.KINDLE || p.refused || p.hp - amount > 0) return false;
    p.refused = true;
    p.hp = 1; p.invulnT = 2;
    if(SFX.refuse) SFX.refuse();
    this.narrTo(p, 'p4.refused');
    return true;
  }
  narrTo(p, id){
    const L = this.line(id), G = this.G;
    if(p === G.P) G.talk(L.text, { m: 'narr', local: true });
    else if(G.coop) G.coop.net.sendTo(p.id, { t: 'talk', s: L.text, o: { m: 'narr' } });
  }
  onKeeperDown(p){
    const s = this.V.s;
    if(!this.V.fightActive() || s === WS.RESOLVE) return false;
    if(!this.G.coop){
      if(this.resolveUsed) return false;
      p.hp = 1;
      this.resolve();
      return true;
    }
    if(s === WS.KINDLE && this.V.so.length < 22) this.V.so.push([0, 0, p.id]);
    this.bark('b.fall', 15);
    return false;
  }
  onTeamWipe(){
    if(!this.V.fightActive() || this.resolveUsed) return false;
    this.resolve();
    return true;
  }
  revive(p, hpF, oilF, at){
    const C = WARDEN.C;
    p.alive = true;
    p.hp = Math.max(1, Math.round(p.maxHp * hpF));
    p.oil = Math.max(p.oil, p.maxOil * oilF);
    p.invulnT = 2; p.snuffT = 0; p.buffs = {};
    const R = Math.min(this.V.boxR(), 560), pos = at || { x: C.x, y: C.y + R - 70 };
    p.x = pos.x + this.rng.range(-40, 40); p.y = pos.y + this.rng.range(-20, 20);
    this.G.constrainKeeper(p);
    p.tp = (p.tp || 0) + 1;
    this.G.burst(p.x, p.y, '#ffd98a', 1.2, 16, 5, 0.8);
  }
  reviveFallen(){
    this.keepers().forEach(k => { if(k.alive === false) this.revive(k, 0.5, 0.5); });
  }
  // ---- the fight ----
  update(dt){
    const G = this.G, V = this.V, e = this.e, A = G.world.arena;
    V.bt += dt;
    this.stateT += dt;
    this.trackVel(dt);
    e.kb.x = e.kb.y = 0;
    e.flash = Math.max(0, e.flash - dt);
    this.curR = Math.min(V.boxR(), WARDEN.openR);
    V.hpLock = e.hpFloor > 1 && e.hp <= e.hpFloor + 0.5 ? 1 : 0;
    this.v = 100;
    this.candle();
    this.braziers(dt);
    if(this.seq.length || this.seqDone) this.runSeq(dt);
    const s = V.s;
    if(s === WS.DORMANT) this.dormant(dt);
    else if(s === WS.ENCOUNTER) this.encounter(dt);
    else if(s === WS.ATTACK) this.attack(dt);
    else if(s === WS.OPENING) this.opening(dt);
    else if(s === WS.FAKE) this.fake(dt);
    else if(s === WS.KINDLE) this.kindle(dt);
    else if(s === WS.MERCY) this.mercy(dt);
    else if(s === WS.SPARED || s === WS.SLAIN) this.ending(dt);
    else if(s === WS.RESOLVE) this.resolving(dt);
    this.moveBody(dt);
    this.bodyContact();
    // Guests that stopped reporting (paused, hidden tab) are checked here instead.
    if(G.coop){
      G.coopMates().forEach(m => {
        const inp = G.coop.inputs[m.id];
        if(!inp || performance.now() - inp.at > 500) V.checkHits(m, false, dt, (pid, idx, f) => this.applyHit(m, f));
        else m.owT = Math.max(0, (m.owT || 0) - dt);
      });
    }
  }
  moveBody(dt){
    const e = this.e, cp = this.V.chargePos();
    if(cp){ e.x = cp.x; e.y = cp.y; return; }
    const g = this.goal, d = dist(e.x, e.y, g.x, g.y);
    if(d > 1 && g.sp > 0){ const st = Math.min(d, g.sp * dt); e.x += (g.x - e.x) / d * st; e.y += (g.y - e.y) / d * st; }
  }
  walkTo(x, y, sp){ this.goal = { x: x, y: y, sp: sp || 300 }; this.sitting = false; }
  bodyContact(){
    const V = this.V, s = V.s;
    if(s !== WS.ATTACK || V.boxMoving() || V.chargePos()) return;
    const e = this.e, wd = this.wd();
    this.living().forEach(k => {
      if(dist(k.x, k.y, e.x, e.y) < e.r + 15 && !(k.owT > 0)){ this.G.damagePlayer(WARDEN.F[5] * wd, e, k); k.owT = WARDEN.hitGap; }
    });
  }
  candle(){
    const A = this.G.world.arena;
    if(A.sealed) return;
    this.keepers().forEach(k => {
      if(k.candleUsed || k.alive === false || dist(k.x, k.y, A.candle.x, A.candle.y) > 40) return;
      k.candleUsed = true;
      k.hp = k.maxHp; k.oil = k.maxOil;
      k.surgeCdT = k.dashCdT = k.eCdT = k.altCdT = 0;
      this.G.burst(A.candle.x, A.candle.y, '#ffd98a', 1, 18, 4, 0.8);
      if(SFX.kindle) SFX.kindle();
      this.narrTo(k, 'd.candle');
    });
  }
  // Lit braziers give light and oil; a second of flame relights a dark one.
  braziers(dt){
    const G = this.G, A = G.world.arena, V = this.V;
    A.braziers.forEach((b, i) => {
      if(b.lit){
        this.keepers().forEach(k => { if(k.alive !== false && dist(k.x, k.y, b.x, b.y) < 120) k.oil = Math.min(k.maxOil, k.oil + 8 * dt); });
        return;
      }
      if(!(V.s === WS.ATTACK || V.s === WS.OPENING) || this.darkUntil > this.bt) { b.prog = Math.max(0, b.prog - 0.5 * dt); return; }
      let burning = false;
      this.keepers().forEach(k => {
        if(!k.flameOn || k.alive === false) return;
        const d = dist(k.x, k.y, b.x, b.y);
        if(d < k.flame.range + 20 && Math.abs(angleDiff(Math.atan2(b.y - k.y, b.x - k.x), k.aim)) < k.flame.half + 0.2) burning = true;
      });
      b.prog = burning ? b.prog + dt : Math.max(0, b.prog - 0.5 * dt);
      if(b.prog >= 1){
        b.lit = true; b.prog = 0;
        G.burst(b.x, b.y, '#ffb35c', 1.2, 20, 5, 0.8);
        G.effect(b.x, b.y, '#ffb35c', 90);
        this.bark('p2.relit', 15);
      }
    });
    V.br = A.braziers.map(function(b){ return b.lit ? 1 : 0; });
    V.bp = A.braziers.map(function(b){ return Math.round(b.prog * 100); });
  }
  dormant(){
    const ks = this.living();
    if(!this.namesSaid && ks.some(k => k.y < 1950)){ this.namesSaid = true; this.say('d.names'); }
    if(!this.idleSaid && this.stateT > 40){ this.idleSaid = true; this.bark('d.idle'); }
    const t = ks.find(k => k.y < 1460);
    if(t || this.stateT > 45) this.encounterStart(t || ks[0] || this.G.P);
  }
  encounterStart(trigger){
    const G = this.G, A = G.world.arena, V = this.V;
    this.trigger = trigger;
    this.n = Math.max(1, this.keepers().length);
    const scale = 1 + 0.16 * Math.max(0, G.floor - CFG.floorMax);
    this.e.maxHp = this.e.hp = Math.round(WARDEN.hp * scale * (1 + 0.5 * (this.n - 1)));
    this.e.hpFloor = this.e.maxHp;
    this.mem.met++;
    WardenMemory.save(this.mem);
    this.setState(WS.ENCOUNTER);
    G.clearTalk();
    if(G.coop) G.coop.net.broadcast({ t: 'talk', clear: 1 });
    this.music('');
    const ks = this.keepers();
    ks.forEach((k, i) => {
      const a = (i - (ks.length - 1) / 2) * 0.35;
      k.x = 900 + Math.sin(a) * 120; k.y = 1190 - Math.cos(a) * 40;
      k.tp = (k.tp || 0) + 1;
    });
  }
  encounter(){
    const A = this.G.world.arena, u = this.stateT;
    A.dark = 0.7;
    A.candlesLit = Math.max(0, 16 - Math.floor(Math.max(0, u - 0.8) / 0.075));
    if(u >= 2.0 && !A.sealed){
      A.sealed = true;
      this.G.world.vents.forEach(function(v){ if(v.corridor){ v.dead = true; v.active = false; v.fuel = 0; } });
      this.G.shake += 4;
      if(SFX.slam) SFX.slam();
    }
    if(u >= 2.0) this.V.boxOn = true;
    if(u >= 2.6) this.intro();
  }
  intro(){
    const G = this.G, m = this.mem, first = m.met <= 1, V = this.V;
    this.setState(WS.TALK);
    this.setBox(WARDEN.openR, WARDEN.openR, 0);
    if(SFX.bossRoar) SFX.bossRoar();
    this.walkTo(900, 620, 70);
    const greet = m.last === 'slain' ? 'i.1x' : m.last === 'spared' ? 'i.1s' : this.n > 1 ? 'i.1c' : m.met > 1 ? 'i.1m' : 'i.1';
    const cls = (this.trigger && this.trigger.cls) || 'keeper';
    const steps = [1.6, 'i.0', greet, 'i.2'];
    if(first) steps.push('i.3', 'i.4', 'i.5');
    steps.push('i.6' + cls, () => {
      const t = this.trigger || G.P, C = WARDEN.C, a = Math.atan2(this.e.y - t.y, this.e.x - t.x);
      V.plate = [Math.round(t.x + Math.cos(a) * 90), Math.round(t.y + Math.sin(a) * 90)];
      return 0;
    }, 'i.7', () => {
      const p = V.plate;
      if(p){
        G.beamFx(this.e.x, this.e.y, p[0], p[1], '#b06bff');
        G.burst(p[0], p[1], '#ffe14d', 1.4, 26, 5, 0.9);
        G.shake += 6;
        if(SFX.glassBreak) SFX.glassBreak();
      }
      V.plate = null;
      return 0.2;
    }, 'i.8');
    if(first) steps.push('i.9');
    steps.push('i.10');
    this.play(steps, () => this.beginPhase(1));
  }
  beginPhase(ph){
    const V = this.V, e = this.e;
    V.ph = ph;
    this.cycle = WPHASE_ATTACKS[ph].slice();
    this.cycleDone = false;   // the phase's last attack has been chosen
    this.cycleShown = false;  // ...and has finished
    this.extra = 0;
    this.last = '';
    this.phaseHp = ph === 1 ? e.maxHp : Math.round(e.maxHp * WARDEN.gate[ph - 2]);
    e.hpFloor = ph < 3 ? Math.round(e.maxHp * WARDEN.gate[ph - 1]) : 1;
    this.music(['', 'waltz', 'ward', 'tallow'][ph]);
    this.startAttack();
  }
  nextAttackName(){
    if(this.V.ph === 3) this.checkUndying();
    if(this.V.ph === 3 && (this.undying || this.e.hp <= 1.5) && !this.tollDone){
      this.cycle = this.cycle.filter(a => a !== 'TOLL');
      if(!this.cycle.length) this.cycleDone = true;
      return 'TOLL';
    }
    if(this.cycle.length){
      const n = this.cycle.shift();
      if(!this.cycle.length) this.cycleDone = true;
      return n;
    }
    this.extra++;
    const pool = WPHASE_ATTACKS[this.V.ph].filter(a => a !== this.last);
    return this.rng.pick(pool);
  }
  startAttack(name){
    const V = this.V, ph = V.ph;
    name = name || this.nextAttackName();
    this.last = name;
    const n = this.used[name] || 0;
    this.used[name] = n + 1;
    this.teach = n === 0 && ph < 4;
    this.v = this.teach ? 80 : 100;
    const R = wardenBoxR(ph, this.n);
    this.curR = R;
    this.setState(WS.ATTACK);
    if(ph < 4) this.setBox(Math.min(V.boxR(), WARDEN.openR), R, WARDEN.boxT);
    V.at = W_ATTACK_NAMES[name]; V.atT = this.bt;
    this.walkTo(WARDEN.C.x, WARDEN.C.y, 300);
    const t0 = this.beatAlign(this.bt + (ph < 4 ? WARDEN.boxT : 0) + 0.45);
    const prog = this.attacks[name].call(this, t0, R, n);
    prog.steps.sort(function(a, b){ return a.at - b.at; });
    this.prog = prog;
  }
  attack(dt){
    const p = this.prog;
    if(!p) return;
    while(p.steps.length && p.steps[0].at <= this.bt){ const st = p.steps.shift(); st.fn.call(this); }
    if(this.V.ph === 3) this.checkUndying();
    if(this.V.ph === 3 && this.e.hp <= 1.5 && this.cycleShown && this.tollDone){ this.fakeStart(); return; }
    if(this.bt >= p.end){
      this.prog = null;
      if(this.cycleDone) this.cycleShown = true;
      if(this.V.ph === 4){ this.p4Next(); return; }
      this.openingStart();
    }
  }
  checkUndying(){
    if(this.undying || this.e.hp > this.e.maxHp * 0.15) return;
    this.undying = true;
    this.V.fl |= 4;
    if(window.Music) Music.setTranspose(1);
    this.bark('p3.undying');
  }
  openingStart(){
    const V = this.V, ph = V.ph, e = this.e, G = this.G;
    this.setState(WS.OPENING);
    this.setBox(V.boxR() === Infinity ? WARDEN.openR : V.boxR(), WARDEN.openR, WARDEN.boxT);
    this.goal.sp = 0;
    const keys = ['p1.op', 'p2.op', 'p3.op'][ph - 1];
    if(keys){ this.bark(keys + (this.opBark % (ph === 3 ? 2 : 3))); this.opBark++; }
    // The open chest-lantern spills oil: the fight must not starve anyone.
    for(let i = 0; i < 2; i++){
      const a = this.rng.range(0, TAU);
      G.addPickup({ type: 'oil', x: e.x + Math.cos(a) * 70, y: e.y + Math.sin(a) * 70, val: 15, t: G.t });
    }
    if(e.hpFloor > 1 && e.hp <= e.hpFloor + 0.5) this.bark('b.floor' + ph, 20);
    this.openEnd = this.bt + WARDEN.boxT + (this.undying ? 1.5 : WARDEN.openingT[ph - 1]);
  }
  opening(){
    const V = this.V, e = this.e, ph = V.ph;
    if(this.bt < this.openEnd) return;
    if(ph < 3){
      const gateHp = e.maxHp * WARDEN.gate[ph - 1];
      // Never an endless phase: after four extra attacks the Warden gives ground.
      if(this.cycleShown && this.extra >= 3 && e.hp > gateHp) e.hp = gateHp;
      if(this.cycleShown && e.hp <= gateHp + 1){ this.shift(ph); return; }
    } else if(this.cycleShown && this.extra >= 3 && e.hp > 1.5){ e.hp = 1; }
    if(ph === 3 && e.hp <= 1.5 && this.cycleShown && this.tollDone){ this.fakeStart(); return; }
    this.startAttack();
  }
  clearPatterns(){
    const V = this.V, G = this.G;
    V.pats.forEach(function(P){
      const u = V.bt - P.d.t0, pos = { x: 0, y: 0 };
      P.p.b.forEach(function(b){ if(u >= b.ts && u < b.te && u < b.kt && Math.random() < 0.25){ bulletPos(b, u, pos); G.burst(pos.x, pos.y, '#ffd98a', 0.4, 2, 2, 0.5); } });
    });
    V.pats.clear();
    V.clr = [];
  }
  shift(ph){
    const G = this.G, V = this.V, A = G.world.arena;
    this.clearPatterns();
    this.setState(WS.SHIFT);
    this.setBox(V.boxR(), WARDEN.openR, WARDEN.boxT);
    this.music('');
    V.at = '';
    this.walkTo(WARDEN.C.x, WARDEN.C.y - 60, 120);
    const fallen = this.keepers().some(k => k.alive === false);
    this.reviveFallen();
    this.keepers().forEach(k => { k.oil = Math.min(k.maxOil, k.oil + 30); });
    if(ph === 1){
      let out = 0;
      const outOne = () => { const b = A.braziers[out++]; if(b){ b.lit = false; G.burst(b.x, b.y, '#55606a', 1, 16, 5, 0.9); } return 0; };
      const burst = () => {
        applyPillarMask(G.world, 85);
        G.shake += 6;
        if(SFX.slam) SFX.slam();
        W_PILLARS.forEach((r, k) => { if(!((85 >> k) & 1)) G.burst(r.x + 24, r.y + 24, '#6d827c', 1.4, 18, 6, 0.9); });
        return 0;
      };
      A.dark = 0.8;
      const steps = this.mem.met > 1 ? [outOne, outOne, outOne, outOne, 'i1.4', burst, 'i1.5'] : [outOne, 'i1.1', outOne, 'i1.2', outOne, 'i1.3', outOne, 'i1.4', burst, 'i1.5'];
      if(fallen) steps.push('i1.6');
      this.play(steps, () => this.beginPhase(2));
    } else {
      const sink = () => {
        applyPillarMask(G.world, 0);
        G.shake += 5;
        if(SFX.slam) SFX.slam();
        G.world.vents.forEach(function(v, i){ if(i === 2 || i === 4){ v.dead = true; v.active = false; v.fuel = 0; } });
        G.addPickup({ type: 'wick', x: WARDEN.C.x, y: WARDEN.C.y + 150, val: 24, t: G.t });
        return 0;
      };
      const rename = () => { V.nm = 1; A.dark = 0.88; if(SFX.heartbeat) SFX.heartbeat(); return 0; };
      const steps = this.mem.met > 1 ? ['i2.2', 'i2.6', rename, sink, 'i2.9'] : ['i2.1', 'i2.2', () => { V.fl |= 8; return 0; }, 'i2.3', 'i2.4', 'i2.5', 'i2.6', rename, 'i2.7', sink, 'i2.8', 'i2.9'];
      this.play(steps, () => this.beginPhase(3));
    }
  }
  // ---- attack programs: each returns {end, steps}; steps run at host time ----
  step(at, fn){ return { at: at, fn: fn }; }
  get attacks(){ return WARDEN_ATTACKS; }
  // ---- fake death, phase four, mercy ----
  fakeStart(){
    const G = this.G, V = this.V, A = G.world.arena;
    this.clearPatterns();
    this.setState(WS.FAKE);
    this.setBox(V.boxR(), WARDEN.openR, 0.3);
    V.boxOn = false;
    this.music('');
    V.at = '';
    this.e.hpFloor = 1; this.e.hp = 1;
    this.goal.sp = 0;
    this.fakeSteps = { said: false, toast: false };
  }
  fake(){
    const u = this.stateT, G = this.G, A = G.world.arena;
    if(u >= 0.3 && !this.fakeSteps.said){ this.fakeSteps.said = true; this.say('f.1'); }
    if(u >= 0.6 && !this.fakeSteps.toast){
      this.fakeSteps.toast = true;
      G.toast('THE WARDEN FALLS');
      if(G.coop) G.coop.net.broadcast({ t: 'say', msg: 'THE WARDEN FALLS' });
      SFX.win();
      A.gateGlow = 1;
    }
    if(u >= 7.0 && !this.fakeSteps.revived){ this.fakeSteps.revived = true; this.reviveFallen(); }
    if(u >= 7.6){
      this.setState(WS.RISE);
      A.dark = 0.95;
      this.V.nm = 2;
      this.play(['f.2', 'f.3', 'f.4', 'f.5'], () => this.kindleStart());
    }
  }
  kindleStart(){
    const G = this.G, V = this.V, A = G.world.arena;
    V.ph = 4;
    this.setState(WS.KINDLE);
    this.curR = wardenBoxR(4, this.n);
    V.boxOn = true;
    this.setBox(WARDEN.openR, this.curR, WARDEN.boxT);
    V.soulSeed = this.fightSeed ^ 0x50e1;
    V.nKeepers = this.n;
    const N = Math.min(14, 7 + this.n - 1);
    V.so = [];
    for(let i = 0; i < N; i++) V.so.push([0, 0, '']);
    // Fallen keepers come back as souls of their own.
    this.keepers().forEach(k => { if(k.alive === false) V.so.push([0, 0, k.id]); });
    this.e.x = WARDEN.C.x; this.e.y = WARDEN.C.y - this.curR - 50;
    this.goal.sp = 0;
    this.e.untargetable = true;
    this.kindleT = 0; this.helpT = 0; this.bottleT = 3;
    this.p4i = 0;
    this.music('wicks');
    this.p4Next(true);
  }
  p4Next(first){
    const name = WP4_LOOP[this.p4i++ % WP4_LOOP.length];
    this.setState(WS.KINDLE);
    this.p4Wait = first ? 1.0 : 1.0;
    this.pendingP4 = name;
  }
  kindle(dt){
    const G = this.G, V = this.V, e = this.e, pos = { x: 0, y: 0 };
    this.kindleT += dt;
    if(this.pendingP4){
      this.p4Wait -= dt;
      if(this.p4Wait <= 0){ const n = this.pendingP4; this.pendingP4 = null; this.startP4(n); }
    }
    if(this.prog){
      const p = this.prog;
      while(p.steps.length && p.steps[0].at <= this.bt){ const st = p.steps.shift(); st.fn.call(this); }
      if(this.bt >= p.end){ this.prog = null; this.p4Next(); }
    }
    // Souls: kindled by holding a lit lantern close.
    const ks = this.living();
    if(this.kindleT > 75){
      this.helpT -= dt;
      const next = V.so.findIndex(x => x[1] !== 1);
      if(this.helpT <= 0 && next >= 0){ this.helpT = 1; V.so[next][0] = 100; }
    }
    V.so.forEach((s, i) => {
      if(s[1] === 1) return;
      V.soulPos(i, pos);
      let n = 0;
      ks.forEach(k => { if(k.oil > 0 && dist(k.x, k.y, pos.x, pos.y) < k.lightR * G.lightMult(k) * 0.6 + 16) n++; });
      // Hold your light to them: progress fades when the soul drifts away.
      s[0] = n ? Math.min(100, s[0] + dt / 2.0 * Math.min(n, 3) * 100) : Math.max(0, s[0] - dt * 35);
      if(s[0] >= 100) this.kindleSoul(i, pos);
    });
    if(this.kindleT > 75 && !this.helpSaid){ this.helpSaid = true; this.bark('p4.help'); }
    // Oil keeps coming: everyone must be able to keep their light up.
    this.bottleT -= dt;
    if(this.bottleT <= 0){
      this.bottleT = 10;
      for(let i = 0; i < this.n; i++){
        const a = this.rng.range(0, TAU), r = this.rng.range(60, this.curR - 50);
        G.addPickup({ type: 'oil', x: WARDEN.C.x + Math.cos(a) * r, y: WARDEN.C.y + Math.sin(a) * r, val: 20, t: G.t });
      }
    }
    // The mass in the middle only hurts if you walk into it.
    const lit = V.so.filter(s => s[1] === 1).length, mr = 30 + 40 * (1 - lit / Math.max(1, V.so.length));
    ks.forEach(k => {
      if(dist(k.x, k.y, WARDEN.C.x, WARDEN.C.y) < mr + 13 && !(k.owT > 0)){ G.damagePlayer(WARDEN.F[5] * this.wd(), null, k); k.owT = WARDEN.hitGap; }
    });
    if(V.so.length && lit === V.so.length) this.mercyStart();
  }
  kindleSoul(i, pos){
    const G = this.G, V = this.V, s = V.so[i];
    s[0] = 100; s[1] = 1;
    G.burst(pos.x, pos.y, '#ffe39b', 1.4, 24, 5, 0.9);
    G.effect(pos.x, pos.y, '#ffe39b', 80);
    if(SFX.kindle) SFX.kindle();
    this.living().forEach(k => { if(dist(k.x, k.y, pos.x, pos.y) < 260) k.oil = Math.min(k.maxOil, k.oil + 20); });
    if(s[2]){
      const k = this.keepers().find(x => x.id === s[2]);
      if(k && k.alive === false) this.revive(k, 0.5, 0.5, pos);
      G.talk((k ? k.name || 'Keeper' : 'Keeper') + ' · "Not yet."', { m: 'soul' });
    } else G.talk(WSOULS[i % WSOULS.length], { m: 'soul' });
    const lit = V.so.filter(x => x[1] === 1).length;
    if(window.Music) Music.setLayers(lit);
    V.fl = (V.fl & ~0xff00) | (Math.min(255, lit) << 8);
  }
  startP4(name){
    this.last = name;
    this.v = name.indexOf('ECHO') === 0 ? 90 : 100;
    this.V.at = W_ATTACK_NAMES[name]; this.V.atT = this.bt;
    const t0 = this.beatAlign(this.bt + 0.45);
    this.prog = WARDEN_ATTACKS[name].call(this, t0, this.curR, this.used[name] = (this.used[name] || 0) + 1);
    this.prog.steps.sort(function(a, b){ return a.at - b.at; });
  }
  mercyStart(){
    const G = this.G, V = this.V, e = this.e, A = G.world.arena;
    this.clearPatterns();
    this.prog = null; this.pendingP4 = null;
    this.setState(WS.MERCY);
    V.at = '';
    V.boxOn = false;
    V.nm = 3;
    A.dark = 0.75;
    this.music('');
    if(window.Music) Music.stop(2);
    e.x = WARDEN.C.x; e.y = WARDEN.C.y; e.untargetable = false;
    e.hp = 1; e.hpFloor = 1;
    G.zones = [];
    e.burnT = 0;
    V.fl &= ~64;
    this.mercyT = 0; this.strike = {}; this.spareT = {};
    this.play(['m.0', 'm.1', 'm.2', 'm.3'], () => { V.fl |= 64; });
  }
  mercy(dt){
    const G = this.G, V = this.V;
    if(!(V.fl & 64)) return;
    this.mercyT += dt;
    const ks = this.living();
    // Striking: one keeper can end it, but not by accident.
    for(const id in this.strike){
      const st = this.strike[id];
      st.v = Math.max(0, st.v - 0.5 * dt);
      if(st.v >= 1.5){ this.endFight('slain'); return; }
    }
    // Sparing needs everyone: stand with him, lantern lowered.
    let ready = 0;
    V.mp = ks.map(k => {
      const id = k.id || 'me', inp = k === G.P ? G.localInput() : (G.coop ? G.coop.inputFor(k) : {});
      const hostile = inp.fire || inp.alt || inp.surge || inp.ability || inp.ult;
      const inRing = dist(k.x, k.y, WARDEN.C.x, WARDEN.C.y) < 110;
      this.spareT[id] = inRing && !hostile ? (this.spareT[id] || 0) + dt : 0;
      k.lowered = inRing && !hostile;
      if(this.spareT[id] >= 3) ready++;
      return [id, Math.round(Math.min(1, this.spareT[id] / 3) * 100)];
    });
    const need = this.mercyT > 30 ? Math.ceil(ks.length / 2) : ks.length;
    if(ks.length && ready >= need){ this.endFight('spared'); return; }
    if(this.mercyT > 20 && !this.waitSaid){ this.waitSaid = true; this.bark('m.wait1'); }
    if(this.mercyT > 180) this.endFight('spared');
  }
  endFight(ending){
    const G = this.G, V = this.V, A = G.world.arena, e = this.e;
    V.en = ending;
    G.wardenEnding = ending;
    this.setState(ending === 'spared' ? WS.SPARED : WS.SLAIN);
    V.mp = [];
    G.score += 800;
    G.xpBonus += 250;
    this.mem[ending]++;
    this.mem.last = ending;
    WardenMemory.save(this.mem);
    e.untargetable = true;
    this.keepers().forEach(k => { k.lowered = false; if(k.alive === false) this.revive(k, 0.5, 0.5); });
    if(ending === 'spared'){
      this.play([0.8, 's.1', 's.2', () => {
        this.keepers().forEach(k => { const give = k.oil * 0.3; k.oil -= give; G.beamFx(k.x, k.y, e.x, e.y, '#ffe14d'); });
        return 1.2;
      }, 's.3', () => { this.music('rest'); return 0; }, 's.4', 's.5'], () => this.openStair());
    } else {
      const lines = G.coop ? ['x.0', 'x.1', 'x.2', 'x.3'] : ['x.1', 'x.2', 'x.3'];
      this.play([0.6].concat(lines), () => this.openStair());
    }
  }
  ending(dt){
    const A = this.G.world.arena, u = this.stateT;
    if(this.V.s === WS.SPARED){
      A.candlesLit = Math.min(16, Math.floor(u * 2));
      if(u > 6) A.dark = Math.max(0.25, A.dark - dt * 0.18);
      A.braziers.forEach(function(b){ b.lit = true; b.prog = 0; });
    } else {
      A.dark = Math.max(0.6, A.dark - dt * 0.05);
      A.candlesLit = 0;
    }
  }
  openStair(){
    const G = this.G, W = G.world;
    if(W.gateOpen) return;
    W.gateOpen = true;
    this.setState(WS.GONE);
    if(G.wardenEnding !== 'slain') SFX.gateOpen();
    G.toast('THE STAIR OPENS');
    G.burst(W.gate.x, W.gate.y, '#ffd98a', 1.6, 26, 6, 1);
    G.effect(W.gate.x, W.gate.y, '#ffd98a', 140);
  }
  // ---- RESOLVE: one checkpoint per fight ----
  resolve(){
    const G = this.G, V = this.V;
    this.resolveUsed = true;
    V.fl |= 1;
    this.resolvePrev = V.s === WS.RESOLVE ? this.resolvePrev : V.s;
    this.clearPatterns();
    this.prog = null; this.pendingP4 = null;
    this.setState(WS.RESOLVE);
    this.music('');
    this.say('r.1', 'narr');
  }
  resolving(){
    if(this.stateT < 3) return;
    const G = this.G, V = this.V, e = this.e, C = WARDEN.C;
    const ph = V.ph || 1;
    const R = wardenBoxR(Math.max(1, ph), this.n);
    this.keepers().forEach((k, i) => {
      k.alive = true; k.hp = k.maxHp; k.oil = Math.max(k.oil, k.maxOil * 0.6); k.invulnT = 2; k.buffs = {};
      k.x = C.x + (i - (this.n - 1) / 2) * 40; k.y = C.y + R - 70;
      G.constrainKeeper(k);
      k.tp = (k.tp || 0) + 1;
    });
    if(G.coop) G.coop.onStatsChanged();
    this.bark('r.2');
    if(ph >= 4){
      V.so.forEach(function(s){ s[0] = 0; s[1] = 0; });
      this.kindleStart();
      return;
    }
    e.hp = ph === 1 ? e.maxHp : Math.round(e.maxHp * WARDEN.gate[ph - 2]);
    if(ph === 3){ this.undying = false; this.tollDone = false; V.fl &= ~4; if(window.Music) Music.setTranspose(0); }
    this.beginPhase(ph);
  }
}

// ---------- Attack programs (host). `this` is the brain. ----------
const WARDEN_ATTACKS = {
  BELL(t0, R, n){
    const C = WARDEN.C, rings = this.teach ? 3 : n >= 2 ? 5 : 4, s = this.rng.chance(0.5) ? 1 : -1, a = this.rng.range(0, 360);
    const sw = this.teach ? 0.3 : 0;
    this.bark('p1.bell');
    if(SFX.bell) SFX.bell();
    this.emit(WK.RING, t0, C.x, C.y, a, [rings, 1.25, 28, 4, 40 * s, 150, 7, 0, 0, 1, 30, 0.6 + sw]);
    return { end: t0 + 0.6 + sw + (rings - 1) * 1.25 + (R - 10) / (150 * this.v / 100) + 0.3, steps: [] };
  },
  HUSH(t0, R, n){
    const C = WARDEN.C, rot = this.rng.int(0, 3) * 90;
    let start = t0;
    if(n === 0){ start = this.bt + this.say('p1.hush0') + 0.3; }
    else this.bark('p1.hush');
    start = this.beatAlign(start);
    const q = [220, 26, 3, 0.8, 90 + rot, 1, 2.4, 0 + rot, 1, 4.0, 45 + rot, 1];
    this.emit(WK.WALLS, start, C.x, C.y, 0, q);
    if(n >= 1) this.emit(WK.KEYS, start, C.x, C.y, 90 + rot, [10, 60]);
    if(SFX.chime) SFX.chime();
    return { end: start + 4.0 + 2 * (R + 20) / (220 * this.v / 100) + 0.3, steps: [] };
  },
  TRAIL(t0, R){
    this.bark('p1.proc');
    this.goal.sp = 0;
    this.chargeFrom = null;
    const warns = this.teach ? [1.3, 1.15, 1.0] : [1.0, 0.85, 0.7], steps = [];
    let at = t0 - 0.45;
    for(let i = 0; i < 3; i++){
      const w = warns[i];
      steps.push(this.step(at, function(){
        const tg = this.target(), from = this.chargeFrom || { x: this.e.x, y: this.e.y };
        const a = Math.atan2(tg.y - from.y, tg.x - from.x);
        // Stop at the Ward's edge.
        let len = 315;
        const ex = circleExitT(from.x, from.y, Math.cos(a), Math.sin(a), R - 46);
        len = Math.max(60, Math.min(len, ex));
        this.emit(WK.CHARGE, this.bt + 0.45, from.x, from.y, a / DEG, [len, 700, w]);
        this.chargeFrom = { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
        if(SFX.bell) SFX.bell();
      }));
      at += 0.45 + w + 315 / 700 + 0.35;
    }
    const end = at + 0.45 + 2.3;
    steps.push(this.step(end - 0.05, function(){ this.chargeFrom = null; this.goal = { x: this.e.x, y: this.e.y, sp: 0 }; }));
    return { end: end, steps: steps };
  },
  LANTERN(t0, R, n){
    if(n === 0) this.bark('p1.lan0');
    const k = this.n - 1, counts = [2, 3, 3], warn = this.teach ? 1.2 : 0.9, steps = [];
    for(let s = 0; s < 3; s++){
      steps.push(this.step(t0 + s * 1.25 - 0.45, function(){
        const q = [warn, 0.4, 48, 0], m = Math.min(7, counts[s] + Math.floor(k / 2));
        for(let i = 0; i < m; i++){
          const tg = this.target(), L = this.rimToward(tg, 40), a = Math.atan2(tg.y - L.y, tg.x - L.x) / DEG;
          q.push(Math.round(L.x), Math.round(L.y), Math.round(a * 10) / 10);
        }
        q[3] = m;
        this.emit(WK.BEAMS, this.bt + 0.45, 0, 0, 0, q);
        if(SFX.lampCharge) SFX.lampCharge(warn);
      }));
    }
    return { end: t0 + 2 * 1.25 + warn + 0.4 + 0.5, steps: steps };
  },
  CAGE(t0, R){
    this.bark('p2.cage');
    if(SFX.chainRattle) SFX.chainRattle();
    const Rmin = Math.min(0.55 * R, 180), C = WARDEN.C, a = this.rng.range(0, 45), gapAt = this.rng.range(0, 360);
    const q = [R, Rmin, 4.0, 2.0, 1.0, 8, 0.75, 150, 4.6, 110, 60];
    this.emit(WK.CAGE, t0, C.x, C.y, a, q);
    const steps = [
      this.step(t0 + 0.6, function(){ this.setBox(R, Rmin, 4.0); }),
      this.step(t0 + 6.6, function(){ this.setBox(Rmin, R, 1.0); })
    ];
    return { end: t0 + 7.7, steps: steps };
  },
  SCALES(t0, R, n){
    const C = WARDEN.C;
    let start = t0;
    if(n === 0) start = this.beatAlign(this.bt + this.say('p2.ember0') + 0.3);
    else this.bark('p2.scales');
    const a = this.rng.range(0, 360), cols = [1, 2, 1, 2, 1, 2, 2, 1, 2, 2, 1, 1], q = [50, 170, 14, 50, 12];
    for(let j = 0; j < 12; j++){
      const del = 0.8 + (j < 6 ? j * 0.5 : 4.5 + (j - 6) * 0.5);
      q.push(del, cols[j], Math.round((a + j * 37) % 360));
    }
    this.emit(WK.BANDS, start, C.x, C.y, 0, q);
    return { end: start + 0.8 + 7.0 + (R - 50) / (170 * this.v / 100) + 0.3, steps: [] };
  },
  LIGHTSOUT(t0, R, n){
    const G = this.G, A = G.world.arena, C = WARDEN.C, k = this.n - 1, steps = [];
    this.bark(n === 0 ? 'p2.lo0' : 'p2.lo');
    if(SFX.inhale) SFX.inhale(1.0);
    steps.push(this.step(t0 + 1.0 - 0.45, function(){
      A.braziers.forEach(function(b){ b.lit = false; b.prog = 0; });
      this.darkUntil = this.bt + 8;
      this.prevDark = A.dark;
      A.dark = 0.94;
      this.V.fl |= 2;
      this.living().forEach(p => G.snuffPlayer(6, 12, null, p));
      const g = [this.rng.range(0, 360)];
      g.push((g[0] + 120 + this.rng.range(-20, 20)) % 360, (g[0] + 240 + this.rng.range(-20, 20)) % 360);
      this.emit(WK.EYES, this.bt + 0.45, C.x, C.y, 0, [36, 3, Math.round(g[0]), Math.round(g[1]), Math.round(g[2]), 70, 0.08, 1.2]);
    }));
    const pairs = Math.min(12, 6 + 2 * k);
    for(let i = 0; i < pairs; i++){
      steps.push(this.step(t0 + 1.0 + 2.0 + i * 0.8 - 0.45, function(){
        const tg = this.target(), eye = this.rimToward(tg, 30);
        const a = Math.atan2(tg.y - eye.y, tg.x - eye.x) / DEG;
        this.emit(WK.FAN, this.bt + 0.45, eye.x, eye.y, a, [0.7, 3, 8, 230, 7]);
      }));
    }
    steps.push(this.step(t0 + 9.0, function(){ if(A.dark > 0.9) A.dark = this.prevDark || 0.8; }));
    return { end: t0 + Math.max(9.2, 3.0 + pairs * 0.8 + 1.6), steps: steps };
  },
  SENTENCE(t0, R){
    this.bark('p2.sent');
    const C = WARDEN.C, steps = [], warn = this.teach ? 1.15 : 0.85;
    const lanternAt = (ang) => ({ x: C.x + Math.cos(ang) * (R + 30), y: C.y + Math.sin(ang) * (R + 30) });
    steps.push(this.step(t0 - 0.45, function(){
      const off = this.rng.chance(0.5) ? 22.5 : 0, q = [warn, 0.4, 52, 4];
      [45, 135, 225, 315].forEach(d => { const L = lanternAt((d + off) * DEG); q.push(Math.round(L.x), Math.round(L.y), (d + off + 180) % 360); });
      this.emit(WK.BEAMS, this.bt + 0.45, 0, 0, 0, q);
      if(SFX.lampCharge) SFX.lampCharge(warn);
    }));
    [1, 2].forEach(s => {
      steps.push(this.step(t0 + s * 1.25 - 0.45, function(){
        const ks = this.living().slice(0, s === 1 ? 6 : 4), q = [warn, 0.4, 52, 0];
        ks.forEach(k => {
          const aims = s === 1 ? [this.predict(k, 0.45)] : [{ x: k.x, y: k.y }, this.predict(k, 0.45)];
          aims.forEach(p => {
            const L = this.rimToward(p, 50), a = Math.atan2(p.y - L.y, p.x - L.x) / DEG;
            q.push(Math.round(L.x), Math.round(L.y), Math.round(a * 10) / 10);
          });
        });
        q[3] = (q.length - 4) / 3;
        this.emit(WK.BEAMS, this.bt + 0.45, 0, 0, 0, q);
        if(SFX.lampCharge) SFX.lampCharge(warn);
      }));
    });
    return { end: t0 + 2.5 + warn + 0.7, steps: steps };
  },
  VIGIL(t0, R){
    this.bark('p3.vigil');
    if(SFX.bell) SFX.bell();
    const C = WARDEN.C;
    this.emit(WK.SPIRAL, t0, C.x, C.y, this.rng.range(0, 360), [3, 45, 2, -45, 0.2, 165, 40, 3.0, 0.4, 3.0, this.teach ? 1.3 : 1.0]);
    return { end: t0 + (this.teach ? 1.3 : 1.0) + 6.4 + R / 165 + 0.2, steps: [] };
  },
  HUSHEMBER(t0, R){
    this.bark('p3.he');
    const C = WARDEN.C, R2 = Math.round(R * 0.8), sp = this.teach ? 300 : 380;
    const cols = [1, 1, 2, 1, 2, 2, 1, 2, 1, 2, 2, 1], base = this.rng.range(0, 360);
    const walls = [];
    for(let j = 0; j < 12; j++) walls.push([1.0 + j * 0.8, (base + j * 45) % 360, cols[j]]);
    resolveColorClashes(walls, R2, sp);
    const q = [sp, 26, 12];
    walls.forEach(w => q.push(Math.round(w[0] * 100) / 100, Math.round(w[1]), w[2]));
    this.curR = R2;
    this.emit(WK.WALLS, t0, C.x, C.y, 0, q);
    const last = walls.reduce((m, w) => Math.max(m, w[0]), 0);
    return { end: t0 + last + 2 * (R2 + 20) / sp + 0.3, steps: [
      this.step(t0 - 0.45, function(){ this.setBox(R, R2, 1.0); if(SFX.inhale) SFX.inhale(1.0); }),
      this.step(t0 + last + 2 * (R2 + 20) / sp, function(){ this.setBox(R2, R, 0.8); })
    ] };
  },
  HAND(t0, R, n){
    this.bark(n === 0 ? 'p3.hand0' : 'p3.hand');
    const slams = Math.min(12, 6 + this.n - 1), steps = [];
    for(let i = 0; i < slams; i++){
      steps.push(this.step(t0 + i * 0.9 - 0.45, function(){
        const tg = this.target();
        this.emit(WK.HAND, this.bt + 0.45, Math.round(tg.x), Math.round(tg.y), this.rng.range(0, 30), [0.9, 110, 12, 150]);
      }));
      steps.push(this.step(t0 + i * 0.9 + 0.9, function(){ this.G.shake += 4; if(SFX.slam) SFX.slam(); }));
    }
    return { end: t0 + slams * 0.9 + 0.9 + 2.5, steps: steps };
  },
  TOLL(t0, R){
    this.bark('p3.toll');
    this.tollDone = true;
    const C = WARDEN.C, a = this.rng.range(0, 360);
    this.emit(WK.RING, t0, C.x, C.y, a, [6, 0.8, 28, 4, 45, 150, 7, 0, 0, 1, 30, 0.6]);
    [-120, 120].forEach(off => {
      const ang = (a + off) * DEG, x = C.x + Math.cos(ang) * 180, y = C.y + Math.sin(ang) * 180;
      this.emit(WK.BANDS, t0, x, y, 0, [20, 150, 14, 0, 3, 1.0, 2, 0, 2.6, 2, 0, 4.2, 2, 0]);
    });
    // GRAND TOLL: no gap at all. Surge clears it; a dash slips through.
    this.emit(WK.RING, t0, C.x, C.y, 0, [1, 0, 60, 0, 0, 120, 7, 0, 1, 0, 30, 6.9]);
    return { end: t0 + 6.9 + R / 120 + 0.5, steps: [] };
  },
  LESSON(t0, R, n){
    const C = WARDEN.C, cols = n % 2 ? [1, 2, 1, 1, 2, 2] : [2, 1, 2, 2, 1, 1], q = [40, 200, 14, 0, 6];
    cols.forEach((c, j) => q.push(0.8 + j * 1.0, c, 0));
    this.emit(WK.BANDS, t0, C.x, C.y, 0, q);
    const steps = cols.map((c, j) => this.step(t0 + 0.8 + j * 1.0 - 0.8, function(){
      this.say(c === 1 ? 'p4.still' : 'p4.move', 'bark');
    }));
    return { end: t0 + 0.8 + 5.0 + R / 200 + 0.3, steps: steps };
  },
  GONER(t0, R){
    this.bark('p4.goner');
    if(SFX.inhale) SFX.inhale(4.0);
    const C = WARDEN.C;
    this.emit(WK.GONER, t0, C.x, C.y, this.rng.range(0, 360), [R + 20, 110, 120 / 110, 24, 2.0, 4.6, 32, 4, 190, 4.0, 110]);
    return { end: t0 + 4.6 + R / 190 + 0.4, steps: [] };
  },
  ECHOBELL(t0, R){
    const C = WARDEN.C;
    this.bark('p4.echo', 30);
    this.emit(WK.RING, t0, C.x, C.y, this.rng.range(0, 360), [4, 1.25, 28, 4, 40, 150, 7, 0, 0, 1, 30, 0.6]);
    return { end: t0 + 0.6 + 3 * 1.25 + R / 150 + 0.3, steps: [] };
  },
  ECHOSENT(t0, R){
    const steps = [], warn = 0.8, k = this.n - 1;
    [0, 1].forEach(s => {
      steps.push(this.step(t0 + s * 1.25 - 0.45, function(){
        const m = 2 + Math.floor(k / 2), q = [warn, 0.4, 52, m];
        for(let i = 0; i < m; i++){
          const tg = this.target(), p = s ? this.predict(tg, 0.45) : tg, L = this.rimToward(p, 50);
          q.push(Math.round(L.x), Math.round(L.y), Math.round(Math.atan2(p.y - L.y, p.x - L.x) / DEG * 10) / 10);
        }
        this.emit(WK.BEAMS, this.bt + 0.45, 0, 0, 0, q);
      }));
    });
    return { end: t0 + 1.25 + warn + 0.7, steps: steps };
  },
  ECHOVIGIL(t0, R){
    const C = WARDEN.C;
    this.emit(WK.SPIRAL, t0, C.x, C.y, this.rng.range(0, 360), [3, 45, 2, -45, 0.25, 165, 40, 2.0, 0, 2.0, 1.0]);
    return { end: t0 + 1.0 + 4.0 + R / 165 + 0.2, steps: [] };
  }
};
WLINES['p4.still'] = ['T', '...{b}still{/b}...'];
WLINES['p4.move'] = ['T', '...{o}now move{/o}...'];

// Wall sets where a blue and an orange wall cover the same spot at nearly the
// same time cannot be survived. The host turns or delays such walls before
// emitting, so every client receives final angles (no float-decided branches).
function resolveColorClashes(walls, R, sp){
  const pts = [];
  for(let gy = -R; gy <= R; gy += R / 10){
    for(let gx = -R; gx <= R; gx += R / 10) if(gx * gx + gy * gy < (R - 15) * (R - 15)) pts.push([gx, gy]);
  }
  const L = R + 20, half = 26, span = 2 * L / sp;
  const dir = function(w){ w[3] = Math.cos(w[1] * DEG); w[4] = Math.sin(w[1] * DEG); };
  walls.forEach(dir);
  const covers = function(w, x, y, t){
    const u = t - w[0];
    return u >= 0 && u <= span && Math.abs(x * w[3] + y * w[4] + L - sp * u) < half;
  };
  const clash = function(j){
    const wj = walls[j];
    for(let i = 0; i < j; i++){
      const wi = walls[i];
      if(wi[2] === wj[2]) continue;
      const t0 = Math.max(wi[0], wj[0]) - 0.25, t1 = Math.min(wi[0], wj[0]) + span + 0.25;
      for(let t = t0; t < t1; t += 1 / 30){
        for(let p = 0; p < pts.length; p++){
          const x = pts[p][0], y = pts[p][1];
          if(covers(wj, x, y, t) && (covers(wi, x, y, t - 0.25) || covers(wi, x, y, t) || covers(wi, x, y, t + 0.25))) return true;
        }
      }
    }
    return false;
  };
  for(let j = 1; j < walls.length; j++){
    let tries = 0;
    while(clash(j) && tries < 8){
      tries++;
      if(tries <= 3) walls[j][1] = (walls[j][1] + 90) % 360;
      else walls[j][0] += 0.4;
      dir(walls[j]);
    }
    for(let k = j + 1; k < walls.length; k++) if(walls[k][0] < walls[j][0] + 0.8) walls[k][0] = walls[j][0] + 0.8;
  }
}

// ---------- Drawing (all clients). R is the Renderer. ----------
WardenView.prototype.sprite = function(R, color, r){
  const key = color + r;
  this.sprites = this.sprites || new Map();
  let s = this.sprites.get(key);
  if(s) return s;
  const size = Math.ceil(r * 5) * 2;
  s = document.createElement('canvas'); s.width = s.height = size;
  const c = s.getContext('2d'), m = size / 2;
  const g = c.createRadialGradient(m, m, 0, m, m, m);
  g.addColorStop(0, hexA(color, 0.55)); g.addColorStop(0.35, hexA(color, 0.22)); g.addColorStop(1, hexA(color, 0));
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  c.fillStyle = color; c.beginPath(); c.arc(m, m, r, 0, TAU); c.fill();
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(m, m, r * 0.55, 0, TAU); c.fill();
  this.sprites.set(key, s);
  return s;
};
// Static pieces of the hall, drawn under everything that moves.
WardenView.prototype.drawUnder = function(c, R, t){
  const A = this.A, W = this.W, G = this.G, C = WARDEN.C;
  // Throne.
  c.save();
  c.fillStyle = '#0c1418'; c.fillRect(840, 290, 120, 70);
  c.fillStyle = '#2b2a3a'; c.fillRect(848, 296, 104, 56);
  c.strokeStyle = '#7d6aa055'; c.lineWidth = 2; c.strokeRect(848, 296, 104, 56);
  c.fillStyle = '#1b1a26'; c.fillRect(862, 270, 76, 32);
  c.restore();
  // The last candle in the corridor (a save point).
  if(!A.sealed){
    const cd = A.candle, used = G.P && G.P.candleUsed, fl = R.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(t * 9);
    c.save();
    c.fillStyle = '#3a3226'; c.fillRect(cd.x - 14, cd.y + 6, 28, 8);
    c.fillStyle = '#e8dcc0'; c.fillRect(cd.x - 5, cd.y - 16, 10, 22);
    c.globalCompositeOperation = 'lighter';
    R.glowCircle(c, cd.x, cd.y - 22, used ? 18 : 46 * fl, '#ffd27a', used ? 0.3 : 0.75);
    if(!used){ c.fillStyle = '#fff2c4'; c.beginPath(); c.ellipse(cd.x, cd.y - 24, 3, 7 * fl, 0, 0, TAU); c.fill(); }
    c.restore();
  } else {
    // The wax wall that sealed the corridor.
    c.save();
    c.fillStyle = '#d9cbb0'; c.fillRect(760, 1452, 280, 26);
    c.fillStyle = '#b9a98c';
    for(let x = 768; x < 1036; x += 22){ c.beginPath(); c.ellipse(x, 1480, 5, 9 + (x % 3) * 3, 0, 0, TAU); c.fill(); }
    c.strokeStyle = '#7a6a4f'; c.lineWidth = 2; c.strokeRect(760, 1452, 280, 26);
    c.restore();
  }
  // Pillars still standing.
  W.obstacles.forEach(function(o){
    if(o.pillar === undefined) return;
    c.fillStyle = '#02080bad'; c.fillRect(o.x + 6, o.y + 8, o.w + 4, o.h + 6);
    const g = c.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h); g.addColorStop(0, '#4a4a5c'); g.addColorStop(1, '#1d1f2c');
    c.fillStyle = g; c.fillRect(o.x, o.y, o.w, o.h);
    c.strokeStyle = '#a79c7044'; c.lineWidth = 1; c.strokeRect(o.x + 5, o.y + 5, o.w - 10, o.h - 10);
    R.sigil(c, o.x + o.w / 2, o.y + o.h / 2, 11, '#c58cff', 0.35, 0);
  });
  // Braziers: lit ones burn, dark ones show how far a flame has relit them.
  A.braziers.forEach(function(b){
    c.save();
    c.fillStyle = '#1a1512'; c.beginPath(); c.arc(b.x, b.y, 20, 0, TAU); c.fill();
    c.strokeStyle = b.lit ? '#e0a050' : '#4d4a48'; c.lineWidth = 3; c.beginPath(); c.arc(b.x, b.y, 20, 0, TAU); c.stroke();
    if(b.lit){
      const fl = R.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(t * 11 + b.x);
      c.globalCompositeOperation = 'lighter';
      R.glowCircle(c, b.x, b.y, 70 * fl, '#ff9c37', 0.45);
      R.glowCircle(c, b.x, b.y - 4, 24, '#ffe39b', 0.9);
    } else if(b.prog > 0){
      c.strokeStyle = '#ffb35c'; c.lineWidth = 3; c.beginPath(); c.arc(b.x, b.y, 27, -Math.PI / 2, -Math.PI / 2 + TAU * b.prog); c.stroke();
    }
    c.restore();
  });
  // Candles around the rim go out as the fight begins.
  c.save(); c.globalCompositeOperation = 'lighter';
  A.candles.forEach(function(cd, j){
    const lit = j < A.candlesLit;
    c.fillStyle = lit ? '#e8dcc0' : '#4a443a'; c.fillRect(cd.x - 2, cd.y - 6, 4, 9);
    if(lit) R.glowCircle(c, cd.x, cd.y - 8, 16, '#ffc36b', 0.8);
  });
  c.restore();
  // Chains across the stair until it is earned.
  if(!W.gateOpen){
    c.save();
    c.strokeStyle = '#6f6680'; c.lineWidth = 3;
    for(let i = -1; i <= 1; i += 2){ c.beginPath(); c.moveTo(W.gate.x - 60, W.gate.y + i * 18); c.lineTo(W.gate.x + 60, W.gate.y - i * 18); c.stroke(); }
    if(A.gateGlow > 0){ c.globalCompositeOperation = 'lighter'; R.glowCircle(c, W.gate.x, W.gate.y, 120, '#ffd98a', 0.35 * A.gateGlow); }
    c.restore();
  }
  // The SPARE plate (intro) and the shards it leaves.
  const s = this.s;
  if(this.plate){
    c.save(); c.globalCompositeOperation = 'lighter';
    R.glowCircle(c, this.plate[0], this.plate[1], 50, '#ffe14d', 0.5);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#ffe14d'; c.font = 'bold 13px "Courier New"'; c.textAlign = 'center'; c.fillText('◈ SPARE', this.plate[0], this.plate[1] + 5);
    c.restore();
  } else if(s >= WS.ATTACK && s <= WS.KINDLE){
    c.save(); c.globalCompositeOperation = 'lighter';
    A.shards.forEach(function(p, i){ R.glowCircle(c, p.x, p.y, 14, '#ffe14d', 0.45 + 0.15 * Math.sin(t * 2 + i)); });
    c.restore();
  }
};
// Light the dark: called with the Renderer's punchHole on the light canvas.
WardenView.prototype.lights = function(punch, t){
  const A = this.A, s = this.s, e = this.G.enemies.find(function(x){ return x.type === 'warden'; });
  if(!A.sealed) punch(A.candle.x, A.candle.y - 20, 130);
  A.braziers.forEach(function(b){ if(b.lit) punch(b.x, b.y, 170); });
  A.candles.forEach(function(cd, j){ if(j < A.candlesLit) punch(cd.x, cd.y, 70); });
  if(e && (s <= WS.OPENING || s === WS.SHIFT || s === WS.RESOLVE)) punch(e.x, e.y, s === WS.OPENING ? 120 : 160);
  if(s === WS.MERCY || s === WS.SPARED) punch(WARDEN.C.x, WARDEN.C.y, s === WS.SPARED ? 260 : 120);
  if(s === WS.KINDLE){
    const pos = this.tmp;
    for(let i = 0; i < this.so.length; i++){ this.soulPos(i, pos); punch(pos.x, pos.y, this.so[i][1] === 1 ? 70 : 30); }
  }
  if(s >= WS.ATTACK && s <= WS.KINDLE) A.shards.forEach(function(p){ punch(p.x, p.y, 26); });
};
WardenView.prototype.drawWarden = function(c, R, e, t){
  const s = this.s, cp = this.chargePos();
  let x = e.x, y = e.y;
  if(cp && !this.brain){ x = cp.x; y = cp.y; }
  c.save();
  if(s >= WS.KINDLE && s !== WS.RESOLVE || s === WS.RISE){
    // Tallow: small, kneeling, with a three-pixel flame.
    const gold = s === WS.SPARED, out = s === WS.SLAIN || s === WS.GONE && this.en === 'slain';
    c.fillStyle = '#00000066'; c.beginPath(); c.ellipse(x, y + 10, 18, 7, 0, 0, TAU); c.fill();
    c.fillStyle = '#3b2f52'; c.beginPath(); c.arc(x, y, 16, 0, TAU); c.fill();
    c.fillStyle = '#c9b2ef'; c.beginPath(); c.arc(x, y - 3, 7, 0, TAU); c.fill();
    if(!out){
      c.globalCompositeOperation = 'lighter';
      R.glowCircle(c, x + 10, y - 14, gold ? 60 : 22, gold ? '#ffe14d' : '#ffd27a', gold ? 0.8 : 0.6);
      c.fillStyle = '#fff2c4'; c.beginPath(); c.ellipse(x + 10, y - 16, 2, 4, 0, 0, TAU); c.fill();
    } else if(!R.reducedMotion){
      for(let i = 0; i < 4; i++){ const p = (t * 0.4 + i / 4) % 1; c.fillStyle = hexA('#9aa0a6', (1 - p) * 0.4); c.beginPath(); c.arc(x + Math.sin(t + i) * 6, y - 20 - p * 60, 4 + p * 8, 0, TAU); c.fill(); }
    }
    c.restore();
    return;
  }
  const kneel = s === WS.OPENING, fallen = s === WS.FAKE, tallow = this.nm >= 1, sc = kneel ? 0.86 : 1;
  const r = 46 * sc, bob = R.reducedMotion ? 0 : Math.sin(t * 1.6) * 2;
  c.translate(x, y + bob);
  c.fillStyle = '#0000007a'; c.beginPath(); c.ellipse(0, r * 0.6, r * 1.2, r * 0.45, 0, 0, TAU); c.fill();
  c.globalCompositeOperation = 'lighter';
  R.glowCircle(c, 0, 0, r * 2.4, tallow ? '#d07bff' : '#b06bff', fallen ? 0.08 : 0.2);
  c.globalCompositeOperation = 'source-over';
  // Keys on chains circle him; one falls away each phase.
  const keys = Math.max(0, 4 - Math.max(0, this.ph - 1));
  for(let i = 0; i < keys && !fallen; i++){
    const a = t * 0.7 + i * TAU / 4, kx = Math.cos(a) * (r + 22), ky = Math.sin(a) * (r + 22) * 0.6;
    c.strokeStyle = '#6f668066'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 0); c.lineTo(kx, ky); c.stroke();
    c.fillStyle = '#cbbd8a'; c.fillRect(kx - 2, ky - 6, 4, 12); c.fillRect(kx - 5, ky - 6, 10, 3);
  }
  // Cloak: layered hood seen from above.
  const cloak = c.createRadialGradient(0, -6, 4, 0, 0, r);
  cloak.addColorStop(0, fallen ? '#1a1622' : '#2a2140'); cloak.addColorStop(0.7, fallen ? '#110e18' : '#1a1428'); cloak.addColorStop(1, '#09070f');
  c.fillStyle = cloak;
  c.beginPath();
  for(let i = 0; i <= 12; i++){
    const a = i / 12 * TAU, w = r * (1 + (R.reducedMotion ? 0 : 0.05 * Math.sin(t * 3 + i * 1.7)));
    if(i === 0) c.moveTo(Math.cos(a) * w, Math.sin(a) * w); else c.lineTo(Math.cos(a) * w, Math.sin(a) * w);
  }
  c.closePath(); c.fill();
  c.strokeStyle = tallow ? '#d07bff88' : '#7d6aa088'; c.lineWidth = 2; c.stroke();
  // Hood and eyes.
  c.fillStyle = '#05040a'; c.beginPath(); c.ellipse(0, -r * 0.25, r * 0.42, r * 0.36, 0, 0, TAU); c.fill();
  if(!fallen){
    c.globalCompositeOperation = 'lighter';
    [-1, 1].forEach(function(sd){ R.glowCircle(c, sd * r * 0.14, -r * 0.27, 9, tallow ? '#ff9ad5' : '#d6b8ff', kneel ? 0.4 : 0.95); });
    c.globalCompositeOperation = 'source-over';
  }
  // Chest lantern: open (gold) while he kneels, cracked once he is Tallow.
  c.fillStyle = '#1b1626'; c.fillRect(-11, r * 0.12, 22, 26);
  c.strokeStyle = '#a79c70'; c.lineWidth = 1.5; c.strokeRect(-11, r * 0.12, 22, 26);
  c.globalCompositeOperation = 'lighter';
  R.glowCircle(c, 0, r * 0.12 + 13, kneel ? 60 : 26, kneel ? '#ffd98a' : tallow ? '#ff7ae0' : '#b06bff', fallen ? 0.1 : kneel ? 0.9 : 0.6);
  c.globalCompositeOperation = 'source-over';
  if(tallow){ c.strokeStyle = '#ffd6f5aa'; c.lineWidth = 1; c.beginPath(); c.moveTo(-8, r * 0.14); c.lineTo(2, r * 0.3); c.lineTo(-3, r * 0.42); c.lineTo(7, r * 0.55); c.stroke(); }
  // Lantern on a hooked staff.
  if(!fallen){
    const la = kneel ? 0.4 : -0.5 + (R.reducedMotion ? 0 : Math.sin(t * 1.3) * 0.08);
    const lx = Math.cos(la) * (r + 10), ly = Math.sin(la) * (r + 10) - 10;
    c.strokeStyle = '#3d3528'; c.lineWidth = 4; c.beginPath(); c.moveTo(r * 0.5, r * 0.2); c.lineTo(lx, ly - 18); c.stroke();
    c.fillStyle = '#2d2618'; c.fillRect(lx - 8, ly - 14, 16, 22);
    c.globalCompositeOperation = 'lighter';
    R.glowCircle(c, lx, ly - 3, 46, tallow ? '#ff9ad5' : '#c58cff', 0.85);
    c.fillStyle = '#f3e6ff'; c.fillRect(lx - 3, ly - 8, 6, 10);
  }
  c.restore();
};
// Everything that hurts is drawn after the light layer, so it is always visible.
WardenView.prototype.drawOver = function(c, R, t){
  const s = this.s, C = WARDEN.C, bt = this.bt, A = this.A, G = this.G, self = this;
  const boxR = this.boxR();
  // The Ward: dim outside, a white ring at the edge.
  if(this.boxOn && boxR < 2000){
    c.save();
    c.fillStyle = s === WS.ATTACK || s === WS.KINDLE ? 'rgba(3,2,8,.55)' : 'rgba(3,2,8,.3)';
    c.beginPath(); c.arc(C.x, C.y, 1600, 0, TAU); c.arc(C.x, C.y, boxR, 0, TAU, true); c.fill();
    c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.globalAlpha = s === WS.ATTACK || s === WS.KINDLE ? 0.9 : 0.5;
    c.beginPath(); c.arc(C.x, C.y, boxR, 0, TAU); c.stroke();
    c.restore();
  }
  c.save();
  c.globalCompositeOperation = 'lighter';
  const pos = this.tmp;
  let drawn = 0;
  this.pats.forEach(function(P){
    const d = P.d, u = bt - d.t0;
    if(u < -0.6 || u > P.p.dur + 0.4) return;
    // Hazards and telegraphs.
    P.p.h.forEach(function(h){ self.drawHazard(c, R, h, u, d, t); });
    // Bullets.
    const bs = P.p.b;
    for(let i = 0; i < bs.length && drawn < WARDEN.drawCap; i++){
      const b = bs[i];
      if(b.tw !== undefined && u >= b.tw && u < b.ts){
        bulletPos(b, b.ts, pos);
        const f = (u - b.tw) / (b.ts - b.tw);
        if(b.eye) self.drawEye(c, R, pos.x, pos.y, Math.atan2(C.y - pos.y, C.x - pos.x), f);
        else R.glowCircle(c, pos.x, pos.y, b.r * 2.5, WCOL[b.col], 0.25 * f);
        continue;
      }
      if(u < b.ts || u >= b.te || u >= b.kt) continue;
      bulletPos(b, u, pos);
      if(!R.visible(pos.x, pos.y, 30)) continue;
      drawn++;
      if(b.eye){ self.drawEye(c, R, pos.x, pos.y, Math.atan2(C.y - pos.y, C.x - pos.x), 1); continue; }
      const sp = self.sprite(R, WCOL[b.col], b.r);
      c.drawImage(sp, pos.x - sp.width / 2, pos.y - sp.height / 2);
    }
  });
  c.restore();
  if(s === WS.KINDLE || s === WS.RISE) this.drawSouls(c, R, t);
  if(s === WS.MERCY) this.drawMercy(c, R, t);
  // Your own soul: the hurtbox, and what the colours want from you right now.
  const P = G.P;
  if(P && P.alive !== false && this.fightActive() && !this.calm()){
    c.save();
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(P.x, P.y, 3.5, 0, TAU); c.fill();
    const want = this.colorNow();
    if(want){
      c.font = 'bold 13px "Courier New"'; c.textAlign = 'center';
      c.fillStyle = want === 1 ? '#7ddcff' : '#ff8a3d';
      c.fillText(want === 1 ? '‖' : '»', P.x, P.y + 32);
    }
    c.restore();
  }
  this.drawBarks(c, R);
};
WardenView.prototype.colorNow = function(){
  const bt = this.bt, P = this.G.P;
  let want = 0, best = 1e9;
  this.pats.forEach(function(Pt){
    const u = bt - Pt.d.t0;
    Pt.p.h.forEach(function(h){
      if((h.col !== 1 && h.col !== 2) || u < h.tw || u >= h.te) return;
      let d = 0;
      if(h.ty === 'wall'){ const dd = h.d0 + h.vd * Math.max(0, u - h.ts); d = Math.abs((P.x - h.cx) * h.nx + (P.y - h.cy) * h.ny - dd); }
      else { const r = h.r0 + h.vr * Math.max(0, u - h.ts); d = Math.abs(dist(P.x, P.y, h.cx, h.cy) - r); }
      if(d < 160 && d < best){ best = d; want = h.col; }
    });
  });
  return want;
};
WardenView.prototype.drawEye = function(c, R, x, y, a, open){
  c.save(); c.translate(x, y); c.rotate(a);
  c.globalCompositeOperation = 'lighter';
  R.glowCircle(c, 0, 0, 20, '#c58cff', 0.35 * open);
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#f3e6ff'; c.beginPath(); c.ellipse(0, 0, 9, 9 * Math.max(0.12, open), 0, 0, TAU); c.fill();
  if(open > 0.5){ c.fillStyle = '#2a0b3d'; c.beginPath(); c.arc(2, 0, 3.5, 0, TAU); c.fill(); }
  c.restore();
};
WardenView.prototype.drawHazard = function(c, R, h, u, d, t){
  const C = WARDEN.C;
  if(h.ty === 'wall'){
    const L = this.boxR() < 2000 ? this.boxR() : h.L;
    if(u >= h.tw && u < h.ts){
      const f = (u - h.tw) / (h.ts - h.tw), dd = -L + 4;
      this.wallPath(c, h, dd, L, 6);
      c.strokeStyle = hexA(WCOL[h.col], 0.35 + 0.4 * f); c.setLineDash([10, 8]); c.lineWidth = 2; c.stroke(); c.setLineDash([]);
      return;
    }
    if(u < h.ts || u >= h.te) return;
    const dd = h.d0 + h.vd * (u - h.ts);
    if(Math.abs(dd) >= L) return;
    this.wallPath(c, h, dd, L, h.thick);
    if(h.col === 1){
      c.strokeStyle = hexA(WCOL[1], 0.95); c.lineWidth = 2.5; c.stroke();
      c.fillStyle = hexA(WCOL[1], 0.18); c.fill();
      this.hatch(c, h, dd, L, '‖');
    } else {
      c.fillStyle = hexA(WCOL[h.col], 0.75); c.fill();
      if(h.col === 2) this.hatch(c, h, dd, L, '»');
    }
    return;
  }
  if(h.ty === 'band'){
    if(u >= h.tw && u < h.ts){
      if(h.col){
        const f = (u - h.tw) / (h.ts - h.tw);
        c.strokeStyle = hexA(WCOL[h.col], 0.3 + 0.6 * f); c.lineWidth = 4;
        c.beginPath(); c.arc(h.cx, h.cy, 26 + 6 * Math.sin(t * 10), 0, TAU); c.stroke();
      } else if(h.gapW > 0){
        const r = h.r0;
        c.strokeStyle = hexA('#ffe14d', 0.8); c.lineWidth = 3;
        [-1, 1].forEach(function(sd){ const a = h.gapA + sd * h.gapW / 2; c.beginPath(); c.moveTo(h.cx + Math.cos(a) * (r - 20), h.cy + Math.sin(a) * (r - 20)); c.lineTo(h.cx + Math.cos(a) * (r + 10), h.cy + Math.sin(a) * (r + 10)); c.stroke(); });
      }
      return;
    }
    if(u < h.ts || u >= h.te) return;
    const r = h.r0 + h.vr * (u - h.ts);
    if(r <= 2) return;
    const a0 = h.gapW > 0 ? h.gapA + h.gapW / 2 : 0, a1 = h.gapW > 0 ? h.gapA - h.gapW / 2 + TAU : TAU;
    c.lineWidth = h.thick;
    c.strokeStyle = hexA(WCOL[h.col], h.col === 1 ? 0.35 : 0.7);
    c.beginPath(); c.arc(h.cx, h.cy, r, a0, a1); c.stroke();
    if(h.col === 1){
      c.lineWidth = 2; c.strokeStyle = hexA(WCOL[1], 0.95);
      c.beginPath(); c.arc(h.cx, h.cy, r - h.thick / 2, a0, a1); c.stroke();
      c.beginPath(); c.arc(h.cx, h.cy, r + h.thick / 2, a0, a1); c.stroke();
    } else if(h.col === 2){
      c.lineWidth = 2; c.strokeStyle = '#fff1d6aa'; c.setLineDash([3, 9]);
      c.beginPath(); c.arc(h.cx, h.cy, r, a0, a1); c.stroke(); c.setLineDash([]);
    }
    return;
  }
  if(h.ty === 'beam'){
    if(u < h.tw || u >= h.tg) return;
    const ex = Math.cos(h.a) * h.len, ey = Math.sin(h.a) * h.len;
    // The lantern that fires it.
    c.save(); c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#2d2618'; c.fillRect(h.x - 9, h.y - 12, 18, 24);
    c.restore();
    R.glowCircle(c, h.x, h.y, 30, '#c58cff', 0.8);
    if(u < h.tf){
      const f = (u - h.tw) / (h.tf - h.tw);
      c.strokeStyle = hexA('#c58cff', 0.12 + 0.3 * f); c.lineWidth = h.w; c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(h.x + ex, h.y + ey); c.stroke();
      c.strokeStyle = hexA('#ffffff', 0.8); c.lineWidth = 1; c.setLineDash([12, 10]); c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(h.x + ex, h.y + ey); c.stroke(); c.setLineDash([]);
      return;
    }
    const fade = u < h.te ? 1 : 1 - (u - h.te) / (h.tg - h.te);
    c.strokeStyle = hexA('#c58cff', 0.75 * fade); c.lineWidth = h.w; c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(h.x + ex, h.y + ey); c.stroke();
    c.strokeStyle = hexA('#ffffff', 0.9 * fade); c.lineWidth = h.w * 0.35; c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(h.x + ex, h.y + ey); c.stroke();
    return;
  }
  if(h.ty === 'zone'){
    if(u < h.tw || u >= h.te + 0.3) return;
    if(u < h.th){
      const f = (u - h.tw) / (h.th - h.tw);
      c.save(); c.globalCompositeOperation = 'source-over';
      c.fillStyle = 'rgba(30,0,40,.45)'; c.beginPath(); c.arc(h.x, h.y, h.r, 0, TAU); c.fill();
      // The hand, rising out of the floor.
      c.fillStyle = hexA('#05040a', 0.85 * f); c.beginPath(); c.ellipse(h.x, h.y - 40 * (1 - f), 34, 22, 0, 0, TAU); c.fill();
      for(let k = -2; k <= 2; k++){ c.beginPath(); c.ellipse(h.x + k * 13, h.y - 40 * (1 - f) - 22, 5, 14, k * 0.15, 0, TAU); c.fill(); }
      c.restore();
      c.fillStyle = hexA('#c58cff', 0.45); c.beginPath(); c.moveTo(h.x, h.y); c.arc(h.x, h.y, h.r, -Math.PI / 2, -Math.PI / 2 + TAU * f); c.closePath(); c.fill();
      c.strokeStyle = '#e6d2ff'; c.lineWidth = 2.5; c.beginPath(); c.arc(h.x, h.y, h.r, 0, TAU); c.stroke();
    } else {
      R.glowCircle(c, h.x, h.y, h.r * 1.3, '#c58cff', 0.6 * (1 - (u - h.th) / 0.45));
    }
    return;
  }
  if(h.ty === 'wedge'){
    if(u < h.tw || u >= h.te) return;
    const r = this.boxR() < 2000 ? this.boxR() : 500;
    c.fillStyle = hexA('#ffe14d', 0.22); c.beginPath(); c.moveTo(h.x, h.y); c.arc(h.x, h.y, r, h.a - h.half, h.a + h.half); c.closePath(); c.fill();
    return;
  }
  if(h.ty === 'solid'){
    if(u < h.tw || u >= h.ts) return;
    const a = Math.atan2(h.y1 - h.y0, h.x1 - h.x0), len = dist(h.x0, h.y0, h.x1, h.y1), f = (u - h.tw) / (h.ts - h.tw);
    c.save(); c.translate(h.x0, h.y0); c.rotate(a);
    c.fillStyle = hexA('#c58cff', 0.08 + 0.18 * f); c.fillRect(0, -59, len, 118);
    c.strokeStyle = hexA('#d6b8ff', 0.7); c.setLineDash([10, 10]); c.lineWidth = 2; c.strokeRect(0, -59, len, 118); c.setLineDash([]);
    c.restore();
    return;
  }
  if(h.ty === 'wick' || h.ty === 'wickglow'){
    if(u < h.tw || u >= h.te) return;
    R.glowCircle(c, h.x, h.y, h.ty === 'wick' ? 14 : 18, '#ffb35c', 0.7);
    return;
  }
  if(h.ty === 'eye'){
    if(u < h.tw || u >= h.te + 0.2) return;
    this.drawEye(c, R, h.x, h.y, h.a, clamp((u - h.tw) / (h.te - h.tw), 0, 1));
    return;
  }
  if(h.ty === 'guide'){
    if(u < h.tw || u >= h.te) return;
    c.strokeStyle = hexA('#c58cff', 0.35); c.lineWidth = 2; c.setLineDash([6, 10]);
    h.arms.forEach(function(arm){ c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(h.x + Math.cos(arm[0]) * h.len, h.y + Math.sin(arm[0]) * h.len); c.stroke(); });
    c.setLineDash([]);
    return;
  }
  if(h.ty === 'rim'){
    if(u < h.tw || u >= h.te) return;
    c.strokeStyle = hexA('#ff6b9d', 0.35); c.lineWidth = 40; c.beginPath(); c.arc(C.x, C.y, h.r - 20, 0, TAU); c.stroke();
    return;
  }
  if(h.ty === 'swell'){
    if(u < h.tw || u >= h.te) return;
    const f = (u - h.tw) / (h.te - h.tw);
    c.strokeStyle = hexA('#ffffff', 0.25 + 0.5 * f); c.lineWidth = 3 + 6 * f;
    c.beginPath(); c.arc(h.x, h.y, 50 + 30 * Math.sin(t * 12) * f, 0, TAU); c.stroke();
    const P = this.G.P;
    if(P){ c.fillStyle = hexA('#ffffff', 0.5 + 0.5 * Math.sin(t * 14)); c.font = 'bold 12px "Courier New"'; c.textAlign = 'center'; c.fillText('SPACE', P.x, P.y - 34); }
    return;
  }
  if(h.ty === 'pull'){
    if(u < h.ts || u >= h.te) return;
    c.strokeStyle = hexA('#c58cff', 0.18); c.lineWidth = 2;
    for(let i = 0; i < 4; i++){ const r = ((1 - ((t * 0.6 + i / 4) % 1)) * 420) + 40; c.beginPath(); c.arc(C.x, C.y, r, 0, TAU); c.stroke(); }
  }
};
WardenView.prototype.wallPath = function(c, h, dd, L, thick){
  const half = Math.sqrt(Math.max(0, L * L - dd * dd)), px = -h.ny, py = h.nx;
  const mx = h.cx + h.nx * dd, my = h.cy + h.ny * dd;
  c.beginPath();
  c.moveTo(mx + px * half - h.nx * thick / 2, my + py * half - h.ny * thick / 2);
  c.lineTo(mx - px * half - h.nx * thick / 2, my - py * half - h.ny * thick / 2);
  c.lineTo(mx - px * half + h.nx * thick / 2, my - py * half + h.ny * thick / 2);
  c.lineTo(mx + px * half + h.nx * thick / 2, my + py * half + h.ny * thick / 2);
  c.closePath();
};
WardenView.prototype.hatch = function(c, h, dd, L, glyph){
  const half = Math.sqrt(Math.max(0, L * L - dd * dd)), px = -h.ny, py = h.nx;
  const mx = h.cx + h.nx * dd, my = h.cy + h.ny * dd, ang = Math.atan2(h.ny, h.nx);
  c.save(); c.globalCompositeOperation = 'source-over';
  c.fillStyle = glyph === '‖' ? '#e8f8ff' : '#2a1406'; c.font = 'bold 14px "Courier New"'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for(let s = -half + 20; s < half - 10; s += 34){
    c.save(); c.translate(mx + px * s, my + py * s); c.rotate(ang); c.fillText(glyph, 0, 0); c.restore();
  }
  c.restore();
};
WardenView.prototype.drawSouls = function(c, R, t){
  const C = WARDEN.C, pos = this.tmp, lit = this.so.filter(function(x){ return x[1] === 1; }).length;
  const mr = 30 + 40 * (1 - lit / Math.max(1, this.so.length));
  if(this.s === WS.KINDLE){
    // The mass of the thousand wicks.
    c.save();
    c.fillStyle = '#07040c'; c.beginPath();
    for(let i = 0; i <= 16; i++){ const a = i / 16 * TAU, w = mr * (1 + (R.reducedMotion ? 0 : 0.12 * Math.sin(t * 4 + i * 2.1))); if(i === 0) c.moveTo(C.x + Math.cos(a) * w, C.y + Math.sin(a) * w); else c.lineTo(C.x + Math.cos(a) * w, C.y + Math.sin(a) * w); }
    c.closePath(); c.fill();
    c.strokeStyle = '#c58cff88'; c.lineWidth = 2; c.stroke();
    c.globalCompositeOperation = 'lighter';
    for(let i = 0; i < 5; i++){ const a = t * 0.5 + i * 1.3; R.glowCircle(c, C.x + Math.cos(a) * mr * 0.5, C.y + Math.sin(a) * mr * 0.5, 6, '#d6b8ff', 0.7); }
    c.restore();
  }
  c.save(); c.globalCompositeOperation = 'lighter';
  for(let i = 0; i < this.so.length; i++){
    const s = this.so[i];
    this.soulPos(i, pos);
    if(s[1] === 1){
      R.glowCircle(c, pos.x, pos.y, 34, '#ffe39b', 0.8);
      c.fillStyle = '#fff6d8'; c.beginPath(); c.ellipse(pos.x, pos.y - 4, 3, 7, 0, 0, TAU); c.fill();
    } else {
      R.glowCircle(c, pos.x, pos.y, 26, s[2] ? '#ffb3c6' : '#9fb6d8', 0.55);
      c.strokeStyle = '#cfe0ffaa'; c.lineWidth = 1.5; c.beginPath(); c.arc(pos.x, pos.y, 16, 0, TAU); c.stroke();
      if(s[0] > 0){ c.strokeStyle = '#ffe39b'; c.lineWidth = 3; c.beginPath(); c.arc(pos.x, pos.y, 20, -Math.PI / 2, -Math.PI / 2 + TAU * s[0] / 100); c.stroke(); }
    }
  }
  c.restore();
};
WardenView.prototype.drawMercy = function(c, R, t){
  const C = WARDEN.C, A = this.A, open = this.fl & 64;
  c.save();
  c.globalCompositeOperation = 'lighter';
  A.shards.forEach(function(p, i){ const a = i / A.shards.length * TAU + t * 0.2; R.glowCircle(c, C.x + Math.cos(a) * 90, C.y + Math.sin(a) * 90, 12, '#ffe14d', 0.7); });
  c.globalCompositeOperation = 'source-over';
  c.strokeStyle = hexA('#ffe14d', open ? 0.8 : 0.3); c.lineWidth = 2; c.setLineDash([6, 8]);
  c.beginPath(); c.arc(C.x, C.y, 110, 0, TAU); c.stroke(); c.setLineDash([]);
  // One segment per keeper: how long each has stood with him.
  const n = Math.max(1, this.mp.length);
  this.mp.forEach(function(m, i){
    const a0 = -Math.PI / 2 + i / n * TAU, a1 = a0 + TAU / n * (m[1] / 100) - 0.05;
    if(m[1] > 0){ c.strokeStyle = '#ffe14d'; c.lineWidth = 5; c.beginPath(); c.arc(C.x, C.y, 118, a0, Math.max(a0, a1)); c.stroke(); }
  });
  if(open){ c.fillStyle = '#ffe14d'; c.font = 'bold 13px "Courier New"'; c.textAlign = 'center'; c.fillText('◈ SPARE', C.x, C.y + 140); }
  c.restore();
};
WardenView.prototype.drawBarks = function(c, R){
  const self = this, e = this.G.enemies.find(function(x){ return x.type === 'warden'; });
  if(!e) return;
  this.barks.forEach(function(b){
    const age = self.bt - b.t, a = clamp(Math.min(age * 6, (2.2 - age) * 3), 0, 1);
    const x = e.x, y = e.y - (b.who === 'T' ? 40 : 86);
    c.save(); c.globalAlpha = a;
    c.font = '13px "Courier New"';
    const w = Math.min(320, c.measureText(b.text).width + 22);
    c.fillStyle = '#ffffff'; rrPath(c, x - w / 2, y - 30, w, 28, 6); c.fill();
    c.beginPath(); c.moveTo(x - 7, y - 3); c.lineTo(x, y + 7); c.lineTo(x + 7, y - 3); c.fill();
    c.fillStyle = '#000000'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(b.text, x, y - 16, w - 14);
    c.restore();
  });
};
WardenView.prototype.drawScreen = function(c, R){
  if(this.flash > 0 && !R.reducedMotion){ c.fillStyle = 'rgba(255,255,255,' + Math.min(0.6, this.flash) + ')'; c.fillRect(0, 0, R.w, R.h); }
};
