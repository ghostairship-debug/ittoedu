import { useRef } from 'react'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { ComponentInstance, JsonValue } from '../../../shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { TextRunEdit } from '../../../shared/textRuns'
import { formatTextComponentRange, replaceTextComponentRange, textComponentDataSchema, type TextComponentData } from '../../../components/text/data'
import { parseTableData, tableCellContent } from '../../../components/table/data'
import { editTableData, type TableEdit } from '../../../components/table/edit'
import { createChartPropertiesCommands } from '../../ui/properties/chartPropertiesCommands'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import { useEditorStore, selectEditingScope } from '../../store/editorStore'
import { projectWithSlideContentDraft } from '../../store/slices/slideAuthoringSlice'
import { selectPropertiesAuthoringReadModel } from './PropertiesAuthoringReadModel'
import { componentPropertiesEdits, propertiesEffectiveBackground, propertiesFeedbackTargets, propertiesText } from '../../ui/properties/componentProperties'
import type { PropertiesContext } from '../../ui/properties/PropertiesContext'
import type { SlideNativeTextCommands, PropertiesPatch, SlideNativePropertiesContext } from '../../ui/properties/SlideNativePropertiesPanel'
import { buildFlowPropertiesOwner } from '../../ui/properties/FlowPropertiesContextBuilder'
import { buildSpatialPropertiesOwner } from '../../ui/properties/SpatialPropertiesContextBuilder'
import type { BackgroundPreviewTarget } from '../../authoring/backgroundPreview'
import { buildCourseGlobalPropertiesOwner } from '../../ui/properties/CourseGlobalPropertiesContextBuilder'
import { buildRuntimePropertiesContexts } from '../../ui/properties/RuntimePropertiesContextBuilder'
import { applyComponentOperation, captureComponentOperation } from '../../../core/drivers/courseV10Operations'
import { inspectComponentInputRules, configureComponentInputRules } from '../../../components/input/authoring'
import { chartDataSchema } from '../../../components/chart/data'
import { useCourseEditorActions } from '../../documents/CourseEditorActionsContext'

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const STALE = '属性草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。'

interface TextPropertySession {
  key: string
  target: CapturedCourseTarget
  instanceId: string
  initial: TextComponentData
  current: TextComponentData
  group: string
  composing: boolean
  sharedDraft: boolean
}

function rangeReplacement(before: string, after: string): TextRunEdit {
  const old = Array.from(before), next = Array.from(after)
  let start = 0, end = old.length, tail = next.length
  while (start < end && start < tail && old[start] === next[start]) ++start
  while (end > start && tail > start && old[end - 1] === next[tail - 1]) { --end; --tail }
  return { start, end, original: old.slice(start, end).join(''), replacement: next.slice(start, tail).join('') }
}

/** Original controls bind to a captured V10 document/selection. Session remains the only writer/history owner. */
export function usePropertiesAuthoringBinding({ onReplaceImage }: { readonly onReplaceImage: () => void }): PropertiesContext {
  const read = useEditorStore(selectPropertiesAuthoringReadModel)
  const kernel = useEditorStore(state => state.courseKernel)
  const actions = useCourseEditorActions()
  const textSession = useRef<TextPropertySession | null>(null)
  const cellSession = useRef<{ key: string; cellId: string; baseline: string; baselineContent: ReturnType<typeof tableCellContent>;
    group: string; composing: boolean; sharedDraft: boolean } | null>(null)
  const key = JSON.stringify([read.documentId, read.epoch, read.surface?.id, read.activeStateId, read.selectedInstanceIds, read.editingGlobal])
  const feedback = (value: { kind: 'error' | 'status'; message: string }) => kernel.setFeedback(value.kind === 'error'
    ? { errorMessage: value.message, statusMessage: null } : { errorMessage: null, statusMessage: value.message })
  const report = (error: unknown) => feedback({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
  const liveTarget = (): CapturedCourseTarget => {
    const current = kernel.readView()
    if (JSON.stringify([current.activeDocumentId, current.snapshot?.epoch, current.surfaceId, current.activeStateId, current.selectedInstanceIds, selectEditingScope(useEditorStore.getState()) === 'global']) !== key) throw new Error(STALE)
    return kernel.captureTarget(read.documentId ?? undefined)
  }
  const sharedDraftFor = (target: CapturedCourseTarget) => {
    const draft = useEditorStore.getState().slideContentEdit
    return draft && draft.target.documentId === target.documentId && draft.target.epoch === target.epoch
      && draft.target.surfaceId === target.surfaceId && draft.target.activeStateId === target.activeStateId ? draft : null
  }
  const editingInstance = (target: CapturedCourseTarget, instanceId: string): ComponentInstance | null => {
    const base = target.editingProject.instances[instanceId]
    if (!base) return null
    const draft = sharedDraftFor(target)
    if (draft?.instanceId !== instanceId) return base
    return projectWithSlideContentDraft(target.editingProject, draft, { documentId: target.documentId, epoch: target.epoch,
      surfaceId: target.surfaceId, activeStateId: target.activeStateId }).instances[instanceId]
  }
  const submit = (edits: ComponentEdit[], target = liveTarget(), group?: string): Promise<void> => {
    if (!edits.length) return Promise.resolve()
    const activePreview = useEditorStore.getState().previewBackgroundColor
    if (activePreview && activePreview.target.documentId === target.documentId && activePreview.target.epoch === target.epoch
      && activePreview.target.surfaceId === target.surfaceId && activePreview.target.stateId === target.activeStateId
      && (activePreview.target.owner !== 'instance' || activePreview.target.instanceId === target.instanceId))
      useEditorStore.getState().setPreviewBackgroundColor(null, activePreview.target)
    const shared = sharedDraftFor(target)
    const draftEdits = shared ? edits.filter(edit => (edit.type === 'data.set' || edit.type === 'frame.set') && edit.instanceId === shared.instanceId) : []
    if (shared && draftEdits.length) {
      const project = { ...target.editingProject, instances: { ...target.editingProject.instances,
        [shared.instanceId]: editingInstance(target, shared.instanceId)! } }
      const next = applyComponentOperation(project, captureComponentOperation(project, draftEdits))
      useEditorStore.getState().updateSlideDataDraft(next.instances[shared.instanceId].data)
      const frameEdits = draftEdits.filter((edit): edit is Extract<ComponentEdit, { type: 'frame.set' }> => edit.type === 'frame.set')
      if (frameEdits.length) useEditorStore.getState().updateSlideFrameDraft(frameEdits.at(-1)!.frame)
      edits = edits.filter(edit => !draftEdits.includes(edit))
      if (!edits.length) return Promise.resolve()
    }
    const pending = kernel.editCaptured(kernel.capture(edits, target), group).then(() => undefined)
    // Event-only consumers still report failures; buffered consumers receive the original ACK.
    void pending.catch(report)
    return pending
  }
  const run = (action: () => unknown) => { try { void Promise.resolve(action()).catch(report) } catch (error) { report(error) } }
  const commit = (action: () => Promise<void>): Promise<void> => {
    try { return action() } catch (error) {
      report(error)
      const pending = Promise.reject<void>(error)
      void pending.catch(() => {})
      return pending
    }
  }
  const preview = (edits: ComponentEdit[] | null, owner: BackgroundPreviewTarget['owner'] = 'instance') => {
    if (!edits) {
      const current = useEditorStore.getState().previewBackgroundColor
      if (current && current.target.documentId === read.documentId && current.target.epoch === read.epoch
        && current.target.surfaceId === read.surface?.id && current.target.stateId === read.activeStateId
        && current.target.owner === owner && (owner !== 'instance' || current.target.instanceId === read.selectedInstance?.id))
        useEditorStore.getState().setPreviewBackgroundColor(null, current.target)
      return
    }
    const target = liveTarget()
    const captured: BackgroundPreviewTarget = { documentId: target.documentId, epoch: target.epoch, surfaceId: target.surfaceId,
      stateId: target.activeStateId, owner, ...(owner === 'instance' && target.instanceId ? { instanceId: target.instanceId } : {}) }
    useEditorStore.getState().setPreviewBackgroundColor(edits ? { target: captured, edits } : null, captured)
  }
  const patch = (value: PropertiesPatch) => commit(() => {
    const target = liveTarget(), instance = target.instanceId ? editingInstance(target, target.instanceId) : null
    if (!instance) throw new Error('所选组件已不存在。')
    return submit(componentPropertiesEdits(instance, target.project.definitions[instance.definitionId], value), target)
  })
  const assets: Record<string, AssetMeta> = Object.fromEntries(Object.values(read.project?.assets ?? {}).map(asset => [asset.id, {
    ...asset, filename: asset.filename ?? asset.path.split(/[\\/]/u).at(-1) ?? asset.id,
    mimeType: asset.mimeType ?? 'application/octet-stream', byteLength: asset.byteLength ?? read.resources.assets[asset.id]?.byteLength ?? 0,
    kind: asset.kind ?? (asset.mimeType?.startsWith('audio/') ? 'audio' : asset.mimeType?.startsWith('video/') ? 'video' : asset.mimeType?.startsWith('font/') ? 'font' : 'image'),
  }]))
  const openAutomation = () => useEditorStore.getState().setActiveTab('automation')
  const textCommands: SlideNativeTextCommands = {
    beginEdit: source => {
      try {
        const target = liveTarget(), instanceId = target.instanceId
        if (!instanceId) throw new Error('请先选择文字。')
        if (source === 'canvas') { useEditorStore.getState().beginTextEdit(instanceId, 'canvas'); return }
        const shared = read.surface?.kind !== 'flow' ? useEditorStore.getState().beginSlideDataEdit(instanceId, 'properties') : null
        if (read.surface?.kind !== 'flow' && !shared) throw new Error('请先完成当前内容编辑。')
        const data = textComponentDataSchema.parse(shared?.data ?? target.editingProject.instances[instanceId].data)
        if (textSession.current?.key !== key) textSession.current = { key, target, instanceId,
          initial: structuredClone(data), current: data, group: `properties-text:${crypto.randomUUID()}`, composing: false, sharedDraft: Boolean(shared) }
      } catch (error) { report(error) }
    },
    updateDraft: (nextText, suppliedEdit) => run(() => {
      let session = textSession.current
      if (!session || session.key !== key) { textCommands.beginEdit('properties'); session = textSession.current }
      if (!session || session.key !== key) throw new Error(STALE)
      const target = liveTarget()
      const before = propertiesText(session.current)
      const edit = suppliedEdit && Array.from(before).slice(suppliedEdit.start, suppliedEdit.end).join('') === suppliedEdit.original
        ? suppliedEdit : rangeReplacement(before, nextText)
      if (edit.replacement.includes('\uFFFC')) throw new Error('行内公式保持为原子；新增公式请使用正文公式控件。')
      const inlines = session.current.content.inlines
      let offset = 0
      const inherited = inlines.find(inline => {
        offset += inline.type === 'text' ? Array.from(inline.text).length : 1
        return offset >= edit.start
      })?.style
      session.current = replaceTextComponentRange(session.current, edit.start, edit.end,
        { inlines: edit.replacement ? [{ type: 'text', text: edit.replacement, ...(inherited ? { style: inherited } : {}) }] : [] })
      if (session.composing && !session.sharedDraft) return kernel.bridge.updateComposition(json(session.current.content), session.target.documentId)
      submit([{ type: 'data.set', instanceId: session.instanceId, path: ['content'], value: json(session.current.content) }], target, session.group)
    }),
    setComposing: composing => run(() => {
      const session = textSession.current
      if (!session || session.key !== key) throw new Error(STALE)
      if (session.composing === composing) return
      session.composing = composing
      if (session.sharedDraft) { useEditorStore.getState().setSlideTextEditComposing(composing); return }
      if (composing) kernel.bridge.beginComposition(session.instanceId, ['content'], session.target.documentId)
      else return kernel.bridge.endComposition(session.target.documentId)
    }),
    commitEdit: () => run(() => { const session = textSession.current; if (session?.key !== key || session.composing) return;
      textSession.current = null; if (session.sharedDraft) return useEditorStore.getState().commitSlideContentEdit() }),
    cancelEdit: () => run(() => {
      const session = textSession.current
      if (!session || session.key !== key) return
      if (session.sharedDraft) {
        const shared = useEditorStore.getState().slideContentEdit
        if (shared?.instanceId === session.instanceId && shared.target.documentId === session.target.documentId && shared.target.epoch === session.target.epoch)
          useEditorStore.getState().cancelTextEdit()
        textSession.current = null; return
      }
      const target = liveTarget()
      submit([{ type: 'data.set', instanceId: session.instanceId, path: ['content'], value: json(session.initial.content) }], target, session.group)
      textSession.current = null
    }),
    toggleStyle: (field, range) => run(() => {
      const target = liveTarget(), instanceId = target.instanceId
      if (!instanceId) return
      const data = textComponentDataSchema.parse(read.project!.instances[instanceId].data)
      const display = propertiesText(data), from = Array.from(display.slice(0, range.start)).length, to = Array.from(display.slice(0, range.end)).length
      if (from === to) { patch({ style: { [field]: !data.appearance[field] } } as PropertiesPatch); return }
      const styled = formatTextComponentRange(data, from, to, { [field]: !data.appearance[field] })
      submit([{ type: 'data.set', instanceId, path: ['content'], value: json(styled.content) }], target)
      if (textSession.current?.key === key) textSession.current.current = styled
    }),
  }
  const node = read.selectedView, selected = read.selectedInstance
  const tableChange = (edit: TableEdit | ((source: ReturnType<typeof parseTableData>) => TableEdit)) => run(() => {
    const target = liveTarget(), instanceId = target.instanceId
    if (!instanceId) return
    const source = parseTableData(read.project!.instances[instanceId].data)
    const next = editTableData(source, typeof edit === 'function' ? edit(source) : edit)
    submit([{ type: 'data.set', instanceId, path: [], value: json(next) }], target)
  })
  const tableCell = (cellId: string) => {
    const target = liveTarget(), instanceId = target.instanceId
    if (!instanceId) throw new Error('表格已不存在。')
    const table = parseTableData(read.project!.instances[instanceId].data)
    for (const [row, item] of table.rows.entries()) for (const [column, cell] of item.cells.entries()) {
      if (cell.id === cellId) { const content = tableCellContent(cell); return { target, instanceId,
        path: ['rows', String(row), 'cells', String(column), cell.content ? 'content' : 'text'], content, rich: Boolean(cell.content),
        value: content.inlines.map(inline => inline.type === 'text' ? inline.text : '\uFFFC').join('') } }
    }
    throw new Error('单元格已不存在。')
  }
  const nextCellContent = (content: ReturnType<typeof tableCellContent>, text: string) => {
    const data = textComponentDataSchema.parse({ content }), edit = rangeReplacement(propertiesText(data), text)
    if (edit.replacement.includes('\uFFFC')) throw new Error('表格公式保持为原子；新增公式请使用正文专业编辑器。')
    let offset = 0
    const style = content.inlines.find(inline => { offset += inline.type === 'text' ? Array.from(inline.text).length : 1; return offset >= edit.start })?.style
    return replaceTextComponentRange(data, edit.start, edit.end, { inlines: edit.replacement ? [{ type: 'text', text: edit.replacement, ...(style ? { style } : {}) }] : [] }).content
  }
  const moved = (ids: string[], id: string, direction: -1 | 1) => {
    const index = ids.indexOf(id), next = index + direction
    if (index >= 0 && next >= 0 && next < ids.length) { ids.splice(index, 1); ids.splice(next, 0, id) }
    return ids
  }
  const table: SlideNativePropertiesContext['commands']['table'] = node?.type === 'table' ? {
    beginCellEdit: cellId => run(() => {
      const cell = tableCell(cellId)
      if (cellSession.current?.key !== key || cellSession.current.cellId !== cellId) cellSession.current = {
        key, cellId, baseline: cell.value, baselineContent: structuredClone(cell.content), group: `properties-cell:${crypto.randomUUID()}`, composing: false,
        sharedDraft: useEditorStore.getState().slideContentEdit?.instanceId === cell.instanceId }
    }),
    updateCellDraft: (cellId, text, composing) => run(() => {
      const cell = tableCell(cellId)
      if (cellSession.current?.key !== key || cellSession.current.cellId !== cellId) table!.beginCellEdit(cellId)
      const session = cellSession.current!
      const value = cell.rich ? json(nextCellContent(cell.content, text)) : text
      if (session.sharedDraft) { useEditorStore.getState().setSlideTextEditComposing(composing); session.composing = composing;
        submit([{ type: 'data.set', instanceId: cell.instanceId, path: cell.path, value }], cell.target, session.group); return }
      if (composing && !session.composing) { kernel.bridge.beginComposition(cell.instanceId, cell.path, cell.target.documentId); session.composing = true }
      if (session.composing) {
        void kernel.bridge.updateComposition(value, cell.target.documentId).then(() => {
          if (!composing) { session.composing = false; return kernel.bridge.endComposition(cell.target.documentId) }
        }).catch(report)
      } else submit([{ type: 'data.set', instanceId: cell.instanceId, path: cell.path, value }], cell.target, session.group)
    }),
    cancelCellEdit: cellId => run(() => {
      const session = cellSession.current
      if (session?.key === key && session.cellId === cellId) {
        const cell = tableCell(cellId)
        if (cell.value !== session.baseline) submit([{ type: 'data.set', instanceId: cell.instanceId, path: cell.path,
          value: cell.rich ? json(session.baselineContent) : session.baseline }], cell.target, session.group)
        cellSession.current = null
      }
    }),
    commitCellText: (cellId, text) => run(() => {
      const cell = tableCell(cellId)
      if (cell.value !== text) submit([{ type: 'data.set', instanceId: cell.instanceId, path: cell.path,
        value: cell.rich ? json(nextCellContent(cell.content, text)) : text }], cell.target, cellSession.current?.group)
      cellSession.current = null
    }),
    commitLastCellAndAppendRow: (cellId, text) => tableChange({ kind: 'last-cell-append', cellId, content: nextCellContent(tableCell(cellId).content, text) }),
    mergeCells: region => tableChange({ kind: 'merge', region }),
    splitCells: (rowId, columnId) => tableChange({ kind: 'split', rowId, columnId }),
    patchStyle: stylePatch => tableChange({ kind: 'table-style', stylePatch }),
    patchCellStyle: (cellId, stylePatch) => tableChange({ kind: 'cell-style', cellId, stylePatch }),
    setRowHeight: (rowId, height) => tableChange({ kind: 'row-height', rowId, height }),
    setColumnWidth: (columnId, width) => tableChange({ kind: 'column-width', columnId, width }),
    insertRow: (referenceRowId, position) => tableChange({ kind: 'insert-row', referenceRowId, position }),
    deleteRow: rowId => tableChange({ kind: 'delete-row', rowId }),
    moveRow: (rowId, direction) => tableChange(source => ({ kind: 'reorder-rows', orderedRowIds: moved(source.rows.map(row => row.id), rowId, direction) })),
    insertColumn: (referenceColumnId, position) => tableChange({ kind: 'insert-column', referenceColumnId, position }),
    deleteColumn: columnId => tableChange({ kind: 'delete-column', columnId }),
    moveColumn: (columnId, direction) => tableChange(source => ({ kind: 'reorder-columns', orderedColumnIds: moved(source.columns.map(column => column.id), columnId, direction) })),
  } : null
  const chartData = node?.type === 'chart' && selected ? chartDataSchema.parse(selected.data) : null
  const chart = node?.type === 'chart' && chartData ? createChartPropertiesCommands(chartData, next => {
    try {
      const target = liveTarget(), current = chartDataSchema.parse(target.editingProject.instances[node.id].data), edits: ComponentEdit[] = []
      for (const field of ['title', 'chartType', 'categories', 'series'] as const) if (JSON.stringify(chartData[field]) !== JSON.stringify(next[field]))
        edits.push({ type: 'data.set', instanceId: node.id, path: [field], value: json(next[field]) })
      if (JSON.stringify(chartData.style) !== JSON.stringify(next.style)) {
        const style: Record<string, unknown> = next.chartType !== current.chartType ? { ...next.style } : { ...current.style }
        if (next.chartType === current.chartType) for (const field of new Set([...Object.keys(chartData.style), ...Object.keys(next.style)])) {
          const before = Reflect.get(chartData.style, field), after = Reflect.get(next.style, field)
          if (JSON.stringify(before) === JSON.stringify(after)) continue
          if (after === undefined) delete style[field]; else style[field] = after
        }
        edits.push({ type: 'data.set', instanceId: node.id, path: ['style'], value: json(style) })
      }
      submit(edits, target); return null
    }
    catch (error) { return error instanceof Error ? error.message : String(error) }
  }, report) : null
  const selectedContext: SlideNativePropertiesContext | null = node && selected ? {
    kind: 'slide-native', draftBindingKey: key, view: node, target: { layerItemId: selected.id },
    disabledReason: read.error, contentEditingEnabled: true, spatialMode: read.surface?.kind === 'spatial',
    frameEditingEnabled: Boolean(selected.frame), flowOrSpatial: read.surface?.kind !== 'slide', editingScopeGlobal: read.selectedIsGlobal,
    notices: { surfaceBaseEditing: false, sceneOwner: read.surface?.kind === 'slide' && !read.selectedIsGlobal,
      presentationStateName: read.surface?.presentation?.states.find(state => state.id === read.activeStateId)?.title ?? null,
      stateOverrideApplied: Boolean(read.activeStateId && read.surface?.presentation?.states.find(state => state.id === read.activeStateId)?.overrides[selected.id]) },
    videoDiagnostics: [], animation: null, interaction: null, globalInteraction: null,
    component: read.project?.definitions[selected.definitionId] ? { definition: read.project.definitions[selected.definitionId], instance: selected, assets: read.project.assets,
      onChange: data => commit(() => submit([{ type: 'data.set', instanceId: selected.id, path: [], value: data }])),
      onPreview: data => run(() => preview(data===null?null:[{type:'data.set',instanceId:selected.id,path:[],value:data}])) } : null,
    runtime: read.project?.definitions[selected.definitionId] ? buildRuntimePropertiesContexts({ scope: read.selectedIsGlobal ? 'global' : 'scene',
      definition: read.project.definitions[selected.definitionId], instance: selected, assetCount: Object.keys(read.project.assets).length,
      components: read.resources?.components,
      setEnabled: visible => patch({ visible }), editSource: () => run(() => { liveTarget(); useEditorStore.getState().setActiveTab('developer') }) }) : null,
    commands: { patch, preview: value => run(() => { if (value === null) return preview(null)
      const target = liveTarget(); const instance = target.instanceId ? editingInstance(target, target.instanceId) : null
      preview(instance ? componentPropertiesEdits(instance, target.project.definitions[instance.definitionId], value) : null) }),
      replaceImage: () => run(() => { liveTarget(); onReplaceImage() }),
      transformImage: actions?.transformImage ? async operations => { liveTarget(); await actions.transformImage!(operations) } : undefined,
      clearPresentationOverride: () => run(() => {
        const target = liveTarget(), surface = target.project.surfaces.find(value => value.id === target.surfaceId)
        if (!surface?.presentation || !target.activeStateId || !target.instanceId) return
        const presentation = structuredClone(surface.presentation)
        delete presentation.states.find(state => state.id === target.activeStateId)!.overrides[target.instanceId]
        submit([{ type: 'surface.presentation.set', surfaceId: surface.id, presentation }], target)
      }),
      openAutomation, openProfessionalAutomation: openAutomation, text: textCommands, table, chart,
      input: node.type === 'input' && read.project && read.surface ? {
        inspection: inspectComponentInputRules(read.project, read.surface.id, selected.id),
        feedbackTargets: propertiesFeedbackTargets(read.project, read.surface.id, selected.id),
        configure: request => { try { return configureComponentInputRules(kernel, liveTarget(), request) } catch (error) { return error instanceof Error ? error.message : String(error) } },
      } : null }, onFeedback: feedback,
  } : null
  const global = buildCourseGlobalPropertiesOwner({ read, selectedContext, assets, key, liveTarget, submit, preview,
    ensureTeacherController: async () => { await useEditorStore.getState().ensureTeacherController() },
    editSource: () => run(() => { liveTarget(); useEditorStore.getState().setActiveTab('developer') }), openAutomation, report })
  if (global) return global
  const flow = buildFlowPropertiesOwner({ read, kernel, actions: useEditorStore.getState(), documentSelection: useEditorStore.getState().flowContextSelection ?? null,
    selectedContext, assets, liveTarget, submit, preview, report })
  const spatial = buildSpatialPropertiesOwner({ read, kernel, actions: useEditorStore.getState(), assets, liveTarget, submit, preview, report })
  if (flow) return flow
  if (read.selectedInstanceIds.length === 0 && spatial) return spatial
  if (read.selectedInstanceIds.length > 1) return {
    kind: 'multi-selection', items: read.selectedViews, spatialMode: read.surface?.kind === 'spatial', presentation: null, unavailableReason: null,
    commands: { setVisible: visible => run(() => submit(read.selectedInstanceIds.map(instanceId => ({ type: 'instance.patch', instanceId, patch: { visible } })))),
      setLocked: locked => run(() => submit(read.selectedInstanceIds.map(instanceId => ({ type: 'instance.patch', instanceId, patch: { locked } })))),
      align: mode => run(() => { liveTarget(); return useEditorStore.getState().alignSelectedNodes(mode) }),
      distribute: axis => run(() => { liveTarget(); return useEditorStore.getState().distributeSelectedNodes(axis) }),
      duplicate: () => run(() => { liveTarget(); return useEditorStore.getState().duplicateSelectedNodes() }), remove: () => run(() => { liveTarget(); return useEditorStore.getState().deleteSelectedNodes() }) },
  }
  if (selectedContext) return selectedContext
  if (read.selectedInstanceIds.length) return { kind: 'stale-target', reason: read.error ?? '所选组件已不存在。' }
  const surface = read.surface
  if (!surface || !read.project) return { kind: 'stale-target', reason: read.error ?? '当前没有打开的课件。' }
  const baseSurface = read.baseProject?.surfaces.find(value => value.id === surface.id) ?? surface
  const background = baseSurface.background
  const activeState = baseSurface.presentation?.states.find(value => value.id === read.activeStateId) ?? null
  const backgroundFields = { backgroundMode: background?.mode ?? 'inherit' as const, backgroundColor: background?.color, backgroundAssetId: background?.assetId }
  const updateBackground = (value: { backgroundMode?: 'inherit' | 'own'; backgroundColor?: string; backgroundAssetId?: string | null }) => run(() => {
    const target = liveTarget(), current = target.project.surfaces.find(item => item.id === surface.id)?.background
    submit([{ type: 'surface.background.set', surfaceId: surface.id, background: { ...current,
      ...(value.backgroundMode === undefined ? {} : { mode: value.backgroundMode }),
      ...(value.backgroundColor === undefined ? {} : { color: value.backgroundColor, mode: 'own' }),
      ...(value.backgroundAssetId === undefined ? {} : { assetId: value.backgroundAssetId, mode: 'own' }),
    } }], target)
  })
  const importBackground = (file: { name: string; mimeType: string; bytes: Uint8Array }) => run(() => {
    const target = liveTarget(), id = crypto.randomUUID()
    submit([{ type: 'asset.add', asset: { id, path: `assets/${id}/${file.name}`, mimeType: file.mimeType }, bytes: file.bytes },
      { type: 'surface.background.set', surfaceId: surface.id, background: { ...background, mode: 'own', assetId: id } }], target)
  })
  const changeStateBackground = (value: { backgroundColor?: string; backgroundAssetId?: string | null }, inherit?: 'color' | 'assetId') => run(() => {
    const target = liveTarget(), current = target.project.surfaces.find(value => value.id === surface.id)
    if (!current?.presentation || !target.activeStateId) throw new Error('请先选择展示状态。')
    const presentation = structuredClone(current.presentation), state = presentation.states.find(value => value.id === target.activeStateId)!
    const background = { ...state.background, ...(value.backgroundColor === undefined ? {} : { color: value.backgroundColor, mode: 'own' as const }),
      ...(value.backgroundAssetId === undefined ? {} : { assetId: value.backgroundAssetId, mode: 'own' as const }) }
    if (inherit) delete background[inherit]
    state.background = background
    submit([{ type: 'surface.presentation.set', surfaceId: surface.id, presentation }], target)
  })
  const previewSurface = (value: { backgroundColor?: string | null }) => run(() => preview(value.backgroundColor == null ? null : [
    { type: 'surface.background.set', surfaceId: surface.id, background: { ...background, mode: 'own', color: value.backgroundColor } }], 'surface'))
  return { kind: 'empty-scene', draftBindingKey: key, surfaceOnly: true, assets, slideSurface: null,
    state: activeState ? { id: activeState.id, name: activeState.title, backgroundColor: activeState.background?.color, backgroundAssetId: activeState.background?.assetId,
      effective: propertiesEffectiveBackground(read.project, baseSurface, activeState) } : null,
    scene: { id: surface.id, name: surface.title, ...backgroundFields, backgroundColor: background?.color ?? '#ffffff',
      effective: propertiesEffectiveBackground(read.project, baseSurface),
      interactionCount: Object.values(read.project.instances).flatMap(instance => instance.attachments ?? []).filter(value => value.target.kind === 'surface' && value.target.surfaceId === surface.id).length,
      stateName: activeState?.title ?? null,
      canvas: { effective: surface.designSize ?? { width: 1280, height: 720 }, inherited: !surface.designSize } }, runtime: null,
    commands: { updateName: title => run(() => submit([{ type: 'surface.title.set', surfaceId: surface.id, title }])),
      resizeCanvas: designSize => run(() => submit([{ type: 'surface.designSize.set', surfaceId: surface.id, designSize }])),
      updateSceneBackground: updateBackground, updateSlideSurfaceBackground: updateBackground,
      previewSceneBackground: previewSurface, previewSlideSurfaceBackground: previewSurface,
      importSceneBackgroundAsset: importBackground, importSlideSurfaceBackgroundAsset: importBackground,
      updateStateBackground: changeStateBackground, inheritStateColor: () => changeStateBackground({}, 'color'), inheritStateAsset: () => changeStateBackground({}, 'assetId'),
      previewStateBackground: value => run(() => preview(value.backgroundColor == null ? null : [
        { type: 'surface.background.set', surfaceId: surface.id, background: { ...surface.background, mode: 'own', color: value.backgroundColor } }], 'state')),
      openAutomation, openProfessionalAutomation: openAutomation }, onStale: () => report(STALE) }
}
