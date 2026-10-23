from pathlib import Path
import json
base=Path(__file__).resolve().parent.parent
motion=json.loads((base/'evidence/final-motion-frames.json').read_text())
heights={}
for row in motion:
    sample=next(s for t in row['transitions'] for s in t['samples'] if s['scrollTop']>0 and s['reading']['progress']>0)
    heights['mobile' if row['width']<700 else 'desktop']=sample['scrollTop']/sample['reading']['progress']+(844 if row['width']<700 else 1000)
config=base/'background-stages.js';t=config.read_text();t+='\nexport const READING_HEIGHTS = '+json.dumps(heights,indent=2)+';\n';config.write_text(t,encoding='utf-8')
p=base/'background-runtime.js';s=p.read_text(encoding='utf-8')
s=s.replace('import {STAGES, READING_KNOTS}', 'import {STAGES, READING_KNOTS, READING_HEIGHTS}')
a=s.index('  g.fillStyle=color(paper.base);g.fillRect');b=s.index('  const scale=options.centered?',a)
s=s[:a]+'''  const cx=options.centered?width/2:width*(mobile?v.mx:v.x),cy=options.centered?height/2:height*(mobile?v.my:v.y);
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
'''+s[b:]
s=s.replace("const measuredKnots={desktop:new Map(),mobile:new Map()};", "const measuredKnots={desktop:new Map(),mobile:new Map()};const paperMetrics={desktop:null,mobile:null};")
needle='  function paint(force=false){'
helper='''  function paperForReading(s,m){
   const kind=root.clientWidth<700?'mobile':'desktop',p=clamp(s?.reading?.progress||0),size=root.clientWidth+'x'+root.clientHeight;
   let metrics=paperMetrics[kind];if(!metrics||metrics.size!==size)metrics=paperMetrics[kind]={size,range:Math.max(root.clientHeight,READING_HEIGHTS[kind]-root.clientHeight)};
   // reading.progress is scrollTop/range, as published by the sole software owner.
   // No DOM search, scroll measurement, target lookup or scroll command is used here.
   if(Number.isFinite(m?.scrollTop)&&p>.001){const range=m.scrollTop/p;if(range>root.clientHeight)metrics.range=range}
   const knots=[...(instance.data.readingKnots?.[kind]||READING_KNOTS[kind])];for(const [i,value]of measuredKnots[kind])knots[i]=value;
   const boundaries=knots.map(k=>k*metrics.range),anchor=(instance.data.chapters||[]).findIndex(x=>x.targetId===m?.targetInstanceId);
   if(anchor>=0&&Number.isFinite(m?.targetScrollTop))boundaries[anchor]=m.targetScrollTop;
   for(let i=1;i<boundaries.length;i++)boundaries[i]=Math.max(boundaries[i],boundaries[i-1]+16);
   return{scrollTop:Number.isFinite(m?.scrollTop)?m.scrollTop:p*metrics.range,boundaries,range:metrics.range};
  }
'''
s=s.replace(needle,helper+needle)
s=s.replace("const readingPhase=phaseForReading(s),paperPhase=running?readingPhase:visual;", "const readingPhase=phaseForReading(s),paperPhase=running?readingPhase:visual,paperBands=paperForReading(s,m);")
s=s.replace("const key=[visual.toFixed(5),paperPhase.toFixed(5),root.clientWidth", "const key=[visual.toFixed(5),paperPhase.toFixed(5),paperBands.scrollTop.toFixed(2),paperBands.range.toFixed(2),paperBands.boundaries.map(x=>x.toFixed(1)).join(','),root.clientWidth")
s=s.replace("renderer.draw(visual,{stages:instance.data.stages,paperPhase});", "renderer.draw(visual,{stages:instance.data.stages,paperPhase,paperBands});root.dataset.paperMode='reading-bands';root.dataset.paperScrollTop=paperBands.scrollTop.toFixed(2);root.dataset.paperBoundaries=JSON.stringify(paperBands.boundaries);")
p.write_text(s,encoding='utf-8')
print('Paper palette now shares the foreground scroll coordinate system.',heights)
