import type { TeacherControllerAction, TeacherControllerSnapshot } from '../../../shared/contracts/component-platform/teacherController'

/** Serializable bridge helper: the same code binds real controls in native and isolated content realms. */
export function createNavigationControlBinder(options: {
  root: HTMLElement
  live(): boolean
  read(): TeacherControllerSnapshot
  canExecute(action: TeacherControllerAction): boolean
  execute(action: TeacherControllerAction): Promise<boolean>
  report(id: number, action: TeacherControllerAction, visible: boolean): void
  remove(id: number): void
  error?(message: string): void
}) {
  const root=options.root,doc=root.ownerDocument,win=doc.defaultView!
  let sequence=0,frame=0,disposed=false,dialog:HTMLDialogElement|undefined
  const entries=new Map<number,{element:HTMLElement;action:TeacherControllerAction;previous?:boolean;click():void}>()
  const owns=(element:HTMLElement)=>{let node:Node|null=element;const visited=new Set<Node>();while(node&&!visited.has(node)){if(node===root||root.contains(node))return true;visited.add(node);node=(node.getRootNode() as ShadowRoot).host??null}return false}
  const visible=(element:HTMLElement)=>{
    if(!options.live()||!owns(element)||!element.isConnected)return false
    for(let current:HTMLElement|null=element;current;current=current.parentElement??((current.getRootNode() as ShadowRoot).host as HTMLElement|undefined)??null){
      const style=win.getComputedStyle(current)
      if(current.hidden||current.inert||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false
    }
    const rect=element.getBoundingClientRect()
    return rect.width>0&&rect.height>0
  }
  const flush=()=>{frame=0;if(disposed)return;for(const [id,entry] of entries){const shown=visible(entry.element);if(entry.previous!==shown){entry.previous=shown;options.report(id,entry.action,shown)}}}
  const refresh=()=>{if(!frame&&!disposed)frame=win.requestAnimationFrame(flush)}
  const close=()=>{dialog?.close();dialog?.remove();dialog=undefined}
  const directory=()=>{
    close();dialog=doc.createElement('dialog');dialog.setAttribute('aria-label','作品目录')
    Object.assign(dialog.style,{padding:'16px',maxWidth:'min(440px,90vw)',maxHeight:'80vh',overflow:'auto',border:'1px solid #bbb',borderRadius:'12px'})
    const heading=doc.createElement('h2');heading.textContent='作品目录';heading.style.fontSize='18px';dialog.append(heading)
    for(const scene of options.read().scenes){
      const targets=[{name:scene.name,action:{type:'scene.go' as const,sceneId:scene.id}},...(scene.targets??[])]
      for(const target of targets){
        const button=doc.createElement('button');button.type='button';button.textContent=target.name
        Object.assign(button.style,{display:'block',width:'100%',textAlign:'left',padding:'10px',margin:'3px 0'})
        button.disabled=!options.canExecute(target.action)
        button.onclick=()=>{if(options.live()&&options.canExecute(target.action))void options.execute(target.action).then(ok=>{if(ok)close()},error=>options.error?.(String(error)))}
        dialog.append(button)
      }
    }
    const done=doc.createElement('button');done.type='button';done.textContent='关闭目录';done.onclick=close;dialog.append(done)
    root.append(dialog);dialog.addEventListener('cancel',close,{once:true});dialog.showModal()
  }
  const observer=new win.MutationObserver(refresh)
  observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','style','class']})
  const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(refresh):undefined
  resize?.observe(root);win.addEventListener('resize',refresh);doc.addEventListener('scroll',refresh,true)
  const bind=(element:HTMLElement,action:TeacherControllerAction)=>{
    if(disposed||!owns(element))throw new Error('导航按钮必须位于当前组件内容中')
    const tree=element.getRootNode();if(tree!==doc)observer.observe(tree,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','style','class']})
    const id=++sequence
    const entry={element,action:structuredClone(action),previous:undefined as boolean|undefined,click:()=>{
      if(!options.live()||element.matches(':disabled')||element.getAttribute('aria-disabled')==='true')return
      if(action.type==='scene.open-picker'){directory();return}
      if(options.canExecute(action))void options.execute(action).catch(error=>options.error?.(String(error)))
    }}
    entries.set(id,entry);element.addEventListener('click',entry.click);resize?.observe(element)
    // A synchronous rerender replaces old controls in one turn; do not publish an empty frame before the new bindings exist.
    entry.previous=visible(element);options.report(id,entry.action,entry.previous);refresh()
    return ()=>{if(!entries.delete(id))return;element.removeEventListener('click',entry.click);resize?.unobserve(element);options.remove(id)}
  }
  return {bind,refresh,dispose(){if(disposed)return;disposed=true;close();observer.disconnect();resize?.disconnect();if(frame)win.cancelAnimationFrame(frame);win.removeEventListener('resize',refresh);doc.removeEventListener('scroll',refresh,true);for(const [id,entry] of entries){entry.element.removeEventListener('click',entry.click);options.remove(id)}entries.clear()}}
}
