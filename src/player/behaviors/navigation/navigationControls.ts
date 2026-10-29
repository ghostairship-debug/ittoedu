import type { TeacherControllerAction, TeacherControllerSnapshot } from '../../../shared/contracts/component-platform/teacherController'

export interface NavigationControlBinding {
  actions: readonly TeacherControllerAction[]
  /** Evaluated against the live mount; false when hidden, detached or retired. Disabled controls still convey a legitimate condition. */
  present(): boolean
}
export interface NavigationControlFacts { actions: readonly TeacherControllerAction[] }
/** Live registrations only. It stores no navigation position, chapter list, or author data. */
export class NavigationControlBindings {
  private bindings = new Set<{ binding: NavigationControlBinding; scope(): string | null | undefined }>()
  private listeners = new Set<() => void>()
  private queued = false
  private retired = false
  register(binding: NavigationControlBinding, scope: () => string | null | undefined = () => undefined): () => void {
    if(this.retired)return ()=>{}
    const entry={binding,scope};this.bindings.add(entry);this.changed()
    return ()=>{if(this.bindings.delete(entry))this.changed()}
  }
  read(scope?: string): NavigationControlFacts {
    const actions: TeacherControllerAction[]=[]
    for(const entry of this.bindings){
      const range=entry.scope()
      if(range===null || range!==undefined && range!==scope)continue
      try{if(entry.binding.present())actions.push(...entry.binding.actions)}catch{/* A failed mount supplies no controls. */}
    }
    return {actions}
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  changed=()=>{if(this.queued||this.retired)return;this.queued=true;queueMicrotask(()=>{this.queued=false;if(!this.retired)for(const listener of this.listeners)listener()})}
  dispose(){this.retired=true;this.bindings.clear();this.listeners.clear()}
}

/** Visible disabled controls are not replaced by unrestricted ones. */
export function navigationControlVisible(element: HTMLElement): boolean {
  if(!element.isConnected)return false
  for(let node:HTMLElement|null=element;node;){
    if(node.hidden || node.inert)return false
    const style=node.ownerDocument.defaultView?.getComputedStyle(node)
    if(style?.display==='none'||style?.visibility==='hidden'||style?.opacity==='0')return false
    const parent: HTMLElement | null = node.parentElement
    node=parent ?? ((node.getRootNode() as ShadowRoot).host as HTMLElement | undefined) ?? null
  }
  const rect=element.getBoundingClientRect()
  return rect.width>0 && rect.height>0
}

export interface NavigationCoverage {
  previous: boolean; next: boolean; directory: boolean
  needsPrevious: boolean; needsNext: boolean; needsDirectory: boolean
}
export function navigationCoverage(state: TeacherControllerSnapshot, facts: NavigationControlFacts): NavigationCoverage {
  const progress=state.progress,scene=state.scenes.find(scene=>scene.id===state.locationId)
  const natural=Boolean(state.reading),targets=scene?.targets ?? []
  const sceneIndex=progress?.sceneIndex ?? -1,stepIndex=progress?.stepIndex ?? 0,stepCount=progress?.stepCount ?? 1
  const needsPrevious=!natural && (sceneIndex>0||stepIndex>0) || natural && sceneIndex>0
  const needsNext=!natural && (sceneIndex>=0&&sceneIndex<state.scenes.length-1||stepIndex<stepCount-1) || natural && sceneIndex>=0&&sceneIndex<state.scenes.length-1
  const neededTargets=natural ? targets.map(t=>t.action) : state.scenes.map(s=>({type:'scene.go' as const,sceneId:s.id}))
  const wantsDirectory=neededTargets.length>1
  const same=(a:TeacherControllerAction,b:TeacherControllerAction)=>a.type==='scene.go'&&b.type==='scene.go'&&a.sceneId===b.sceneId&&a.targetStateId===b.targetStateId&&a.targetInstanceId===b.targetInstanceId
  const valid=(action:TeacherControllerAction)=>{
    if(action.containerId&&action.containerId!==state.locationId)return false
    if(action.type!=='scene.go')return true
    const targetScene=state.scenes.find(s=>s.id===action.sceneId)
    return Boolean(targetScene && (!action.targetStateId&&!action.targetInstanceId || targetScene.targets?.some(t=>same(t.action,action))))
  }
  const actions=facts.actions.filter(valid)
  const hasMaster=targets.some(target=>target.kind==='state')
  const previousTarget=stepIndex>0 ? hasMaster&&stepIndex===1 ? {type:'scene.go' as const,sceneId:state.locationId!} : targets[hasMaster?stepIndex-2:stepIndex-1]?.action : state.scenes[sceneIndex-1] ? {type:'scene.go' as const,sceneId:state.scenes[sceneIndex-1]!.id}:undefined
  const nextTarget=stepIndex<stepCount-1 ? targets[hasMaster?stepIndex:stepIndex+1]?.action : state.scenes[sceneIndex+1] ? {type:'scene.go' as const,sceneId:state.scenes[sceneIndex+1]!.id}:undefined
  const previous=actions.some(a=>a.type==='step.previous'||a.type==='scene.previous'&&(natural||stepIndex===0)||previousTarget&&same(a,previousTarget))
  const next=actions.some(a=>a.type==='step.next'||a.type==='scene.next'&&(natural||stepIndex>=stepCount-1)||nextTarget&&same(a,nextTarget))
  const directory=actions.some(a=>a.type==='scene.open-picker')||neededTargets.length>0&&neededTargets.every(target=>actions.some(a=>same(a,target)))
  // Sequential content navigation is complete without imposing an unrelated random-access menu.
  const needsDirectory=wantsDirectory&&(natural||!previous&&!next&&!directory)
  return {previous,next,directory,needsPrevious,needsNext,needsDirectory}
}

/** DOM.contains excludes ShadowRoot descendants. Keep the same component ownership across its local content realm. */
export function navigationControlOwnedBy(root:HTMLElement|undefined,element:HTMLElement):boolean {
 if(!root)return false
 let node:Node|null=element
 const visited=new Set<Node>()
 while(node&&!visited.has(node)){if(node===root||root.contains(node))return true;visited.add(node);node=(node.getRootNode() as ShadowRoot).host??null}
 return false
}
