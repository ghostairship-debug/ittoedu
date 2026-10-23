'use strict';
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('@playwright/test');
const base=path.resolve(__dirname,'..'),names=['cup','cherry','section','green','gold','roast'];
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const input=Object.fromEntries(names.map(k=>[k,'data:image/png;base64,'+fs.readFileSync(path.join(base,'assets/source',k+'.png')).toString('base64')]));
  const result=await page.evaluate(async input=>{
   const size=1254,images={},prepared={},transforms={};
   const make=(n=size)=>{const c=document.createElement('canvas');c.width=c.height=n;return c};
   const bbox=(data,w)=>{let x0=w,y0=w,x1=0,y1=0;for(let y=0;y<w;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>32){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}return{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1}};
   for(const key of ['green','gold','roast','cup','cherry','section']){
    const im=new Image();im.src=input[key];await im.decode();const c=make(),g=c.getContext('2d');g.drawImage(im,0,0,size,size);
    const pixels=g.getImageData(0,0,size,size);for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=Math.max(0,Math.round((pixels.data[i]-8)*255/247));g.putImageData(pixels,0,0);
    const box=bbox(pixels.data,size);let aligned=c,transform={x:0,y:0,sx:1,sy:1,box};
    if(key==='gold'||key==='roast'){
     const ref=transforms.green.box;aligned=make();const a=aligned.getContext('2d'),sx=ref.w/box.w,sy=ref.h/box.h,x=ref.x-box.x*sx,y=ref.y-box.y*sy;
     a.drawImage(c,x,y,size*sx,size*sy);transform={x,y,sx,sy,box,reference:ref};
    }
    transforms[key]=transform;images[key]=aligned;
    const small=make(900);small.getContext('2d').drawImage(aligned,0,0,900,900);prepared[key]=small.toDataURL('image/webp',.94);
   }
   const seedLeft='M -1 -45 C -14 -61 -39 -57 -49 -32 C -66 6 -58 48 -40 69 C -27 87 -5 86 0 66 C 5 38 5 -22 -1 -45 Z';
   const seedRight='M 14 -45 C 28 -60 43 -52 52 -31 C 66 6 66 44 53 67 C 44 86 22 89 14 67 C 9 34 8 -21 14 -45 Z';
   const seeds=new Path2D(seedLeft+' '+seedRight),diagrams={};
   for(const mode of ['natural','washed','honey']){
    const c=make(900),g=c.getContext('2d');g.scale(900/280,900/280);g.translate(140,140);g.drawImage(images.section,-140,-140,280,280);
    if(mode!=='natural'){
     const mask=make(900),m=mask.getContext('2d');m.scale(900/280,900/280);m.translate(140,140);m.lineWidth=mode==='washed'?3.8:11;m.lineJoin='round';m.fill(seeds);m.stroke(seeds);
     g.save();g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='destination-in';g.drawImage(mask,0,0);g.restore();
     if(mode==='honey'){
      g.save();g.globalCompositeOperation='source-atop';g.strokeStyle='rgba(173,115,37,.16)';g.lineWidth=9.5;g.stroke(seeds);g.restore();
     }
    }
    diagrams[mode]=c.toDataURL('image/webp',.95);
   }
   return{prepared,transforms,diagrams};
  },input);
  for(const [k,v]of Object.entries(result.prepared))fs.writeFileSync(path.join(base,'assets/runtime',k+'.webp'),Buffer.from(v.split(',')[1],'base64'));
  for(const [k,v]of Object.entries(result.diagrams))fs.writeFileSync(path.join(base,'programs/u03/assets',k+'-section.webp'),Buffer.from(v.split(',')[1],'base64'));
  const manifest=JSON.parse(fs.readFileSync(path.join(base,'assets/manifest.json'),'utf8'));
  manifest.preparation={date:new Date().toISOString(),alphaDustThreshold:8,roastRegistration:'alpha bounding-box affine registration to green, original PNGs unchanged',transforms:result.transforms,diagramScale:'all three 900px canvases share one crop and one seed geometry; tissue thickness is illustrative'};
  for(const k of names)manifest.assets[k].runtimeBytes=fs.statSync(path.join(base,'assets/runtime',k+'.webp')).size;
  fs.writeFileSync(path.join(base,'assets/manifest.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({runtimeAssets:6,scientificMaterials:3,transforms:result.transforms},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});