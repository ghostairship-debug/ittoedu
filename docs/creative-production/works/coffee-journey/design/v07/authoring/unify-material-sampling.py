from pathlib import Path
p=Path(__file__).resolve().parent.parent/'background-runtime.js'
s=p.read_text(encoding='utf-8')
s=s.replace("const scratch=key=>{const c=cache[key]||(cache[key]=make()),", "const scratch=(key,w=560,h=560)=>{const c=cache[key]||(cache[key]=make(w,h)),")
a=s.index('  if(p<1)cupToCherry(g,p);');b=s.index('  g.restore();return',a)
s=s[:a]+'''  // Every material path is rasterized on the same registered grid before camera
  // transforms. Crossfade entry/exit cannot change texture resampling or edge alpha.
  const object=scratch('subject-composite',960,960),o=object.getContext('2d');o.setTransform(2,0,0,2,480,480);
  if(p<1)cupToCherry(o,p);
  else if(p<2)fruitToSeeds(o,p-1);
  else if(p<3)seedsToGreen(o,p-2);
  else if(p<4)roastedBean(o,p-3);
  else if(p<5)beanToSolution(o,p-4);
  else solutionToCup(o,p-5);
  g.drawImage(object,-240,-240,480,480);
'''+s[b:]
p.write_text(s,encoding='utf-8')
print('All shapes use one registered subject-compositing grid.')