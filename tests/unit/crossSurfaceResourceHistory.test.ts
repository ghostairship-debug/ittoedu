import { describe, expect, it } from 'vitest'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { createEditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import {
  commitFlowEditorHistory,
  commitFlowEditorTransactionHistory,
  createFlowEditorHistory,
  flowEditorLegacyHistoryEntryCount,
  flowEditorRedoResourceTransition,
  flowEditorUndoResourceTransition,
  isFlowEditorTransactionFrame,
  redoFlowEditorHistory,
  undoFlowEditorHistory,
} from '@/renderer/course/flowEditorSlice'
import {
  commitSpatialAuthoringHistory,
  commitSpatialEditorTransactionHistory,
  createSpatialAuthoringHistory,
  isSpatialAuthoringTransactionFrame,
  redoSpatialAuthoringHistory,
  spatialAuthoringLegacyHistoryEntryCount,
  spatialAuthoringRedoResourceTransition,
  spatialAuthoringUndoResourceTransition,
  SPATIAL_REJECT_STALE_REVISION,
  SpatialCommandError,
  undoSpatialAuthoringHistory,
} from '@/renderer/course/spatialAuthoringHistory'
import {
  commitSlideActionTransaction,
  commitSlideAuthoringHistory,
  commitSlideEditorTransactionHistory,
  createSlideAuthoringHistory,
  isSlideAuthoringTransactionFrame,
  redoSlideAuthoringHistory,
  SLIDE_REJECT_STALE_REVISION,
  SlideCommandError,
  slideAuthoringLegacyHistoryEntryCount,
  slideAuthoringRedoResourceTransition,
  slideAuthoringUndoResourceTransition,
  undoSlideAuthoringHistory,
} from '@/renderer/course/slideEditorCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { applyHistoryResourceChanges } from '@/renderer/store/courseResourceState'

const NOW = '2026-08-24T12:00:00.000Z'

function sequentialIdFactory() {
  let index = 0
  return () => `history-${index += 1}`
}

function flowProject(): CourseProjectDocument {
  return createBlankFlowCourseProject({
    id: 'flow-resource-history',
    now: NOW,
    controls: 'none',
    includeDefaultController: false,
    idFactory: sequentialIdFactory(),
  })
}

function spatialProject(): CourseProjectDocument {
  return createBlankSpatialCourseProject({
    id: 'spatial-resource-history',
    now: NOW,
    controls: 'none',
    includeDefaultController: false,
    idFactory: sequentialIdFactory(),
  })
}

function slideProject(): CourseProjectDocument {
  return createBlankCourseProject({
    id: 'slide-resource-history',
    now: NOW,
    controls: 'none',
    includeDefaultController: false,
    idFactory: sequentialIdFactory(),
  })
}

function nextDocument(
  project: CourseProjectDocument,
  marker: string,
): CourseProjectDocument {
  const next = structuredClone(project)
  next.revision = project.revision + 1
  next.updatedAt = NOW
  next.title = marker
  return courseProjectDocumentSchema.parse(next)
}

function componentPackage(
  id: string,
  bytes: Uint8Array,
): ComponentPackageData {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      entry: 'index.js',
      schemaVersion: 4,
      runtimeApiVersion: 4,
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 80, height: 45 },
      preserveAspectRatio: true,
      assets: {},
      defaultProps: {},
      supportedScopes: ['scene'],
      renderMode: 'dom',
    },
    runtimeSource: 'export default {}',
    files: { 'index.js': bytes },
  }
}

describe('Flow resource-aware authoring history', () => {
  it('mixes legacy documents with a cloned transaction frame and exact resource transitions', () => {
    const initial = flowProject()
    const legacy = nextDocument(initial, 'legacy')
    const transactional = nextDocument(legacy, 'transactional')
    const sourceBytes = new Uint8Array([1, 2, 3])
    const step = createEditorTransactionStep(legacy, {
      projectId: legacy.id,
      baseRevision: legacy.revision,
      nextDocument: transactional,
      resourceChanges: {
        assetFileChanges: [{ assetId: 'flow-image', after: sourceBytes }],
      },
    })
    if (!step) throw new Error('Expected a non-empty transaction step')

    let history = createFlowEditorHistory(initial)
    history = commitFlowEditorHistory(history, legacy)
    history = commitFlowEditorTransactionHistory(history, step)

    expect(history.present).toBe(step.nextDocument)
    expect(history.past).toHaveLength(2)
    expect(history.past[0]).toBe(initial)
    const frame = history.past[1]!
    expect(isFlowEditorTransactionFrame(frame)).toBe(true)
    if (!isFlowEditorTransactionFrame(frame)) throw new Error('Expected transaction frame')
    expect(frame.document).toBe(legacy)
    expect(frame.resourceChanges).not.toBe(step.resourceChanges)
    expect(frame.resourceChanges.assetFileChanges![0]!.after)
      .not.toBe(step.resourceChanges.assetFileChanges![0]!.after)

    sourceBytes[0] = 99
    expect([...frame.resourceChanges.assetFileChanges![0]!.after!]).toEqual([1, 2, 3])

    const populatedResources = applyHistoryResourceChanges({
      componentPackages: {},
      assetFiles: {},
    }, step.resourceChanges, 'forward')
    const undoTransition = flowEditorUndoResourceTransition(history)
    expect(undoTransition?.resourceDirection).toBe('inverse')
    const revertedResources = applyHistoryResourceChanges(
      populatedResources,
      undoTransition!.resourceChanges,
      undoTransition!.resourceDirection,
    )
    expect(revertedResources.assetFiles['flow-image']).toBeUndefined()

    history = undoFlowEditorHistory(history)
    expect(history.present.title).toBe('legacy')
    const redoTransition = flowEditorRedoResourceTransition(history)
    expect(redoTransition?.resourceDirection).toBe('forward')
    const restoredResources = applyHistoryResourceChanges(
      revertedResources,
      redoTransition!.resourceChanges,
      redoTransition!.resourceDirection,
    )
    expect([...restoredResources.assetFiles['flow-image']!]).toEqual([1, 2, 3])

    history = redoFlowEditorHistory(history)
    expect(history.present.title).toBe('transactional')
    expect(flowEditorRedoResourceTransition(history)).toBeUndefined()
  })

  it('keeps delta-to-legacy counting, undo branching, the 100-step cap, and stale rejection', () => {
    const initial = flowProject()
    let history = createFlowEditorHistory(initial)
    expect(commitFlowEditorHistory(history, history.present)).toBe(history)

    const deltaDocument = nextDocument(initial, 'flow-delta')
    const deltaStep = createEditorTransactionStep(initial, {
      projectId: initial.id,
      baseRevision: initial.revision,
      nextDocument: deltaDocument,
      resourceChanges: {
        assetFileChanges: [{ assetId: 'flow-delta', after: new Uint8Array([7]) }],
      },
    })
    if (!deltaStep) throw new Error('Expected a non-empty delta step')
    history = commitFlowEditorTransactionHistory(history, deltaStep)
    history = commitFlowEditorHistory(history, nextDocument(history.present, 'flow-legacy'))
    expect(flowEditorLegacyHistoryEntryCount(history.past)).toBe(1)
    expect(flowEditorUndoResourceTransition(history)).toBeUndefined()

    history = undoFlowEditorHistory(history)
    expect(flowEditorLegacyHistoryEntryCount(history.past)).toBe(0)
    expect(flowEditorLegacyHistoryEntryCount(history.future)).toBe(1)
    expect(history.future).toHaveLength(1)
    history = commitFlowEditorHistory(history, nextDocument(history.present, 'flow-branch'))
    expect(history.future).toEqual([])
    expect(flowEditorLegacyHistoryEntryCount(history.past)).toBe(1)

    for (let index = 1; index <= 100; index += 1) {
      history = commitFlowEditorHistory(history, nextDocument(history.present, `flow-${index}`))
    }
    expect(history.past).toHaveLength(100)
    expect(flowEditorLegacyHistoryEntryCount(history.past)).toBe(100)

    const staleBase = nextDocument(history.present, 'stale-base')
    const staleStep = createEditorTransactionStep(staleBase, {
      projectId: staleBase.id,
      baseRevision: staleBase.revision,
      nextDocument: nextDocument(staleBase, 'stale-next'),
      resourceChanges: {},
    })
    if (!staleStep) throw new Error('Expected a non-empty stale step')
    expect(() => commitFlowEditorTransactionHistory(history, staleStep)).toThrow(TypeError)
  })
})

describe('Spatial resource-aware authoring history', () => {
  it('undoes and redoes component-package resources through the same mixed history', () => {
    const initial = spatialProject()
    const legacy = nextDocument(initial, 'legacy')
    const transactional = nextDocument(legacy, 'transactional')
    const sourceBytes = new Uint8Array([4, 5, 6])
    const pkg = componentPackage('com.example.spatial', sourceBytes)
    const step = createEditorTransactionStep(legacy, {
      projectId: legacy.id,
      baseRevision: legacy.revision,
      nextDocument: transactional,
      resourceChanges: {
        componentPackageChanges: [{ packageId: pkg.manifest.id, after: pkg }],
      },
    })
    if (!step) throw new Error('Expected a non-empty transaction step')

    let history = createSpatialAuthoringHistory(initial)
    history = commitSpatialAuthoringHistory(history, legacy)
    history = commitSpatialEditorTransactionHistory(history, step)

    const frame = history.past[1]!
    expect(isSpatialAuthoringTransactionFrame(frame)).toBe(true)
    if (!isSpatialAuthoringTransactionFrame(frame)) throw new Error('Expected transaction frame')
    expect(frame.document).toBe(legacy)
    expect(frame.resourceChanges).not.toBe(step.resourceChanges)
    expect(frame.resourceChanges.componentPackageChanges![0]!.after)
      .not.toBe(step.resourceChanges.componentPackageChanges![0]!.after)
    sourceBytes[0] = 99
    expect([
      ...frame.resourceChanges.componentPackageChanges![0]!.after!.files['index.js']!,
    ]).toEqual([4, 5, 6])

    const populatedResources = applyHistoryResourceChanges({
      componentPackages: {},
      assetFiles: {},
    }, step.resourceChanges, 'forward')
    const undoTransition = spatialAuthoringUndoResourceTransition(history)
    expect(undoTransition?.resourceDirection).toBe('inverse')
    const revertedResources = applyHistoryResourceChanges(
      populatedResources,
      undoTransition!.resourceChanges,
      undoTransition!.resourceDirection,
    )
    expect(revertedResources.componentPackages[pkg.manifest.id]).toBeUndefined()

    history = undoSpatialAuthoringHistory(history)
    expect(history.present.title).toBe('legacy')
    const redoTransition = spatialAuthoringRedoResourceTransition(history)
    expect(redoTransition?.resourceDirection).toBe('forward')
    const restoredResources = applyHistoryResourceChanges(
      revertedResources,
      redoTransition!.resourceChanges,
      redoTransition!.resourceDirection,
    )
    expect([
      ...restoredResources.componentPackages[pkg.manifest.id]!.files['index.js']!,
    ]).toEqual([4, 5, 6])

    history = redoSpatialAuthoringHistory(history)
    expect(history.present.title).toBe('transactional')
  })

  it('keeps delta-to-legacy counting, undo branching, the 100-step cap, and stale rejection', () => {
    const initial = spatialProject()
    let history = createSpatialAuthoringHistory(initial)

    const deltaDocument = nextDocument(initial, 'spatial-delta')
    const deltaStep = createEditorTransactionStep(initial, {
      projectId: initial.id,
      baseRevision: initial.revision,
      nextDocument: deltaDocument,
      resourceChanges: {
        assetFileChanges: [{ assetId: 'spatial-delta', after: new Uint8Array([8]) }],
      },
    })
    if (!deltaStep) throw new Error('Expected a non-empty delta step')
    history = commitSpatialEditorTransactionHistory(history, deltaStep)
    history = commitSpatialAuthoringHistory(
      history,
      nextDocument(history.present, 'spatial-legacy'),
    )
    expect(spatialAuthoringLegacyHistoryEntryCount(history.past)).toBe(1)
    expect(spatialAuthoringUndoResourceTransition(history)).toBeUndefined()

    history = undoSpatialAuthoringHistory(history)
    expect(spatialAuthoringLegacyHistoryEntryCount(history.past)).toBe(0)
    expect(spatialAuthoringLegacyHistoryEntryCount(history.future)).toBe(1)
    expect(history.future).toHaveLength(1)
    history = commitSpatialAuthoringHistory(
      history,
      nextDocument(history.present, 'spatial-branch'),
    )
    expect(history.future).toEqual([])
    expect(spatialAuthoringLegacyHistoryEntryCount(history.past)).toBe(1)

    for (let index = 1; index <= 100; index += 1) {
      history = commitSpatialAuthoringHistory(
        history,
        nextDocument(history.present, `spatial-${index}`),
      )
    }
    expect(history.past).toHaveLength(100)
    expect(spatialAuthoringLegacyHistoryEntryCount(history.past)).toBe(100)

    const staleBase = nextDocument(history.present, 'stale-base')
    const staleStep = createEditorTransactionStep(staleBase, {
      projectId: staleBase.id,
      baseRevision: staleBase.revision,
      nextDocument: nextDocument(staleBase, 'stale-next'),
      resourceChanges: {},
    })
    if (!staleStep) throw new Error('Expected a non-empty stale step')
    expect(() => commitSpatialEditorTransactionHistory(history, staleStep))
      .toThrowError(expect.objectContaining<Partial<SpatialCommandError>>({
        reason: SPATIAL_REJECT_STALE_REVISION,
      }))
  })
})

describe('Slide resource-aware authoring history', () => {
  it('mixes legacy documents with a cloned transaction frame and exact resource transitions', () => {
    const initial = slideProject()
    const legacy = nextDocument(initial, 'legacy')
    const transactional = nextDocument(legacy, 'transactional')
    const sourceBytes = new Uint8Array([1, 2, 3])
    const step = createEditorTransactionStep(legacy, {
      projectId: legacy.id,
      baseRevision: legacy.revision,
      nextDocument: transactional,
      resourceChanges: {
        assetFileChanges: [{ assetId: 'slide-image', after: sourceBytes }],
      },
    })
    if (!step) throw new Error('Expected a non-empty transaction step')

    let history = createSlideAuthoringHistory(initial)
    history = commitSlideAuthoringHistory(history, legacy)
    history = commitSlideEditorTransactionHistory(history, step)

    expect(history.present).toBe(step.nextDocument)
    expect(history.past).toHaveLength(2)
    expect(history.past[0]).toBe(initial)
    const frame = history.past[1]!
    expect(isSlideAuthoringTransactionFrame(frame)).toBe(true)
    if (!isSlideAuthoringTransactionFrame(frame)) throw new Error('Expected transaction frame')
    expect(frame.document).toBe(legacy)
    expect(frame.resourceChanges).not.toBe(step.resourceChanges)
    expect(frame.resourceChanges.assetFileChanges![0]!.after)
      .not.toBe(step.resourceChanges.assetFileChanges![0]!.after)

    sourceBytes[0] = 99
    expect([...frame.resourceChanges.assetFileChanges![0]!.after!]).toEqual([1, 2, 3])

    const populatedResources = applyHistoryResourceChanges({
      componentPackages: {},
      assetFiles: {},
    }, step.resourceChanges, 'forward')
    const undoTransition = slideAuthoringUndoResourceTransition(history)
    expect(undoTransition?.resourceDirection).toBe('inverse')
    const revertedResources = applyHistoryResourceChanges(
      populatedResources,
      undoTransition!.resourceChanges,
      undoTransition!.resourceDirection,
    )
    expect(revertedResources.assetFiles['slide-image']).toBeUndefined()

    history = undoSlideAuthoringHistory(history)
    expect(history.present.title).toBe('legacy')
    const redoTransition = slideAuthoringRedoResourceTransition(history)
    expect(redoTransition?.resourceDirection).toBe('forward')
    const restoredResources = applyHistoryResourceChanges(
      revertedResources,
      redoTransition!.resourceChanges,
      redoTransition!.resourceDirection,
    )
    expect([...restoredResources.assetFiles['slide-image']!]).toEqual([1, 2, 3])

    history = redoSlideAuthoringHistory(history)
    expect(history.present.title).toBe('transactional')
    expect(slideAuthoringRedoResourceTransition(history)).toBeUndefined()
  })

  it('keeps empty-delta action frames, delta-to-legacy counting, the 100-step cap, and stale rejection', () => {
    const initial = slideProject()
    let history = createSlideAuthoringHistory(initial)

    const actionDocument = nextDocument(initial, 'slide-action')
    const committed = commitSlideActionTransaction(history, actionDocument)
    if (!committed) throw new Error('Expected a Slide action transaction')
    history = committed.history
    expect(committed.resourceTransition.resourceDirection).toBe('forward')
    expect(isSlideAuthoringTransactionFrame(history.past[0]!)).toBe(true)
    expect(slideAuthoringLegacyHistoryEntryCount(history.past)).toBe(0)

    history = commitSlideAuthoringHistory(history, nextDocument(history.present, 'slide-legacy'))
    expect(slideAuthoringLegacyHistoryEntryCount(history.past)).toBe(1)
    expect(slideAuthoringUndoResourceTransition(history)).toBeUndefined()

    history = undoSlideAuthoringHistory(history)
    expect(slideAuthoringLegacyHistoryEntryCount(history.past)).toBe(0)
    expect(slideAuthoringLegacyHistoryEntryCount(history.future)).toBe(1)
    expect(history.future).toHaveLength(1)
    history = commitSlideAuthoringHistory(history, nextDocument(history.present, 'slide-branch'))
    expect(history.future).toEqual([])
    expect(slideAuthoringLegacyHistoryEntryCount(history.past)).toBe(1)

    for (let index = 1; index <= 100; index += 1) {
      history = commitSlideAuthoringHistory(history, nextDocument(history.present, `slide-${index}`))
    }
    expect(history.past).toHaveLength(100)
    expect(slideAuthoringLegacyHistoryEntryCount(history.past)).toBe(100)

    const staleBase = nextDocument(history.present, 'stale-base')
    const staleStep = createEditorTransactionStep(staleBase, {
      projectId: staleBase.id,
      baseRevision: staleBase.revision,
      nextDocument: nextDocument(staleBase, 'stale-next'),
      resourceChanges: {},
    })
    if (!staleStep) throw new Error('Expected a non-empty stale step')
    expect(() => commitSlideEditorTransactionHistory(history, staleStep))
      .toThrowError(expect.objectContaining<Partial<SlideCommandError>>({
        reason: SLIDE_REJECT_STALE_REVISION,
      }))
  })
})
