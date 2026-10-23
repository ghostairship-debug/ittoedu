/* Formal visual slot. Measures only its own Source projection through the host viewport port.
   Positioned over the native photograph inside its existing Flow parent; no scroll owner or host DOM access. */
export default {
 mount(c){
  const root=c.root,port=c.teacherController,win=root.ownerDocument.defaultView;
  let instance=c.instance,dead=false,last='',offLayout,offTeacher;
  root.style.cssText='display:block;width:100%;pointer-events:none;overflow:hidden';root.setAttribute('aria-hidden','true');
  function report(){
   if(dead||!port)return;const view=port.viewportBounds?.(),layout=c.layout?.read();
   if(!view||!layout)return;const vw=view.right-view.left,vh=view.bottom-view.top;if(vw<1||vh<1)return;
   const curve=instance.data.heightCurve||[150,0,150,150];
   const height=Math.max(curve[0],Math.min(curve[3],curve[1]*vw+curve[2]));
   root.style.height=height+'px';
   if(layout.mode==='flow-content')c.layout.reportSize({inlineSize:layout.inlineSize,blockSize:height});
   const r=root.getBoundingClientRect(),fact={key:instance.data.slot,nativeId:instance.data.nativeId,x:(r.left-view.left)/vw,y:(r.top-view.top)/vh,w:r.width/vw,h:height/vh,viewportRatio:vw/vh,reading:port.read().reading?.progress||0};
   const sig=JSON.stringify(fact);if(sig===last)return;last=sig;root.dataset.coffeeSlot=instance.data.slot;root.dataset.geometry=sig;
   c.scope.state.set('coffee.v08.slot.'+instance.data.slot,fact);
  }
  offTeacher=port?.subscribe(report);offLayout=c.layout?.subscribe(report);report();
  const dispose=()=>{if(dead)return;dead=true;offTeacher?.();offLayout?.();c.scope.state.set('coffee.v08.slot.'+instance.data.slot,null)};
  c.scope.cleanup(dispose);return{update(next){instance=next;last='';report()},resume(){last='';report()},dispose};
 }
};
