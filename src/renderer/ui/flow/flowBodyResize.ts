export interface FlowBodyResizePorts<T> {
 enabled():boolean
 wrap():'none'|'left'|'right'
 widthPercent():number
 begin():Promise<T>
 preview(value:number|undefined):void
 commit(value:number,target:T):Promise<void>
 report(message:string):void
}
/** A DOM handle for a formal Flow allocation; pointer preview never writes author data. */
export function mountFlowBodyResize<T>(shell:HTMLElement,ports:FlowBodyResizePorts<T>) {
 const doc=shell.ownerDocument,win=doc.defaultView!,button=doc.createElement('button')
 button.type='button';button.dataset.flowBodyResize='';button.dataset.componentProfessionalEditor='flow-width'
 button.setAttribute('aria-label','拖动调整正文占宽');button.title='拖动调整正文占宽；方向键微调，Esc取消'
 Object.assign(button.style,{position:'absolute',top:'50%',width:'12px',height:'34px',padding:'0',border:'2px solid white',borderRadius:'6px',background:'#2563eb',boxShadow:'0 0 0 1px #2563eb',cursor:'ew-resize',zIndex:'8',touchAction:'none',transform:'translateY(-50%)'})
 shell.append(button)
 let disposed=false,pending=false
 let gesture:{id:number;start:number;value:number;initial:number;lane:number;scale:number;direction:number;target?:T;ended:boolean;cancel:boolean}|undefined
 const sync=()=>{const left=ports.wrap()==='right';button.style.left=left?'-6px':'';button.style.right=left?'':'-6px';button.disabled=!ports.enabled();button.setAttribute('aria-valuenow',String(Math.round(ports.widthPercent())))}
 const finish=async()=>{
   const current=gesture;if(!current||current.target===undefined||!current.ended)return
   gesture=undefined
   try{if(!current.cancel&&Math.abs(current.value-current.initial)>.01)await ports.commit(current.value,current.target)}catch(error){ports.report(String(error))}
   finally{ports.preview(undefined);sync()}
 }
 const down=(event:PointerEvent)=>{
   if(event.button!==0||!ports.enabled()||pending||gesture)return
   event.preventDefault();event.stopPropagation()
   const lane=shell.parentElement?.getBoundingClientRect().width??0
   if(lane<=0)return
   const wrap=ports.wrap(),value=ports.widthPercent()
   const current={id:event.pointerId,start:event.clientX,value,initial:value,lane,scale:1,direction:wrap==='right'?-1:wrap==='none'?2:1,target:undefined as T|undefined,ended:false,cancel:false};gesture=current
   button.setPointerCapture(event.pointerId);pending=true
   void ports.begin().then(target=>{if(gesture!==current||disposed)return;current.target=target;void finish()},error=>{if(gesture===current){gesture=undefined;ports.preview(undefined);ports.report(String(error))}}).finally(()=>{pending=false})
 }
 const move=(event:PointerEvent)=>{
   const current=gesture;if(!current||current.id!==event.pointerId)return
   event.preventDefault();event.stopPropagation()
   current.value=Math.max(5,Math.min(100,current.initial+100*(event.clientX-current.start)*current.direction/current.lane))
   ports.preview(current.value);button.setAttribute('aria-valuenow',String(Math.round(current.value)))
 }
 const end=(event:PointerEvent)=>{const current=gesture;if(!current||current.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();if(event.type==='pointercancel')current.cancel=true;else move(event);current.ended=true;if(button.hasPointerCapture(event.pointerId))button.releasePointerCapture(event.pointerId);void finish()}
 const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&gesture){event.preventDefault();event.stopPropagation();gesture.cancel=true;gesture.ended=true;ports.preview(undefined);void finish();return}
   if(!['ArrowLeft','ArrowRight'].includes(event.key)||pending||gesture||!ports.enabled())return
   event.preventDefault();event.stopPropagation();pending=true
   const direction=(event.key==='ArrowRight'?1:-1)*(ports.wrap()==='right'?-1:1),value=Math.max(5,Math.min(100,ports.widthPercent()+direction*(event.shiftKey?5:1)))
   void ports.begin().then(target=>ports.commit(value,target)).catch(error=>ports.report(String(error))).finally(()=>{pending=false;sync()})
 }
 button.addEventListener('pointerdown',down);button.addEventListener('pointermove',move);button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);button.addEventListener('keydown',key)
 const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&gesture)key(event)};win.addEventListener('keydown',escape,true);sync()
 return {sync,destroy(){disposed=true;if(gesture){gesture.cancel=true;gesture=undefined;ports.preview(undefined)}win.removeEventListener('keydown',escape,true);button.remove();}}
}
