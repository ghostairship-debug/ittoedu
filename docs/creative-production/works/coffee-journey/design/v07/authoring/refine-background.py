from pathlib import Path
import json
base=Path(__file__).resolve().parent.parent
p=base/'background-runtime.js'
s=p.read_text(encoding='utf-8-sig')
a=s.index('const STAGES='); b=s.index('const SEED_LEFT=',a)
stages=[
 dict(key='cup',base=[239,236,225],tint=[221,210,188],x=.88,y=.86,scale=.86,angle=-.045,mx=1.025,my=.70,mscale=.43,opacity=.94),
 dict(key='cherry',base=[229,235,219],tint=[204,218,186],x=.94,y=.91,scale=.88,angle=-.08,mx=1.035,my=.69,mscale=.43,opacity=.94),
 dict(key='peel',base=[237,227,207],tint=[225,204,173],x=.955,y=.94,scale=.67,angle=.06,mx=1.04,my=.62,mscale=.40,opacity=.92),
 dict(key='green',base=[230,235,222],tint=[207,220,192],x=.95,y=.87,scale=.75,angle=-.12,mx=1.04,my=.67,mscale=.43,opacity=.94),
 dict(key='roast',base=[25,31,26],tint=[69,58,42],x=.955,y=.96,scale=.82,angle=.07,mx=1.045,my=.69,mscale=.44,opacity=.96),
 dict(key='solution',base=[228,237,229],tint=[188,213,194],x=.95,y=.86,scale=.94,angle=0,mx=1.055,my=.67,mscale=.45,opacity=.94),
 dict(key='return',base=[239,236,225],tint=[222,209,182],x=.96,y=.93,scale=.84,angle=.035,mx=1.035,my=.70,mscale=.43,opacity=.94)
]
measurements=json.loads((base/'evidence/reading-knots.json').read_text())
knots={key:[r['reading']['progress'] for r in measurements if r.get('width')==width and 'chapter' in r] for key,width in [('desktop',1440),('mobile',390)]}
config='// Authored composition and measured reading calibration; no scrolling ownership.\n'
config+='export const STAGES = '+json.dumps(stages,indent=2)+';\n'
config+='export const READING_KNOTS = '+json.dumps(knots,indent=2)+';\n'
config+='export const TRANSITION_NOTES = '+json.dumps([
 {'from':'U01','to':'U02','technique':'liquid-lift, ceramic recession mask, photographic material resolve'},
 {'from':'U02','to':'U03','technique':'registered opaque skin halves, moving inner-face masks, stable seed pair'},
 {'from':'U03','to':'U04','technique':'tissue departure, one seed rotates through an edge-on exchange'},
 {'from':'U04','to':'U05','technique':'registered green/gold/roast textures on one contour'},
 {'from':'U05','to':'U06','technique':'source-textured Voronoi fracture, deterministic trajectories, liquid transfer'},
 {'from':'U06','to':'U07','technique':'liquid-plane convergence and outward ceramic reveal'}
],ensure_ascii=False,indent=2)+';\n'
(base/'background-stages.js').write_text(config,encoding='utf-8')
s=s[:a]+"import {STAGES, READING_KNOTS} from './background-stages.js';\n"+s[b:]
s=s.replace("const full=(ctx,key)=>", "const scratch=key=>{const c=cache[key]||(cache[key]=make()),cg=c.getContext('2d');cg.setTransform(1,0,0,1,0,0);cg.globalAlpha=1;cg.globalCompositeOperation='source-over';cg.clearRect(0,0,c.width,c.height);return c};\n const full=(ctx,key)=>")
s=s.replace("const layer=make(),lg=layer.getContext('2d');lg.setTransform(2,0,0,2,280,280);full(lg,'cup');", "const layer=scratch('ceramic-layer'),lg=layer.getContext('2d');lg.setTransform(2,0,0,2,280,280);full(lg,'cup');")
s=s.replace("const layer=make(),lg=layer.getContext('2d');lg.setTransform(2,0,0,2,280,280);lg.beginPath();", "const layer=scratch('shell-'+side),lg=layer.getContext('2d');lg.setTransform(2,0,0,2,280,280);lg.save();lg.beginPath();")
s=s.replace("ctx.drawImage(layer,-140,-140,280,280);ctx.restore();\n  }\n }\n function fruitToSeeds", "lg.restore();ctx.drawImage(layer,-140,-140,280,280);ctx.restore();\n  }\n }\n function fruitToSeeds")
s=s.replace("const remaining=make();const rg=remaining.getContext('2d');", "const remaining=scratch('fracture-remainder');const rg=remaining.getContext('2d');")
# Thin meniscus adds liquid depth without drawing an opaque new cup or unrelated particles.
s=s.replace("if(amount<=0)return;ctx.save();ctx.globalAlpha*=amount;ellipse(ctx,x,y,rx,ry);ctx.clip();", "if(amount<=0)return;ctx.save();ctx.globalAlpha*=amount*.52;ellipse(ctx,x,y+2.1,rx,ry);ctx.fillStyle='#4c2e1c';ctx.fill();ctx.restore();ctx.save();ctx.globalAlpha*=amount;ellipse(ctx,x,y,rx,ry);ctx.clip();")
# Preserve first-class foreground readability with composition and edge cropping, not weak material alpha.
s=s.replace("let instance=c.instance,visual=0,start=0,motionKey='',off=null,disposed=false,suspended=false,lastPaint='',ticks=0,renderer;", "let instance=c.instance,visual=0,start=0,motionKey='',off=null,disposed=false,suspended=false,lastPaint='',ticks=0,renderer;\n  let manualOffset=0,manualOrigin=0,previousStatus='';const measuredKnots={desktop:new Map(),mobile:new Map()};")
a=s.index('  function phaseForReading(s){'); b=s.index('  function paint(force=false){',a)
s=s[:a]+'''  function phaseForReading(s){
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
'''+s[b:]
s=s.replace("}else if(m?.status==='completed'){visual=chapterFor(m.targetInstanceId,s);motionKey=''}\n   else if(m?.status==='cancelled'){motionKey=''}\n   else{motionKey='';visual=media.matches?chapterFor(s?.reading?.activeInstanceId,s):phaseForReading(s)}", """}else if(m?.status==='completed'){
    visual=chapterFor(m.targetInstanceId,s);motionKey='';manualOffset=0;
    measuredKnots[root.clientWidth<700?'mobile':'desktop'].set(Math.round(visual),clamp(s?.reading?.progress||0));
   }else if(m?.status==='cancelled'){
    if(previousStatus==='running'){manualOffset=visual-phaseForReading(s);manualOrigin=s?.reading?.progress||0}motionKey='';
   }else{
    const p=s?.reading?.progress||0,base=phaseForReading(s);
    if(previousStatus==='running'){manualOffset=visual-base;manualOrigin=p}
    motionKey='';visual=media.matches?chapterFor(s?.reading?.activeInstanceId,s):clamp(base+manualOffset*(1-smooth(0,.055,Math.abs(p-manualOrigin))),0,6);
   }
   previousStatus=m?.status||'';""")
s=s.replace("root.dataset.motionProgress=m?String(m.progress):'';root.dataset.reading", "root.dataset.motionProgress=m?String(m.progress):'';root.dataset.motionStatus=m?.status||'manual';root.dataset.scrollTop=m?String(m.scrollTop):'';root.dataset.paperPhase=paperPhase.toFixed(5);root.dataset.reading")
p.write_text(s,encoding='utf-8')
review=base/'authoring/review-u03.cjs'
review.write_text(review.read_text(encoding='utf-8-sig').replace("page.locator('[data-method=", "page.locator('button[data-method="),encoding='utf-8')
print('Updated composition, calibration, continuous interruption and reusable scratch canvases.')
