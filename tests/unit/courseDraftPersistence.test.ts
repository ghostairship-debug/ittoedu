import { beforeEach, describe, expect, it } from 'vitest'
import { componentPackagesToArchiveFiles } from '@/renderer/components/componentPackageStore'
import { findFlowBlockRecursive, flowSurfaceIn } from '@/renderer/course/flowDocumentModel'
import { selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import {
  beginFlowFormulaEdit,
  beginFlowTextEdit,
  updateFlowTextDraft,
  type FlowFormulaDraft,
} from '@/renderer/authoring/flowTextEdit'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import {
  openDefaultCourseProject,
  saveCourseProjectDocument,
} from '@/renderer/project/courseProjectIo'
import {
  selectActiveCourseProjectDocument,
  selectHasUnsavedCourseChanges,
  useEditorStore,
  type CourseProjectPersistenceSnapshot,
  selectSlideSceneList,
  selectEditingNodes,
} from '@/renderer/store/editorStore'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'

function activeHistory() {
  const state = useEditorStore.getState()
  if (state.spatialSession) return state.spatialSession.history
  if (state.flowSession) return state.flowSession.history
  const backend = state.slideBackend
  if (!backend) throw new Error('expected active Surface session')
  return backend.getSession().history
}

type SurfaceKind = 'slide' | 'spatial' | 'flow'

interface DraftFixture {
  readonly kind: SurfaceKind
  readonly targetId: string
  readonly originalText: string
  readonly historyBeforeDraft: number
  begin(): void
  update(text: string): void
  read(document: CourseProjectDocument): string
}

function activeDocument(): CourseProjectDocument {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('expected active Course Project V9 document')
  return document
}

function nativeText(document: CourseProjectDocument, layerItemId: string): string {
  const located = locateCourseLayer(document, layerItemId)
  const item = located?.item
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'text') {
    throw new Error(`expected native text ${layerItemId}`)
  }
  return item.content.data.text
}

function acknowledgeBaseline(path: string): void {
  const store = useEditorStore.getState()
  const preparation = store.prepareCourseProjectPersistence()
  if (!preparation.ok) throw new Error(preparation.reason)
  expect(store.acknowledgeCourseProjectSaved(path, preparation.token)).toBe(true)
  expect(useEditorStore.getState().dirty).toBe(false)
}

function createSlideFixture(): DraftFixture {
  const store = useEditorStore.getState()
  store.createNewProject()
  store.addTextNode()
  const targetId = useEditorStore.getState().selectedNodeId
  if (!targetId) throw new Error('expected selected Slide text')
  const originalText = nativeText(activeDocument(), targetId)
  acknowledgeBaseline('slide-baseline.h5lesson')
  const historyBeforeDraft = activeHistory().past.length
  const begin = () => {
    useEditorStore.getState().beginTextEdit(targetId, 'properties')
  }
  return {
    kind: 'slide',
    targetId,
    originalText,
    historyBeforeDraft,
    begin,
    update(text) {
      const state = useEditorStore.getState()
      const node = selectSlideSceneList(state).flatMap((scene) => scene.nodes)
        .find((candidate) => candidate.id === targetId)
      if (!node || node.type !== 'text') throw new Error('expected Slide text projection')
      begin()
      useEditorStore.getState().updateTextEditDraft(
        targetId,
        text,
        node.runs ?? [],
        node.height,
        node.width,
      )
    },
    read(document) {
      return nativeText(document, targetId)
    },
  }
}

function createSpatialFixture(): DraftFixture {
  const store = useEditorStore.getState()
  store.createNewSpatialProject()
  store.addTextNode()
  const targetId = useEditorStore.getState().selectedNodeId
  if (!targetId) throw new Error('expected selected Spatial text')
  const originalText = nativeText(activeDocument(), targetId)
  acknowledgeBaseline('spatial-baseline.h5lesson')
  const historyBeforeDraft = activeHistory().past.length
  const begin = () => {
    useEditorStore.getState().beginTextEdit(targetId, 'properties')
  }
  return {
    kind: 'spatial',
    targetId,
    originalText,
    historyBeforeDraft,
    begin,
    update(text) {
      const state = useEditorStore.getState()
      const node = selectEditingNodes(state).find((candidate) => candidate.id === targetId)
      if (!node || node.type !== 'text') throw new Error('expected Spatial text projection')
      begin()
      useEditorStore.getState().updateTextEditDraft(
        targetId,
        text,
        node.runs ?? [],
        node.height,
        node.width,
      )
    },
    read(document) {
      return nativeText(document, targetId)
    },
  }
}

function createFlowFixture(): DraftFixture {
  const store = useEditorStore.getState()
  store.createNewFlowProject()
  const flow = useEditorStore.getState().flowSession
  if (!flow) throw new Error('expected Flow session')
  const surface = flowSurfaceIn(flow.history.present, flow.selection.surfaceId)
  const paragraph = surface?.blocks.find((block) => block.type === 'paragraph')
  if (!surface || !paragraph || paragraph.type !== 'paragraph') {
    throw new Error('expected Flow paragraph')
  }
  const targetId = paragraph.id
  const originalText = paragraph.text
  acknowledgeBaseline('flow-baseline.h5lesson')
  const historyBeforeDraft = activeHistory().past.length
  const begin = () => {
    const current = useEditorStore.getState().flowSession
    if (!current) throw new Error('expected Flow session')
    const selection = selectFlowEditorBlocks(
      current.history.present,
      current.selection.locationId,
      [targetId],
    )
    const begun = beginFlowTextEdit({
      project: current.history.present,
      selection,
      blockId: targetId,
    })
    if (!begun.ok) throw new Error(begun.reason)
    useEditorStore.getState().applyFlowSelection(begun.selection)
    useEditorStore.getState().setFlowTextEdit(begun.edit)
  }
  return {
    kind: 'flow',
    targetId,
    originalText,
    historyBeforeDraft,
    begin,
    update(text) {
      begin()
      const edit = useEditorStore.getState().flowTextEdit
      if (!edit) throw new Error('expected Flow edit')
      useEditorStore.getState().setFlowTextEdit(updateFlowTextDraft(edit, {
        text,
        runs: [],
      }))
    },
    read(document) {
      const currentSurface = flowSurfaceIn(document, surface.id)
      const block = currentSurface
        ? findFlowBlockRecursive(currentSurface.blocks, targetId)?.block
        : undefined
      if (!block || block.type !== 'paragraph') throw new Error('expected Flow paragraph')
      return block.text
    },
  }
}

function archiveAndReopen(snapshot: CourseProjectPersistenceSnapshot): CourseProjectDocument {
  const bytes = saveCourseProjectDocument({
    project: snapshot.project,
    assetFiles: snapshot.assetFiles,
    componentFiles: componentPackagesToArchiveFiles(snapshot.componentPackages),
  })
  return openDefaultCourseProject(bytes).project
}

const fixtures: Array<[SurfaceKind, () => DraftFixture]> = [
  ['slide', createSlideFixture],
  ['spatial', createSpatialFixture],
  ['flow', createFlowFixture],
]

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('active Course Project text draft persistence', () => {
  it.each(fixtures)(
    'materializes %s recovery without mutating live history, then commits once before archive save',
    (_kind, createFixture) => {
      const fixture = createFixture()
      const nextText = `${fixture.kind} 保存前活动草稿`
      fixture.update(nextText)

      const drafted = useEditorStore.getState()
      expect(selectHasUnsavedCourseChanges(drafted)).toBe(true)
      expect(activeHistory().past).toHaveLength(fixture.historyBeforeDraft)
      expect(fixture.read(activeDocument())).toBe(fixture.originalText)

      const recovery = drafted.captureCourseProjectRecoverySnapshot()
      expect(recovery.ok).toBe(true)
      if (!recovery.ok) throw new Error(recovery.reason)
      expect(fixture.read(recovery.snapshot.project)).toBe(nextText)
      expect(activeHistory().past).toHaveLength(fixture.historyBeforeDraft)
      expect(fixture.read(activeDocument())).toBe(fixture.originalText)

      const preparation = drafted.prepareCourseProjectPersistence()
      expect(preparation.ok).toBe(true)
      if (!preparation.ok) throw new Error(preparation.reason)
      expect(fixture.read(preparation.snapshot.project)).toBe(nextText)
      expect(fixture.read(archiveAndReopen(preparation.snapshot))).toBe(nextText)
      expect(activeHistory().past).toHaveLength(
        fixture.historyBeforeDraft + 1,
      )
      expect(useEditorStore.getState().dirty).toBe(true)

      const secondPreparation = useEditorStore.getState().prepareCourseProjectPersistence()
      expect(secondPreparation.ok).toBe(true)
      expect(activeHistory().past).toHaveLength(
        fixture.historyBeforeDraft + 1,
      )

      expect(
        useEditorStore
          .getState()
          .acknowledgeCourseProjectSaved(`${fixture.kind}.h5lesson`, preparation.token),
      ).toBe(true)
      expect(useEditorStore.getState().dirty).toBe(false)

      useEditorStore.getState().undo()
      expect(fixture.read(activeDocument())).toBe(fixture.originalText)
    },
  )

  it.each(fixtures)(
    'does not acknowledge an older %s save after a new draft starts',
    (_kind, createFixture) => {
      const fixture = createFixture()
      fixture.update('写盘版本 A')
      const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
      if (!preparation.ok) throw new Error(preparation.reason)

      fixture.update('写盘期间版本 B')
      const stateBeforeAck = useEditorStore.getState()
      const activeEdit = stateBeforeAck.v9ContentEdit
        ?? stateBeforeAck.spatialContentEdit
        ?? stateBeforeAck.flowTextEdit
      expect(activeEdit).not.toBeNull()

      expect(
        stateBeforeAck.acknowledgeCourseProjectSaved(
          `${fixture.kind}-pending.h5lesson`,
          preparation.token,
        ),
      ).toBe(false)
      expect(useEditorStore.getState().dirty).toBe(true)
      expect(
        useEditorStore.getState().v9ContentEdit
        ?? useEditorStore.getState().spatialContentEdit
        ?? useEditorStore.getState().flowTextEdit,
      ).toBe(activeEdit)
      expect(fixture.read(preparation.snapshot.project)).toBe('写盘版本 A')

      const nextPreparation = useEditorStore.getState().prepareCourseProjectPersistence()
      if (!nextPreparation.ok) throw new Error(nextPreparation.reason)
      expect(fixture.read(nextPreparation.snapshot.project)).toBe('写盘期间版本 B')
    },
  )

  it.each(fixtures)(
    'saves the latest %s document without a history entry when only a clean edit session went stale',
    (kind, createFixture) => {
      const fixture = createFixture()
      fixture.begin()
      expect(
        useEditorStore.getState().v9ContentEdit
        ?? useEditorStore.getState().spatialContentEdit
        ?? useEditorStore.getState().flowTextEdit,
      ).not.toBeNull()

      const revisionBeforeMutation = activeDocument().revision
      if (kind === 'slide') {
        useEditorStore.getState().renameProject('slide clean draft revision')
      } else if (kind === 'spatial') {
        const node = selectEditingNodes(useEditorStore.getState())
          .find((candidate) => candidate.id === fixture.targetId)
        if (!node) throw new Error('expected projected Spatial text')
        useEditorStore.getState().updateNode(fixture.targetId, { x: node.x + 1 })
      } else {
        const flow = useEditorStore.getState().flowSession
        if (!flow) throw new Error('expected Flow session')
        useEditorStore.getState().renameFlowHeading(
          flow.selection.locationId,
          'Flow clean draft revision',
        )
      }
      const documentAfterMutation = activeDocument()
      const historyAfterMutation = activeHistory().past.length
      expect(documentAfterMutation.revision).toBeGreaterThan(revisionBeforeMutation)
      if (kind === 'slide') {
        expect(useEditorStore.getState().v9ContentEdit).toBeNull()
      }

      const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
      expect(preparation.ok).toBe(true)
      if (!preparation.ok) throw new Error(preparation.reason)
      expect(preparation.snapshot.project).toBe(documentAfterMutation)
      expect(fixture.read(preparation.snapshot.project)).toBe(fixture.originalText)
      expect(activeHistory().past).toHaveLength(historyAfterMutation)
      expect(
        useEditorStore.getState().v9ContentEdit
        ?? useEditorStore.getState().spatialContentEdit
        ?? useEditorStore.getState().flowTextEdit,
      ).toBeNull()
    },
  )

  it('keeps a dirty stale Slide draft and refuses to overwrite a newer document', () => {
    const fixture = createSlideFixture()
    fixture.update('尚未提交的旧版本文字')
    const edit = useEditorStore.getState().v9ContentEdit
    if (!edit) throw new Error('expected Slide edit')

    useEditorStore.getState().renameProject('dirty stale document')
    const historyAfterRename = activeHistory().past.length
    expect(useEditorStore.getState().v9ContentEdit).toBe(edit)

    const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
    expect(preparation).toMatchObject({ ok: false, reason: 'stale-revision' })
    expect(activeHistory().past).toHaveLength(historyAfterRename)
    expect(useEditorStore.getState().v9ContentEdit).toBe(edit)
  })

  it('refuses to discard a clean Slide edit while IME composition is active', () => {
    const fixture = createSlideFixture()
    fixture.begin()
    const edit = useEditorStore.getState().v9ContentEdit
    if (!edit) throw new Error('expected Slide edit')
    const composingEdit = { ...edit, composing: true }
    useEditorStore.setState({ v9ContentEdit: composingEdit })
    const historyBefore = activeHistory().past.length

    const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
    expect(preparation).toMatchObject({ ok: false, reason: 'composing' })
    expect(activeHistory().past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().v9ContentEdit).toBe(composingEdit)
  })

  it('acknowledges a Slide save when only selection changes during disk write', () => {
    const store = useEditorStore.getState()
    store.createNewProject()
    store.addTextNode()
    store.addRectangleNode()
    const [text] = selectSlideSceneList(useEditorStore.getState())[0]?.nodes ?? []
    if (!text) throw new Error('expected Slide nodes')
    acknowledgeBaseline('selection-baseline.h5lesson')

    const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!preparation.ok) throw new Error(preparation.reason)
    const packagesAtSave = useEditorStore.getState().componentPackages

    useEditorStore.getState().selectNode(text.id)

    expect(useEditorStore.getState().componentPackages).toBe(packagesAtSave)
    expect(
      useEditorStore.getState().acknowledgeCourseProjectSaved(
        'selection-only.h5lesson',
        preparation.token,
      ),
    ).toBe(true)
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(false)
  })

  it('refuses a manual save during Flow IME composition without clearing the draft', () => {
    const fixture = createFlowFixture()
    fixture.update('输入法组合中的文字')
    const edit = useEditorStore.getState().flowTextEdit
    if (!edit) throw new Error('expected Flow edit')
    const composingEdit = { ...edit, composing: true }
    useEditorStore.setState({ flowTextEdit: composingEdit })
    const historyBefore = activeHistory().past.length

    const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
    expect(preparation.ok).toBe(false)
    expect(activeHistory().past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().flowTextEdit).toBe(composingEdit)
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)

    const recovery = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    expect(recovery.ok).toBe(true)
    if (!recovery.ok) throw new Error(recovery.reason)
    expect(fixture.read(recovery.snapshot.project)).toBe('输入法组合中的文字')
    expect(activeHistory().past).toHaveLength(historyBefore)
  })

  it('materializes the Store-owned Flow formula draft for recovery and saves it once', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().addFormulaNode()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected Flow session')
    const surface = flowSurfaceIn(flow.history.present, flow.selection.surfaceId)
    const formula = surface.blocks.find((block) => block.type === 'formula')
    if (!formula || formula.type !== 'formula') throw new Error('expected Flow formula')
    const selection = selectFlowEditorBlocks(
      flow.history.present,
      flow.selection.locationId,
      [formula.id],
    )
    const begun = beginFlowFormulaEdit({
      project: flow.history.present,
      selection,
      blockId: formula.id,
    })
    if (!begun.ok) throw new Error(begun.reason)
    useEditorStore.getState().applyFlowSelection(begun.selection)
    const ast = {
      type: 'row' as const,
      children: [
        { type: 'token' as const, value: 'a' },
        { type: 'operator' as const, value: '+' },
        { type: 'token' as const, value: 'b' },
      ],
    }
    const drafted = updateFlowTextDraft(begun.edit, {
      ast,
      accessibleText: 'a加b',
      source: 'a+b',
      valid: true,
      hasSlots: false,
    })
    useEditorStore.getState().setFlowTextEdit(drafted)
    const historyBefore = activeHistory().past.length

    const recovery = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    expect(recovery.ok).toBe(true)
    if (!recovery.ok) throw new Error(recovery.reason)
    const recovered = flowSurfaceIn(recovery.snapshot.project, surface.id)
      .blocks.find((block) => block.id === formula.id)
    expect(recovered).toMatchObject({ type: 'formula', ast, accessibleText: 'a加b' })
    expect(activeHistory().past).toHaveLength(historyBefore)

    const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
    expect(preparation.ok).toBe(true)
    if (!preparation.ok) throw new Error(preparation.reason)
    expect(useEditorStore.getState().flowTextEdit).toBeNull()
    expect(activeHistory().past).toHaveLength(historyBefore + 1)
    const saved = flowSurfaceIn(preparation.snapshot.project, surface.id)
      .blocks.find((block) => block.id === formula.id)
    expect(saved).toMatchObject({ type: 'formula', ast, accessibleText: 'a加b' })
  })

  it('keeps an invalid Flow formula source in the Store and refuses save or recovery', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().addFormulaNode()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected Flow session')
    const surface = flowSurfaceIn(flow.history.present, flow.selection.surfaceId)
    const formula = surface.blocks.find((block) => block.type === 'formula')
    if (!formula || formula.type !== 'formula') throw new Error('expected Flow formula')
    const selection = selectFlowEditorBlocks(
      flow.history.present,
      flow.selection.locationId,
      [formula.id],
    )
    const begun = beginFlowFormulaEdit({
      project: flow.history.present,
      selection,
      blockId: formula.id,
    })
    if (!begun.ok) throw new Error(begun.reason)
    useEditorStore.getState().applyFlowSelection(begun.selection)
    const original = begun.edit.draft as FlowFormulaDraft
    const invalid = updateFlowTextDraft(begun.edit, {
      ...original,
      source: '\\frac{x}',
      valid: false,
    })
    useEditorStore.getState().setFlowTextEdit(invalid)
    const before = useEditorStore.getState()
    const beforeSession = before.flowSession!

    expect(selectHasUnsavedCourseChanges(before)).toBe(true)
    expect(before.captureCourseProjectRecoverySnapshot()).toMatchObject({ ok: false })
    expect(useEditorStore.getState().prepareCourseProjectPersistence()).toMatchObject({ ok: false })
    const after = useEditorStore.getState()
    expect(after.flowTextEdit).toBe(invalid)
    expect(after.flowSession?.history.present).toBe(beforeSession.history.present)
    expect(after.flowSession?.history.past).toBe(beforeSession.history.past)
    expect(after.flowSession?.history.future).toBe(beforeSession.history.future)
    expect(after.flowSession?.selection).toBe(beforeSession.selection)
    expect(after.courseAssetSidecar).toBe(before.courseAssetSidecar)
    expect(after.courseAssetSidecarPast).toBe(before.courseAssetSidecarPast)
    expect(after.courseAssetSidecarFuture).toBe(before.courseAssetSidecarFuture)
    expect(after.courseAuthoringSession).toBe(before.courseAuthoringSession)
    expect(after.dirty).toBe(before.dirty)
  })
})
