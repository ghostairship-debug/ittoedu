import { beginFlowTableFieldEdit } from '@/renderer/authoring/flowTextEdit'
import { beginSpatialWorldTableTextEdit } from '@/renderer/authoring/spatialWorldAuthoring'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importComponentPackage } from '@/renderer/components/importComponentPackage'
import { readLayerTextField, type LayerTextField } from '@/renderer/authoring/layerTextField'
import { componentPackagesToArchiveFiles } from '@/renderer/components/componentPackageStore'
import { findFlowBlockRecursive, flowSurfaceIn } from '@/renderer/course/flowDocumentModel'
import { selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import {
  beginFlowFormulaEdit,
  beginFlowChartTextEdit,
  updateFlowChartTextDraft,
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
  selectSelectedNodeId,
  selectSlideSceneList,
  selectEditingNodes,
} from '@/renderer/store/editorStore'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { createChartTextDraft } from '@/renderer/authoring/chartTextDraft'
import { beginSpatialWorldChartTextEdit, updateSpatialWorldChartTextDraft } from '@/renderer/authoring/spatialWorldAuthoring'
import { makeSlideAuthoringTarget } from '@/renderer/course/slideAuthoringBackend'

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
  const targetId = selectSelectedNodeId(useEditorStore.getState())
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
  const targetId = selectSelectedNodeId(useEditorStore.getState())
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
  it.each(['table', 'component'] as const)('recovers focused Slide %s text and preserves it in save/reopen and Undo/Redo', kind => {
    let field: LayerTextField
    if (kind === 'table') useEditorStore.getState().addTableNode()
    else {
      const pkg = importComponentPackage(new Uint8Array(readFileSync(resolve('examples/sample-counter.h5component'))))
      const state = useEditorStore.getState()
      const target = state.captureComponentInsertionTarget()!
      const result = state.insertComponentPackagesAtTarget(target, [pkg])
      if (!result.ok) throw new Error(result.reason)
      const insertedId = result.layerItemIds?.[0]
      if (!insertedId) throw new Error('expected inserted component')
      useEditorStore.getState().selectNode(insertedId)
    }
    const state = useEditorStore.getState()
    const id = selectSelectedNodeId(state)!
    const item = locateCourseLayer(activeDocument(), id)!.item
    if (item.kind === 'native' && item.content.nativeType === 'table') field = { kind: 'table-cell', cellId: item.content.data.rows[0]!.cells[0]!.id }
    else if (item.kind === 'component') field = { kind: 'component-prop', ...item.component, key: 'title' }
    else throw new Error('expected text field')
    const packages = state.componentPackages
    const read = (document: CourseProjectDocument) => readLayerTextField(locateCourseLayer(document, id)!.item, field, packages)
    const original = read(activeDocument())
    acknowledgeBaseline(`${kind}-text.h5lesson`)
    const before = activeHistory().past.length
    const target = makeSlideAuthoringTarget(state.slideBackend!.getSession(), id, 'item')
    const begun = state.runSlideFieldTextIntent({ kind: 'begin-field', target, field })
    if (!begun.ok || !begun.edit) throw new Error('expected field edit')
    const updated = state.runSlideFieldTextIntent({ kind: 'update-field', expectedEdit: begun.edit, text: '聚焦时的新内容', composing: false })
    expect(updated.ok).toBe(true)
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    const recovered = state.captureCourseProjectRecoverySnapshot()
    if (!recovered.ok) throw new Error(recovered.reason)
    expect(read(recovered.snapshot.project)).toBe('聚焦时的新内容')
    expect(read(activeDocument())).toBe(original)
    expect(activeHistory().past).toHaveLength(before)
    const saved = state.prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(read(archiveAndReopen(saved.snapshot))).toBe('聚焦时的新内容')
    expect(activeHistory().past).toHaveLength(before + 1)
    expect(useEditorStore.getState().v9ContentEdit).toBeNull()
    useEditorStore.getState().undo()
    expect(read(activeDocument())).toBe(original)
    useEditorStore.getState().redo()
    expect(read(activeDocument())).toBe('聚焦时的新内容')
  })

  it('stores Slide chart drafts through the product action and recovers without live history writes', () => {
    useEditorStore.getState().addChartNode('bar')
    const state = useEditorStore.getState()
    const session = state.slideBackend!.getSession()
    const id = selectSelectedNodeId(state)!
    const item = locateCourseLayer(activeDocument(), id)!.item
    if (item.kind !== 'native' || item.content.nativeType !== 'chart') throw new Error('expected chart')
    acknowledgeBaseline('slide-chart.h5lesson')
    const before = activeHistory().past.length
    const field = { kind: 'title' as const }
    const begun = state.runSlideFieldTextIntent({ kind: 'begin-chart', target: makeSlideAuthoringTarget(session, id, 'item'), field })
    if (!begun.ok || !begun.edit) throw new Error('expected chart edit')
    state.runSlideFieldTextIntent({ kind: 'update-chart', expectedEdit: begun.edit, draft: createChartTextDraft(item.content.data, field, '保存中的标题'), composing: false })
    const read = (document: CourseProjectDocument) => {
      const item = locateCourseLayer(document, id)!.item
      if (item.kind !== 'native' || item.content.nativeType !== 'chart') throw new Error('expected chart')
      return item.content.data.title
    }
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    const recovery = state.captureCourseProjectRecoverySnapshot()
    if (!recovery.ok) throw new Error(recovery.reason)
    expect(read(recovery.snapshot.project)).toBe('保存中的标题')
    expect(activeHistory().past).toHaveLength(before)
    const saved = state.prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(read(archiveAndReopen(saved.snapshot))).toBe('保存中的标题')
    expect(activeHistory().past).toHaveLength(before + 1)
    expect(useEditorStore.getState().v9ContentEdit).toBeNull()
  })

  it('recovers Spatial chart text during composition, refuses premature save, and saves once after composition', () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().addChartNode('bar')
    const session = useEditorStore.getState().spatialSession!
    const id = selectSelectedNodeId(useEditorStore.getState())!
    const item = locateCourseLayer(activeDocument(), id)!.item
    if (item.kind !== 'native' || item.content.nativeType !== 'chart') throw new Error('expected chart')
    acknowledgeBaseline('spatial-chart.h5lesson')
    const before = activeHistory().past.length
    const field = { kind: 'series' as const, id: item.content.data.series[0]!.id }
    const begun = beginSpatialWorldChartTextEdit({ session, layerItemId: id, field })
    if (!begun.ok) throw new Error(begun.reason)
    const draft = createChartTextDraft(item.content.data, field, '组合输入中的系列')
    const composing = updateSpatialWorldChartTextDraft(begun.edit, draft, true)
    useEditorStore.setState({ spatialContentEdit: composing })
    const read = (document: CourseProjectDocument) => {
      const item = locateCourseLayer(document, id)!.item
      if (item.kind !== 'native' || item.content.nativeType !== 'chart') throw new Error('expected chart')
      return item.content.data.series[0]!.name
    }
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    expect(useEditorStore.getState().prepareCourseProjectPersistence()).toMatchObject({ ok: false, reason: 'composing' })
    const recovered = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    if (!recovered.ok) throw new Error(recovered.reason)
    expect(read(recovered.snapshot.project)).toBe(draft.text)
    expect(activeHistory().past).toHaveLength(before)
    expect(read(activeDocument())).toBe(item.content.data.series[0]!.name)
    useEditorStore.setState({ spatialContentEdit: updateSpatialWorldChartTextDraft(composing, draft, false) })
    const saved = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(read(archiveAndReopen(saved.snapshot))).toBe(draft.text)
    expect(activeHistory().past).toHaveLength(before + 1)
    expect(useEditorStore.getState().spatialContentEdit).toBeNull()
    useEditorStore.getState().undo()
    expect(read(activeDocument())).toBe(item.content.data.series[0]!.name)
  })

  it('recovers Spatial table text during composition, refuses premature save, and saves once after composition', () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().addTableNode()
    const session = useEditorStore.getState().spatialSession!
    const id = selectSelectedNodeId(useEditorStore.getState())!
    const item = locateCourseLayer(activeDocument(), id)!.item
    if (item.kind !== 'native' || item.content.nativeType !== 'table') throw new Error('expected table')
    acknowledgeBaseline('spatial-table.h5lesson')
    const before = activeHistory().past.length
    const cellId = item.content.data.rows[0]!.cells[0]!.id
    const begun = beginSpatialWorldTableTextEdit({ session, layerItemId: id, cellId })
    if (!begun.ok) throw new Error(begun.reason)
    const draft = { text: '组合输入中的单元格' }
    const composing = { ...begun.edit, draft, composing: true }
    useEditorStore.setState({ spatialContentEdit: composing })
    const read = (document: CourseProjectDocument) => {
      const item = locateCourseLayer(document, id)!.item
      if (item.kind !== 'native' || item.content.nativeType !== 'table') throw new Error('expected table')
      return item.content.data.rows[0]!.cells[0]!.text
    }
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    expect(useEditorStore.getState().prepareCourseProjectPersistence()).toMatchObject({ ok: false, reason: 'composing' })
    const recovered = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    if (!recovered.ok) throw new Error(recovered.reason)
    expect(read(recovered.snapshot.project)).toBe(draft.text)
    expect(activeHistory().past).toHaveLength(before)
    expect(read(activeDocument())).toBe(item.content.data.rows[0]!.cells[0]!.text)
    useEditorStore.setState({ spatialContentEdit: { ...composing, composing: false } })
    const saved = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(read(archiveAndReopen(saved.snapshot))).toBe(draft.text)
    expect(activeHistory().past).toHaveLength(before + 1)
    expect(useEditorStore.getState().spatialContentEdit).toBeNull()
    useEditorStore.getState().undo()
    expect(read(activeDocument())).toBe(item.content.data.rows[0]!.cells[0]!.text)
  })

  it.each(['table-caption', 'table-header'] as const)('archives and recovers a focused Flow %s without changing live recovery history', field => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().addTableNode()
    const session = useEditorStore.getState().flowSession!
    const table = flowSurfaceIn(session.history.present, session.selection.surfaceId).blocks.find(block => block.type === 'table')!
    if (table.type !== 'table') throw new Error('expected table')
    acknowledgeBaseline('flow-table.h5lesson')
    const before = activeHistory().past.length
    const begun = beginFlowTableFieldEdit({ project: activeDocument(), selection: session.selection, blockId: table.id, field, columnId: field === 'table-header' ? table.columns[0]!.id : undefined })
    if (!begun.ok) throw new Error(begun.reason)
    useEditorStore.getState().setFlowTextEdit(updateFlowTextDraft(begun.edit, { text: '未失焦的表格文字' }))
    const read = (document: CourseProjectDocument) => {
      const block = flowSurfaceIn(document, session.selection.surfaceId).blocks.find(block => block.id === table.id)!
      if (block.type !== 'table') throw new Error('expected table')
      return field === 'table-caption' ? block.caption : block.columns[0]!.header
    }
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    const recovered = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    if (!recovered.ok) throw new Error(recovered.reason)
    expect(read(recovered.snapshot.project)).toBe('未失焦的表格文字')
    expect(activeHistory().past).toHaveLength(before)
    const saved = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(read(archiveAndReopen(saved.snapshot))).toBe('未失焦的表格文字')
    expect(activeHistory().past).toHaveLength(before + 1)
    useEditorStore.getState().undo()
    expect(read(activeDocument())).toBe(field === 'table-caption' ? table.caption : table.columns[0]!.header)
  })

  it('recovers a focused Flow chart label and archives it with one history entry', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().addChartNode('bar')
    const session = useEditorStore.getState().flowSession!
    const surface = flowSurfaceIn(session.history.present, session.selection.surfaceId)!
    const block = surface.blocks.find(block => block.type === 'chart')!
    if (block.type !== 'chart') throw new Error('expected chart')
    acknowledgeBaseline('chart.h5lesson')
    const before = activeHistory().past.length
    const field = { kind: 'category' as const, id: block.chart.categories[0]!.id }
    const begun = beginFlowChartTextEdit({ project: activeDocument(), selection: session.selection, blockId: block.id, field })
    if (!begun.ok) throw new Error(begun.reason)
    useEditorStore.getState().setFlowTextEdit(updateFlowChartTextDraft(begun.edit,
      createChartTextDraft(block.chart, field, '保持焦点的新分类'), false))
    const read = (document: CourseProjectDocument) => {
      const chart = findFlowBlockRecursive(flowSurfaceIn(document, surface.id)!.blocks, block.id)!.block
      if (chart.type !== 'chart') throw new Error('expected chart')
      return chart.chart.categories[0]!.label
    }
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    const recovered = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    if (!recovered.ok) throw new Error(recovered.reason)
    expect(read(recovered.snapshot.project)).toBe('保持焦点的新分类')
    expect(activeHistory().past).toHaveLength(before)
    expect(read(activeDocument())).toBe(block.chart.categories[0]!.label)
    const saved = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(read(archiveAndReopen(saved.snapshot))).toBe('保持焦点的新分类')
    expect(useEditorStore.getState().flowTextEdit).toBeNull()
    expect(activeHistory().past).toHaveLength(before + 1)
    useEditorStore.getState().prepareCourseProjectPersistence()
    expect(activeHistory().past).toHaveLength(before + 1)
    useEditorStore.getState().undo()
    expect(read(activeDocument())).toBe(block.chart.categories[0]!.label)
  })

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
