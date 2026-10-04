// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { normalizeCourseProject } from '../../src/core/course/normalizeCourseProject'
import { planSpaceWrite, readSpaceFile, readSpaceHtml, spaceDocument } from '../../src/core/projectFiles/spaceHtml'
import { spaceFiles, targetSpace } from '../../src/core/projectFiles/spaceFiles'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { spatialSteppingStops } from '../../src/shared/composition/spatialStopSteps'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { spatialCard } from '../helpers/spatialStopsFixture'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'

const resources = { assets: {}, components: {} }
let id = 0
const write = (project: CourseProjectDocument, html: string) => normalizeCourseProject(planSpaceWrite({ project, resources,
  path: 'spaces/旅程.html', html, parse: parseWebComposition, createId: () => String(++id) }).project)
const space = (project: CourseProjectDocument) => spaceFiles(project)[0]!.surface
export const SPACE_HTML = '<!doctype html><html lang="zh"><head><style>.step { width:800px;height:450px;background:#eee } h2 { color:navy }</style></head><body><main id="impress"><!--作者注释--><section id="a" class="step" data-x="0" data-y="0"><h2>起点 &amp; 问题</h2><p class="fragment">观察</p><p class="fragment">解释</p></section><section id="b" class="step" data-x="1200" data-y="200" data-scale="2" data-rotate="30"><h2>结论</h2><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5"></circle></svg></section><aside id="scenery" data-x="400" data-y="500" style="width:100px;height:100px">布景</aside></main></body></html>'

describe('ordinary spatial HTML projection', () => {
  it('saves a scenery-only space without inventing a stop or rejecting the rest of the course', () => {
    const project = write(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
      '<aside data-x="400" data-y="300">尚未规划镜头的布景</aside>')
    const surface = space(project)
    expect(surface.camera.frames).toEqual([])
    expect(project.locations.filter(location => location.surfaceId === surface.id)).toEqual([])
    expect(project.locations.some(location => location.id === project.startLocationId)).toBe(true)
    const driver = new CourseV9Driver()
    const reopened = driver.load(driver.serialize({ kind: 'course-v9', project, resources }))
    if (reopened.kind !== 'course-v9') throw new Error('Expected course')
    expect(readSpaceHtml(reopened.project, space(reopened.project))).toContain('尚未规划镜头的布景')
    expect(buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: {}, components: {} }).surfaces
      .find(value => value.id === surface.id)).toBeDefined()
  })
  it('plays the written spatial HTML with real turned/scaled composition carriers and stop fragments', async () => {
    const project = write(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), SPACE_HTML)
    const surface = space(project), item = [...spaceDocument(project, surface).objects.values()][0]!, second = [...spaceDocument(project, surface).objects.values()][1]!
    const locations = project.locations.filter(location => location.surfaceId === surface.id)
    project.startLocationId = locations[0]!.id
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    const bundle = (await build({ stdin: { contents: "export {createPublishedCourseSession} from './src/player/surfaces/publishedDynamicHosts';", resolveDir: process.cwd(), loader: 'ts' },
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'SpaceTest', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      await page.setContent('<div id="host" style="width:1280px;height:720px"></div>')
      await page.addScriptTag({ content: bundle })
      await page.evaluate(async payload => { const session = (window as any).SpaceTest.createPublishedCourseSession(payload); await session.mount(document.getElementById('host')!); (window as any).session = session }, payload)
      const card = page.frameLocator(`iframe[data-web-composition="${item.layerItemId}"]`), rotated = page.frameLocator(`iframe[data-web-composition="${second.layerItemId}"]`)
      await card.locator('#a').waitFor({ state: 'attached' })
      expect(await card.locator('p.fragment').first().evaluate(node => node.hasAttribute('data-guoling-step-hidden'))).toBe(true)
      expect(await rotated.locator('#b').evaluate(node => node.getBoundingClientRect().width)).toBeCloseTo(1600)
      const before = await page.locator('[data-spatial-world]').getAttribute('transform')
      await page.evaluate(() => (window as any).session.nextStep())
      expect(await card.locator('p.fragment').first().evaluate(node => node.hasAttribute('data-guoling-step-hidden'))).toBe(false)
      expect(await card.locator('p.fragment').last().evaluate(node => node.hasAttribute('data-guoling-step-hidden'))).toBe(true)
      expect(await page.locator('[data-spatial-world]').getAttribute('transform')).toBe(before)
      await page.evaluate(() => (window as any).session.nextStep())
      await page.evaluate(() => (window as any).session.nextStep())
      expect(await page.evaluate(() => (window as any).session.navigator.current.locationId)).toBe(locations[1]!.id)
      expect(await page.locator('[data-spatial-world]').getAttribute('transform')).toContain('rotate(-30)')
      expect(await page.evaluate(() => (window as any).session.nextStep())).toBe(false)
      await page.evaluate(() => (window as any).session.destroy())
    } finally { await browser.close() }
  })

  it('keeps a scripted space as one admitted program source, without silently dismantling its behavior', () => {
    const initial = write(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), SPACE_HTML)
    const html = '<!doctype html><html><body><button>开始</button><script>document.querySelector("button").onclick=()=>{document.body.dataset.done="true"}</script></body></html>'
    const project = write(initial, html)
    expect(space(project).world.layerItems).toHaveLength(1)
    expect(space(project).world.layerItems[0]!.kind).toBe('runtime')
    expect(readSpaceHtml(project, space(project))).toBe(html)
    expect(space(project).camera.frames.every(frame => frame.targetLayerItemId === undefined)).toBe(true)
    expect(courseProjectDocumentSchema.parse(project)).toBeDefined()
    const ordinary = write(project, '<section class="step"><h2>返回普通 HTML</h2></section>')
    expect(space(ordinary).world.layerItems.every(item => item.kind === 'composition')).toBe(true)
    expect(courseProjectDocumentSchema.parse(ordinary)).toBeDefined()
  })

  it('maps stops, geometry and fragments, preserving ordinary HTML and identities through the real archive', () => {
    const project = write(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), SPACE_HTML)
    const surface = space(project)
    expect(surface.world.layerItems).toHaveLength(4)
    expect(surface.camera.frames).toHaveLength(2)
    const objects = [...spaceDocument(project, surface).objects.values()]
    expect(objects[0]).toMatchObject({ frame: { x: -400, y: -225, width: 800, height: 450 }, rotation: 0 })
    expect(objects[1]).toMatchObject({ frame: { x: 400, y: -250, width: 1600, height: 900 }, rotation: 30 })
    expect(surface.camera.frames[1]).toMatchObject({ x: 1200, y: 200, rotation: 30, targetLayerItemId: objects[1]!.layerItemId })
    expect(surface.camera.frames[1]!.zoom).toBeCloseTo(0.72)
    expect([...spatialSteppingStops(surface, project.locations).values()]).toEqual([{ layerItemId: objects[0]!.layerItemId, count: 2 }])
    expect(readSpaceHtml(project, surface)).toBe(SPACE_HTML.replace('<!doctype html>', '<!doctype html>\n'))
    const again = write(project, readSpaceHtml(project, surface))
    expect(space(again)).toEqual(surface)
    expect(again.locations).toEqual(project.locations)
    const driver = new CourseV9Driver(), model = { kind: 'course-v9' as const, project, resources }
    const opened = driver.load(driver.serialize(model))
    if (opened.kind !== 'course-v9') throw new Error('course')
    expect(space(opened.project)).toEqual(surface)
    expect(readSpaceHtml(opened.project, space(opened.project))).toBe(readSpaceHtml(project, surface))
  })

  it('keeps anchored block and stop identities when reordered and edited, and removes stops when a block becomes scenery', () => {
    const first = write(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), SPACE_HTML)
    const before = spaceDocument(first, space(first)), items = [...before.objects.values()]
    const source = readSpaceHtml(first, space(first)), a = source.match(/<section id="a"[\s\S]*?<\/section>/)![0], b = source.match(/<section id="b"[\s\S]*?<\/section>/)![0]
    const next = write(first, source.replace(a + b, b.replace('结论', '新结论') + a.replace('解释', '新解释')))
    const after = [...spaceDocument(next, space(next)).objects.values()]
    expect(after.map(item => item.layerItemId)).toEqual([items[1]!.layerItemId, items[0]!.layerItemId, items[2]!.layerItemId])
    expect(space(next).camera.frames.map(frame => frame.id)).toEqual([space(first).camera.frames[1]!.id, space(first).camera.frames[0]!.id])
    const scenery = write(next, readSpaceHtml(next, space(next)).replace('id="a" class="step"', 'id="a" class="scenery"'))
    expect(space(scenery).camera.frames.map(frame => frame.targetLayerItemId)).toEqual([items[1]!.layerItemId])
    expect(courseProjectDocumentSchema.parse(scenery)).toBeDefined()
    const plain = write(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), '<section class="step"><h2>甲</h2></section><section class="step"><h2>乙</h2></section>')
    const moved = write(plain, '<section class="step"><h2>乙</h2></section><section class="step"><h2>甲</h2></section>')
    expect(space(moved).camera.frames.map(frame => frame.id)).toEqual(space(plain).camera.frames.map(frame => frame.id).reverse())
  })

  it('reads editor geometry and subtree changes back, preserving unrelated independently owned objects', () => {
    const initial = write(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), SPACE_HTML)
    const surface = space(initial), item = [...spaceDocument(initial, surface).objects.values()][1]!
    item.frame.x += 200; item.rotation = 45
    surface.world.layerItems.push(spatialCard('independent', { x: 3000, y: 0, width: 200, height: 100 }, 0, []))
    // An added composition is independent of an already projected source.
    const html = readSpaceHtml(initial, surface)
    expect(readSpaceFile(initial, surface).objects).toEqual(['组合内容“independent”'])
    expect(html).toContain('data-x="1400"'); expect(html).toContain('data-rotate="45"')
    const next = write(initial, html.replace('起点 &amp; 问题', '人工改题 &amp; 问题'))
    expect(space(next).world.layerItems.find(item => item.layerItemId === 'independent')).toEqual(surface.world.layerItems.at(-1))
    expect(readSpaceHtml(next, space(next))).toContain('人工改题 &amp; 问题')
    expect(space(next).camera.frames[1]).toMatchObject({ x: 1400, rotation: 45 })
    expect(() => write(next, readSpaceHtml(next, space(next)).replace('data-x="1400"', 'data-x="无效"'))).toThrow('有效数字')
  })

  it('projects existing ordinary world compositions without replacing their object or followed stop ids', () => {
    const located = targetSpace(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), 'spaces/旅程.html')
    located.surface.world.layerItems.push(spatialCard('existing', { x: 100, y: 20, width: 400, height: 200 }, 15, ['观察']))
    located.surface.camera.frames[0]!.targetLayerItemId = 'existing'
    const project = normalizeCourseProject(located.project)
    const next = write(project, readSpaceHtml(project, space(project)))
    expect(space(next).world.layerItems.find(item => item.layerItemId === 'existing')).toMatchObject({ frame: space(project).world.layerItems[0]!.frame, rotation: 15 })
    expect(space(next).camera.frames[0]!.id).toBe(space(project).camera.frames[0]!.id)
    expect([...spatialSteppingStops(space(next), next.locations).values()][0]).toEqual({ layerItemId: 'existing', count: 1 })
  })
})
