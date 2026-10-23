/* Continuous object study. One host reading fact; no navigation or authored-state writes.
   Coordinates are normalized. Coffee forms are parametric; custom SVG symbols are optional. */
export default {
 mount(c) {
  const root=c.root,doc=root.ownerDocument,win=doc.defaultView,port=c.teacherController;
  const canvas=doc.createElement('canvas'),g=canvas.getContext('2d');
  let instance=c.instance,disposed=false,suspended=false,raf=0,active=-1,phaseKey='',started=0;
  let current=null,from=null,target=null,events=0,ticks=0,width=1,height=1;
  let symbols=[],symbolSignature='';
  const media=win.matchMedia('(prefers-reduced-motion: reduce)');
  const TAU=Math.PI*2,clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const mix=(a,b,t)=>a+(b-a)*t,noise=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};
  const colors={paper:[238,236,226],sage:[226,234,216],sand:[233,222,202],green:[227,233,220],dark:[23,29,25],water:[225,237,230]};
  const defaults=[
   {key:'cup',base:colors.paper,tint:[216,209,186],x:.47,y:.85,mx:.94,my:.84,size:122,msize:88,opacity:.31,cup:1,shell:0,peel:0,seed:0,roast:0,dust:0,liquid:.15,rotation:-.14},
   {key:'fruit',base:colors.sage,tint:[187,204,170],x:.46,y:.65,mx:.94,my:.78,size:132,msize:88,opacity:.43,cup:0,shell:1,peel:0,seed:1,roast:0,dust:0,liquid:0,rotation:-.28},
   {key:'layers',base:colors.sand,tint:[210,188,151],x:.96,y:.74,mx:.96,my:.8,size:146,msize:91,opacity:.36,cup:0,shell:.35,peel:1,seed:1,roast:0,dust:0,liquid:0,rotation:.22},
   {key:'green',base:colors.green,tint:[197,210,180],x:.62,y:.33,mx:.95,my:.82,size:108,msize:79,opacity:.27,cup:0,shell:0,peel:0,seed:1,roast:0,dust:0,liquid:0,rotation:-.4},
   {key:'roast',base:colors.dark,tint:[73,62,43],x:.96,y:.77,mx:.98,my:.78,size:162,msize:96,opacity:.30,cup:0,shell:0,peel:0,seed:1,roast:1,dust:0,liquid:0,rotation:.27},
   {key:'solution',base:colors.water,tint:[169,201,184],x:.95,y:.76,mx:.97,my:.79,size:190,msize:112,opacity:.46,cup:0,shell:0,peel:0,seed:0,roast:1,dust:1,liquid:1,rotation:0},
   {key:'return',base:colors.paper,tint:[211,197,168],x:.49,y:.83,mx:.95,my:.82,size:143,msize:96,opacity:.39,cup:1,shell:0,peel:0,seed:0,roast:0,dust:0,liquid:1,rotation:.13}
  ];
  const numeric=['x','y','size','opacity','cup','shell','peel','seed','roast','dust','liquid','rotation','symbol'];
  const css=rgb=>'rgb('+rgb.map(x=>Math.round(x)).join(',')+')';
  const ellipse=(x,y,rx,ry,rotation=0)=>{g.beginPath();g.ellipse(x,y,Math.max(.01,rx),Math.max(.01,ry),rotation,0,TAU)};
  const path=(d,fill,stroke,line=1)=>{const p=new Path2D(d);if(fill){g.fillStyle=fill;g.fill(p)}if(stroke){g.strokeStyle=stroke;g.lineWidth=line;g.stroke(p)}};
  root.dataset.coffeeUnderlay='journey-v1';root.dataset.mountId=String(Date.now())+'-'+Math.random().toString(36).slice(2,7);
  Object.assign(root.style,{width:'100%',height:'100%',pointerEvents:'none',overflow:'hidden'});
  canvas.style.cssText='width:100%;height:100%;display:block;pointer-events:none';
  canvas.setAttribute('aria-hidden','true');root.append(canvas);

  // A small deterministic paper tile: no image download, timer, or animated noise.
  const tile=doc.createElement('canvas');tile.width=96;tile.height=96;
  const tg=tile.getContext('2d'),pixels=tg.createImageData(96,96);
  for(let i=0;i<96*96;i++){const gray=noise(i)*255;pixels.data.set([gray,gray,gray,12],i*4)}tg.putImageData(pixels,0,0);
  const texture=g.createPattern(tile,'repeat');

  function dimensions(){
   const dpr=Math.min(2,win.devicePixelRatio||1);width=Math.max(1,root.clientWidth);height=Math.max(1,root.clientHeight);
   const w=Math.round(width*dpr),h=Math.round(height*dpr);
   if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
   g.setTransform(dpr,0,0,dpr,0,0);
  }
  function sourceStage(n,key) {
   const supplied=instance.data.stages?.[n]||{},base={...defaults[Math.min(n,defaults.length-1)],...supplied};
   if(key==='origin')Object.assign(base,{...defaults[1],base:colors.paper,x:.91,y:.73,opacity:.38});
   const mobile=width<700;
   return {...base,x:mobile?base.mx:base.x,y:mobile?base.my:base.y,size:mobile?base.msize:base.size,symbol:supplied.symbol??n};
  }
  function interpolate(a,b,t){
   const v={...b};for(const k of numeric)v[k]=mix(a[k]||0,b[k]||0,t);
   v.base=a.base.map((x,i)=>mix(x,b.base[i],t));v.tint=a.tint.map((x,i)=>mix(x,b.tint[i],t));return v;
  }
  function loadSymbols(){
   const defs=instance.data.symbols||[],signature=JSON.stringify(defs);if(signature===symbolSignature)return;symbolSignature=signature;
   symbols=defs.map(svg=>{const img=new win.Image();img.onload=()=>{if(!disposed&&!raf)render(performance.now(),false)};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);return img});
  }

  function bean(roast,split=0){
   const material=(a,b)=>css(a.map((x,i)=>mix(x,b[i],clamp(roast))));
   const top=material([199,204,157],[167,119,82]),mid=material([142,156,106],[107,67,45]),dark=material([88,101,71],[56,35,28]);
   const grad=g.createLinearGradient(-65,-70,70,75);grad.addColorStop(0,top);grad.addColorStop(.45,mid);grad.addColorStop(1,dark);
   g.save();g.rotate(-.18);
   path('M-7 -91 C45 -103 83 -55 72 5 C62 67 21 101 -20 88 C-65 76 -81 29 -67 -23 C-57 -65 -35 -88 -7 -91Z',grad,'rgba(63,61,42,.35)',1.2);
   g.save();g.clip(new Path2D('M-7 -91 C45 -103 83 -55 72 5 C62 67 21 101 -20 88 C-65 76 -81 29 -67 -23 C-57 -65 -35 -88 -7 -91Z'));
   const beanAlpha=g.globalAlpha;for(let i=0;i<125;i++){const x=noise(i+17)*150-75,y=noise(i+94)*190-95;g.globalAlpha=beanAlpha*(.09+noise(i)*.12);g.strokeStyle=i%3?'#f5edc7':dark;g.lineWidth=.4+noise(i+3);g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+4,y-5,x+1+noise(i+7)*9,y-10);g.stroke()}
   g.restore();
   path('M9 -80 C-6 -50 16 -28 1 -2 C-15 28 3 52 -13 79',null,material([238,240,196],[33,27,22]),7+clamp(roast));
   path('M8 -80 C-8 -51 13 -28 -2 -1 C-17 27 0 51 -14 78',null,material([98,112,76],[211,162,115]),2.2);
   path('M-32 -67 C-63 -33 -61 18 -42 48',null,'rgba(255,249,218,.32)',2.6);
   if(roast>.001){g.save();g.globalAlpha*=clamp(roast);for(let i=0;i<8;i++){const y=-60+i*18;path('M'+(2+i%2*4)+' '+y+' l'+(i%2?'-18 -5':'18 9'),null,'rgba(40,25,17,.48)',1.4)}g.restore()}
   g.restore();
  }
  function seedPair(split){
   g.save();g.translate(-12-split*17,4);g.rotate(-.18-split*.12);g.scale(.62,.75);bean(0);g.restore();
   g.save();g.translate(27+split*15,-6);g.rotate(.28+split*.2);g.scale(.58,.72);bean(0);g.restore();
  }
  function fruit(v){
   const a=clamp(v.shell),peel=v.peel;g.save();
   if(a>.005){
    const red=g.createRadialGradient(-30,-40,4,10,10,99);red.addColorStop(0,'#e78d6e');red.addColorStop(.28,'#bf4b3c');red.addColorStop(.72,'#883127');red.addColorStop(1,'#502b25');
    g.globalAlpha*=a;
    for(const side of [-1,1]){g.save();g.translate(side*peel*74,-peel*19);g.rotate(side*peel*.45);g.scale(side,1);
     path('M0 -91 C56 -104 91 -54 79 11 C72 64 40 93 0 91 C-10 58 -9 -49 0 -91Z',red,'rgba(99,43,29,.4)',1.2);
     path('M17 -73 C58 -68 68 -30 61 -12',null,'rgba(255,215,174,.58)',3);
     if(peel>.1)path('M0 -89 C16 -58 15 57 0 89 C-3 40 -4 -36 0 -89Z','#e8b892',null);
     g.restore()
    }
    g.save();g.translate(0,-95-peel*30);g.rotate(-.08);
    path('M-2 14 Q9 -12 20 -25',null,'#566442',5);
    path('M8 -3 Q-37 -38 -58 -10 Q-30 18 8 -3Z','#6a7e4c','#495f3b',1);
    path('M8 -3 Q-21 -13 -51 -10',null,'#b0ba7f',1);
    g.restore();
   }g.restore();
  }
  function cup(v){
   g.save();g.rotate(.12);const grad=g.createLinearGradient(-80,-30,90,75);grad.addColorStop(0,'#c3bea3');grad.addColorStop(.26,'#ece6cf');grad.addColorStop(.62,'#d8d1b7');grad.addColorStop(1,'#9b9c84');
   g.save();g.globalAlpha*=.25;g.fillStyle='#5a6048';ellipse(4,86,107,16);g.fill();g.restore();
   g.lineWidth=17;g.strokeStyle='#c0bea1';g.beginPath();g.ellipse(84,20,32,36,-.15,0,TAU);g.stroke();
   g.lineWidth=3;g.strokeStyle='#efead5';g.beginPath();g.ellipse(84,20,30,35,-.15,-1.9,.9);g.stroke();
   path('M-74 -35 L-62 52 Q-56 90 0 91 Q57 89 64 51 L75 -35Z',grad,'rgba(81,87,62,.4)',1.1);
   g.fillStyle='#eee9d7';ellipse(0,-35,75,25);g.fill();g.strokeStyle='#a6a98b';g.lineWidth=1.6;g.stroke();
   const coffee=g.createLinearGradient(-30,-48,30,-15);coffee.addColorStop(0,'#41271d');coffee.addColorStop(.5,'#6c4125');coffee.addColorStop(1,'#a66b38');
   g.fillStyle=coffee;ellipse(0,-34,65,19);g.fill();g.strokeStyle='#c59154';g.lineWidth=2;g.stroke();
   g.strokeStyle='rgba(249,220,167,.45)';g.lineWidth=1;g.beginPath();g.ellipse(5,-35,51,13,0,Math.PI,TAU);g.stroke();
   path('M-54 -8 Q-52 39 -43 61',null,'rgba(255,255,239,.52)',5);
   const cupAlpha=g.globalAlpha;for(let i=0;i<40;i++){g.globalAlpha=cupAlpha*.15;g.fillStyle='#777d60';ellipse(noise(i+4)*104-52,noise(i+50)*85-8,.5,.65);g.fill()}g.globalAlpha=cupAlpha;
   g.restore();
  }
  function solution(v,transient){
   const amount=clamp(v.dust),liquid=clamp(v.liquid),dissolve=clamp(amount*1.2);
   if(liquid>.001){g.save();g.globalAlpha*=liquid;
    const wash=g.createRadialGradient(8,24,2,0,24,100);wash.addColorStop(0,'rgba(140,89,42,.36)');wash.addColorStop(.5,'rgba(153,105,54,.20)');wash.addColorStop(1,'rgba(138,108,68,0)');g.fillStyle=wash;ellipse(0,27,116,71);g.fill();
    for(let j=0;j<4;j++){g.strokeStyle='rgba(85,125,112,'+(.24-j*.04)+')';g.lineWidth=j===0?1.6:.7;g.beginPath();g.ellipse(0,27,67+j*16,28+j*11,Math.sin(j)*.1,-.2+j*.5,5.6+j*.5);g.stroke()}
    g.restore()
   }
   if(amount>.001){g.save();const particleAlpha=g.globalAlpha;
    for(let i=0;i<76;i++){
     const angle=noise(i+20)*TAU,d=noise(i+82),spread=24+Math.sqrt(d)*107;
     const initialX=(noise(i+32)-.5)*100,initialY=(noise(i+64)-.5)*150;
     const tx=Math.cos(angle+transient*.7)*spread,ty=Math.sin(angle+transient*.7)*spread*.57+27;
     const x=mix(initialX,tx,dissolve),y=mix(initialY,ty,dissolve);
     g.globalAlpha=particleAlpha*amount*(.14+noise(i+13)*.7)*(i%4?1:.35);g.fillStyle=i%5?'#6d4c32':'#bc8b54';
     const r=(1-dissolve*.6)*(1.4+noise(i+9)*3.1);g.save();g.translate(x,y);g.rotate(angle);g.fillRect(-r,-r,r*1.8,r*1.6);g.restore()
    }g.restore()
   }
  }
  function graphic(v,q){
   g.save();g.translate(v.x*width,v.y*height);g.rotate(v.rotation);g.scale(v.size/100,v.size/100);
   const activity=(media.matches||suspended)?0:Math.sin(Math.PI*q);
   g.globalAlpha=clamp(v.opacity+activity*.12);
   // A restrained engraved orbit is the persistent identity across material changes.
   g.save();g.globalAlpha*=.35;g.strokeStyle=v.roast>.5&&v.dust<.2?'#c5a67a':'#7d8f72';g.lineWidth=.65;
   for(let i=0;i<3;i++){g.beginPath();g.ellipse(0,10,105+i*8,106+i*8,-.3,-.9+i*.15,3.8+i*.18);g.stroke()}g.restore();
   if(symbols.length){
    const a=Math.floor(v.symbol),b=Math.ceil(v.symbol),f=v.symbol-a;
    for(const [i,o]of [[a,1-f],[b,f]])if(o>0&&symbols[i]?.complete){g.save();g.globalAlpha*=o;g.drawImage(symbols[i],-100,-100,200,200);g.restore()}
   }else{
    if(v.seed>.001){g.save();g.globalAlpha*=v.seed*(1-v.dust*.8);if(v.shell>.05||v.peel>.4)seedPair(v.peel);else bean(v.roast);g.restore()}
    fruit(v);solution(v,activity);
    if(v.cup>.001){g.save();g.globalAlpha*=v.cup;g.scale(.75+.25*v.cup,.75+.25*v.cup);cup(v);g.restore()}
   }
   g.restore()
  }
  function render(now,animate=true){
   if(disposed)return;dimensions();if(!current)return;
   const duration=Number(instance.data.durationMs)||1350;
   const q=media.matches||suspended?1:clamp((now-started)/duration),e=q*q*(3-2*q);
   current=interpolate(from||target,target,e);
   // Light reading surfaces settle first; the object keeps its full continuous motion.
   const lightTarget=target.base.reduce((sum,x)=>sum+x,0)/3>180;
   const paperDuration=lightTarget?Math.max(1,Math.min(duration,Number(instance.data.paperDurationMs)||180)):duration;
   const pq=media.matches||suspended?1:clamp((now-started)/paperDuration),pe=pq*pq*(3-2*pq),paperFrom=from||target;
   current.base=paperFrom.base.map((x,i)=>mix(x,target.base[i],pe));
   current.tint=paperFrom.tint.map((x,i)=>mix(x,target.tint[i],pe));
   g.fillStyle=css(current.base);g.fillRect(0,0,width,height);
   const halo=g.createRadialGradient(current.x*width,current.y*height,0,current.x*width,current.y*height,Math.max(width*.52,height*.64));
   halo.addColorStop(0,css(current.tint));halo.addColorStop(1,'rgba('+current.base.map(Math.round).join(',')+',0)');
   g.fillStyle=halo;g.fillRect(0,0,width,height);
   if(texture){g.save();g.globalAlpha=.45;g.fillStyle=texture;g.fillRect(0,0,width,height);g.restore()}
   // Fine atmosphere curves remain part of this single drawing, never an input surface.
   g.save();g.globalAlpha=current.roast>.7&&current.dust<.3?.08:.045;g.strokeStyle=current.roast>.7?'#dbb680':'#547253';g.lineWidth=.7;
   for(let i=0;i<5;i++){g.beginPath();g.ellipse(current.x*width,current.y*height,width*(.22+i*.055),height*(.28+i*.025),-.25,2.9,5.3);g.stroke()}g.restore();
   graphic(current,q);root.dataset.tick=String(++ticks);root.dataset.idle=String(q===1);root.dataset.reduced=String(media.matches);root.dataset.size=width+'x'+height;
   if(animate&&q<1&&!suspended&&!doc.hidden){raf=requestAnimationFrame(render)}else raf=0;
  }
  function read(force=false){
   if(disposed)return;dimensions();loadSymbols();
   const s=port?.read(),chapters=instance.data.chapters||[],directory=s?.scenes.find(x=>x.id===s.locationId)?.targets||[];
   const ai=directory.findIndex(x=>x.id===s?.reading?.activeInstanceId);
   let n=0;for(let i=0;i<chapters.length;i++){const index=directory.findIndex(x=>x.id===chapters[i].targetId);if(index>=0&&index<=ai)n=i}
   const origin=instance.data.originTarget,oi=directory.findIndex(x=>x.id===origin);
   const key=n===0&&oi>=0&&ai>=oi?'origin':String(n);
   root.dataset.chapter=String(n+1);root.dataset.stage=key==='origin'?'origin':(instance.data.stages?.[n]?.key||defaults[Math.min(n,6)].key);
   root.dataset.reading=JSON.stringify(s?.reading||{});root.dataset.events=String(++events);
   if(force||n!==active||key!==phaseKey){
    active=n;phaseKey=key;target=sourceStage(n,key);from=current?{...current,base:[...current.base],tint:[...current.tint]}:{...target};
    started=current?performance.now():0;if(!current)current={...target};if(suspended||media.matches)started=0;cancelAnimationFrame(raf);raf=0;render(performance.now())
   }
  }
  const off=port?.subscribe(()=>read())||(()=>{});
  const resized=()=>{if(disposed)return;dimensions();if(active>=0){target=sourceStage(active,phaseKey);from={...target};started=0;cancelAnimationFrame(raf);render(performance.now())}};
  const ro=new ResizeObserver(resized);ro.observe(root);
  const preference=()=>read(true),visibility=()=>{if(doc.hidden){cancelAnimationFrame(raf);raf=0;root.dataset.hidden='true'}else{root.dataset.hidden='false';read(true)}};
  media.addEventListener('change',preference);doc.addEventListener('visibilitychange',visibility);
  read(true);
  const dispose=()=>{if(disposed)return;disposed=true;cancelAnimationFrame(raf);off();ro.disconnect();media.removeEventListener('change',preference);doc.removeEventListener('visibilitychange',visibility);symbols.forEach(x=>x.onload=null);root.dataset.disposed='true';root.replaceChildren()};
  c.scope.cleanup(dispose);
  return {
   update(next){instance=next;read(true)},
   suspend(){suspended=true;cancelAnimationFrame(raf);raf=0;root.dataset.suspended='true';if(target){from={...target};started=0;render(performance.now(),false)}},
   resume(){if(disposed)return;suspended=false;root.dataset.suspended='false';read(true)},
   dispose
  };
 }
};
