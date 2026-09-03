import { describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
} from '@/shared/courseProjectTypes'
import { createBlankFlowSurface } from '@/renderer/course/flowEditorCommands'
import {
  enterFlowTextEditing,
  selectFlowEditorBlock,
} from '@/renderer/course/flowEditorSlice'
import { executeFlowDelete } from '@/renderer/course/flowEditorCommands'
import {
  createEditorSelectionSnapshot,
  type EditorActionAdapter,
  type EditorActionAdapters,
  type EditorSelectionSnapshot,
} from '@/renderer/course/editorActionTypes'
import {
  resolveEditorAdapterKind,
  resolveFlowDeleteRoute,
  resolveKeyboardDeleteDisposition,
  routeEditorAction,
  shouldRefuseLayerDeleteForTextFocus,
  isEditorInteractiveControlTarget,
  isEditorTextInputTarget,
} from '@/renderer/course/editorActionRouting'

function baseSnapshot(
  overrides: Partial<EditorSelectionSnapshot> = {},
): EditorSelectionSnapshot {
  return createEditorSelectionSnapshot({
    locationId: 'loc-slide',
    revision: 0,
    sessionGeneration: 1,
    surfaceKind: 'slide',
    scope: 'location',
    focus: 'layer',
    itemIds: ['layer-a'],
    ...overrides,
  })
}

function mockAdapter(label: string): EditorActionAdapter {
  return {
    execute: vi.fn(() => ({ ok: true, reason: label })),
  }
}

function adaptersWithMocks(): {
  adapters: EditorActionAdapters
  slide: ReturnType<typeof mockAdapter>
  flow: ReturnType<typeof mockAdapter>
  spatial: ReturnType<typeof mockAdapter>
  global: ReturnType<typeof mockAdapter>
} {
  const slide = mockAdapter('slide')
  const flow = mockAdapter('flow')
  const spatial = mockAdapter('spatial')
  const global = mockAdapter('global')
  return {
    adapters: { slide, flow, spatial, global },
    slide,
    flow,
    spatial,
    global,
  }
}

describe('editorActionRouting', () => {
  it('routes delete to slide, flow, spatial and global adapters', () => {
    const { adapters, slide, flow, spatial, global } = adaptersWithMocks()

    routeEditorAction({
      actionId: 'delete',
      snapshot: baseSnapshot({ surfaceKind: 'slide' }),
      adapters,
    })
    routeEditorAction({
      actionId: 'delete',
      snapshot: baseSnapshot({
        surfaceKind: 'flow',
        locationId: 'loc-flow',
        focus: 'block',
        itemIds: ['block-1'],
      }),
      adapters,
    })
    routeEditorAction({
      actionId: 'delete',
      snapshot: baseSnapshot({
        surfaceKind: 'spatial-2d',
        locationId: 'loc-spatial',
      }),
      adapters,
    })
    routeEditorAction({
      actionId: 'delete',
      snapshot: baseSnapshot({
        scope: 'global',
        focus: 'overlay',
        itemIds: ['global-layer'],
      }),
      adapters,
    })

    expect(slide.execute).toHaveBeenCalledOnce()
    expect(flow.execute).toHaveBeenCalledOnce()
    expect(spatial.execute).toHaveBeenCalledOnce()
    expect(global.execute).toHaveBeenCalledOnce()
  })

  it('lets all three surface kinds enter global scope routing', () => {
    for (const surfaceKind of ['slide', 'flow', 'spatial-2d'] as const) {
      const { adapters, global, slide, flow, spatial } = adaptersWithMocks()
      const result = routeEditorAction({
        actionId: 'copy',
        snapshot: baseSnapshot({
          surfaceKind,
          scope: 'global',
          focus: 'overlay',
          itemIds: ['global-1'],
        }),
        adapters,
      })

      expect(resolveEditorAdapterKind(result.adapter === 'none'
        ? baseSnapshot({ surfaceKind, scope: 'global', focus: 'overlay', itemIds: ['global-1'] })
        : baseSnapshot({ surfaceKind, scope: 'global', focus: 'overlay', itemIds: ['global-1'] })))
        .toBe('global')
      expect(result.adapter).toBe('global')
      expect(global.execute).toHaveBeenCalledOnce()
      expect(slide.execute).not.toHaveBeenCalled()
      expect(flow.execute).not.toHaveBeenCalled()
      expect(spatial.execute).not.toHaveBeenCalled()
    }
  })

  it('refuses slide/spatial layer delete while text focus but keeps flow document delete', () => {
    const slideSnapshot = baseSnapshot({ surfaceKind: 'slide', focus: 'text' })
    expect(shouldRefuseLayerDeleteForTextFocus(slideSnapshot, 'delete')).toBe(true)

    const spatialSnapshot = baseSnapshot({
      surfaceKind: 'spatial-2d',
      focus: 'text',
    })
    expect(shouldRefuseLayerDeleteForTextFocus(spatialSnapshot, 'delete')).toBe(true)

    const flowSnapshot = baseSnapshot({
      surfaceKind: 'flow',
      focus: 'text',
      itemIds: [],
    })
    expect(shouldRefuseLayerDeleteForTextFocus(flowSnapshot, 'delete')).toBe(false)
  })

  it('flow text delete routes to document path and does not use overlay route', () => {
    const overlayAdapter = mockAdapter('overlay-delete')
    const documentAdapter = mockAdapter('document-delete')
    const snapshot = baseSnapshot({
      surfaceKind: 'flow',
      focus: 'text',
      itemIds: [],
    })

    expect(resolveFlowDeleteRoute(snapshot)).toBe('document')

    const refused = routeEditorAction({
      actionId: 'delete',
      snapshot: baseSnapshot({
        surfaceKind: 'flow',
        focus: 'overlay',
        scope: 'global',
        itemIds: [],
      }),
      adapters: {
        flow: overlayAdapter,
        global: documentAdapter,
      },
    })
    expect(refused.ok).toBe(false)
    expect(refused.adapter).toBe('none')
    expect(documentAdapter.execute).not.toHaveBeenCalled()
    expect(overlayAdapter.execute).not.toHaveBeenCalled()

    const flowResult = routeEditorAction({
      actionId: 'delete',
      snapshot,
      adapters: { flow: documentAdapter, global: overlayAdapter },
    })
    expect(flowResult.adapter).toBe('flow')
    expect(flowResult.flowDeleteRoute).toBe('document')
    expect(documentAdapter.execute).toHaveBeenCalledOnce()
    expect(overlayAdapter.execute).not.toHaveBeenCalled()
  })

  it('flow overlay delete resolves overlay route', () => {
    const snapshot = baseSnapshot({
      surfaceKind: 'flow',
      focus: 'overlay',
      itemIds: ['overlay-1'],
    })
    expect(resolveFlowDeleteRoute(snapshot)).toBe('overlay')
  })

  it('calls executeFlowDelete for flow text delete fixture', () => {
    const NOW = '2026-08-17T18:00:00.000Z'
    const { surface, location } = createBlankFlowSurface({
      id: 'flow-surface',
      title: 'Flow',
    })
    const paragraphId = surface.blocks.find((block) => block.type === 'paragraph')?.id
    if (!paragraphId) throw new Error('expected paragraph block')

    const project = courseProjectDocumentSchema.parse({
      schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
      id: 'flow-route-fixture',
      revision: 0,
      title: 'Flow route',
      createdAt: NOW,
      updatedAt: NOW,
      assets: {},
      componentPackages: {},
      designTokens: {
        fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }],
        colors: [{ id: 'background', label: '背景', color: '#ffffff' }],
      },
      surfaces: [surface],
      locations: [location],
      startLocationId: location.id,
      globalLayerItems: [],
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
      globalInteractions: [],
    })

    let selection = selectFlowEditorBlock(project, location.id, paragraphId)
    selection = enterFlowTextEditing(project, selection, {
      blockId: paragraphId,
      start: 0,
      end: 0,
    })

    const result = executeFlowDelete(project, selection, { expectedRevision: 0 })
    expect(result.ok).toBe(true)
    expect(result.reason).toMatch(/文字|删除/)
  })

  it('refuses locked targets for write actions', () => {
    const { adapters, slide } = adaptersWithMocks()
    const result = routeEditorAction({
      actionId: 'delete',
      snapshot: baseSnapshot({
        itemIds: ['layer-a'],
        items: [{ itemId: 'layer-a', locked: true }],
      }),
      adapters,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/锁定/)
    expect(slide.execute).not.toHaveBeenCalled()
  })

  it('ignores IME/text targets and routes Delete by captured session snapshot', () => {
    expect(isEditorTextInputTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditorTextInputTarget(document.createElement('div'))).toBe(false)
    const button = document.createElement('button')
    expect(isEditorInteractiveControlTarget(button)).toBe(true)

    const courseSnapshot = baseSnapshot({ focus: 'layer', itemIds: ['layer-a'] })
    expect(resolveKeyboardDeleteDisposition({
      hasCourseProject: true,
      selection: courseSnapshot,
      contentEditable: false,
      hasFlowSession: false,
      flowComposing: false,
      flowTextFocus: false,
      flowHasSelection: false,
      hasSlideBackend: false,
      slideTextEdit: false,
      slideFormulaEdit: false,
      selectedNodeCount: 1,
      editingText: false,
    })).toEqual({ action: 'route', snapshot: courseSnapshot })

    expect(resolveKeyboardDeleteDisposition({
      hasCourseProject: true,
      selection: baseSnapshot({ focus: 'text' }),
      contentEditable: true,
      hasFlowSession: false,
      flowComposing: false,
      flowTextFocus: false,
      flowHasSelection: false,
      hasSlideBackend: false,
      slideTextEdit: false,
      slideFormulaEdit: false,
      selectedNodeCount: 1,
      editingText: false,
    }).action).toBe('ignore')

    expect(resolveKeyboardDeleteDisposition({
      hasCourseProject: false,
      selection: null,
      contentEditable: false,
      hasFlowSession: true,
      flowComposing: false,
      flowTextFocus: false,
      flowHasSelection: true,
      hasSlideBackend: false,
      slideTextEdit: false,
      slideFormulaEdit: false,
      selectedNodeCount: 0,
      editingText: false,
    }).action).toBe('legacy-delete')

    expect(resolveKeyboardDeleteDisposition({
      hasCourseProject: false,
      selection: null,
      contentEditable: false,
      hasFlowSession: true,
      flowComposing: true,
      flowTextFocus: false,
      flowHasSelection: true,
      hasSlideBackend: false,
      slideTextEdit: false,
      slideFormulaEdit: false,
      selectedNodeCount: 1,
      editingText: false,
    }).action).toBe('ignore')

    expect(resolveKeyboardDeleteDisposition({
      hasCourseProject: false,
      selection: null,
      contentEditable: false,
      hasFlowSession: false,
      flowComposing: false,
      flowTextFocus: false,
      flowHasSelection: false,
      hasSlideBackend: true,
      slideTextEdit: true,
      slideFormulaEdit: false,
      selectedNodeCount: 1,
      editingText: true,
    }).action).toBe('ignore')

    expect(resolveKeyboardDeleteDisposition({
      hasCourseProject: false,
      selection: null,
      contentEditable: false,
      hasFlowSession: false,
      flowComposing: false,
      flowTextFocus: false,
      flowHasSelection: false,
      hasSlideBackend: false,
      slideTextEdit: false,
      slideFormulaEdit: false,
      selectedNodeCount: 2,
      editingText: false,
    }).action).toBe('legacy-delete')
  })
})
