'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('@playwright/test');
const base=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:800,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://coffee-art.local/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/probe.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});const f=path.join(base,decodeURIComponent(u.pathname));return route.fulfill({status:fs.existsSync(f)?200:404,body:fs.existsSync(f)?fs.readFileSync(f):'missing',contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.webp')?'image/webp':'text/html'})});
 await page.goto('http://coffee-art.local/probe.html');
 const result=await page.evaluate(async()=>{
  const {createCoffeeRenderer,default:module}=await import('/background-runtime.js');
  const urls=Object.fromEntries(['cup','cherry','section','green','gold','roast'].map(k=>[k,'/assets/runtime/'+k+'.webp']));
  const canvas=document.createElement('canvas');canvas.style.cssText='width:420px;height:420px';document.body.append(canvas);
  let ready;const loaded=new Promise(r=>ready=r),renderer=createCoffeeRenderer(canvas,urls,()=>{if(renderer.ready()===6)ready()});await loaded;
  const opts={width:420,height:420,centered:true,paperPhase:2};
  const pixels=p=>{renderer.draw(p,opts);return canvas.getContext('2d').getImageData(0,0,420,420).data};
  const diff=(a,b)=>{let sum=0,count=0,max=0;for(let i=0;i<a.length;i+=4){let d=0;for(let j=0;j<3;j++){const x=Math.abs(a[i+j]-b[i+j]);sum+=x;d=Math.max(d,x);max=Math.max(max,x)}if(d>10)count++}return{meanChannelDifference:sum/(a.length/4*3),pixelsOver10:count,maxChannelDifference:max}};
  const joins=[];for(let i=1;i<6;i++)joins.push({phase:i,...diff(pixels(i-.00001),pixels(i+.00001))});
  const determinism=[];for(const p of [.33,1.43,2.51,3.66,4.35,5.56]){const a=pixels(p);pixels(5.93-p*.23);const b=pixels(p);determinism.push({phase:p,...diff(a,b)})}
  const timings=[];for(let i=0;i<=120;i++){const t=performance.now();renderer.draw(i/20,opts);timings.push(performance.now()-t)}
  const mobileGuard=[];for(const phase of [2,3,4,5]){
   canvas.style.width='390px';canvas.style.height='844px';renderer.draw(phase,{width:390,height:844});const guarded=canvas.getContext('2d').getImageData(0,0,390,844).data;
   renderer.draw(phase,{width:390,height:844,stages:Array.from({length:7},()=>({opacity:0}))});const paper=canvas.getContext('2d').getImageData(0,0,390,844).data;
   let protectedMaximum=0,railMaximum=0;for(let y=0;y<844;y++)for(let x=0;x<390;x++){const i=(y*390+x)*4;for(let c=0;c<3;c++){const d=Math.abs(guarded[i+c]-paper[i+c]);if(x<336)protectedMaximum=Math.max(protectedMaximum,d);else railMaximum=Math.max(railMaximum,d)}}mobileGuard.push({phase,protectedMaximum,railMaximum});
  }
  renderer.dispose();canvas.remove();
  const root=document.createElement('div');root.style.cssText='width:700px;height:700px';document.body.append(root);
  const chapters=Array.from({length:7},(_,i)=>({targetId:'chapter-'+i}));let state={locationId:'flow',scenes:[{id:'flow',targets:chapters.map(x=>({id:x.targetId}))}],reading:{activeInstanceId:'chapter-0',progress:.015,containerId:'flow'}},listeners=new Set(),cleanup;
  const port={read:()=>state,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)}};
  const mounted=module.mount({root,instance:{data:{assets:urls,chapters}},teacherController:port,resources:{url:v=>v},scope:{cleanup:f=>{cleanup=f}}});
  await new Promise(resolve=>setTimeout(resolve,100));
  const tickBefore=root.dataset.tick;await new Promise(resolve=>setTimeout(resolve,180));const idleStable=root.dataset.tick===tickBefore;
  const connected=listeners.size;mounted.suspend();const suspendedListeners=listeners.size,suspendedTick=root.dataset.tick;
  state={...state,reading:{...state.reading,activeInstanceId:'chapter-4',progress:.627},flowMotion:{containerId:'flow',id:1,status:'completed',targetInstanceId:'chapter-4',progress:1}};for(const f of listeners)f();const suspendedStable=root.dataset.tick===suspendedTick;
  mounted.resume();const resumedPhase=Number(root.dataset.phase),resumedListeners=listeners.size;
  mounted.dispose();cleanup();const disposedListeners=listeners.size,disposedChildren=root.childElementCount;root.remove();
  timings.sort((a,b)=>a-b);
  return{joins,determinism,mobileGuard,timing:{samples:timings.length,medianMs:timings[Math.floor(timings.length/2)],p95Ms:timings[Math.floor(timings.length*.95)],maxMs:timings.at(-1),canvas:'420x420, DPR1, component-only'},lifecycle:{idleStable,connected,suspendedListeners,suspendedStable,resumedPhase,resumedListeners,disposedListeners,disposedChildren}};
 });
 fs.writeFileSync(path.join(base,'evidence/material-continuity.json'),JSON.stringify({result,errors},null,2));
 console.log(JSON.stringify({result,errors},null,2));
 assert.equal(errors.length,0);for(const j of result.joins)assert(j.meanChannelDifference<.3,'Visible join at '+j.phase);for(const d of result.determinism)assert.equal(d.maxChannelDifference,0,'Determinism '+d.phase);
 assert(result.lifecycle.idleStable&&result.lifecycle.suspendedStable);assert.equal(result.lifecycle.resumedPhase,4);assert.equal(result.lifecycle.disposedListeners,0);assert.equal(result.lifecycle.disposedChildren,0);
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});