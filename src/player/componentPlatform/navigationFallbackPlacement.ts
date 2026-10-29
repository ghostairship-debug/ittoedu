export interface NavigationRect {left:number;top:number;right:number;bottom:number}
const overlap=(a:NavigationRect,b:NavigationRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top
/** Use existing empty host/paint space; never resize the content or cover visible reading/interactive content. */
export function navigationFallbackRect(host:NavigationRect,width:number,height:number,protectedRects:readonly NavigationRect[]):NavigationRect|null {
  const gap=8,candidates:NavigationRect[]=[]
  const xs=[host.right-width-gap,host.left+(host.right-host.left-width)/2,host.left+gap]
  const ys=[host.bottom-height-gap,host.top+gap]
  for(const y of ys)for(const x of xs)candidates.push({left:x,top:y,right:x+width,bottom:y+height})
  for(const x of [host.right-width-gap,host.left+gap])for(let y=host.top+height+gap;y+height<host.bottom-gap;y+=height+gap)candidates.push({left:x,top:y,right:x+width,bottom:y+height})
  return candidates.find(rect=>rect.left>=host.left&&rect.top>=host.top&&rect.right<=host.right&&rect.bottom<=host.bottom
    && !protectedRects.some(other=>overlap(rect,{left:other.left-4,top:other.top-4,right:other.right+4,bottom:other.bottom+4})))??null
}
export function navigationProtectedRects(root:HTMLElement):NavigationRect[]{
  const result:NavigationRect[]=[]
  const visit=(scope:ParentNode)=>{
    const elements=scope.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th,img,video,audio,canvas,iframe,svg,button,input,textarea,select,a,[role="button"],[data-guoling-node-click]')
    for(const element of elements){
      if(element.closest('[data-playback-chrome],[data-flow-toc-host],[data-testid="flow-runtime-toc-drawer"],[data-testid="flow-runtime-toc-toggle"]'))continue
      const style=element.ownerDocument.defaultView?.getComputedStyle(element)
      if(style?.display==='none'||style?.visibility==='hidden'||style?.opacity==='0')continue
      const box=element.getBoundingClientRect();if(box.width>0&&box.height>0)result.push({left:box.left,top:box.top,right:box.right,bottom:box.bottom})
    }
    for(const element of scope.querySelectorAll('*'))if(element.shadowRoot)visit(element.shadowRoot)
  }
  visit(root);return result
}
