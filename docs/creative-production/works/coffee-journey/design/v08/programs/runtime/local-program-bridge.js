/* Adopts the existing authored HTML document. Its scripts retain interaction/state ownership.
   This adapter only publishes its own local visual anchors through the existing viewport/state ports. */
export default {
 document:'web',
 mount(c){
  const root=c.root,doc=root.ownerDocument,win=doc.defaultView,port=c.teacherController;
  let instance=c.instance,dead=false,last='',queued=false;
  const programSlots={'8bc2720a-0b46-439a-98c1-dc505b1cb456':'u03','aee929af-3338-409a-a386-bcbef0d0e285':'u05','8f45751d-9cc3-49dd-ba88-c645759f022c':'u06'};
  const key=()=>programSlots[instance.id]||'program';
  function geometry(){
   if(dead)return;const v=port?.viewportBounds?.();if(!v)return;const vw=v.right-v.left,vh=v.bottom-v.top;if(vw<=0||vh<=0)return;
   const main=doc.querySelector('[data-journey-anchor]')||doc.querySelector('.specimen-image[data-active="true"]')||doc.querySelector('[data-roast-stage]')||doc.querySelector('canvas');
   const local=typeof win.__coffeeJourneyAnchor==='function'?win.__coffeeJourneyAnchor():null;
   const r=local||main?.getBoundingClientRect();if(!r)return;
   const rw=r.width??r.w,rh=r.height??r.h,rx=r.left??r.x,ry=r.top??r.y;
   const read=port.read(),fact={key:key(),nativeId:instance.id,x:(rx-v.left)/vw,y:(ry-v.top)/vh,w:rw/vw,h:rh/vh,reading:read.reading?.progress||0,material:local?.material||main?.dataset?.process||key(),mode:local?.mode||'',value:Number(local?.value)||0};
   if(local?.liquid){const l=local.liquid;fact.liquid={x:((l.x??l.left)-v.left)/vw,y:((l.y??l.top)-v.top)/vh,w:(l.width??l.w)/vw,h:(l.height??l.h)/vh};}
   const sig=JSON.stringify(fact);if(sig!==last){last=sig;root.dataset.coffeeLocal=key();root.dataset.geometry=sig;c.scope.state.set('coffee.v08.slot.'+key(),fact)}
  }
  function size(){if(dead)return;const l=c.layout?.read();if(l?.mode==='flow-content'){const h=Math.max(root.scrollHeight,root.getBoundingClientRect().height);if(h>0)c.layout.reportSize({inlineSize:l.inlineSize,blockSize:h})}geometry()}
  function schedule(){if(queued||dead)return;queued=true;queueMicrotask(()=>{queued=false;size()})}
  function reveal(event){if(!event.target?.closest?.('[data-compare-button],[data-compare-close]'))return;queueMicrotask(()=>{size();const state=port.read(),command={type:'scene.go',sceneId:state.locationId,targetInstanceId:instance.id};root.dataset.revealAvailable=String(!!state.locationId&&port.canExecute(command));if(state.locationId&&port.canExecute(command))void port.execute(command);});}
  const offTeacher=port?.subscribe(geometry),offLayout=c.layout?.subscribe(schedule),offHandoff=c.scope.events.subscribe('coffee.v08.handoff',value=>{if(value&&value.slot===key())win.dispatchEvent(new win.CustomEvent('coffee:handoff',{detail:value}))});
  const resize=new win.ResizeObserver(schedule);resize.observe(root);root.addEventListener('load',schedule,true);win.addEventListener('coffee:layout',schedule);win.addEventListener('input',schedule);win.addEventListener('click',schedule);root.addEventListener('click',reveal);
  size();doc.fonts?.ready.then(schedule);
  const dispose=()=>{if(dead)return;dead=true;offTeacher?.();offLayout?.();offHandoff?.();resize.disconnect();root.removeEventListener('load',schedule,true);win.removeEventListener('coffee:layout',schedule);win.removeEventListener('input',schedule);win.removeEventListener('click',schedule);root.removeEventListener('click',reveal);c.scope.state.set('coffee.v08.slot.'+key(),null)};
  c.scope.cleanup(dispose);return{update(next){instance=next;last='';schedule()},resume(){schedule()},dispose};
 }
};
