'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{build}=require('esbuild'),{chromium}=require('@playwright/test');
const base=path.resolve(__dirname,'..');
(async()=>{
 const original=fs.readFileSync(path.join(base,'art-studies.html'),'utf8');let js=original.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 const assets=Object.fromEntries(['cup','cherry','section','green','gold','roast'].map(k=>[k,'data:image/webp;base64,'+fs.readFileSync(path.join(base,'assets/runtime',k+'.webp')).toString('base64')]));
 js=js.replace("const assets=Object.fromEntries(['cup','cherry','section','green','gold','roast'].map(k=>[k,'./assets/runtime/'+k+'.webp']));",'const assets='+JSON.stringify(assets)+';');
 js=js.replace('full.draw(p,{width:innerWidth,height:innerHeight-84});','full.draw(p,{width:innerWidth,height:innerHeight-84,centered:true});');
 js+=`\nlet playback=0,origin=0,initial=0;const play=document.getElementById('play');function stop(){cancelAnimationFrame(playback);playback=0;play.textContent='连续观看'}function animate(now){const p=(initial+(now-origin)/4200)%6;window.art.set(p);playback=requestAnimationFrame(animate)}play.onclick=()=>{if(playback){stop();return}document.body.classList.add('full');initial=Number(document.getElementById('phase').value);origin=performance.now();play.textContent='暂停';playback=requestAnimationFrame(animate)};document.getElementById('phase').addEventListener('input',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});\n`;
 const compiled=await build({stdin:{contents:js,resolveDir:base,loader:'js'},bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',minify:false});
 let html=original.replace('<button id="toggle">单帧 / 联系表</button>','<button id="toggle">单帧 / 联系表</button><button id="play">连续观看</button>');
 html=html.replace(/<script type="module">[\s\S]*?<\/script>/,'<script>'+compiled.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script>');
 fs.writeFileSync(path.join(base,'art-studies-offline.html'),html);
 const data=JSON.parse(fs.readFileSync(path.join(base,'evidence/final-motion-frames.json'),'utf8'));
 const sections=data.map(record=>`<section data-width="${record.width}"><h2>${record.width}px · 正式导出的真实导航</h2><div class="grid">${record.transitions.map(t=>t.samples.filter(s=>s.file).map(s=>`<figure><img src="motion/${s.file}" loading="eager"><figcaption>U0${t.from} → U0${t.to} · ${Math.round(s.requested*100)}%<br>实际进度 ${s.progress.toFixed(3)} · 形态 ${s.phase.toFixed(3)} · 滚动 ${Math.round(s.scrollTop)} px</figcaption></figure>`).join('')).join('')}</div></section>`).join('');
 fs.writeFileSync(path.join(base,'previews/MOTION_REVIEW.html'),'<!doctype html><html lang="zh"><meta charset="utf-8"><title>v07 · 真实转场审片</title><style>body{margin:0;padding:24px;background:#eeeade;color:#243225;font:13px system-ui}h1{font-size:26px}h2{margin:28px 0 16px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}figure{margin:0;background:#fff;padding:4px}img{display:block;width:100%;height:auto}figcaption{padding:8px;line-height:1.6}section{margin-bottom:30px}p{max-width:1000px;line-height:1.8}</style><h1>《一杯咖啡的远行》v07 · 真实转场审片</h1><p>截图来自正式单文件离线作品，由软件自身 Flow 导航驱动。每段保留起点、25%、50%、75%、终点；指标仅辅助核对，实际观看以画面为准。材料中心视图见上一级 art-studies-offline.html。</p>'+sections+'</html>');
 const browser=await chromium.launch();try{
  const ctx=await browser.newContext({viewport:{width:1800,height:1200},offline:true}),page=await ctx.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
  await page.goto(pathToFileURL(path.join(base,'art-studies-offline.html')).href);await page.waitForFunction(()=>window.art?.renderers.every(r=>r.ready()===6));await page.screenshot({path:path.join(base,'previews/material-reference-final.png'),fullPage:true});
  await page.locator('#play').click();await page.waitForTimeout(180);await page.locator('#play').click();const value=await page.locator('#phase').inputValue();
  await page.goto(pathToFileURL(path.join(base,'previews/MOTION_REVIEW.html')).href);await page.waitForFunction(()=>[...document.images].every(x=>x.complete&&x.naturalWidth));
  for(const width of [1440,390]){const section=page.locator(`section[data-width="${width}"]`);if(await section.count())await section.screenshot({path:path.join(base,'previews',`motion-contact-${width}.png`)});}
  fs.writeFileSync(path.join(base,'evidence/reference-package.json'),JSON.stringify({materialFrames:30,actualNavigationFrames:data.reduce((n,r)=>n+r.transitions.flatMap(t=>t.samples).filter(s=>s.file).length,0),offline:true,continuousPlaybackValue:value,errors,httpRequests:requests},null,2));
  console.log('REFERENCE_PACKAGE',JSON.stringify({materialFrames:30,widths:data.map(x=>x.width),errors,requests}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});