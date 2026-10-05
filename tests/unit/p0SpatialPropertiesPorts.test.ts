import { expect, it, vi } from 'vitest'
import { buildSpatialPropertiesOwner } from '../../src/renderer/ui/properties/SpatialPropertiesContextBuilder'
import type { PropertiesOwnerReadModel } from '../../src/renderer/composition/properties/PropertiesAuthoringReadModel'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { ComponentSurface, CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
it('P0 sends frame follow, camera session edits and exclusive path sources through captured Spatial actions',async()=>{
  const surface:ComponentSurface={id:'world',title:'世界',kind:'spatial',childIds:[],spatial:{home:{x:0,y:0,zoom:1},frames:[{id:'frame',pose:{x:0,y:0,zoom:1}}]}}
  const project:CourseProjectV10={id:'project',schemaVersion:10,revision:0,title:'世界',definitions:{},instances:{},assets:{},global:{underlay:[],overlay:[]},surfaces:[surface]}
  const target={documentId:'doc-a',epoch:'epoch-a',project,surfaceId:'world'} as CapturedCourseTarget
  const read:PropertiesOwnerReadModel={documentId:'doc-a',epoch:'epoch-a',activeStateId:null,editingGlobal:false,project,baseProject:project,surface,
    selectedInstanceIds:[],selectedInstances:[],selectedViews:[],selectedInstance:null,selectedView:null,selectedIsGlobal:false,resources:{assets:{},components:{}},error:null}
  const actions={readSpatialView:()=>({camera:{x:0,y:0,zoom:1},showCameraFrames:true,activeCameraFrameId:null,playbackPathId:null,graphSelection:null}),
    updateSpatialCameraFrameTarget:vi.fn(),updateSpatialPath:vi.fn(),addSpatialCameraFrameFromSession:vi.fn(),setSpatialCameraHomeFromSession:vi.fn(),updateActiveSpatialCameraFrameFromSession:vi.fn(),
    addSpatialPath:vi.fn(async()=>{throw new Error('正式路径提交失败')})}
  const report=vi.fn()
  const context=buildSpatialPropertiesOwner({read,assets:{},actions:actions as unknown as Parameters<typeof buildSpatialPropertiesOwner>[0]['actions'],
    kernel:{} as Parameters<typeof buildSpatialPropertiesOwner>[0]['kernel'],liveTarget:()=>target,submit:()=>{},report,preview:()=>{}})!
  context.commands.updateCameraFrameTarget!('frame','object');context.commands.addCameraFrame();context.commands.setHome();context.commands.updateActiveFromSession()
  expect(actions.updateSpatialCameraFrameTarget).toHaveBeenCalledExactlyOnceWith('world','frame','object',target)
  expect(actions.addSpatialCameraFrameFromSession).toHaveBeenCalledExactlyOnceWith('world',target)
  expect(actions.setSpatialCameraHomeFromSession).toHaveBeenCalledExactlyOnceWith('world',target)
  expect(actions.updateActiveSpatialCameraFrameFromSession).toHaveBeenCalledExactlyOnceWith('world',target)
  context.commands.reorderPathFrames!('path',['frame']);context.commands.reorderPathWaypoints('path',['object'])
  expect(actions.updateSpatialPath.mock.calls).toEqual([
    ['world','path',{frameIds:['frame'],instanceIds:[]},target],['world','path',{frameIds:[],instanceIds:['object']},target],
  ])
  const path={title:'保留名字',instanceIds:[],frameIds:['frame']}
  await expect(context.commands.addPath(path)).rejects.toThrow('正式路径提交失败')
  expect(actions.addSpatialPath).toHaveBeenCalledExactlyOnceWith('world',path,target)
  expect(report).toHaveBeenCalledWith(expect.objectContaining({message:'正式路径提交失败'}))
})
