import { writeFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import { plainDocumentText } from '../../src/shared/document/content'
import { controllerMetadata, controllerPackages, createControllerFixture } from '../fixtures/teacherController'
import type { CourseProjectDocument, FlowSurfaceDocument, RuntimeLayerItem, SpatialSurfaceDocument } from '../../src/shared/courseProjectTypes'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { createShapeNode } from '../../src/core/tools/nativeNodeFactories'
import { createCourseProjectArchive, type CourseProjectArchiveData } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseFlowPage, addCourseSlidePage, addCourseSpatialPage } from '../../src/core/tools/courseLocations'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'
import { readSaved, writeNativeLesson, type NativeRun } from './r18NativeAuthoringFixture'

// Pure mixed-surface fixture for actual Runtime admission and DOM behavior.
// Embedded CLI records, retained sessions and paid continuation helpers are retired.
export const REMAINING_IDS = Object.freeze({ paragraphOne: 'remaining-flow-first', paragraphTwo: 'remaining-flow-second',
  spatialObject: 'remaining-spatial-object', brokenRuntime: 'remaining-click-runtime' })
export const MATERIAL_FIXTURE = Object.freeze({
  blankPageName: '材料练习空白页', title: '分数含义基准材料', locator: 'r18-050 固定工程材料',
  text: '分数表示把一个整体平均分成若干份，取其中的一份或几份。',
  initialTitle: '认识分数', revisedTitle: '平均分与分数',
})
export const FIRST_PARAGRAPH = '摆锤在重力作用下往复运动。我们可以用平衡位置、振幅和周期描述它的运动。'
export const SECOND_PARAGRAPH = '为了测量摆锤往复运动一次需要的时间，我们先观察摆锤经过平衡位置的时刻，再连续记录十次完整往复运动的总时间。把测得的总时间除以十，就可以估算摆锤的周期。多测几组并比较结果，可以减少一次计时带来的误差，使记录更加可靠。'
// Deliberately authored broken lesson content, not a mocked host or repair hint.
// A real click does nothing because this DOM event name never fires on a click.
const BROKEN_BUTTON_SOURCE = `CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){
  var box=document.createElement('section');
  box.style.cssText='position:absolute;left:32px;top:28px;width:440px;padding:18px;background:#eef2ff;border:2px solid #334155;border-radius:16px;font:24px Microsoft YaHei,sans-serif;color:#172554';
  var button=document.createElement('button');button.textContent='显示答案';
  button.style.cssText='font:inherit;padding:10px 24px;background:#2563eb;color:white;border:0;border-radius:10px;cursor:pointer';
  var answer=document.createElement('p');answer.textContent='答案尚未显示';
  var showAnswer=function(){answer.textContent='正确答案：周期是完成一次往复运动所用的时间。'};
  button.addEventListener('doubleclick',showAnswer);box.append(button,answer);ctx.dom.overlay.appendChild(box);
  return{destroy(){button.removeEventListener('doubleclick',showAnswer);box.remove()}};
}})`

export function flowSurface(document: CourseProjectDocument): FlowSurfaceDocument {
  const surface = document.surfaces.find((item): item is FlowSurfaceDocument => item.type === 'flow')
  if (!surface) throw new Error('The real Flow surface is missing')
  return surface
}
export function spatialSurface(document: CourseProjectDocument): SpatialSurfaceDocument {
  const surface = document.surfaces.find((item): item is SpatialSurfaceDocument => item.type === 'spatial-2d')
  if (!surface) throw new Error('The real Spatial surface is missing')
  return surface
}
export function buttonRuntime(document: CourseProjectDocument): RuntimeLayerItem {
  const item = document.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : [])
    .find(item => item.layerItemId === REMAINING_IDS.brokenRuntime)
  if (!item || item.kind !== 'runtime') throw new Error('The existing button Runtime identity was lost')
  return item
}

export async function writeRemainingLesson(projectPath: string): Promise<CourseProjectArchiveData> {
  const base = await writeNativeLesson(projectPath)
  const flow = addCourseFlowPage(base.project, { title: '摆锤的流式讲义' })
  if (!flow.ok) throw new Error(flow.reason)
  const spatial = addCourseSpatialPage(flow.project, { title: '运动概念无限画布' })
  if (!spatial.ok) throw new Error(spatial.reason)
  const material = addCourseSlidePage(spatial.project, { title: MATERIAL_FIXTURE.blankPageName })
  if (!material.ok) throw new Error(material.reason)
  const project = material.project
  const paper = flowSurface(project), heading = paper.blocks[0]!
  if (heading.type !== 'heading') throw new Error('Formal Flow factory did not create its heading anchor')
  heading.content = { inlines: [{ type: 'text', text: '观察摆锤的运动' }] }
  paper.blocks = [heading, { id: REMAINING_IDS.paragraphOne, type: 'paragraph', content: { inlines: [{ type: 'text', text: FIRST_PARAGRAPH }] } },
    { id: REMAINING_IDS.paragraphTwo, type: 'paragraph', content: { inlines: [{ type: 'text', text: SECOND_PARAGRAPH }] } }]
  project.locations.find(location => location.id === heading.id)!.label = plainDocumentText(heading.content)
  const world = spatialSurface(project)
  world.camera.home = { x: 240, y: -120, zoom: .8 }
  Object.assign(world.camera.frames[0]!, world.camera.home, { name: '当前教学镜头' })
  world.world.layerItems.push(sceneNodeToCourseLayerItem(createShapeNode('ellipse', { id: REMAINING_IDS.spatialObject,
    name: '需要移动的蓝色圆形', x: -220, y: 60, width: 180, height: 140,
    style: { fillColor: '#2563eb', borderColor: '#172554', borderWidth: 3 } }), 1))
  const authored = createPublishedCanvasRuntimeV2Fixture([{ itemId: REMAINING_IDS.brokenRuntime, renderMode: 'dom', source: BROKEN_BUTTON_SOURCE }])
  const runtime = structuredClone(buttonRuntime(authored.project))
  runtime.label = '点击显示答案'; runtime.frame = { mode: 'absolute', x: 635, y: 410, width: 555, height: 290 }
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  if (slide.type !== 'slide') throw new Error('Initial Slide is missing')
  runtime.order = 4; slide.scenes[0]!.layerItems.push(runtime)
  project.playback.controls = 'canvas'
  project.globalLayerItems.push({ item: createControllerFixture({}, 100),
    plane: 'overlay', visibility: { mode: 'all', locationIds: [] } })
  const controllerPackageFiles = Object.fromEntries(Object.entries(controllerPackages).map(([id, pkg]) => [
    `${id}@${pkg.manifest.version}`,
    pkg.files,
  ]))
  project.componentPackages = { ...project.componentPackages, ...controllerMetadata }
  const data = {
    ...base,
    project: courseProjectDocumentSchema.parse(project),
    componentFiles: { ...base.componentFiles, ...controllerPackageFiles },
  }
  writeFileSync(projectPath, createCourseProjectArchive(data))
  return readSaved(projectPath)
}

export async function openSurface(run: NativeRun, kind: 'slide-scene' | 'flow-page' | 'spatial-camera') {
  const row = run.page.getByTestId('course-page-tree').locator(`[data-kind="${kind}"]`).first()
  await row.locator('button.course-page-tree__label').first().click()
  if (kind !== 'slide-scene') await expect(run.page.getByTestId(kind === 'flow-page' ? 'flow-workspace' : 'spatial-workspace')).toBeVisible()
  else await expect(run.page.locator('[data-testid="canvas-stage"] canvas').first()).toBeVisible()
}
