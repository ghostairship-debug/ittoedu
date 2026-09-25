// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createCourseStoreHost } from '../helpers/courseStoreHost'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  selectActiveCourseProjectDocument,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { captureBackgroundTargets } from '@/renderer/authoring/tools/backgroundTool'

const disposers: Array<() => void> = []

function document() {
  return selectActiveCourseProjectDocument(useEditorStore.getState())!
}

function activeLocationId() {
  return useEditorStore.getState().courseAuthoringSession!.token.locationId
}

function historyDepth() { return host.registry.get(useEditorStore.getState().courseDocument.documentId!).read().undoDepth }
let host: Awaited<ReturnType<typeof createCourseStoreHost>>

function withoutSlide(project: CourseProjectDocument): CourseProjectDocument {
  const next = structuredClone(project)
  next.locations = next.locations.filter(location => location.kind !== 'slide-scene')
  next.surfaces = next.surfaces.filter(surface => surface.type !== 'slide')
  next.startLocationId = 'location-flow'
  if (next.mixedPrintPlan) {
    next.mixedPrintPlan.entries = next.mixedPrintPlan.entries.filter(entry => entry.kind !== 'slide-scenes')
  }
  next.title = '完整文档移除演示面'
  return next
}

beforeEach(async () => {
  host = await createCourseStoreHost()
  const model = new CourseV9Driver().load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/mixed.h5lesson')))
  const snapshot = await host.api.create(model, 'mixed.h5lesson')
  await useEditorStore.getState().activateCourseDocument(snapshot.documentId)
  await useEditorStore.getState().drainCourseDocument()
  useEditorStore.getState().activateCourseLocation('location-slide')
})

afterEach(() => {
  disposers.splice(0).reverse().forEach(dispose => dispose())
  vi.restoreAllMocks()
})

describe('project.document selection continuity', () => {
  it('falls back to the next start location when direct project.document removes the active Surface', async () => {
    const before = structuredClone(document())
    const previousHistoryEntries = historyDepth()
    const session = useEditorStore.getState().courseAuthoringSession!
    const target = captureBackgroundTargets({
      document: before,
      sessionToken: session.token,
      stateId: null,
      reference: 'page',
    })[0]!.target
    const receipt = await useEditorStore.getState().runAuthoringTool({
      version: 1,
      requestId: crypto.randomUUID(),
      tool: 'project.document',
      destination: { kind: 'update', target },
      input: { artifact: { document: withoutSlide(before) } },
    })

    expect(receipt.status, JSON.stringify({ receipt, error: useEditorStore.getState().errorMessage, snapshot: host.registry.get(useEditorStore.getState().courseDocument.documentId!).read().revision })).toBe('committed')
    expect(activeLocationId()).toBe('location-flow')
    expect(document().surfaces.some(surface => surface.type === 'slide')).toBe(false)
    expect(document().revision).toBe(before.revision + 1)
    expect(historyDepth()).toBe(previousHistoryEntries + 1)

    useEditorStore.getState().undo()
    await vi.waitFor(() => expect(document().surfaces).toEqual(before.surfaces))
    expect(document().locations.some(location => location.id === activeLocationId())).toBe(true)
    useEditorStore.getState().redo()
    await vi.waitFor(() => {
      expect(activeLocationId()).toBe('location-flow')
      expect(document().surfaces.some(surface => surface.type === 'slide')).toBe(false)
    })
  })
})
