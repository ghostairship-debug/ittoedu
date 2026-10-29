import type {CourseProjectV10,ComponentContainer} from '../../shared/contracts/component-platform/project'
import type {ComponentEdit} from '../../shared/contracts/component-platform/operations'
import {componentContainerForInstance,componentDefinitionBuiltinKey,owningContainer,componentIsLocked} from '../../shared/contracts/component-platform/project'
import {isNativeFlowLayoutGroup} from '../../shared/flowNativeLayout'
import {flowPlacementEdits,flowReadingMembers,flowBodyLayoutEdits} from './courseFlowEdits'
export interface FlowObjectDrop {sourceId:string;targetId:string;side:'before'|'after'|'inside';wrap:'none'|'left'|'right';widthPercent?:number}
export function flowObjectCanWrap(project:CourseProjectV10,id:string):boolean {
 const instance=project.instances[id],definition=instance&&project.definitions[instance.definitionId],key=componentDefinitionBuiltinKey(definition)
 if(!instance||instance.flowPlacement||instance.container||componentIsLocked(project,id)||['guoling.text','guoling.document-block'].includes(key??''))return false
 const owner=owningContainer(project,id),parent=owner?.kind==='instance'?project.instances[owner.instanceId]:undefined
 return !parent||!isNativeFlowLayoutGroup(parent,project.definitions[parent.definitionId])
}
/** One owner/order/allocation transaction; source content, resources and runtime identity are preserved. */
export function prepareFlowObjectDrop(project:CourseProjectV10,surfaceId:string,input:FlowObjectDrop):ComponentEdit[]{
 if(!flowObjectCanWrap(project,input.sourceId))throw new Error('该内容沿原正文或持续布局方式移动')
 const source=project.instances[input.sourceId],target=project.instances[input.targetId]
 if(!target||target.id===source.id||componentIsLocked(project,target.id))throw new Error('目标段落已改变或不可移动')
 if(componentContainerForInstance(project,target.id)?.id!==surfaceId||componentContainerForInstance(project,source.id)?.id!==surfaceId)throw new Error('拖动范围已离开当前Flow正文')
 let container:ComponentContainer|null=input.side==='inside'?{kind:'instance',instanceId:target.id}:owningContainer(project,target.id)
 if(!container||container.kind==='global'||container.kind==='project')throw new Error('目标不是当前正文位置')
 const parentId=container.kind==='instance'?container.instanceId:container.surfaceId
 const parent=project.instances[parentId]
 if(parent&&isNativeFlowLayoutGroup(parent,project.definitions[parent.definitionId]))throw new Error('持续分栏内沿原重排方式处理，不自动改成自由绕排')
 let ancestor=parentId
 const visited=new Set<string>()
 while(ancestor&&!visited.has(ancestor)){if(ancestor===source.id)throw new Error('不能将对象放入自身后代');visited.add(ancestor);const owner=owningContainer(project,ancestor);ancestor=owner?.kind==='instance'?owner.instanceId:''}
 const reading=flowReadingMembers(project,container).filter(id=>id!==source.id)
 const index=input.side==='inside'?reading.length:reading.indexOf(target.id)+(input.side==='after'?1:0)
 if(index<0)throw new Error('目标正文顺序已改变')
 const edits=flowPlacementEdits(project,source.id,{kind:'document',surfaceId,parentId,index})
 edits.push(...flowBodyLayoutEdits(project,source.id,{wrap:input.wrap,...(input.widthPercent===undefined?{}:{widthPercent:input.widthPercent})}))
 return edits
}
