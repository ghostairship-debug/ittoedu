import { describe, expect, it, vi } from 'vitest'
import { createBlankFlowCourseProject, openFlowAuthoringSession } from '@/renderer/project/createFlowCourseProject'
import { createCourseAuthoringSession } from '@/renderer/authoring/courseAuthoringSession'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '@/renderer/course/flowEditorView'
import { createFlowAuthoringSlice, type FlowAuthoringPorts } from '@/renderer/store/slices/flowAuthoringSlice'
import { applyHistoryResourceChanges, type CourseResourceState } from '@/renderer/store/courseResourceState'
import { emptyCourseAssetSidecar } from '@/renderer/project/v9AssetAdapter'
import { componentPackageMeta } from '@/shared/componentPackageMeta'
import { flowSurfaceIn } from '@/core/tools/flowDocumentModel'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type { ComponentLayerItem } from '@/shared/courseProjectTypes'
import type { EditorStoreKernel } from '@/renderer/store/editorStoreKernel'

const frame = { mode: 'absolute' as const, x: 54, y: 76, width: 280, height: 160 }

function componentData(): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
    schemaVersion: 4, runtimeApiVersion: 4, supportedScopes: ['scene'], renderMode: 'phaser',
    id: 'menu.paper.card', name: '纸面卡片', version: '1.0.0', entry: 'runtime.js',
    defaultSize: { width: 280, height: 160 }, minSize: { width: 100, height: 80 },
    preserveAspectRatio: false, assets: {}, defaultProps: {},
  }
  const runtimeSource = 'window.CoursewareComponent.define({})'
  return { manifest, runtimeSource, files: {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(runtimeSource),
  } }
}

function item(data: ComponentPackageData): ComponentLayerItem {
  return { kind: 'component', layerItemId: 'paper-card', label: '纸面卡片', frame,
    order: 1, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    component: { packageId: data.manifest.id, version: data.manifest.version }, props: {},
  }
}

function harness(installed = false) {
  const project = createBlankFlowCourseProject()
  const data = componentData()
  let session = openFlowAuthoringSession(project)
  let owner = createCourseAuthoringSession({ locationId: session.selection.locationId, surfaceType: 'flow', revision: project.revision })
  let mode: 'edit' | 'run' = 'edit'
  let draft = false
  let resources: CourseResourceState = {
    courseAssetSidecar: emptyCourseAssetSidecar(), courseAssetSidecarPast: [], courseAssetSidecarFuture: [],
    courseComponentPackagesPast: [], courseComponentPackagesFuture: [],
    componentPackages: installed ? { [data.manifest.id]: data } : {},
  }
  const persist: FlowAuthoringPorts['persist'] = vi.fn((result, extra) => {
    if (!result.ok) return result
    session = { history: extra?.replaceHistory ?? session.history, selection: result.selection ?? session.selection }
    if (extra?.transactionStep) {
      const applied = applyHistoryResourceChanges({ componentPackages: resources.componentPackages,
        assetFiles: resources.courseAssetSidecar!.files }, extra.transactionStep.resourceChanges, 'forward')
      resources = { ...resources, componentPackages: { ...applied.componentPackages } }
    }
    owner = createCourseAuthoringSession({ locationId: session.selection.locationId, surfaceType: 'flow', revision: session.history.present.revision })
    return result
  })
  const ports: FlowAuthoringPorts = {
    read: () => ({ flowSession: session, flowTextEdit: null, flowDocumentDraft: draft ? {
      surfaceId: session.selection.surfaceId, revision: session.history.present.revision,
      source: 'draft', diagnostics: [], composing: false,
    } : null, flowClipboard: null }),
    readAuthoringSession: () => owner, readAssetSidecar: () => resources.courseAssetSidecar,
    readCanvasMode: () => mode, patch: () => undefined, persist, applyBackend: () => undefined,
  }
  const kernel = { readResources: () => resources } as EditorStoreKernel
  const run = createFlowAuthoringSlice(kernel, ports).runFlowAuthoringIntent
  const target = (kind: 'surface' | 'block' = 'surface') => captureFlowEditorAuthoringTarget({
    view: buildFlowEditorView({ project: session.history.present, locationId: session.selection.locationId }),
    sessionToken: owner.token, target: kind === 'surface' ? { kind: 'surface' }
      : { kind: 'block', blockId: flowSurfaceIn(session.history.present, session.selection.surfaceId).blocks[0]!.id },
  })
  const intent = () => ({ kind: 'menu-insert-paper-component' as const, item: item(data), frame,
    paragraphAnchor: { blockId: flowSurfaceIn(session.history.present, session.selection.surfaceId).blocks[0]!.id,
      offsetY: 12, xRatio: 0.4 }, packageData: data })
  return { run, target, intent, persist, data, get session() { return session }, get resources() { return resources },
    setMode(value: 'edit' | 'run') { mode = value }, setDraft(value: boolean) { draft = value },
    setResourcePackage(value: ComponentPackageData) { resources = { ...resources,
      componentPackages: { [value.manifest.id]: value } } },
  }
}

describe('Flow paper component menu transaction', () => {
  it('embeds a fresh package, anchored item and resource in one history step', () => {
    const h = harness(); const before = h.session.history.present
    const receipt = h.run(h.target(), h.intent())
    expect(receipt.ok, receipt.reason).toBe(true)
    const next = h.session.history.present
    const entry = flowSurfaceIn(next, h.session.selection.surfaceId).surfaceLayerItems[0]!
    expect(next.revision).toBe(before.revision + 1)
    expect(h.session.history.past).toHaveLength(1)
    expect(entry.item).toMatchObject({ kind: 'component', paperSpace: 'paper', layerItemId: 'paper-card' })
    expect(entry.paragraphAnchor).toMatchObject(h.intent().paragraphAnchor)
    expect(next.componentPackages[h.data.manifest.id]).toEqual(componentPackageMeta(h.data))
    expect(h.resources.componentPackages[h.data.manifest.id]).toBeDefined()
    expect(h.session.selection.selectedOverlayIds).toEqual(['paper-card'])
    expect(h.persist).toHaveBeenCalledTimes(1)
    expect(vi.mocked(h.persist).mock.calls[0]?.[1]?.transactionStep?.resourceChanges.componentPackageChanges).toHaveLength(1)
  })

  it('uses installed resource data while embedding missing project metadata', () => {
    const h = harness(true)
    const receipt = h.run(h.target('block'), h.intent())
    expect(receipt.ok, receipt.reason).toBe(true)
    expect(h.session.history.present.componentPackages[h.data.manifest.id]).toEqual(componentPackageMeta(h.data))
    expect(vi.mocked(h.persist).mock.calls[0]?.[1]?.transactionStep?.resourceChanges.componentPackageChanges).toBeUndefined()
    expect(h.session.history.past).toHaveLength(1)
  })

  it('rejects stale, global, run, draft and invalid package without committing', () => {
    const cases = [
      (h: ReturnType<typeof harness>) => h.run({ ...h.target(), documentRevision: -1 }, h.intent()),
      (h: ReturnType<typeof harness>) => h.run({ ...h.target(), surfaceId: 'foreign' }, h.intent()),
      (h: ReturnType<typeof harness>) => h.run({ ...h.target(), owner: 'global' }, h.intent()),
      (h: ReturnType<typeof harness>) => { h.setMode('run'); return h.run(h.target(), h.intent()) },
      (h: ReturnType<typeof harness>) => { h.setDraft(true); return h.run(h.target(), h.intent()) },
      (h: ReturnType<typeof harness>) => h.run(h.target(), { ...h.intent(), packageData: {
        ...h.data, manifest: { ...h.data.manifest, version: '2.0.0' },
      } }),
      (h: ReturnType<typeof harness>) => h.run(h.target(), { ...h.intent(), paragraphAnchor: { blockId: 'foreign', offsetY: 0, xRatio: 0 } }),
    ]
    for (const test of cases) {
      const h = harness(); expect(test(h).ok).toBe(false)
      expect(h.persist).toHaveBeenCalledTimes(0)
      expect(h.session.history.present.revision).toBe(0)
    }
  })

  it('rejects a conflicting installed package before document or resource writes', () => {
    const h = harness(true)
    h.setResourcePackage({ ...h.data, manifest: { ...h.data.manifest, version: '2.0.0' } })
    const receipt = h.run(h.target(), h.intent())
    expect(receipt.ok).toBe(false)
    expect(h.persist).toHaveBeenCalledTimes(0)
  })
})
