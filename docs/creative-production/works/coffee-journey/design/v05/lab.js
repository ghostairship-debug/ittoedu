(()=>{'use strict';
const data=window.COFFEE,root=document.querySelector('[data-process-lab]');
function report(){if(parent!==window)parent.postMessage({type:'coffee:height',height:Math.ceil(document.body.scrollHeight)},'*');}
const observer=new ResizeObserver(()=>requestAnimationFrame(report));observer.observe(document.body);addEventListener('load',report);document.fonts.ready.then(report);
if(root){
  let selected='natural';const buttons=[...root.querySelectorAll('[data-method]')],images=[...root.querySelectorAll('.specimen-image')];
  const title=root.querySelector('[data-method-title]'),copy=root.querySelector('[data-method-copy]'),short=root.querySelector('[data-short]'),num=root.querySelector('[data-number]'),diagram=root.querySelector('[data-layer-image]'),layers=root.querySelector('[data-layers]'),steps=root.querySelector('[data-steps]'),note=root.querySelector('[data-note]'),detail=root.querySelector('[data-detail-panel]'),detailButton=root.querySelector('[data-detail]'),compareButton=root.querySelector('[data-compare-button]');
  function select(id){const m=data.methods.find(m=>m.id===id);if(!m)return;selected=id;root.dataset.method=id;for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.method===id));for(const im of images){im.dataset.active=String(im.dataset.id===id);im.setAttribute('aria-hidden',String(im.dataset.id!==id));}title.textContent=m.title;copy.textContent=m.copy;short.textContent=m.short;num.textContent=m.no;diagram.src=root.querySelector('[data-layer-resource="'+m.id+'"]').getAttribute('src');diagram.alt=m.name+'的组织去留示意';layers.replaceChildren(...m.layers.map((state,i)=>{const li=document.createElement('li');for(const t of [String(i+1).padStart(2,'0'),['果皮与果肉','黏液层','羊皮层','种子'][i],state]){const span=document.createElement('span');span.textContent=t;li.append(span)}return li}));steps.replaceChildren(...m.steps.map(t=>{const li=document.createElement('li');li.textContent=t;return li}));note.textContent=m.note;root.querySelector('[data-process-live]').textContent=m.name+'：'+m.short;report();}
  buttons.forEach((b,i)=>{b.addEventListener('click',()=>select(b.dataset.method));b.addEventListener('keydown',e=>{let n;if(e.key==='ArrowRight'||e.key==='ArrowDown')n=(i+1)%buttons.length;else if(e.key==='ArrowLeft'||e.key==='ArrowUp')n=(i+buttons.length-1)%buttons.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=buttons.length-1;else return;e.preventDefault();buttons[n].focus();select(buttons[n].dataset.method)})});
  detailButton.addEventListener('click',()=>{const open=detail.dataset.open!=='true';detail.dataset.open=String(open);detailButton.setAttribute('aria-expanded',String(open));detailButton.textContent=open?'收起组织与步骤 −':'看留下的层 ＋';report()});
  function revealStart(){window.scrollTo({top:0,behavior:'instant'});if(parent!==window)parent.postMessage({type:'coffee:reveal'},'*');}
  compareButton.addEventListener('click',()=>{root.dataset.compare='true';root.querySelector('[data-compare-close]').focus({preventScroll:true});report();revealStart()});
  root.querySelector('[data-compare-close]').addEventListener('click',()=>{root.dataset.compare='false';compareButton.focus({preventScroll:true});report();revealStart()});
  select(selected);
}
const roast=document.querySelector('[data-roast-lab]');
if(roast){
  const range=roast.querySelector('input[type="range"]'),presets=[...roast.querySelectorAll('[data-roast-value]')],photos=[...roast.querySelectorAll('.roast-image')],play=roast.querySelector('[data-play]'),view=roast.querySelector('[data-roast-view]'),zoom=roast.querySelector('button[data-zoom]');let value=0,raf=0,playing=false,start=0,from=0,visible=true,lastPhase=-1;
  function set(v){value=Math.max(0,Math.min(100,Number(v)));range.value=String(value);const x=value/50;const mix=x<=1?[1,x,0]:[0,1,x-1];photos.forEach((im,i)=>im.style.opacity=String(mix[i]));const phase=value<30?0:value<75?1:2;roast.dataset.phase=data.roast[phase].id;for(const b of presets)b.setAttribute('aria-pressed',String(Number(b.dataset.roastValue)===[0,50,100][phase]));const r=data.roast[phase];range.setAttribute('aria-valuetext',Math.round(value)+'%，'+r.name);if(phase!==lastPhase){roast.querySelector('[data-roast-number]').textContent=r.no+' / '+r.name;roast.querySelector('[data-roast-title]').textContent=r.title;roast.querySelector('[data-roast-copy]').textContent=r.copy;lastPhase=phase;report()}}
  function stop(){playing=false;cancelAnimationFrame(raf);raf=0;play.textContent='自动走一遍 →';play.setAttribute('aria-pressed','false')}
  function tick(now){if(!playing||!visible||document.hidden){stop();return}set(from+(100-from)*Math.min(1,(now-start)/14000));if(value>=100){stop();return}raf=requestAnimationFrame(tick)}
  range.addEventListener('input',()=>{stop();set(range.value)});
  presets.forEach(b=>b.addEventListener('click',()=>{stop();set(b.dataset.roastValue)}));
  play.addEventListener('click',()=>{if(playing){stop();return}if(value>=98)set(0);from=value;start=performance.now();playing=true;play.textContent='暂停 Ⅱ';play.setAttribute('aria-pressed','true');raf=requestAnimationFrame(tick)});
  function setZoom(v){view.dataset.zoom=String(v);zoom.setAttribute('aria-pressed',String(v));zoom.textContent=v?'回到全貌 −':'近看纹理 ＋';view.style.setProperty('--pan-x','0%');view.style.setProperty('--pan-y','0%')}
  zoom.addEventListener('click',()=>setZoom(view.dataset.zoom!=='true'));
  view.addEventListener('pointermove',e=>{if(view.dataset.zoom!=='true'||e.pointerType==='touch')return;const box=view.getBoundingClientRect();view.style.setProperty('--pan-x',((.5-(e.clientX-box.left)/box.width)*13).toFixed(2)+'%');view.style.setProperty('--pan-y',((.5-(e.clientY-box.top)/box.height)*13).toFixed(2)+'%')});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&view.dataset.zoom==='true'){setZoom(false);zoom.focus()}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
  const seen=new IntersectionObserver(es=>{visible=es[0].isIntersecting;if(!visible)stop()},{threshold:.05});seen.observe(roast);
  addEventListener('pagehide',()=>{stop();seen.disconnect();observer.disconnect()},{once:true});set(0);
}
})();
