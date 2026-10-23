/* Coffee journey v07. Photographic materials, one deterministic phase, one host clock.
 * All image URLs are authored resource values in instance.data.assets.
 * No host DOM access, scrolling, timers, autonomous animation, or author-state writes. */
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
const rnd=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453123;return v-Math.floor(v)};
const TAU=Math.PI*2;
import {STAGES, READING_KNOTS, READING_HEIGHTS} from './background-stages.js';
const SEED_LEFT='M -1 -45 C -14 -61 -39 -57 -49 -32 C -66 6 -58 48 -40 69 C -27 87 -5 86 0 66 C 5 38 5 -22 -1 -45 Z';
const SEED_RIGHT='M 14 -45 C 28 -60 43 -52 52 -31 C 66 6 66 44 53 67 C 44 86 22 89 14 67 C 9 34 8 -21 14 -45 Z';

export function createCoffeeRenderer(canvas,urls,onReady=()=>{}){
 const doc=canvas.ownerDocument,win=doc.defaultView,g=canvas.getContext('2d',{alpha:false});
 const SEEDS=new win.Path2D(SEED_LEFT+' '+SEED_RIGHT);
 const images={},cache={},fragments=[];let width=1,height=1,ready=0,disposed=false;
 const make=(w=560,h=560)=>{const c=doc.createElement('canvas');c.width=w;c.height=h;return c};
 const scratch=(key,w=560,h=560)=>{const c=cache[key]||(cache[key]=make(w,h));if(c.width!==w||c.height!==h){c.width=w;c.height=h}const cg=c.getContext('2d');cg.setTransform(1,0,0,1,0,0);cg.globalAlpha=1;cg.globalCompositeOperation='source-over';cg.clearRect(0,0,c.width,c.height);return c};
 const full=(ctx,key)=>{const im=images[key];if(im?.complete&&im.naturalWidth)ctx.drawImage(im,-140,-140,280,280)};
 const ellipse=(ctx,x,y,rx,ry)=>{ctx.beginPath();ctx.ellipse(x,y,Math.max(.001,rx),Math.max(.001,ry),0,0,TAU)};
 const withAlpha=(ctx,a,fn)=>{if(a<=.0001)return;ctx.save();ctx.globalAlpha*=clamp(a);fn();ctx.restore()};
 const fragPath=(ctx,f,round=0)=>{ctx.beginPath();const p=f.points;if(!round){p.forEach((v,i)=>i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]))}else{for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],x=mix(b[0],a[0],round),y=mix(b[1],a[1],round);i?ctx.lineTo(x,y):ctx.moveTo(x,y);ctx.quadraticCurveTo(b[0],b[1],mix(b[0],c[0],round),mix(b[1],c[1],round))}}ctx.closePath()};
 // Irregular Voronoi grains preserve the source texture, then round as they separate.
 const cols=11,rows=15,sites=[];
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)sites.push({x:-140+(i+.25+rnd(j*73+i)*.5)*280/cols,y:-140+(j+.25+rnd(j*43+i+12)*.5)*280/rows});
 const clipCell=(poly,a,b)=>{const nx=b.x-a.x,ny=b.y-a.y,limit=(b.x*b.x+b.y*b.y-a.x*a.x-a.y*a.y)/2,out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dp=p[0]*nx+p[1]*ny-limit,dq=q[0]*nx+q[1]*ny-limit;if(dp<=0)out.push(p);if((dp<=0)!==(dq<=0)){const t=dp/(dp-dq);out.push([mix(p[0],q[0],t),mix(p[1],q[1],t)])}}return out};
 for(let id=0;id<sites.length;id++){
  const site=sites[id];let points=[[-140,-140],[140,-140],[140,140],[-140,140]];
  for(let j=0;j<sites.length&&points.length;j++)if(j!==id)points=clipCell(points,site,sites[j]);
  const x=site.x,y=site.y;
  fragments.push({points,x,y,id,delay:Math.abs(x)/140*.25+rnd(id+71)*.14,tx:Math.cos(rnd(id+7)*TAU)*(30+rnd(id+23)*119),ty:25+Math.sin(rnd(id+7)*TAU)*(14+rnd(id+81)*46),spin:(rnd(id+97)-.5)*2.7});
 }
 for(const key of ['cup','cherry','section','green','gold','roast']){
  const im=new win.Image();images[key]=im;
  im.onload=()=>{ready++;cache[key]=null;if(!disposed)onReady(key)};
  im.onerror=()=>{if(!disposed)onReady(key,new Error('Asset could not decode: '+key))};im.src=urls[key]||'';
 }
 function liquid(ctx,x,y,rx,ry,amount=1,red=0){
  if(amount<=0)return;ctx.save();ctx.globalAlpha*=amount*.52;ellipse(ctx,x,y+2.1,rx,ry);ctx.fillStyle='#4c2e1c';ctx.fill();ctx.restore();ctx.save();ctx.globalAlpha*=amount;ellipse(ctx,x,y,rx,ry);ctx.clip();
  const grad=ctx.createLinearGradient(x-rx,y-ry,x+rx,y+ry);grad.addColorStop(0,'#23170f');grad.addColorStop(.58,'#714424');grad.addColorStop(1,'#b78341');ctx.fillStyle=grad;ctx.fillRect(x-rx,y-ry,rx*2,ry*2);
  const im=images.cup;if(im.complete&&im.naturalWidth)ctx.drawImage(im,im.naturalWidth*.20,im.naturalHeight*.267,im.naturalWidth*.46,im.naturalHeight*.135,x-rx,y-ry,rx*2,ry*2);
  if(red>0){ctx.globalCompositeOperation='source-atop';ctx.fillStyle='rgba(132,9,20,'+red*.7+')';ctx.fillRect(x-rx,y-ry,rx*2,ry*2)}
  ctx.restore();ctx.save();ctx.globalAlpha*=amount*.35;ctx.strokeStyle='#ddba7d';ctx.lineWidth=.7;ellipse(ctx,x,y,rx,ry);ctx.stroke();ctx.restore();
 }
 // Premultiplied, energy-preserving material blend: transparent edges do not stack.
 function blendLayers(ctx,key,a,b,t){
  if(t<=0){a(ctx);return}if(t>=1){b(ctx);return}
  const ca=scratch(key+'-a'),cb=scratch(key+'-b'),co=scratch(key+'-mix');
  const ga=ca.getContext('2d'),gb=cb.getContext('2d'),go=co.getContext('2d');
  ga.setTransform(2,0,0,2,280,280);gb.setTransform(2,0,0,2,280,280);a(ga);b(gb);
  go.globalAlpha=1-t;go.drawImage(ca,0,0);go.globalCompositeOperation='lighter';go.globalAlpha=t;go.drawImage(cb,0,0);
  ctx.drawImage(co,-140,-140,280,280);
 }
 function maskedSprite(ctx,key,mask){ctx.save();mask(ctx);ctx.clip();full(ctx,key);ctx.restore()}
 function ceramic(ctx,fraction,mode){
  const layer=scratch('ceramic-layer'),lg=layer.getContext('2d');lg.setTransform(2,0,0,2,280,280);full(lg,'cup');lg.globalCompositeOperation='destination-in';
  if(mode==='reveal'){if(fraction<=0)return;const radius=fraction*275,mask=lg.createRadialGradient(-20,-48,Math.max(0,radius-20),-20,-48,radius+10);mask.addColorStop(0,'#000');mask.addColorStop(1,'transparent');lg.fillStyle=mask;}else{const edge=-158+fraction*316,mask=lg.createLinearGradient(0,edge-24,0,edge+24);mask.addColorStop(0,'transparent');mask.addColorStop(1,'#000');lg.fillStyle=mask;}lg.fillRect(-140,-140,280,280);ctx.drawImage(layer,-140,-140,280,280);
 }
 function cupToCherry(ctx,q){
  const retire=smooth(.04,.60,q),lift=smooth(.12,.82,q),material=smooth(.37,.90,q);
  ctx.save();ctx.translate(0,retire*26);ceramic(ctx,retire,'retire');ctx.restore();
  liquid(ctx,mix(-20,0,lift),mix(-48,12,lift),mix(82,87,lift),mix(29,100,lift),1-smooth(.27,.51,q),smooth(.18,.72,q));
  // The lifted liquid acquires fruit volume before its surface resolves into red skin.
  withAlpha(ctx,smooth(.20,.44,q),()=>{ctx.save();ctx.translate(mix(-20,0,lift),mix(-48,0,lift));ctx.scale(mix(.97,1,lift),mix(.31,1,lift));ctx.filter=material>=1?'none':'sepia('+(1-material)+') saturate('+mix(.42,1,material)+') brightness('+mix(.38,1,material)+') blur('+((1-material)*.65)+'px)';maskedSprite(ctx,'cherry',c=>{c.beginPath();c.rect(-150,mix(-82,-150,smooth(.55,.87,q)),300,300)});ctx.restore()});
 }
 function seedPair(ctx){ctx.save();ctx.clip(SEEDS);full(ctx,'section');ctx.restore()}
 function shells(ctx,opening,retire=0){
  for(const side of [-1,1]){
   ctx.save();ctx.translate(side*(opening*49+retire*55),-opening*7-retire*34);ctx.rotate(side*(opening*.18+retire*.17));ctx.scale(1-opening*.20,1-retire*.08);
   const material=smooth(.15,.87,opening),alpha=1-smooth(0,.76,retire);ctx.globalAlpha*=alpha;
   const layer=scratch('shell-'+side),lg=layer.getContext('2d');lg.setTransform(2,0,0,2,280,280);lg.save();lg.beginPath();lg.rect(side<0?-150:4,-155,side<0?154:146,310);lg.clip();full(lg,'cherry');
   // Inner tissue replaces the skin through a moving face boundary; shell pixels stay opaque.
   const edge=side<0?4-material*154:4,span=material*150;
   lg.clearRect(edge,-150,span+1,300);lg.save();lg.beginPath();lg.rect(edge,-150,span+1,300);lg.clip();const outside=new win.Path2D('M-150 -155H150V155H-150Z '+SEED_LEFT+' '+SEED_RIGHT);lg.clip(outside,'evenodd');full(lg,'section');lg.restore();
   lg.restore();ctx.drawImage(layer,-140,-140,280,280);ctx.restore();
  }
 }
 function fruitToSeeds(ctx,q){
  // At closure the fruit is one image; introducing the opaque inner assembly uses
  // a registered premultiplied blend, so alpha edges never acquire an extra outline.
  blendLayers(ctx,'peel-entry',c=>full(c,'cherry'),c=>{seedPair(c);shells(c,smooth(.02,.98,q))},smooth(0,.12,q));
 }
 function seedTurn(ctx,q){
  const travel=smooth(0,1,q);shells(ctx,1,travel);
  ctx.save();ctx.translate(travel*60,-travel*16);ctx.scale(1-travel*.2,1-travel*.15);withAlpha(ctx,1-smooth(.03,.65,q),()=>{ctx.save();ctx.clip(new win.Path2D(SEED_RIGHT));full(ctx,'section');ctx.restore()});ctx.restore();
  const cx=mix(-27,0,travel),cy=mix(14,0,travel),turn=smooth(.10,.90,q),cos=Math.cos(Math.PI*turn),backWidth=Math.max(0,cos),frontWidth=Math.max(0,-cos);
  // A real turn: the outgoing face narrows to its edge before the grooved face opens.
  // Both faces have zero area at the exchange point, so no second translucent outline exists.
  ctx.save();ctx.translate(cx,cy);ctx.scale(.22*Math.sin(Math.PI*turn),mix(.61,1,travel));full(ctx,'green');ctx.restore();
  if(backWidth>0){ctx.save();ctx.translate(cx,cy);ctx.scale(mix(1,1.8,travel)*backWidth,mix(1,1.65,travel));ctx.translate(27,-14);ctx.clip(new win.Path2D(SEED_LEFT));full(ctx,'section');ctx.restore()}
  if(frontWidth>0){ctx.save();ctx.translate(cx,cy);ctx.scale(mix(.40,1,travel)*frontWidth,mix(.61,1,travel));full(ctx,'green');ctx.restore()}
 }
 function seedsToGreen(ctx,q){
  // Align the union-clipped pair and its independently moving faces while their
  // transforms are still almost identical. No material replacement at the boundary.
  blendLayers(ctx,'seed-entry',c=>fruitToSeeds(c,1),c=>seedTurn(c,q),smooth(0,.10,q));
 }
 function roastedBean(ctx,q){
  if(q<=.5)blendLayers(ctx,'roast-green-gold',c=>full(c,'green'),c=>full(c,'gold'),smooth(0,.5,q));
  else blendLayers(ctx,'roast-gold-brown',c=>full(c,'gold'),c=>full(c,'roast'),smooth(.5,1,q));
 }
 function solution(ctx,q=1){
  const a=smooth(.30,.90,q);liquid(ctx,0,35,110,46,a*.94);
  // Traced liquid highlights, fixed in progress: no idle loop or random flicker.
  withAlpha(ctx,a*.28,()=>{ctx.strokeStyle='#ddbc8d';ctx.lineWidth=.8;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(-6+i*6,32,72+i*12,21+i*6,-.08,3.35,5.8);ctx.stroke()}});
 }
 function beanToSolution(ctx,q){
  solution(ctx,q);
  if(q<.00001){full(ctx,'roast');return}
  // The intact region loses exactly those source cells that have been released.
  const remaining=scratch('fracture-remainder');const rg=remaining.getContext('2d');rg.setTransform(2,0,0,2,280,280);full(rg,'roast');rg.globalCompositeOperation='destination-out';
  for(const f of fragments){const s=smooth(f.delay,f.delay+.35,q);if(s>0){rg.save();rg.globalAlpha=smooth(0,.055,s);fragPath(rg,f);rg.fill();rg.lineWidth=1.5;rg.stroke();rg.restore()}}
  ctx.drawImage(remaining,-140,-140,280,280);
  for(const f of fragments){
   const s=smooth(f.delay,f.delay+.35,q);if(s<=0)continue;
   const drift=smooth(.02,.99,s),dissolve=smooth(.48,1,q),x=mix(f.x,f.tx,drift),y=mix(f.y,f.ty,drift),scale=mix(1,.22,drift);
   const residue=f.id%19===0?.38:0,alpha=mix(1,residue,dissolve);
   ctx.save();ctx.globalAlpha*=alpha*smooth(0,.055,s);ctx.translate(x,y);ctx.rotate(f.spin*drift);ctx.scale(scale,scale);ctx.translate(-f.x,-f.y);fragPath(ctx,f,.43*drift);ctx.clip();full(ctx,'roast');ctx.restore();
  }
 }
 function solutionToCup(ctx,q){
  const gather=smooth(0,.42,q),reveal=smooth(.30,1,q);
  // Ceramic resolves outwards from the liquid plane, keeping rim and bowl attached.
  ceramic(ctx,reveal,'reveal');
  liquid(ctx,mix(0,-20,gather),mix(35,-48,gather),mix(110,82,gather),mix(46,29,gather),.94*(1-smooth(.72,1,q)));
  withAlpha(ctx,(1-smooth(0,.6,q))*.28,()=>{ctx.strokeStyle='#ddbc8d';ctx.lineWidth=.8;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(-6+i*6,32,72+i*12,21+i*6,-.08,3.35,5.8);ctx.stroke()}});
  for(const f of fragments.filter(f=>f.id%19===0)){
   const a=(1-smooth(0,.6,q))*.38;if(a<=0)continue;ctx.save();ctx.globalAlpha*=a;ctx.translate(mix(f.tx,-20,gather),mix(f.ty,-48,gather));ctx.rotate(f.spin);ctx.scale(.22*(1-gather),.22*(1-gather));ctx.translate(-f.x,-f.y);fragPath(ctx,f,.43);ctx.clip();full(ctx,'roast');ctx.restore();
  }
 }
 function pose(phase,stages=STAGES){
  const p=clamp(phase,0,6),i=Math.min(5,Math.floor(p)),t=smooth(0,1,p-i),a={...STAGES[i],...(stages[i]||{})},b={...STAGES[i+1],...(stages[i+1]||{})},v={};
  for(const k of ['x','y','scale','angle','mx','my','mscale','opacity'])v[k]=mix(a[k],b[k],t);
  v.base=a.base.map((x,j)=>mix(x,b.base[j],t));v.tint=a.tint.map((x,j)=>mix(x,b.tint[j],t));return v;
 }
 function draw(phase,options={}){
  if(disposed)return;const p=clamp(Number(phase)||0,0,6),v=pose(p,options.stages),mobile=(options.width||canvas.clientWidth)<700;
  width=Math.max(1,options.width||canvas.clientWidth||1);height=Math.max(1,options.height||canvas.clientHeight||1);const dpr=Math.min(2,win.devicePixelRatio||1);
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)}g.setTransform(dpr,0,0,dpr,0,0);
  const color=rgb=>'rgb('+rgb.map(Math.round).join(',')+')';
  const paper=options.paperPhase===undefined?v:pose(options.paperPhase,options.stages);
  const cx=options.centered?width/2:width*(mobile?v.mx:v.x),cy=options.centered?height/2:height*(mobile?v.my:v.y);
  if(options.paperBands){
   const {scrollTop,boundaries}=options.paperBands;
   // The light/dark field follows the real content coordinates. A single whole-screen
   // colour cannot protect both chapters when two different text palettes coexist.
   const palette=STAGES.map((stage,i)=>{const a={...stage,...(options.stages?.[i]||{})};return a.base.map((v,k)=>mix(v,a.tint[k],.18))});
   const intervals=boundaries.slice(1).map((at,i)=>({lo:at-(i===4?120:i===3?36:105),hi:at-(i===4?8:i===3?-12:0),from:i,to:i+1}));
   const at=y=>{for(const q of intervals){if(y<q.lo)return palette[q.from];if(y<q.hi){const t=clamp((y-q.lo)/(q.hi-q.lo));return palette[q.from].map((v,k)=>mix(v,palette[q.to][k],t))}}return palette[6]};
   const stops=[0,height];for(const q of intervals)for(const at of [q.lo,q.hi])if(at>scrollTop&&at<scrollTop+height)stops.push(at-scrollTop);
   const wash=g.createLinearGradient(0,0,0,height);for(const y of [...new Set(stops)].sort((a,b)=>a-b))wash.addColorStop(y/height,color(at(scrollTop+y)));
   g.fillStyle=wash;g.fillRect(0,0,width,height);
   const depth=g.createRadialGradient(cx,cy,0,cx,cy,Math.max(width*.58,height*.70));depth.addColorStop(0,'rgba(255,255,255,.025)');depth.addColorStop(1,'rgba(0,0,0,.008)');g.fillStyle=depth;g.fillRect(0,0,width,height);
  }else{
   g.fillStyle=color(paper.base);g.fillRect(0,0,width,height);
   const glow=g.createRadialGradient(cx,cy,0,cx,cy,Math.max(width*.58,height*.70));glow.addColorStop(0,color(paper.tint));glow.addColorStop(1,'rgba('+paper.base.map(Math.round).join(',')+',0)');g.fillStyle=glow;g.fillRect(0,0,width,height);
  }
  const scale=options.centered?Math.min(width,height)/330:(mobile?v.mscale:v.scale);
  g.save();g.translate(cx,cy);g.rotate(v.angle);g.scale(scale,scale);g.globalAlpha=options.centered?1:v.opacity;
  // Contact shadow is soft and spatially anchored, not used to hide material flaws.
  if(p<1||p>5){const s=p<1?1-smooth(0,.5,p):smooth(5.4,6,p);g.save();g.globalAlpha*=s*.16;g.filter='blur(9px)';g.fillStyle='#4f422e';ellipse(g,0,111,91,9);g.fill();g.restore()}
  // Every material path is rasterized on the same registered grid before camera
  // transforms. Crossfade entry/exit cannot change texture resampling or edge alpha.
  const object=scratch('subject-composite',960,960),o=object.getContext('2d');o.setTransform(2,0,0,2,480,480);
  if(p<1)cupToCherry(o,p);
  else if(p<2)fruitToSeeds(o,p-1);
  else if(p<3)seedsToGreen(o,p-2);
  else if(p<4)roastedBean(o,p-3);
  else if(p<5)beanToSolution(o,p-4);
  else solutionToCup(o,p-5);
  if(mobile&&!options.centered&&options.readingGuard!==false){
   // Phone prose uses almost the full width. Keep the material in its edge rail;
   // the photographic object remains fully exposed in desktop negative space and
   // in the isolated art study. This spatial mask protects text during manual scroll.
   const layer=scratch('mobile-reading-rail',canvas.width,canvas.height),lg=layer.getContext('2d');
   lg.setTransform(g.getTransform());lg.drawImage(object,-240,-240,480,480);lg.setTransform(1,0,0,1,0,0);
   lg.globalCompositeOperation='destination-in';const guard=lg.createLinearGradient((width-54)*dpr,0,width*dpr,0);
   guard.addColorStop(0,'rgba(0,0,0,0)');guard.addColorStop(2/3,'rgba(0,0,0,.055)');guard.addColorStop(.86,'rgba(0,0,0,.42)');guard.addColorStop(1,'rgba(0,0,0,1)');
   lg.fillStyle=guard;lg.fillRect(0,0,canvas.width,canvas.height);
   g.save();g.setTransform(1,0,0,1,0,0);g.drawImage(layer,0,0);g.restore();
  }else g.drawImage(object,-240,-240,480,480);
  g.restore();return {phase:p,ready,width,height,pose:v};
 }
 return {draw,pose,ready:()=>ready,dispose(){disposed=true;for(const im of Object.values(images)){im.onload=null;im.onerror=null}}};
}

export default {
 mount(c){
  const root=c.root,doc=root.ownerDocument,win=doc.defaultView,port=c.teacherController;
  const canvas=doc.createElement('canvas');canvas.setAttribute('aria-hidden','true');canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none';root.append(canvas);
  Object.assign(root.style,{width:'100%',height:'100%',overflow:'hidden',pointerEvents:'none'});
  root.dataset.coffeeUnderlay='journey-v07';root.dataset.mountId=String(Date.now())+'-'+Math.random().toString(36).slice(2,7);
  let instance=c.instance,visual=0,start=0,motionKey='',off=null,disposed=false,suspended=false,lastPaint='',ticks=0,renderer;
  let manualOffset=0,manualOrigin=0,previousStatus='';const measuredKnots={desktop:new Map(),mobile:new Map()};const paperMetrics={desktop:null,mobile:null};
  const media=win.matchMedia('(prefers-reduced-motion: reduce)');
  function chapterFor(id,s){
   const directory=s?.scenes?.find(x=>x.id===s.locationId)?.targets||[],chapters=instance.data.chapters||[],ai=directory.findIndex(x=>x.id===id);
   const direct=chapters.findIndex(x=>x.targetId===id);if(direct>=0)return direct;
   let n=0;for(let i=0;i<chapters.length;i++){const k=directory.findIndex(x=>x.id===chapters[i].targetId);if(k>=0&&k<=ai)n=i}return n;
  }
  function phaseForReading(s){
   const kind=root.clientWidth<700?'mobile':'desktop';
   const configured=instance.data.readingKnots?.[kind]||READING_KNOTS[kind];
   const knots=[...configured];for(const [i,p]of measuredKnots[kind])knots[i]=p;
   // Navigation completion calibrates the artistic timeline to the actual host reading fact.
   // This is a transient rendering map, never a second chapter/scroll state or author mutation.
   for(let i=1;i<knots.length;i++)knots[i]=Math.max(knots[i],knots[i-1]+.00001);
   const p=clamp(s?.reading?.progress||0);if(p<=knots[0])return 0;
   for(let i=0;i<6;i++)if(p<knots[i+1])return i+smooth(.58,1,(p-knots[i])/(knots[i+1]-knots[i]));
   return 6;
  }
  function paperForReading(s,m){
   const kind=root.clientWidth<700?'mobile':'desktop',p=clamp(s?.reading?.progress||0),size=root.clientWidth+'x'+root.clientHeight;
   let metrics=paperMetrics[kind];if(!metrics||metrics.size!==size)metrics=paperMetrics[kind]={size,range:Math.max(root.clientHeight,(READING_HEIGHTS[kind]||READING_HEIGHTS.desktop)-root.clientHeight)};
   // reading.progress is scrollTop/range, as published by the sole software owner.
   // No DOM search, scroll measurement, target lookup or scroll command is used here.
   if(Number.isFinite(m?.scrollTop)&&p>.001){const range=m.scrollTop/p;if(range>root.clientHeight)metrics.range=range}
   const knots=[...(instance.data.readingKnots?.[kind]||READING_KNOTS[kind])];for(const [i,value]of measuredKnots[kind])knots[i]=value;
   const boundaries=knots.map(k=>k*metrics.range),anchor=(instance.data.chapters||[]).findIndex(x=>x.targetId===m?.targetInstanceId);
   if(anchor>=0&&Number.isFinite(m?.targetScrollTop))boundaries[anchor]=m.targetScrollTop;
   for(let i=1;i<boundaries.length;i++)boundaries[i]=Math.max(boundaries[i],boundaries[i-1]+16);
   return{scrollTop:Number.isFinite(m?.scrollTop)?m.scrollTop:p*metrics.range,boundaries,range:metrics.range};
  }
  function paint(force=false){
   if(disposed||suspended||doc.hidden||!renderer)return;const s=port?.read(),m=s?.flowMotion;let running=false;
   if(m?.status==='running'){
    const key=m.containerId+'/'+m.id;if(key!==motionKey){motionKey=key;start=visual}
    visual=media.matches?chapterFor(m.targetInstanceId,s):mix(start,chapterFor(m.targetInstanceId,s),clamp(m.progress));running=true;
   }else if(m?.status==='completed'){
    visual=chapterFor(m.targetInstanceId,s);motionKey='';manualOffset=0;
    const anchor=(instance.data.chapters||[]).findIndex(x=>x.targetId===m.targetInstanceId);
    if(anchor>=0)measuredKnots[root.clientWidth<700?'mobile':'desktop'].set(anchor,clamp(s?.reading?.progress||0));
   }else if(m?.status==='cancelled'){
    if(previousStatus==='running'){manualOffset=visual-phaseForReading(s);manualOrigin=s?.reading?.progress||0}motionKey='';
   }else{
    const p=s?.reading?.progress||0,base=phaseForReading(s);
    if(previousStatus==='running'){manualOffset=visual-base;manualOrigin=p}
    motionKey='';visual=media.matches?chapterFor(s?.reading?.activeInstanceId,s):clamp(base+manualOffset*(1-smooth(0,.055,Math.abs(p-manualOrigin))),0,6);
   }
   previousStatus=m?.status||'';
   // Paper follows actual chapter passage, so a light foreground never waits for a long material journey.
   const readingPhase=phaseForReading(s),paperPhase=running?readingPhase:visual,paperBands=paperForReading(s,m);
   const key=[visual.toFixed(5),paperPhase.toFixed(5),paperBands.scrollTop.toFixed(2),paperBands.range.toFixed(2),paperBands.boundaries.map(x=>x.toFixed(1)).join(','),root.clientWidth,root.clientHeight,renderer.ready()].join('/');
   root.dataset.chapter=String(chapterFor(s?.reading?.activeInstanceId,s)+1);root.dataset.phase=visual.toFixed(5);root.dataset.stage=STAGES[Math.round(visual)].key;root.dataset.idle=String(!running);root.dataset.reduced=String(media.matches);root.dataset.motionId=m?String(m.id):'';root.dataset.motionProgress=m?String(m.progress):'';root.dataset.motionStatus=m?.status||'manual';root.dataset.scrollTop=m?String(m.scrollTop):'';root.dataset.paperPhase=paperPhase.toFixed(5);root.dataset.reading=JSON.stringify(s?.reading||{});
   if(!force&&key===lastPaint)return;lastPaint=key;renderer.draw(visual,{stages:instance.data.stages,paperPhase,paperBands});root.dataset.paperMode='reading-bands';root.dataset.paperScrollTop=paperBands.scrollTop.toFixed(2);root.dataset.paperBoundaries=JSON.stringify(paperBands.boundaries);root.dataset.tick=String(++ticks);root.dataset.size=root.clientWidth+'x'+root.clientHeight;root.dataset.readingGuard=root.clientWidth<700?'edge-rail':'negative-space';root.dataset.assetsReady=String(renderer.ready());
  }
  function makeRenderer(){renderer?.dispose();const assets=Object.fromEntries(Object.entries(instance.data.assets||{}).map(([k,v])=>[k,c.resources?.url(v)||v]));renderer=createCoffeeRenderer(canvas,assets,(key,error)=>{if(error)root.dataset.assetError=key;paint(true)});lastPaint=''}
  function connect(){if(!off)off=port?.subscribe(()=>paint())||(()=>{});paint(true)}
  function disconnect(){off?.();off=null}
  makeRenderer();const ro=new win.ResizeObserver(()=>paint(true));ro.observe(root);
  const preference=()=>paint(true),visibility=()=>{root.dataset.hidden=String(doc.hidden);if(!doc.hidden)paint(true)};media.addEventListener('change',preference);doc.addEventListener('visibilitychange',visibility);
  connect();
  const dispose=()=>{if(disposed)return;disposed=true;disconnect();ro.disconnect();renderer.dispose();media.removeEventListener('change',preference);doc.removeEventListener('visibilitychange',visibility);root.dataset.disposed='true';root.replaceChildren()};c.scope.cleanup(dispose);
  return {update(next){const old=JSON.stringify(instance.data.assets);instance=next;if(old!==JSON.stringify(next.data.assets))makeRenderer();paint(true)},suspend(){suspended=true;disconnect();root.dataset.suspended='true'},resume(){if(disposed)return;suspended=false;root.dataset.suspended='false';connect()},dispose};
 }
};
