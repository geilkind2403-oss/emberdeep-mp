'use strict';

function hexA(hex, a){
  return 'rgba(' + parseInt(hex.slice(1,3),16) + ',' + parseInt(hex.slice(3,5),16) + ',' + parseInt(hex.slice(5,7),16) + ',' + clamp(a,0,1) + ')';
}
function rrPath(c,x,y,w,h,r){
  c.beginPath(); c.roundRect(x,y,w,h,Math.max(0,Math.min(r,w/2,h/2)));
}
function polygon(c,points){
  c.beginPath(); points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); c.closePath();
}
function circle(c,x,y,r){ c.beginPath(); c.arc(x,y,Math.max(0,r),0,TAU); }

class Renderer {
  constructor(canvas){
    this.canvas=canvas; this.ctx=canvas.getContext('2d',{alpha:false});
    this.light=document.createElement('canvas'); this.lctx=this.light.getContext('2d');
    this.glows=new Map(); this.worldCache=null; this.menuCache=null; this.menuTime=0;
    this.motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion=this.motionQuery.matches;
    try{ const pref=localStorage.getItem('emberdeep_motion'); if(pref!==null) this.reducedMotion=pref==='reduced'; }catch(e){}
    this.ambient=Array.from({length:70},(_,i)=>({x:Math.random(),y:Math.random(),s:.6+Math.random()*1.4,v:.015+Math.random()*.03,phase:i*2.4}));
    this.applyMotion(); this.resize();
  }
  applyMotion(){
    document.body.classList.toggle('reduced-motion',this.reducedMotion);
    const b=document.getElementById('btnMotion');
    if(b){ b.setAttribute('aria-pressed',String(this.reducedMotion)); b.querySelector('span').textContent=this.reducedMotion?'REDUCED':'FULL'; }
  }
  resize(){
    this.w=Math.max(2,this.canvas.clientWidth||innerWidth); this.h=Math.max(2,this.canvas.clientHeight||innerHeight);
    this.dpr=Math.min(2,devicePixelRatio||1);
    this.canvas.width=Math.round(this.w*this.dpr); this.canvas.height=Math.round(this.h*this.dpr);
    this.light.width=Math.round(this.w); this.light.height=Math.round(this.h); this.menuCache=null;
  }
  glowCircle(c,x,y,r,color,a){
    if(r<=0||a<=0)return;
    let sprite=this.glows.get(color);
    if(!sprite){
      sprite=document.createElement('canvas'); sprite.width=sprite.height=128;
      const s=sprite.getContext('2d'),g=s.createRadialGradient(64,64,0,64,64,64);
      g.addColorStop(0,hexA(color,1)); g.addColorStop(.18,hexA(color,.62)); g.addColorStop(.5,hexA(color,.18));g.addColorStop(1,hexA(color,0));
      s.fillStyle=g;s.fillRect(0,0,128,128);this.glows.set(color,sprite);
    }
    const old=c.globalAlpha;c.globalAlpha=old*clamp(a,0,1);c.drawImage(sprite,x-r,y-r,r*2,r*2);c.globalAlpha=old;
  }
  // Stonework is generated once per floor. Animation never consumes gameplay RNG.
  bakeWorld(W){
    const canvas=document.createElement('canvas');canvas.width=W.w;canvas.height=W.h;
    const c=canvas.getContext('2d'),rng=new Rng(W.num*11731+43);
    c.fillStyle='#101e23';c.fillRect(0,0,W.w,W.h);
    for(let y=0;y<W.h;y+=64){
      for(let x=-48;x<W.w;x+=96){
        const xx=x+(Math.floor(y/64)%2)*48,shade=rng.int(0,9);
        c.fillStyle='rgb('+(20+shade)+','+(34+shade)+','+(39+shade)+')';
        c.fillRect(xx+1,y+1,94,62);
        c.strokeStyle='rgba(128,160,152,.12)';c.lineWidth=1;c.beginPath();c.moveTo(xx+2,y+62);c.lineTo(xx+2,y+2);c.lineTo(xx+92,y+2);c.stroke();
        c.fillStyle='#050c1080';c.fillRect(xx+2,y+59,91,3);
        if(rng.chance(.32)){
          c.strokeStyle='#081115a0';c.beginPath();c.moveTo(xx+rng.range(10,70),y+2);c.lineTo(xx+48,y+25);c.lineTo(xx+40,y+34);c.lineTo(xx+61,y+53);c.stroke();
        }
        for(let j=0;j<9;j++){c.fillStyle=rng.chance(.5)?'#88a3970d':'#00000026';c.fillRect(xx+rng.range(3,90),y+rng.range(3,60),rng.range(1,4),1);}
      }
    }
    // Weathered ceremonial inlays anchor the room at several scales.
    this.sigil(c,W.w/2,W.h/2,235,'#a79c70',.15,0);
    this.sigil(c,W.spawn.x,W.spawn.y,52,'#c0a46a',.28,0);
    c.strokeStyle='#8d95712e';c.lineWidth=1;c.strokeRect(23,23,W.w-46,W.h-46);c.strokeRect(30,30,W.w-60,W.h-60);
    for(let x=45;x<W.w;x+=45){c.fillStyle='#93a09235';polygon(c,[[x,23],[x+3,27],[x,31],[x-3,27]]);c.fill();}
    for(let i=0;i<35;i++){
      const x=rng.range(40,W.w-40),y=rng.range(40,W.h-40),r=rng.range(25,95);
      c.save();c.translate(x,y);c.scale(1,.45);this.glowCircle(c,0,0,r,'#477777',.09);c.restore();
    }
    W.decor.forEach((d,i)=>{
      c.save();c.translate(d.x,d.y);c.rotate(d.a);
      c.fillStyle='#050b0d99';c.beginPath();c.ellipse(3,5,d.r*1.7,d.r*.8,0,0,TAU);c.fill();
      if(i%3===0){
        c.fillStyle='#4b5851';polygon(c,[[-d.r,3],[-d.r*.7,-5],[3,-d.r*.6],[d.r,2],[3,7]]);c.fill();
        c.strokeStyle='#8b978440';c.beginPath();c.moveTo(-d.r*.7,-5);c.lineTo(3,-d.r*.6);c.lineTo(d.r,2);c.stroke();
      }else if(i%3===1){
        c.strokeStyle='#7c80603b';c.lineWidth=2;c.beginPath();c.moveTo(-12,-3);c.lineTo(8,5);c.moveTo(-8,6);c.lineTo(10,-7);c.stroke();
      }else{c.strokeStyle='#5b8c7959';c.lineWidth=1;for(let k=0;k<5;k++){c.beginPath();c.moveTo(0,7);c.quadraticCurveTo(k*3-8,-3,k*5-11,-d.r);c.stroke();}}
      c.restore();
    });
    W.obstacles.forEach(o=>{
      c.fillStyle='#02080bad';c.fillRect(o.x+10,o.y+12,o.w+8,o.h+10);
      const g=c.createLinearGradient(o.x,o.y,o.x+o.w,o.y+o.h);g.addColorStop(0,'#3e5253');g.addColorStop(1,'#1d2c31');
      c.fillStyle=g;c.fillRect(o.x,o.y,o.w,o.h);
      c.fillStyle='#6d827c50';c.fillRect(o.x,o.y,o.w,4);c.fillRect(o.x,o.y,3,o.h);
      c.fillStyle='#060e14b3';c.fillRect(o.x,o.y+o.h-9,o.w,9);c.fillRect(o.x+o.w-7,o.y,7,o.h);
      c.strokeStyle='#a9b1a133';c.strokeRect(o.x+10,o.y+10,o.w-20,o.h-24);
      c.strokeStyle='#050e1370';c.lineWidth=2;
      for(let y=o.y+35;y<o.y+o.h-10;y+=31){c.beginPath();c.moveTo(o.x+3,y);c.lineTo(o.x+o.w-8,y);c.stroke();}
      for(let k=0;k<4;k++){
        const x=o.x+(k%2?o.w-13:13),y=o.y+(k<2?13:o.h-19);
        c.fillStyle='#82908360';circle(c,x,y,2);c.fill();
      }
      this.sigil(c,o.x+o.w/2,o.y+o.h/2-4,Math.min(o.w,o.h)*.23,'#9eab89',.3,0);
      c.strokeStyle='#091117';c.beginPath();c.moveTo(o.x+o.w*.65,o.y);c.lineTo(o.x+o.w*.5,o.y+19);c.lineTo(o.x+o.w*.59,o.y+27);c.stroke();
    });
    this.worldCache={world:W,canvas};
  }
  sigil(c,x,y,r,color,alpha,angle){
    c.save();c.translate(x,y);c.rotate(angle);c.strokeStyle=hexA(color,alpha);c.lineWidth=1;
    [1,.93,.73].forEach(f=>{circle(c,0,0,r*f);c.stroke();});
    for(let i=0;i<24;i++){
      const a=i*TAU/24;c.beginPath();c.moveTo(Math.cos(a)*r*.94,Math.sin(a)*r*.94);c.lineTo(Math.cos(a)*r*(i%3===0?1.07:1),Math.sin(a)*r*(i%3===0?1.07:1));c.stroke();
    }
    for(let i=0;i<8;i++){c.save();c.rotate(i*TAU/8);polygon(c,[[0,-r*.83],[r*.026,-r*.88],[0,-r*.92],[-r*.026,-r*.88]]);c.stroke();c.restore();}
    polygon(c,[[0,-r*.73],[r*.73,0],[0,r*.73],[-r*.73,0]]);c.stroke();c.restore();
  }
  bakeMenu(){
    const canvas=document.createElement('canvas');canvas.width=this.w*this.dpr;canvas.height=this.h*this.dpr;
    const c=canvas.getContext('2d');c.scale(this.dpr,this.dpr);const w=this.w,h=this.h,x=w*.715,y=h*.445,s=Math.min(w/1400,h/880);
    c.fillStyle='#080f14';c.fillRect(0,0,w,h);
    const g=c.createRadialGradient(x,y,0,x,y,h*.8);g.addColorStop(0,'#223333');g.addColorStop(.55,'#0e1a21');g.addColorStop(1,'#050a0f');c.fillStyle=g;c.fillRect(0,0,w,h);
    // A receding, pointed stone arch behind the suspended relic.
    c.save();c.translate(x,y);c.scale(s,s);
    for(let j=6;j>=0;j--){
      const a=188+j*32,b=-262-j*34;
      c.fillStyle=j%2?'#112027':'#14242a';c.strokeStyle='#6b82732b';c.lineWidth=1.5;
      c.beginPath();c.moveTo(-a,470);c.lineTo(-a,-40);c.bezierCurveTo(-a,-170,-a*.48,b-25,0,b-78);c.bezierCurveTo(a*.48,b-25,a,-170,a,-40);c.lineTo(a,470);c.closePath();c.fill();c.stroke();
    }
    c.strokeStyle='#667c6826';
    for(let j=0;j<14;j++){const yy=-100+j*43;c.beginPath();c.moveTo(-375,yy);c.lineTo(-201,yy+12);c.moveTo(201,yy+12);c.lineTo(375,yy);c.stroke();}
    // Soft shafts of cold light and a stepped plinth.
    c.globalCompositeOperation='screen';const beam=c.createLinearGradient(-120,-450,40,380);beam.addColorStop(0,'#92bba21c');beam.addColorStop(1,'#92bba200');c.fillStyle=beam;
    polygon(c,[[-150,-450],[-104,-450],[170,390],[30,390]]);c.fill();c.globalCompositeOperation='source-over';
    for(let i=4;i>=0;i--){const ww=115+i*31,yy=225+i*18;c.fillStyle=i%2?'#18282b':'#1b2d30';polygon(c,[[-ww,yy],[0,yy-25],[ww,yy],[ww,yy+17],[0,yy+40],[-ww,yy+17]]);c.fill();c.strokeStyle='#88937a35';c.stroke();}
    c.restore();
    const rng=new Rng(7483);for(let i=0;i<10000;i++){c.fillStyle=i%2?'#d0c6a403':'#00000009';c.fillRect(rng.range(0,w),rng.range(0,h),1,1);}
    this.menuCache=canvas;
  }
  render(G,dt){
    const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';
    if(!G||!G.world){this.renderMenu(dt);return;}this.renderGame(G,dt);
  }
  renderMenu(dt){
    if(!this.menuCache)this.bakeMenu();
    if(!this.reducedMotion)this.menuTime+=Math.min(dt,.05);
    const c=this.ctx,t=this.menuTime,w=this.w,h=this.h,x=w*.715,y=h*.445,s=Math.min(w/1400,h/880);
    c.drawImage(this.menuCache,0,0,w,h);
    c.save();c.translate(x,y);c.scale(s,s);
    c.globalCompositeOperation='lighter';this.glowCircle(c,0,30,280,'#bd8846',.16);this.glowCircle(c,0,15,125,'#ffb358',.2);
    c.globalCompositeOperation='source-over';this.sigil(c,0,0,220,'#bda773',.24,t*.018);this.sigil(c,0,0,166,'#d2b477',.17,-t*.027);
    c.save();c.translate(0,Math.sin(t*1.25)*7);c.rotate(Math.sin(t*.7)*.025);
    const metal=c.createLinearGradient(-80,0,80,0);metal.addColorStop(0,'#5a4a35');metal.addColorStop(.28,'#b39b68');metal.addColorStop(.5,'#d5be83');metal.addColorStop(.7,'#776340');metal.addColorStop(1,'#4e422f');
    c.strokeStyle='#aa9662';c.lineWidth=5;circle(c,0,-155,26);c.stroke();c.strokeStyle='#3e4437';c.lineWidth=2;circle(c,0,-155,20);c.stroke();
    c.fillStyle=metal;polygon(c,[[-72,-78],[-47,-100],[-20,-111],[-13,-133],[13,-133],[20,-111],[47,-100],[72,-78]]);c.fill();
    c.strokeStyle='#ebd19480';c.lineWidth=1;c.stroke();
    const glass=c.createLinearGradient(-65,0,65,0);glass.addColorStop(0,'#cc883017');glass.addColorStop(.5,'#edbd7140');glass.addColorStop(1,'#cc883012');c.fillStyle=glass;polygon(c,[[-65,-76],[65,-76],[49,104],[-49,104]]);c.fill();
    c.globalCompositeOperation='lighter';this.glowCircle(c,0,27,145,'#ff9c37',.5);this.glowCircle(c,0,27,65,'#ffd17b',.65);
    for(let i=0;i<5;i++){
      const yy=35-i*9,ww=29-i*4,tip=-60-i*8+Math.sin(t*5+i)*8;
      c.fillStyle=['#b34b142b','#f0792580','#ffa943bb','#ffe39bdb','#fff4cde6'][i];
      c.beginPath();c.moveTo(0,68);c.bezierCurveTo(-ww*1.7,40,-ww,yy,Math.sin(t*4+i)*12,tip);c.bezierCurveTo(-10,6,ww*2,30,ww*.6,54);c.quadraticCurveTo(10,73,0,68);c.fill();
    }
    c.globalCompositeOperation='source-over';
    c.fillStyle=metal;polygon(c,[[-68,-77],[-57,-77],[-43,104],[-51,110]]);c.fill();polygon(c,[[57,-77],[68,-77],[51,110],[43,104]]);c.fill();
    c.fillRect(-4,-78,8,188);c.fillStyle='#f3d2945e';c.fillRect(-2,-76,1,178);
    c.fillStyle=metal;polygon(c,[[-52,103],[52,103],[66,122],[66,132],[-66,132],[-66,122]]);c.fill();c.fillRect(-75,132,150,8);
    c.strokeStyle='#d1b57980';c.strokeRect(-62,117,124,8);
    c.fillStyle=metal;polygon(c,[[-16,141],[16,141],[8,157],[0,169],[-8,157]]);c.fill();
    for(let i=0;i<7;i++){c.fillStyle='#141d18';c.fillRect(-45+i*15,-94,5,10);}
    c.restore();
    c.globalCompositeOperation='lighter';
    for(let i=0;i<27;i++){
      const phase=(t*.12+i*.137)%1,ang=i*2.399+phase*.7,rr=75+phase*170;
      const px=Math.cos(ang)*rr,py=120-phase*370;
      this.glowCircle(c,px,py,5,'#e6ad5a',Math.sin(phase*Math.PI)*.35);
      c.fillStyle=hexA('#e8c68a',Math.sin(phase*Math.PI)*.6);c.fillRect(px,py,1.5,2.5);
    }
    c.restore();this.drawAtmosphere(c,t,0,0,true);
  }
  punchHole(c,x,y,r){
    if(r<1||x+r<0||y+r<0||x-r>this.w||y-r>this.h)return;
    const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'#000');g.addColorStop(.35,'#000000dd');g.addColorStop(.7,'#00000080');g.addColorStop(1,'#00000000');c.fillStyle=g;circle(c,x,y,r);c.fill();
  }
  renderGame(G,dt){
    const c=this.ctx,lc=this.lctx,W=G.world,P=G.P,t=G.t;
    const origin=G.cameraOrigin(),shake=this.reducedMotion?0:Math.min(G.shake,12);
    const ox=origin.x+(Math.random()-.5)*shake,oy=origin.y+(Math.random()-.5)*shake;
    this.bounds={x:ox,y:oy,w:this.w,h:this.h};
    c.fillStyle='#060d12';c.fillRect(0,0,this.w,this.h);
    if(!this.worldCache||this.worldCache.world!==W)this.bakeWorld(W);
    c.save();c.translate(-ox,-oy);c.drawImage(this.worldCache.canvas,0,0);
    const lightR=Math.max(12,P.lightR*G.lightMult());
    // Long, soft silhouettes give the lantern physical weight in the room.
    c.fillStyle='rgba(1,5,9,.35)';
    W.obstacles.forEach(o=>{
      if(dist(P.x,P.y,o.x+o.w/2,o.y+o.h/2)>lightR+Math.max(o.w,o.h))return;
      const pts=[[o.x,o.y],[o.x+o.w,o.y],[o.x+o.w,o.y+o.h],[o.x,o.y+o.h]];
      for(let i=0;i<4;i++){
        const a=pts[i],b=pts[(i+1)%4],dx=(a[0]+b[0])/2-P.x,dy=(a[1]+b[1])/2-P.y;
        if((i===0&&dy<0)||(i===1&&dx>0)||(i===2&&dy>0)||(i===3&&dx<0))continue;
        polygon(c,[a,b,[b[0]+(b[0]-P.x)*2,b[1]+(b[1]-P.y)*2],[a[0]+(a[0]-P.x)*2,a[1]+(a[1]-P.y)*2]]);c.fill();
      }
    });
    c.restore();
    lc.globalCompositeOperation='source-over';lc.clearRect(0,0,this.w,this.h);lc.fillStyle='rgba(2,8,14,.68)';lc.fillRect(0,0,this.w,this.h);
    lc.globalCompositeOperation='destination-out';
    const flick=this.reducedMotion?1:1+.025*Math.sin(t*13)+.012*Math.sin(t*29);
    this.punchHole(lc,P.x-ox,P.y-oy,lightR*1.45*flick);
    W.vents.forEach(v=>this.punchHole(lc,v.x-ox,v.y-oy,v.active&&v.fuel>0?125:48));
    W.pickups.forEach(p=>this.punchHole(lc,p.x-ox,p.y-oy,p.type==='ember'?35:57));
    this.punchHole(lc,W.gate.x-ox,W.gate.y-oy,W.gateOpen?160:65);
    if(P.flameOn)this.punchHole(lc,P.x+Math.cos(P.aim)*100-ox,P.y+Math.sin(P.aim)*100-oy,P.flame.range*.85);
    if(P.surgeT>0)this.punchHole(lc,P.x-ox,P.y-oy,P.surge.r*(1-P.surgeT/.6)*1.3);
    lc.globalCompositeOperation='source-over';c.drawImage(this.light,0,0);
    c.save();c.translate(-ox,-oy);
    c.globalCompositeOperation='lighter';this.glowCircle(c,P.x,P.y,lightR*1.4,'#d59648',P.oil>0?.15:.025);c.globalCompositeOperation='source-over';
    this.drawGate(c,G,t);this.drawVents(c,G,t);this.drawPickups(c,G,t);
    this.drawTrails(c,G);this.drawEnemies(c,G,t);this.drawFlameCone(c,P,t);this.drawSurge(c,P);
    this.drawPlayer(c,G,t);this.drawShots(c,G);this.drawParticles(c,G);this.drawEffects(c,G);
    c.restore();this.drawAtmosphere(c,this.reducedMotion?0:t,ox,oy,false);this.drawReticle(G,ox,oy);this.drawDamage(c,G);this.drawGateGuide(c,G,ox,oy);
    this.syncHud(G,P,W);
  }
  visible(x,y,pad=80){const b=this.bounds;return x>b.x-pad&&y>b.y-pad&&x<b.x+b.w+pad&&y<b.y+b.h+pad;}
  drawVents(c,G,t){
    G.world.vents.forEach((v,i)=>{
      if(!this.visible(v.x,v.y))return;
      const active=v.active&&v.fuel>0,frac=active?clamp(v.fuel/v.maxFuel,0,1):0;
      const color=active?'#83e3c2':'#596863',pulse=.5+.5*Math.sin(t*4+(v.seed||i));
      c.save();c.translate(v.x,v.y);c.fillStyle=active?'#183433':'#1a2729';circle(c,0,0,24);c.fill();c.strokeStyle=hexA(color,active?.45+.25*pulse:.2);c.lineWidth=2;circle(c,0,0,25);c.stroke();
      if(active){
        c.globalCompositeOperation='lighter';this.glowCircle(c,0,0,105,color,.22+.13*pulse);c.globalCompositeOperation='source-over';
        c.strokeStyle=hexA(color,.65);c.lineWidth=2;c.beginPath();c.arc(0,0,31,-Math.PI/2,-Math.PI/2+TAU*frac);c.stroke();
      }
      for(let k=-1;k<=1;k++){
        c.fillStyle='#090e11';c.fillRect(-16,k*9-2,32,5);c.fillStyle=hexA(color,active?.62+.22*Math.sin(t*3+i+k):.16);c.fillRect(-13,k*9,26,1.5);
      }
      if(active&&!this.reducedMotion)for(let k=0;k<7;k++){const p=(t*.55+k*.17)%1;c.fillStyle=hexA('#b7ffe3',(1-p)*.72);circle(c,Math.sin(k*6+t)*12,-8-p*45,1.2+p);c.fill();}
      c.font='8px "Courier New"';c.textAlign='center';c.fillStyle=active?hexA(color,.9):'#66746e';c.fillText(active?'FUEL '+Math.ceil(v.fuel):'RECHARGING',0,45);
      c.restore();
    });
  }
  drawGate(c,G,t){
    const W=G.world,x=W.gate.x,y=W.gate.y,open=W.gateOpen;if(!this.visible(x,y,140))return;
    c.save();c.translate(x,y);c.fillStyle='#091316';circle(c,0,0,47);c.fill();
    this.sigil(c,0,0,54,open?'#f4c982':'#7d927c',open?.65:.32,open&&!this.reducedMotion?t*.16:0);
    for(let j=0;j<5;j++){
      const yy=-23+j*11,ww=29-j*2;c.fillStyle=open?hexA('#d7ad67',.12+j*.035):'#2b3d3b';c.fillRect(-ww,yy,ww*2,9);c.fillStyle=open?'#ffe1a4aa':'#63756a66';c.fillRect(-ww,yy,ww*2,1);
    }
    if(open){
      c.globalCompositeOperation='lighter';this.glowCircle(c,0,0,120,'#edb25d',.4);
      for(let i=0;i<15;i++){const p=(t*.38+i/15)%1,a=i*2.399;c.fillStyle=hexA('#ffdb94',Math.sin(p*Math.PI)*.8);circle(c,Math.cos(a)*40*(1-p),Math.sin(a)*20-p*45,1.5);c.fill();}
      c.globalCompositeOperation='source-over';c.font='9px "Courier New"';c.textAlign='center';c.fillStyle='#e5ca97';c.fillText('DESCEND',0,79);
    }c.restore();
  }
  drawPickups(c,G,t){
    G.world.pickups.forEach(p=>{
      if(!this.visible(p.x,p.y,40))return;
      const bob=this.reducedMotion?0:Math.sin(t*2.6+p.t)*3;const color=p.type==='wick'?'#98d9bc':'#eec480';
      c.save();c.translate(p.x,p.y);c.fillStyle='#00000066';c.beginPath();c.ellipse(0,9,9,3,0,0,TAU);c.fill();this.glowCircle(c,0,0,30,color,.15);c.translate(0,bob);
      if(p.type==='ember'){
        c.rotate(.2*Math.sin(t*1.5+p.t));c.fillStyle='#bf7c3e';polygon(c,[[0,-8],[5,0],[0,8],[-5,0]]);c.fill();c.fillStyle='#ffe0a1';polygon(c,[[0,-8],[0,5],[-4,0]]);c.fill();
      }else if(p.type==='oil'){
        c.fillStyle='#172a2a';rrPath(c,-7,-9,14,19,3);c.fill();c.strokeStyle='#c9aa68';c.lineWidth=1;c.stroke();c.fillStyle='#dda64fa6';c.fillRect(-5,-1,10,8);c.fillStyle='#7f754e';c.fillRect(-4,-13,8,5);c.fillStyle='#ffe5a9a6';c.fillRect(-4,-6,2,11);
      }else{
        c.strokeStyle='#98d9bc';c.lineWidth=1;c.rotate(Math.PI/4);c.strokeRect(-7,-7,14,14);c.fillStyle='#a4e0c2';c.fillRect(-2,-6,4,12);c.fillRect(-6,-2,12,4);
      }c.restore();
    });
  }
  drawEnemies(c,G,t){
    G.enemies.forEach(e=>{
      if(e.dead||!this.visible(e.x,e.y))return;
      const tt=this.reducedMotion?0:t,ang=Math.atan2(G.P.y-e.y,G.P.x-e.x),r=e.r,color=e.d.eye;
      c.save();c.translate(e.x,e.y);c.fillStyle='#0000007a';c.beginPath();c.ellipse(0,r*.65,r*1.1,r*.45,0,0,TAU);c.fill();
      this.glowCircle(c,0,0,r*2.2,color,e.isBoss?.18:.11);
      if(e.isBoss){
        this.sigil(c,0,0,r+16,color,.3,-tt*.35);
        if(e.pat.endsWith('T')||e.pat==='telegraph'){this.sigil(c,0,0,r+28,color,.55,tt);}
        if(e.pat==='telegraph'){
          c.save();c.rotate(Math.atan2(e.ty-e.y,e.tx-e.x));const len=dist(e.x,e.y,e.tx,e.ty);
          const g=c.createLinearGradient(0,0,len,0);g.addColorStop(0,hexA(color,.2));g.addColorStop(1,hexA(color,.02));c.fillStyle=g;c.fillRect(0,-r,len,r*2);c.strokeStyle=hexA(color,.6);c.setLineDash([8,12]);c.beginPath();c.moveTo(0,0);c.lineTo(len,0);c.stroke();c.restore();
        }
      }
      c.rotate(ang);
      // Each creature has a distinct readable silhouette and animated appendages.
      for(let k=0;k<(e.isBoss?7:4);k++){
        const side=k%2?1:-1,offset=(k+1)/5;
        c.strokeStyle=hexA(color,.2);c.lineWidth=e.isBoss?2:1;
        c.beginPath();c.moveTo(-r*.3,side*r*.4);c.bezierCurveTo(-r*1.2,side*r*offset,-r*(1.2+offset),side*r*.2+Math.sin(tt*4+k+e.seed)*r*.5,-r*(1.8+offset),side*r*.5+Math.sin(tt*3+k)*r*.4);c.stroke();
      }
      const fill=c.createLinearGradient(-r,0,r,0);fill.addColorStop(0,'#111924');fill.addColorStop(.65,e.flash>0?'#65544a':'#27353d');fill.addColorStop(1,'#172129');c.fillStyle=fill;c.strokeStyle=hexA(color,e.flash>0?.75:.38);c.lineWidth=1.2;
      if(e.type==='gleam'){
        polygon(c,[[r,0],[-r*.6,-r*.65],[-r*.2,0],[-r*.6,r*.65]]);c.fill();c.stroke();
      }else if(e.type==='hollow'||e.type==='warden'){
        polygon(c,[[r*.75,-r*.55],[r*.9,r*.4],[r*.15,r*.9],[-r*.8,r*.8],[-r*1.1,0],[-r*.75,-r*.9],[0,-r]]);c.fill();c.stroke();
        for(let k=-1;k<=1;k++){c.beginPath();c.moveTo(-r*.4,k*r*.43);c.lineTo(r*.1,k*r*.35);c.lineTo(r*.4,k*r*.5);c.stroke();}
        if(e.isBoss){polygon(c,[[r*.7,-r*.7],[r*1.4,-r*.9],[r*.9,-r*.2],[r*1.6,0],[r*.9,r*.2],[r*1.4,r*.9],[r*.7,r*.7]]);c.fill();c.stroke();}
      }else{
        c.beginPath();c.moveTo(r*.85,0);c.bezierCurveTo(r*.7,-r,-r*.5,-r,-r*1.3,-r*.65);c.quadraticCurveTo(-r*.8,Math.sin(tt*5+e.seed)*r*.35,-r*1.4,r*.75);c.bezierCurveTo(-r*.4,r,r*.7,r,r*.85,0);c.fill();c.stroke();
        if(e.type==='douser'){c.strokeStyle=hexA(color,.6);circle(c,0,0,r+5);c.stroke();}
      }
      c.fillStyle='#071013';c.beginPath();c.ellipse(r*.25,0,r*.47,r*.57,0,0,TAU);c.fill();
      c.globalCompositeOperation='lighter';this.glowCircle(c,r*.5,0,r*.7,color,.65);c.fillStyle=color;
      [-1,1].forEach(side=>{c.save();c.translate(r*.46,side*r*.23);c.rotate(side*.35);c.fillRect(-2,-1,e.isBoss?7:4,e.isBoss?3:2);c.restore();});
      c.restore();
      if(e.flash>0&&!e.isBoss&&e.hp<e.maxHp){c.fillStyle='#172125';c.fillRect(e.x-r,e.y-r-10,r*2,2);c.fillStyle=hexA(color,.8);c.fillRect(e.x-r,e.y-r-10,r*2*clamp(e.hp/e.maxHp,0,1),2);}
    });
  }
  keeper(c,x,y,aim,walk,t,ghost=false,lit=true){
    c.save();c.translate(x,y);c.rotate(aim);const stride=Math.sin(walk)*2.8;
    if(!ghost){c.fillStyle='#00000066';c.beginPath();c.ellipse(-2,4,17,12,0,0,TAU);c.fill();}
    c.fillStyle=ghost?'#caa76a66':'#393c35';c.fillRect(-4+stride,-8,10,5);c.fillRect(-4-stride,4,10,5);
    const g=c.createLinearGradient(-19,0,10,0);g.addColorStop(0,ghost?'#dfa64f00':'#384d4b');g.addColorStop(.6,ghost?'#e3bd7999':'#819283');g.addColorStop(1,ghost?'#ffe4a9aa':'#b4b69b');c.fillStyle=g;
    c.beginPath();c.moveTo(5,-9);c.quadraticCurveTo(-7,-17,-22,-12+Math.sin(t*6)*2);c.quadraticCurveTo(-16,-3,-23,11+Math.sin(t*6+1)*3);c.quadraticCurveTo(-5,15,5,9);c.closePath();c.fill();
    c.strokeStyle=ghost?'#ffda8666':'#bfa879a6';c.lineWidth=1;c.beginPath();c.moveTo(4,-9);c.quadraticCurveTo(-9,-13,-20,-11);c.moveTo(4,9);c.quadraticCurveTo(-10,12,-21,10);c.stroke();
    c.strokeStyle='#24373899';c.beginPath();c.moveTo(-2,-5);c.lineTo(-17,-6);c.moveTo(-2,4);c.lineTo(-18,7);c.stroke();
    c.fillStyle=ghost?'#f6d49799':'#c0bf9f';c.beginPath();c.ellipse(2,0,9,10,0,0,TAU);c.fill();c.fillStyle='#122126';c.beginPath();c.ellipse(5,0,5,6.5,0,0,TAU);c.fill();
    if(!ghost){
      c.strokeStyle='#99957a';c.lineWidth=4;c.beginPath();c.moveTo(0,8);c.lineTo(9,14);c.lineTo(17,10);c.stroke();
      c.strokeStyle='#736248';c.lineWidth=1;c.strokeRect(14,5,9,12);c.fillStyle=lit?'#ffcd75':'#554735';c.fillRect(16,7,5,8);c.fillStyle=lit?'#fff3c5':'#73644b';c.fillRect(17,9,2,5);
      if(lit){c.globalCompositeOperation='lighter';this.glowCircle(c,18,11,28,'#ffb953',.8);c.globalCompositeOperation='source-over';}
    }c.restore();
  }
  drawPlayer(c,G,t){
    const P=G.P;c.save();if(P.invulnT>0)c.globalAlpha=this.reducedMotion?.75:.8+.2*Math.sin(t*18);
    this.keeper(c,P.x,P.y,P.aim,P.walk||0,this.reducedMotion?0:t,false,P.oil>0);c.restore();
    if(P.oil>0){c.save();c.globalCompositeOperation='lighter';this.glowCircle(c,P.x+Math.cos(P.aim)*14,P.y+Math.sin(P.aim)*14,16,'#ffcf80',.25);c.restore();}
  }
  drawTrails(c,G){
    if(this.reducedMotion)return;c.save();
    (G.trails||[]).forEach(p=>{c.globalAlpha=p.life/p.maxLife*.42;this.keeper(c,p.x,p.y,p.aim,0,0,true);});c.restore();
  }
  drawFlameCone(c,P,t){
    if(!P.flameOn)return;const f=P.flame;c.save();c.translate(P.x,P.y);c.rotate(P.aim);c.globalCompositeOperation='lighter';
    const g=c.createRadialGradient(8,0,0,8,0,f.range);g.addColorStop(0,'#ffc95b55');g.addColorStop(.6,'#ee651522');g.addColorStop(1,'#ee651500');c.fillStyle=g;c.beginPath();c.moveTo(7,0);c.arc(0,0,f.range,-f.half,f.half);c.closePath();c.fill();
    // Translucent tapered tongues curl inside the actual attack envelope.
    for(let i=0;i<9;i++){
      const reach=f.range*(.72+.2*Math.sin(t*8+i*2.3)),width=reach*(.12+.02*Math.sin(t*11+i)),wave=Math.sin(t*12+i*3)*width*.3;
      c.save();c.rotate((i-4)/4*f.half*.78);
      const tongue=c.createLinearGradient(10,0,reach,0);tongue.addColorStop(0,'#fff0b05c');tongue.addColorStop(.3,'#ffce634d');tongue.addColorStop(.72,'#f18b283d');tongue.addColorStop(1,'#e6581200');c.fillStyle=tongue;
      c.beginPath();c.moveTo(12,-3);c.bezierCurveTo(reach*.28,-width*.1,reach*.5,-width*.9,reach*.72,-width*.4);c.quadraticCurveTo(reach*.87,-width*.35,reach,wave);c.bezierCurveTo(reach*.72,width*.8,reach*.46,width*.25,reach*.24,width*.14);c.quadraticCurveTo(10,8,12,-3);c.fill();c.restore();
    }
    for(let i=0;i<12;i++){
      const p=(t*2+i*.618)%1,a=Math.sin(i*2.399)*f.half*.8,x=18+p*(f.range-18),y=Math.sin(a)*x;
      c.fillStyle=hexA('#ffdb83',Math.sin(p*Math.PI)*.7);c.fillRect(x,y,2.5*(1-p)+.5,1.2);
    }
    this.glowCircle(c,17,0,26,'#ffdc88',.65);c.restore();
  }
  drawSurge(c,P){
    if(P.surgeT<=0)return;const f=clamp(1-P.surgeT/.6,0,1),r=P.surge.r*(1-Math.pow(1-f,2));
    c.save();c.globalCompositeOperation='lighter';this.glowCircle(c,P.x,P.y,r,'#dc9445',(1-f)*.25);
    for(let i=0;i<3;i++){c.strokeStyle=hexA(i===0?'#fff2c4':'#e4a04d',(1-f)*(.8-i*.22));c.lineWidth=i===0?2:7;circle(c,P.x,P.y,Math.max(1,r-i*12));c.stroke();}
    for(let i=0;i<32;i++){const a=i*TAU/32;c.strokeStyle=hexA('#ffe1a0',(1-f)*.7);c.lineWidth=1;c.beginPath();c.moveTo(P.x+Math.cos(a)*r,P.y+Math.sin(a)*r);c.lineTo(P.x+Math.cos(a)*(r-15*(1-f)),P.y+Math.sin(a)*(r-15*(1-f)));c.stroke();}c.restore();
  }
  drawShots(c,G){
    c.save();c.globalCompositeOperation='lighter';G.shots.forEach(s=>{
      if(s.dead||!this.visible(s.x,s.y,40))return;
      c.save();c.translate(s.x,s.y);c.rotate(Math.atan2(s.vy,s.vx));
      const g=c.createLinearGradient(-38,0,5,0);g.addColorStop(0,hexA(s.color,0));g.addColorStop(1,hexA(s.color,.7));c.fillStyle=g;polygon(c,[[-38,0],[0,-s.r*.7],[5,0],[0,s.r*.7]]);c.fill();
      this.glowCircle(c,0,0,s.r*4,s.color,.6);c.fillStyle=s.kind==='shard'?'#ffe1a8':'#edd7ff';polygon(c,[[s.r,0],[0,-s.r*.5],[-s.r,0],[0,s.r*.5]]);c.fill();c.restore();
    });c.restore();
  }
  drawParticles(c,G){
    c.save();c.globalCompositeOperation='lighter';G.particles.forEach(p=>{
      if(!this.visible(p.x,p.y,20))return;const a=clamp(p.life/p.maxLife,0,1),size=p.size*a;
      c.strokeStyle=hexA(p.color,a*.8);c.lineWidth=Math.max(.6,size*.5);c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x-p.vx*.025,p.y-p.vy*.025);c.stroke();
      if(p.size>3)this.glowCircle(c,p.x,p.y,Math.max(2,size*3),p.color,a*.24);
      c.fillStyle=hexA('#fff0ca',a*.75);c.fillRect(p.x-.6,p.y-.6,1.2,1.2);
    });c.restore();
  }
  drawEffects(c,G){
    (G.effects||[]).forEach(e=>{
      const f=1-e.life/e.maxLife;c.save();c.globalAlpha=1-f;
      if(e.kind==='ring'){
        c.globalCompositeOperation='lighter';c.strokeStyle=e.color;c.lineWidth=2*(1-f)+.5;circle(c,e.x,e.y,e.r*(.25+f*.75));c.stroke();this.glowCircle(c,e.x,e.y,e.r*.8,e.color,(1-f)*.3);
      }else{
        c.font='10px "Courier New"';c.textAlign='center';c.fillStyle=e.color;c.shadowColor='#03090e';c.shadowBlur=5;c.fillText(e.text,e.x,e.y-18-f*25);
      }c.restore();
    });
  }
  drawAtmosphere(c,t,ox,oy,menu){
    c.save();c.globalCompositeOperation='lighter';const w=this.w,h=this.h;
    this.ambient.forEach((m,i)=>{
      const x=((m.x*w+Math.sin(t*.2+m.phase)*18-ox*.16)%(w+40)+w+40)%(w+40)-20;
      const y=((m.y*h-t*m.v*100-oy*.16)%(h+40)+h+40)%(h+40)-20;
      const a=.12+.12*Math.sin(m.phase+t*.8);c.fillStyle=hexA(i%4===0?'#f3c37d':'#8ab1aa',a);c.fillRect(x,y,m.s*.65,m.s*(menu?1.6:1));
    });c.restore();
  }
  drawReticle(G,ox,oy){
    if(G.state!=='playing')return;const c=this.ctx,P=G.P,x=G.mouse.x,y=G.mouse.y;
    if(!x&&!y)return;c.save();c.translate(x,y);c.strokeStyle=P.flameOn?'#ffda88':'#b5bea080';c.lineWidth=1;
    const r=P.flameOn?8:6;for(let i=0;i<4;i++){c.rotate(Math.PI/2);c.beginPath();c.moveTo(r,0);c.lineTo(r+4,0);c.stroke();}circle(c,0,0,2);c.stroke();c.restore();
  }
  drawDamage(c,G){
    const hurt=G.hurtT||0,low=clamp((.3-G.P.hp/G.P.maxHp)/.3,0,1)*.25;
    if(hurt<=0&&low<=0)return;const a=this.reducedMotion?low:Math.max(low,hurt*.55);
    const g=c.createRadialGradient(this.w/2,this.h/2,this.h*.2,this.w/2,this.h/2,Math.max(this.w,this.h)*.65);g.addColorStop(0,'#a22e3000');g.addColorStop(1,hexA('#bd4940',a));c.fillStyle=g;c.fillRect(0,0,this.w,this.h);
  }
  drawGateGuide(c,G,ox,oy){
    if(!G.world.gateOpen)return;const gate=G.world.gate,x=gate.x-ox,y=gate.y-oy;
    if(x>60&&x<this.w-60&&y>120&&y<this.h-80)return;
    const a=Math.atan2(y-this.h/2,x-this.w/2),xx=clamp(x,45,this.w-45),yy=clamp(y,160,this.h-110);
    c.save();c.translate(xx,yy);c.rotate(a);c.strokeStyle='#eac986';c.lineWidth=1.5;c.beginPath();c.moveTo(-6,-6);c.lineTo(0,0);c.lineTo(-6,6);c.stroke();c.restore();
  }
  syncHud(G,P,W){
    if(!this.hud){const $=id=>document.getElementById(id);this.hud={};['hpFill','hpText','oilFill','oilText','floorLabel','floorName','scoreVal','emberVal','surgeFill','dashFill','surgeTime','dashTime','bossWrap','bossName','bossFill','darkWarn','hint','objective','fuelPrompt'].forEach(id=>this.hud[id]=$(id));}
    // The HUD does not need to update at the canvas frame rate.
    if(this.hudTime!==undefined&&G.t-this.hudTime<.08&&G.t>=this.hudTime)return;this.hudTime=G.t;
    const h=this.hud;h.hpFill.style.width=clamp(P.hp/P.maxHp*100,0,100)+'%';h.oilFill.style.width=clamp(P.oil/P.maxOil*100,0,100)+'%';
    h.hpText.textContent=Math.ceil(P.hp)+' / '+P.maxHp;h.oilText.textContent=Math.ceil(P.oil)+' / '+P.maxOil;
    h.floorLabel.textContent='DEPTH '+String(W.num).padStart(2,'0');h.floorName.textContent=floorName(W.num);
    h.scoreVal.textContent=String(Math.round(G.score)).padStart(4,'0');h.emberVal.textContent='◆ '+Math.round(G.embers)+' EMBERS';
    ['surge','dash'].forEach(k=>{const ready=P[k+'CdT']<=0;h[k+'Fill'].style.height=clamp(1-P[k+'CdT']/P[k].cd,0,1)*100+'%';h[k+'Time'].textContent=ready?'':P[k+'CdT'].toFixed(1);h[k+'Fill'].parentElement.classList.toggle('ready',ready);});
    const boss=G.enemies.find(e=>e.isBoss&&!e.dead);h.bossWrap.classList.toggle('hidden',!boss);
    if(boss){h.bossName.textContent=boss.d.name;h.bossFill.style.width=clamp(boss.hp/boss.maxHp*100,0,100)+'%';}
    const remaining=G.enemies.length+W.spawnsLeft;h.objective.textContent=W.gateOpen?'THE STAIR IS LIT · DESCEND':boss?'EXTINGUISH THE '+(boss.type==='warden'?'WARDEN':'WRAITH'):remaining+' SHADOWS REMAIN';
    h.darkWarn.classList.toggle('hidden',P.oil>5||P.hp<=0);h.hint.classList.toggle('off',G.t>12);
    if(h.fuelPrompt){h.fuelPrompt.classList.toggle('hidden',!G.fuelStatus);h.fuelPrompt.textContent=G.fuelStatus||'';}
  }
}
window.Renderer=Renderer;
