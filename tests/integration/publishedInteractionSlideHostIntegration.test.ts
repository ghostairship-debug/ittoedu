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
  PublishedSlidePresentation,
} from '@/shared/publishedCourseTypes'
import type { PublishedInteractionDiagnostic } from '@/player/interactions/PublishedInteractionSurfacePort'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
  type PublishedCourseSessionOptions,
} from '@/player/surfaces/publishedDynamicHosts'

const SLIDE_SURFACE_ID = 'surface-slide'
const FLOW_SURFACE_ID = 'surface-flow'
const SCENE_A_ID = 'scene-alpha'
const SCENE_B_ID = 'scene-beta'
const LOCATION_A_ID = 'location-alpha'
const LOCATION_B_ID = 'location-beta'
const FLOW_LOCATION_ID = 'location-flow'

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
  assets?: PublishedCourseV2Payload['assets']
  audioSounds?: NonNullable<PublishedCourseV2Payload['media']>['audio']['sounds']
  sceneALocationId?: string
  sceneBLocationStateId?: string
  sceneBDuplicateLocationId?: string
  sceneBDuplicateLocationStateId?: string
  courseState?: PublishedCourseV2Payload['courseState']
  navigationGuards?: PublishedCourseV2Payload['navigationGuards']
  sceneAItems?: PublishedLayerItem[]
  sceneAInteractions?: InteractionRule[]
  sceneBItems?: PublishedLayerItem[]
  sceneBInteractions?: InteractionRule[]
  sceneBPresentation?: PublishedSlidePresentation
  globalItems?: PublishedScopedLayerItem[]
  globalInteractions?: InteractionRule[]
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

function videoItem(
  id: string,
  order: number,
  options: {
    fit?: 'contain' | 'cover'
    autoplay?: boolean
    loop?: boolean
    muted?: boolean
    volume?: number
    playbackRate?: number
    showControls?: boolean
    clickToToggle?: boolean
    startTime?: number
    endTime?: number | null
    backgroundAudioMode?: 'none' | 'duck' | 'pause' | 'stop'
  } = {},
): PublishedNativeLayerItem {
  return {
    ...layerBase(id, order),
    kind: 'native',
    content: {
      nativeType: 'video',
      data: {
        assetId: 'video-owned-asset',
        fit: options.fit ?? 'contain',
        autoplay: options.autoplay ?? false,
        loop: options.loop ?? false,
        muted: options.muted ?? true,
        volume: options.volume ?? 1,
        playbackRate: options.playbackRate ?? 1,
        showControls: options.showControls ?? true,
        clickToToggle: options.clickToToggle ?? true,
        startTime: options.startTime ?? 0,
        endTime: options.endTime ?? null,
        poster: { mode: 'video-frame', time: 0 },
        backgroundAudioMode: options.backgroundAudioMode ?? 'none',
      },
    },
  }
}

function controllerItem(id: string, order: number): PublishedNativeLayerItem {
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
        buttons: [
          {
            id: 'next',
            action: { type: 'scene.next' },
            label: '下一页',
            visible: true,
          },
          {
            id: 'mute',
            action: { type: 'audio.toggle-mute' },
            label: '静音',
            visible: true,
          },
        ],
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

function scoped(item: PublishedLayerItem): PublishedScopedLayerItem {
  return { item, visibility: { mode: 'all', locationIds: [] } }
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
  const sceneALocationId = options.sceneALocationId ?? LOCATION_A_ID
  const duplicateSceneBLocations: PublishedCourseV2Payload['locations'] =
    options.sceneBDuplicateLocationId
      ? [{
          id: options.sceneBDuplicateLocationId,
          label: 'Beta duplicate location',
          kind: 'slide-scene',
          surfaceId: SLIDE_SURFACE_ID,
          sceneId: SCENE_B_ID,
          ...(options.sceneBDuplicateLocationStateId
            ? { stateId: options.sceneBDuplicateLocationStateId }
            : {}),
        }]
      : []
  const payload: PublishedCourseV2Payload = {
    format: 'h5course-published',
    formatVersion: 2,
    sourceSchemaVersion: 9,
    courseId: 'published-interaction-slide-host',
    title: 'Published Interaction Slide Host',
    assets: {
      'video-owned-asset': {
        mimeType: 'video/mp4',
        url: 'data:video/mp4;base64,AA==',
      },
      ...options.assets,
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
        sounds: options.audioSounds ?? {},
        narrationDucking: { enabled: false, musicVolume: 0.3, fadeMs: 0 },
      },
    },
    playback: {
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: options.courseState ?? [],
    navigationGuards: options.navigationGuards ?? [],
    locations: [
      {
        id: sceneALocationId,
        label: 'Alpha location',
        kind: 'slide-scene',
        surfaceId: SLIDE_SURFACE_ID,
        sceneId: SCENE_A_ID,
      },
      {
        id: LOCATION_B_ID,
        label: 'Beta location',
        kind: 'slide-scene',
        surfaceId: SLIDE_SURFACE_ID,
        sceneId: SCENE_B_ID,
        ...(options.sceneBLocationStateId
          ? { stateId: options.sceneBLocationStateId }
          : {}),
      },
      ...duplicateSceneBLocations,
      {
        id: FLOW_LOCATION_ID,
        label: 'Flow location',
        kind: 'flow-block',
        surfaceId: FLOW_SURFACE_ID,
        blockId: 'flow-heading',
      },
    ],
    startLocationId: sceneALocationId,
    globalLayerItems: options.globalItems ?? [],
    globalInteractions: options.globalInteractions ?? [],
    surfaces: [
      {
        id: SLIDE_SURFACE_ID,
        title: 'Slide',
        type: 'slide',
        canvas: { width: 1280, height: 720 },
        surfaceLayerItems: [],
        scenes: [
          {
            id: SCENE_A_ID,
            name: 'Alpha scene',
            backgroundColor: '#ffffff',
            layerItems: options.sceneAItems ?? [textItem('trigger-a', 10)],
            interactions: options.sceneAInteractions ?? [],
          },
          {
            id: SCENE_B_ID,
            name: 'Beta scene',
            backgroundColor: '#f8fafc',
            layerItems: options.sceneBItems ?? [textItem('scene-b-label', 20)],
            presentation: options.sceneBPresentation,
            interactions: options.sceneBInteractions ?? [],
          },
        ],
      },
      {
        id: FLOW_SURFACE_ID,
        title: 'Flow',
        type: 'flow',
        surfaceLayerItems: [],
        backgroundColor: '#ffffff',
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        blocks: [{ id: 'flow-heading', type: 'heading', level: 1, text: 'Flow' }],
      },
    ],
    mixedPrintPlan: {
      pageSize: 'surface-native',
      orientation: 'auto',
      entries: [
        {
          id: 'print-slide',
          kind: 'slide-scenes',
          surfaceId: SLIDE_SURFACE_ID,
          sceneIds: [SCENE_A_ID, SCENE_B_ID],
        },
        { id: 'print-flow', kind: 'flow-document', surfaceId: FLOW_SURFACE_ID },
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
  options: PublishedCourseSessionOptions = {},
) {
  const container = document.createElement('div')
  container.style.position = 'relative'
  document.body.appendChild(container)
  const session = createPublishedCourseSession(payload, {
    ...options,
    services: {
      ...options.services,
      reportDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic as PublishedInteractionDiagnostic)
      },
    },
  })
  sessions.push(session)
  await session.mount(container)
  return { container, session }
}

function renderedItem(container: HTMLElement, itemId: string): HTMLElement {
  const item = container.querySelector<HTMLElement>(
    `[data-slide-layer-item="${itemId}"]`,
  )
  expect(item, `expected rendered item ${itemId}`).not.toBeNull()
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
      animationTargets.push(this.dataset.slideLayerItem ?? 'unknown')
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
  vi.unstubAllGlobals()
})

describe('Published Interaction Slide host integration', () => {
  it('runs same-id local and global controllers once while hidden native motion remains session-only', async () => {
    vi.useFakeTimers()
    const localTarget = textItem('local-hidden-target', 20, {
      playbackInitialVisibility: 'hidden',
    })
    const globalTarget = textItem('global-hidden-target', 1_000, {
      playbackInitialVisibility: 'hidden',
    })
    const sharedRuleId = 'same-rule-id-across-scopes'
    const payload = publishedFixture({
      sceneAItems: [textItem('trigger-a', 10), localTarget],
      sceneAInteractions: [clickRule(
        sharedRuleId,
        'trigger-a',
        [
          step('local-enter', motion('node.enter', localTarget.layerItemId)),
          step('local-exit', motion('node.exit', localTarget.layerItemId), { delayMs: 40 }),
        ],
        [{ type: 'scene.in', sceneIds: [SCENE_A_ID] }],
      )],
      globalItems: [scoped(globalTarget)],
      globalInteractions: [clickRule(
        sharedRuleId,
        'trigger-a',
        [step('global-enter', motion('node.enter', globalTarget.layerItemId))],
        [{ type: 'scene.in', sceneIds: [SCENE_A_ID] }],
      )],
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload)
    const local = renderedItem(container, localTarget.layerItemId)
    const global = renderedItem(container, globalTarget.layerItemId)

    expectInteractionVisibility(local, false)
    expectInteractionVisibility(global, false)
    renderedItem(container, 'trigger-a').click()
    await settle()

    expectInteractionVisibility(local, true)
    expectInteractionVisibility(global, true)
    expect(animationTargets.filter((id) => id === localTarget.layerItemId)).toHaveLength(1)
    expect(animationTargets.filter((id) => id === globalTarget.layerItemId)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(40)
    await settle()
    expectInteractionVisibility(local, false)
    expect(animationTargets.filter((id) => id === localTarget.layerItemId)).toHaveLength(2)
    expect(payload).toEqual(before)
  })

  it('evaluates scene.in against the Slide scene id rather than the distinct location id', async () => {
    const sceneIdTarget = textItem('scene-id-target', 20, {
      playbackInitialVisibility: 'hidden',
    })
    const otherSceneTarget = textItem('other-scene-target', 30, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [textItem('trigger-a', 10), sceneIdTarget, otherSceneTarget],
      sceneAInteractions: [
        clickRule(
          'real-scene-id-condition',
          'trigger-a',
          [step('show-scene-id', motion('node.enter', sceneIdTarget.layerItemId))],
          [{ type: 'scene.in', sceneIds: [SCENE_A_ID] }],
        ),
        clickRule(
          'other-scene-does-not-match',
          'trigger-a',
          [step('show-other-scene', motion('node.enter', otherSceneTarget.layerItemId))],
          [{ type: 'scene.in', sceneIds: [SCENE_B_ID] }],
        ),
      ],
    })
    const { container } = await mount(payload)

    renderedItem(container, 'trigger-a').click()
    await settle()

    expectInteractionVisibility(renderedItem(container, sceneIdTarget.layerItemId), true)
    expectInteractionVisibility(renderedItem(container, otherSceneTarget.layerItemId), false)
  })

  it('writes shared course state before later motion and guarded navigation', async () => {
    const target = textItem('course-state-target', 20, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      courseState: [{
        key: 'ready',
        valueType: 'boolean',
        defaultValue: false,
      }],
      navigationGuards: [{
        id: 'block-until-ready',
        effect: 'block',
        fromLocationIds: [LOCATION_A_ID],
        toLocationIds: [LOCATION_B_ID],
        match: 'all',
        conditions: [{
          type: 'compare',
          key: 'ready',
          operator: 'eq',
          value: false,
        }],
        message: '请先完成当前任务',
      }],
      sceneAItems: [textItem('course-state-trigger', 10), target],
      sceneAInteractions: [clickRule(
        'course-state-sequence',
        'course-state-trigger',
        [
          step('mark-ready', { type: 'course-state.set', key: 'ready', value: true }),
          step('reveal-after-state-write', motion('node.enter', target.layerItemId)),
          step('navigate-after-state-write', { type: 'scene.go', sceneId: SCENE_B_ID }),
        ],
        [{
          type: 'course-state.compare',
          key: 'ready',
          operator: 'eq',
          value: false,
        }],
      )],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    await expect(session.goToLocation(LOCATION_B_ID)).rejects.toThrow('请先完成当前任务')
    expect(session.navigator.current?.locationId).toBe(LOCATION_A_ID)

    renderedItem(container, 'course-state-trigger').click()
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(LOCATION_B_ID)
    })
    expect(animationTargets).toContain(target.layerItemId)

    await session.goToLocation(LOCATION_A_ID)
    renderedItem(container, 'course-state-trigger').click()
    await settle(24)
    expect(session.navigator.current?.locationId).toBe(LOCATION_A_ID)
    expect(animationTargets.filter((itemId) => itemId === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })

  it('keeps declarative interactions inert during static capture', async () => {
    const target = textItem('static-course-state-target', 20)
    const payload = publishedFixture({
      courseState: [{
        key: 'ready',
        valueType: 'boolean',
        defaultValue: false,
      }],
      sceneAItems: [textItem('static-course-state-trigger', 10), target],
      sceneAInteractions: [clickRule(
        'static-course-state-rule',
        'static-course-state-trigger',
        [
          step('static-course-state-write', {
            type: 'course-state.set',
            key: 'ready',
            value: true,
          }),
          step('static-course-state-motion', motion('node.exit', target.layerItemId)),
        ],
      )],
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload, [], { staticCapture: true })

    renderedItem(container, 'static-course-state-trigger').click()
    await settle(24)

    expectInteractionVisibility(renderedItem(container, target.layerItemId), true)
    expect(animationTargets).not.toContain(target.layerItemId)
    expect(payload).toEqual(before)
  })

  it('resets local visibility per generation while global visibility persists until course restart', async () => {
    const localTarget = textItem('lifecycle-local-target', 40, {
      playbackInitialVisibility: 'hidden',
    })
    const globalTarget = textItem('lifecycle-global-target', 1_000, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [
        textItem('lifecycle-reveal-trigger', 10),
        textItem('lifecycle-replay-trigger', 20),
        textItem('lifecycle-restart-trigger', 30),
        localTarget,
      ],
      sceneAInteractions: [
        clickRule('reveal-local', 'lifecycle-reveal-trigger', [
          step('enter-local', motion('node.enter', localTarget.layerItemId)),
        ]),
        clickRule('replay-lifecycle-scene', 'lifecycle-replay-trigger', [
          step('replay-lifecycle', { type: 'scene.replay' }),
        ]),
        clickRule('restart-lifecycle-course', 'lifecycle-restart-trigger', [
          step('restart-lifecycle', { type: 'course.restart' }),
        ]),
      ],
      globalItems: [scoped(globalTarget)],
      globalInteractions: [clickRule('reveal-global', 'lifecycle-reveal-trigger', [
        step('enter-global', motion('node.enter', globalTarget.layerItemId)),
      ])],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedItem(container, 'lifecycle-reveal-trigger').click()
    await settle()
    expectInteractionVisibility(renderedItem(container, localTarget.layerItemId), true)
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), true)

    renderedItem(container, 'lifecycle-replay-trigger').click()
    await settle(24)
    expectInteractionVisibility(renderedItem(container, localTarget.layerItemId), false)
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), true)

    await session.goToLocation(LOCATION_B_ID)
    await session.goToLocation(LOCATION_A_ID)
    expectInteractionVisibility(renderedItem(container, localTarget.layerItemId), false)
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), true)

    renderedItem(container, 'lifecycle-reveal-trigger').click()
    await settle()
    expect(animationTargets.filter((id) => id === globalTarget.layerItemId)).toHaveLength(2)

    renderedItem(container, 'lifecycle-restart-trigger').click()
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(LOCATION_A_ID)
      expect(renderedItem(container, globalTarget.layerItemId).dataset.interactionVisibility)
        .toBe('hidden')
    })
    expectInteractionVisibility(renderedItem(container, localTarget.layerItemId), false)
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), false)
    expect(payload).toEqual(before)
  })

  it('cancels an active global motion before course restart commits hidden visibility', async () => {
    const globalTarget = textItem('restart-motion-global-target', 1_000, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [
        textItem('restart-motion-reveal', 10),
        textItem('restart-motion-exit', 20),
        textItem('restart-motion-trigger', 30),
      ],
      sceneAInteractions: [clickRule('restart-during-motion', 'restart-motion-trigger', [
        step('restart-after-cancel', { type: 'course.restart' }),
      ])],
      globalItems: [scoped(globalTarget)],
      globalInteractions: [
        clickRule('reveal-before-restart', 'restart-motion-reveal', [
          step('reveal-global-before-restart', motion('node.enter', globalTarget.layerItemId)),
        ]),
        clickRule('active-exit-before-restart', 'restart-motion-exit', [
          step('active-global-exit', motion('node.exit', globalTarget.layerItemId, 1_000)),
        ]),
      ],
    })
    const { container, session } = await mount(payload)
    renderedItem(container, 'restart-motion-reveal').click()
    await settle()
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), true)

    const cancel = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: () => ({ cancel, finished: new Promise<void>(() => undefined) }) as unknown as Animation,
    })
    renderedItem(container, 'restart-motion-exit').click()
    await settle()
    renderedItem(container, 'restart-motion-trigger').click()

    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(LOCATION_A_ID)
      expect(renderedItem(container, globalTarget.layerItemId).dataset.interactionVisibility)
        .toBe('hidden')
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), false)
  })

  it('preserves global visibility and restores bindings when course restart fails', async () => {
    const globalTarget = textItem('restart-rollback-global-target', 1_000, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [
        textItem('restart-rollback-reveal', 10),
        textItem('restart-rollback-trigger', 20),
      ],
      sceneAInteractions: [clickRule('restart-rollback-rule', 'restart-rollback-trigger', [
        step('restart-rollback-step', { type: 'course.restart' }),
      ])],
      globalItems: [scoped(globalTarget)],
      globalInteractions: [clickRule('restart-rollback-reveal-rule', 'restart-rollback-reveal', [
        step('restart-rollback-enter', motion('node.enter', globalTarget.layerItemId)),
      ])],
    })
    const { container, session } = await mount(payload)
    renderedItem(container, 'restart-rollback-reveal').click()
    await settle()
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), true)

    const resetCourse = vi.spyOn(session.player, 'resetCourse')
      .mockRejectedValueOnce(new Error('forced course reset failure'))
    renderedItem(container, 'restart-rollback-trigger').click()
    await vi.waitFor(() => expect(resetCourse).toHaveBeenCalledTimes(1))
    await settle(24)
    resetCourse.mockRestore()

    expect(session.navigator.current?.locationId).toBe(LOCATION_A_ID)
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), true)
    renderedItem(container, 'restart-rollback-reveal').click()
    await settle()
    expect(animationTargets.filter((id) => id === globalTarget.layerItemId)).toHaveLength(2)

    renderedItem(container, 'restart-rollback-trigger').click()
    await vi.waitFor(() => {
      expect(renderedItem(container, globalTarget.layerItemId).dataset.interactionVisibility)
        .toBe('hidden')
    })
    expectInteractionVisibility(renderedItem(container, globalTarget.layerItemId), false)
  })

  it('maps scene.go(sceneId) to its location and cancels delayed sibling work', async () => {
    const lateTarget = textItem('terminal-late-target', 1_000, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [textItem('trigger-a', 10)],
      sceneAInteractions: [
        clickRule(
          'go-by-scene-id',
          'trigger-a',
          [step('go-beta', { type: 'scene.go', sceneId: SCENE_B_ID })],
        ),
        clickRule(
          'delayed-sibling',
          'trigger-a',
          [step('must-not-run', motion('node.enter', lateTarget.layerItemId), { delayMs: 40 })],
        ),
      ],
      globalItems: [scoped(lateTarget)],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedItem(container, 'trigger-a').click()
    await settle(24)

    expect(session.navigator.current).toMatchObject({
      locationId: LOCATION_B_ID,
      surfaceId: SLIDE_SURFACE_ID,
    })
    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.locationId).toBe(LOCATION_B_ID)
    expect(root.dataset.sceneId).toBe(SCENE_B_ID)
    expectInteractionVisibility(renderedItem(container, lateTarget.layerItemId), false)
    expect(animationTargets).not.toContain(lateTarget.layerItemId)
    expect(payload).toEqual(before)
  })

  it('resolves scene.go strictly by sceneId when another location.id collides', async () => {
    const payload = publishedFixture({
      sceneALocationId: SCENE_B_ID,
      sceneAItems: [textItem('collision-trigger', 10)],
      sceneAInteractions: [clickRule('collision-rule', 'collision-trigger', [
        step('collision-go', { type: 'scene.go', sceneId: SCENE_B_ID }),
      ])],
    })
    const { container, session } = await mount(payload)
    expect(session.navigator.current).toMatchObject({
      locationId: SCENE_B_ID,
      surfaceId: SLIDE_SURFACE_ID,
    })

    renderedItem(container, 'collision-trigger').click()
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(LOCATION_B_ID)
    })

    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.locationId).toBe(LOCATION_B_ID)
    expect(root.dataset.sceneId).toBe(SCENE_B_ID)
  })

  it('admits only one local/global terminal navigation from the same click generation', async () => {
    const payload = publishedFixture({
      sceneAItems: [textItem('terminal-race-trigger', 10)],
      sceneAInteractions: [clickRule('local-restart-race', 'terminal-race-trigger', [
        step('local-restart', { type: 'course.restart' }),
      ])],
      globalInteractions: [clickRule('global-go-race', 'terminal-race-trigger', [
        step('global-go', { type: 'scene.go', sceneId: SCENE_B_ID }),
      ])],
    })
    const { container, session } = await mount(payload)
    const goToLocation = vi.spyOn(session.navigator, 'goToLocation')
    const resetCourse = vi.spyOn(session.navigator, 'resetCourse')

    renderedItem(container, 'terminal-race-trigger').click()
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(LOCATION_B_ID)
    })
    await settle(40)

    expect(goToLocation).toHaveBeenCalledTimes(1)
    expect(resetCourse).not.toHaveBeenCalled()
    expect(session.navigator.current?.locationId).toBe(LOCATION_B_ID)
  })

  it.each([
    ['same-Slide navigation', 'same-slide'],
    ['cross-Surface navigation', 'cross-surface'],
    ['scene replay', 'replay'],
  ] as const)('cancels delayed old-generation work on %s and returns with one fresh binding', async (_label, transition) => {
    vi.useFakeTimers()
    const target = textItem('cancel-target', 1_000, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [textItem('slow-trigger', 10), textItem('replay-trigger', 20)],
      sceneAInteractions: [
        clickRule('slow-rule', 'slow-trigger', [
          step('delayed-enter', motion('node.enter', target.layerItemId), { delayMs: 100 }),
        ]),
        clickRule('replay-rule', 'replay-trigger', [
          step('replay', { type: 'scene.replay' }),
        ]),
      ],
      globalItems: [scoped(target)],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedItem(container, 'slow-trigger').click()
    await settle()
    if (transition === 'same-slide') {
      await session.goToLocation(LOCATION_B_ID)
      await session.goToLocation(LOCATION_A_ID)
    } else if (transition === 'cross-surface') {
      await session.goToLocation(FLOW_LOCATION_ID)
      await session.goToLocation(LOCATION_A_ID)
    } else {
      renderedItem(container, 'replay-trigger').click()
      await settle(24)
    }

    await vi.advanceTimersByTimeAsync(200)
    await settle()
    expectInteractionVisibility(renderedItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)

    renderedItem(container, 'slow-trigger').click()
    await settle()
    await vi.advanceTimersByTimeAsync(100)
    await settle()
    expectInteractionVisibility(renderedItem(container, target.layerItemId), true)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })

  it('cancels delayed work across direct player suspend and restores one fresh binding on resume', async () => {
    vi.useFakeTimers()
    const target = textItem('suspend-cancel-target', 30, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [textItem('suspend-trigger', 10), target],
      sceneAInteractions: [clickRule('suspend-slow-rule', 'suspend-trigger', [
        step('suspend-delayed-enter', motion('node.enter', target.layerItemId), { delayMs: 100 }),
      ])],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedItem(container, 'suspend-trigger').click()
    await settle()
    expect(await session.player.suspendSurface(SLIDE_SURFACE_ID)).toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    expectInteractionVisibility(renderedItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)

    expect(await session.player.resumeSurface(SLIDE_SURFACE_ID)).toEqual({ ok: true })
    renderedItem(container, 'suspend-trigger').click()
    await settle()
    await vi.advanceTimersByTimeAsync(100)
    await settle()

    expectInteractionVisibility(renderedItem(container, target.layerItemId), true)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })

  it('cancels delayed work and removes its DOM on session destroy', async () => {
    vi.useFakeTimers()
    const target = textItem('destroy-cancel-target', 20, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [textItem('slow-trigger', 10), target],
      sceneAInteractions: [clickRule('destroy-slow-rule', 'slow-trigger', [
        step('destroy-delayed-enter', motion('node.enter', target.layerItemId), { delayMs: 100 }),
      ])],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)
    const oldTarget = renderedItem(container, target.layerItemId)

    renderedItem(container, 'slow-trigger').click()
    await settle()
    await session.destroy()
    await vi.advanceTimersByTimeAsync(200)
    await settle()

    expect(oldTarget.isConnected).toBe(false)
    expect(container.querySelectorAll('[data-course-surface-slot]')).toHaveLength(0)
    expect(animationTargets).not.toContain(target.layerItemId)
    expect(payload).toEqual(before)
  })

  it('diagnoses gesture-owned and pass-through triggers without stealing their clicks', async () => {
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const ownedTarget = textItem('owned-target', 80, {
      playbackInitialVisibility: 'hidden',
    })
    const ownedItems: PublishedLayerItem[] = [
      componentItem('component-trigger', 10),
      runtimeItem('runtime-trigger', 20),
      videoItem('video-trigger', 30),
      controllerItem('controller-trigger', 40),
      textItem('pass-through-trigger', 50, { hitPolicy: 'pass-through' }),
      textItem('surface-owned-trigger', 60, { hitPolicy: 'surface' }),
    ]
    const payload = publishedFixture({
      sceneAItems: [...ownedItems, ownedTarget],
      sceneAInteractions: ownedItems.map((item, index) => clickRule(
        `owned-rule-${index}`,
        item.layerItemId,
        [step(`owned-step-${index}`, motion('node.enter', ownedTarget.layerItemId))],
      )),
    })
    const { container } = await mount(payload, diagnostics)
    let outerClickCount = 0
    container.addEventListener('click', () => {
      outerClickCount += 1
    })

    for (const item of ownedItems) {
      const accepted = renderedItem(container, item.layerItemId).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      )
      expect(accepted).toBe(true)
    }
    await settle()

    expect(outerClickCount).toBe(ownedItems.length)
    expectInteractionVisibility(renderedItem(container, ownedTarget.layerItemId), false)
    expect(animationTargets).not.toContain(ownedTarget.layerItemId)
    const unavailable = diagnostics.filter((diagnostic) => diagnostic.code === 'bind-unavailable')
    expect(unavailable.map((diagnostic) => diagnostic.nodeId).sort()).toEqual(
      ownedItems.map((item) => item.layerItemId).sort(),
    )
    expect(unavailable.every((diagnostic) => diagnostic.phase === 'execute')).toBe(true)
  })

  it('uses an explicit current state only for the initial playback mount', async () => {
    const stateTarget = textItem('initial-session-state-target', 20, { visible: false })
    const payload = publishedFixture({
      sceneBItems: [stateTarget],
      sceneBPresentation: {
        initialStateId: 'initial-session-base',
        states: [
          {
            id: 'initial-session-base',
            name: 'Base',
            backgroundColor: '#f8fafc',
            layerItemOverrides: { [stateTarget.layerItemId]: { visible: false } },
          },
          {
            id: 'initial-session-current',
            name: 'Current authoring state',
            backgroundColor: '#112233',
            layerItemOverrides: {
              [stateTarget.layerItemId]: {
                visible: true,
                opacity: 0.4,
                frame: { x: 333 },
              },
            },
          },
        ],
      },
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload, [], {
      initialLocationId: LOCATION_B_ID,
      initialPresentationStateId: 'initial-session-current',
    })

    expect(session.navigator.current?.locationId).toBe(LOCATION_B_ID)
    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.presentationStateId).toBe('initial-session-current')
    expect(root.style.backgroundColor).toMatch(/#112233|rgb\(17,\s*34,\s*51\)/)
    const materialized = renderedItem(container, stateTarget.layerItemId)
    expect(materialized.style.left).toBe('333px')
    expect(materialized.style.opacity).toBe('0.4')

    expect(await session.replayScene()).toBe(true)
    expect(root.dataset.presentationStateId).toBe('initial-session-base')
    expect(container.querySelector(
      `[data-slide-layer-item="${stateTarget.layerItemId}"]`,
    )).toBeNull()
    expect(payload).toEqual(before)

    const ordinary = await mount(payload, [], { initialLocationId: LOCATION_B_ID })
    const ordinaryRoot = ordinary.container.querySelector<HTMLElement>(
      '.slide-published-adapter',
    )!
    expect(ordinaryRoot.dataset.presentationStateId).toBe('initial-session-base')
    expect(ordinary.container.querySelector(
      `[data-slide-layer-item="${stateTarget.layerItemId}"]`,
    )).toBeNull()
    expect(payload).toEqual(before)
  })

  it('rejects stale or non-Slide initial state requests before mount', () => {
    const payload = publishedFixture({
      sceneBPresentation: {
        initialStateId: 'only-initial-session-state',
        states: [{
          id: 'only-initial-session-state',
          name: 'Only state',
          layerItemOverrides: {},
        }],
      },
    })

    expect(() => createPublishedCourseSession(payload, {
      initialLocationId: LOCATION_B_ID,
      initialPresentationStateId: 'missing-state',
    })).toThrow(/missing-state/)
    expect(() => createPublishedCourseSession(payload, {
      initialLocationId: FLOW_LOCATION_ID,
      initialPresentationStateId: 'only-initial-session-state',
    })).toThrow(/Slide/)
  })

  it('materializes a valid scene.go targetStateId before entering the target location', async () => {
    const stateTarget = textItem('state-target', 20, { visible: false })
    const presentation: PublishedSlidePresentation = {
      initialStateId: 'state-base',
      states: [
        {
          id: 'state-base',
          name: 'Base',
          backgroundColor: '#f8fafc',
          layerItemOverrides: { [stateTarget.layerItemId]: { visible: false } },
        },
        {
          id: 'state-revealed',
          name: 'Revealed',
          backgroundColor: '#112233',
          layerItemOverrides: {
            [stateTarget.layerItemId]: {
              visible: true,
              opacity: 0.4,
              frame: { x: 333 },
            },
          },
        },
      ],
    }
    const payload = publishedFixture({
      sceneAItems: [textItem('state-trigger', 10)],
      sceneAInteractions: [clickRule('go-to-state', 'state-trigger', [
        step('go-to-revealed-state', {
          type: 'scene.go',
          sceneId: SCENE_B_ID,
          targetStateId: 'state-revealed',
        }),
      ])],
      sceneBItems: [stateTarget],
      sceneBPresentation: presentation,
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    renderedItem(container, 'state-trigger').click()
    await settle(24)

    expect(session.navigator.current?.locationId).toBe(LOCATION_B_ID)
    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.sceneId).toBe(SCENE_B_ID)
    expect(root.dataset.locationId).toBe(LOCATION_B_ID)
    expect(root.dataset.presentationStateId).toBe('state-revealed')
    expect(root.style.backgroundColor).toMatch(/#112233|rgb\(17,\s*34,\s*51\)/)
    const materialized = renderedItem(container, stateTarget.layerItemId)
    expect(materialized.style.left).toBe('333px')
    expect(materialized.style.opacity).toBe('0.4')

    await session.goToLocation(LOCATION_A_ID)
    await session.goToLocation(LOCATION_B_ID)
    expect(root.dataset.presentationStateId).toBe('state-base')
    expect(root.style.backgroundColor).toMatch(/#f8fafc|rgb\(248,\s*250,\s*252\)/)
    expect(container.querySelector(`[data-slide-layer-item="${stateTarget.layerItemId}"]`)).toBeNull()
    expect(payload).toEqual(before)
  })

  it('enters the authored initial state when scene.go omits targetStateId', async () => {
    const payload = publishedFixture({
      sceneBLocationStateId: 'state-linked-from-location',
      sceneAItems: [textItem('initial-state-trigger', 10)],
      sceneAInteractions: [clickRule('go-to-authored-initial', 'initial-state-trigger', [
        step('go-without-state', { type: 'scene.go', sceneId: SCENE_B_ID }),
      ])],
      sceneBPresentation: {
        initialStateId: 'state-authored-initial',
        states: [
          {
            id: 'state-authored-initial',
            name: 'Authored initial',
            backgroundColor: '#123456',
            layerItemOverrides: {},
          },
          {
            id: 'state-linked-from-location',
            name: 'Location-linked state',
            backgroundColor: '#abcdef',
            layerItemOverrides: {},
          },
        ],
      },
    })
    const { container, session } = await mount(payload)

    renderedItem(container, 'initial-state-trigger').click()
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(LOCATION_B_ID)
    })

    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.presentationStateId).toBe('state-authored-initial')
    expect(root.style.backgroundColor).toMatch(/#123456|rgb\(18,\s*52,\s*86\)/)
  })

  it('forces same-location scene.go to materialize its explicit targetStateId', async () => {
    const target = textItem('same-location-state-target', 20)
    const duplicateLocationId = 'location-beta-alternate'
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const payload = publishedFixture({
      sceneBDuplicateLocationId: duplicateLocationId,
      sceneBItems: [
        textItem('same-location-state-trigger', 10),
        textItem('same-location-noop-trigger', 15),
        target,
      ],
      sceneBInteractions: [
        clickRule(
          'same-location-state-rule',
          'same-location-state-trigger',
          [step('same-location-state-step', {
            type: 'scene.go',
            sceneId: SCENE_B_ID,
            targetStateId: 'same-location-revealed',
          })],
        ),
        clickRule('same-location-noop-rule', 'same-location-noop-trigger', [
          step('same-location-noop-step', { type: 'scene.go', sceneId: SCENE_B_ID }),
        ]),
      ],
      sceneBPresentation: {
        initialStateId: 'same-location-base',
        states: [
          {
            id: 'same-location-base',
            name: 'Base',
            layerItemOverrides: { [target.layerItemId]: { visible: false } },
          },
          {
            id: 'same-location-revealed',
            name: 'Revealed',
            layerItemOverrides: { [target.layerItemId]: { visible: true } },
          },
        ],
      },
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload, diagnostics)
    await session.goToLocation(duplicateLocationId)
    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.presentationStateId).toBe('same-location-base')
    expect(container.querySelector(`[data-slide-layer-item="${target.layerItemId}"]`)).toBeNull()

    renderedItem(container, 'same-location-state-trigger').click()
    await vi.waitFor(() => {
      expect(root.dataset.presentationStateId).toBe('same-location-revealed')
    })

    expect(session.navigator.current?.locationId).toBe(duplicateLocationId)
    expect(renderedItem(container, target.layerItemId)).toBeTruthy()

    const goToLocation = vi.spyOn(session.navigator, 'goToLocation')
    renderedItem(container, 'same-location-noop-trigger').click()
    await settle()
    expect(goToLocation).not.toHaveBeenCalled()
    expect(session.navigator.current?.locationId).toBe(duplicateLocationId)
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'navigation-failed',
      ruleId: 'same-location-noop-rule',
      stepId: 'same-location-noop-step',
    }))

    await session.navigator.back()
    expect(session.navigator.current?.locationId).toBe(LOCATION_A_ID)
    expect(payload).toEqual(before)
  })

  it('clears a prepared target state when navigation fails before location render', async () => {
    const target = textItem('rollback-state-target', 20)
    const remountTarget = textItem('rollback-remount-target', 30, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [
        textItem('rollback-state-trigger', 10),
        textItem('rollback-remount-trigger', 15),
        remountTarget,
      ],
      sceneAInteractions: [
        clickRule('rollback-state-rule', 'rollback-state-trigger', [
          step('rollback-state-step', {
            type: 'scene.go',
            sceneId: SCENE_B_ID,
            targetStateId: 'rollback-revealed',
          }),
        ]),
        clickRule('rollback-remount-rule', 'rollback-remount-trigger', [
          step('rollback-remount-step', motion('node.enter', remountTarget.layerItemId)),
        ]),
      ],
      sceneBItems: [target],
      sceneBPresentation: {
        initialStateId: 'rollback-base',
        states: [
          {
            id: 'rollback-base',
            name: 'Base',
            layerItemOverrides: { [target.layerItemId]: { visible: false } },
          },
          {
            id: 'rollback-revealed',
            name: 'Revealed',
            layerItemOverrides: { [target.layerItemId]: { visible: true } },
          },
        ],
      },
    })
    const { container, session } = await mount(payload)
    const setLocation = vi.spyOn(session.player, 'setSurfaceLocation')
      .mockRejectedValueOnce(new Error('forced location failure'))

    renderedItem(container, 'rollback-state-trigger').click()
    await vi.waitFor(() => {
      expect(setLocation).toHaveBeenNthCalledWith(2, SLIDE_SURFACE_ID, LOCATION_A_ID)
    })
    await settle(24)
    expect(setLocation.mock.calls).toEqual([
      [SLIDE_SURFACE_ID, LOCATION_B_ID],
      [SLIDE_SURFACE_ID, LOCATION_A_ID],
    ])
    setLocation.mockRestore()
    expect(session.navigator.current?.locationId).toBe(LOCATION_A_ID)

    renderedItem(container, 'rollback-remount-trigger').click()
    await settle()
    expectInteractionVisibility(renderedItem(container, remountTarget.layerItemId), true)

    await session.goToLocation(LOCATION_B_ID)
    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.presentationStateId).toBe('rollback-base')
    expect(container.querySelector(`[data-slide-layer-item="${target.layerItemId}"]`)).toBeNull()
  })

  it('does not let an aborted queued targetState request contaminate an earlier external navigation', async () => {
    const target = textItem('queued-state-target', 20)
    const payload = publishedFixture({
      sceneAItems: [textItem('queued-state-trigger', 10)],
      sceneAInteractions: [clickRule('queued-state-rule', 'queued-state-trigger', [
        step('queued-state-step', {
          type: 'scene.go',
          sceneId: SCENE_B_ID,
          targetStateId: 'queued-revealed',
        }),
      ])],
      sceneBItems: [target],
      sceneBPresentation: {
        initialStateId: 'queued-base',
        states: [
          {
            id: 'queued-base',
            name: 'Base',
            layerItemOverrides: { [target.layerItemId]: { visible: false } },
          },
          {
            id: 'queued-revealed',
            name: 'Revealed',
            layerItemOverrides: { [target.layerItemId]: { visible: true } },
          },
        ],
      },
    })
    const { container, session } = await mount(payload)
    let externalNavigation: Promise<unknown> | null = null
    container.addEventListener('click', (event) => {
      const targetElement = event.target as Element | null
      if (!targetElement?.closest('[data-slide-layer-item="queued-state-trigger"]')) return
      externalNavigation = session.goToLocation(LOCATION_B_ID)
    })

    renderedItem(container, 'queued-state-trigger').click()
    await vi.waitFor(() => expect(externalNavigation).not.toBeNull())
    await externalNavigation
    await settle(24)

    expect(session.navigator.current?.locationId).toBe(LOCATION_B_ID)
    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.presentationStateId).toBe('queued-base')
    expect(container.querySelector(`[data-slide-layer-item="${target.layerItemId}"]`)).toBeNull()
  })

  it('rejects an unknown scene.go targetStateId without navigating or hiding the failure', async () => {
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const payload = publishedFixture({
      sceneAItems: [textItem('invalid-state-trigger', 10)],
      sceneAInteractions: [clickRule('invalid-state-rule', 'invalid-state-trigger', [
        step('invalid-state-step', {
          type: 'scene.go',
          sceneId: SCENE_B_ID,
          targetStateId: 'missing-state',
        }),
      ])],
      sceneBPresentation: {
        initialStateId: 'only-state',
        states: [{ id: 'only-state', name: 'Only state', layerItemOverrides: {} }],
      },
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload, diagnostics)

    renderedItem(container, 'invalid-state-trigger').click()
    await settle(24)

    expect(session.navigator.current?.locationId).toBe(LOCATION_A_ID)
    const root = container.querySelector<HTMLElement>('.slide-published-adapter')!
    expect(root.dataset.locationId).toBe(LOCATION_A_ID)
    expect(root.dataset.sceneId).toBe(SCENE_A_ID)
    expect(diagnostics).toContainEqual(expect.objectContaining({
      phase: 'execute',
      code: 'navigation-failed',
      ruleId: 'invalid-state-rule',
      stepId: 'invalid-state-step',
      interactionType: 'scene.go',
    }))
    expect(payload).toEqual(before)
  })

  it('shares one Published audio session across interactions, controller mute and video interruption', async () => {
    const createdAudio: HTMLAudioElement[] = []
    vi.stubGlobal('Audio', function MockAudio(source?: string) {
      const audio = document.createElement('audio')
      if (source) audio.src = source
      createdAudio.push(audio)
      return audio
    })
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      function play(this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'))
        return Promise.resolve()
      },
    )
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
      function pause(this: HTMLMediaElement) {
        this.dispatchEvent(new Event('pause'))
      },
    )
    const endedTarget = textItem('audio-ended-target', 60, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      assets: {
        'audio-music': { mimeType: 'audio/mpeg', url: 'data:audio/mpeg;base64,AA==' },
        'audio-ding': { mimeType: 'audio/mpeg', url: 'data:audio/mpeg;base64,AQ==' },
      },
      audioSounds: {
        music: {
          id: 'music',
          name: 'Music',
          assetId: 'audio-music',
          channel: 'music',
          defaultVolume: 1,
          defaultLoop: true,
        },
        ding: {
          id: 'ding',
          name: 'Ding',
          assetId: 'audio-ding',
          channel: 'sfx',
          defaultVolume: 1,
          defaultLoop: false,
        },
      },
      sceneAItems: [
        textItem('play-music', 10),
        textItem('play-ding', 20),
        videoItem('video-a', 30, {
          muted: false,
          volume: 0.5,
          backgroundAudioMode: 'pause',
        }),
        controllerItem('controller-audio', 40),
        endedTarget,
      ],
      sceneAInteractions: [
        clickRule('play-music-rule', 'play-music', [
          step('play-music-step', { type: 'audio.play', soundId: 'music' }),
        ]),
        clickRule('play-ding-rule', 'play-ding', [
          step('play-ding-step', { type: 'audio.play', soundId: 'ding' }),
        ]),
        {
          id: 'ding-ended-rule',
          enabled: true,
          trigger: { type: 'audio.ended', soundId: 'ding' },
          conditions: [],
          actions: [step('ding-ended-reveal', motion('node.enter', endedTarget.layerItemId))],
        },
      ],
    })
    payload.media.audio.channelVolumes.video = 0.4

    const { container, session } = await mount(payload)
    renderedItem(container, 'play-music').click()
    await settle()
    const music = createdAudio[0]!
    expect(music).toBeDefined()

    const video = renderedItem(container, 'video-a').querySelector('video')!
    expect(video.volume).toBeCloseTo(0.5 * 0.4)
    const musicPlayCount = play.mock.instances.filter((instance) => instance === music).length
    video.dispatchEvent(new Event('playing'))
    await settle()
    expect(pause.mock.instances).toContain(music)

    video.dispatchEvent(new Event('pause'))
    await settle()
    expect(play.mock.instances.filter((instance) => instance === music).length)
      .toBe(musicPlayCount + 1)

    const muteButton = container.querySelector<HTMLButtonElement>(
      '[data-controller-button-id="mute"]',
    )!
    muteButton.click()
    await settle()
    expect(video.muted).toBe(true)
    muteButton.click()
    await settle()
    expect(video.muted).toBe(false)

    renderedItem(container, 'play-ding').click()
    await settle()
    const ding = createdAudio.find((audio) => audio.src.includes('AQ=='))
    expect(ding).toBeDefined()
    ding!.dispatchEvent(new Event('ended'))
    await settle()
    expectInteractionVisibility(renderedItem(container, endedTarget.layerItemId), true)

    video.dispatchEvent(new Event('playing'))
    const playsBeforeNavigation = play.mock.instances.filter((instance) => instance === music).length
    await session.goToLocation(LOCATION_B_ID)
    expect(play.mock.instances.filter((instance) => instance === music).length)
      .toBe(playsBeforeNavigation + 1)
  })

  it('applies formal video fields and routes video actions to video events', async () => {
    const playing = new WeakMap<HTMLMediaElement, boolean>()
    vi.spyOn(window.HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
      function paused(this: HTMLMediaElement) {
        return !(playing.get(this) ?? false)
      },
    )
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
      function play(this: HTMLMediaElement) {
        playing.set(this, true)
        return Promise.resolve()
      },
    )
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
      function pause(this: HTMLMediaElement) {
        playing.set(this, false)
      },
    )
    const target = textItem('video-motion-target', 30, {
      playbackInitialVisibility: 'hidden',
    })
    const timeTarget = textItem('video-time-target', 40, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [
        textItem('video-play-trigger', 10),
        textItem('video-pause-trigger', 11),
        textItem('video-restart-trigger', 12),
        textItem('video-stop-trigger', 13),
        textItem('video-toggle-trigger', 14),
        textItem('video-seek-trigger', 15),
        videoItem('video-a', 20, {
          fit: 'cover',
          loop: true,
          muted: false,
          volume: 0.65,
          playbackRate: 1.25,
          showControls: false,
          clickToToggle: false,
          startTime: 2,
          endTime: 8,
        }),
        target,
        timeTarget,
      ],
      sceneAInteractions: [
        clickRule('play-video-a', 'video-play-trigger', [
          step('play-video-a-step', { type: 'video.play', nodeId: 'video-a' }),
        ]),
        clickRule('pause-video-a', 'video-pause-trigger', [
          step('pause-video-a-step', { type: 'video.pause', nodeId: 'video-a' }),
        ]),
        clickRule('restart-video-a', 'video-restart-trigger', [
          step('restart-video-a-step', { type: 'video.restart', nodeId: 'video-a' }),
        ]),
        clickRule('stop-video-a', 'video-stop-trigger', [
          step('stop-video-a-step', { type: 'video.stop', nodeId: 'video-a' }),
        ]),
        clickRule('toggle-video-a', 'video-toggle-trigger', [
          step('toggle-video-a-step', { type: 'video.toggle', nodeId: 'video-a' }),
        ]),
        clickRule('seek-video-a', 'video-seek-trigger', [
          step('seek-video-a-step', { type: 'video.seek', nodeId: 'video-a', seconds: 20 }),
        ]),
        {
          id: 'on-video-started',
          enabled: true,
          trigger: { type: 'video.started', nodeId: 'video-a' },
          conditions: [],
          actions: [step('reveal-on-started', motion('node.enter', target.layerItemId))],
        },
        {
          id: 'on-video-time',
          enabled: true,
          trigger: { type: 'video.time', nodeId: 'video-a', seconds: 5 },
          conditions: [],
          actions: [step('reveal-on-time', motion('node.enter', timeTarget.layerItemId))],
        },
      ],
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload)

    const video = renderedItem(container, 'video-a').querySelector('video')
    expect(video).not.toBeNull()
    expect(video!.controls).toBe(false)
    expect(video!.loop).toBe(true)
    expect(video!.muted).toBe(false)
    expect(video!.volume).toBe(0.65)
    expect(video!.playbackRate).toBe(1.25)
    expect(video!.style.objectFit).toBe('cover')

    renderedItem(container, 'video-play-trigger').click()
    await settle()
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()

    video!.dispatchEvent(new Event('playing'))
    await settle()
    expectInteractionVisibility(renderedItem(container, target.layerItemId), true)
    expect(animationTargets).toContain(target.layerItemId)

    try {
      video!.currentTime = 2
    } catch {
      // Synthetic media without metadata keeps a 0 playhead; the threshold simply holds.
    }
    video!.dispatchEvent(new Event('timeupdate'))
    await settle(24)
    expectInteractionVisibility(renderedItem(container, timeTarget.layerItemId), false)

    try {
      video!.currentTime = 6
    } catch {
      // Fall through to the dispatched threshold below.
    }
    video!.dispatchEvent(new Event('timeupdate'))
    await settle()
    expectInteractionVisibility(renderedItem(container, timeTarget.layerItemId), true)

    renderedItem(container, 'video-pause-trigger').click()
    await settle()
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled()

    const playsBeforeRestart = vi.mocked(window.HTMLMediaElement.prototype.play).mock.calls.length
    renderedItem(container, 'video-restart-trigger').click()
    await settle()
    expect(video!.currentTime).toBe(2)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playsBeforeRestart + 1)

    renderedItem(container, 'video-seek-trigger').click()
    await settle()
    expect(video!.currentTime).toBe(8)

    renderedItem(container, 'video-stop-trigger').click()
    await settle()
    expect(video!.currentTime).toBe(2)

    const playsBeforeToggle = vi.mocked(window.HTMLMediaElement.prototype.play).mock.calls.length
    renderedItem(container, 'video-toggle-trigger').click()
    await settle()
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playsBeforeToggle + 1)
    expect(payload).toEqual(before)
  })

  it('keeps video playback inert during static capture', async () => {
    const target = textItem('capture-video-target', 30)
    const payload = publishedFixture({
      sceneAItems: [textItem('capture-video-trigger', 10), videoItem('video-a', 20), target],
      sceneAInteractions: [
        clickRule('capture-play', 'capture-video-trigger', [
          step('capture-play-step', { type: 'video.play', nodeId: 'video-a' }),
        ]),
        {
          id: 'capture-on-started',
          enabled: true,
          trigger: { type: 'video.started', nodeId: 'video-a' },
          conditions: [],
          actions: [step('capture-reveal', motion('node.exit', target.layerItemId))],
        },
      ],
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload, [], { staticCapture: true })

    renderedItem(container, 'capture-video-trigger').click()
    await settle(24)
    expectInteractionVisibility(renderedItem(container, target.layerItemId), true)
    expect(animationTargets).not.toContain(target.layerItemId)

    const cover = renderedItem(container, 'video-a').querySelector('video')
    cover?.dispatchEvent(new Event('playing'))
    await settle(24)
    expectInteractionVisibility(renderedItem(container, target.layerItemId), true)
    expect(animationTargets).not.toContain(target.layerItemId)
    expect(payload).toEqual(before)
  })

  it('drops stale video events across suspend and navigation', async () => {
    const target = textItem('stale-video-target', 30, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      sceneAItems: [textItem('stale-video-trigger', 10), videoItem('video-a', 20), target],
      sceneAInteractions: [{
        id: 'stale-on-started',
        enabled: true,
        trigger: { type: 'video.started', nodeId: 'video-a' },
        conditions: [],
        actions: [step('stale-reveal', motion('node.enter', target.layerItemId))],
      }],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)
    const oldVideo = renderedItem(container, 'video-a').querySelector('video')
    expect(oldVideo).not.toBeNull()

    expect(await session.player.suspendSurface(SLIDE_SURFACE_ID)).toEqual({ ok: true })
    oldVideo!.dispatchEvent(new Event('playing'))
    await settle()
    expectInteractionVisibility(renderedItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)

    expect(await session.player.resumeSurface(SLIDE_SURFACE_ID)).toEqual({ ok: true })
    await session.goToLocation(LOCATION_B_ID)
    oldVideo!.dispatchEvent(new Event('playing'))
    await settle()
    await session.goToLocation(LOCATION_A_ID)
    expectInteractionVisibility(renderedItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)

    const freshVideo = renderedItem(container, 'video-a').querySelector('video')
    expect(freshVideo).not.toBe(oldVideo)
    freshVideo!.dispatchEvent(new Event('playing'))
    await settle()
    expectInteractionVisibility(renderedItem(container, target.layerItemId), true)
    expect(animationTargets).toContain(target.layerItemId)
    expect(payload).toEqual(before)
  })
})
