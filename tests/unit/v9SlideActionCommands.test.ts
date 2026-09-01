import { describe, expect, it } from 'vitest'
import { MAX_SCENE_NODES } from '@/shared/constants'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type RuntimeLayerItem,
  type ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import type { InteractionRule } from '@/shared/interactionTypes'
import { createTeacherControllerNode } from '@/renderer/project/createProject'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  activateSlidePresentationState,
  addSlidePresentationState,
  openSlideAuthoringSession,
  selectSlideLayers,
  setSlideEditingScope,
  type SlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import {
  SLIDE_DELETE_FOCUS_GUARD_REASON,
  SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON,
  SLIDE_SCENE_ACTION_COMMAND_MAP,
  SLIDE_SCENE_ACTION_IDS,
  addSlideSceneInteractionRule,
  copySlideGlobalClipboard,
  deleteSlideSceneLayers,
  duplicateSlideSceneLayers,
  executeSlideSceneAction,
  nudgeSlideSceneLayers,
  patchSlideSceneLayers,
  pasteSlideGlobalLayers,
  reorderSlideSceneLayers,
  selectAllSlideSceneLayers,
  shouldIgnoreSlideLayerDeleteForFocus,
  classifySlideAuthoringFocus,
} from '@/renderer/course/v9SlideActionCommands'
import {
  addSlideInteractionRule,
  SLIDE_INTERACTION_GLOBAL_WRITE_REASON,
} from '@/renderer/course/slideInteractionCommands'
import { collectV9InteractionRuleWarnings } from '@/renderer/course/slideInteractionView'

const NOW = '2026-08-17T14:00:00.000Z'

function textStyle() {
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
  }
}

function nativeText(
  layerItemId: string,
  order: number,
  text: string,
  extra: Partial<Pick<NativeLayerItem, 'locked' | 'visible' | 'frame'>> = {},
): NativeLayerItem {
  return {
    layerItemId,
    label: text,
    frame: extra.frame ?? { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
    order,
    visible: extra.visible ?? true,
    locked: extra.locked ?? false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function runtimeBoundTo(layerItemId: string, order: number, bindTo: string): RuntimeLayerItem {
  return {
    layerItemId,
    label: '绑定运行时',
    frame: { mode: 'absolute', x: 80, y: 320, width: 160, height: 80 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: {
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'dom',
      source: 'export default {}',
      content: { values: {} },
      assets: {},
      nodeBindings: { target: bindTo },
    },
  }
}

function scoped(item: NativeLayerItem, locationIds: string[] = []): ScopedLayerItem {
  return {
    item,
    visibility: locationIds.length === 0
      ? { mode: 'all', locationIds: [] }
      : { mode: 'include', locationIds },
  }
}

function clickRule(id: string, nodeId: string, actionId: string, targetId = nodeId): InteractionRule {
  return {
    id,
    name: `点击${nodeId}`,
    enabled: true,
    trigger: { type: 'node.click', nodeId },
    conditions: [],
    actions: [{
      id: actionId,
      start: 'after-previous',
      delayMs: 0,
      action: {
        type: 'node.enter',
        nodeId: targetId,
        effect: 'fade',
        durationMs: 200,
        easing: 'ease-out',
      },
    }],
  }
}

function v9SlideFixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r2e-slide-actions',
    revision: 1,
    title: 'R2-E Slide actions',
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
    locations: [
      {
        id: 'location-scene-1',
        label: '场景 1',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
      },
    ],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [
        scoped(nativeText('surface-shared', 25, '表面共享', {
          frame: { mode: 'absolute', x: 80, y: 200, width: 180, height: 60 },
        }), ['location-scene-1']),
      ],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [
          nativeText('slide-title', 1, '可编辑标题', {
            frame: { mode: 'absolute', x: 120, y: 120, width: 400, height: 80 },
          }),
          nativeText('slide-locked', 2, '锁定标题', {
            locked: true,
            frame: { mode: 'absolute', x: 120, y: 220, width: 400, height: 80 },
          }),
          runtimeBoundTo('slide-runtime', 3, 'slide-title'),
        ],
        interactions: [
          clickRule('rule-click-title', 'slide-title', 'action-enter-title'),
        ],
      }],
    }],
  })
}

function requireSession(result: { ok: boolean; nextSession?: SlideAuthoringSession; reason?: string }) {
  if (!result.ok || !result.nextSession) {
    throw new Error(result.reason ?? (result.ok ? 'missing session' : 'command failed'))
  }
  return result.nextSession
}

function sceneOf(session: SlideAuthoringSession) {
  const surface = session.history.present.surfaces.find((candidate) => candidate.id === 'surface-slide')
  if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
  const scene = surface.scenes[0]
  if (!scene) throw new Error('expected scene')
  return scene
}

function select(session: SlideAuthoringSession, nodeIds: readonly string[]) {
  return requireSession(selectSlideLayers(session, { nodeIds }))
}

describe('V9 Slide scene actions', () => {
  it('defines a shared action ID table covering keyboard, menu and toolbar', () => {
    expect(SLIDE_SCENE_ACTION_IDS).toContain('delete')
    expect(SLIDE_SCENE_ACTION_IDS).toContain('bring-front')
    expect(SLIDE_SCENE_ACTION_COMMAND_MAP.map((entry) => entry.actionId).sort())
      .toEqual([...SLIDE_SCENE_ACTION_IDS].sort())
    expect(SLIDE_SCENE_ACTION_COMMAND_MAP.find((entry) => entry.actionId === 'bring-front')?.notes)
      .toMatch(/不要改 NodesTab/)
  })

  it('reorders, nudges, locks, hides and deletes scene layers in one history step', () => {
    const initial = openSlideAuthoringSession(v9SlideFixture())
    const selected = select(initial, ['slide-title', 'slide-runtime'])
    const hidden = requireSession(patchSlideSceneLayers(
      selected,
      ['slide-title', 'slide-runtime'],
      { visible: false },
      { now: NOW },
    ))
    expect(hidden.history.present.revision).toBe(2)
    expect(hidden.history.past).toHaveLength(1)
    expect(sceneOf(hidden).layerItems.find((item) => item.layerItemId === 'slide-title')?.visible)
      .toBe(false)

    const lockedWrite = patchSlideSceneLayers(hidden, ['slide-locked'], { visible: false }, { now: NOW })
    expect(lockedWrite).toMatchObject({ ok: false, reason: SLIDE_REJECT_LOCKED, historyEntry: false })

    const unlocked = requireSession(patchSlideSceneLayers(
      hidden,
      ['slide-locked'],
      { locked: false },
      { now: NOW },
    ))
    const relocked = requireSession(patchSlideSceneLayers(
      unlocked,
      ['slide-title'],
      { locked: true },
      { now: NOW },
    ))
    expect(relocked.history.present.revision).toBe(unlocked.history.present.revision + 1)

    const base = openSlideAuthoringSession(v9SlideFixture())
    const titleSelected = select(base, ['slide-title'])
    const brought = requireSession(nudgeSlideSceneLayers(
      titleSelected,
      ['slide-title'],
      'front',
      { now: NOW },
    ))
    expect(sceneOf(brought).layerItems.map((item) => item.layerItemId)).toEqual([
      'slide-locked',
      'slide-runtime',
      'slide-title',
    ])
    expect(brought.history.present.revision).toBe(2)

    const dragged = requireSession(reorderSlideSceneLayers(
      brought,
      ['slide-title', 'slide-locked', 'slide-runtime'],
      { now: NOW },
    ))
    expect(sceneOf(dragged).layerItems.map((item) => item.layerItemId)).toEqual([
      'slide-title',
      'slide-locked',
      'slide-runtime',
    ])
    expect(reorderSlideSceneLayers(
      dragged,
      ['slide-title', 'slide-locked', 'slide-runtime'],
    ).historyEntry).toBe(false)

    const two = select(dragged, ['slide-title', 'slide-runtime'])
    const deleted = requireSession(deleteSlideSceneLayers(
      two,
      ['slide-title', 'slide-runtime'],
      { now: NOW },
    ))
    expect(deleted.history.present.revision).toBe(two.history.present.revision + 1)
    expect(sceneOf(deleted).layerItems.map((item) => item.layerItemId)).toEqual(['slide-locked'])
    expect(deleted.selection.selectionIds).toEqual([])
    expect(sceneOf(deleted).interactions).toEqual([])
    expect(courseProjectDocumentSchema.parse(deleted.history.present)).toEqual(deleted.history.present)
  })

  it('copy/cut/paste/duplicate allocate new ids and rewrite internal references atomically', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    const selected = select(session, ['slide-title', 'slide-runtime'])
    const copied = executeSlideSceneAction('copy', selected)
    expect(copied.ok).toBe(true)
    expect(copied.historyEntry).toBe(false)
    expect(copied.clipboard?.sourceScope).toBe('scene')
    if (!copied.clipboard || copied.clipboard.sourceScope !== 'scene') {
      throw new Error('expected scene clipboard')
    }
    expect(copied.clipboard.items.map((entry) => entry.item.layerItemId)).toEqual([
      'slide-title',
      'slide-runtime',
    ])

    const pasted = executeSlideSceneAction('paste', selected, {
      clipboard: copied.clipboard,
      now: NOW,
    })
    const afterPaste = requireSession(pasted)
    expect(pasted.historyEntry).toBe(true)
    expect(afterPaste.history.present.revision).toBe(2)
    const pastedIds = afterPaste.selection.selectionIds
    expect(pastedIds).toHaveLength(2)
    expect(pastedIds.some((id) => id === 'slide-title' || id === 'slide-runtime')).toBe(false)
    const scene = sceneOf(afterPaste)
    const pastedRuntime = scene.layerItems.find((item) => item.layerItemId === pastedIds[1])
    const pastedTitleId = pastedIds[0]!
    expect(pastedRuntime?.kind).toBe('runtime')
    if (pastedRuntime?.kind === 'runtime') {
      expect(pastedRuntime.runtime.nodeBindings?.target).toBe(pastedTitleId)
    }
    const cloned = scene.interactions.find((rule) =>
      rule.trigger.type === 'node.click' && rule.trigger.nodeId === pastedTitleId,
    )
    expect(cloned).toBeDefined()
    expect(cloned!.id).not.toBe('rule-click-title')
    expect(cloned!.actions[0]!.id).not.toBe('action-enter-title')
    expect(cloned!.actions[0]!.action).toMatchObject({ type: 'node.enter', nodeId: pastedTitleId })

    const duplicated = executeSlideSceneAction('duplicate', select(session, ['slide-title']), { now: NOW })
    const afterDup = requireSession(duplicated)
    expect(afterDup.history.present.revision).toBe(2)
    expect(afterDup.selection.selectionIds[0]).not.toBe('slide-title')

    const all = requireSession(selectAllSlideSceneLayers(session))
    expect(all.selection.selectionIds).toEqual(['slide-title', 'slide-locked', 'slide-runtime'])
    const cut = executeSlideSceneAction('cut', select(session, ['slide-runtime']), { now: NOW })
    expect(cut.ok).toBe(true)
    expect(cut.historyEntry).toBe(true)
    expect(sceneOf(requireSession(cut)).layerItems.map((item) => item.layerItemId))
      .toEqual(['slide-title', 'slide-locked'])
  })

  it('keeps global clipboard failures atomic and refuses stale, foreign, controller, and capacity writes', () => {
    const project = v9SlideFixture()
    project.globalLayerItems.push({
      item: runtimeBoundTo('global-runtime', 60, 'global-banner'),
      visibility: { mode: 'include', locationIds: ['location-scene-1'] },
      plane: 'underlay',
    })
    const sceneSession = openSlideAuthoringSession(project)
    const globalSession = select(
      requireSession(setSlideEditingScope(sceneSession, 'global')),
      ['global-banner', 'global-runtime'],
    )
    const clipboard = copySlideGlobalClipboard(
      globalSession,
      globalSession.selection.selectionIds,
    )

    const stale = pasteSlideGlobalLayers(globalSession, clipboard, {
      expectedRevision: globalSession.history.present.revision + 1,
    })
    expect(stale).toMatchObject({
      ok: false,
      reason: SLIDE_REJECT_STALE_REVISION,
      historyEntry: false,
    })
    expect(stale.nextSession?.history.present).toBe(globalSession.history.present)

    const wrongOwner = pasteSlideGlobalLayers(sceneSession, clipboard)
    expect(wrongOwner).toMatchObject({
      ok: false,
      reason: SLIDE_REJECT_WRONG_OWNER,
      historyEntry: false,
    })
    expect(wrongOwner.nextSession?.history.present).toBe(sceneSession.history.present)

    const foreign = pasteSlideGlobalLayers(globalSession, {
      ...clipboard,
      projectId: 'another-project',
    })
    expect(foreign).toMatchObject({
      ok: false,
      reason: '剪贴板不属于当前课件，请重新复制',
      historyEntry: false,
    })
    expect(foreign.nextSession?.history.present).toBe(globalSession.history.present)

    const controllerProject = v9SlideFixture()
    const controller = sceneNodeToCourseLayerItem(
      createTeacherControllerNode({ id: 'global-controller' }),
      100,
    )
    controllerProject.globalLayerItems.push({
      item: controller,
      visibility: { mode: 'all', locationIds: [] },
      plane: 'overlay',
    })
    const controllerSession = select(
      requireSession(setSlideEditingScope(
        openSlideAuthoringSession(controllerProject),
        'global',
      )),
      ['global-controller'],
    )
    expect(() => copySlideGlobalClipboard(
      controllerSession,
      ['global-controller'],
    )).toThrow(SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON)
    const validControllerProjectClipboard = copySlideGlobalClipboard(
      controllerSession,
      ['global-banner'],
    )
    const controllerEntry = controllerSession.history.present.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-controller',
    )!
    const controllerClipboard = {
      ...validControllerProjectClipboard,
      items: [{
        entry: {
          ...structuredClone(controllerEntry),
          plane: 'overlay' as const,
        },
      }],
    }
    const controllerPaste = pasteSlideGlobalLayers(controllerSession, controllerClipboard)
    expect(controllerPaste).toMatchObject({
      ok: false,
      reason: SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON,
      historyEntry: false,
    })
    expect(controllerPaste.nextSession?.history.present).toBe(controllerSession.history.present)

    const capacityProject = v9SlideFixture()
    capacityProject.globalLayerItems = Array.from({ length: MAX_SCENE_NODES }, (_, index) => ({
      item: nativeText(`global-${index}`, 100 + index, `全局 ${index}`),
      visibility: { mode: 'all' as const, locationIds: [] },
      plane: 'overlay' as const,
    }))
    const capacitySession = select(
      requireSession(setSlideEditingScope(
        openSlideAuthoringSession(capacityProject),
        'global',
      )),
      ['global-0'],
    )
    const capacityClipboard = copySlideGlobalClipboard(capacitySession, ['global-0'])
    const capacityPaste = pasteSlideGlobalLayers(capacitySession, capacityClipboard)
    expect(capacityPaste).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/上限/),
      historyEntry: false,
    })
    expect(capacityPaste.nextSession?.history.present).toBe(capacitySession.history.present)
  })

  it('ignores Delete while text, formula or contenteditable is focused', () => {
    const session = select(openSlideAuthoringSession(v9SlideFixture()), ['slide-title'])
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    expect(classifySlideAuthoringFocus(editable)).toBe('contenteditable')
    expect(shouldIgnoreSlideLayerDeleteForFocus(editable)).toBe(true)
    expect(shouldIgnoreSlideLayerDeleteForFocus({ textEditSession: true })).toBe(true)
    expect(shouldIgnoreSlideLayerDeleteForFocus({ formulaEditSession: true })).toBe(true)
    expect(shouldIgnoreSlideLayerDeleteForFocus({ tagName: 'TEXTAREA' })).toBe(true)

    for (const focus of ['contenteditable', 'text-edit-session', 'formula-edit-session'] as const) {
      const refused = executeSlideSceneAction('delete', session, { focus, now: NOW })
      expect(refused).toMatchObject({
        ok: false,
        reason: SLIDE_DELETE_FOCUS_GUARD_REASON,
        historyEntry: false,
      })
      expect(refused.nextSession?.history.present).toBe(session.history.present)
    }
  })

  it('refuses global/surface writes with wrong-owner instead of a silent success', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    const globalScope = requireSession(setSlideEditingScope(session, 'global'))
    const globalSelected = requireSession(selectSlideLayers(globalScope, { nodeIds: ['global-banner'] }))
    const locked = executeSlideSceneAction('lock', globalSelected, { now: NOW })
    expect(locked).toMatchObject({
      ok: false,
      reason: SLIDE_REJECT_WRONG_OWNER,
      historyEntry: false,
    })
    expect(locked.nextSession?.history.present.globalLayerItems[0]?.item.locked).toBe(false)

    const surfaceScope = requireSession(setSlideEditingScope(session, 'surface'))
    const surfaceSelected = requireSession(
      selectSlideLayers(surfaceScope, { nodeIds: ['surface-shared'] }),
    )
    const hidden = executeSlideSceneAction('hide', surfaceSelected, { now: NOW })
    expect(hidden).toMatchObject({ ok: false, reason: SLIDE_REJECT_WRONG_OWNER, historyEntry: false })

    expect(() => addSlideInteractionRule(session.history, {
      locationId: session.selection.locationId,
      scope: 'global',
    }, clickRule('g1', 'global-banner', 'ga1'))).toThrow(SLIDE_INTERACTION_GLOBAL_WRITE_REASON)

    const rename = executeSlideSceneAction('rename', select(session, ['slide-title']))
    expect(rename.ok).toBe(false)
    expect(rename.reason).toMatch(/属性栏/)
    const stale = executeSlideSceneAction('delete', select(session, ['slide-title']), {
      expectedRevision: 0,
      now: NOW,
    })
    expect(stale.reason).toBe(SLIDE_REJECT_STALE_REVISION)
  })

  it('hides inherited named-state items and structurally deletes state-owned copies', () => {
    const initial = openSlideAuthoringSession(v9SlideFixture())
    const named = requireSession(addSlidePresentationState(initial, '反馈', { now: NOW }))
    const duplicated = requireSession(duplicateSlideSceneLayers(
      select(named, ['slide-title']),
      ['slide-title'],
      { now: NOW },
    ))
    const ownedId = duplicated.selection.selectionIds[0]!
    const both = select(duplicated, ['slide-title', ownedId])
    const deleted = requireSession(deleteSlideSceneLayers(
      both,
      ['slide-title', ownedId],
      { now: NOW },
    ))
    const scene = sceneOf(deleted)
    const state = scene.presentation!.states.find((candidate) => candidate.id === deleted.selection.stateId)!
    expect(scene.layerItems.some((item) => item.layerItemId === 'slide-title')).toBe(true)
    expect(state.layerItemOverrides['slide-title']).toEqual({ visible: false })
    expect(scene.layerItems.some((item) => item.layerItemId === ownedId)).toBe(false)
    expect(deleted.history.present.revision).toBe(both.history.present.revision + 1)
    expect(activateSlidePresentationState(deleted, null).ok).toBe(true)
  })

  it('keeps interaction references consistent after copy/delete or reports the leftover', () => {
    const session = openSlideAuthoringSession(v9SlideFixture())
    const added = requireSession(addSlideSceneInteractionRule(
      session,
      clickRule('rule-runtime', 'slide-runtime', 'action-runtime', 'slide-title'),
      { now: NOW },
    ))
    expect(added.history.present.revision).toBe(2)
    const deleted = requireSession(deleteSlideSceneLayers(added, ['slide-title'], { now: NOW }))
    const remaining = sceneOf(deleted).interactions
    expect(remaining.some((rule) =>
      'nodeId' in rule.trigger && rule.trigger.nodeId === 'slide-title',
    )).toBe(false)
    expect(remaining.some((rule) => rule.id === 'rule-runtime')).toBe(false)
    expect(collectV9InteractionRuleWarnings(deleted.history.present, remaining)).toEqual({})

    const warnings = collectV9InteractionRuleWarnings(session.history.present, [{
      ...clickRule('missing', 'gone', 'action-gone'),
    }])
    expect(warnings.missing).toEqual([expect.stringMatching(/已删除的元素/)])
  })
})
