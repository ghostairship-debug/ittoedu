import { expect,it,vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { hostNavigationExplicitlyHidden,projectPlaybackSettingsSchema,courseProjectPlaybackSettingsSchema } from '../../src/shared/contracts/playback-v1'
import { mountComponentFlowToc } from '../../src/player/componentPlatform/flowToc'
import type { TeacherControllerSnapshot } from '../../src/shared/contracts/component-platform/teacherController'

it('requires the explicit author field and preserves old controls:none and canvas parsing',()=>{
 const old=createBlankCourseProjectV10().playback!
 expect(hostNavigationExplicitlyHidden(old)).toBe(false)
 expect(hostNavigationExplicitlyHidden()).toBe(false)
 expect(projectPlaybackSettingsSchema.parse(old)).toEqual(old)
 expect(courseProjectPlaybackSettingsSchema.parse(old)).toEqual(old)
 expect(projectPlaybackSettingsSchema.parse({...old,controls:'canvas',hostNavigation:'auto'}).hostNavigation).toBe('auto')
 expect(hostNavigationExplicitlyHidden({...old,hostNavigation:'intentionally-hidden'})).toBe(true)
 expect(projectPlaybackSettingsSchema.safeParse({...old,hostNavigation:'none'}).success).toBe(false)
})
it('explicit author intent uses normal History, save/reopen and Published payload without modifying other work content',async()=>{
 const p=createBlankCourseProjectV10('No host controls'),h=await createV10StoreHost(p)
 try{
  const old=structuredClone(h.model().project)
  await h.bridge.edit([{type:'project.playback.set',playback:{...p.playback!,hostNavigation:'intentionally-hidden'}}])
  expect(h.model().project.instances).toEqual(old.instances)
  await h.bridge.undo();expect(h.model().project.playback).toEqual(old.playback)
  await h.bridge.redo();await h.api.save(h.first.documentId,'intent.glx')
  const reopened=await h.driver.load(h.disk.get('intent.glx')!)
  if(reopened.kind!=='course-v10')throw Error('wrong model')
  expect(reopened.project.playback?.hostNavigation).toBe('intentionally-hidden')
  const published=await buildPublishedCourseV3({project:reopened.project,assetBytes:{}})
  expect(published.payload.playback).toEqual(reopened.project.playback)
 }finally{h.bridge.dispose()}
})
it('Flow directory highlights the canonical reading owner including a clamped explicit target, not a second DOM offset algorithm',()=>{
 const root=document.createElement('main');document.body.append(root)
 let reading:TeacherControllerSnapshot['reading']={containerId:'flow',activeInstanceId:'second',progress:1}
 let notify=()=>{}
 const snapshot=():TeacherControllerSnapshot=>({locationId:'flow',scenes:[{id:'flow',name:'Flow',targets:['first','second'].map(id=>({id,name:id,kind:'heading',action:{type:'scene.go',sceneId:'flow',targetInstanceId:id}}))}],progress:null,reading,zoom:1,muted:false,fullscreen:false})
 const dispose=vi.fn(),navigation={read:snapshot,subscribe:(f:()=>void)=>{notify=f;return dispose},execute:async()=>true,setCollapsed:vi.fn()}
 const toc=mountComponentFlowToc(root,'flow',navigation)
 try{
  expect(root.querySelector('[aria-current="location"]')?.getAttribute('data-flow-toc-anchor')).toBe('second')
  reading={containerId:'flow',activeInstanceId:'first',progress:0};notify()
  expect(root.querySelector('[aria-current="location"]')?.getAttribute('data-flow-toc-anchor')).toBe('first')
  reading={containerId:'other',activeInstanceId:'first',progress:0};notify()
  expect(root.querySelector('[aria-current="location"]')).toBeNull()
 }finally{toc.destroy();root.remove()}
 expect(dispose).toHaveBeenCalledOnce()
})
