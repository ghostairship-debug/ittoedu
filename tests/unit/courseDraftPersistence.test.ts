import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '@/renderer/course/flowEditorView'
import type { FlowDocumentDraft } from '@/renderer/authoring/flowDocumentDraft'
import { plainDocumentText } from '@/shared/document/content'
import { beginSpatialWorldTableTextEdit } from '@/renderer/authoring/spatialWorldAuthoring'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importComponentPackage } from '../../src/core/drivers/codecs/importComponentPackage'
import { readLayerTextField, type LayerTextField } from '@/renderer/authoring/layerTextField'
import { componentPackagesToArchiveFiles } from '@/renderer/components/componentPackageStore'
import { findFlowBlockRecursive, flowSurfaceIn } from '@/core/tools/flowDocumentModel'
import { selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import {
  beginFlowChartTextEdit,
  updateFlowChartTextDraft,
  updateFlowTextDraft,
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

function currentFlowTarget() {
  const state = useEditorStore.getState()
  const session = state.flowSession!
  return captureFlowEditorAuthoringTarget({ view: buildFlowEditorView({ project: session.history.present, locationId: session.selection.locationId }), sessionToken: state.courseAuthoringSession!.token, target: { kind: 'surface' } })
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

  it.each(['table-caption', 'table-header'] as const)('saves canonical Flow %s through recovery and archive with one history entry', field => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().addTableNode()
    const session = useEditorStore.getState().flowSession!
    const surface = flowSurfaceIn(session.history.present, session.selection.surfaceId)
    const blocks = structuredClone(surface.blocks)
    const table = blocks.find(block => block.type === 'table')!
    if (table.type !== 'table') throw new Error('expected table')
    acknowledgeBaseline('flow-table.h5lesson')
    const before = activeHistory().past.length
    const content = { inlines: [{ type: 'text' as const, text: '未失焦的表格文字' }] }
    if (field === 'table-caption') table.caption = content
    else table.columns[0]!.header = content
    expect(useEditorStore.getState().runFlowAuthoringIntent(currentFlowTarget(), { kind: 'replace-document-content', blocks, historyGroup: field }).ok).toBe(true)
    const read = (document: CourseProjectDocument) => {
      const block = flowSurfaceIn(document, surface.id).blocks.find(block => block.id === table.id)!
      if (block.type !== 'table') throw new Error('expected table')
      return plainDocumentText((field === 'table-caption' ? block.caption : block.columns[0]!.header) ?? { inlines: [] })
    }
    const recovered = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    if (!recovered.ok) throw new Error(recovered.reason)
    expect(read(recovered.snapshot.project)).toBe('未失焦的表格文字')
    const saved = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(read(archiveAndReopen(saved.snapshot))).toBe('未失焦的表格文字')
    expect(activeHistory().past).toHaveLength(before + 1)
    useEditorStore.getState().undo()
    expect(read(activeDocument())).not.toBe('未失焦的表格文字')
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

  it('saves canonical Flow content, keeps later source drafts dirty, and groups editing history', () => {
    useEditorStore.getState().createNewFlowProject()
    const flow = useEditorStore.getState().flowSession!
    const surface = flowSurfaceIn(flow.history.present, flow.selection.surfaceId)
    const paragraph = surface.blocks.find(block => block.type === 'paragraph')!
    acknowledgeBaseline('flow.h5lesson')
    const before = activeHistory().past.length
    const update = (text: string) => {
      const blocks = structuredClone(flowSurfaceIn(activeDocument(), surface.id).blocks)
      const block = blocks.find(block => block.id === paragraph.id)!
      if (block.type !== 'paragraph') throw new Error('expected paragraph')
      block.content = { inlines: [{ type: 'text', text }] }
      expect(useEditorStore.getState().runFlowAuthoringIntent(currentFlowTarget(), { kind: 'replace-document-content', blocks, historyGroup: 'typing' }).ok).toBe(true)
    }
    update('版本A')
    update('版本B')
    expect(activeHistory().past).toHaveLength(before + 1)
    const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!preparation.ok) throw new Error(preparation.reason)
    const reopened = flowSurfaceIn(archiveAndReopen(preparation.snapshot), surface.id).blocks.find(block => block.id === paragraph.id)!
    expect(reopened.type === 'paragraph' && plainDocumentText(reopened.content)).toBe('版本B')
    const target = currentFlowTarget()
    expect(useEditorStore.getState().runFlowAuthoringIntent(target, { kind: 'update-document-draft', source: '$未闭合', diagnostics: [{ message: '公式未闭合', line: 1, column: 1, offset: 0, endOffset: 4 }], composing: false }).ok).toBe(true)
    expect(useEditorStore.getState().acknowledgeCourseProjectSaved('flow.h5lesson', preparation.token)).toBe(false)
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    expect(useEditorStore.getState().prepareCourseProjectPersistence().ok).toBe(false)
    expect(useEditorStore.getState().captureCourseProjectRecoverySnapshot().ok).toBe(true)
    useEditorStore.getState().runFlowAuthoringIntent(target, { kind: 'clear-document-draft' })
    useEditorStore.getState().undo()
    const restored = flowSurfaceIn(activeDocument(), surface.id).blocks.find(block => block.id === paragraph.id)!
    expect(restored.type === 'paragraph' && plainDocumentText(restored.content)).toBe('')
  })

  it('preserves a composing Flow source separately and refuses premature save', () => {
    useEditorStore.getState().createNewFlowProject()
    const target = currentFlowTarget()
    const before = activeDocument()
    const draft: FlowDocumentDraft = { surfaceId: target.surfaceId!, revision: target.documentRevision, source: '输入法组合中的文字', diagnostics: [], composing: true }
    useEditorStore.setState({ flowDocumentDraft: draft })
    expect(useEditorStore.getState().prepareCourseProjectPersistence().ok).toBe(false)
    expect(useEditorStore.getState().flowDocumentDraft).toBe(draft)
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    const recovery = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    if (!recovery.ok) throw new Error(recovery.reason)
    expect(recovery.snapshot.project).toBe(before)
  })

  it('saves canonical Flow formula LaTeX through the archive without adding save history', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().addFormulaNode()
    const session = useEditorStore.getState().flowSession!
    const surface = flowSurfaceIn(session.history.present, session.selection.surfaceId)
    const blocks = structuredClone(surface.blocks)
    const formula = blocks.find(block => block.type === 'formula')!
    if (formula.type !== 'formula') throw new Error('expected formula')
    const before = activeHistory().past.length
    formula.latex = 'a+b'
    formula.accessibleText = 'a加b'
    expect(useEditorStore.getState().runFlowAuthoringIntent(currentFlowTarget(), { kind: 'replace-document-content', blocks, historyGroup: 'formula' }).ok).toBe(true)
    const saved = useEditorStore.getState().prepareCourseProjectPersistence()
    if (!saved.ok) throw new Error(saved.reason)
    expect(flowSurfaceIn(archiveAndReopen(saved.snapshot), surface.id).blocks.find(block => block.id === formula.id)).toMatchObject({ latex: 'a+b', accessibleText: 'a加b' })
    expect(activeHistory().past).toHaveLength(before + 1)
  })

  it('keeps invalid Flow formula source outside V9 and refuses save without corrupting recovery', () => {
    useEditorStore.getState().createNewFlowProject()
    const before = useEditorStore.getState()
    const target = currentFlowTarget()
    expect(before.runFlowAuthoringIntent(target, { kind: 'update-document-draft', source: '$\\frac{x}$', diagnostics: [{ message: '分母缺失', offset: 0, endOffset: 10, line: 1, column: 1 }], composing: false }).ok).toBe(true)
    const after = useEditorStore.getState()
    expect(selectHasUnsavedCourseChanges(after)).toBe(true)
    expect(after.prepareCourseProjectPersistence().ok).toBe(false)
    expect(after.captureCourseProjectRecoverySnapshot().ok).toBe(true)
    expect(after.flowSession?.history).toBe(before.flowSession?.history)
    expect(after.courseAssetSidecar).toBe(before.courseAssetSidecar)
    expect(after.flowDocumentDraft?.source).toBe('$\\frac{x}$')
  })
})
