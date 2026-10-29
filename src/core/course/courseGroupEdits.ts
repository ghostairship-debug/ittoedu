import {groupCompositeBoundary,groupPaintSplit} from './courseGroupDecoration'
import { componentIsLocked, containerChildIds, owningContainer, type ComponentContainer, type ComponentInstance, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { frameCorners, IDENTITY_MATRIX, reparentFrame, translationMatrix, type AffineMatrix } from '../components/geometry'
import { declaredTargets, interactionReferenceTargets } from '../components/library/references'

export interface CourseGroupPlan { edits: ComponentEdit[]; selectedIds: string[] }
export type CourseGroupIntent = 'group' | 'ungroup'
const sameOwner = (a: ComponentContainer | null, b: ComponentContainer | null) => a?.kind === b?.kind && JSON.stringify(a) === JSON.stringify(b)
const inherited = /^(--|color$|font(?:-|$)|line-height$|letter-spacing$|word-spacing$|white-space(?:-|$)|word-break$|overflow-wrap$|text-(?:align|indent|transform|rendering|shadow|size-adjust)$|direction$|writing-mode$|visibility$)/
const cssName = (name: string) => name.startsWith('--') ? name : name.replace(/[A-Z]/g, value => '-' + value.toLowerCase())
const nonEmpty = (value: unknown) => Boolean(value && typeof value === 'object' && Object.keys(value).length)
function freeOwner(project: CourseProjectV10, id: string): ComponentContainer {
  const value = project.instances[id], owner = owningContainer(project, id)
  if (!value || !owner || value.container || !value.frame) throw new Error('请选择有独立自由位置的内容对象')
  if (componentIsLocked(project, id)) throw new Error('对象或所属组已锁定，请先解锁')
  const parent = owner.kind === 'instance' ? project.instances[owner.instanceId] : owner.kind === 'surface' ? project.instances[owner.surfaceId] : undefined
  if (parent?.container?.kind === 'flow' && !value.flowPlacement) throw new Error('正文组合的占位与绕排需由Flow处理，当前操作未改变正文')
  const display = parent?.style?.display
  if (typeof display === 'string' && /^(inline-)?(flex|grid)$/.test(display)) throw new Error('此处保留旧持续布局，请使用原排版操作')
  return owner
}
function ungroupStyle(group: ComponentInstance): Record<string, JsonValue> {
  const style = Object.fromEntries(Object.entries(group.style ?? {}).map(([key,value]) => [cssName(key),value]))
  const reason=groupCompositeBoundary(group)
  if(reason)throw new Error('此组仍承担 '+reason+' 的共同绘制；请先处理该效果再解除组合')
  return Object.fromEntries(Object.entries(style).filter(([key])=>inherited.test(key)))
}
function assertUngroupReferences(project: CourseProjectV10, group: ComponentInstance): void {
  const effective = group.implementationOverride ?? project.definitions[group.definitionId]?.implementation
  if (effective?.kind !== 'builtin' || effective.key !== 'guoling.group' || !group.childIds?.length)
    throw new Error('所选对象不是可解除的普通组；组件内部边界保持不变')
  if (nonEmpty(group.data) || nonEmpty(group.authoring?.records) || group.attachments?.length || nonEmpty(group.stateBindings) || group.flowPlacement || group.flowLayout || nonEmpty(group.visibility) || group.viewportPinned)
    throw new Error('此组还承担作者数据、行为或Flow位置，请先处理这些关系')
  for (const item of Object.values(project.instances)) {
    if (item.id === group.id) continue
    const definition = project.definitions[item.definitionId]
    if ((item.attachments ?? []).some(a=>a.instanceId === group.id || a.target.kind === 'instance' && a.target.instanceId === group.id)
      || [...declaredTargets(item.data),...interactionReferenceTargets(item,definition)].some(t=>t.kind === 'instance' && t.instanceId === group.id))
      throw new Error('此组仍被其他对象或交互引用：'+item.id)
    // Public author parameters may carry lists such as chapterCopyIds. Preserve them rather than deleting their owner.
    const data = JSON.stringify(item.data), source = item.implementationOverride ?? definition?.implementation
    if (data.includes(JSON.stringify(group.id)) || source?.kind === 'source' && JSON.stringify(source).includes(group.id))
      throw new Error('此组的身份仍由内容或Source引用：'+item.id)
    if (item.container?.presentation?.states.some(state=>state.overrides[group.id] || (state.order ?? []).includes(group.id)))
      throw new Error('此组还有展示状态覆盖，请先处理该状态关系')
    if (item.container?.spatial && JSON.stringify(item.container.spatial).includes(group.id))
      throw new Error('此组仍参与空间连线或路径')
  }
}
/** One pure planner used by the human controls and object.layout. Identities and persistence remain Session-owned. */
export function prepareCourseGroup(project: CourseProjectV10, requestedIds: readonly string[], intent: CourseGroupIntent,
  allocateId: () => string = () => crypto.randomUUID()): CourseGroupPlan {
  const chosen = new Set(requestedIds)
  const ids = [...chosen].filter(id=>{
    let owner = owningContainer(project,id)
    while(owner?.kind === 'instance') { if(chosen.has(owner.instanceId)) return false; owner=owningContainer(project,owner.instanceId) }
    return true
  })
  if (!ids.length) throw new Error('请先选择对象')
  const owners = ids.map(id=>freeOwner(project,id)), first = owners[0]!
  const edits: ComponentEdit[] = [], selectedIds: string[] = []
  const presentations = new Map<string, NonNullable<NonNullable<ComponentInstance['container']>['presentation']>>()
  const mapStateFrames = (children: readonly string[], oldParent: AffineMatrix, newParent: AffineMatrix) => {
    for(const instance of Object.values(project.instances)) {
      const presentation=presentations.get(instance.id) ?? instance.container?.presentation
      if(!presentation?.states.some(state=>children.some(id=>state.overrides[id]?.frame)))continue
      const next=presentations.get(instance.id) ?? structuredClone(presentation)
      for(const state of next.states)for(const id of children){const override=state.overrides[id];if(override?.frame){const mapped=reparentFrame(override.frame,oldParent,newParent);override.frame={...mapped,transform:[...mapped.transform]}}}
      presentations.set(instance.id,next)
    }
  }
  const appendPresentations=()=>{for(const [surfaceId,presentation] of presentations)edits.push({type:'surface.presentation.set',surfaceId,presentation})}
  if (intent === 'group') {
    if (ids.length < 2 || !owners.every(owner=>sameOwner(owner,first))) throw new Error('请选择同一父级中的至少两个自由对象')
    const siblings = containerChildIds(project,first), sorted = [...ids].sort((a,b)=>siblings.indexOf(a)-siblings.indexOf(b))
    const positions = sorted.map(id=>siblings.indexOf(id))
    const intervening=siblings.slice(Math.min(...positions),Math.max(...positions)+1).filter(id=>!chosen.has(id))
    const bounds=(id:string)=>{const f=project.instances[id]?.frame;if(!f)return null;const p=frameCorners(f);return {left:Math.min(...p.map(v=>v.x)),right:Math.max(...p.map(v=>v.x)),top:Math.min(...p.map(v=>v.y)),bottom:Math.max(...p.map(v=>v.y))}}
    if(intervening.some(id=>{const a=bounds(id);return !a || sorted.some(target=>{const b=bounds(target)!;return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top})}))
      throw new Error('所选对象之间夹有相互遮挡的图层，请先调整图层顺序再组合，以保持原有绘制关系')
    if(Object.values(project.instances).some(instance=>instance.container?.presentation?.states.some(state=>(state.order ?? []).some(id=>chosen.has(id)))))
      throw new Error('所选对象有独立的展示状态图层顺序，请先处理该关系')
    const points=sorted.flatMap(id=>[...frameCorners(project.instances[id]!.frame!)]), xs=points.map(p=>p.x),ys=points.map(p=>p.y)
    const x=Math.min(...xs),y=Math.min(...ys),groupId=allocateId()
    const definition=Object.values(project.definitions).find(d=>d.implementation.kind==='builtin' && d.implementation.key==='guoling.group')
    const definitionId=definition?.id ?? allocateId()
    const frame={width:Math.max(.001,Math.max(...xs)-x),height:Math.max(.001,Math.max(...ys)-y),transform:[...translationMatrix(x,y)] as [number,number,number,number,number,number]}
    if(!definition)edits.push({type:'definition.set',definition:{id:definitionId,title:'组合',role:'content',implementation:{kind:'builtin',key:'guoling.group'}}})
    edits.push({type:'instance.insert',container:first,index:positions[0]!,instances:[{id:groupId,definitionId,data:{},frame,childIds:[]}],rootIds:[groupId]})
    sorted.forEach((id,index)=>{const mapped=reparentFrame(project.instances[id]!.frame!,IDENTITY_MATRIX,frame.transform);edits.push({type:'instance.move',instanceId:id,container:{kind:'instance',instanceId:groupId},index,frame:{...mapped,transform:[...mapped.transform]}})})
    mapStateFrames(sorted,IDENTITY_MATRIX,frame.transform);appendPresentations()
    return {edits,selectedIds:[groupId]}
  }
  const projected = new Map<string,string[]>()
  for(let i=0;i<ids.length;i++) {
    const group=project.instances[ids[i]!]!,owner=owners[i]!
    assertUngroupReferences(project,group)
    const inheritedStyle=ungroupStyle(group),key=JSON.stringify(owner)
    const siblings=projected.get(key) ?? [...containerChildIds(project,owner)],index=siblings.indexOf(group.id)
    const children=group.childIds!,decoration=groupPaintSplit(project,group,allocateId)
    const backgroundIds:string[]=[]
    if(decoration){
      if(decoration.definition)edits.push({type:'definition.set',definition:decoration.definition})
      decoration.instance.frame={...group.frame!,transform:[...group.frame!.transform]}
      edits.push({type:'instance.insert',container:owner,index,instances:[decoration.instance],rootIds:[decoration.instance.id]})
      backgroundIds.push(decoration.instance.id);selectedIds.push(decoration.instance.id)
    }
    for(const [offset,id] of children.entries()) {
      freeOwner(project,id)
      const child=project.instances[id]!
      const childStyle=Object.fromEntries(Object.entries(child.style ?? {}).map(([name,value])=>[cssName(name),value]))
      if ((inheritedStyle['font-size'] !== undefined || inheritedStyle.font !== undefined) && Object.entries(childStyle).some(([name,value])=> /^(font-size|font|line-height|letter-spacing|word-spacing)$/.test(name) && /(?:[\d.]|calc\().*(?:em|ex|ch|%)/.test(String(value))))
        throw new Error('子对象仍使用依赖该组字体的相对排印，请先落实排印尺寸：'+id)
      if(inheritedStyle.font!==undefined && Object.keys(childStyle).some(name=>name.startsWith('font-')||name==='line-height'))
        throw new Error('该组字体简写与子对象排印存在组合关系，请先落实字体字段：'+id)
      const mapped=reparentFrame(child.frame!,group.frame!.transform,IDENTITY_MATRIX)
      edits.push({type:'instance.move',instanceId:id,container:owner,index:index+backgroundIds.length+offset,frame:{...mapped,transform:[...mapped.transform]}})
      for(const [name,value] of Object.entries(inheritedStyle)) {
        const own=Object.entries(child.style ?? {}).find(([k])=>cssName(k)===name)?.[1]
        if(own===undefined || own==='inherit' || own==='unset')edits.push({type:'style.set',instanceId:id,path:[name],value})
      }
      if(group.visible===false)edits.push({type:'instance.patch',instanceId:id,patch:{visible:false}})
      selectedIds.push(id)
    }
    mapStateFrames(children,group.frame!.transform,IDENTITY_MATRIX)
    siblings.splice(index,1,...backgroundIds,...children);projected.set(key,siblings)
    edits.push({type:'instance.remove',instanceId:group.id})
  }
  appendPresentations()
  return {edits,selectedIds}
}
