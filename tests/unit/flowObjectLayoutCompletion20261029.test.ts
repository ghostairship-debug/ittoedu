import {expect,it} from 'vitest'
import {resolveFlowObjectWidth} from '../../src/shared/flowMediaLayout'
import {resolveComponentOuterPresentation} from '../../src/shared/componentPresentation'
import {createBlankCourseProjectV10} from '../../src/core/course/createCourseProjectV10'
import {prepareFlowObjectDrop} from '../../src/core/course/courseFlowObjectDrop'
import {flowBodyLayoutEdits} from '../../src/core/course/courseFlowEdits'
import {TEXT_DEFINITION} from '../../src/components/text/adapters'
import {createTextComponentData} from '../../src/components/text/data'
import {POPOVER_DEFINITION,createPopoverData} from '../../src/components/popover'
import {createV10StoreHost} from '../helpers/courseV10StoreHost'
import {setRootContainers} from '../helpers/glxWorkFixture'
const json=(value:unknown)=>JSON.parse(JSON.stringify(value))
function fixture(){const p=createBlankCourseProjectV10('Flow allocation');p.definitions[TEXT_DEFINITION.id]=TEXT_DEFINITION;p.definitions[POPOVER_DEFINITION.id]=POPOVER_DEFINITION
 p.instances.p={id:'p',definitionId:TEXT_DEFINITION.id,data:json(createTextComponentData('正文内容'))}
 p.instances.widget={id:'widget',definitionId:POPOVER_DEFINITION.id,data:json(createPopoverData()),frame:{width:240,height:120,transform:[1,0,0,1,0,0]}}
 setRootContainers(p,[{id:'flow',kind:'flow',title:'Flow',childIds:['p','widget'],flow:{layout:{readingWidth:800,wideContentWidth:1000,widthMode:'reading'}}}]);return p}
it('explicit width uses the reading lane, preserves old implicit width, and becomes standalone on a narrow lane',()=>{
 expect(resolveFlowObjectWidth({wrap:'left'},800)).toMatchObject({wrap:'left',inlineSize:'48%'})
 expect(resolveFlowObjectWidth({wrap:'right',widthPercent:38},800)).toMatchObject({wrap:'right',inlineSize:'38%'})
 expect(resolveFlowObjectWidth({wrap:'left'},280)).toMatchObject({wrap:'none',inlineSize:'100%'})
 expect(resolveFlowObjectWidth({wrap:'right',widthPercent:55},280)).toMatchObject({wrap:'none',inlineSize:'55%'})
 const p=fixture();p.instances.widget.flowLayout={width:'content-width',wrap:'left',widthPercent:42}
 const first=resolveComponentOuterPresentation(p,p.instances.widget,{placement:'flow',purpose:'author',inlineSize:800,availableInlineSize:800})
 const settled=resolveComponentOuterPresentation(p,p.instances.widget,{placement:'flow',purpose:'author',inlineSize:336,availableInlineSize:800})
 expect(first.outerStyle).toEqual(settled.outerStyle);expect(settled.outerStyle).toMatchObject({width:'42%',float:'left'})
})
it('drop moves identity and wrap in one formal History entry, then width, Undo/Redo and archive preserve content',async()=>{
 const p=fixture(),h=await createV10StoreHost(p)
 try{
  const before=structuredClone(p.instances.widget)
  await h.bridge.edit(prepareFlowObjectDrop(p,'flow',{sourceId:'widget',targetId:'p',side:'before',wrap:'left'}))
  expect(h.first.read().undoDepth).toBe(1);expect(h.model().project.instances.flow.childIds).toEqual(['widget','p'])
  expect(h.model().project.instances.widget.data).toEqual(before.data);expect(h.model().project.instances.widget.frame).toEqual(before.frame)
  await h.bridge.edit(flowBodyLayoutEdits(h.model().project,'widget',{widthPercent:37}))
  expect(h.model().project.instances.widget.flowLayout).toMatchObject({wrap:'left',widthPercent:37})
  await h.bridge.undo();expect(h.model().project.instances.widget.flowLayout?.widthPercent).toBeUndefined()
  await h.bridge.redo();await h.api.save(h.first.documentId,'flow-width.glx')
  const reopened=await h.driver.load(h.disk.get('flow-width.glx')!);expect(reopened).toMatchObject({project:{instances:{widget:{data:before.data,flowLayout:{wrap:'left',widthPercent:37}}}}})
 }finally{h.bridge.dispose()}
})
it('a deliberate width preset clears only manual allocation while text and persistent layout groups keep their own semantics',()=>{
 const p=fixture();p.instances.widget.flowLayout={width:'content-width',wrap:'right',widthPercent:35}
 expect(flowBodyLayoutEdits(p,'widget',{width:'wide'})[0]).toMatchObject({flowLayout:{wrap:'right',width:'wide'}})
 expect(()=>prepareFlowObjectDrop(p,'flow',{sourceId:'p',targetId:'widget',side:'before',wrap:'left'})).toThrow(/原正文/)
 p.instances.widget.locked=true;expect(()=>prepareFlowObjectDrop(p,'flow',{sourceId:'widget',targetId:'p',side:'before',wrap:'left'})).toThrow()
})
