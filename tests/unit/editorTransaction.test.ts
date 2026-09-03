import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import {
  applyEditorTransactionStep,
  createEditorTransactionStep,
  type EditorTransactionState,
} from '@/renderer/authoring/editorTransaction'
import { planAssetFileHistoryChange } from '@/renderer/store/courseResourceState'

const FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
  'slide-heavy.h5lesson',
)
const REPLACEMENT_ASSET_ID = 'slide-hero-replacement'
const REPLACEMENT_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

function fixture() {
  return openCourseProjectArchive(
    new Uint8Array(readFileSync(FIXTURE_PATH)),
  )
}

function imageAssetId(
  project: CourseProjectDocument,
  itemId: string,
): string {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => (
        candidate.layerItemId === itemId
      ))
      if (
        item?.kind === 'native' &&
        item.content.nativeType === 'image'
      ) {
        return item.content.data.assetId
      }
    }
  }
  throw new Error(`Slide image item is missing: ${itemId}`)
}

function replaceSlideImageReference(
  project: CourseProjectDocument,
  itemId: string,
  assetId: string,
): void {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => (
        candidate.layerItemId === itemId
      ))
      if (
        item?.kind === 'native' &&
        item.content.nativeType === 'image'
      ) {
        item.content.data.assetId = assetId
        return
      }
    }
  }
  throw new Error(`Slide image item is missing: ${itemId}`)
}

describe('Editor transaction resource step', () => {
  it('carries a Slide-heavy document and added image bytes as one reversible step', () => {
    const archive = fixture()
    const baseDocument = archive.project
    const baseAssetId = imageAssetId(baseDocument, 'slide-intro-hero')
    const baseAsset = baseDocument.assets[baseAssetId]
    if (!baseAsset) throw new Error('Slide-heavy fixture is missing image metadata')

    const nextDocument = structuredClone(baseDocument)
    nextDocument.assets[REPLACEMENT_ASSET_ID] = {
      ...structuredClone(baseAsset),
      id: REPLACEMENT_ASSET_ID,
      filename: 'replacement.png',
      path: `assets/${REPLACEMENT_ASSET_ID}.png`,
      byteLength: REPLACEMENT_BYTES.byteLength,
    }
    replaceSlideImageReference(
      nextDocument,
      'slide-intro-hero',
      REPLACEMENT_ASSET_ID,
    )
    nextDocument.revision = baseDocument.revision + 1
    nextDocument.updatedAt = '2026-08-24T01:00:00.000Z'

    const callerBytes = REPLACEMENT_BYTES.slice()
    const step = createEditorTransactionStep(baseDocument, {
      projectId: baseDocument.id,
      baseRevision: baseDocument.revision,
      nextDocument,
      resourceChanges: {
        assetFileChanges: [planAssetFileHistoryChange(
          REPLACEMENT_ASSET_ID,
          undefined,
          callerBytes,
        )!],
      },
      selectionHint: {
        itemId: 'slide-intro-hero',
        authoringAddress: 'scene:slide-scene-intro/layer:slide-intro-hero',
      },
      feedback: { kind: 'image-replaced' },
    })
    if (!step) throw new Error('Expected an image replacement transaction')

    callerBytes[0] = 0
    nextDocument.assets[REPLACEMENT_ASSET_ID]!.filename = 'mutated.png'
    expect(step.nextDocument.assets[REPLACEMENT_ASSET_ID]!.filename)
      .toBe('replacement.png')
    expect([...step.resourceChanges.assetFileChanges![0]!.after!])
      .toEqual([...REPLACEMENT_BYTES])
    expect(Object.isFrozen(step)).toBe(true)
    expect(Object.isFrozen(step.nextDocument)).toBe(true)
    expect(step).not.toHaveProperty('past')
    expect(step).not.toHaveProperty('future')

    const initialState: EditorTransactionState = {
      document: baseDocument,
      resources: {
        componentPackages: {},
        assetFiles: archive.assetFiles,
      },
    }
    const forward = applyEditorTransactionStep(initialState, step, 'forward')
    expect(forward.document.revision).toBe(baseDocument.revision + 1)
    expect(imageAssetId(forward.document, 'slide-intro-hero'))
      .toBe(REPLACEMENT_ASSET_ID)
    expect([...forward.resources.assetFiles[REPLACEMENT_ASSET_ID]!])
      .toEqual([...REPLACEMENT_BYTES])
    expect(forward.resources.assetFiles[baseAssetId])
      .toEqual(archive.assetFiles[baseAssetId])

    const inverse = applyEditorTransactionStep(forward, step, 'inverse')
    expect(inverse.document).toEqual(baseDocument)
    expect(inverse.resources.assetFiles[REPLACEMENT_ASSET_ID]).toBeUndefined()
    expect(inverse.resources.assetFiles).toEqual(archive.assetFiles)
  })

  it('does not create a step for a cloned document and byte-identical resources', () => {
    const archive = fixture()
    const baseBytes = archive.assetFiles['slide-hero']
    if (!baseBytes) throw new Error('Slide-heavy fixture is missing slide-hero bytes')
    const step = createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument: structuredClone(archive.project),
      resourceChanges: {
        assetFileChanges: [{
          assetId: 'slide-hero',
          before: baseBytes,
          after: baseBytes.slice(),
        }],
      },
    })
    expect(step).toBeNull()
  })

  it('requires every non-no-op document or resource commit to advance revision once', () => {
    const archive = fixture()
    const modifiedWithoutRevision = structuredClone(archive.project)
    modifiedWithoutRevision.title = `${modifiedWithoutRevision.title} changed`
    expect(() => createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument: modifiedWithoutRevision,
      resourceChanges: {},
    })).toThrow(/revision.*1/)

    const skippedRevision = structuredClone(archive.project)
    skippedRevision.revision += 2
    expect(() => createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument: skippedRevision,
      resourceChanges: {},
    })).toThrow(/revision.*1/)

    const baseBytes = archive.assetFiles['slide-hero']
    if (!baseBytes) throw new Error('Slide-heavy fixture is missing slide-hero bytes')
    expect(() => createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument: structuredClone(archive.project),
      resourceChanges: {
        assetFileChanges: [{
          assetId: 'slide-hero',
          before: baseBytes,
          after: new Uint8Array([1, 2, 3]),
        }],
      },
    })).toThrow(/revision.*1/)
  })

  it('rejects mismatched identity, revision, and stale application', () => {
    const archive = fixture()
    const nextDocument = structuredClone(archive.project)
    nextDocument.revision += 1

    expect(() => createEditorTransactionStep(archive.project, {
      projectId: 'another-project',
      baseRevision: archive.project.revision,
      nextDocument,
      resourceChanges: {},
    })).toThrow(/Course Project/)
    expect(() => createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision + 1,
      nextDocument,
      resourceChanges: {},
    })).toThrow(/baseRevision/)

    const step = createEditorTransactionStep(archive.project, {
      projectId: archive.project.id,
      baseRevision: archive.project.revision,
      nextDocument,
      resourceChanges: {},
    })
    if (!step) throw new Error('Expected a revision transaction')
    const staleDocument = structuredClone(archive.project)
    staleDocument.revision += 2
    expect(() => applyEditorTransactionStep({
      document: staleDocument,
      resources: { componentPackages: {}, assetFiles: archive.assetFiles },
    }, step, 'forward')).toThrow(/revision/)
  })
})
