import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { parseComponentPackageFiles } from '../../src/core/drivers/codecs/importComponentPackage'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { HistoryResourceState } from '../../src/renderer/store/courseResourceState'
import { applyEditorTransactionStep } from '../../src/renderer/authoring/editorTransaction'
import {
  FLOW_MENU_COMPONENT_CANCELLED_REASON,
  prepareFlowMenuComponentInsertion,
} from '../../src/renderer/course/flowMenuComponentInsertion'

const png64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg=='
const png = Uint8Array.from(atob(png64), char => char.charCodeAt(0))
const now = '2026-09-27T10:00:00.000Z'
const packageId = 'com.example.menu-flow'

function fixture() {
  const data = parseComponentPackageFiles({
    'manifest.json': new TextEncoder().encode(JSON.stringify({
      schemaVersion: 4, runtimeApiVersion: 4, renderMode: 'dom', supportedScopes: ['scene'],
      id: packageId, name: '菜单组件', version: '1.0.0', entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 }, minSize: { width: 100, height: 80 },
      preserveAspectRatio: false, assets: {}, defaultProps: { title: '默认' },
      presets: [{ id: 'blue', label: '蓝色', props: { title: '预设' } }],
    })),
    'runtime.js': new TextEncoder().encode(`CoursewareComponent.define({id:'${packageId}',runtimeApiVersion:4,create(ctx){const el=document.createElement('div');el.textContent='hello';ctx.dom.root.append(el);return{destroy(){el.remove()}}}})`),
  })
  const base = createBlankCourseProject({ id: 'menu-flow', title: '讲义', now, includeDefaultController: false, controls: 'none' })
  const project = courseProjectDocumentSchema.parse({
    ...base,
    locations: [{ id: 'heading', label: '标题', kind: 'flow-block', surfaceId: 'flow', blockId: 'heading' }],
    startLocationId: 'heading',
    surfaces: [{ id: 'flow', type: 'flow', title: '讲义',
      layout: { readingWidth: 760, wideContentWidth: 1120 }, surfaceLayerItems: [],
      blocks: [{ id: 'heading', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '标题' }] } },
        { id: 'body', type: 'paragraph', content: { inlines: [{ type: 'text', text: '正文' }] } }],
    }],
  })
  const resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }
  const input = { project, resources, target: { projectId: project.id, documentRevision: project.revision,
    locationId: 'heading', surfaceId: 'flow' }, destination: { parentBlockId: null, index: 1, wrap: 'left' as const },
    packageId, packageData: data, presetId: 'blue', props: { title: '自定义' }, width: 420, height: 240, now }
  return { input, project, resources, data }
}

function flow(project: CourseProjectDocument) {
  const result = project.surfaces.find(surface => surface.id === 'flow')
  if (!result || result.type !== 'flow') throw new Error('missing Flow surface')
  return result
}

describe('Flow menu component preparation', () => {
  it('admits only a temporary paper instance and commits a captured body component in one undoable step', async () => {
    const { input, project, resources, data } = fixture()
    const admit = vi.fn(async (candidate: CourseProjectDocument, candidateResources: HistoryResourceState,
      targets: readonly { locationId: string; stateId?: string | null; instanceIds: readonly string[] }[], _signal?: AbortSignal, captureInstances?: boolean) => {
      expect(captureInstances).toBe(true)
      expect(candidateResources.componentPackages[packageId]?.manifest).toEqual(data.manifest)
      expect(candidate.componentPackages[packageId]).toBeDefined()
      expect(flow(candidate).surfaceLayerItems).toHaveLength(1)
      const item = flow(candidate).surfaceLayerItems[0]!.item
      expect(item.kind).toBe('component')
      expect(item.paperSpace).toBe('paper')
      expect(item.frame).toMatchObject({ width: 420, height: 240 })
      expect(targets).toEqual([{ locationId: 'heading', stateId: null, instanceIds: [item.layerItemId] }])
      return [{ instanceId: item.layerItemId, locationId: 'heading', width: 1, height: 1,
        dataUrl: `data:image/png;base64,${png64}` }]
    })
    const step = await prepareFlowMenuComponentInsertion(input, undefined, { admit })
    expect(admit).toHaveBeenCalledOnce()
    expect(project.revision).toBe(0)
    expect(flow(project).surfaceLayerItems).toHaveLength(0)
    expect(step.baseRevision).toBe(0)
    expect(step.nextDocument.revision).toBe(1)
    expect(flow(step.nextDocument).surfaceLayerItems).toHaveLength(0)
    const block = flow(step.nextDocument).blocks[1]
    expect(block).toMatchObject({ type: 'component', props: { title: '自定义' }, wrap: 'left',
      component: { packageId, version: '1.0.0' } })
    if (block?.type !== 'component') throw new Error('missing component')
    expect(step.nextDocument.assets[block.staticFallbackAssetId]).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 })
    expect(step.resourceChanges.assetFileChanges).toEqual([{ assetId: block.staticFallbackAssetId, after: png }])
    expect(step.resourceChanges.componentPackageChanges).toHaveLength(1)
    expect(step.resourceChanges.componentPackageChanges?.[0]?.packageId).toBe(packageId)
    expect(step.resourceChanges.componentPackageChanges?.[0]?.after?.manifest).toEqual(data.manifest)
    expect(Array.from(step.resourceChanges.componentPackageChanges?.[0]?.after?.files['runtime.js'] ?? [])).toEqual(Array.from(data.files['runtime.js'] ?? []))
    const committed = applyEditorTransactionStep({ document: project, resources }, step, 'forward')
    expect(committed.resources.assetFiles[block.staticFallbackAssetId]).toEqual(png)
    expect(applyEditorTransactionStep(committed, step, 'inverse')).toEqual({ document: project, resources })
  })

  it('rejects wrong capture, invalid PNG, cancellation and stale destination without changing the base', async () => {
    const { input, project, resources } = fixture()
    const before = structuredClone(project)
    const capture = { instanceId: 'wrong', locationId: 'heading', width: 1, height: 1, dataUrl: `data:image/png;base64,${png64}` }
    await expect(prepareFlowMenuComponentInsertion(input, undefined, { admit: async () => [capture] })).rejects.toThrow('唯一真实后备图面')
    await expect(prepareFlowMenuComponentInsertion(input, undefined, { admit: async (_project, _resources, targets) => [{
      ...capture, instanceId: targets[0]!.instanceIds[0]!, width: 2,
    }] })).rejects.toThrow('尺寸不一致')
    const controller = new AbortController()
    await expect(prepareFlowMenuComponentInsertion(input, controller.signal, { admit: async () => {
      controller.abort(); return []
    } })).rejects.toThrow(FLOW_MENU_COMPONENT_CANCELLED_REASON)
    await expect(prepareFlowMenuComponentInsertion({ ...input, destination: { parentBlockId: null, index: 99 } }, undefined,
      { admit: vi.fn(async () => []) })).rejects.toThrow('插入位置已经失效')
    expect(project).toEqual(before)
    expect(resources).toEqual({ assetFiles: {}, componentPackages: {} })
  })

  it('uses the initial input snapshot when the caller changes selection and props during admission', async () => {
    const { input } = fixture()
    const step = await prepareFlowMenuComponentInsertion(input, undefined, { admit: async (_project, _resources, targets) => {
      Object.assign(input.destination, { index: 2 })
      input.props!.title = '迟到修改'
      Object.assign(input.target, { locationId: 'other' })
      return [{ instanceId: targets[0]!.instanceIds[0]!, locationId: 'heading', width: 1, height: 1,
        dataUrl: `data:image/png;base64,${png64}` }]
    } })
    expect(flow(step.nextDocument).blocks[1]).toMatchObject({ type: 'component', props: { title: '自定义' } })
    expect(flow(step.nextDocument).blocks[2]).toMatchObject({ type: 'paragraph' })
  })
})
