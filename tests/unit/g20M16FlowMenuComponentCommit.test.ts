import { describe, expect, it, vi } from 'vitest'
import { createBlankFlowCourseProject, openFlowAuthoringSession } from '@/renderer/project/createFlowCourseProject'
import { createCourseAuthoringSession } from '@/renderer/authoring/courseAuthoringSession'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '@/renderer/course/flowEditorView'
import { createFlowAuthoringSlice, type FlowAuthoringPorts } from '@/renderer/store/slices/flowAuthoringSlice'
import { insertFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { createEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { applyHistoryResourceChanges, type CourseResourceState } from '@/renderer/store/courseResourceState'
import { emptyCourseAssetSidecar, freezeCourseAssetSidecar } from '@/renderer/project/v9AssetAdapter'
import { componentPackageMeta } from '@/shared/componentPackageMeta'
import { flowSurfaceIn } from '@/core/tools/flowDocumentModel'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type { CourseAuthoringTarget } from '@/renderer/authoring/courseAuthoringSession'
import type { EditorStoreKernel } from '@/renderer/store/editorStoreKernel'
import type { FlowDocumentDraft } from '@/renderer/store/slices/flowAuthoringSlice'

const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
function componentData(): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
    schemaVersion: 4, runtimeApiVersion: 4, supportedScopes: ['scene'], renderMode: 'phaser',
    id: 'menu.card', name: '卡片', version: '1.0.0', entry: 'runtime.js',
    defaultSize: { width: 320, height: 180 }, minSize: { width: 120, height: 80 },
    preserveAspectRatio: false, assets: {}, defaultProps: {},
  }
  return { manifest, runtimeSource: 'window.CoursewareComponent.define({})', files: {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode('window.CoursewareComponent.define({})'),
  } }
}

function harness(options: { existingPackage?: boolean } = {}) {
  const project = createBlankFlowCourseProject()
  const existingData = componentData()
  if (options.existingPackage) {
    project.componentPackages[existingData.manifest.id] = componentPackageMeta(existingData, {
      editableCopy: true, sourcePackageId: 'source.card',
    })
  }
  let session = openFlowAuthoringSession(project)
  let owner = createCourseAuthoringSession({ locationId: session.selection.locationId, surfaceType: 'flow', revision: project.revision })
  let mode: 'edit' | 'run' = 'edit'
  let draft: FlowDocumentDraft | null = null
  let textEdit: FlowAuthoringPorts['read'] extends () => infer R ? R extends { flowTextEdit: infer E } ? E : never : never = null
  let resources: CourseResourceState = {
    courseAssetSidecar: emptyCourseAssetSidecar(), courseAssetSidecarPast: [], courseAssetSidecarFuture: [],
    courseComponentPackagesPast: [], courseComponentPackagesFuture: [],
    componentPackages: options.existingPackage ? { [existingData.manifest.id]: existingData } : {},
  }
  const persist: FlowAuthoringPorts['persist'] = vi.fn((result, extra) => {
    if (!result.ok) return result
    const next = result.nextDocument ?? session.history.present
    session = { history: extra?.replaceHistory ?? { ...session.history, present: next }, selection: result.selection ?? session.selection }
    if (extra?.transactionStep) {
      const applied = applyHistoryResourceChanges({ componentPackages: resources.componentPackages,
        assetFiles: resources.courseAssetSidecar!.files }, extra.transactionStep.resourceChanges, 'forward')
      resources = { ...resources, componentPackages: { ...applied.componentPackages },
        courseAssetSidecar: freezeCourseAssetSidecar(applied.assetFiles) }
    }
    owner = createCourseAuthoringSession({ locationId: session.selection.locationId, surfaceType: 'flow', revision: next.revision })
    return result
  })
  const ports: FlowAuthoringPorts = {
    read: () => ({ flowSession: session, flowTextEdit: textEdit, flowDocumentDraft: draft, flowClipboard: null }),
    readAuthoringSession: () => owner, readAssetSidecar: () => resources.courseAssetSidecar,
    readCanvasMode: () => mode, patch: () => undefined, persist, applyBackend: () => undefined,
  }
  const kernel = { readResources: () => resources } as EditorStoreKernel
  const commit = createFlowAuthoringSlice(kernel, ports).commitFlowMenuComponentAtTarget
  const target = (): CourseAuthoringTarget => captureFlowEditorAuthoringTarget({
    view: buildFlowEditorView({ project: session.history.present, locationId: session.selection.locationId }),
    sessionToken: owner.token, target: { kind: 'surface' },
  })
  function step(): EditorTransactionStep {
    const before = session.history.present
    const pkg = componentData()
    const prepared = structuredClone(before)
    if (!prepared.componentPackages[pkg.manifest.id]) prepared.componentPackages[pkg.manifest.id] = componentPackageMeta(pkg)
    prepared.assets.fallback = { id: 'fallback', filename: 'fallback.png', mimeType: 'image/png', kind: 'image',
      path: 'assets/fallback.png', byteLength: imageBytes.length, width: 64, height: 64 }
    const inserted = insertFlowEditorBlock(prepared, {
      surfaceId: session.selection.surfaceId, parentId: null, index: flowSurfaceIn(prepared, session.selection.surfaceId).blocks.length,
      block: { type: 'component', component: { packageId: pkg.manifest.id, version: pkg.manifest.version },
        props: {}, staticFallbackAssetId: 'fallback' },
    }, { expectedRevision: before.revision })
    if (!inserted.ok || !inserted.nextDocument || !inserted.createdBlockIds?.[0]) throw new Error(inserted.reason ?? 'insert failed')
    const made = createEditorTransactionStep(before, { projectId: before.id, baseRevision: before.revision,
      nextDocument: inserted.nextDocument,
      resourceChanges: { assetFileChanges: [{ assetId: 'fallback', after: imageBytes }],
        ...(!options.existingPackage ? { componentPackageChanges: [{ packageId: pkg.manifest.id, after: pkg }] } : {}) },
      selectionHint: { kind: 'authoring-tool-selection', locationId: session.selection.locationId, stateId: null,
        owner: 'surface', itemIds: [inserted.createdBlockIds[0]], flowCarrier: 'block' },
    })
    if (!made) throw new Error('empty step')
    return made
  }
  return { commit, target, step, persist, get session() { return session }, get resources() { return resources },
    setMode(value: 'edit' | 'run') { mode = value }, setDraft(value: FlowDocumentDraft | null) { draft = value },
    setTextEdit(value: typeof textEdit) { textEdit = value },
    setResources(value: CourseResourceState) { resources = value },
  }
}

describe('Flow menu component commit port', () => {
  it('commits one document revision, history entry, package, asset bytes and new block selection', () => {
    const h = harness(); const target = h.target(); const step = h.step(); const before = h.session.history.present
    const receipt = h.commit(target, step)
    expect(receipt).toMatchObject({ ok: true, historyEntry: true })
    expect(h.session.history.present.revision).toBe(before.revision + 1)
    expect(h.session.history.past).toHaveLength(1)
    expect(h.session.selection.selectedBlockId).toBe((step.selectionHint as { itemIds: string[] }).itemIds[0])
    expect(h.resources.componentPackages['menu.card']).toBeDefined()
    expect(Array.from(h.resources.courseAssetSidecar!.files.fallback!)).toEqual(Array.from(imageBytes))
    expect(h.persist).toHaveBeenCalledTimes(1)
  })

  it('accepts an existing editable package without a package resource change', () => {
    const h = harness({ existingPackage: true }); const target = h.target(); const step = h.step()
    expect(step.resourceChanges.componentPackageChanges).toBeUndefined()
    const receipt = h.commit(target, step)
    expect(receipt.ok, receipt.reason).toBe(true)
    expect(receipt).toMatchObject({ ok: true, historyEntry: true })
    expect(h.session.history.present.componentPackages['menu.card']).toMatchObject({
      editableCopy: true, sourcePackageId: 'source.card',
    })
    expect(h.session.history.past).toHaveLength(1)
    expect(h.persist).toHaveBeenCalledTimes(1)
  })

  it('rejects stale target, cross page, run mode, global owner and drafts without a write', () => {
    for (const mutate of [
      (h: ReturnType<typeof harness>, t: CourseAuthoringTarget) => ({ ...t, documentRevision: t.documentRevision - 1 }),
      (_h: ReturnType<typeof harness>, t: CourseAuthoringTarget) => ({ ...t, locationId: 'foreign' }),
      (_h: ReturnType<typeof harness>, t: CourseAuthoringTarget) => ({ ...t, owner: 'global' as const }),
    ]) {
      const h = harness(); const target = h.target(); const step = h.step()
      expect(h.commit(mutate(h, target), step).ok).toBe(false)
      expect(h.persist).toHaveBeenCalledTimes(0)
    }
    const h = harness(); const target = h.target(); const step = h.step()
    h.setMode('run'); expect(h.commit(target, step).ok).toBe(false)
    h.setMode('edit'); h.setDraft({ surfaceId: target.surfaceId, revision: target.documentRevision,
      source: 'draft', diagnostics: [], composing: false }); expect(h.commit(target, step).ok).toBe(false)
    h.setDraft(null); h.setTextEdit({} as never); expect(h.commit(target, step).ok).toBe(false)
    expect(h.persist).toHaveBeenCalledTimes(0)
  })

  it('rejects forged document, selection, and resource baselines', () => {
    const h = harness(); const target = h.target(); const step = h.step()
    const badSteps: EditorTransactionStep[] = [
      { ...step, projectId: 'foreign' },
      { ...step, baseRevision: step.baseRevision + 1 },
      { ...step, previousDocument: { ...step.previousDocument, title: 'forged' } },
      { ...step, nextDocument: { ...step.nextDocument, title: 'extra edit' } },
      { ...step, nextDocument: { ...step.nextDocument, assets: { ...step.nextDocument.assets,
        extra: { ...step.nextDocument.assets.fallback!, id: 'extra', path: 'assets/extra.png' } } } },
      { ...step, selectionHint: { ...(step.selectionHint as object), locationId: 'foreign' } },
      { ...step, selectionHint: { ...(step.selectionHint as object), itemIds: ['missing'] } },
      { ...step, resourceChanges: { ...step.resourceChanges, assetFileChanges: [{ assetId: 'fallback', before: Uint8Array.of(7), after: imageBytes }] } },
      { ...step, resourceChanges: { ...step.resourceChanges, componentPackageChanges: [] } },
    ]
    for (const bad of badSteps) expect(h.commit(target, bad).ok).toBe(false)
    expect(h.persist).toHaveBeenCalledTimes(0)
    h.setResources({ ...h.resources, courseAssetSidecar: freezeCourseAssetSidecar({ fallback: imageBytes }) })
    expect(h.commit(target, step).ok).toBe(false)
    expect(h.persist).toHaveBeenCalledTimes(0)
  })
})
