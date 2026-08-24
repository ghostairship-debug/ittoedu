import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  InteractionActionPayload,
  InteractionActionStep,
  InteractionCondition,
  InteractionRule,
  NodeMotionAction,
} from '@/shared/contracts/interaction-v1/types'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'
import type {
  PublishedComponentLayerItem,
  PublishedCourseV2Payload,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedRuntimeLayerItem,
  PublishedScopedLayerItem,
} from '@/shared/publishedCourseTypes'
import type { PublishedInteractionDiagnostic } from '@/player/interactions/PublishedInteractionSurfacePort'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '@/player/surfaces/publishedDynamicHosts'

const FLOW_SURFACE_ID = 'surface-flow'
const SLIDE_SURFACE_ID = 'surface-slide'
const FLOW_A_LOCATION_ID = 'location-flow-a'
const FLOW_B_LOCATION_ID = 'location-flow-b'
const SLIDE_LOCATION_ID = 'location-slide'
const SLIDE_SCENE_ID = 'scene-slide'

const textStyle = {
  fontFamily: 'sans-serif',
  fontSize: 20,
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
  lineSpacing: 1.2,
  letterSpacing: 0,
  padding: 0,
  overflow: 'fixed' as const,
  backgroundColor: '#ffffff',
  backgroundOpacity: 0,
  cornerRadius: 0,
}

interface FixtureOptions {
  globalItems?: PublishedScopedLayerItem[]
  globalInteractions?: InteractionRule[]
  surfaceItems?: PublishedScopedLayerItem[]
}

function layerBase(
  layerItemId: string,
  order: number,
  options: {
    visible?: boolean
    hitPolicy?: 'auto' | 'surface' | 'pass-through'
    playbackInitialVisibility?: 'inherit' | 'hidden'
  } = {},
) {
  return {
    layerItemId,
    frame: { mode: 'absolute' as const, x: 40 + order, y: 40, width: 180, height: 64 },
    order,
    visible: options.visible ?? true,
    rotation: 0,
    opacity: 1,
    hitPolicy: options.hitPolicy ?? 'auto',
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
  }
}

function textItem(
  id: string,
  order: number,
  options: Parameters<typeof layerBase>[2] & { text?: string } = {},
): PublishedNativeLayerItem {
  return {
    ...layerBase(id, order, options),
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text: options.text ?? id, runs: [], style: textStyle },
    },
  }
}

function videoItem(id: string, order: number): PublishedNativeLayerItem {
  return {
    ...layerBase(id, order),
    kind: 'native',
    content: {
      nativeType: 'video',
      data: {
        assetId: 'video-owned-asset',
        fit: 'contain',
        autoplay: false,
        loop: false,
        muted: true,
        volume: 1,
        playbackRate: 1,
        showControls: true,
        clickToToggle: true,
        startTime: 0,
        endTime: null,
        poster: { mode: 'video-frame', time: 0 },
        backgroundAudioMode: 'none',
      },
    },
  }
}

function teacherControllerItem(id: string, order: number): PublishedNativeLayerItem {
  return {
    ...layerBase(id, order),
    kind: 'native',
    content: {
      nativeType: 'teacher-controller',
      data: {
        title: '教师控制器',
        showSceneProgress: true,
        compact: true,
        collapsible: false,
        defaultCollapsed: false,
        buttons: [{
          id: 'next',
          action: { type: 'scene.next' },
          label: '下一页',
          visible: true,
        }],
        style: {
          backgroundColor: '#111827',
          backgroundOpacity: 0.9,
          accentColor: '#2563eb',
          textColor: '#ffffff',
          cornerRadius: 12,
        },
        includeInStaticExports: false,
      },
    },
  }
}

function componentItem(id: string, order: number): PublishedComponentLayerItem {
  return {
    ...layerBase(id, order),
    kind: 'component',
    component: { packageId: 'component-owned', version: '1.0.0' },
    props: {},
  }
}

function runtimeItem(id: string, order: number): PublishedRuntimeLayerItem {
  return {
    ...layerBase(id, order),
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'dom',
      code: { encoding: 'base64-utf16le', data: 'IAA=' },
      content: { values: { label: 'Runtime-owned' } },
      assets: {},
    },
  }
}

function scoped(
  item: PublishedLayerItem,
  visibility: PublishedScopedLayerItem['visibility'] = { mode: 'all', locationIds: [] },
): PublishedScopedLayerItem {
  return { item, visibility }
}

function motion(
  type: NodeMotionAction['type'],
  nodeId: string,
  durationMs = 1,
): NodeMotionAction {
  return { type, nodeId, durationMs, easing: 'linear', effect: 'fade' }
}

function step(
  id: string,
  action: InteractionActionPayload,
  options: Partial<Pick<InteractionActionStep, 'start' | 'delayMs'>> = {},
): InteractionActionStep {
  return {
    id,
    start: options.start ?? 'after-previous',
    delayMs: options.delayMs ?? 0,
    action,
  }
}

function clickRule(
  id: string,
  nodeId: string,
  actions: InteractionActionStep[],
  conditions: InteractionCondition[] = [],
): InteractionRule {
  return {
    id,
    enabled: true,
    trigger: { type: 'node.click', nodeId },
    conditions,
    actions,
  }
}

function publishedFixture(options: FixtureOptions = {}): PublishedCourseV2Payload {
  const payload: PublishedCourseV2Payload = {
    format: 'h5course-published',
    formatVersion: 2,
    sourceSchemaVersion: 9,
    courseId: 'published-interaction-flow-host',
    title: 'Published Interaction Flow Host',
    assets: {
      'video-owned-asset': {
        mimeType: 'video/mp4',
        url: 'data:video/mp4;base64,AA==',
      },
    },
    components: {
      'component-owned': {
        id: 'component-owned',
        name: 'Owned component',
        version: '1.0.0',
        contentSha256: '0'.repeat(64),
        apiVersion: 4,
        scopes: ['scene'],
        renderMode: 'dom',
        code: { encoding: 'base64-utf16le', data: 'IAA=' },
        assets: {},
      },
    },
    designTokens: {
      fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }],
      colors: [{ id: 'text', label: '正文', color: '#172033' }],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: false, musicVolume: 0.3, fadeMs: 0 },
      },
    },
    playback: {
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    locations: [
      {
        id: FLOW_A_LOCATION_ID,
        label: 'Flow A',
        kind: 'flow-block',
        surfaceId: FLOW_SURFACE_ID,
        blockId: 'flow-heading-a',
      },
      {
        id: FLOW_B_LOCATION_ID,
        label: 'Flow B',
        kind: 'flow-block',
        surfaceId: FLOW_SURFACE_ID,
        blockId: 'flow-heading-b',
      },
      {
        id: SLIDE_LOCATION_ID,
        label: 'Slide',
        kind: 'slide-scene',
        surfaceId: SLIDE_SURFACE_ID,
        sceneId: SLIDE_SCENE_ID,
      },
    ],
    startLocationId: FLOW_A_LOCATION_ID,
    globalLayerItems: options.globalItems ?? [],
    globalInteractions: options.globalInteractions ?? [],
    surfaces: [
      {
        id: FLOW_SURFACE_ID,
        title: 'Flow',
        type: 'flow',
        surfaceLayerItems: options.surfaceItems ?? [],
        backgroundColor: '#ffffff',
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        blocks: [
          { id: 'flow-heading-a', type: 'heading', level: 1, text: 'Flow A' },
          { id: 'flow-paragraph', type: 'paragraph', text: 'Flow body' },
          { id: 'flow-heading-b', type: 'heading', level: 2, text: 'Flow B' },
        ],
      },
      {
        id: SLIDE_SURFACE_ID,
        title: 'Slide',
        type: 'slide',
        canvas: { width: 1280, height: 720 },
        surfaceLayerItems: [],
        scenes: [{
          id: SLIDE_SCENE_ID,
          name: 'Slide scene',
          backgroundColor: '#f8fafc',
          layerItems: [textItem('slide-label', 1)],
          interactions: [],
        }],
      },
    ],
    mixedPrintPlan: {
      pageSize: 'surface-native',
      orientation: 'auto',
      entries: [
        { id: 'print-flow', kind: 'flow-document', surfaceId: FLOW_SURFACE_ID },
        {
          id: 'print-slide',
          kind: 'slide-scenes',
          surfaceId: SLIDE_SURFACE_ID,
          sceneIds: [SLIDE_SCENE_ID],
        },
      ],
    },
  }
  return publishedCourseV2Schema.parse(payload)
}

const sessions: PublishedCourseSession[] = []
let animationTargets: string[] = []
let previousAnimate: PropertyDescriptor | undefined

async function settle(turns = 12): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve()
}

async function mount(
  payload: PublishedCourseV2Payload,
  diagnostics: PublishedInteractionDiagnostic[] = [],
) {
  const container = document.createElement('div')
  container.style.position = 'relative'
  document.body.appendChild(container)
  const session = createPublishedCourseSession(payload, {
    services: {
      reportDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic as PublishedInteractionDiagnostic)
      },
    },
  })
  sessions.push(session)
  await session.mount(container)
  return { container, session }
}

function flowItem(
  container: HTMLElement,
  itemId: string,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-flow-overlay-item="${itemId}"], [data-layer-item-id="${itemId}"]`,
  )
}

function renderedFlowItem(container: HTMLElement, itemId: string): HTMLElement {
  const item = flowItem(container, itemId)
  expect(item, `expected rendered Flow item ${itemId}`).not.toBeNull()
  return item!
}

function renderedSlideItem(container: HTMLElement, itemId: string): HTMLElement {
  const item = container.querySelector<HTMLElement>(
    `[data-slide-layer-item="${itemId}"]`,
  )
  expect(item, `expected rendered Slide item ${itemId}`).not.toBeNull()
  return item!
}

function expectInteractionVisibility(item: HTMLElement, visible: boolean): void {
  expect(item.dataset.interactionVisibility).toBe(visible ? 'visible' : 'hidden')
  expect(item.style.visibility).toBe(visible ? 'visible' : 'hidden')
  if (!visible) expect(item.style.pointerEvents).toBe('none')
}

beforeEach(() => {
  animationTargets = []
  previousAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      animationTargets.push(
        this.dataset.flowOverlayItem
          ?? this.dataset.layerItemId
          ?? this.dataset.slideLayerItem
          ?? 'unknown',
      )
      return {
        cancel: vi.fn(),
        finished: Promise.resolve(),
      } as unknown as Animation
    },
  })
  if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
  }
})

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()))
  if (vi.isFakeTimers()) vi.useRealTimers()
  if (previousAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', previousAnimate)
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>)['animate']
  }
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('Published Interaction Flow host integration', () => {
  it('reveals a mounted playback-hidden global native target without mutating the payload', async () => {
    const trigger = textItem('flow-reveal-trigger', 100)
    const exitTrigger = textItem('flow-exit-trigger', 105)
    const target = textItem('flow-hidden-target', 110, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [scoped(trigger), scoped(exitTrigger), scoped(target)],
      globalInteractions: [
        clickRule('flow-reveal-rule', trigger.layerItemId, [
          step('flow-enter', motion('node.enter', target.layerItemId)),
        ]),
        clickRule('flow-exit-rule', exitTrigger.layerItemId, [
          step('flow-exit', motion('node.exit', target.layerItemId)),
        ]),
      ],
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload)
    const hiddenTarget = renderedFlowItem(container, target.layerItemId)

    expectInteractionVisibility(hiddenTarget, false)
    expect(hiddenTarget.getAttribute('aria-hidden')).toBe('true')
    let outerClickCount = 0
    container.addEventListener('click', () => {
      outerClickCount += 1
    })

    renderedFlowItem(container, trigger.layerItemId).click()
    await settle()

    expect(outerClickCount).toBe(1)
    expectInteractionVisibility(renderedFlowItem(container, target.layerItemId), true)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)

    renderedFlowItem(container, exitTrigger.layerItemId).click()
    await settle()
    expect(outerClickCount).toBe(2)
    expectInteractionVisibility(renderedFlowItem(container, target.layerItemId), false)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(2)
    expect(payload).toEqual(before)
  })

  it('preserves global visibility across Flow blocks and Slide return while location scope stays stronger', async () => {
    const trigger = textItem('flow-shared-trigger', 100)
    const everywhereTarget = textItem('flow-everywhere-target', 110, {
      playbackInitialVisibility: 'hidden',
    })
    const scopedTarget = textItem('flow-scoped-target', 120, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [
        scoped(trigger),
        scoped(everywhereTarget),
        scoped(scopedTarget, {
          mode: 'include',
          locationIds: [FLOW_A_LOCATION_ID, SLIDE_LOCATION_ID],
        }),
      ],
      globalInteractions: [clickRule('flow-shared-reveal-rule', trigger.layerItemId, [
        step('show-everywhere', motion('node.enter', everywhereTarget.layerItemId)),
        step('show-scoped', motion('node.enter', scopedTarget.layerItemId)),
      ])],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedFlowItem(container, trigger.layerItemId).click()
    await settle()
    expectInteractionVisibility(renderedFlowItem(container, everywhereTarget.layerItemId), true)
    expectInteractionVisibility(renderedFlowItem(container, scopedTarget.layerItemId), true)

    await session.goToLocation(FLOW_B_LOCATION_ID)
    expectInteractionVisibility(renderedFlowItem(container, everywhereTarget.layerItemId), true)
    expect(flowItem(container, scopedTarget.layerItemId)).toBeNull()

    await session.goToLocation(SLIDE_LOCATION_ID)
    expectInteractionVisibility(renderedSlideItem(container, everywhereTarget.layerItemId), true)
    expectInteractionVisibility(renderedSlideItem(container, scopedTarget.layerItemId), true)

    await session.goToLocation(FLOW_A_LOCATION_ID)
    expectInteractionVisibility(renderedFlowItem(container, everywhereTarget.layerItemId), true)
    expectInteractionVisibility(renderedFlowItem(container, scopedTarget.layerItemId), true)
    expect(payload).toEqual(before)
  })

  it('resets Flow surface-local visibility per location generation and global visibility on restart', async () => {
    const revealTrigger = textItem('flow-scope-reveal-trigger', 100)
    const restartTrigger = textItem('flow-scope-restart-trigger', 110)
    const globalTarget = textItem('flow-scope-global-target', 120, {
      playbackInitialVisibility: 'hidden',
    })
    const surfaceTarget = textItem('flow-scope-surface-target', 220, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [scoped(revealTrigger), scoped(restartTrigger), scoped(globalTarget)],
      surfaceItems: [scoped(surfaceTarget)],
      globalInteractions: [
        clickRule('flow-scope-reveal-rule', revealTrigger.layerItemId, [
          step('show-flow-global', motion('node.enter', globalTarget.layerItemId)),
          step('show-flow-surface', motion('node.enter', surfaceTarget.layerItemId)),
        ]),
        clickRule('flow-scope-restart-rule', restartTrigger.layerItemId, [
          step('restart-flow-course', { type: 'course.restart' }),
        ]),
      ],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedFlowItem(container, revealTrigger.layerItemId).click()
    await settle()
    expectInteractionVisibility(renderedFlowItem(container, globalTarget.layerItemId), true)
    expectInteractionVisibility(renderedFlowItem(container, surfaceTarget.layerItemId), true)

    await session.goToLocation(FLOW_B_LOCATION_ID)
    await session.goToLocation(FLOW_A_LOCATION_ID)
    expectInteractionVisibility(renderedFlowItem(container, globalTarget.layerItemId), true)
    expectInteractionVisibility(renderedFlowItem(container, surfaceTarget.layerItemId), false)

    renderedFlowItem(container, restartTrigger.layerItemId).click()
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(FLOW_A_LOCATION_ID)
      expect(renderedFlowItem(container, globalTarget.layerItemId).dataset.interactionVisibility)
        .toBe('hidden')
    })
    expectInteractionVisibility(renderedFlowItem(container, surfaceTarget.layerItemId), false)
    expect(payload).toEqual(before)
  })

  it('does not match Slide scene.in conditions while Flow owns the current location', async () => {
    const trigger = textItem('flow-scene-condition-trigger', 100)
    const target = textItem('flow-scene-condition-target', 110, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [scoped(trigger), scoped(target)],
      globalInteractions: [clickRule(
        'flow-scene-condition-rule',
        trigger.layerItemId,
        [step('flow-scene-condition-enter', motion('node.enter', target.layerItemId))],
        [{ type: 'scene.in', sceneIds: [SLIDE_SCENE_ID] }],
      )],
    })
    const { container } = await mount(payload)

    renderedFlowItem(container, trigger.layerItemId).click()
    await settle()

    expectInteractionVisibility(renderedFlowItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)
  })

  it.each([
    ['same-Flow block navigation', FLOW_B_LOCATION_ID],
    ['cross-Surface navigation', SLIDE_LOCATION_ID],
  ] as const)('cancels delayed old-generation work on %s and restores one fresh binding', async (_label, destination) => {
    vi.useFakeTimers()
    const trigger = textItem('flow-delayed-trigger', 100)
    const target = textItem('flow-delayed-target', 110, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [scoped(trigger), scoped(target)],
      globalInteractions: [clickRule('flow-delayed-rule', trigger.layerItemId, [
        step('flow-delayed-enter', motion('node.enter', target.layerItemId), { delayMs: 100 }),
      ])],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedFlowItem(container, trigger.layerItemId).click()
    await settle()
    await session.goToLocation(destination)
    await session.goToLocation(FLOW_A_LOCATION_ID)
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    expectInteractionVisibility(renderedFlowItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)

    renderedFlowItem(container, trigger.layerItemId).click()
    await settle()
    await vi.advanceTimersByTimeAsync(100)
    await settle()

    expectInteractionVisibility(renderedFlowItem(container, target.layerItemId), true)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })

  it('cancels delayed work across direct Flow suspend and restores one fresh binding on resume', async () => {
    vi.useFakeTimers()
    const trigger = textItem('flow-suspend-trigger', 100)
    const target = textItem('flow-suspend-target', 110, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [scoped(trigger), scoped(target)],
      globalInteractions: [clickRule('flow-suspend-rule', trigger.layerItemId, [
        step('flow-suspend-enter', motion('node.enter', target.layerItemId), { delayMs: 100 }),
      ])],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedFlowItem(container, trigger.layerItemId).click()
    await settle()
    expect(await session.player.suspendSurface(FLOW_SURFACE_ID)).toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    expectInteractionVisibility(renderedFlowItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)

    expect(await session.player.resumeSurface(FLOW_SURFACE_ID)).toEqual({ ok: true })
    renderedFlowItem(container, trigger.layerItemId).click()
    await settle()
    await vi.advanceTimersByTimeAsync(100)
    await settle()

    expectInteractionVisibility(renderedFlowItem(container, target.layerItemId), true)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })

  it('diagnoses gesture-owned and pass-through targets without stealing their clicks', async () => {
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const hiddenTarget = textItem('flow-owned-target', 170, {
      playbackInitialVisibility: 'hidden',
    })
    const ownedItems: PublishedLayerItem[] = [
      componentItem('flow-component-trigger', 100),
      runtimeItem('flow-runtime-trigger', 110),
      videoItem('flow-video-trigger', 120),
      teacherControllerItem('flow-controller-trigger', 130),
      textItem('flow-pass-through-trigger', 140, { hitPolicy: 'pass-through' }),
      textItem('flow-surface-trigger', 150, { hitPolicy: 'surface' }),
    ]
    const payload = publishedFixture({
      globalItems: [...ownedItems.map((item) => scoped(item)), scoped(hiddenTarget)],
      globalInteractions: ownedItems.map((item, index) => clickRule(
        `flow-owned-rule-${index}`,
        item.layerItemId,
        [step(`flow-owned-step-${index}`, motion('node.enter', hiddenTarget.layerItemId))],
      )),
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload, diagnostics)
    let outerClickCount = 0
    container.addEventListener('click', () => {
      outerClickCount += 1
    })

    for (const item of ownedItems) {
      const accepted = renderedFlowItem(container, item.layerItemId).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      )
      expect(accepted).toBe(true)
    }
    await settle()

    expect(outerClickCount).toBe(ownedItems.length)
    expectInteractionVisibility(renderedFlowItem(container, hiddenTarget.layerItemId), false)
    expect(animationTargets).not.toContain(hiddenTarget.layerItemId)
    const unavailable = diagnostics.filter((diagnostic) => diagnostic.code === 'bind-unavailable')
    expect(unavailable.map((diagnostic) => diagnostic.nodeId).sort()).toEqual(
      ownedItems.map((item) => item.layerItemId).sort(),
    )
    expect(unavailable.every((diagnostic) => diagnostic.phase === 'execute')).toBe(true)
    expect(payload).toEqual(before)
  })
})
