import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import type { FormulaAstNode, TextNode } from '@/shared/projectTypes'
import {
  V9_SLIDE_CONTENT_REJECT_COMPOSING,
  V9_SLIDE_CONTENT_REJECT_NOT_CANDIDATE,
  V9_SLIDE_CONTENT_REJECT_STALE_GENERATION,
  applyV9SlideContentEditRunStyle,
  beginV9SlideContentEdit,
  cancelV9SlideContentEdit,
  commitV9SlideContentEdit,
  commitV9SlideTextRunStyle,
  deferV9SlideContentAction,
  finishV9SlideContentComposition,
  markV9SlideContentComposing,
  readV9SlideNativeContent,
  resolveV9SlideContentBlur,
  resolveV9SlideContentKeyDown,
  resolveV9SlideContentSelectionChange,
  updateV9SlideContentFormulaDraft,
  updateV9SlideContentTextDraft,
} from '@/renderer/authoring/v9SlideContentEdit'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  createSlideAuthoringBackend,
  makeSlideAuthoringTarget,
  openSlideAuthoringSession,
  setSlideEditingScope,
  type SlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import {
  commitSlideMultiLayerIntentAtTargets,
} from '@/renderer/course/v9SlideContentCommands'
import {
  selectEditingNodes,
  selectSelectedNode,
  selectSlideBackendKind,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'

/**
 * Proves V9 Slide text/formula transactions (IME, runs, generation).
 * Does not prove Workspace, PropertiesTab, Player, or a live Electron window.
 */
const NOW = '2026-08-17T14:20:00.000Z'

function textStyle(extra: Partial<TextNode['style']> = {}) {
  return {
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize: 24,
    color: '#172033',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    emphasis: false,
    highlightColor: null,
    align: 'left' as const,
    verticalAlign: 'top' as const,
    writingMode: 'horizontal' as const,
    lineSpacing: 1.3,
    letterSpacing: 0,
    padding: 4,
    overflow: 'fixed' as const,
    backgroundColor: '#ffffff',
    backgroundOpacity: 0,
    cornerRadius: 0,
    ...extra,
  }
}

function nativeText(
  layerItemId: string,
  order: number,
  text: string,
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'frame'>> & {
    style?: ReturnType<typeof textStyle>
  } = {},
): NativeLayerItem {
  return {
    layerItemId,
    label: text,
    frame: extra.frame ?? { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
    order,
    visible: true,
    locked: extra.locked ?? false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text, runs: [], style: extra.style ?? textStyle() },
    },
  }
}

function nativeFormula(layerItemId: string, order: number, ast: FormulaAstNode): NativeLayerItem {
  return {
    layerItemId,
    label: '公式',
    frame: { mode: 'absolute', x: 480, y: 120, width: 160, height: 80 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'formula',
      data: {
        formulaId: 'formula-area',
        accessibleText: 'x',
        ast,
        style: { fontSize: 24, color: '#172033', align: 'left' },
      },
    },
  }
}

function scoped(item: NativeLayerItem): ScopedLayerItem {
  return {
    item,
    visibility: { mode: 'all', locationIds: [] },
  }
}

function v9SlideFixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r2c-slide-text',
    revision: 1,
    title: 'R2-C text transaction',
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
    globalLayerItems: [scoped(nativeText('global-banner', 50, '全局条'))],
    globalInteractions: [],
    locations: [{
      id: 'location-scene-1',
      label: '场景 1',
      kind: 'slide-scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
    }],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [
          nativeText('slide-title', 1, '春⭐风', {
            frame: { mode: 'absolute', x: 120, y: 120, width: 400, height: 80 },
          }),
          nativeText('slide-locked', 2, '锁定标题', {
            locked: true,
            frame: { mode: 'absolute', x: 120, y: 220, width: 400, height: 80 },
          }),
          nativeText('slide-vertical', 3, '竖排', {
            frame: { mode: 'absolute', x: 120, y: 320, width: 64, height: 180 },
            style: textStyle({ writingMode: 'vertical-lr', overflow: 'auto-height' }),
          }),
          nativeFormula('slide-formula', 4, { type: 'token', value: 'x' }),
        ],
        interactions: [],
      }],
    }],
  })
}

function requireSession(result: { ok: boolean; nextSession?: SlideAuthoringSession }) {
  if (!result.ok || !result.nextSession) throw new Error(result.ok ? 'missing session' : 'command failed')
  return result.nextSession
}

function requireEdit(result: ReturnType<typeof beginV9SlideContentEdit>) {
  if (!result.ok) throw new Error(result.reason)
  return result.edit
}

type NativeTextLayerItem = NativeLayerItem & {
  content: Extract<NativeLayerItem['content'], { nativeType: 'text' }>
}

type NativeFormulaLayerItem = NativeLayerItem & {
  content: Extract<NativeLayerItem['content'], { nativeType: 'formula' }>
}

function isNativeTextLayerItem(item: NativeLayerItem): item is NativeTextLayerItem {
  return item.content.nativeType === 'text'
}

function isNativeFormulaLayerItem(item: NativeLayerItem): item is NativeFormulaLayerItem {
  return item.content.nativeType === 'formula'
}

function nativeTextData(session: SlideAuthoringSession, layerItemId: string): NativeTextLayerItem {
  const item = readV9SlideNativeContent(session, layerItemId)
  if (!item || !isNativeTextLayerItem(item)) throw new Error('expected text')
  return item
}

function nativeFormulaData(session: SlideAuthoringSession, layerItemId: string): NativeFormulaLayerItem {
  const item = readV9SlideNativeContent(session, layerItemId)
  if (!item || !isNativeFormulaLayerItem(item)) throw new Error('expected formula')
  return item
}

describe('V9 Slide text/formula transactions', () => {
  beforeEach(() => {
    useEditorStore.getState().clearV9SlideCandidateBackend()
    useEditorStore.getState().createNewProject()
  })

  afterEach(() => {
    useEditorStore.getState().clearV9SlideCandidateBackend()
  })

  it('defaults to the V9 slide authoring backend', () => {
    expect(selectSlideBackendKind(useEditorStore.getState())).toBe('slide-authoring')
    expect(selectSlideAuthoringBackend(useEditorStore.getState())?.kind).toBe('slide-authoring')
  })

  it('rejects text edit when no authoring backend is available', () => {
    expect(beginV9SlideContentEdit({
      backend: null,
      layerItemId: 'slide-title',
    })).toEqual({
      ok: false,
      reason: V9_SLIDE_CONTENT_REJECT_NOT_CANDIDATE,
    })
  })

  it('opens a canvas text/formula session with authoringAddress, revision and generation', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    const backend = createSlideAuthoringBackend(session)
    useEditorStore.getState().injectV9SlideCandidateBackend(backend)
    const candidate = selectSlideAuthoringBackend(useEditorStore.getState())

    const textEdit = requireEdit(beginV9SlideContentEdit({
      backend: candidate,
      layerItemId: 'slide-title',
      source: 'canvas',
    }))
    expect(textEdit.kind).toBe('text')
    expect(textEdit.target.revision).toBe(1)
    expect(textEdit.target.generation).toBe(0)
    expect(textEdit.target.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r2c-slide-text',
      scope: 'scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      carrier: 'native',
      layerItemId: 'slide-title',
      field: 'content.data.text',
    }))
    expect(textEdit.target.authoringAddress).not.toMatch(/hit/i)

    const formulaEdit = requireEdit(beginV9SlideContentEdit({
      session,
      layerItemId: 'slide-formula',
    }))
    expect(formulaEdit.kind).toBe('formula')
    expect(formulaEdit.target.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r2c-slide-text',
      scope: 'scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      carrier: 'native',
      layerItemId: 'slide-formula',
      field: 'content.data',
    }))
  })

  it('blocks IME composing from Enter/blur commit and maps explicit commit/cancel actions', () => {
    expect(resolveV9SlideContentKeyDown({
      kind: 'text',
      composing: true,
      isComposingEvent: true,
      key: 'Enter',
      ctrlKey: true,
    })).toBe('ignore')
    expect(resolveV9SlideContentBlur({ composing: true, blurReady: true })).toBe('defer')
    expect(resolveV9SlideContentKeyDown({
      kind: 'text',
      composing: false,
      key: 'Enter',
      ctrlKey: true,
    })).toBe('commit')
    expect(resolveV9SlideContentKeyDown({
      kind: 'text',
      composing: false,
      key: 'Enter',
    })).toBe('ignore')
    expect(resolveV9SlideContentKeyDown({
      kind: 'formula',
      composing: false,
      key: 'Enter',
    })).toBe('commit')
    expect(resolveV9SlideContentKeyDown({
      kind: 'text',
      composing: false,
      key: 'Escape',
    })).toBe('cancel')
    expect(resolveV9SlideContentBlur({ composing: false, blurReady: true })).toBe('commit')
    expect(resolveV9SlideContentSelectionChange({
      editingLayerItemId: 'slide-title',
      nextSelectionIds: ['slide-formula'],
      composing: false,
    })).toBe('commit')
    expect(resolveV9SlideContentSelectionChange({
      editingLayerItemId: 'slide-title',
      nextSelectionIds: ['slide-title'],
      composing: false,
    })).toBe('ignore')
    expect(resolveV9SlideContentSelectionChange({
      editingLayerItemId: 'slide-title',
      nextSelectionIds: ['slide-formula'],
      composing: true,
    })).toBe('defer')

    const session = openSlideAuthoringSession(v9SlideFixture())
    const edit = requireEdit(beginV9SlideContentEdit({ session, layerItemId: 'slide-title' }))
    const composing = markV9SlideContentComposing(
      updateV9SlideContentTextDraft(edit, { text: '中文输入', runs: [] }),
      true,
    )
    const blocked = commitV9SlideContentEdit(session, composing, { now: NOW })
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toBe(V9_SLIDE_CONTENT_REJECT_COMPOSING)
    expect(nativeTextData(session, 'slide-title').content.data.text).toBe('春⭐风')

    const finished = finishV9SlideContentComposition(deferV9SlideContentAction(composing, 'commit'))
    expect(finished.action).toBe('commit')
    const committed = commitV9SlideContentEdit(session, finished.edit, { now: NOW })
    expect(committed.ok).toBe(true)
    expect(committed.historyEntry).toBe(true)
    expect(nativeTextData(requireSession(committed), 'slide-title').content.data.text).toBe('中文输入')
  })

  it('commits V9 text/runs and formula ast through the same write path, and cancels without history', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    const textEdit = updateV9SlideContentTextDraft(
      requireEdit(beginV9SlideContentEdit({ session, layerItemId: 'slide-title', source: 'canvas' })),
      { text: '春风', runs: [{ start: 0, end: 1, style: { bold: true } }] },
    )
    const textResult = commitV9SlideContentEdit(session, textEdit, { now: NOW })
    const afterText = requireSession(textResult)
    expect(textResult.historyEntry).toBe(true)
    expect(afterText.history.present.revision).toBe(2)
    expect(afterText.history.past).toEqual([session.history.present])
    const written = nativeTextData(afterText, 'slide-title')
    expect(written.content.data.text).toBe('春风')
    expect(written.content.data.runs).toEqual([{ start: 0, end: 1, style: { bold: true } }])

    const cancelled = cancelV9SlideContentEdit(
      afterText,
      requireEdit(beginV9SlideContentEdit({ session: afterText, layerItemId: 'slide-title' })),
    )
    expect(cancelled.ok).toBe(true)
    expect(cancelled.historyEntry).toBe(false)
    expect(cancelled.nextSession).toBe(afterText)

    const formulaEdit = updateV9SlideContentFormulaDraft(
      requireEdit(beginV9SlideContentEdit({ session: afterText, layerItemId: 'slide-formula' })),
      { ast: { type: 'token', value: 'y' }, accessibleText: 'y' },
    )
    const formulaResult = commitV9SlideContentEdit(afterText, formulaEdit, { now: NOW })
    const afterFormula = requireSession(formulaResult)
    expect(nativeFormulaData(afterFormula, 'slide-formula').content.data.ast).toEqual({
      type: 'token',
      value: 'y',
    })
    expect(nativeFormulaData(afterFormula, 'slide-formula').content.data.accessibleText).toBe('y')
  })

  it('applies selection-level bold/italic/color to runs and keeps vertical auto-width fields', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    const formatted = applyV9SlideContentEditRunStyle(
      applyV9SlideContentEditRunStyle(
        applyV9SlideContentEditRunStyle(
          requireEdit(beginV9SlideContentEdit({ session, layerItemId: 'slide-title', source: 'properties' })),
          1,
          2,
          { bold: true },
        ),
        0,
        1,
        { italic: true },
      ),
      2,
      3,
      { color: '#2563eb' },
    )
    const afterRuns = requireSession(commitV9SlideContentEdit(session, formatted, { now: NOW }))
    expect(nativeTextData(afterRuns, 'slide-title').content.data.runs).toEqual([
      { start: 0, end: 1, style: { italic: true } },
      { start: 1, end: 2, style: { bold: true } },
      { start: 2, end: 3, style: { color: '#2563eb' } },
    ])
    expect(nativeTextData(afterRuns, 'slide-title').content.data.text).toBe('春⭐风')

    const propertyRuns = requireSession(commitV9SlideTextRunStyle(afterRuns, {
      layerItemId: 'slide-title',
      selectionStart: 1,
      selectionEnd: 2,
      patch: { underline: true },
      source: 'properties',
    }, { now: NOW }))
    expect(nativeTextData(propertyRuns, 'slide-title').content.data.runs).toEqual([
      { start: 0, end: 1, style: { italic: true } },
      { start: 1, end: 2, style: { bold: true, underline: true } },
      { start: 2, end: 3, style: { color: '#2563eb' } },
    ])

    const verticalEdit = updateV9SlideContentTextDraft(
      requireEdit(beginV9SlideContentEdit({ session: propertyRuns, layerItemId: 'slide-vertical' })),
      { text: '竖排内容增加', runs: [], width: 128, height: 180 },
    )
    const afterVertical = requireSession(commitV9SlideContentEdit(propertyRuns, verticalEdit, { now: NOW }))
    const vertical = nativeTextData(afterVertical, 'slide-vertical')
    expect(vertical.content.data.text).toBe('竖排内容增加')
    expect(vertical.content.data.style.writingMode).toBe('vertical-lr')
    expect(vertical.content.data.style.overflow).toBe('auto-height')
    expect(vertical.frame.width).toBe(128)
    expect(vertical.frame.height).toBe(180)
  })

  it('rejects locked, identity no-op, stale generation and stale revision callbacks', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    expect(beginV9SlideContentEdit({ session, layerItemId: 'slide-locked' })).toEqual({
      ok: false,
      reason: SLIDE_REJECT_LOCKED,
    })

    const unchanged = requireEdit(beginV9SlideContentEdit({ session, layerItemId: 'slide-title' }))
    const noop = commitV9SlideContentEdit(session, unchanged, { now: NOW })
    expect(noop.ok).toBe(true)
    expect(noop.historyEntry).toBe(false)
    expect(noop.nextSession?.history).toBe(session.history)
    expect(noop.nextSession?.selection.selectionIds).toContain('slide-title')

    const liveEdit = updateV9SlideContentTextDraft(
      requireEdit(beginV9SlideContentEdit({ session, layerItemId: 'slide-title' })),
      { text: '新标题', runs: [] },
    )
    const first = requireSession(commitV9SlideContentEdit(session, liveEdit, { now: NOW }))
    const staleRevision = commitV9SlideContentEdit(first, liveEdit, { now: NOW })
    expect(staleRevision.ok).toBe(false)
    expect(staleRevision.reason).toBe(SLIDE_REJECT_STALE_REVISION)

    const generationSession = openSlideAuthoringSession(v9SlideFixture())
    const staleEdit = updateV9SlideContentTextDraft(
      requireEdit(beginV9SlideContentEdit({ session: generationSession, layerItemId: 'slide-title' })),
      { text: '不该写入', runs: [] },
    )
    const switched = requireSession(setSlideEditingScope(generationSession, 'global'))
    const staleGeneration = commitV9SlideContentEdit(switched, staleEdit, { now: NOW })
    expect(staleGeneration.ok).toBe(false)
    expect(staleGeneration.reason).toBe(V9_SLIDE_CONTENT_REJECT_STALE_GENERATION)
    expect(nativeTextData(switched, 'slide-title').content.data.text).toBe('春⭐风')
  })

  it('commits global native text into globalLayerItems, not the scene', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    expect(beginV9SlideContentEdit({ session, layerItemId: 'global-banner' })).toEqual({
      ok: false,
      reason: SLIDE_REJECT_WRONG_OWNER,
    })

    const globalSession = requireSession(setSlideEditingScope(session, 'global'))
    expect(beginV9SlideContentEdit({
      session: globalSession,
      layerItemId: 'slide-title',
    })).toEqual({
      ok: false,
      reason: SLIDE_REJECT_WRONG_OWNER,
    })

    const begun = requireEdit(beginV9SlideContentEdit({
      session: globalSession,
      layerItemId: 'global-banner',
    }))
    const draft = updateV9SlideContentTextDraft(begun, { text: '全课程统一标题', runs: [] })
    const committed = requireSession(commitV9SlideContentEdit(globalSession, draft, { now: NOW }))
    const globalEntry = committed.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-banner',
    )
    expect(globalEntry?.item.kind).toBe('native')
    expect(
      globalEntry?.item.kind === 'native' && globalEntry.item.content.nativeType === 'text'
        ? globalEntry.item.content.data.text
        : null,
    ).toBe('全课程统一标题')
    expect(
      committed.history.present.surfaces[0]?.type === 'slide'
        ? committed.history.present.surfaces[0].scenes[0]?.layerItems.some(
          (item) => item.layerItemId === 'global-banner',
        )
        : true,
    ).toBe(false)
    expect(nativeTextData(committed, 'slide-title').content.data.text).toBe('春⭐风')
    expect(nativeTextData(committed, 'global-banner').content.data.text).toBe('全课程统一标题')
  })

  it('keeps the edited text selected after a canvas overlay commit of local runs', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    expect(session.selection.selectionIds).toEqual([])
    useEditorStore.getState().injectV9SlideCandidateBackend(
      createSlideAuthoringBackend(session),
    )
    const store = useEditorStore.getState()
    expect(store.selectedNodeIds).toEqual([])

    store.beginTextEdit('slide-title', 'canvas')
    store.updateTextEditDraft(
      'slide-title',
      '春⭐风',
      [{ start: 0, end: 2, style: { bold: true, strike: true } }],
      80,
    )
    store.commitTextEdit()

    const after = useEditorStore.getState()
    expect(after.selectedNodeIds).toContain('slide-title')
    expect(after.v9ContentEdit).toBeNull()
    expect(after.editingTextNodeId).toBeNull()
    const selected = selectSelectedNode(after)
    expect(selected?.id).toBe('slide-title')
    expect(selected?.type).toBe('text')
    const projected = selectEditingNodes(after).find((node) => node.id === 'slide-title')
    expect(projected?.type).toBe('text')
  })

  it('commits exact Slide multi-property gestures once and rejects stale targets', () => {
    const document = v9SlideFixture()
    const surface = document.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    const vertical = surface.scenes[0]?.layerItems.find(
      (item) => item.layerItemId === 'slide-vertical',
    )
    if (!vertical) throw new Error('expected vertical text')
    vertical.frame.x = 520
    let backend = createSlideAuthoringBackend(openSlideAuthoringSession(document))
    const selected = backend.selectLayers(['slide-title', 'slide-vertical'], false, {
      expectedRevision: backend.getSnapshot().revision,
    })
    const session = requireSession(selected)
    const targets = session.selection.selectionIds.map((id) => (
      makeSlideAuthoringTarget(session, id, 'item')
    ))

    const aligned = commitSlideMultiLayerIntentAtTargets(session, {
      targets,
      intent: { kind: 'align', mode: 'left' },
    }, { expectedRevision: session.history.present.revision, now: NOW })
    const alignedSession = requireSession(aligned)
    expect(aligned.historyEntry).toBe(true)
    expect(alignedSession.history.past).toHaveLength(session.history.past.length + 1)
    expect(alignedSession.selection.selectionIds).toEqual(['slide-title', 'slide-vertical'])
    expect(nativeTextData(alignedSession, 'slide-vertical').frame.x).toBe(120)

    backend = createSlideAuthoringBackend(alignedSession)
    const changedSelection = requireSession(backend.selectLayers(
      ['slide-title', 'slide-formula'],
      false,
      { expectedRevision: alignedSession.history.present.revision },
    ))
    const stale = commitSlideMultiLayerIntentAtTargets(changedSelection, {
      targets,
      intent: { kind: 'delete' },
    }, { expectedRevision: targets[0]!.revision, now: NOW })
    expect(stale.ok).toBe(false)
    expect(stale.reason).toBe(SLIDE_REJECT_STALE_REVISION)
    expect(stale.nextSession).toEqual(changedSelection)
    expect(stale.historyEntry).toBe(false)
    expect(changedSelection.history.present.surfaces).toEqual(
      alignedSession.history.present.surfaces,
    )
  })

  it('duplicates and deletes exact scene multi-selections with one history entry', () => {
    const project = v9SlideFixture()
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    surface.scenes[0]!.interactions.push({
      id: 'rule-multi-copy',
      name: '复制引用关系',
      enabled: true,
      trigger: { type: 'node.click', nodeId: 'slide-title' },
      conditions: [],
      actions: [{
        id: 'action-multi-copy',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'node.enter',
          nodeId: 'slide-vertical',
          effect: 'fade',
          durationMs: 200,
          easing: 'ease-out',
        },
      }],
    })
    let backend = createSlideAuthoringBackend(openSlideAuthoringSession(project))
    const selected = requireSession(backend.selectLayers(
      ['slide-title', 'slide-vertical'],
      false,
      { expectedRevision: backend.getSnapshot().revision },
    ))
    const targets = selected.selection.selectionIds.map((id) => (
      makeSlideAuthoringTarget(selected, id, 'item')
    ))
    const duplicated = requireSession(commitSlideMultiLayerIntentAtTargets(selected, {
      targets,
      intent: { kind: 'duplicate' },
    }, { expectedRevision: selected.history.present.revision, now: NOW }))
    expect(duplicated.history.past).toHaveLength(selected.history.past.length + 1)
    expect(duplicated.selection.selectionIds).toHaveLength(2)
    expect(duplicated.selection.selectionIds).not.toEqual(selected.selection.selectionIds)
    const duplicatedSurface = duplicated.history.present.surfaces[0]
    if (!duplicatedSurface || duplicatedSurface.type !== 'slide') {
      throw new Error('expected duplicated slide')
    }
    expect(duplicatedSurface.scenes[0]?.interactions).toContainEqual(expect.objectContaining({
      id: expect.not.stringMatching(/^rule-multi-copy$/),
      trigger: {
        type: 'node.click',
        nodeId: duplicated.selection.selectionIds[0],
      },
      actions: [expect.objectContaining({
        id: expect.not.stringMatching(/^action-multi-copy$/),
        action: expect.objectContaining({
          type: 'node.enter',
          nodeId: duplicated.selection.selectionIds[1],
        }),
      })],
    }))

    backend = createSlideAuthoringBackend(duplicated)
    const deleteTargets = duplicated.selection.selectionIds.map((id) => (
      makeSlideAuthoringTarget(duplicated, id, 'item')
    ))
    const deleted = requireSession(commitSlideMultiLayerIntentAtTargets(duplicated, {
      targets: deleteTargets,
      intent: { kind: 'delete' },
    }, { expectedRevision: backend.getSnapshot().revision, now: NOW }))
    expect(deleted.history.past).toHaveLength(duplicated.history.past.length + 1)
    expect(deleted.selection.selectionIds).toEqual([])
    for (const id of deleteTargets.map((target) => target.layerItemId)) {
      expect(deleted.history.present.surfaces[0]?.type === 'slide'
        ? deleted.history.present.surfaces[0].scenes[0]?.layerItems.some(
            (item) => item.layerItemId === id,
          )
        : true).toBe(false)
    }
  })
})
