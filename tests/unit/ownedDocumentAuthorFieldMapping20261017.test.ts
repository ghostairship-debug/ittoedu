import { testContainerInstance } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import {describe,expect,it} from 'vitest'
import {createBlankCourseProjectV10} from '@/core/course/createCourseProjectV10'
import {applyComponentOperation,captureComponentOperation} from '@/core/drivers/courseV10Operations'
import {courseAuthorFieldReadPaths,mapExternalCourseTextTarget,readCourseAuthorField,replaceCourseAuthorField,type CourseInstanceTarget} from '@/core/tools/ToolTargets'
import {WEB_DEFINITION} from '@/components/web/data'
import type {DocumentModel} from '@/shared/workbench/document'

function fixture(){
 const project=createBlankCourseProjectV10('Nested author target mapping')
 project.definitions[WEB_DEFINITION.id]=WEB_DEFINITION
 project.instances.primary={id:'primary',definitionId:WEB_DEFINITION.id,data:{html:'<iframe srcdoc="<h2 id=&quot;title&quot;>Original</h2>"></iframe>'},frame:{width:640,height:360,transform:[1,0,0,1,0,0]}}
 testContainerInstance(project, 0).childIds=['primary']
 const model:DocumentModel={kind:'course-v10',project,resources:{assets:{},components:{}}}
 const target:CourseInstanceTarget={kind:'course-instance',surfaceId:componentSurfaces(project)[0]!.id,instanceId:'primary',stateId:null,
  authorField:{kind:'text',authorKey:'dom-title',scope:{'document:path':'pending:0:frame-key'},
   binding:{kind:'dom',path:[{tag:'body',index:1},{tag:'h2',index:0,attributes:{id:'title'}}],textIndex:0,baseline:'Original'},
   bindingStatus:'bound',fieldScope:'authoring',dataPath:['records','dom-title','overrides','text'],initialValue:'Original'}}
 return {model,target}
}

describe('owned document first-edit target handoff',()=>{
 it('follows only the keys persisted by the same planned first edit and keeps later text.replace usable',()=>{
  const {model:before,target}=fixture()
  if(before.kind!=='course-v10')throw new Error('fixture')
  const edits=replaceCourseAuthorField(before,target,'Changed')
  const project=applyComponentOperation(before.project,captureComponentOperation(before.project,edits))
  const after:DocumentModel={...before,project}
  const mapped=mapExternalCourseTextTarget(before,after,target,true) as CourseInstanceTarget
  expect(mapped.authorField?.scope).toEqual({'document:path':'key:frame-key'})
  expect(readCourseAuthorField(after,mapped).value).toBe('Changed')
  const nextEdits=replaceCourseAuthorField(after,{...mapped,authorField:{...mapped.authorField!,initialValue:'Changed'}},'Changed again')
  const next:DocumentModel={...after,project:applyComponentOperation(project,captureComponentOperation(project,nextEdits))}
  expect(readCourseAuthorField(next,mapped).value).toBe('Changed again')
  expect((next.project.instances.primary!.data as {html:string}).html.match(/data-cw-author-key=/g)).toHaveLength(1)
 })

 it('still rejects a changed binding or an unrelated scope after an edit',()=>{
  const {model:before,target}=fixture()
  if(before.kind!=='course-v10')throw new Error('fixture')
  const edits=replaceCourseAuthorField(before,target,'Changed')
  const project=applyComponentOperation(before.project,captureComponentOperation(before.project,edits))
  for(const changed of ['binding','scope'] as const){
   const broken=structuredClone(project),record=broken.instances.primary!.authoring!.records!['dom-title']!
   if(changed==='binding')record.binding.baseline='Another object'
   else record.scope!['unrelated']='changed'
   expect(()=>mapExternalCourseTextTarget(before,{...before,project:broken},target,true)).toThrow(/绑定已变化/)
  }
 })

 it('captures pending child source and rejects a stale positional target after a sibling insertion',()=>{
  const {model:before,target}=fixture()
  if(before.kind!=='course-v10')throw new Error('fixture')
  expect(courseAuthorFieldReadPaths(before,target)).toContainEqual(['instances','primary','data','html'])
  const project=structuredClone(before.project),data=project.instances.primary!.data as {html:string}
  data.html='<iframe srcdoc="<h2 id=&quot;title&quot;>Original</h2>"></iframe>'+data.html
  expect(()=>mapExternalCourseTextTarget(before,{...before,project},target,false)).toThrow(/源码已变化/)
  expect(()=>mapExternalCourseTextTarget(before,{...before,project},target,true)).toThrow(/源码已变化/)
  expect(mapExternalCourseTextTarget(before,structuredClone(before),target,false)).toEqual(target)
 })
})
