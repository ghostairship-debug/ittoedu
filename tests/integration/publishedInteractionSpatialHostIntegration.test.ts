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
  PublishedSpatialSurface,
} from '@/shared/publishedCourseTypes'
import type { PublishedInteractionDiagnostic } from '@/player/interactions/PublishedInteractionSurfacePort'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '@/player/surfaces/publishedDynamicHosts'
import { SPATIAL_GESTURE_OWNER_ATTR } from '@/player/surfaces/spatial/spatialPlaybackGestures'

const SPATIAL_SURFACE_ID = 'surface-spatial'
const SLIDE_SURFACE_ID = 'surface-slide'
const SPATIAL_HOME_LOCATION_ID = 'location-spatial-home'
const SPATIAL_DETAIL_LOCATION_ID = 'location-spatial-detail'
const SLIDE_LOCATION_ID = 'location-slide'
const HOME_FRAME_ID = 'frame-home'
const DETAIL_FRAME_ID = 'frame-detail'
const SLIDE_SCENE_ID = 'scene-slide'
const HOME_WORLD_TRANSFORM = 'translate(640 360) scale(1) translate(0 0)'
const DETAIL_WORLD_TRANSFORM = 'translate(640 360) scale(2) translate(-240 -60)'

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
  surfaceItems?: PublishedScopedLayerItem[]
  worldItems?: PublishedLayerItem[]
  semanticZoom?: PublishedSpatialSurface['semanticZoom']
  globalInteractions?: InteractionRule[]
}

type LayerBaseOptions = {
  visible?: boolean
  hitPolicy?: 'auto' | 'surface' | 'pass-through'
  playbackInitialVisibility?: 'inherit' | 'hidden'
  frame?: { x: number; y: number; width: number; height: number }
}

function layerBase(
  layerItemId: string,
  order: number,
  options: LayerBaseOptions = {},
) {
  const slot = order % 10
  return {
    layerItemId,
    frame: {
      mode: 'absolute' as const,
      ...(options.frame ?? {
        x: 40 + slot * 64,
        y: 40 + Math.floor(order / 10) % 4 * 72,
        width: 160,
        height: 56,
      }),
    },
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
  options: LayerBaseOptions & { text?: string } = {},
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
  options: LayerBaseOptions = {},
): PublishedNativeLayerItem {
  return {
    ...layerBase(id, order, options),
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

function componentItem(
  id: string,
  order: number,
  options: LayerBaseOptions = {},
): PublishedComponentLayerItem {
  return {
    ...layerBase(id, order, options),
    kind: 'component',
    component: { packageId: 'component-owned', version: '1.0.0' },
    props: {},
  }
}

function runtimeItem(
  id: string,
  order: number,
  options: LayerBaseOptions = {},
): PublishedRuntimeLayerItem {
  return {
    ...layerBase(id, order, options),
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

function encodeUtf16(source: string): { encoding: 'base64-utf16le'; data: string } {
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    bytes[index * 2] = code & 0xff
    bytes[index * 2 + 1] = code >>> 8
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}

function publishedFixture(options: FixtureOptions = {}): PublishedCourseV2Payload {
  const payload: PublishedCourseV2Payload = {
    format: 'h5course-published',
    formatVersion: 2,
    sourceSchemaVersion: 9,
    courseId: 'published-interaction-spatial-host',
    title: 'Published Interaction Spatial Host',
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
        code: encodeUtf16(`
          window.CoursewareComponent.define({
            id: 'component-owned',
            runtimeApiVersion: 4,
            create() {
              return { destroy() {} }
            },
          })
        `),
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
        id: SPATIAL_HOME_LOCATION_ID,
        label: 'Spatial home',
        kind: 'spatial-camera',
        surfaceId: SPATIAL_SURFACE_ID,
        cameraFrameId: HOME_FRAME_ID,
      },
      {
        id: SPATIAL_DETAIL_LOCATION_ID,
        label: 'Spatial detail',
        kind: 'spatial-camera',
        surfaceId: SPATIAL_SURFACE_ID,
        cameraFrameId: DETAIL_FRAME_ID,
      },
      {
        id: SLIDE_LOCATION_ID,
        label: 'Slide',
        kind: 'slide-scene',
        surfaceId: SLIDE_SURFACE_ID,
        sceneId: SLIDE_SCENE_ID,
      },
    ],
    startLocationId: SPATIAL_HOME_LOCATION_ID,
    globalLayerItems: options.globalItems ?? [],
    globalInteractions: options.globalInteractions ?? [],
    surfaces: [
      {
        id: SPATIAL_SURFACE_ID,
        title: 'Spatial',
        type: 'spatial-2d',
        surfaceLayerItems: options.surfaceItems ?? [],
        backgroundColor: '#ffffff',
        world: {
          bounds: { mode: 'infinite' },
          layerItems: options.worldItems ?? [],
          paths: [],
          relations: [],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 1 },
          frames: [
            { id: HOME_FRAME_ID, name: 'Home', x: 0, y: 0, zoom: 1 },
            { id: DETAIL_FRAME_ID, name: 'Detail', x: 240, y: 60, zoom: 2 },
          ],
        },
        semanticZoom: options.semanticZoom ?? [],
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
        {
          id: 'print-spatial',
          kind: 'spatial-frames',
          surfaceId: SPATIAL_SURFACE_ID,
          cameraFrameIds: [HOME_FRAME_ID, DETAIL_FRAME_ID],
        },
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
let previousHtmlAnimate: PropertyDescriptor | undefined
let previousSvgAnimate: PropertyDescriptor | undefined

async function settle(turns = 24): Promise<void> {
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

function spatialRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(`.spatial-surface[data-surface-id="${SPATIAL_SURFACE_ID}"]`)
  expect(root).not.toBeNull()
  return root!
}

function spatialItem(container: HTMLElement, itemId: string): Element | null {
  return spatialRoot(container).querySelector(
    `[data-spatial-layer-record="true"][data-layer-item-id="${itemId}"]`,
  )
}

function renderedSpatialItem(container: HTMLElement, itemId: string): HTMLElement | SVGElement {
  const item = spatialItem(container, itemId)
  expect(item, `expected rendered Spatial item ${itemId}`).not.toBeNull()
  return item as HTMLElement | SVGElement
}

function renderedSlideItem(container: HTMLElement, itemId: string): HTMLElement {
  const item = container.querySelector<HTMLElement>(
    `[data-slide-layer-item="${itemId}"]`,
  )
  expect(item, `expected rendered Slide item ${itemId}`).not.toBeNull()
  return item!
}

function expectInteractionVisibility(item: HTMLElement | SVGElement, visible: boolean): void {
  expect(item.dataset.interactionVisibility).toBe(visible ? 'visible' : 'hidden')
  expect(item.style.visibility).toBe(visible ? 'visible' : 'hidden')
  if (!visible) expect(item.style.pointerEvents).toBe('none')
}

function worldTransform(container: HTMLElement): string | null {
  return spatialRoot(container)
    .querySelector<SVGGElement>('[data-spatial-world]')
    ?.getAttribute('transform') ?? null
}

function tap(target: EventTarget): boolean {
  return target.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
  }))
}

function pointer(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    isPrimary: true,
  }))
}

function recordAnimation(this: HTMLElement | SVGElement) {
  animationTargets.push(this.dataset.layerItemId ?? 'unknown')
  return {
    cancel: vi.fn(),
    finished: Promise.resolve(),
  } as unknown as Animation
}

beforeEach(() => {
  animationTargets = []
  previousHtmlAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
  previousSvgAnimate = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'animate')
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: recordAnimation,
  })
  Object.defineProperty(SVGElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: recordAnimation,
  })
})

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()))
  if (vi.isFakeTimers()) vi.useRealTimers()
  if (previousHtmlAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', previousHtmlAnimate)
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>)['animate']
  }
  if (previousSvgAnimate) {
    Object.defineProperty(SVGElement.prototype, 'animate', previousSvgAnimate)
  } else {
    delete (SVGElement.prototype as Partial<SVGElement>)['animate']
  }
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('Published Interaction Spatial host integration', () => {
  it('binds and moves native global, surface, and world HTML/SVG records while visible:false stays absent', async () => {
    const globalTrigger = textItem('spatial-global-trigger', 100)
    const globalExit = textItem('spatial-global-exit', 101)
    const globalTarget = textItem('spatial-global-target', 102, {
      playbackInitialVisibility: 'hidden',
    })
    const surfaceTrigger = textItem('spatial-surface-trigger', 200)
    const surfaceExit = textItem('spatial-surface-exit', 201)
    const surfaceTarget = textItem('spatial-surface-target', 202, {
      playbackInitialVisibility: 'hidden',
    })
    const worldTrigger = textItem('spatial-world-trigger', 10)
    const worldExit = textItem('spatial-world-exit', 11)
    const worldTarget = textItem('spatial-world-target', 12, {
      playbackInitialVisibility: 'hidden',
    })
    const authoredInvisible = textItem('spatial-authored-invisible', 13, { visible: false })
    const pairs = [
      [globalTrigger, globalExit, globalTarget],
      [surfaceTrigger, surfaceExit, surfaceTarget],
      [worldTrigger, worldExit, worldTarget],
    ] as const
    const payload = publishedFixture({
      globalItems: [scoped(globalTrigger), scoped(globalExit), scoped(globalTarget)],
      surfaceItems: [scoped(surfaceTrigger), scoped(surfaceExit), scoped(surfaceTarget)],
      worldItems: [worldTrigger, worldExit, worldTarget, authoredInvisible],
      globalInteractions: pairs.flatMap(([trigger, exit, target], index) => [
        clickRule(`spatial-enter-rule-${index}`, trigger.layerItemId, [
          step(`spatial-enter-step-${index}`, motion('node.enter', target.layerItemId)),
        ]),
        clickRule(`spatial-exit-rule-${index}`, exit.layerItemId, [
          step(`spatial-exit-step-${index}`, motion('node.exit', target.layerItemId)),
        ]),
      ]),
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload)
    const globalNode = renderedSpatialItem(container, globalTarget.layerItemId)
    const surfaceNode = renderedSpatialItem(container, surfaceTarget.layerItemId)
    const worldNode = renderedSpatialItem(container, worldTarget.layerItemId)

    expect(globalNode).toBeInstanceOf(HTMLElement)
    expect(surfaceNode).toBeInstanceOf(SVGElement)
    expect(worldNode).toBeInstanceOf(SVGElement)
    expect(globalNode.dataset.layerSource).toBe('global')
    expect(surfaceNode.dataset.layerSource).toBe('surface')
    expect(worldNode.dataset.layerSource).toBe('world')
    expectInteractionVisibility(globalNode, false)
    expectInteractionVisibility(surfaceNode, false)
    expectInteractionVisibility(worldNode, false)
    expect(spatialItem(container, authoredInvisible.layerItemId)).toBeNull()

    let outerClickCount = 0
    container.addEventListener('click', () => {
      outerClickCount += 1
    })
    for (const [trigger] of pairs) {
      expect(tap(renderedSpatialItem(container, trigger.layerItemId))).toBe(true)
    }
    await settle()

    expect(outerClickCount).toBe(3)
    for (const [, , target] of pairs) {
      expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), true)
      expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    }

    for (const [, exit] of pairs) {
      expect(tap(renderedSpatialItem(container, exit.layerItemId))).toBe(true)
    }
    await settle()

    expect(outerClickCount).toBe(6)
    for (const [, , target] of pairs) {
      expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), false)
      expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(2)
    }
    expect(payload).toEqual(before)
  })

  it('keeps authored/camera/semantic unavailability stronger than transient interaction state', async () => {
    const target = textItem('spatial-hard-scope-target', 100, {
      playbackInitialVisibility: 'hidden',
    })
    const authoredInvisible = textItem('spatial-invisible-trigger', 10, { visible: false })
    const offCamera = textItem('spatial-off-camera-trigger', 11, {
      frame: { x: 5_000, y: 5_000, width: 160, height: 56 },
    })
    const semanticHidden = textItem('spatial-semantic-trigger', 12)
    const unavailable = [authoredInvisible, offCamera, semanticHidden]
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const payload = publishedFixture({
      globalItems: [scoped(target)],
      worldItems: unavailable,
      semanticZoom: [{
        id: 'hide-semantic-trigger',
        layerItemIds: [semanticHidden.layerItemId],
        minZoom: 0,
        maxZoom: 10,
        visible: false,
      }],
      globalInteractions: unavailable.map((item, index) => clickRule(
        `spatial-unavailable-rule-${index}`,
        item.layerItemId,
        [step(`spatial-unavailable-step-${index}`, motion('node.enter', target.layerItemId))],
      )),
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload, diagnostics)

    expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), false)
    expect(spatialItem(container, authoredInvisible.layerItemId)).toBeNull()
    const offCameraNode = renderedSpatialItem(container, offCamera.layerItemId)
    const semanticHiddenNode = renderedSpatialItem(container, semanticHidden.layerItemId)
    expect(offCameraNode.style.display).toBe('none')
    expect(semanticHiddenNode.style.display).toBe('none')
    const bindUnavailable = diagnostics.filter((diagnostic) => diagnostic.code === 'bind-unavailable')
    expect(bindUnavailable.map((diagnostic) => diagnostic.nodeId).sort()).toEqual(
      [authoredInvisible.layerItemId],
    )
    expect(bindUnavailable.every((diagnostic) => diagnostic.phase === 'execute')).toBe(true)
    expect(animationTargets).not.toContain(target.layerItemId)

    const root = spatialRoot(container)
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }),
    })
    pointer(root, 'pointerdown', 0, 0)
    pointer(root, 'pointermove', -5_000, -5_000)
    pointer(root, 'pointerup', -5_000, -5_000)
    await settle()

    expect(renderedSpatialItem(container, offCamera.layerItemId)).toBe(offCameraNode)
    expect(offCameraNode.style.display).toBe('')
    expect(semanticHiddenNode.style.display).toBe('none')
    expect(tap(offCameraNode)).toBe(false)
    await settle()
    expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), false)
    expect(tap(offCameraNode)).toBe(true)
    await settle()
    expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), true)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })

  it('shares only global visibility across camera locations and Slide while pan/suspend preserve local state', async () => {
    const reveal = textItem('spatial-shared-reveal', 100)
    const globalTarget = textItem('spatial-shared-global', 110, {
      playbackInitialVisibility: 'hidden',
    })
    const scopedGlobalTarget = textItem('spatial-shared-scoped', 120, {
      playbackInitialVisibility: 'hidden',
    })
    const surfaceTarget = textItem('spatial-shared-surface', 210, {
      playbackInitialVisibility: 'hidden',
    })
    const worldTarget = textItem('spatial-shared-world', 20, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [
        scoped(reveal),
        scoped(globalTarget),
        scoped(scopedGlobalTarget, {
          mode: 'include',
          locationIds: [SPATIAL_HOME_LOCATION_ID, SLIDE_LOCATION_ID],
        }),
      ],
      surfaceItems: [scoped(surfaceTarget)],
      worldItems: [worldTarget],
      globalInteractions: [clickRule('spatial-shared-rule', reveal.layerItemId, [
        step('show-spatial-global', motion('node.enter', globalTarget.layerItemId)),
        step('show-spatial-scoped', motion('node.enter', scopedGlobalTarget.layerItemId)),
        step('show-spatial-surface', motion('node.enter', surfaceTarget.layerItemId)),
        step('show-spatial-world', motion('node.enter', worldTarget.layerItemId)),
      ])],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    tap(renderedSpatialItem(container, reveal.layerItemId))
    await settle()
    for (const item of [globalTarget, scopedGlobalTarget, surfaceTarget, worldTarget]) {
      expectInteractionVisibility(renderedSpatialItem(container, item.layerItemId), true)
    }

    const root = spatialRoot(container)
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }),
    })
    pointer(root, 'pointerdown', 200, 200)
    pointer(root, 'pointermove', 230, 210)
    pointer(root, 'pointerup', 230, 210)
    await settle()
    expect(worldTransform(container)).not.toBe(HOME_WORLD_TRANSFORM)
    expectInteractionVisibility(renderedSpatialItem(container, surfaceTarget.layerItemId), true)
    expectInteractionVisibility(renderedSpatialItem(container, worldTarget.layerItemId), true)

    expect(await session.player.suspendSurface(SPATIAL_SURFACE_ID)).toEqual({ ok: true })
    expect(await session.player.resumeSurface(SPATIAL_SURFACE_ID)).toEqual({ ok: true })
    expectInteractionVisibility(renderedSpatialItem(container, surfaceTarget.layerItemId), true)
    expectInteractionVisibility(renderedSpatialItem(container, worldTarget.layerItemId), true)

    await session.goToLocation(SPATIAL_DETAIL_LOCATION_ID)
    expect(worldTransform(container)).toBe(DETAIL_WORLD_TRANSFORM)
    expectInteractionVisibility(renderedSpatialItem(container, globalTarget.layerItemId), true)
    expect(spatialItem(container, scopedGlobalTarget.layerItemId)).toBeNull()
    expectInteractionVisibility(renderedSpatialItem(container, surfaceTarget.layerItemId), false)
    expectInteractionVisibility(renderedSpatialItem(container, worldTarget.layerItemId), false)

    await session.goToLocation(SLIDE_LOCATION_ID)
    expectInteractionVisibility(renderedSlideItem(container, globalTarget.layerItemId), true)
    expectInteractionVisibility(renderedSlideItem(container, scopedGlobalTarget.layerItemId), true)

    await session.goToLocation(SPATIAL_HOME_LOCATION_ID)
    expectInteractionVisibility(renderedSpatialItem(container, globalTarget.layerItemId), true)
    expectInteractionVisibility(renderedSpatialItem(container, scopedGlobalTarget.layerItemId), true)
    expectInteractionVisibility(renderedSpatialItem(container, surfaceTarget.layerItemId), false)
    expectInteractionVisibility(renderedSpatialItem(container, worldTarget.layerItemId), false)
    expect(payload).toEqual(before)
  })

  it('uses Published location order for next/previous camera navigation and keeps scene.in false on Spatial', async () => {
    const next = textItem('spatial-next-trigger', 100)
    const previous = textItem('spatial-previous-trigger', 110)
    const conditionedTarget = textItem('spatial-scene-condition-target', 120, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [scoped(next), scoped(previous), scoped(conditionedTarget)],
      globalInteractions: [
        clickRule('spatial-next-rule', next.layerItemId, [
          step('spatial-next-step', { type: 'scene.next' }),
        ]),
        clickRule(
          'spatial-scene-condition-rule',
          next.layerItemId,
          [step('spatial-scene-condition-step', motion('node.enter', conditionedTarget.layerItemId))],
          [{ type: 'scene.in', sceneIds: [SLIDE_SCENE_ID] }],
        ),
        clickRule('spatial-previous-rule', previous.layerItemId, [
          step('spatial-previous-step', { type: 'scene.previous' }),
        ]),
      ],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    expect(worldTransform(container)).toBe(HOME_WORLD_TRANSFORM)
    tap(renderedSpatialItem(container, next.layerItemId))
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(SPATIAL_DETAIL_LOCATION_ID)
      expect(worldTransform(container)).toBe(DETAIL_WORLD_TRANSFORM)
    })
    expectInteractionVisibility(renderedSpatialItem(container, conditionedTarget.layerItemId), false)

    tap(renderedSpatialItem(container, previous.layerItemId))
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(SPATIAL_HOME_LOCATION_ID)
      expect(worldTransform(container)).toBe(HOME_WORLD_TRANSFORM)
    })
    expectInteractionVisibility(renderedSpatialItem(container, conditionedTarget.layerItemId), false)
    expect(payload).toEqual(before)
  })

  it('lets a native tap execute but lets a real Spatial pan suppress its synthetic click', async () => {
    const trigger = textItem('spatial-pan-trigger', 10)
    const target = textItem('spatial-pan-target', 11, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      worldItems: [trigger, target],
      globalInteractions: [clickRule('spatial-pan-rule', trigger.layerItemId, [
        step('spatial-pan-enter', motion('node.enter', target.layerItemId)),
      ])],
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload)
    const root = spatialRoot(container)
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }),
    })
    const triggerNode = renderedSpatialItem(container, trigger.layerItemId)
    expect(triggerNode.hasAttribute(SPATIAL_GESTURE_OWNER_ATTR)).toBe(false)
    let outerClickCount = 0
    container.addEventListener('click', () => {
      outerClickCount += 1
    })

    pointer(triggerNode, 'pointerdown', 100, 100)
    pointer(triggerNode, 'pointermove', 130, 112)
    pointer(triggerNode, 'pointerup', 130, 112)
    await settle()
    expect(worldTransform(container)).not.toBe(HOME_WORLD_TRANSFORM)

    expect(tap(triggerNode)).toBe(false)
    await settle()
    expect(outerClickCount).toBe(0)
    expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)

    expect(tap(triggerNode)).toBe(true)
    await settle()
    expect(outerClickCount).toBe(1)
    expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), true)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })

  it('diagnoses occupied and pass-through records without stealing their click or camera gestures', async () => {
    const component = componentItem('spatial-component-trigger', 10)
    const runtime = runtimeItem('spatial-runtime-trigger', 11)
    const video = videoItem('spatial-video-trigger', 12)
    const controller = teacherControllerItem('spatial-controller-trigger', 100)
    const passThrough = textItem('spatial-pass-through-trigger', 110, {
      hitPolicy: 'pass-through',
    })
    const surfaceOwned = textItem('spatial-surface-owned-trigger', 200, {
      hitPolicy: 'surface',
    })
    const target = textItem('spatial-owned-target', 120, {
      playbackInitialVisibility: 'hidden',
    })
    const ownedItems: PublishedLayerItem[] = [
      component,
      runtime,
      video,
      controller,
      passThrough,
      surfaceOwned,
    ]
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const payload = publishedFixture({
      globalItems: [scoped(controller), scoped(passThrough), scoped(target)],
      surfaceItems: [scoped(surfaceOwned)],
      worldItems: [component, runtime, video],
      globalInteractions: ownedItems.map((item, index) => clickRule(
        `spatial-owned-rule-${index}`,
        item.layerItemId,
        [step(`spatial-owned-step-${index}`, motion('node.enter', target.layerItemId))],
      )),
    })
    const before = structuredClone(payload)
    const { container } = await mount(payload, diagnostics)
    const root = spatialRoot(container)
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }),
    })
    const gestureOwners = [
      [component, 'component'],
      [runtime, 'runtime'],
      [video, 'media'],
      [controller, 'controller'],
    ] as const
    for (const [item, owner] of gestureOwners) {
      expect(renderedSpatialItem(container, item.layerItemId).getAttribute(SPATIAL_GESTURE_OWNER_ATTR))
        .toBe(owner)
    }

    const cameraBefore = worldTransform(container)
    for (const [item] of gestureOwners) {
      const node = renderedSpatialItem(container, item.layerItemId)
      pointer(node, 'pointerdown', 20, 20)
      pointer(node, 'pointermove', 90, 60)
      pointer(node, 'pointerup', 90, 60)
      node.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: 20,
        clientY: 20,
        deltaY: -120,
      }))
    }
    await settle()
    expect(worldTransform(container)).toBe(cameraBefore)

    let outerClickCount = 0
    container.addEventListener('click', () => {
      outerClickCount += 1
    })
    for (const item of ownedItems) {
      expect(tap(renderedSpatialItem(container, item.layerItemId))).toBe(true)
    }
    await settle()

    expect(outerClickCount).toBe(ownedItems.length)
    expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), false)
    expect(animationTargets).not.toContain(target.layerItemId)
    const bindUnavailable = diagnostics.filter((diagnostic) => diagnostic.code === 'bind-unavailable')
    expect(bindUnavailable.map((diagnostic) => diagnostic.nodeId).sort()).toEqual(
      ownedItems.map((item) => item.layerItemId).sort(),
    )
    expect(bindUnavailable.every((diagnostic) => diagnostic.phase === 'execute')).toBe(true)
    expect(payload).toEqual(before)
  })

  it.each([
    ['same-Spatial location navigation', 'same-spatial'],
    ['cross-Surface navigation', 'cross-surface'],
    ['direct Spatial suspend', 'suspend'],
  ] as const)('cancels delayed old-generation work on %s and restores one fresh binding', async (_label, transition) => {
    vi.useFakeTimers()
    const trigger = textItem('spatial-delayed-trigger', 10)
    const target = textItem('spatial-delayed-target', 11, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      worldItems: [trigger, target],
      globalInteractions: [clickRule('spatial-delayed-rule', trigger.layerItemId, [
        step('spatial-delayed-enter', motion('node.enter', target.layerItemId), { delayMs: 100 }),
      ])],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    tap(renderedSpatialItem(container, trigger.layerItemId))
    await settle()
    if (transition === 'suspend') {
      expect(await session.player.suspendSurface(SPATIAL_SURFACE_ID)).toEqual({ ok: true })
      await vi.advanceTimersByTimeAsync(200)
      await settle()
      expect(animationTargets).not.toContain(target.layerItemId)
      expect(await session.player.resumeSurface(SPATIAL_SURFACE_ID)).toEqual({ ok: true })
    } else {
      await session.goToLocation(
        transition === 'same-spatial' ? SPATIAL_DETAIL_LOCATION_ID : SLIDE_LOCATION_ID,
      )
      await session.goToLocation(SPATIAL_HOME_LOCATION_ID)
      await vi.advanceTimersByTimeAsync(200)
      await settle()
      expect(animationTargets).not.toContain(target.layerItemId)
    }

    expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), false)
    tap(renderedSpatialItem(container, trigger.layerItemId))
    await settle()
    await vi.advanceTimersByTimeAsync(100)
    await settle()

    expectInteractionVisibility(renderedSpatialItem(container, target.layerItemId), true)
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })

  it('replay resets camera and local visibility while restart also resets shared global visibility', async () => {
    const reveal = textItem('spatial-lifecycle-reveal', 100)
    const replay = textItem('spatial-lifecycle-replay', 110)
    const restart = textItem('spatial-lifecycle-restart', 120)
    const globalTarget = textItem('spatial-lifecycle-global', 130, {
      playbackInitialVisibility: 'hidden',
    })
    const surfaceTarget = textItem('spatial-lifecycle-surface', 200, {
      playbackInitialVisibility: 'hidden',
    })
    const worldTarget = textItem('spatial-lifecycle-world', 10, {
      playbackInitialVisibility: 'hidden',
    })
    const payload = publishedFixture({
      globalItems: [scoped(reveal), scoped(replay), scoped(restart), scoped(globalTarget)],
      surfaceItems: [scoped(surfaceTarget)],
      worldItems: [worldTarget],
      globalInteractions: [
        clickRule('spatial-lifecycle-reveal-rule', reveal.layerItemId, [
          step('spatial-lifecycle-show-global', motion('node.enter', globalTarget.layerItemId)),
          step('spatial-lifecycle-show-surface', motion('node.enter', surfaceTarget.layerItemId)),
          step('spatial-lifecycle-show-world', motion('node.enter', worldTarget.layerItemId)),
        ]),
        clickRule('spatial-lifecycle-replay-rule', replay.layerItemId, [
          step('spatial-lifecycle-replay-step', { type: 'scene.replay' }),
        ]),
        clickRule('spatial-lifecycle-restart-rule', restart.layerItemId, [
          step('spatial-lifecycle-restart-step', { type: 'course.restart' }),
        ]),
      ],
    })
    const before = structuredClone(payload)
    const { container, session } = await mount(payload)

    tap(renderedSpatialItem(container, reveal.layerItemId))
    await settle()
    for (const item of [globalTarget, surfaceTarget, worldTarget]) {
      expectInteractionVisibility(renderedSpatialItem(container, item.layerItemId), true)
    }

    const root = spatialRoot(container)
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }),
    })
    pointer(root, 'pointerdown', 200, 200)
    pointer(root, 'pointermove', 250, 230)
    pointer(root, 'pointerup', 250, 230)
    await settle()
    expect(worldTransform(container)).not.toBe(HOME_WORLD_TRANSFORM)
    expect(tap(root)).toBe(false)

    tap(renderedSpatialItem(container, replay.layerItemId))
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(SPATIAL_HOME_LOCATION_ID)
      expect(worldTransform(container)).toBe(HOME_WORLD_TRANSFORM)
      expect(renderedSpatialItem(container, surfaceTarget.layerItemId).dataset.interactionVisibility)
        .toBe('hidden')
    })
    expectInteractionVisibility(renderedSpatialItem(container, globalTarget.layerItemId), true)
    expectInteractionVisibility(renderedSpatialItem(container, worldTarget.layerItemId), false)

    tap(renderedSpatialItem(container, reveal.layerItemId))
    await settle()
    expectInteractionVisibility(renderedSpatialItem(container, surfaceTarget.layerItemId), true)
    expectInteractionVisibility(renderedSpatialItem(container, worldTarget.layerItemId), true)

    tap(renderedSpatialItem(container, restart.layerItemId))
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(SPATIAL_HOME_LOCATION_ID)
      expect(renderedSpatialItem(container, globalTarget.layerItemId).dataset.interactionVisibility)
        .toBe('hidden')
    })
    expect(worldTransform(container)).toBe(HOME_WORLD_TRANSFORM)
    expectInteractionVisibility(renderedSpatialItem(container, globalTarget.layerItemId), false)
    expectInteractionVisibility(renderedSpatialItem(container, surfaceTarget.layerItemId), false)
    expectInteractionVisibility(renderedSpatialItem(container, worldTarget.layerItemId), false)
    expect(payload).toEqual(before)
  })

  it('cancels active SVG motion and releases stale delegated records before destroy', async () => {
    const trigger = textItem('spatial-destroy-trigger', 10)
    const target = textItem('spatial-destroy-target', 11)
    const payload = publishedFixture({
      worldItems: [trigger, target],
      globalInteractions: [clickRule('spatial-destroy-rule', trigger.layerItemId, [
        step('spatial-destroy-exit', motion('node.exit', target.layerItemId, 1_000)),
      ])],
    })
    const before = structuredClone(payload)
    const cancel = vi.fn()
    Object.defineProperty(SVGElement.prototype, 'animate', {
      configurable: true,
      writable: true,
      value(this: SVGElement) {
        animationTargets.push(this.dataset.layerItemId ?? 'unknown')
        return {
          cancel,
          finished: new Promise<void>(() => undefined),
        } as unknown as Animation
      },
    })
    const { container, session } = await mount(payload)
    const root = spatialRoot(container)
    const staleTrigger = renderedSpatialItem(container, trigger.layerItemId)
    const staleTarget = renderedSpatialItem(container, target.layerItemId)

    tap(staleTrigger)
    await settle()
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    await session.destroy()

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(root.isConnected).toBe(false)
    expect(staleTrigger.isConnected).toBe(false)
    expectInteractionVisibility(staleTarget, true)
    expect(tap(staleTrigger)).toBe(true)
    await settle()
    expect(animationTargets.filter((id) => id === target.layerItemId)).toHaveLength(1)
    expect(payload).toEqual(before)
  })
})
