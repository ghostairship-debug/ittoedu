import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { ComponentBackground, ComponentFlowBodyLayout, JsonValue } from '../../../shared/contracts/component-platform/project'
import type { DocumentSelection } from '../../../shared/document/ports'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { PropertiesOwnerReadModel } from '../../composition/properties/PropertiesAuthoringReadModel'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import type { FlowAuthoringIntent, createFlowAuthoringSlice } from '../../store/slices/flowAuthoringSlice'
import { flowBodyIds, projectFlowBlock } from '../../componentPlatform/surfaces/flow/documentProjection'
import { flowTextStyleEdits } from '../../componentPlatform/surfaces/flow/documentSelection'
import type { FlowPropertiesCommands, FlowPropertiesContext, FlowPropertiesView } from './FlowPropertiesPanel'
import type { PropertiesPatch, SlideNativePropertiesContext } from './SlideNativePropertiesPanel'
import { surfaceSettingsEdits } from '../../../core/course/courseSemanticEdits'
import { flowBodyLayoutEdits, flowPlacementEdits } from '../../../core/course/courseFlowEdits'
import { componentPropertiesEdits, propertiesEffectiveBackground } from './componentProperties'
import { assertFlowStructureEditsAllowed, flowStructureDisabledReason } from '../../authoring/flowStructureEdits'
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

/** Reading structure and professional properties write the same V10 instances. */
export function buildFlowPropertiesOwner(input: {
  read: PropertiesOwnerReadModel; kernel: EditorStoreKernel
  actions: Pick<ReturnType<typeof createFlowAuthoringSlice>, 'runFlowAuthoringIntent'>
  documentSelection: DocumentSelection | null
  selectedContext: SlideNativePropertiesContext | null; assets: Record<string, AssetMeta>
  liveTarget(): CapturedCourseTarget
  submit(edits: ComponentEdit[], target?: CapturedCourseTarget, group?: string): void
  preview(edits: ComponentEdit[] | null, owner?: 'surface' | 'instance'): void
  report(error: unknown): void
}): FlowPropertiesContext | null {
  const { read, liveTarget, submit, report, actions } = input
  const project = read.project, surface = read.surface
  if (!project || surface?.kind !== 'flow' || read.selectedIsGlobal || read.selectedInstanceIds.length > 1) return null
  const blocks: FlowPropertiesView['blocks'][number][] = []
  const collect = (ids: readonly string[], parentId: string | null) => ids.forEach((blockId, index) => {
    const block = projectFlowBlock(project, blockId)
    blocks.push({ blockId, block, parentId, index, label: project.instances[blockId]?.name ?? `${block.type} ${index + 1}` })
    if (block.type === 'section') collect(project.instances[blockId]?.childIds ?? [], blockId)
  })
  collect(flowBodyIds(project, surface.id), null)
  const selected = read.selectedInstance, definition = selected ? project.definitions[selected.definitionId] : null
  const semantic = definition?.implementation.kind === 'builtin' && ['guoling.text', 'guoling.document-block'].includes(definition.implementation.key) && !selected?.flowPlacement
  const background = surface.background
  const view: FlowPropertiesView = { surfaceId: surface.id, surfaceTitle: surface.title,
    backgroundMode: background?.mode ?? 'inherit', backgroundColor: background?.color, backgroundAssetId: background?.assetId,
    effectiveBackground: propertiesEffectiveBackground(project, surface), layout: { widthMode: surface.flow?.layout.widthMode ?? 'reading' }, blocks }
  const selection = input.documentSelection
  const textRange = selection?.kind === 'text' && selection.anchor.blockId === selection.head.blockId && JSON.stringify(selection.anchor.slot) === JSON.stringify(selection.head.slot)
    ? { blockId: selection.anchor.blockId, start: Math.min(selection.anchor.offset, selection.head.offset), end: Math.max(selection.anchor.offset, selection.head.offset),
      ...(selection.anchor.slot.kind === 'item' ? { listItemId: selection.anchor.slot.itemId } : {}),
      ...(selection.anchor.slot.kind === 'cell' ? { tableRowId: selection.anchor.slot.rowId, tableColumnId: selection.anchor.slot.columnId } : {}),
      ...(selection.anchor.slot.kind === 'header' ? { tableColumnId: selection.anchor.slot.columnId } : {}) } : null
  const run = (fn: () => unknown) => { try { void Promise.resolve(fn()).catch(report) } catch (error) { report(error) } }
  const intent = async (value: FlowAuthoringIntent) => { const receipt = await actions.runFlowAuthoringIntent(liveTarget(), value); if (!receipt.ok) throw new Error(receipt.reason) }
  const backgroundValue = (value: { backgroundMode?: 'inherit' | 'own'; backgroundColor?: string; backgroundAssetId?: string | null }): ComponentBackground => ({
    ...(value.backgroundMode === undefined ? {} : { mode: value.backgroundMode }),
    ...(value.backgroundColor === undefined ? {} : { color: value.backgroundColor, mode: 'own' as const }),
    ...(value.backgroundAssetId === undefined ? {} : { assetId: value.backgroundAssetId, mode: 'own' as const }) })
  const unavailable = () => report('请使用所选组件的专业属性控件。')
  const nativePatch = (patch: PropertiesPatch): void | Promise<void> => {
    try {
      const target = liveTarget(), instance = target.instanceId ? target.editingProject.instances[target.instanceId] : null
      if (!instance) throw new Error('请先选择讲义对象。')
      assertFlowStructureEditsAllowed(target.editingProject, componentPropertiesEdits(instance, target.project.definitions[instance.definitionId], patch))
      // The existing properties owner reports event failures; buffered inputs must receive its actual ACK.
      return input.selectedContext?.commands.patch(patch)
    } catch (error) {
      report(error)
      const pending = Promise.reject<void>(error)
      void pending.catch(() => {})
      return pending
    }
  }
  const commands: FlowPropertiesCommands = {
    reportError: report, previewNative: input.selectedContext?.commands.preview,
    previewTextColor: color => run(() => {
      if (color === null) return input.preview(null)
      if (selection?.kind === 'text') {
        const edits = flowTextStyleEdits(liveTarget().editingProject, selection, { color })
        return input.preview(edits.length ? edits : null)
      }
      if (selected && definition?.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.text' && !textRange)
        input.preview([{ type: 'data.set', instanceId: selected.id, path: ['appearance', 'color'], value: color }])
    }),
    setWidthMode: widthMode => run(() => intent({ kind: 'set-width-mode', widthMode })),
    renamePage: (_surfaceId, title) => run(() => intent({ kind: 'rename-page', title })),
    setPaperBackground: (_surfaceId, backgroundColor) => run(() => intent({ kind: 'set-paper-background', backgroundColor })),
    updateSurfaceBackground: value => run(() => { const target = liveTarget(); submit(surfaceSettingsEdits(target.editingProject, surface.id,
      { background: backgroundValue(value) }), target) }),
    previewSurfaceBackground: value => run(() => input.preview(value.backgroundColor == null ? null : surfaceSettingsEdits(liveTarget().editingProject, surface.id,
      { background: { mode: 'own', color: value.backgroundColor } }), 'surface')),
    importSurfaceBackgroundAsset: file => run(() => { const target = liveTarget(), id = crypto.randomUUID(); submit([
      { type: 'asset.add', asset: { id, path: `assets/${id}/${file.name}`, filename: file.name, mimeType: file.mimeType, kind: 'image', byteLength: file.bytes.byteLength }, bytes: file.bytes },
      ...surfaceSettingsEdits(target.editingProject, surface.id, { background: { mode: 'own', assetId: id } })], target) }),
    patchSelectedBlock: patch => {
      try {
        const target = liveTarget(), instance = target.instanceId ? target.editingProject.instances[target.instanceId] : null
        if (!instance) throw new Error('请先选择正文块。')
        const impl = target.project.definitions[instance.definitionId]?.implementation
        const isText = impl?.kind === 'builtin' && impl.key === 'guoling.text'
        const layoutPatch: Partial<ComponentFlowBodyLayout> = {}
        const edits: ComponentEdit[] = Object.entries(patch).flatMap(([key, value]): ComponentEdit[] => {
          if (value === undefined) return []
          if (key === 'wrap' || key === 'layout' || (key === 'caption' && impl?.kind === 'builtin' && ['guoling.image', 'guoling.video', 'guoling.audio'].includes(impl.key))) {
            Object.assign(layoutPatch, key === 'wrap' ? { wrap: value } : key === 'layout' ? { width: value } : { caption: value })
            return []
          }
          return [{ type: 'data.set', instanceId: instance.id, path: isText && (key === 'textAlign' || key === 'lineSpacing') ? ['appearance', key === 'textAlign' ? 'align' : key]
            : key === 'altText' && impl?.kind === 'builtin' ? [impl.key === 'guoling.image' ? 'alt' : 'title'] : [key], value: json(value) }]
        })
        if (Object.keys(layoutPatch).length) edits.push(...flowBodyLayoutEdits(target.editingProject, instance.id, layoutPatch))
        assertFlowStructureEditsAllowed(target.editingProject, edits)
        submit(edits, target); return null
      } catch (error) { report(error); return error instanceof Error ? error.message : String(error) }
    },
    patchOverlayProperties: nativePatch,
    replaceMediaAsset: assetId => run(() => { const target = liveTarget(); if (target.instanceId) submit([{ type: 'data.set', instanceId: target.instanceId, path: ['assetId'], value: assetId }], target) }),
    importReplacementMedia: unavailable,
    moveSelectedBlock: direction => run(() => intent({ kind: 'move-block', direction })),
    convertSelectedToOverlay: () => run(() => intent({ kind: 'convert-block-to-overlay' })),
    convertOverlayToDocument: async (destination, signal) => {
      if (signal?.aborted) return
      const target = liveTarget(), id = target.instanceId
      if (!id) throw new Error('请先选择浮层组件。')
      const edits = flowPlacementEdits(target.editingProject, id, { kind: 'document', surfaceId: surface.id,
        ...(destination ? { parentId: destination.parentBlockId ?? null, index: destination.index, wrap: destination.wrap ?? 'none' } : {}) })
      assertFlowStructureEditsAllowed(target.editingProject, edits)
      await input.kernel.editCaptured(input.kernel.capture(edits, target))
    },
    deleteSelectedBlocks: () => run(() => intent({ kind: 'delete-blocks', blockIds: [...read.selectedInstanceIds] })),
    formatBlock: spec => run(() => intent({ kind: 'format-block', spec })),
    formatTextStyle: style => run(() => intent({ kind: 'format-text-style', style, expectedEdit: null })),
    patchOverlayPaperSpace: paperSpace => run(() => intent({ kind: 'patch-overlay-paper-space', paperSpace })),
    commitOverlayFormula: unavailable, beginTableFieldEdit: unavailable, updateTableFieldDraft: unavailable, finishTableFieldEdit: unavailable,
    beginBlockFormulaEdit: unavailable, updateBlockFormulaDraft: unavailable, setBlockFormulaComposing: unavailable,
    cancelBlockFormulaEdit: unavailable, commitBlockFormula: unavailable,
  }
  const block = selected ? projectFlowBlock(project, selected.id) : null
  const structureDisabledReason = selected ? flowStructureDisabledReason(project, selected.id) : null
  const bodyRoot = selected && !selected.flowPlacement && blocks.some(item => item.blockId === selected.id)
  const native = input.selectedContext ? { ...input.selectedContext, commands: { ...input.selectedContext.commands, patch: nativePatch },
    ...(bodyRoot ? { frameEditingEnabled: false,
      frameDimensionsEditingEnabled: Boolean(selected?.frame) && (block?.type === 'course-instance' || block?.type === 'course-component' || (block?.type === 'media' && block.mediaKind === 'image')) } : {}),
    ...(structureDisabledReason ? { frameEditingEnabled: false, frameDimensionsEditingEnabled: false } : {}) } : null
  return { kind: !selected ? 'flow-page' : semantic ? 'flow-block' : 'flow-component', view, assets: input.assets,
    selection: { selectedBlockId: selected?.id ?? null, selectedBlockIds: read.selectedInstanceIds, textRange }, native,
    flowPlacement: selected?.flowPlacement, flowLayout: selected?.flowLayout, block, structureDisabledReason,
    textEdit: null, draftBindingKey: JSON.stringify([read.documentId, read.epoch, surface.id, read.activeStateId, read.selectedInstanceIds]),
    course: { backgroundColor: project.background?.color, backgroundAssetId: project.background?.assetId }, commands }
}
