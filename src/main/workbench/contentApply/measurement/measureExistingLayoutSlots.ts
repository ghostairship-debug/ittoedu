import type {ExistingLayoutSlot} from '../../../../core/course/existingObjectLayout'
/** Host-only passive content injection. CSS in the temporary recipe cannot replace or format current author text. */
export async function installExistingLayoutSlots(slots:readonly ExistingLayoutSlot[],resourceUrls:Readonly<Record<string,string>>):Promise<void>{
 const replace=(value:string)=>value.replace(/cw-resource:([a-zA-Z0-9_.-]+)/g,(all,id)=>resourceUrls[id]??all)
 for(const slot of slots){
  const nodes=document.querySelectorAll<HTMLElement>('[data-layout-ref="'+slot.key+'"]');if(nodes.length!==1)throw Error('布局引用必须唯一：'+slot.key)
  const host=nodes[0]!,style=getComputedStyle(host)
  if(style.display==='contents'||style.position==='fixed')throw Error('布局对象需要稳定可见的盒子')
  host.style.setProperty('box-sizing','border-box','important');host.style.setProperty('padding','0','important');host.style.setProperty('border','0','important')
  host.style.setProperty('min-width','0','important');host.style.setProperty('font','initial','important')
  const shadow=host.attachShadow({mode:'open'})
  const content=document.createElement('div');content.style.cssText='box-sizing:border-box;display:block;width:100%;min-width:0;position:relative;color:initial;font:initial;'
  for(const [key,value]of Object.entries(slot.style)){
   const css=key.startsWith('--')?key:key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())
   if(!/^(position|inset|top|left|right|bottom|width|height|min-|max-|margin|transform|translate|rotate|scale|zoom|display|flex|grid|order)/.test(css))content.style.setProperty(css,replace(value))
  }
  if(slot.kind==='text'){
   content.innerHTML=replace(slot.html)
   const body=content.firstElementChild as HTMLElement|undefined
   if(body&&slot.autoHeight)body.style.height='auto'
   if(!slot.autoHeight){host.style.minHeight=slot.height+'px';content.style.height='100%'}
  }else{
   // Bounded Runtime/table/chart geometry is known; no script is invoked just to learn its author box.
   content.style.aspectRatio=slot.width+'/'+slot.height;content.style.minHeight='1px'
   if(!host.style.height)host.style.aspectRatio=slot.width+'/'+slot.height
  }
  shadow.append(content)
 }
 if(document.fonts)await document.fonts.ready
 await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
}
