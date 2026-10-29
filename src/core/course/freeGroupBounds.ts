import type {ComponentEdit} from '../../shared/contracts/component-platform/operations'
import {componentDefinitionBuiltinKey,componentIsLocked,owningContainer,type ComponentInstance,type CourseProjectV10} from '../../shared/contracts/component-platform/project'
import type {ComponentFrame} from '../../shared/contracts/component-platform/frame'
import {composeMatrices,frameCorners,IDENTITY_MATRIX,translationMatrix,type AffineMatrix} from '../components/geometry'
import {groupCompositeBoundary,groupPaintSplit} from './courseGroupDecoration'
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
/** Normalize only a real member geometry change. Opening a work or one-time grouping does not migrate it. */
export function expandFreeGroupBounds(project:CourseProjectV10,input:ComponentEdit[]):{edits:ComponentEdit[];reads:string[][]} {
 const requests=input.filter((edit):edit is Extract<ComponentEdit,{type:'frame.set'}>=>edit.type==='frame.set'&&edit.frame!==null)
 if(!requests.length||input.some(e=>e.type==='instance.move'||e.type==='instance.insert'||e.type==='instance.remove'||e.type==='surface.presentation.set'))return {edits:input,reads:[]}
 const explicit=new Set(requests.map(e=>e.instanceId)),frames=new Map<string,ComponentFrame>(),groups=new Set<string>(),reads:string[][]=[]
 for(const edit of requests){frames.set(edit.instanceId,structuredClone(edit.frame!));let owner=owningContainer(project,edit.instanceId);const visited=new Set<string>();while(owner?.kind==='instance'&&!visited.has(owner.instanceId)){const parent=project.instances[owner.instanceId];if(!parent||parent.container)break;visited.add(parent.id);groups.add(parent.id);owner=owningContainer(project,parent.id)}}
 const depth=(id:string)=>{let n=0,owner=owningContainer(project,id);const seen=new Set<string>();while(owner?.kind==='instance'&&!seen.has(owner.instanceId)){seen.add(owner.instanceId);n++;owner=owningContainer(project,owner.instanceId)}return n}
 const extras:ComponentEdit[]=[],updated=new Map<string,ComponentInstance>()
 const get=(id:string)=>updated.get(id)??project.instances[id]
 for(const id of [...groups].sort((a,b)=>depth(b)-depth(a))){
  const group=get(id),definition=group&&project.definitions[group.definitionId],implementation=group?.implementationOverride??definition?.implementation
  if(!group?.frame||!group.childIds?.length||group.container||implementation?.kind!=='builtin'||componentDefinitionBuiltinKey(definition)!=='guoling.group'||explicit.has(id)||componentIsLocked(project,id))continue
  if(groupCompositeBoundary(group)||/^(inline-)?(flex|grid)$/.test(String(group.style?.display??''))||group.flowLayout||group.flowPlacement||group.attachments?.length||group.stateBindings||Object.keys(group.data??{}).length)continue
  const children=group.childIds.map(get)
  if(children.some(child=>!child?.frame))continue
  // State-specific coordinate bases are a separate declared layout owner. Do not rewrite them as master frames.
  if(Object.values(project.instances).some(i=>i.container?.presentation?.states.some(state=>[id,...group.childIds!].some(key=>state.overrides[key]?.frame))))continue
  const old=frames.get(id)??group.frame,points=children.flatMap(child=>[...frameCorners(frames.get(child.id)??child.frame!)])
  const left=Math.min(0,...points.map(p=>p.x)),top=Math.min(0,...points.map(p=>p.y)),right=Math.max(old.width,...points.map(p=>p.x)),bottom=Math.max(old.height,...points.map(p=>p.y))
  if(left>=-1e-6&&top>=-1e-6&&right<=old.width+1e-6&&bottom<=old.height+1e-6)continue
  reads.push(['instances',id,'style'],['instances',id,'childIds'],...group.childIds.map(child=>['instances',child,'frame']))
  const decoration=groupPaintSplit(project,{...group,frame:old},()=>crypto.randomUUID())
  const childIds=[...group.childIds]
  if(decoration){
    if(decoration.definition)extras.push({type:'definition.set',definition:decoration.definition})
    updated.set(decoration.instance.id,decoration.instance);childIds.unshift(decoration.instance.id)
    extras.push({type:'instance.insert',container:{kind:'instance',instanceId:id},index:0,instances:[decoration.instance],rootIds:[decoration.instance.id]},
      {type:'style.set',instanceId:id,path:[],value:decoration.remainingStyle})
  }
  frames.set(id,{width:right-left,height:bottom-top,transform:[...composeMatrices(old.transform,translationMatrix(left,top))]})
  if(left!==0||top!==0)for(const childId of childIds){const child=get(childId)!,oldChild=frames.get(childId)??child.frame!;frames.set(childId,{...oldChild,transform:[...composeMatrices(translationMatrix(-left,-top),oldChild.transform)]})}
 }
 const changed=[...frames].filter(([id,frame])=>!same(frame,project.instances[id]?.frame))
 if(!extras.length&&changed.every(([id])=>explicit.has(id)))return {edits:input,reads}
 const result=input.filter(edit=>edit.type!=='frame.set'||!frames.has(edit.instanceId))
 result.push(...extras)
 for(const [id,frame] of changed){const insertion=extras.find(e=>e.type==='instance.insert'&&e.instances.some(i=>i.id===id));if(insertion?.type==='instance.insert')insertion.instances.find(i=>i.id===id)!.frame=frame;else result.push({type:'frame.set',instanceId:id,frame})}
 return {edits:result,reads}
}
/** Locked members may undergo a mathematically identical parent-basis re-expression, never an actual transform. */
export function equivalentFreeFrameCompensations(project:CourseProjectV10,edits:readonly ComponentEdit[]):Set<ComponentEdit> {
 const result=new Set<ComponentEdit>()
 if(edits.some(e=>e.type==='instance.move'||e.type==='instance.remove'))return result
 const frames=new Map(edits.filter((e):e is Extract<ComponentEdit,{type:'frame.set'}>=>e.type==='frame.set'&&e.frame!==null).map(e=>[e.instanceId,e.frame!]))
 const matrix=(id:string,after:boolean,visited=new Set<string>()):AffineMatrix=>{if(visited.has(id))throw Error('对象层级循环');visited.add(id);const value=project.instances[id],owner=owningContainer(project,id);return composeMatrices(owner?.kind==='instance'?matrix(owner.instanceId,after,visited):IDENTITY_MATRIX,(after?frames.get(id):undefined)?.transform??value?.frame?.transform??IDENTITY_MATRIX)}
 for(const edit of edits){
  if(edit.type!=='frame.set'||!edit.frame||!componentIsLocked(project,edit.instanceId))continue
  const original=project.instances[edit.instanceId]?.frame
  if(!original||original.width!==edit.frame.width||original.height!==edit.frame.height)continue
  const before=matrix(edit.instanceId,false),after=matrix(edit.instanceId,true)
  if(before.every((n,i)=>Math.abs(n-after[i]!)<=1e-8*Math.max(1,Math.abs(n))))result.add(edit)
 }
 return result
}
