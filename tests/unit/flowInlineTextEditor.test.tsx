import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import {
  enterFlowTextEditing,
  selectFlowEditorBlocks,
} from '@/renderer/course/flowEditorSlice'
import {
  FLOW_TEXT_REJECT_COMPOSING,
  FLOW_TEXT_REJECT_FORMULA_RUNS,
  applyFlowTextEditRunStyle,
  applyFlowTextEditGesture,
  beginFlowFormulaEdit,
  beginFlowTextEdit,
  buildFlowRichTextHtml,
  commitFlowTextEdit,
  deriveFlowSelectionFormat,
  extractFlowRichTextFromEditor,
  formatFlowAuthoringTextStyle,
  isFlowTextDraftDirty,
  markFlowTextComposing,
  resolveFlowTextBlur,
  resolveFlowTextHistoryAction,
  resolveFlowTextKeyDown,
  updateFlowTextDraft,
  updateFlowTextRange,
} from '@/renderer/authoring/flowTextEdit'
import { executeFlowEditorCommand } from '@/renderer/course/flowEditorCommands'

/**
 * Proves Flow text/range-format transactions (IME, runs, shared Properties fn).
 * Does not prove Workspace shell, PropertiesTab, Player, or default open/save.
 */
const NOW = '2026-08-17T17:00:00.000Z'

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'flow-text-edit',
    revision: 1,
    title: 'Flow 文字',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {},
    componentPackages: {},
    designTokens: {
      fonts: [{
        id: 'body',
        label: '正文',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      }],
      colors: [
        { id: 'background', label: '背景', color: '#ffffff' },
        { id: 'text', label: '正文', color: '#1f2937' },
      ],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
      },
    },
    playback: {
      controls: 'none',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
  }
}

function createFlowProject(): CourseProjectDocument {
  const blocks: FlowBlock[] = [
    { id: 'h1', type: 'heading', level: 1, text: '标题一' },
    {
      id: 'p-runs',
      type: 'paragraph',
      text: '春⭐风',
      runs: [{ start: 0, end: 2, style: { bold: true } }],
    },
    {
      id: 'formula-1',
      type: 'formula',
      formulaId: 'formula-1',
      accessibleText: 'a + b',
      ast: {
        type: 'row',
        children: [
          { type: 'token', value: 'a' },
          { type: 'operator', value: '+' },
          { type: 'token', value: 'b' },
        ],
      },
    },
  ]
  const project: CourseProjectDocument = {
    ...courseShell(),
    locations: [{
      id: 'h1',
      label: '标题一',
      kind: 'flow-block',
      surfaceId: 'flow',
      blockId: 'h1',
    }],
    startLocationId: 'h1',
    surfaces: [{
      id: 'flow',
      type: 'flow',
      title: '讲义',
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      surfaceLayerItems: [{
        item: sceneNodeToCourseLayerItem(createTextNode({
          id: 'overlay-text',
          name: '浮层文字',
          text: '浮层',
        }), 20),
        visibility: { mode: 'all', locationIds: [] },
      }],
      blocks,
    }],
  }
  syncFlowCourseLocations(project, 'flow')
  return courseProjectDocumentSchema.parse(project)
}

function paragraphOf(project: CourseProjectDocument) {
  const surface = project.surfaces.find((entry) => entry.id === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('expected flow')
  const block = surface.blocks.find((entry) => entry.id === 'p-runs')
  if (!block || block.type !== 'paragraph') throw new Error('expected paragraph')
  return block
}

describe('Flow inline text editor bridge', () => {
  it('round-trips authored font family and size through the contenteditable DOM', () => {
    const root = document.createElement('span')
    root.style.fontFamily = 'sans-serif'
    root.style.fontSize = '16px'
    root.innerHTML = buildFlowRichTextHtml('甲乙丙丁', [{
      start: 2,
      end: 4,
      style: { fontFamily: 'SimSun', fontSize: 30, bold: true },
    }])
    document.body.append(root)

    expect(extractFlowRichTextFromEditor(root)).toEqual({
      text: '甲乙丙丁',
      runs: [{
        start: 2,
        end: 4,
        style: { fontFamily: 'SimSun', fontSize: 30, bold: true },
      }],
    })

    root.remove()
  })

  it('uses enterFlowTextEditing for double-click, Enter, and second text click', () => {
    const project = createFlowProject()
    const selected = selectFlowEditorBlocks(project, 'h1', ['p-runs'])
    const viaDouble = applyFlowTextEditGesture({
      project,
      selection: selected,
      blockId: 'p-runs',
      gesture: 'double-click',
      offset: 1,
    })
    const viaEnter = applyFlowTextEditGesture({
      project,
      selection: selected,
      blockId: 'p-runs',
      gesture: 'enter',
      offset: 1,
    })
    const viaClick = applyFlowTextEditGesture({
      project,
      selection: selected,
      blockId: 'p-runs',
      gesture: 'click-text',
      offset: 1,
    })
    expect(viaDouble.ok && viaEnter.ok && viaClick.ok).toBe(true)
    if (!viaDouble.ok || !viaEnter.ok || !viaClick.ok) return
    expect(viaDouble.selection.focus).toBe('text')
    expect(viaEnter.selection).toEqual(viaDouble.selection)
    expect(viaClick.selection).toEqual(viaDouble.selection)
    expect(viaDouble.selection.authoringAddress).toContain('field=text')
    expect(viaDouble.edit.kind).toBe('rich-text')
  })

  it('does not apply runs to a formula; formula edit is a separate session', () => {
    const project = createFlowProject()
    const selected = selectFlowEditorBlocks(project, 'h1', ['formula-1'])
    const asText = beginFlowTextEdit({
      project,
      selection: selected,
      blockId: 'formula-1',
    })
    expect(asText).toEqual({ ok: false, reason: FLOW_TEXT_REJECT_FORMULA_RUNS })
    const formula = beginFlowFormulaEdit({ project, selection: selected, blockId: 'formula-1' })
    expect(formula.ok).toBe(true)
    if (!formula.ok) return
    expect(formula.edit.kind).toBe('formula')
  })

  it('materializes a caret pending style only on subsequently inserted text', () => {
    const project = createFlowProject()
    const selected = selectFlowEditorBlocks(project, 'h1', ['p-runs'])
    const begun = beginFlowTextEdit({
      project,
      selection: selected,
      blockId: 'p-runs',
      range: { blockId: 'p-runs', start: 1, end: 1 },
    })
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    const pending = applyFlowTextEditRunStyle(begun.edit, {
      fontFamily: 'SimSun',
      fontSize: 28,
      underline: true,
    })
    expect(pending.draft).toEqual(begun.edit.draft)
    expect(pending.pendingStyle).toEqual({
      fontFamily: 'SimSun',
      fontSize: 28,
      underline: true,
    })
    expect(isFlowTextDraftDirty(pending)).toBe(false)
    expect(deriveFlowSelectionFormat({ block: paragraphOf(project), edit: pending })).toMatchObject({
      mode: 'caret',
      canApplyInlineStyle: true,
      hasPendingStyle: true,
      fields: {
        fontFamily: { state: 'uniform', value: 'SimSun' },
        fontSize: { state: 'uniform', value: 28 },
        underline: { state: 'uniform', value: true },
      },
    })

    const typed = updateFlowTextDraft(pending, { text: '春新⭐风' })
    const afterInput = updateFlowTextRange(typed, { start: 2, end: 2 }, {
      preservePendingStyle: true,
    })
    const typedDraft = afterInput.draft as { text: string; runs: Array<{
      start: number
      end: number
      style: { fontFamily?: string; fontSize?: number; underline?: boolean }
    }> }
    expect(typedDraft.runs).toContainEqual({
      start: 1,
      end: 2,
      style: { bold: true, fontFamily: 'SimSun', fontSize: 28, underline: true },
    })
    expect(typedDraft.runs.every((run) => run.end > run.start)).toBe(true)
    expect(afterInput.pendingStyle).toEqual(pending.pendingStyle)

    const moved = updateFlowTextRange(pending, { start: 2, end: 2 })
    expect(moved.pendingStyle).toEqual({})

    const committed = commitFlowTextEdit(project, begun.selection, afterInput, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(committed.ok).toBe(true)
    expect(committed.historyEntry).toBe(true)
    expect(paragraphOf(committed.nextDocument!).text).toBe('春新⭐风')
  })

  it('supports a pending font and size in an empty paragraph without a zero-length run', () => {
    const project = createFlowProject()
    const paragraph = paragraphOf(project)
    paragraph.text = ''
    delete paragraph.runs
    const selected = selectFlowEditorBlocks(project, 'h1', ['p-runs'])
    const begun = beginFlowTextEdit({
      project,
      selection: selected,
      blockId: 'p-runs',
      range: { blockId: 'p-runs', start: 0, end: 0 },
    })
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    const pending = applyFlowTextEditRunStyle(begun.edit, { fontFamily: 'KaiTi', fontSize: 32 })
    const typed = updateFlowTextDraft(pending, { text: '新' })
    expect(typed.draft).toEqual({
      text: '新',
      runs: [{ start: 0, end: 1, style: { fontFamily: 'KaiTi', fontSize: 32 } }],
    })
  })

  it('keeps IME composition from committing, then writes text + runs through apply-text', () => {
    const project = createFlowProject()
    const selected = selectFlowEditorBlocks(project, 'h1', ['p-runs'])
    const begun = beginFlowTextEdit({
      project,
      selection: selected,
      blockId: 'p-runs',
      range: { blockId: 'p-runs', start: 0, end: 3 },
    })
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(resolveFlowTextKeyDown({
      kind: 'rich-text',
      composing: true,
      key: 'Enter',
      ctrlKey: true,
    })).toBe('ignore')
    expect(resolveFlowTextBlur({ composing: true })).toBe('defer')
    const composing = markFlowTextComposing(begun.edit, true)
    const blocked = commitFlowTextEdit(project, begun.selection, composing, { now: NOW })
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBe(FLOW_TEXT_REJECT_COMPOSING)

    const drafted = updateFlowTextDraft(markFlowTextComposing(composing, false), {
      text: '春⭐风已改',
      runs: [{ start: 0, end: 2, style: { bold: true, italic: true } }],
    })
    expect(isFlowTextDraftDirty(drafted)).toBe(true)
    const committed = commitFlowTextEdit(project, begun.selection, drafted, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(committed.ok).toBe(true)
    expect(committed.historyEntry).toBe(true)
    const paragraph = paragraphOf(committed.nextDocument!)
    expect(paragraph).toMatchObject({
      type: 'paragraph',
      text: '春⭐风已改',
      runs: [{ start: 0, end: 2, style: { bold: true, italic: true } }],
    })
    expect(courseProjectDocumentSchema.parse(committed.nextDocument)).toEqual(committed.nextDocument)
  })

  it('lets the paper toolbar and Properties call the same format function', () => {
    const project = createFlowProject()
    const selected = selectFlowEditorBlocks(project, 'h1', ['p-runs'])
    const fromProperties = formatFlowAuthoringTextStyle({
      document: project,
      selection: selected,
      style: { italic: true },
      range: { start: 0, end: 2 },
      now: NOW,
    })
    expect(fromProperties.ok).toBe(true)
    expect(fromProperties.historyEntry).toBe(true)
    const viaCommand = executeFlowEditorCommand(project, enterFlowTextEditing(project, selected, {
      blockId: 'p-runs',
      start: 0,
      end: 2,
    }), {
      name: 'format',
      spec: { kind: 'text-style', style: { italic: true }, range: { start: 0, end: 2 } },
    }, { now: NOW, expectedRevision: project.revision })
    expect(viaCommand.nextDocument).toEqual(fromProperties.nextDocument)

    const begun = beginFlowTextEdit({
      project,
      selection: selected,
      blockId: 'p-runs',
      range: { blockId: 'p-runs', start: 0, end: 2 },
    })
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const whileEditing = formatFlowAuthoringTextStyle({
      document: project,
      selection: begun.selection,
      style: { color: '#cc0000' },
      range: { start: 0, end: 2 },
      edit: begun.edit,
    })
    expect(whileEditing.historyEntry).toBe(false)
    expect(whileEditing.nextDocument).toBe(project)
    expect(whileEditing.nextEdit?.kind).toBe('rich-text')
    const draft = whileEditing.nextEdit!.draft as { text: string; runs: Array<{ style: { color?: string } }> }
    expect(draft.runs.some((run) => run.style.color === '#cc0000')).toBe(true)
  })

  it('formats the whole block when Properties has no caret range', () => {
    const project = createFlowProject()
    const selected = selectFlowEditorBlocks(project, 'h1', ['p-runs'])
    const result = formatFlowAuthoringTextStyle({
      document: project,
      selection: selected,
      style: { underline: true },
      now: NOW,
    })
    expect(result.ok).toBe(true)
    const paragraph = paragraphOf(result.nextDocument!)
    expect(paragraph.runs?.some((run) => run.style.underline)).toBe(true)
  })

  it('cancels a dirty draft on undo instead of skipping to the previous structure action', () => {
    expect(resolveFlowTextHistoryAction({
      composing: true,
      draftDirty: true,
      action: 'undo',
    })).toBe('ignore')
    expect(resolveFlowTextHistoryAction({
      composing: false,
      draftDirty: true,
      action: 'undo',
    })).toBe('cancel')
  })
})
