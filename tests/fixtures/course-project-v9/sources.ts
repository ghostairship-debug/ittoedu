import { componentContentSha256 } from '../../../src/shared/componentContentIntegrity'
import type { ComponentManifest } from '../../../src/shared/componentTypes'
import type { AssetMeta } from '../../../src/shared/contracts/media-v1/types'
import type { InteractionRule } from '../../../src/shared/interactionTypes'
import { courseProjectDocumentSchema } from '../../../src/shared/courseProjectSchema'
import type {
  ComponentLayerItem,
  CourseAssetMeta,
  CourseProjectDocument,
  FlowBlock,
  FlowSurfaceLayerEntry,
  GlobalLayerEntry,
  GlobalLayerPlane,
  NativeLayerItem,
  RuntimeLayerItem,
  ScopedLayerItem,
} from '../../../src/shared/courseProjectTypes'
import type { CourseProjectArchiveData } from '../../../src/renderer/project/courseProjectArchive'

export const COURSE_PROJECT_V9_FIXTURE_MTIME = '2026-08-18T12:00:00.000Z'

export const COURSE_PROJECT_V9_FIXTURE_IDS = [
  'slide-native',
  'slide-presentation-state',
  'global-layer-teacher-controller',
  'canvas-runtime',
  'surface-runtime',
  'component',
  'flow',
  'spatial',
  'mixed',
  'multi-asset',
] as const

export type CourseProjectV9FixtureId = typeof COURSE_PROJECT_V9_FIXTURE_IDS[number]

export interface CourseProjectV9FixtureSpec {
  id: CourseProjectV9FixtureId
  filename: `${CourseProjectV9FixtureId}.h5lesson`
  title: string
  covers: readonly string[]
  data: CourseProjectArchiveData
}

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
  0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54,
  0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
  0x00, 0x03, 0x00, 0x01, 0x18, 0xdd, 0x8d, 0xb0,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
])
const AUDIO_BYTES = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const VIDEO_BYTES = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])

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

function layerBase(
  layerItemId: string,
  order: number,
  frame: NativeLayerItem['frame'],
): Pick<
  NativeLayerItem,
  | 'layerItemId'
  | 'label'
  | 'frame'
  | 'order'
  | 'visible'
  | 'locked'
  | 'rotation'
  | 'opacity'
  | 'hitPolicy'
  | 'playbackInitialVisibility'
> {
  return {
    layerItemId,
    label: layerItemId,
    frame,
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
  }
}

function nativeText(
  layerItemId: string,
  order: number,
  text: string,
  frame: NativeLayerItem['frame'] = { mode: 'absolute', x: 40, y: 40, width: 520, height: 80 },
): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, frame),
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function nativeImage(layerItemId: string, order: number, assetId: string): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 80, y: 160, width: 320, height: 180 }),
    kind: 'native',
    content: {
      nativeType: 'image',
      data: {
        assetId,
        preserveAspectRatio: true,
        fit: 'contain',
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        cropX: 0.5,
        cropY: 0.5,
        flipX: false,
        flipY: false,
        cornerRadius: 0,
        feather: { amount: 0, mode: 'rectangle' },
        safeAreas: [],
      },
    },
  }
}

function nativeFormula(layerItemId: string, order: number): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 40, y: 140, width: 640, height: 90 }),
    kind: 'native',
    content: {
      nativeType: 'formula',
      data: {
        formulaId: 'formula-delta',
        accessibleText: '德尔塔等于 b 的平方减去四 a c',
        ast: {
          type: 'row',
          children: [
            { type: 'token', value: 'Δ' },
            { type: 'operator', value: '=' },
            {
              type: 'script',
              base: { type: 'token', value: 'b' },
              superscript: { type: 'token', value: '2' },
            },
            { type: 'operator', value: '−' },
            { type: 'token', value: '4ac' },
          ],
        },
        style: { fontSize: 28, color: '#172033', align: 'left' },
      },
    },
  }
}

function nativeShape(layerItemId: string, order: number): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 720, y: 80, width: 200, height: 120 }),
    kind: 'native',
    content: {
      nativeType: 'shape',
      data: {
        shapeType: 'rounded-rectangle',
        style: {
          fillColor: '#dbeafe',
          fillOpacity: 1,
          borderColor: '#2563eb',
          borderOpacity: 1,
          borderWidth: 2,
          lineStyle: 'solid',
          cornerRadius: 16,
          startArrow: 'none',
          endArrow: 'none',
        },
      },
    },
  }
}

function nativeVideo(layerItemId: string, order: number, assetId: string): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 480, y: 200, width: 640, height: 360 }),
    kind: 'native',
    content: {
      nativeType: 'video',
      data: {
        assetId,
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
        backgroundAudioMode: 'duck',
      },
    },
  }
}

function teacherController(layerItemId: string, order: number): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, { mode: 'absolute', x: 190, y: 638, width: 900, height: 64 }),
    label: '教师控制器',
    kind: 'native',
    content: {
      nativeType: 'teacher-controller',
      data: {
        title: '教师控制台',
        showSceneProgress: true,
        compact: false,
        collapsible: true,
        defaultCollapsed: false,
        buttons: [
          { id: 'prev', action: { type: 'scene.previous' }, label: '上一场景', visible: true },
          { id: 'next', action: { type: 'scene.next' }, label: '下一场景', visible: true },
          { id: 'picker', action: { type: 'scene.open-picker' }, label: '场景目录', visible: true },
          { id: 'replay', action: { type: 'scene.replay' }, label: '重播', visible: true },
          { id: 'sound', action: { type: 'audio.toggle-mute' }, label: '声音', visible: true },
          { id: 'fullscreen', action: { type: 'player.fullscreen.toggle' }, label: '全屏', visible: true },
        ],
        style: {
          backgroundColor: '#172033',
          backgroundOpacity: 0.94,
          accentColor: '#e7b85c',
          textColor: '#f8fafc',
          cornerRadius: 16,
        },
        includeInStaticExports: false,
      },
    },
  }
}

function scoped(item: NativeLayerItem | ComponentLayerItem | RuntimeLayerItem): ScopedLayerItem {
  return { item, visibility: { mode: 'all', locationIds: [] } }
}

function globalEntry(
  item: NativeLayerItem | ComponentLayerItem | RuntimeLayerItem,
  plane: GlobalLayerPlane,
): GlobalLayerEntry {
  return { ...scoped(item), plane }
}

function clickRevealRule(id: string, nodeId: string, stateId: string, stateKey: string): InteractionRule {
  return {
    id,
    name: id,
    enabled: true,
    trigger: { type: 'node.click', nodeId },
    conditions: [],
    actions: [
      {
        id: `${id}-presentation`,
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'presentation.set', stateId },
      },
      {
        id: `${id}-state`,
        start: 'with-previous',
        delayMs: 0,
        action: { type: 'course-state.set', key: stateKey, value: true },
      },
    ],
  }
}

function imageAsset(
  id: string,
  filename = `${id}.png`,
  remote?: CourseAssetMeta['remote'],
): CourseAssetMeta {
  const meta: CourseAssetMeta = {
    id,
    filename,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${filename}`,
    byteLength: PNG_BYTES.byteLength,
    width: 1,
    height: 1,
  }
  if (remote) meta.remote = remote
  return meta
}

function audioAsset(id: string): AssetMeta {
  return {
    id,
    filename: `${id}.mp3`,
    mimeType: 'audio/mpeg',
    kind: 'audio',
    path: `assets/${id}.mp3`,
    byteLength: AUDIO_BYTES.byteLength,
    duration: 1,
  }
}

function videoAsset(id: string): AssetMeta {
  return {
    id,
    filename: `${id}.mp4`,
    mimeType: 'video/mp4',
    kind: 'video',
    path: `assets/${id}.mp4`,
    byteLength: VIDEO_BYTES.byteLength,
    width: 16,
    height: 9,
    duration: 1,
  }
}

function courseShell(
  id: string,
  title: string,
  extras: Partial<CourseProjectDocument> = {},
): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: 9,
    id,
    revision: 1,
    title,
    createdAt: COURSE_PROJECT_V9_FIXTURE_MTIME,
    updatedAt: COURSE_PROJECT_V9_FIXTURE_MTIME,
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
    ...extras,
  }
}

function quizComponent(): {
  files: Record<string, Uint8Array>
  packageId: string
  version: string
  meta: CourseProjectDocument['componentPackages'][string]
} {
  const packageId = 'com.example.v9-quiz'
  const version = '4.0.0'
  const manifest: ComponentManifest = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    renderMode: 'dom',
    supportedScopes: ['scene'],
    id: packageId,
    name: 'V9 测验',
    version,
    entry: 'runtime.js',
    thumbnail: 'thumbnail.png',
    defaultSize: { width: 400, height: 240 },
    minSize: { width: 200, height: 120 },
    preserveAspectRatio: false,
    assets: {},
    defaultProps: { prompt: '默认题干' },
    editor: {
      properties: [{ key: 'prompt', label: '题干', type: 'text' }],
    },
  }
  const files = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(
      "window.CoursewareComponent.define({id:'com.example.v9-quiz',runtimeApiVersion:4,create:function(){return {destroy:function(){}}}})",
    ),
    'thumbnail.png': PNG_BYTES,
  }
  return {
    files,
    packageId,
    version,
    meta: {
      packageId,
      version,
      name: manifest.name,
      manifestPath: `components/${packageId}@${version}/manifest.json`,
      runtimePath: `components/${packageId}@${version}/runtime.js`,
      thumbnailPath: `components/${packageId}@${version}/thumbnail.png`,
      contentSha256: componentContentSha256(files),
    },
  }
}

function emptyArchive(
  project: CourseProjectDocument,
  assetFiles: Record<string, Uint8Array> = {},
  componentFiles: CourseProjectArchiveData['componentFiles'] = {},
): CourseProjectArchiveData {
  return {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles,
    componentFiles,
  }
}

function slideNative(): CourseProjectArchiveData {
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-slide-native', 'V9 夹具 · Slide Native'),
    assets: { badge: imageAsset('badge') },
    locations: [{
      id: 'location-scene-1',
      label: '原生页',
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
        name: '原生页',
        backgroundColor: '#ffffff',
        layerItems: [
          nativeText('slide-title', 1, '用判别式判断方程根的情况'),
          nativeFormula('slide-formula', 2),
          nativeImage('slide-badge', 3, 'badge'),
          nativeShape('slide-card', 4),
        ],
        interactions: [{
          id: 'slide-native-enter',
          name: '进入时淡入图片',
          enabled: true,
          trigger: { type: 'scene.enter' },
          conditions: [],
          actions: [{
            id: 'slide-native-badge-enter',
            start: 'after-previous',
            delayMs: 0,
            action: {
              type: 'node.enter',
              nodeId: 'slide-badge',
              effect: 'fade',
              durationMs: 240,
              easing: 'ease-out',
            },
          }],
        }],
      }],
    }],
  }
  return emptyArchive(project, { badge: PNG_BYTES })
}

function slidePresentationState(): CourseProjectArchiveData {
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-slide-presentation-state', 'V9 夹具 · Presentation State', {
      courseState: [{ key: 'answered', valueType: 'boolean', defaultValue: false }],
    }),
    locations: [
      {
        id: 'location-hidden',
        label: '初始',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
        stateId: 'state-hidden',
      },
      {
        id: 'location-success',
        label: '成功复核',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
        stateId: 'state-success',
      },
    ],
    startLocationId: 'location-hidden',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [{
        id: 'scene-1',
        name: '判别式复核',
        backgroundColor: '#ffffff',
        layerItems: [
          nativeText('slide-title', 1, '先计算判别式'),
          nativeText('slide-hint', 2, 'Δ = b² − 4ac', { mode: 'absolute', x: 40, y: 140, width: 640, height: 64 }),
          nativeText('slide-feedback', 3, '等待作答', { mode: 'absolute', x: 40, y: 220, width: 720, height: 80 }),
        ],
        presentation: {
          initialStateId: 'state-hidden',
          thumbnailStateId: 'state-success',
          states: [
            {
              id: 'state-hidden',
              name: '初始｜提示隐藏',
              layerItemOverrides: {
                'slide-hint': { visible: false },
                'slide-feedback': { visible: false },
              },
            },
            {
              id: 'state-success',
              name: '成功｜结论复核',
              backgroundColor: '#f0fdf4',
              layerItemOverrides: {
                'slide-hint': { visible: true },
                'slide-feedback': {
                  visible: true,
                  nativeData: { text: '正确：Δ > 0，方程有两个不相等的实数根。' },
                },
              },
            },
          ],
        },
        interactions: [clickRevealRule('rule-reveal-success', 'slide-title', 'state-success', 'answered')],
      }],
    }],
  }
  return emptyArchive(project)
}

function globalLayerTeacherController(): CourseProjectArchiveData {
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-global-layer-teacher-controller', 'V9 夹具 · 全局层教师控制器', {
      playback: {
        controls: 'canvas',
        keyboardNavigation: true,
        presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
      },
      courseState: [{ key: 'unlocked', valueType: 'boolean', defaultValue: true }],
      navigationGuards: [{
        id: 'guard-scene-2',
        effect: 'block',
        toLocationIds: ['location-scene-2'],
        match: 'all',
        conditions: [{ type: 'compare', key: 'unlocked', operator: 'eq', value: false }],
        message: '未解锁',
      }],
      globalLayerItems: [
        globalEntry(
          nativeText('global-banner', 50, '全课横幅', { mode: 'absolute', x: 40, y: 16, width: 400, height: 48 }),
          'underlay',
        ),
        globalEntry(teacherController('teacher-controller-main', 80), 'overlay'),
      ],
    }),
    locations: [
      {
        id: 'location-scene-1',
        label: '场景 1',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
      },
      {
        id: 'location-scene-2',
        label: '场景 2',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-2',
      },
    ],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [
        {
          id: 'scene-1',
          name: '场景 1',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title-1', 1, '本页标题')],
          interactions: [],
        },
        {
          id: 'scene-2',
          name: '场景 2',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title-2', 1, '第二页标题')],
          interactions: [],
        },
      ],
    }],
  }
  return emptyArchive(project)
}

function canvasRuntime(): CourseProjectArchiveData {
  const runtime: RuntimeLayerItem = {
    ...layerBase('slide-canvas-runtime', 0, {
      mode: 'absolute',
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    }),
    hitPolicy: 'surface',
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'phaser',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
      content: { values: { label: 'Canvas Runtime' } },
      assets: { sprite: { assetId: 'runtime-sprite' } },
      staticFallback: { assetId: 'runtime-fallback', coverage: 'scene' },
    },
  }
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-canvas-runtime', 'V9 夹具 · Canvas Runtime', {
      network: { connectOrigins: ['https://runtime.example.com'] },
    }),
    assets: {
      'runtime-sprite': imageAsset('runtime-sprite'),
      'runtime-fallback': imageAsset('runtime-fallback'),
    },
    locations: [{
      id: 'location-scene-1',
      label: '画布运行时',
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
        name: '画布运行时',
        backgroundColor: '#ffffff',
        layerItems: [
          runtime,
          nativeText('slide-caption', 10, 'Canvas Runtime 说明', {
            mode: 'absolute',
            x: 40,
            y: 640,
            width: 480,
            height: 48,
          }),
        ],
        interactions: [],
      }],
    }],
  }
  return emptyArchive(project, {
    'runtime-sprite': PNG_BYTES,
    'runtime-fallback': PNG_BYTES,
  })
}

function surfaceRuntime(): CourseProjectArchiveData {
  const runtime: RuntimeLayerItem = {
    ...layerBase('slide-surface-runtime', 1, {
      mode: 'absolute',
      x: 80,
      y: 120,
      width: 720,
      height: 400,
    }),
    kind: 'runtime',
    runtime: {
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return {destroy(){}}}})',
      content: {
        values: { title: '动态标题' },
        metadata: { title: { label: '标题', multiline: false } },
      },
      assets: { hero: { assetId: 'surface-hero' } },
      staticFallback: { assetId: 'surface-fallback', coverage: 'surface' },
    },
  }
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-surface-runtime', 'V9 夹具 · Surface Runtime', {
      network: { connectOrigins: ['https://surface.example.com'] },
    }),
    assets: {
      'surface-hero': imageAsset('surface-hero'),
      'surface-fallback': imageAsset('surface-fallback'),
    },
    locations: [{
      id: 'location-scene-1',
      label: '表面运行时',
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
        name: '表面运行时',
        backgroundColor: '#ffffff',
        layerItems: [
          runtime,
          nativeText('slide-caption', 2, 'Surface Runtime 说明', {
            mode: 'absolute',
            x: 80,
            y: 540,
            width: 480,
            height: 48,
          }),
        ],
        interactions: [],
      }],
    }],
  }
  return emptyArchive(project, {
    'surface-hero': PNG_BYTES,
    'surface-fallback': PNG_BYTES,
  })
}

function componentFixture(): CourseProjectArchiveData {
  const quiz = quizComponent()
  const item: ComponentLayerItem = {
    ...layerBase('slide-quiz', 1, { mode: 'absolute', x: 700, y: 120, width: 400, height: 240 }),
    kind: 'component',
    component: { packageId: quiz.packageId, version: quiz.version },
    props: { prompt: '这是幻灯片题' },
    staticFallbackAssetId: 'quiz-fallback',
  }
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-component', 'V9 夹具 · Component'),
    assets: { 'quiz-fallback': imageAsset('quiz-fallback') },
    componentPackages: { [quiz.packageId]: quiz.meta },
    locations: [{
      id: 'location-scene-1',
      label: '组件页',
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
        name: '组件页',
        backgroundColor: '#ffffff',
        layerItems: [
          nativeText('slide-title', 0, '嵌入组件'),
          item,
        ],
        interactions: [],
      }],
    }],
  }
  return emptyArchive(
    project,
    { 'quiz-fallback': PNG_BYTES },
    { [`${quiz.packageId}@${quiz.version}`]: quiz.files },
  )
}

function flowFixture(): CourseProjectArchiveData {
  const blocks: FlowBlock[] = [
    {
      id: 'flow-heading',
      type: 'heading',
      level: 1,
      text: '流式讲义',
      runs: [{ start: 0, end: 4, style: { bold: true } }],
    },
    { id: 'flow-paragraph', type: 'paragraph', text: '这是一段可编辑正文。' },
    {
      id: 'flow-list',
      type: 'list',
      ordered: true,
      items: [
        { id: 'flow-item-1', text: '第一项' },
        { id: 'flow-item-2', text: '第二项' },
      ],
    },
    { id: 'flow-quote', type: 'quote', text: '引用一句结论。', citation: '课堂讲义' },
    { id: 'flow-divider', type: 'divider' },
    {
      id: 'flow-media',
      type: 'media',
      assetId: 'flow-image',
      mediaKind: 'image',
      altText: '插图',
      caption: '示意图',
      layout: 'content-width',
    },
    {
      id: 'flow-table',
      type: 'table',
      caption: '对照表',
      columns: [
        { id: 'col-name', header: '名称' },
        { id: 'col-value', header: '值' },
      ],
      rows: [{
        id: 'row-1',
        cells: { 'col-name': 'Δ', 'col-value': 'b² − 4ac' },
      }],
    },
    {
      id: 'flow-formula',
      type: 'formula',
      formulaId: 'formula-delta',
      accessibleText: '德尔塔等于 b 的平方减去四 a c',
      ast: {
        type: 'row',
        children: [
          { type: 'token', value: 'Δ' },
          { type: 'operator', value: '=' },
          {
            type: 'script',
            base: { type: 'token', value: 'b' },
            superscript: { type: 'token', value: '2' },
          },
          { type: 'operator', value: '−' },
          { type: 'token', value: '4ac' },
        ],
      },
    },
    { id: 'flow-code', type: 'code', language: 'ts', code: 'const delta = b * b - 4 * a * c' },
    {
      id: 'flow-callout',
      type: 'callout',
      tone: 'note',
      title: '提示',
      body: '先算判别式再判断根的情况。',
    },
    {
      id: 'flow-section',
      type: 'section',
      title: '补充',
      collapsedByDefault: false,
      blocks: [{ id: 'flow-section-note', type: 'paragraph', text: '本节可折叠。' }],
    },
  ]
  const flowUnderlay = nativeText('flow-underlay-note', 10, '正文下层', {
    mode: 'absolute',
    x: 40,
    y: 640,
    width: 280,
    height: 40,
  })
  flowUnderlay.paperSpace = 'paper'
  const flowOverlay = nativeText('flow-overlay-note', 20, '讲义浮层', {
    mode: 'absolute',
    x: 930,
    y: 32,
    width: 300,
    height: 52,
  })
  flowOverlay.paperSpace = 'viewport'
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-flow', 'V9 夹具 · Flow'),
    assets: { 'flow-image': imageAsset('flow-image') },
    locations: [{
      id: 'location-flow',
      label: '流式讲义',
      kind: 'flow-block',
      surfaceId: 'surface-flow',
      blockId: 'flow-heading',
    }],
    startLocationId: 'location-flow',
    surfaces: [{
      id: 'surface-flow',
      title: '流式讲义',
      type: 'flow',
      surfaceLayerItems: [
        { ...scoped(flowUnderlay), bodyPlane: 'underlay' } satisfies FlowSurfaceLayerEntry,
        { ...scoped(flowOverlay), bodyPlane: 'overlay' } satisfies FlowSurfaceLayerEntry,
      ],
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      blocks,
    }],
  }
  return emptyArchive(project, { 'flow-image': PNG_BYTES })
}

function spatialFixture(): CourseProjectArchiveData {
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-spatial', 'V9 夹具 · Spatial'),
    globalLayerItems: [globalEntry(teacherController('global-teacher-controller', 100_000), 'overlay')],
    locations: [
      {
        id: 'location-home',
        label: '全景',
        kind: 'spatial-camera',
        surfaceId: 'surface-spatial',
        cameraFrameId: 'camera-home',
      },
      {
        id: 'location-detail',
        label: '细节',
        kind: 'spatial-camera',
        surfaceId: 'surface-spatial',
        cameraFrameId: 'camera-detail',
      },
    ],
    startLocationId: 'location-home',
    surfaces: [{
      id: 'surface-spatial',
      title: '无限画布',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [
          nativeText('spatial-a', 1, '甲', { mode: 'absolute', x: -200, y: -40, width: 160, height: 64 }),
          nativeText('spatial-b', 2, '乙', { mode: 'absolute', x: 200, y: 80, width: 160, height: 64 }),
        ],
        paths: [{
          id: 'path-explore',
          name: '探索路线',
          layerItemIds: ['spatial-a', 'spatial-b'],
          style: { color: '#2563eb', width: 3, dash: 'dashed' },
        }],
        relations: [{
          id: 'relation-ab',
          sourceLayerItemId: 'spatial-a',
          targetLayerItemId: 'spatial-b',
          label: '从甲到乙',
          kind: 'arrow',
        }],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [
          { id: 'camera-home', name: '全景', x: 0, y: 0, zoom: 1 },
          { id: 'camera-detail', name: '细节', x: 200, y: 80, zoom: 1.5 },
        ],
      },
      semanticZoom: [{
        id: 'zoom-labels',
        layerItemIds: ['spatial-b'],
        minZoom: 1.2,
        maxZoom: 8,
        visible: true,
      }],
    }],
  }
  return emptyArchive(project)
}

function mixedFixture(): CourseProjectArchiveData {
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-mixed', 'V9 夹具 · Mixed'),
    globalLayerItems: [
      globalEntry(nativeText('global-banner', 900, '跨表面横幅', {
        mode: 'absolute',
        x: 40,
        y: 16,
        width: 360,
        height: 40,
      }), 'overlay'),
    ],
    locations: [
      {
        id: 'location-slide',
        label: '演示页',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
      },
      {
        id: 'location-flow',
        label: '讲义',
        kind: 'flow-block',
        surfaceId: 'surface-flow',
        blockId: 'flow-heading',
      },
      {
        id: 'location-spatial',
        label: '空间总览',
        kind: 'spatial-camera',
        surfaceId: 'surface-spatial',
        cameraFrameId: 'spatial-home',
      },
    ],
    startLocationId: 'location-slide',
    surfaces: [
      {
        id: 'surface-slide',
        title: '演示',
        type: 'slide',
        canvas: { width: 1280, height: 720 },
        surfaceLayerItems: [scoped(nativeText('slide-shared', 10, '表面共享'))],
        scenes: [{
          id: 'scene-1',
          name: '演示页',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title', 1, 'Mixed 起始页')],
          interactions: [],
        }],
      },
      {
        id: 'surface-flow',
        title: '讲义',
        type: 'flow',
        surfaceLayerItems: [],
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        blocks: [
          { id: 'flow-heading', type: 'heading', level: 1, text: '讲义标题' },
          { id: 'flow-paragraph', type: 'paragraph', text: '同一工程内的流式页面。' },
        ],
      },
      {
        id: 'surface-spatial',
        title: '空间',
        type: 'spatial-2d',
        surfaceLayerItems: [],
        world: {
          bounds: { mode: 'finite', x: -500, y: -400, width: 1000, height: 800 },
          layerItems: [nativeText('spatial-label', 20, '空间节点')],
          paths: [],
          relations: [],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 1 },
          frames: [{ id: 'spatial-home', name: 'Home', x: 0, y: 0, zoom: 1 }],
        },
        semanticZoom: [],
      },
    ],
    mixedPrintPlan: {
      pageSize: 'surface-native',
      orientation: 'auto',
      entries: [
        { id: 'print-slide', kind: 'slide-scenes', surfaceId: 'surface-slide', sceneIds: ['scene-1'] },
        { id: 'print-flow', kind: 'flow-document', surfaceId: 'surface-flow' },
        {
          id: 'print-spatial',
          kind: 'spatial-frames',
          surfaceId: 'surface-spatial',
          cameraFrameIds: ['spatial-home'],
        },
      ],
    },
  }
  return emptyArchive(project)
}

function multiAsset(): CourseProjectArchiveData {
  const project: CourseProjectDocument = {
    ...courseShell('v9-fixture-multi-asset', 'V9 夹具 · 多素材', {
      network: {
        connectOrigins: ['https://media.example.com', 'wss://media.example.com'],
      },
      media: {
        audio: {
          defaultMuted: false,
          masterVolume: 1,
          channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
          sounds: {
            'narration-intro': {
              id: 'narration-intro',
              name: '导读',
              assetId: 'voice',
              channel: 'narration',
              defaultVolume: 1,
              defaultLoop: false,
            },
          },
          narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
        },
      },
    }),
    assets: {
      photo: imageAsset('photo', 'photo.png', {
        url: 'https://media.example.com/photo.png',
      }),
      diagram: imageAsset('diagram'),
      voice: audioAsset('voice'),
      clip: videoAsset('clip'),
    },
    locations: [{
      id: 'location-scene-1',
      label: '多素材页',
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
        name: '多素材页',
        backgroundColor: '#ffffff',
        backgroundAssetId: 'diagram',
        layerItems: [
          nativeText('slide-title', 1, '图片、声音与视频'),
          nativeImage('slide-photo', 2, 'photo'),
          nativeVideo('slide-clip', 3, 'clip'),
        ],
        interactions: [],
      }],
    }],
  }
  return emptyArchive(project, {
    photo: PNG_BYTES,
    diagram: PNG_BYTES,
    voice: AUDIO_BYTES,
    clip: VIDEO_BYTES,
  })
}

export function listCourseProjectV9Fixtures(): CourseProjectV9FixtureSpec[] {
  return [
    {
      id: 'slide-native',
      filename: 'slide-native.h5lesson',
      title: 'Slide Native',
      covers: ['PM-02', 'PM-03', 'PM-07', 'PM-09', 'PM-10', 'PM-22', 'PM-26', 'PM-27'],
      data: slideNative(),
    },
    {
      id: 'slide-presentation-state',
      filename: 'slide-presentation-state.h5lesson',
      title: 'Slide Presentation State',
      covers: ['PM-02', 'PM-03', 'PM-08', 'PM-09', 'PM-17'],
      data: slidePresentationState(),
    },
    {
      id: 'global-layer-teacher-controller',
      filename: 'global-layer-teacher-controller.h5lesson',
      title: 'Global Layer including teacher-controller',
      covers: ['PM-02', 'PM-08', 'PM-09', 'PM-11'],
      data: globalLayerTeacherController(),
    },
    {
      id: 'canvas-runtime',
      filename: 'canvas-runtime.h5lesson',
      title: 'Canvas Runtime',
      covers: ['PM-02', 'PM-15', 'PM-16', 'PM-17', 'PM-18', 'PM-28'],
      data: canvasRuntime(),
    },
    {
      id: 'surface-runtime',
      filename: 'surface-runtime.h5lesson',
      title: 'Surface Runtime',
      covers: ['PM-02', 'PM-15', 'PM-16', 'PM-18'],
      data: surfaceRuntime(),
    },
    {
      id: 'component',
      filename: 'component.h5lesson',
      title: 'Component',
      covers: ['PM-02', 'PM-12', 'PM-14', 'PM-18', 'PM-19'],
      data: componentFixture(),
    },
    {
      id: 'flow',
      filename: 'flow.h5lesson',
      title: 'Flow',
      covers: ['PM-02', 'PM-04', 'PM-08', 'PM-24'],
      data: flowFixture(),
    },
    {
      id: 'spatial',
      filename: 'spatial.h5lesson',
      title: 'Spatial',
      covers: ['PM-02', 'PM-05', 'PM-09'],
      data: spatialFixture(),
    },
    {
      id: 'mixed',
      filename: 'mixed.h5lesson',
      title: 'Mixed',
      covers: ['PM-02', 'PM-06', 'PM-12', 'PM-18', 'PM-21', 'PM-23'],
      data: mixedFixture(),
    },
    {
      id: 'multi-asset',
      filename: 'multi-asset.h5lesson',
      title: '多素材',
      covers: ['PM-02', 'PM-07', 'PM-13', 'PM-16', 'PM-19', 'PM-20', 'PM-25'],
      data: multiAsset(),
    },
  ]
}
