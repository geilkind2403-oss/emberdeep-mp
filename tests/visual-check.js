'use strict';
// Browser integration fixtures, isolated from the normal game entry point.
(function(){
  const results=[];
  function check(label,condition){if(!condition)throw new Error(label);results.push(label);}
  const savedBest=game.best;
  Progress.save=function(){}; // checks never touch the saved profile
  Progress.data=Progress.blank();
  try{
    for(const floor of [1,3,5,10]){
      game.floor=floor-1;game.P=null;game.nextFloor();
      const P=game.P;P.hp=P.maxHp=10000;P.oil=P.maxOil=10000;
      game.mouse.down=true;game.keys.KeyD=true;
      for(let i=0;i<180;i++){P.invulnT=1;game.update(1/60);if(i%30===0)game.R.render(game,1/60);}
      check('Floor '+floor+' movement/combat/render',Number.isFinite(P.x)&&Number.isFinite(P.y)&&game.enemies.every(e=>Number.isFinite(e.x)&&Number.isFinite(e.hp)));
      check('Floor '+floor+' bounded particles',game.particles.length<=450);
    }
    game.startRun();game.keys.Space=true;game.update(1/60);
    check('Surge activates and consumes oil',game.P.surgeT>0&&game.P.surgeCdT>0&&game.P.oil<100);
    const vent=game.world.vents[0];vent.active=true;vent.fuel=vent.maxFuel=80;vent.refillT=0;
    game.P.x=vent.x;game.P.y=vent.y;game.P.oil=10;game.keys={};game.update(.5);
    check('Active fuel vent refills lantern nearby',game.P.oil>20&&vent.fuel<80&&game.fuelStatus.includes('REFILLING'));
    vent.active=false;vent.fuel=0;vent.refillT=0;game.update(.02);
    check('Empty fuel vent reactivates automatically',vent.active&&vent.fuel>0);
    game.keys={ShiftLeft:true,KeyD:true};game.update(1/60);
    check('Dash activates',game.P.dashT>0&&game.P.dashCdT>0);
    game.pause();const before=game.t;game.update(.05);
    check('Pause freezes simulation',game.t===before&&!document.getElementById('screen-pause').classList.contains('hidden'));
    game.resume();check('Resume clears held inputs',game.state==='playing'&&!game.mouse.down&&Object.keys(game.keys).length===0);
    game.showUpgrade();check('Three usable boon cards',document.querySelectorAll('#upgradeCards .card').length===3);
    const previousFloor=game.floor;document.querySelector('#upgradeCards .card').click();
    check('Boon selection advances the floor',game.floor===previousFloor+1&&Object.values(game.upgLevels).reduce((a,b)=>a+b,0)===1);
    game.P.oil=0;const hp=game.P.hp;game.update(.02);game.R.render(game,.02);
    check('Empty lantern still damages player',game.P.hp<hp);
    game.startRun();game.world.obstacles=[];game.enemies=[];
    check('Power-ups lie on every floor',game.world.pickups.some(p=>p.type==='power'&&POWERUPS[p.kind]));
    const PP=game.P;PP.aim=0;PP.invulnT=0;PP.buffs.aegis=5;const hpA=PP.hp;game.damagePlayer(50,null,PP);
    check('Aegis blocks hits',PP.hp===hpA);
    const foe=game.spawnEnemy('hollow',PP.x+60,PP.y);let h0=foe.hp;game.burnCone(PP,.1);const plain=h0-foe.hp;
    PP.buffs.blaze=5;h0=foe.hp;game.burnCone(PP,.1);
    check('Inferno doubles flame damage',plain>0&&Math.abs((h0-foe.hp)-2*plain)<1e-6);
    game.world.pickups=[{id:900,type:'ember',x:PP.x+200,y:PP.y,val:1,t:0}];PP.buffs={magnet:5};game.keys={};game.update(.1);
    check('Lodestone pulls pickups',!game.world.pickups.length||game.world.pickups[0].x<PP.x+200);
    const near=game.spawnEnemy('shade',PP.x-90,PP.y);game.grantPower(PP,'nova');
    check('Sunburst blasts nearby shadows',near.dead);
    check('Floors are dressed with props and lights',game.world.props.length>25&&game.world.props.filter(p=>LIT_PROPS[p.kind]).length>=7);
    game.floor=3;game.P=null;game.nextFloor();
    const W4=game.world,quads=new Set(game.enemies.map(e=>(e.x>W4.w/2?1:0)+(e.y>W4.h/2?2:0)));
    check('Shadows spawn spread over the floor',quads.size>=3);
    const savedCls=game.cls,stand=k=>{k.invulnT=0;game.keys={};game.mouse.down=false;};
    game.cls='keeper';game.startRun();game.world.obstacles=[];game.enemies=[];let K=game.P;stand(K);
    let tgt=game.spawnEnemy('hollow',K.x+150,K.y);let hp0=tgt.hp;game.keys={KeyE:true};game.mouse.x=tgt.x-game.cameraOrigin().x;game.mouse.y=tgt.y-game.cameraOrigin().y;game.update(1/60);game.keys={};
    for(let i=0;i<30;i++)game.update(1/60);
    check('Wickkeeper E plants a burning flare',K.eCdT>0&&game.zones.length===1&&tgt.hp<hp0);
    game.cls='pyro';game.startRun();game.world.obstacles=[];game.enemies=[];K=game.P;stand(K);
    tgt=game.spawnEnemy('hollow',K.x+200,K.y);hp0=tgt.hp;game.useAbility(K,{tx:tgt.x,ty:tgt.y});
    for(let i=0;i<40;i++)game.update(1/60);
    check('Pyromancer is frail and its fireball explodes',K.maxHp===80&&tgt.hp<hp0-40);
    game.cls='guardian';game.startRun();K=game.P;stand(K);game.useAbility(K,{tx:K.x,ty:K.y});const hpG=K.hp;K.invulnT=0;game.damagePlayer(30,null,K);
    check('Guardian bulwark blocks hits',K.maxHp===140&&K.hp===hpG);
    game.cls='nightblade';game.startRun();game.world.obstacles=[];K=game.P;stand(K);const x0=K.x,dir=K.x<game.world.w/2?1:-1;game.useAbility(K,{tx:K.x+200*dir,ty:K.y});
    check('Nightblade shadowstep blinks',Math.abs(K.x-x0)>150);
    game.cls='lightbinder';game.startRun();K=game.P;stand(K);K.hp=40;game.useAbility(K,{tx:K.x,ty:K.y});
    check('Lightbinder mends vigor',K.hp===75);
    // ---- Keeper progression ----
    Progress.data=Progress.blank();
    check('A fresh keeper starts at level 1 without points',Progress.level('keeper')===1&&Progress.points('keeper')===0);
    Progress.addXp('keeper',xpStep(1)+xpStep(2));
    check('XP raises the level and grants points',Progress.level('keeper')===3&&Progress.points('keeper')===2);
    check('Tree nodes need their predecessor',!Progress.canRank('keeper','a2')&&Progress.rankUp('keeper','a1')&&Progress.canRank('keeper','a2'));
    Progress.rankUp('keeper','a2');
    check('Points run out',Progress.points('keeper')===0&&!Progress.rankUp('keeper','b1'));
    check('Skins unlock with level',Progress.skinUnlocked('keeper','ash')&&!Progress.skinUnlocked('keeper','verd')&&!Progress.setSkin('keeper','verd'));
    let toMax=0;for(let l=1;l<LEVEL_MAX;l++)toMax+=xpStep(l);Progress.addXp('keeper',toMax);
    check('Level 20 caps the climb and fills the tree exactly',Progress.level('keeper')===LEVEL_MAX&&TREE_SLOTS.reduce((a,k)=>a+SLOT_MAX[k],0)===LEVEL_MAX-1&&Progress.skinUnlocked('keeper','sun'));
    check('Foreign trees are clamped',JSON.stringify(sanitizeTree('pyro',{a1:5,a2:3,a3:2,b2:1,c3:9}))==='{"a1":1,"a2":3,"a3":2}');
    Progress.data=Progress.blank();game.cls='pyro';Progress.addXp('pyro',xpStep(1));game.showTree();
    check('Skill tree shows three branches of three',document.querySelectorAll('#treeCols .tree-col').length===3&&document.querySelectorAll('#treeCols .tree-node').length===9);
    document.querySelector('.tree-node[data-slot="a1"]').click();
    check('Clicking a node spends a point',Progress.of('pyro').tree.a1===1&&Progress.points('pyro')===0);
    const full={};TREE_SLOTS.forEach(k=>full[k]=SLOT_MAX[k]);
    const talent={keeper:()=>game.zones[0].pull>0&&game.zones[0].oil>0,pyro:()=>game.shots.some(s=>s.kind==='fire'&&s.cluster&&s.storm===2),
      guardian:()=>K.spikeT>0&&K.buffs.aegis>3,nightblade:()=>K.buffs.night>0,lightbinder:()=>game.zones.some(z=>z.kind==='mend')};
    const ultOk={keeper:()=>K.buffs.dawn>0,pyro:()=>game.zones.some(z=>z.kind==='meteor'),guardian:()=>K.buffs.aegis>0,
      nightblade:()=>dist(K.x,K.y,dummy.x,dummy.y)<dummy.r+40,lightbinder:()=>game.zones.some(z=>z.kind==='sanct')};
    let dummy;
    for(const cls of CLASS_IDS){
      Progress.data.classes[cls].tree=Object.assign({},full);
      game.cls=cls;game.startRun();game.world.obstacles=[];game.enemies=[];game.shots=[];game.zones=[];game.world.spawnsLeft=0;
      K=game.P;stand(K);K.aim=0;
      check(cls+' tree applies (RMB, Q, faster E)',K.alt&&K.ultOn&&K.eCd<CLASSES[cls].ability.cd);
      game.useAbility(K,{tx:K.x+100,ty:K.y});
      check(cls+' ability talents apply',talent[cls]());
      game.zones=[];game.shots=[];
      dummy=game.spawnEnemy('hollow',K.x+90,K.y);dummy.hp=dummy.maxHp=1e5;
      game.mouse.alt=true;game.update(1/60);game.mouse.alt=false;
      for(let i=0;i<30;i++){K.invulnT=1;game.update(1/60);}
      check(cls+' RMB attack hits',dummy.hp<1e5&&K.altCdT>0);
      game.zones=[];dummy.hp=1e5;dummy.x=K.x+90;dummy.y=K.y;K.hp=40;K.ult=100;
      const o=game.cameraOrigin();game.mouse.x=dummy.x-o.x;game.mouse.y=dummy.y-o.y;
      game.keys={KeyQ:true};game.update(1/60);game.keys={};
      const meteor=game.zones.find(z=>z.kind==='meteor');if(meteor)meteor.r=1;
      check(cls+' ultimate fires',K.ult<1&&ultOk[cls]());
      for(let i=0;i<90;i++){K.invulnT=1;game.update(1/60);}
      check(cls+' ultimate hurts shadows',dummy.hp<1e5);
      K.skin='sun';game.R.render(game,1/60);K.skin='blood';K.flameOn=true;game.R.render(game,1/60);
    }
    check('Every skill zone, skin and HUD pip renders',!document.getElementById('ultWrap').classList.contains('hidden'));
    Progress.data=Progress.blank();game.cls='keeper';game.startRun();game.best=1e9;game.score=450;game.gameOver();
    check('A run banks its score as XP for the class',Progress.of('keeper').xp===450&&document.getElementById('overStats').textContent.includes('+450'));
    game.startRun();game.nextFloor();
    check('Each floor cleared adds XP',Progress.of('keeper').xp===450+XP_PER_FLOOR);
    game.best=savedBest;
    // ---- The Warden (floor 10) ----
    const memSave=WardenMemory.save;WardenMemory.save=function(){};
    const arenaRun=cls=>{game.cls=cls||'keeper';game.startRun();game.floor=9;game.P=null;game.nextFloor();return game.warden;};
    const toPhase=(V,ph)=>{const B=V.brain;game.P.y=1300;B.encounterStart(game.P);B.seq=[];B.seqDone=null;game.clearTalk();V.boxOn=true;B.beginPhase(ph);return B;};
    const until=(cond,max,each)=>{for(let i=0;i<(max||6000)&&game.state==='playing';i++){if(each)each();game.update(1/60);if(cond())return true;}return false;};
    // Wickhollow: the village hub, the smithy and the new gear.
    {const saveP=Progress.save;Progress.save=function(){};const pd=JSON.stringify(Progress.data);
     game.cls='keeper';game.enterHub();const HW=game.world;
     const doorsFree=HUB.houses.every(H=>!inAnyObstacle(HW.obstacles,H.door.x,H.door.y,14))&&!inAnyObstacle(HW.obstacles,HW.spawn.x,HW.spawn.y,20);
     check('Wickhollow is a peaceful hub with reachable doors',HW.hub&&game.state==='playing'&&doorsFree&&HW.trees.length>100&&HUB.houses.length===4);
     const oil0=game.P.oil;for(let i=0;i<120;i++)game.update(1/60);
     game.P.invulnT=0;game.damagePlayer(9999,null,game.P);
     check('No oil drain or death in the village',game.P.oil>=oil0-0.01&&game.state==='playing'&&game.P.hp===game.P.maxHp);
     Progress.data.purse=1000;Progress.data.gear=sanitizeGear(null);
     const okBuy=Progress.buyGear('bow',GEAR.bow.tiers[0].price)&&Progress.buyGear('bombs',GEAR.bombs.tiers[0].price)&&Progress.buyGear('heart',GEAR.heart.tiers[0].price);
     const purseLeft=Progress.purse();game.backToHub();
     check('The smithy sells gear for embers and it reaches the keeper',okBuy&&purseLeft===1000-60-90-80&&game.P.gear.bow===1&&game.P.maxHp===CLASSES.keeper.hp+15&&!Progress.buyGear('bow',99999));
     game.P.x=1700;game.P.y=960;const sh=game.spawnEnemy('shade',1800,960);game.P.bowCdT=0;game.P.bombCdT=0;
     Gear.act(game,game.P,{bow:true,bomb:true,tx:1800,ty:960},0.016);const nb=game.shots.filter(x=>x.kind==='bolt').length,nm=game.shots.filter(x=>x.kind==='bomb').length;
     for(let i=0;i<90;i++){game.P.aim=0;game.update(1/60);}
     check('Bow arrows and ember bombs hurt shadows',nb===1&&nm===1&&(sh.dead||sh.hp<sh.maxHp));
     game.P.x=HUB.cave.x;game.P.y=HUB.cave.y+10;game.update(1/60);
     check('The cave in the north starts the descent with the gear',game.floor===1&&!game.world.hub&&game.P.gear.bombs===1);
     Progress.data=JSON.parse(pd);Progress.save=saveP;}
    const ga=JSON.stringify(generateFloor(10,new Rng(77))),gb=JSON.stringify(generateFloor(10,new Rng(77))),A10=generateFloor(10,new Rng(77));
    check('Warden arena is deterministic and complete',ga===gb&&A10.arena&&A10.obstacles.filter(o=>o.dyn).length===8&&A10.vents.length===5&&A10.arena.candles.length===16&&A10.initial===0&&A10.spawn.y>A10.arena.corridor.y&&!generateFloor(20,new Rng(77)).arena);
    const pt={x:900,y:100};arenaClamp(A10,pt,13);const pc={x:900,y:2000};arenaClamp(A10,pc,13);const okCorr=pc.y===2000;A10.arena.sealed=true;arenaClamp(A10,pc,13);
    check('Arena keeps keepers on the floor and seals the corridor',dist(pt.x,pt.y,900,860)<=607.5&&okCorr&&dist(pc.x,pc.y,900,860)<=607.5);
    const kinds=[[WK.RING,[4,1.25,28,4,40,150,7,0,0,1,30,0.6]],[WK.WALLS,[220,26,3,0.8,90,1,2.4,0,1,4.0,45,1]],[WK.KEYS,[10,60]],[WK.CHARGE,[300,700,1.0]],
      [WK.BEAMS,[0.9,0.4,48,2,700,500,40,1100,500,140]],[WK.CAGE,[320,176,4,2,1,8,0.75,150,4.6,110,60]],[WK.BANDS,[50,170,14,50,2,0.8,1,30,1.3,2,67]],
      [WK.EYES,[36,3,10,130,250,70,0.08,1.2]],[WK.FAN,[0.7,3,8,230,7]],[WK.SPIRAL,[3,45,2,-45,0.2,165,40,3,0.4,3,1]],[WK.HAND,[0.9,110,12,150]],[WK.GONER,[320,110,120/110,24,2,4.6,32,4,190,4,110]]];
    let detOk=true;const tmpP={x:0,y:0};
    kinds.forEach(([k,q])=>{
      const d={id:1,k:k,s:12345,t0:0,x:900,y:860,a:30,R:320,pm:255,v:100,q:q},p1=buildPattern(d),p2=buildPattern(JSON.parse(JSON.stringify(d)));
      if(p1.b.length>200||p1.dur>16||JSON.stringify(p1.h)!==JSON.stringify(p2.h))detOk=false;
      [0.3,1,2,4,8].forEach(u=>p1.b.forEach((b,i)=>{if(u<b.ts||u>=b.te)return;bulletPos(b,u,tmpP);const x1=tmpP.x,y1=tmpP.y;bulletPos(p2.b[i],u,tmpP);if(!isFinite(x1)||x1!==tmpP.x||y1!==tmpP.y)detOk=false;}));
    });
    check('Every Warden pattern is deterministic and bounded',detOk);
    const bell=buildPattern({id:1,k:WK.RING,s:1,t0:0,x:900,y:860,a:0,R:320,pm:0,v:100,q:[1,1,28,4,0,150,7,0,0,0,30,0]});
    const angs=bell.b.map(b=>Math.atan2(b.vy,b.vx)).sort((x,y)=>x-y);let gap=0;for(let i=0;i<angs.length;i++){const nx=i+1<angs.length?angs[i+1]:angs[0]+TAU;gap=Math.max(gap,nx-angs[i]);}
    check('Bell rings leave a gap a keeper fits through',gap*150-2*(7+9)>=70&&kinds.filter(k=>k[0]===WK.BEAMS).every(k=>k[1][0]>=0.6));
    let V=arenaRun('keeper'),B=toPhase(V,1);const KW=game.P;
    const blue={id:900,k:WK.WALLS,s:1,t0:V.bt,x:900,y:860,a:0,R:320,pm:0,v:100,q:[220,26,1,0,0,1]};V.addPattern(blue);
    const wall=V.pats.get(900).p.h[0];KW.x=900;KW.y=860;KW.invulnT=0;KW.dashT=0;KW.owT=0;KW._wHit=null;KW._wViol=null;
    const tCross=V.bt+(0-wall.d0)/wall.vd;let hitsMove=0,hitsStill=0;
    V.bt=tCross-0.05;for(let i=0;i<8;i++){V.checkHits(KW,true,1/60,()=>hitsMove++);V.bt+=1/60;}
    KW._wHit=null;KW._wViol=null;KW.owT=0;V.bt=tCross-0.05;for(let i=0;i<8;i++){V.checkHits(KW,false,1/60,()=>hitsStill++);V.bt+=1/60;}
    const orange={id:901,k:WK.WALLS,s:1,t0:V.bt,x:900,y:860,a:0,R:320,pm:0,v:100,q:[220,26,1,0,0,2]};V.addPattern(orange);V.pats.delete(900);
    let oMove=0,oStill=0;const t2=V.bt+(320+20)/220;
    KW._wHit=null;KW._wViol=null;KW.owT=0;V.bt=t2-0.05;for(let i=0;i<8;i++){V.checkHits(KW,true,1/60,()=>oMove++);V.bt+=1/60;}
    KW._wHit=null;KW._wViol=null;KW.owT=0;V.bt=t2-0.05;for(let i=0;i<8;i++){V.checkHits(KW,false,1/60,()=>oStill++);V.bt+=1/60;}
    check('Blue hurts only the moving, orange only the still',hitsMove===1&&hitsStill===0&&oMove===0&&oStill===1);
    V.pats.clear();
    let clashFree=true;
    for(let sd=1;sd<=10;sd++){
      const r=new Rng(sd*77),base=r.range(0,360),cols=[1,1,2,1,2,2,1,2,1,2,2,1],walls=[];
      for(let j=0;j<12;j++)walls.push([1+j*0.8,(base+j*45)%360,cols[j]]);
      resolveColorClashes(walls,256,380);
      const L=276,span=2*L/380;
      for(let t=0;t<12&&clashFree;t+=1/20){for(let gx=-240;gx<=240&&clashFree;gx+=40)for(let gy=-240;gy<=240;gy+=40){if(gx*gx+gy*gy>230*230)continue;let bl=false,or=false;
        walls.forEach(w=>{const u=t-w[0];if(u<0||u>span)return;const a=w[1]*Math.PI/180;if(Math.abs(gx*Math.cos(a)+gy*Math.sin(a)+L-380*u)<26){if(w[2]===1)bl=true;else or=true;}});
        if(bl&&or){clashFree=false;break;}}}
    }
    check('Hush and Ember never asks to be still and moving at once',clashFree);
    V=arenaRun('keeper');B=V.brain;game.P.y=1300;B.encounterStart(game.P);until(()=>V.s===WS.TALK,600);
    const hpT=B.e.hp;game.hurtEnemy(B.e,5000,'flame',game.P);
    check('The Warden cannot be hurt while he talks',B.e.hp===hpT&&V.calm()&&V.locksActions());
    B.seq=[];B.seqDone=null;game.clearTalk();B.beginPhase(1);
    until(()=>V.s===WS.OPENING,3000,()=>{game.P.invulnT=1;});
    game.hurtEnemy(B.e,1e6,'flame',game.P);
    check('A phase holds until all its attacks were shown',Math.round(B.e.hp)===Math.round(B.e.maxHp*0.7)&&V.ph===1);
    until(()=>V.s===WS.SHIFT,9000,()=>{game.P.invulnT=1;game.P.hp=game.P.maxHp;if(V.s===WS.OPENING)game.hurtEnemy(B.e,1e6,'flame',game.P);});
    game.P.ult=100;game.P.ultOn=true;game.keys={KeyQ:true};game.update(1/60);game.keys={};
    check('Ultimates wait during scenes',V.s===WS.SHIFT&&game.P.ult>=99);
    until(()=>V.s===WS.ATTACK&&V.ph===2,4000,()=>{game.P.invulnT=1;});
    const pillars=game.world.obstacles.filter(o=>o.pillar!==undefined).length;
    const br=game.world.arena.braziers[0];br.lit=false;br.prog=0;const PK=game.P;PK.oil=PK.maxOil;
    for(let i=0;i<70;i++){PK.x=br.x-60;PK.y=br.y;PK.invulnT=1;game.mouse.down=true;game.mouse.x=br.x-game.cameraOrigin().x;game.mouse.y=br.y-game.cameraOrigin().y;game.update(1/60);}
    game.mouse.down=false;
    check('Pillars burst between phases; a second of flame relights a brazier',V.A.pm===85&&pillars===4&&br.lit);
    // Network: the Warden block stays small and guests rebuild the same bullets.
    V=arenaRun('keeper');B=toPhase(V,3);B.prog=null;B.startAttack('VIGIL');
    until(()=>V.bt-V.sb>4.5,600,()=>{game.P.invulnT=1;});
    const snap=Coop.prototype.snapshot.call({game:game,pickupSig:'x'}),wbLen=JSON.stringify(snap.wb).length;
    const ghost=new WardenView(game);ghost.apply(JSON.parse(JSON.stringify(snap.wb)));ghost.bt=V.bt;
    let same=true,count=0;V.pats.forEach((P,id)=>{const G2=ghost.pats.get(id);if(!G2){same=false;return;}const u=V.bt-P.d.t0;P.p.b.forEach((b,i)=>{if(u<b.ts||u>=b.te)return;count++;bulletPos(b,u,tmpP);const x=tmpP.x,y=tmpP.y;bulletPos(G2.p.b[i],u,tmpP);if(Math.abs(x-tmpP.x)>0.5||Math.abs(y-tmpP.y)>0.5)same=false;});});
    check('Warden sync stays small and guests rebuild the same bullets',wbLen<1500&&same&&count>20);
    results.push('Warden snapshot block: '+wbLen+' bytes for '+count+' live bullets');
    // Guest hit reports are checked against the host's own patterns.
    const mate=game.makePlayer('keeper');mate.id='g1';mate.x=900;mate.y=860;mate.invulnT=0;mate.owT=0;mate.alive=true;
    const pid=[...V.pats.keys()][0];const hpM=mate.hp;B.onGuestHit(mate,pid,-1-999);const bad=mate.hp;
    const live=V.pats.get(pid).p.b.findIndex(b=>V.bt-V.pats.get(pid).d.t0>=b.ts&&V.bt-V.pats.get(pid).d.t0<b.te);B.onGuestHit(mate,pid,live);
    check('Guest hit reports are validated by the host',bad===hpM&&mate.hp<hpM);
    // RESOLVE: one checkpoint per fight in solo.
    V=arenaRun('keeper');B=toPhase(V,2);B.e.hp=Math.round(B.e.maxHp*0.7);const hpStart=B.e.hp;B.e.hp-=200;
    game.P.invulnT=0;game.P.dashT=0;B.v=100;V.s=WS.ATTACK;game.damagePlayer(9999,null,game.P);
    const inResolve=V.s===WS.RESOLVE&&game.state==='playing';until(()=>V.s!==WS.RESOLVE,400);
    const restarted=V.ph===2&&Math.round(B.e.hp)===Math.round(hpStart)&&game.P.hp===game.P.maxHp;
    V.s=WS.ATTACK;game.P.invulnT=0;game.P.dashT=0;game.damagePlayer(99999,null,game.P);
    check('RESOLVE restarts the phase once; the second fall is the end',inResolve&&restarted&&game.state==='over');
    // Fake death: the gate stays shut and the victory screen is a lie.
    V=arenaRun('keeper');B=toPhase(V,3);B.cycleShown=true;B.cycleDone=true;B.tollDone=true;B.e.hp=1;B.fakeStart();
    until(()=>V.bt-V.sb>2.6,300);
    const fv=document.getElementById('fakeVictory');
    check('The Warden falls... but the stair stays shut',V.s===WS.FAKE&&!game.world.gateOpen&&game.enemies.includes(B.e)&&game.state==='playing'&&!fv.classList.contains('hidden'));
    game.pause();const pauseHeld=game.state==='playing'&&game._pauseQ===true;
    until(()=>V.s!==WS.FAKE,2400);game.update(1/60);
    const pausedAfter=game.state==='pause';game.resume();
    check('A pause during the false ending waits until it is over',pauseHeld&&pausedAfter&&!game._pauseQ);
    until(()=>V.s===WS.KINDLE,2400);
    check('The fake victory screen shatters into the last phase',fv.classList.contains('hidden')&&V.s===WS.KINDLE&&V.so.length>=7);
    // Kindling: hold your light to a soul.
    const pos={x:0,y:0};let lit0=V.so.filter(s=>s[1]===1).length;
    for(let i=0;i<140;i++){V.soulPos(0,pos);game.P.x=pos.x;game.P.y=pos.y;game.P.oil=game.P.maxOil;game.P.invulnT=1;game.update(1/60);}
    check('Holding your light to a soul kindles it',V.so[0][1]===1&&V.so.filter(s=>s[1]===1).length>lit0);
    game.P.invulnT=0;game.P.dashT=0;game.P.owT=0;game.damagePlayer(game.P.hp+50,null,game.P);
    const refused=game.P.hp===1&&game.P.invulnT>=1.9&&V.s===WS.KINDLE;
    check('* But it refused.',refused);
    // Mercy and the two endings.
    const mercy=(strike)=>{
      const V2=arenaRun('keeper'),B2=toPhase(V2,3);B2.kindleStart();V2.so.forEach(s=>{s[0]=100;s[1]=1;});game.update(1/60);
      until(()=>V2.s===WS.MERCY&&(V2.fl&64),3000,()=>{game.P.invulnT=1;});
      const xp0=game.runXp();
      until(()=>V2.s!==WS.MERCY,600,()=>{const P=game.P;P.x=WARDEN.C.x+40;P.y=WARDEN.C.y;P.oil=P.maxOil;game.mouse.down=!!strike;P.aim=Math.PI;game.mouse.x=WARDEN.C.x-game.cameraOrigin().x;game.mouse.y=WARDEN.C.y-game.cameraOrigin().y;});
      game.mouse.down=false;
      const ending=V2.en;until(()=>game.world.gateOpen,2400);
      const xpGain=game.runXp()-xp0;game.P.x=game.world.gate.x;game.P.y=game.world.gate.y;game.update(1/60);
      return {ending,xpGain,title:document.getElementById('vicTitle').textContent,state:game.state};
    };
    const sp=mercy(false);
    check('Standing with him in silence spares him',sp.ending==='spared'&&sp.state==='victory'&&sp.title==='THE WARDEN RESTS'&&sp.xpGain>=1050);
    const sl=mercy(true);
    check('One breath of flame ends him',sl.ending==='slain'&&sl.state==='victory'&&sl.title==='THE WARDEN FALLS');
    // The whole fight, start to finish, without a single NaN.
    V=arenaRun('nightblade');B=V.brain;const seenStates=new Set();let nan=false;
    until(()=>game.state!=='playing',60*900,()=>{
      const P=game.P;P.invulnT=1;P.hp=P.maxHp;P.oil=P.maxOil;seenStates.add(V.s);
      if(V.s===WS.DORMANT)P.y-=8;
      if(V.s===WS.OPENING)game.hurtEnemy(B.e,500,'flame',P);
      if(V.s===WS.KINDLE){const i=V.so.findIndex(s=>s[1]!==1);if(i>=0){V.soulPos(i,pos);P.x=pos.x;P.y=pos.y;}}
      if(V.s===WS.MERCY){P.x=WARDEN.C.x+40;P.y=WARDEN.C.y;}
      if(V.s===WS.GONE){P.x=game.world.gate.x;P.y=game.world.gate.y;}
      if(!isFinite(B.e.x)||!isFinite(B.e.hp)||!isFinite(P.x))nan=true;
      if(game.t%1<1/60)game.R.render(game,1/60);
    });
    check('The whole Warden fight runs from the corridor to the stair',!nan&&game.state==='victory'&&[WS.ENCOUNTER,WS.TALK,WS.ATTACK,WS.OPENING,WS.SHIFT,WS.FAKE,WS.RISE,WS.KINDLE,WS.MERCY,WS.SPARED,WS.GONE].every(s=>seenStates.has(s))&&game.particles.length<=450);
    WardenMemory.save=memSave;game.leaveWarden();
    game.cls=savedCls;
    game.startRun();game.world.obstacles=[];game.enemies=[];
    for(const type of Object.keys(ENEMY_DEFS))game.spawnEnemy(type,game.P.x+120,game.P.y+50);
    for(const pattern of ['drift','telegraph','charge','summonT','snuffT','novaT']){
      game.enemies.forEach(e=>{e.pat=pattern;e.flash=.2;});game.R.render(game,.016);
    }
    check('All six enemy silhouettes and boss telegraphs render',true);
    const hollow=game.enemies.find(e=>e.type==='hollow');game.killEnemy(hollow);
    check('Hollow death emits shards and visual feedback',game.shots.length===8&&game.effects.some(e=>e.kind==='text'));
    game.R.reducedMotion=true;game.R.render(game,.016);game.R.reducedMotion=false;game.R.render(game,.016);
    check('Both motion modes render',true);
    game.effects=[];game.particles=[];
    for(let i=0;i<80;i++)game.burst(game.P.x+rand(-200,200),game.P.y+rand(-180,180),'#ffd98a',1,20,4,.8);
    const start=performance.now();for(let i=0;i<60;i++)game.R.render(game,1/60);
    results.push('450-particle render: '+((performance.now()-start)/60).toFixed(1)+' ms/frame (CPU submission)');
  }catch(e){results.push('FAILED: '+e.message);console.error(e);}
  game.best=savedBest;
  Progress.load();game.resetRunXp();
  const panel=document.createElement('div');panel.style.cssText='position:fixed;bottom:12px;right:12px;z-index:99;background:#071013ed;color:#e1d5b6;padding:12px;font:11px monospace;border:1px solid #ad956055;max-width:380px';
  const status=document.createElement('div');status.id='check-results';status.textContent=results.some(r=>r.startsWith('FAILED'))?results[results.length-1]:results.filter(r=>!r.includes('CPU submission')).length+' checks passed';panel.appendChild(status);
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Test details';details.appendChild(summary);
  results.forEach(r=>{const line=document.createElement('div');line.textContent=r;details.appendChild(line);});panel.appendChild(details);
  function scene(kind){
    game.startRun();game.R.reducedMotion=false;game.R.applyMotion();
    const W=game.world;W.w=1400;W.h=900;W.obstacles=[{x:250,y:220,w:125,h:165},{x:950,y:180,w:150,h:110},{x:860,y:630,w:120,h:140},{x:280,y:680,w:150,h:95}];W.spawn={x:700,y:450};W.gate={x:1270,y:450};W.gateOpen=true;W.vents=[{x:70,y:290},{x:700,y:70}];W.spawnsLeft=0;
    W.pickups=[{x:680,y:265,type:'oil',t:1},{x:815,y:560,type:'ember',t:2},{x:520,y:590,type:'wick',t:3},{x:420,y:430,type:'ember',t:4}];
    game.P.x=650;game.P.y=465;game.P.aim=-.3;game.P.walk=3;game.cam={x:700,y:450};game.t=15.1;game.score=185;game.embers=14;game.enemies=[];game.effects=[];game.particles=[];
    [['shade',785,395],['gleam',730,650],['hollow',880,500],['douser',500,260],['shade',480,560]].forEach(e=>game.spawnEnemy(...e));
    game.shots=[makeOrb(560,325,90,80,10),makeShard(845,490,-180,-30,10)];
    game.burst(777,425,'#eec480',1.2,35,4,.65);game.floatText(788,420,'+30','#efd29a');
    game.state='visual-check';game.P.flameOn=kind==='Combat';game.P.surgeT=kind==='Surge'?.35:0;
    if(kind==='Boss'){game.world.num=10;game.world.gateOpen=false;const boss=game.spawnEnemy('warden',890,430);boss.pat='telegraph';boss.tx=game.P.x;boss.ty=game.P.y;}
    if(kind==='Fuel'){
      game.enemies=[];game.shots=[];game.world.gateOpen=false;
      game.world.vents=[{x:700,y:410,active:true,fuel:72,maxFuel:90,refillT:0,spurtT:.1,seed:2}];
      game.P.x=700;game.P.y=460;game.P.oil=36;game.P.flameOn=false;game.cam={x:700,y:430};
      game.fuelStatus='◈ REFILLING · 72 FUEL LEFT';
      for(let i=0;i<28;i++)game.particles.push({x:700+rand(-12,12),y:400-rand(0,55),vx:rand(-10,10),vy:rand(-80,-35),life:.7,maxLife:.7,size:3,color:'#83e3c2'});
    }
    game.trails=Array.from({length:5},(_,i)=>({x:game.P.x-20-i*15,y:game.P.y+5+i*3,aim:game.P.aim,life:.24-i*.035,maxLife:.28}));
    game.R.worldCache=null;game.R.hudTime=undefined;game.showScreen(null);
    if(kind==='Boons')game.showUpgrade();if(kind==='Title')game.toTitle();
    game.R.render(game,.016);
  }
  ['Combat','Fuel','Surge','Boss','Boons','Title'].forEach(label=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='padding:5px;margin:8px 5px 0 0;cursor:pointer;background:#233633;color:#ebd4a8;border:1px solid #786748';b.onclick=()=>scene(label);panel.appendChild(b);});
  document.body.appendChild(panel);scene('Combat');
})();
