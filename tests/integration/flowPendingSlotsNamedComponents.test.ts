import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { courseComponentReferences, deleteCourseComponent, renameCourseComponent, setCourseComponent } from '../../src/core/course/courseComponents'
import { normalizeCourseProject } from '../../src/core/course/normalizeCourseProject'
import { planAssetDelete, planAssetMove } from '../../src/core/projectFiles/assetFiles'
import { docFiles, planDocWrite, readDocFile } from '../../src/core/projectFiles/flowDocs'
import { listProjectFiles } from '../../src/core/projectFiles/projectFileView'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { mountCourseComponentBlock } from '../../src/player/surfaces/flow/courseComponentBlock'
import { FlowSurfaceHost } from '../../src/player/surfaces/flow/FlowSurfaceHost'
import { createPublishedSurfaceRuntimeSession } from '../../src/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import { buildPublishedCourseV2Payload, publishCourseComponent } from '../../src/renderer/export/course/buildPublishedCourse'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseComponentDefinition, CourseProjectDocument, FlowBlock, FlowSurfaceDocument } from '../../src/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '../../src/shared/publishedCourseSchema'
import type { DocumentResources } from '../../src/shared/workbench/document'

const DOC = 'docs/讲义.html'
const HANDOUT = `<!doctype html><html><body>
<h1>地球公转</h1>
<figure><img src="../assets/轨道.svg" alt="地球轨道示意图"><figcaption>图 1 轨道</figcaption></figure>
<p><iframe src="../components/公转模拟.html" title="公转演示" style="width:100%;height:360px"></iframe></p>
<iframe src="../components/季节.html" title="季节变化" data-wrap="right"></iframe>
<iframe src="https://example.org/embed"></iframe>
</body></html>`

const ORBIT = { id: 'orbit', filename: '轨道.svg', mimeType: 'image/svg+xml', kind: 'image' as const, path: 'assets/轨道.svg', byteLength: 3 }
const DEFINITION: CourseComponentDefinition = {
  protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
  source: `CoursewareRuntime.define({ runtimeApiVersion: 3, create(ctx) { ctx.dom.root.innerHTML = '<p class="orbit">地球绕太阳公转</p>'; return { destroy() { ctx.dom.root.innerHTML = '' } } } })`,
  content: { values: {} }, assets: {},
}

function written(): { project: CourseProjectDocument; resources: DocumentResources; diagnostics: readonly { code: string }[] } {
  const project = createBlankCourseProject({ id: 'flow-slots', now: '2026-10-04T00:00:00.000Z', includeDefaultController: false, controls: 'none' })
  const resources: DocumentResources = { assets: {}, components: {} }
  const planned = planDocWrite({ project, resources, path: DOC, html: HANDOUT, parse: parseWebComposition })
  return { project: normalizeCourseProject(planned.project), resources: planned.resources, diagnostics: planned.diagnostics }
}
const surfaceOf = (project: CourseProjectDocument) => project.surfaces.find((surface): surface is FlowSurfaceDocument => surface.type === 'flow')!
const blockOf = <T extends FlowBlock['type']>(project: CourseProjectDocument, type: T) =>
  surfaceOf(project).blocks.filter((block): block is Extract<FlowBlock, { type: T }> => block.type === type)

describe('handout pending slots and named components', () => {
  it('reads written references as pending slots and named component blocks, and writes them back unchanged', () => {
    const { project, resources, diagnostics } = written()
    const [media] = blockOf(project, 'media')
    expect(media).toMatchObject({ source: '../assets/轨道.svg', altText: '地球轨道示意图', mediaKind: 'image' })
    expect(media).not.toHaveProperty('assetId')
    expect(blockOf(project, 'course-component').map(({ id: _id, ...block }) => block)).toEqual([
      { type: 'course-component', name: '公转模拟', title: '公转演示', height: 360 },
      { type: 'course-component', name: '季节', title: '季节变化', wrap: 'right' },
    ])
    expect(diagnostics.map(item => item.code)).toEqual(['flow-iframe'])

    const file = docFiles(project).find(value => value.path === DOC)!
    const html = readDocFile(project, file).content
    expect(html).toContain('<img src="../assets/轨道.svg" alt="地球轨道示意图">')
    expect(html).toContain('<iframe src="../components/公转模拟.html" title="公转演示" height="360"></iframe>')
    expect(html).toContain('<iframe src="../components/季节.html" title="季节变化" data-wrap="right"></iframe>')
    const again = planDocWrite({ project, resources, path: DOC, html, parse: parseWebComposition })
    expect(again.diagnostics).toEqual([])
    expect(normalizeCourseProject(again.project).surfaces).toEqual(project.surfaces)

    const listed = listProjectFiles(project, resources, docFiles(project))
    expect(listed).toEqual(expect.arrayContaining([
      { path: 'assets/轨道.svg', type: '待填素材', note: `说明：地球轨道示意图；引用：${DOC}` },
      { path: 'components/公转模拟.html', type: '待写组件', note: `说明：公转演示；引用：${DOC}` },
    ]))
  })

  it('binds a slot when its asset arrives, follows a rename and waits again when the asset goes', () => {
    const { project: initial, resources } = written()
    const arrived = structuredClone(initial)
    arrived.assets.orbit = ORBIT
    let project = normalizeCourseProject(arrived)
    expect(blockOf(project, 'media')[0]).toMatchObject({ source: '../assets/轨道.svg', assetId: 'orbit' })
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
    const file = docFiles(project).find(value => value.path === DOC)!
    expect(readDocFile(project, file).content).toContain('src="../assets/轨道.svg"')

    project = normalizeCourseProject(planAssetMove(project, { ...resources, assets: { orbit: new Uint8Array(3) } }, 'assets/轨道.svg', 'assets/地球轨道.svg').project)
    expect(blockOf(project, 'media')[0]).toMatchObject({ source: '../assets/地球轨道.svg', assetId: 'orbit' })

    project = normalizeCourseProject(planAssetDelete(project, { ...resources, assets: { orbit: new Uint8Array(3) } }, 'assets/地球轨道.svg').project)
    expect(blockOf(project, 'media')[0]).toMatchObject({ source: '../assets/地球轨道.svg' })
    expect(blockOf(project, 'media')[0]).not.toHaveProperty('assetId')
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)

    // A slot never takes an asset of another kind.
    const video = structuredClone(project)
    video.assets.clip = { id: 'clip', filename: '地球轨道.svg', mimeType: 'video/mp4', kind: 'video', path: 'assets/地球轨道.svg', byteLength: 3 }
    expect(blockOf(normalizeCourseProject(video), 'media')[0]).not.toHaveProperty('assetId')
  })

  it('keeps named component blocks on the project-level definition: references, rename and delete', () => {
    let { project } = written()
    project = setCourseComponent(project, '公转模拟', DEFINITION)
    const [orbit] = blockOf(project, 'course-component')
    expect(courseComponentReferences(project, '公转模拟')).toEqual([{ surfaceId: surfaceOf(project).id, blockId: orbit!.id }])
    project = renameCourseComponent(project, '公转模拟', '地球公转')
    expect(blockOf(project, 'course-component').map(block => block.name)).toEqual(['地球公转', '季节'])
    project = normalizeCourseProject(deleteCourseComponent(project, '地球公转'))
    expect(project.components).toBeUndefined()
    expect(blockOf(project, 'course-component').map(block => block.name)).toEqual(['地球公转', '季节'])
  })

  it('publishes the definitions blocks mount, and playback mounts them, with placeholders for the rest', async () => {
    let { project } = written()
    project = normalizeCourseProject(setCourseComponent(project, '公转模拟', DEFINITION))
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    expect(publishedCourseV2Schema.parse(payload)).toEqual(payload)
    expect(Object.keys(payload.courseComponents ?? {})).toEqual(['公转模拟'])
    expect(payload.courseComponents!['公转模拟']).toEqual(publishCourseComponent(DEFINITION))

    const flow = surfaceOf(project)
    const start = payload.locations.find(location => location.surfaceId === flow.id)!
    const container = document.createElement('div')
    document.body.append(container)
    const host = new FlowSurfaceHost({ ...payload, startLocationId: start.id })
    try {
      await host.mount(container)
      await host.activate()
      const mounted = container.querySelector<HTMLElement>('[data-course-component="公转模拟"]')!
      expect(mounted.dataset.courseComponentState).toBe('mounted')
      expect(mounted.style.height).toBe('360px')
      expect(mounted.querySelector('.orbit')?.textContent).toBe('地球绕太阳公转')
      const pending = container.querySelector<HTMLElement>('[data-course-component="季节"]')!
      expect(pending.dataset.courseComponentState).toBe('placeholder')
      expect(pending.textContent).toContain('季节变化')
      const image = container.querySelector<HTMLImageElement>('figure img[data-guoling-pending="asset"]')!
      expect(image.alt).toBe('地球轨道示意图')
      expect(image.src).toMatch(/^data:image\/svg\+xml/)
    } finally {
      await host.destroy()
      container.remove()
    }
  })

  it('shows a draft component with its reason, in the editing view as in playback', () => {
    const container = document.createElement('div')
    const block = { id: 'b', type: 'course-component' as const, name: '季节' }
    const handle = mountCourseComponentBlock(container, {
      block, runtime: publishCourseComponent({ ...DEFINITION, enabled: false, draft: { reason: '第 3 行语法错误' } }),
      width: 600, height: 240, mode: 'authoring', visible: true, resolveAsset: () => undefined, session: createPublishedSurfaceRuntimeSession(),
    })
    expect(container.dataset.courseComponentState).toBe('placeholder')
    expect(container.textContent).toContain('组件未通过检查')
    expect(container.textContent).toContain('第 3 行语法错误')
    handle.destroy()
    expect(container.childElementCount).toBe(0)
  })
})
