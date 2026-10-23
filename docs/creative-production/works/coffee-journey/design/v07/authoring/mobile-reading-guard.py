from pathlib import Path
p=Path(__file__).resolve().parent.parent/'background-runtime.js'
s=p.read_text(encoding='utf-8')
s=s.replace("const c=cache[key]||(cache[key]=make(w,h)),cg=c.getContext('2d');", "const c=cache[key]||(cache[key]=make(w,h));if(c.width!==w||c.height!==h){c.width=w;c.height=h}const cg=c.getContext('2d');")
s=s.replace("  g.drawImage(object,-240,-240,480,480);\n  g.restore();return", """  if(mobile&&!options.centered&&options.readingGuard!==false){
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
  g.restore();return""")
s=s.replace("root.dataset.size=root.clientWidth+'x'+root.clientHeight;", "root.dataset.size=root.clientWidth+'x'+root.clientHeight;root.dataset.readingGuard=root.clientWidth<700?'edge-rail':'negative-space';")
assert 'mobile-reading-rail' in s
p.write_text(s,encoding='utf-8')
print('Mobile material rail protects the full-width reading column without changing assets or motion.')