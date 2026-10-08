'use strict';
// Browser integration fixtures, isolated from the normal game entry point.
(function(){
  const results=[];
  function check(label,condition){if(!condition)throw new Error(label);results.push(label);}
  const savedBest=game.best;
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
