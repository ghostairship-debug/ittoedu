// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

const emptyProject = (): CourseProjectV11 => ({
  schemaVersion: 11, id: 'publish-work', revision: 7, title: '通用作品',
  rootIds: [], definitions: {}, instances: {}, assets: {}, global: { underlay: [], overlay: [] },
})

describe('canonical work publication', () => {
  it('reports a draft without an entry instead of manufacturing a presentation container', async () => {
    const project = emptyProject()
    await expect(buildPublishedCourseV4({ project, assetBytes: {} })).rejects.toThrow('作品尚未配置运行入口')
    expect(project.rootIds).toEqual([])
    expect(project.instances).toEqual({})
  })

  it('publishes a source program entry without adding a surface or rewriting the author model', async () => {
    const project = emptyProject()
    project.definitions.program = { id: 'program', role: 'mixed', implementation: {
      kind: 'source', language: 'javascript', source: `export default { mount(context) {
        const button = document.createElement('button'); button.textContent = context.instance.data.label;
        context.root.append(button); return { update(instance) { button.textContent = instance.data.label }, dispose() { button.remove() } };
      } }`,
    } }
    project.instances.app = { id: 'app', definitionId: 'program', data: { label: '运行程序' } }
    project.rootIds = ['app']
    project.entry = { rootInstanceId: 'app' }
    const before = structuredClone(project)

    const result = await buildPublishedCourseV4({ project, assetBytes: {} }, {
      compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()),
    })

    expect(result.payload.schemaVersion).toBe(4)
    expect(result.payload.rootIds).toEqual(['app'])
    expect(result.payload.entry).toEqual({ rootInstanceId: 'app' })
    expect(result.payload).not.toHaveProperty('surfaces')
    expect(result.payload.instances.app).not.toHaveProperty('container')
    expect(result.payload.definitions.program.implementation).toMatchObject({ kind: 'source', compiled: { code: expect.stringContaining('createElement') } })
    // The content value is supplied at runtime, not spliced into its source.
    expect(result.payload.instances.app.data).toEqual({ label: '运行程序' })
    expect(project).toEqual(before)
    expect(result.diagnostics).toEqual([])
  })

  it('retains nested container states and collects their background and override resources', async () => {
    const project = emptyProject()
    project.definitions.flow = { id: 'flow', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.flow' } }
    project.definitions.slide = { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } }
    project.definitions.image = { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
    project.definitions.web = { id: 'web', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.web' } }
    const detailProgram = (side: string) => ({ html: `<p>${side}</p><script type="module" src="./main.js"></script>`,
      modules: { 'main.js': `document.documentElement.dataset.side = '${side}-detail'` } })
    project.instances.flow = { id: 'flow', definitionId: 'flow', data: {}, childIds: ['left', 'right'], container: { kind: 'flow' } }
    project.instances.left = { id: 'left', definitionId: 'slide', data: {}, childIds: ['leftImage', 'leftProgram'], container: {
      kind: 'slide', background: { mode: 'own', assetId: 'nested-background' },
      presentation: { states: [{ id: 'detail', title: '左详情', overrides: { leftImage: { data: { assetId: 'left-detail' } }, leftProgram: { data: detailProgram('left') } },
        background: { mode: 'own', assetId: 'detail-background' } }] },
    } }
    project.instances.right = { id: 'right', definitionId: 'slide', data: {}, childIds: ['rightImage', 'rightProgram'], container: {
      kind: 'slide', presentation: { states: [{ id: 'detail', title: '右详情', overrides: { rightImage: { data: { assetId: 'right-detail' } }, rightProgram: { data: detailProgram('right') } } }] },
    } }
    project.instances.leftImage = { id: 'leftImage', definitionId: 'image', data: { assetId: 'base' } }
    project.instances.rightImage = { id: 'rightImage', definitionId: 'image', data: { assetId: 'base' } }
    project.instances.leftProgram = { id: 'leftProgram', definitionId: 'web', data: { html: '<p>base left</p>' } }
    project.instances.rightProgram = { id: 'rightProgram', definitionId: 'web', data: { html: '<p>base right</p>' } }
    project.rootIds = ['flow']
    project.entry = { rootInstanceId: 'flow' }
    const used = ['base', 'nested-background', 'detail-background', 'left-detail', 'right-detail']
    const assets = [...used, 'unused']
    project.assets = Object.fromEntries(assets.map(id => [id, { id, path: `assets/${id}.svg`, mimeType: 'image/svg+xml' }]))
    const assetBytes = Object.fromEntries(assets.map(id => [id, new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><title>${id}</title></svg>`)]))
    const before = structuredClone(project)

    const result = await buildPublishedCourseV4({ project, assetBytes }, {
      compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()),
    })

    expect(Object.keys(result.payload.assets).sort()).toEqual(used.sort())
    for (const asset of Object.values(result.payload.assets)) expect(asset.url).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(result.payload.instances.left.container?.presentation?.states[0]).toMatchObject({
      id: 'detail', title: '左详情', overrides: { leftImage: { data: { assetId: 'left-detail' } } },
    })
    expect(result.payload.instances.right.container?.presentation?.states[0]).toMatchObject({
      id: 'detail', title: '右详情', overrides: { rightImage: { data: { assetId: 'right-detail' } } },
    })
    const leftData = result.payload.instances.left.container?.presentation?.states[0].overrides.leftProgram.data as Record<string, unknown>
    const rightData = result.payload.instances.right.container?.presentation?.states[0].overrides.rightProgram.data as Record<string, unknown>
    expect(leftData.publishedModuleBundle).toContain('left-detail')
    expect(rightData.publishedModuleBundle).toContain('right-detail')
    expect(result.payload.rootIds).toEqual(['flow'])
    expect(result.payload).not.toHaveProperty('surfaces')
    expect(project).toEqual(before)
    expect(result.diagnostics).toEqual([])
  })
})
