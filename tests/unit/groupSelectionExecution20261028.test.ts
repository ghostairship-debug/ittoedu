import { expect, it, vi } from 'vitest'
import { createTextData } from '../../src/components/text'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { resolveGroupSelectionIntent } from '../../src/renderer/documents/containerEditingContext'
import { createSlideWorkspaceAuthoringController } from '../../src/renderer/ui/workspaceSlideAuthoring'
import { freeSurfaceTargets, marqueeFreeTargets } from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

const identity = [1,0,0,1,0,0] as const
function fixture() {
  let next=0
  const p=createBlankCourseProjectV10('Groups',()=>['project','slide'][next++])
  p.definitions.group={id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}}
  p.definitions.text={id:'text',role:'content',implementation:{kind:'builtin',key:'guoling.text'}}
  const frame=(x:number,y:number,w=100,h=40)=>({width:w,height:h,transform:[1,0,0,1,x,y] as [number,number,number,number,number,number]})
  p.instances.slide.childIds=['outer','peer']
  p.instances.outer={id:'outer',definitionId:'group',data:{},childIds:['inner','sibling'],frame:frame(40,30,500,300)}
  p.instances.inner={id:'inner',definitionId:'group',data:{},childIds:['text'],frame:frame(20,20,200,120)}
  p.instances.text={id:'text',definitionId:'text',data:{},frame:frame(10,10)}
  p.instances.sibling={id:'sibling',definitionId:'text',data:{},frame:frame(260,20)}
  p.instances.peer={id:'peer',definitionId:'text',data:{},frame:frame(650,30)}
  for (const instance of Object.values(p.instances)) if (instance.definitionId === 'text') instance.data = JSON.parse(JSON.stringify(createTextData(instance.id)))
  return p
}

it('resolves first, repeated, deep and sibling selections without making UI scope an AI target requirement',()=>{
 const p=fixture()
 expect(resolveGroupSelectionIntent(p,'slide','text',[])).toEqual({pressId:'outer',clickId:'outer',groupId:null})
 expect(resolveGroupSelectionIntent(p,'slide','text',['outer'])).toEqual({pressId:'outer',clickId:'text',groupId:'outer'})
 expect(resolveGroupSelectionIntent(p,'slide','text',[],null,true)).toEqual({pressId:'text',clickId:'text',groupId:'outer'})
 expect(resolveGroupSelectionIntent(p,'slide','sibling',['text'],'outer')).toEqual({pressId:'sibling',clickId:'sibling',groupId:'outer'})
 expect(resolveGroupSelectionIntent(p,'slide','peer',['text'],'outer')).toEqual({pressId:'peer',clickId:'peer',groupId:null})
})

it('two clicks enter a member; dragging the selected group before release still moves the group; Session preserves siblings',async()=>{
 const p=fixture(),h=await createV10StoreHost(p),id=h.first.documentId,report=vi.fn()
 const c=createSlideWorkspaceAuthoringController({
   read:()=>{const v=h.bridge.read();return {project:v.editingProject!,surfaceId:v.surfaceId!,documentId:id,activeGroupId:v.activeGroupId,activeStateId:v.activeStateId,selectedInstanceIds:v.selectedInstanceIds}},
   capture:()=>h.bridge.captureOwnedTarget(),select:ids=>h.bridge.selectInstances(id,ids),
   selectCanvas:(ids,group)=>h.bridge.selectInstances(id,ids,undefined,group),
   commit:(edits,target,group)=>h.bridge.editCaptured(h.bridge.capture(edits,target),group),report
 })
 try {
  c.pointerDown({x:80,y:70},identity);await c.pointerUp({x:80,y:70},identity)
  expect(h.bridge.read()).toMatchObject({selectedInstanceIds:['outer'],activeGroupId:null})
  c.pointerDown({x:80,y:70},identity);await c.pointerUp({x:100,y:90,altKey:true},identity)
  expect(h.model().project.instances.outer.frame!.transform.slice(4)).toEqual([60,50])
  expect(h.model().project.instances.text).toEqual(p.instances.text)
  await h.bridge.undo()
  c.pointerDown({x:80,y:70},identity);expect(h.bridge.read().selectedInstanceIds).toEqual(['outer'])
  await c.pointerUp({x:80,y:70},identity)
  expect(h.bridge.read()).toMatchObject({selectedInstanceIds:['text'],activeGroupId:'outer'})
  c.pointerDown({x:80,y:70},identity);await c.pointerUp({x:103,y:87,altKey:true},identity)
  expect(h.model().project.instances.text.frame!.transform.slice(4)).toEqual([33,27])
  expect(h.model().project.instances.sibling).toEqual(p.instances.sibling)
  c.pointerDown({x:315,y:65},identity);await c.pointerUp({x:315,y:65},identity)
  expect(h.bridge.read()).toMatchObject({selectedInstanceIds:['sibling'],activeGroupId:'outer'})
  h.bridge.selectInstances(id,['text'],undefined,'outer');h.bridge.leaveGroup(id)
  expect(h.bridge.read().selectedInstanceIds).toEqual(['inner'])
  h.bridge.leaveGroup(id);expect(h.bridge.read().selectedInstanceIds).toEqual(['outer'])
  expect(h.bridge.read().activeGroupId).toBeNull()
  h.bridge.selectInstances(id,[],undefined,null);expect(h.bridge.read()).toMatchObject({selectedInstanceIds:[],activeGroupId:null})
  expect(report).not.toHaveBeenCalled()
 } finally {h.bridge.dispose()}
})

it('marquee requires full containment and only selects descendants in its explicit group scope',()=>{
 const t=freeSurfaceTargets(fixture(),'slide')
 expect(marqueeFreeTargets(t,{x:0,y:0},{x:100,y:100})).toEqual([])
 expect(marqueeFreeTargets(t,{x:0,y:0},{x:550,y:340})).toEqual(['outer'])
 expect(marqueeFreeTargets(t,{x:69,y:59},{x:171,y:101},'outer')).toEqual(['text'])
 expect(marqueeFreeTargets(t,{x:59,y:49},{x:261,y:171},'outer')).toEqual(['inner'])
 expect(marqueeFreeTargets(t,{x:0,y:0},{x:1000,y:1000},'outer')).not.toContain('peer')
})
