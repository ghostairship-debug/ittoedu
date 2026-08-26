import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zipSync } from 'fflate'
import { componentContentSha256 } from '../src/shared/componentContentIntegrity'
import type { ComponentManifest } from '../src/shared/componentTypes'
import { courseProjectDocumentSchema } from '../src/shared/courseProjectSchema'
import type {
  ComponentLayerItem,
  CourseProjectDocument,
  FlowBlock,
  LayerItem,
  NativeLayerItem,
  RuntimeLayerItem,
  ScopedLayerItem,
} from '../src/shared/courseProjectTypes'
import type { InteractionRule } from '../src/shared/contracts/interaction-v1/types'
import type { AssetMeta } from '../src/shared/projectTypes'
import {
  createCourseProjectArchive,
  type CourseProjectArchiveData,
} from '../src/renderer/project/courseProjectArchive'

export const ARCHITECTURE_BASELINE_FIXTURE_MTIME = '2026-08-24T00:00:00.000Z'

export const ARCHITECTURE_BASELINE_FIXTURE_IDS = [
  'slide-heavy',
  'flow-heavy',
  'mixed-spatial',
] as const

export type ArchitectureBaselineFixtureId =
  typeof ARCHITECTURE_BASELINE_FIXTURE_IDS[number]

export interface ArchitectureBaselineFixtureSpec {
  id: ArchitectureBaselineFixtureId
  filename: `${ArchitectureBaselineFixtureId}.h5lesson`
  projectId: string
  capabilities: readonly string[]
}

export interface ArchitectureBaselineFixtureManifestEntry
  extends ArchitectureBaselineFixtureSpec {
  byteLength: number
  sha256: string
}

export interface ArchitectureBaselineFixtureManifest {
  schemaVersion: 1
  courseProjectSchemaVersion: 9
  deterministicMtime: string
  buildCommand: string
  checkCommand: string
  fixtures: ArchitectureBaselineFixtureManifestEntry[]
}

export interface ArchitectureBaselineFixtureBuild {
  manifest: ArchitectureBaselineFixtureManifest
  outputs: Readonly<Record<string, Uint8Array>>
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))

export const ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY = resolve(
  scriptDirectory,
  '..',
  'tests',
  'fixtures',
  'architecture-baseline',
)

const BUILD_COMMAND = 'npx tsx scripts/build-architecture-baseline-fixtures.ts'
const CHECK_COMMAND = `${BUILD_COMMAND} --check`
const COMPONENT_ID = 'com.ittoedu.baseline.evidence-panel'
const COMPONENT_VERSION = '4.0.0'

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

function ascii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index)
  }
}

/** A deterministic, browser-decodable 100 ms PCM WAV used by playback checks. */
function silentWavBytes(): Uint8Array {
  const sampleRate = 8_000
  const sampleCount = 800
  const bytes = new Uint8Array(44 + sampleCount)
  const view = new DataView(bytes.buffer)
  ascii(bytes, 0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  ascii(bytes, 8, 'WAVE')
  ascii(bytes, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  ascii(bytes, 36, 'data')
  view.setUint32(40, sampleCount, true)
  bytes.fill(128, 44)
  return bytes
}

const WAV_BYTES = silentWavBytes()

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

function textStyle() {
  return {
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize: 28,
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
    lineSpacing: 1.35,
    letterSpacing: 0,
    padding: 6,
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
  frame: NativeLayerItem['frame'] = {
    mode: 'absolute',
    x: 64,
    y: 48,
    width: 720,
    height: 80,
  },
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

function nativeImage(
  layerItemId: string,
  order: number,
  assetId: string,
  frame: NativeLayerItem['frame'],
): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, frame),
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
        cornerRadius: 18,
        feather: { amount: 0, mode: 'rectangle' },
        safeAreas: [],
      },
    },
  }
}

function nativeFormula(layerItemId: string, order: number): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, {
      mode: 'absolute',
      x: 80,
      y: 150,
      width: 560,
      height: 96,
    }),
    kind: 'native',
    content: {
      nativeType: 'formula',
      data: {
        formulaId: `${layerItemId}-formula`,
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
        style: { fontSize: 34, color: '#172033', align: 'left' },
      },
    },
  }
}

function nativeShape(
  layerItemId: string,
  order: number,
  frame: NativeLayerItem['frame'],
): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, frame),
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
          cornerRadius: 18,
          startArrow: 'none',
          endArrow: 'none',
        },
      },
    },
  }
}

function teacherController(layerItemId: string, order: number): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order, {
      mode: 'absolute',
      x: 190,
      y: 638,
      width: 900,
      height: 64,
    }),
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
          { id: 'previous', action: { type: 'scene.previous' }, label: '上一场景', visible: true },
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

function componentLayer(
  layerItemId: string,
  order: number,
  fallbackAssetId: string,
  props: Record<string, unknown>,
  frame: NativeLayerItem['frame'],
): ComponentLayerItem {
  return {
    ...layerBase(layerItemId, order, frame),
    kind: 'component',
    component: { packageId: COMPONENT_ID, version: COMPONENT_VERSION },
    props,
    staticFallbackAssetId: fallbackAssetId,
  }
}

function canvasRuntimeLayer(
  layerItemId: string,
  order: number,
  fallbackAssetId: string,
): RuntimeLayerItem {
  return {
    ...layerBase(layerItemId, order, {
      mode: 'absolute',
      x: 700,
      y: 360,
      width: 440,
      height: 220,
    }),
    hitPolicy: 'surface',
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'phaser',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create:function(){return {destroy:function(){}}}})',
      content: {
        values: { title: '判别式动态轴' },
        metadata: { title: { label: '标题', maxLength: 80 } },
      },
      assets: {},
      staticFallback: { assetId: fallbackAssetId, coverage: 'scene' },
    },
  }
}

function surfaceRuntimeLayer(
  layerItemId: string,
  order: number,
  fallbackAssetId: string,
  boundAssetId: string,
): RuntimeLayerItem {
  return {
    ...layerBase(layerItemId, order, {
      mode: 'absolute',
      x: 300,
      y: 280,
      width: 520,
      height: 280,
    }),
    hitPolicy: 'surface',
    kind: 'runtime',
    runtime: {
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'dom',
      source: 'CoursewareRuntime.define({protocol:"surface-runtime",runtimeApiVersion:3,create:function(){return {destroy:function(){}}}})',
      content: {
        values: { title: '空间观测仪' },
        metadata: { title: { label: '标题', maxLength: 80 } },
      },
      assets: { diagram: { assetId: boundAssetId } },
      staticFallback: { assetId: fallbackAssetId, coverage: 'surface' },
    },
  }
}

function scoped(
  item: LayerItem,
  visibility: ScopedLayerItem['visibility'] = { mode: 'all', locationIds: [] },
): ScopedLayerItem {
  return { item, visibility }
}

function imageAsset(id: string): AssetMeta {
  return {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}.png`,
    byteLength: PNG_BYTES.byteLength,
    width: 1,
    height: 1,
  }
}

function audioAsset(id: string): AssetMeta {
  return {
    id,
    filename: `${id}.wav`,
    mimeType: 'audio/wav',
    kind: 'audio',
    path: `assets/${id}.wav`,
    byteLength: WAV_BYTES.byteLength,
    duration: 0.1,
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
    createdAt: ARCHITECTURE_BASELINE_FIXTURE_MTIME,
    updatedAt: ARCHITECTURE_BASELINE_FIXTURE_MTIME,
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
        { id: 'text', label: '正文', color: '#172033' },
        { id: 'accent', label: '强调', color: '#2563eb' },
      ],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 0.7, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.25, fadeMs: 250 },
      },
    },
    playback: {
      controls: 'none',
      keyboardNavigation: true,
      presenter: {
        enabled: true,
        strategy: 'scene-navigation',
        additionalBindings: [],
      },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
    ...extras,
  }
}

function evidencePanelComponent(): {
  files: Record<string, Uint8Array>
  metadata: CourseProjectDocument['componentPackages'][string]
  componentFilesKey: string
} {
  const manifest: ComponentManifest = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    renderMode: 'dom',
    supportedScopes: ['scene', 'global'],
    id: COMPONENT_ID,
    name: '基线证据卡',
    version: COMPONENT_VERSION,
    description: '用于 ARCH-0 代表工程的可播放 DOM 组件。',
    entry: 'runtime.js',
    thumbnail: 'thumbnail.png',
    defaultSize: { width: 420, height: 220 },
    minSize: { width: 240, height: 140 },
    preserveAspectRatio: false,
    assets: {},
    defaultProps: {
      title: '基线证据',
      body: '组件包与实例数据分离。',
      accent: '#2563eb',
    },
    editor: {
      properties: [
        { key: 'title', label: '标题', type: 'text', maxLength: 80 },
        { key: 'body', label: '正文', type: 'textarea', maxLength: 500 },
        { key: 'accent', label: '强调色', type: 'color' },
      ],
    },
  }
  const runtimeSource = `(function(){
  window.CoursewareComponent.define({
    id:'${COMPONENT_ID}',runtimeApiVersion:4,
    create:function(ctx){
      if(ctx.renderMode!=='dom')throw new Error('baseline evidence panel requires DOM');
      var root=ctx.dom.root,props=ctx.props;
      var card=document.createElement('section');
      var title=document.createElement('h2');
      var body=document.createElement('p');
      card.style.cssText='box-sizing:border-box;width:100%;height:100%;padding:24px;border:3px solid #2563eb;border-radius:18px;background:#eff6ff;color:#172033;font-family:Microsoft YaHei,sans-serif';
      title.dataset.coursewareEditKey='title';title.dataset.coursewareEditLabel='标题';
      body.dataset.coursewareEditKey='body';body.dataset.coursewareEditLabel='正文';body.dataset.coursewareEditMultiline='true';
      card.append(title,body);root.replaceChildren(card);
      function render(){title.textContent=String(props.title||'');body.textContent=String(props.body||'');card.style.borderColor=String(props.accent||'#2563eb');}
      render();
      return{setMode:function(){},resize:function(){},updateProps:function(next){props=next;render();},setVisible:function(value){root.style.display=value?'':'none';},suspend:function(){},resume:function(){},prepareCapture:function(){render();},destroy:function(){root.replaceChildren();}};
    }
  });
})();`
  const files = {
    'manifest.json': encodeJson(manifest),
    'runtime.js': new TextEncoder().encode(runtimeSource),
    'thumbnail.png': PNG_BYTES,
  }
  /**
   * The exact `.h5component` bytes this synthetic package would have been
   * imported from. Provenance records the raw archive hash, while
   * `contentSha256` stays the packaging-independent content digest; the two
   * hashes cover different questions and must never be swapped.
   */
  const packageBytes = zipSync(files, {
    level: 6,
    mtime: ARCHITECTURE_BASELINE_FIXTURE_MTIME,
  })
  return {
    files,
    componentFilesKey: `${COMPONENT_ID}@${COMPONENT_VERSION}`,
    metadata: {
      packageId: COMPONENT_ID,
      version: COMPONENT_VERSION,
      name: manifest.name,
      manifestPath: `components/${COMPONENT_ID}@${COMPONENT_VERSION}/manifest.json`,
      runtimePath: `components/${COMPONENT_ID}@${COMPONENT_VERSION}/runtime.js`,
      thumbnailPath: `components/${COMPONENT_ID}@${COMPONENT_VERSION}/thumbnail.png`,
      contentSha256: componentContentSha256(files),
      sha256: sha256(packageBytes),
      importedAt: ARCHITECTURE_BASELINE_FIXTURE_MTIME,
      sourceLabel: `ARCH-0 synthetic fixture: ${COMPONENT_ID}@${COMPONENT_VERSION}`,
    },
  }
}

function sceneEnterRule(imageId: string, soundId: string): InteractionRule {
  return {
    id: 'slide-intro-enter-rule',
    name: '进入时显示图片并播放旁白',
    enabled: true,
    trigger: { type: 'scene.enter' },
    conditions: [],
    actions: [
      {
        id: 'slide-intro-image-enter',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'node.enter',
          nodeId: imageId,
          effect: 'fade',
          durationMs: 320,
          easing: 'ease-out',
        },
      },
      {
        id: 'slide-intro-audio-play',
        start: 'with-previous',
        delayMs: 0,
        action: { type: 'audio.play', soundId },
      },
    ],
  }
}

function slideHeavyArchive(): CourseProjectArchiveData {
  const component = evidencePanelComponent()
  const hero = 'slide-hero'
  const narration = 'slide-narration'
  const componentFallback = 'slide-component-fallback'
  const runtimeFallback = 'slide-runtime-fallback'
  const heroItem = nativeImage('slide-intro-hero', 120, hero, {
    mode: 'absolute',
    x: 80,
    y: 280,
    width: 520,
    height: 300,
  })
  heroItem.playbackInitialVisibility = 'hidden'
  const project = courseProjectDocumentSchema.parse({
    ...courseShell('arch-0-slide-heavy', 'ARCH-0 代表工程 · Slide-heavy', {
      assets: {
        [hero]: imageAsset(hero),
        [narration]: audioAsset(narration),
        [componentFallback]: imageAsset(componentFallback),
        [runtimeFallback]: imageAsset(runtimeFallback),
      },
      componentPackages: { [COMPONENT_ID]: component.metadata },
      media: {
        audio: {
          defaultMuted: false,
          masterVolume: 1,
          channelVolumes: { music: 0.7, narration: 1, sfx: 1, ui: 1, video: 1 },
          sounds: {
            [narration]: {
              id: narration,
              name: '开场旁白',
              assetId: narration,
              channel: 'narration',
              defaultVolume: 1,
              defaultLoop: false,
            },
          },
          narrationDucking: { enabled: true, musicVolume: 0.25, fadeMs: 250 },
        },
      },
      playback: {
        controls: 'canvas',
        keyboardNavigation: true,
        presenter: {
          enabled: true,
          strategy: 'scene-navigation',
          additionalBindings: [{
            id: 'binding-slide-next',
            command: 'next',
            key: 'ArrowDown',
            altKey: false,
            ctrlKey: false,
            shiftKey: false,
            metaKey: false,
          }],
        },
      },
      globalLayerItems: [
        scoped(nativeText('slide-global-banner', 10, '全课共享横幅', {
          mode: 'absolute', x: 40, y: 12, width: 420, height: 44,
        })),
        scoped(teacherController('slide-global-controller', 9_000)),
      ],
    }),
    locations: [
      {
        id: 'slide-location-intro',
        label: '导入·基础态',
        kind: 'slide-scene',
        surfaceId: 'slide-surface',
        sceneId: 'slide-scene-intro',
        stateId: 'slide-state-base',
      },
      {
        id: 'slide-location-evidence',
        label: '导入·证据态',
        kind: 'slide-scene',
        surfaceId: 'slide-surface',
        sceneId: 'slide-scene-intro',
        stateId: 'slide-state-evidence',
      },
      {
        id: 'slide-location-practice',
        label: '练习页',
        kind: 'slide-scene',
        surfaceId: 'slide-surface',
        sceneId: 'slide-scene-practice',
      },
      {
        id: 'slide-location-summary',
        label: '总结页',
        kind: 'slide-scene',
        surfaceId: 'slide-surface',
        sceneId: 'slide-scene-summary',
      },
    ],
    startLocationId: 'slide-location-intro',
    surfaces: [{
      id: 'slide-surface',
      title: '判别式演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [scoped(
        nativeText('slide-surface-watermark', 20, 'Slide Surface', {
          mode: 'absolute', x: 1010, y: 20, width: 220, height: 42,
        }),
        { mode: 'include', locationIds: ['slide-location-intro', 'slide-location-evidence'] },
      )],
      scenes: [
        {
          id: 'slide-scene-intro',
          name: '判别式导入',
          backgroundColor: '#ffffff',
          layerItems: [
            nativeText('slide-intro-title', 100, '判别式决定一元二次方程的根'),
            nativeFormula('slide-intro-formula', 110),
            heroItem,
            nativeShape('slide-intro-callout', 130, {
              mode: 'absolute', x: 650, y: 140, width: 500, height: 120,
            }),
            componentLayer(
              'slide-intro-component',
              140,
              componentFallback,
              { title: '状态证据', body: '组件 props 在呈现态中可覆盖。', accent: '#2563eb' },
              { mode: 'absolute', x: 650, y: 280, width: 460, height: 220 },
            ),
            canvasRuntimeLayer('slide-intro-runtime', 150, runtimeFallback),
          ],
          presentation: {
            initialStateId: 'slide-state-base',
            thumbnailStateId: 'slide-state-evidence',
            states: [
              {
                id: 'slide-state-base',
                name: '基础态',
                layerItemOverrides: {
                  'slide-intro-hero': { visible: false },
                  'slide-intro-component': { visible: false },
                },
              },
              {
                id: 'slide-state-evidence',
                name: '证据态',
                description: '显示图片、组件和可编辑文案。',
                backgroundColor: '#eff6ff',
                layerItemOverrides: {
                  'slide-intro-hero': { visible: true, opacity: 0.95 },
                  'slide-intro-component': {
                    visible: true,
                    componentProps: {
                      title: '证据已展开',
                      body: '状态、媒体、组件与 Runtime 共存。',
                    },
                  },
                },
              },
            ],
          },
          interactions: [sceneEnterRule('slide-intro-hero', narration)],
        },
        {
          id: 'slide-scene-practice',
          name: '练习',
          backgroundColor: '#f8fafc',
          layerItems: [
            nativeText('slide-practice-title', 100, '计算 Δ 并判断根的情况'),
            componentLayer(
              'slide-practice-component',
              110,
              componentFallback,
              { title: '课堂检查', body: '请说明判断过程。', accent: '#0f766e' },
              { mode: 'absolute', x: 360, y: 210, width: 560, height: 280 },
            ),
          ],
          interactions: [],
        },
        {
          id: 'slide-scene-summary',
          name: '总结',
          backgroundColor: '#f0fdf4',
          layerItems: [
            nativeText('slide-summary-title', 100, 'Δ > 0、Δ = 0、Δ < 0 对应三种结论'),
            nativeImage('slide-summary-hero', 110, hero, {
              mode: 'absolute', x: 420, y: 220, width: 440, height: 260,
            }),
          ],
          interactions: [],
        },
      ],
    }],
  })

  return {
    project,
    assetFiles: {
      [hero]: PNG_BYTES,
      [narration]: WAV_BYTES,
      [componentFallback]: PNG_BYTES,
      [runtimeFallback]: PNG_BYTES,
    },
    componentFiles: { [component.componentFilesKey]: component.files },
  }
}

function flowFormulaBlock(): Extract<FlowBlock, { type: 'formula' }> {
  return {
    id: 'flow-formula',
    type: 'formula',
    formulaId: 'flow-delta-formula',
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
  }
}

function flowHeavyArchive(): CourseProjectArchiveData {
  const component = evidencePanelComponent()
  const figure = 'flow-figure'
  const componentFallback = 'flow-component-fallback'
  const blocks: FlowBlock[] = [
    {
      id: 'flow-heading',
      type: 'heading',
      level: 1,
      text: '一元二次方程的判别式',
      runs: [{ start: 0, end: 8, style: { bold: true, color: '#1d4ed8' } }],
    },
    {
      id: 'flow-ime-paragraph',
      type: 'paragraph',
      text: '中文输入法（IME）验证：春风又绿江南岸，连续编辑不拆分组合文本。',
      runs: [{ start: 0, end: 6, style: { bold: true, highlightColor: '#fef3c7' } }],
      textAlign: 'left',
      lineSpacing: 1.6,
    },
    {
      id: 'flow-list',
      type: 'list',
      ordered: true,
      items: [
        { id: 'flow-list-item-1', text: '识别 a、b、c' },
        { id: 'flow-list-item-2', text: '计算 Δ = b² − 4ac' },
        { id: 'flow-list-item-3', text: '根据符号得出结论' },
      ],
    },
    {
      id: 'flow-quote',
      type: 'quote',
      text: '数形结合帮助我们解释代数结论。',
      citation: '课堂小结',
    },
    { id: 'flow-divider', type: 'divider' },
    {
      id: 'flow-media',
      type: 'media',
      assetId: figure,
      mediaKind: 'image',
      altText: '抛物线与 x 轴交点示意图',
      caption: '判别式与交点数量对应',
      layout: 'wide',
      wrap: 'none',
    },
    {
      id: 'flow-table',
      type: 'table',
      caption: '判别式对照表',
      columns: [
        { id: 'flow-col-condition', header: '条件' },
        { id: 'flow-col-roots', header: '实数根' },
        { id: 'flow-col-graph', header: '图像' },
      ],
      rows: [
        {
          id: 'flow-row-positive',
          cells: {
            'flow-col-condition': 'Δ > 0',
            'flow-col-roots': '两个不相等的实数根',
            'flow-col-graph': '与 x 轴有两个交点',
          },
        },
        {
          id: 'flow-row-zero',
          cells: {
            'flow-col-condition': 'Δ = 0',
            'flow-col-roots': { text: '两个相等的实数根', runs: [{ start: 2, end: 4, style: { bold: true } }] },
            'flow-col-graph': '与 x 轴相切',
          },
        },
      ],
    },
    flowFormulaBlock(),
    {
      id: 'flow-code',
      type: 'code',
      language: 'typescript',
      code: 'const delta = b ** 2 - 4 * a * c\nconst rootKind = delta > 0 ? 2 : delta === 0 ? 1 : 0',
    },
    {
      id: 'flow-callout',
      type: 'callout',
      tone: 'warning',
      title: '常见错误',
      body: '不要遗漏 b 的平方，也不要忽略 a 不等于 0 的前提。',
    },
    {
      id: 'flow-section',
      type: 'section',
      title: '进阶推导',
      collapsedByDefault: false,
      blocks: [
        {
          id: 'flow-section-paragraph',
          type: 'paragraph',
          text: '从求根公式的根号内部可得判别式的来源。',
        },
      ],
    },
    {
      id: 'flow-component',
      type: 'component',
      component: { packageId: COMPONENT_ID, version: COMPONENT_VERSION },
      props: {
        title: '流式组件块',
        body: 'FlowComponentBlock 保持正文顺序，不伪装成 LayerItem。',
        accent: '#7c3aed',
      },
      staticFallbackAssetId: componentFallback,
      wrap: 'right',
    },
  ]

  const viewportNote = nativeText('flow-surface-note', 20, '讲义浮层（viewport）', {
    mode: 'absolute', x: 930, y: 32, width: 300, height: 52,
  })
  viewportNote.paperSpace = 'viewport'

  const project = courseProjectDocumentSchema.parse({
    ...courseShell('arch-0-flow-heavy', 'ARCH-0 代表工程 · Flow-heavy', {
      assets: {
        [figure]: imageAsset(figure),
        [componentFallback]: imageAsset(componentFallback),
      },
      componentPackages: { [COMPONENT_ID]: component.metadata },
    }),
    locations: [
      {
        id: 'flow-location-start',
        label: '讲义开始',
        kind: 'flow-block',
        surfaceId: 'flow-surface',
        blockId: 'flow-heading',
      },
      {
        id: 'flow-location-formula',
        label: '公式与表格',
        kind: 'flow-block',
        surfaceId: 'flow-surface',
        blockId: 'flow-formula',
      },
      {
        id: 'flow-location-component',
        label: '互动证据卡',
        kind: 'flow-block',
        surfaceId: 'flow-surface',
        blockId: 'flow-component',
      },
    ],
    startLocationId: 'flow-location-start',
    surfaces: [{
      id: 'flow-surface',
      title: '判别式流式讲义',
      type: 'flow',
      backgroundColor: '#fffdf7',
      surfaceLayerItems: [scoped(viewportNote)],
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      blocks,
    }],
  })

  return {
    project,
    assetFiles: {
      [figure]: PNG_BYTES,
      [componentFallback]: PNG_BYTES,
    },
    componentFiles: { [component.componentFilesKey]: component.files },
  }
}

function mixedSpatialArchive(): CourseProjectArchiveData {
  const component = evidencePanelComponent()
  const figure = 'mixed-figure'
  const componentFallback = 'mixed-component-fallback'
  const runtimeFallback = 'mixed-runtime-fallback'
  const slideShared = nativeText('mixed-slide-shared', 20, 'Slide 共享层', {
    mode: 'absolute', x: 920, y: 20, width: 280, height: 48,
  })
  const flowShared = nativeText('mixed-flow-shared', 30, 'Flow 视口共享层', {
    mode: 'absolute', x: 900, y: 30, width: 320, height: 48,
  })
  flowShared.paperSpace = 'viewport'
  const spatialShared = nativeText('mixed-spatial-shared', 40, 'Spatial 共享 HUD', {
    mode: 'absolute', x: 32, y: 32, width: 320, height: 52,
  })
  const project = courseProjectDocumentSchema.parse({
    ...courseShell('arch-0-mixed-spatial', 'ARCH-0 代表工程 · Mixed/Spatial', {
      assets: {
        [figure]: imageAsset(figure),
        [componentFallback]: imageAsset(componentFallback),
        [runtimeFallback]: imageAsset(runtimeFallback),
      },
      componentPackages: { [COMPONENT_ID]: component.metadata },
      playback: {
        controls: 'canvas',
        keyboardNavigation: true,
        presenter: {
          enabled: true,
          strategy: 'scene-navigation',
          additionalBindings: [],
        },
      },
      globalLayerItems: [
        scoped(nativeText('mixed-global-banner', 10, '三表面共享横幅', {
          mode: 'absolute', x: 40, y: 12, width: 480, height: 44,
        })),
        scoped(teacherController('mixed-global-controller', 9_000)),
      ],
    }),
    locations: [
      {
        id: 'mixed-location-slide',
        label: '问题导入',
        kind: 'slide-scene',
        surfaceId: 'mixed-slide-surface',
        sceneId: 'mixed-slide-scene',
      },
      {
        id: 'mixed-location-flow',
        label: '证据讲义',
        kind: 'flow-block',
        surfaceId: 'mixed-flow-surface',
        blockId: 'mixed-flow-heading',
      },
      {
        id: 'mixed-location-spatial-home',
        label: '空间总览',
        kind: 'spatial-camera',
        surfaceId: 'mixed-spatial-surface',
        cameraFrameId: 'mixed-camera-home',
      },
      {
        id: 'mixed-location-spatial-detail',
        label: '空间细节',
        kind: 'spatial-camera',
        surfaceId: 'mixed-spatial-surface',
        cameraFrameId: 'mixed-camera-detail',
      },
    ],
    startLocationId: 'mixed-location-slide',
    surfaces: [
      {
        id: 'mixed-slide-surface',
        title: '演示导入',
        type: 'slide',
        canvas: { width: 1280, height: 720 },
        surfaceLayerItems: [scoped(slideShared)],
        scenes: [{
          id: 'mixed-slide-scene',
          name: '问题导入',
          backgroundColor: '#ffffff',
          layerItems: [
            nativeText('mixed-slide-title', 100, '一次函数与二次函数如何共同解释运动？'),
            nativeImage('mixed-slide-figure', 110, figure, {
              mode: 'absolute', x: 360, y: 210, width: 560, height: 320,
            }),
          ],
          interactions: [],
        }],
      },
      {
        id: 'mixed-flow-surface',
        title: '证据讲义',
        type: 'flow',
        backgroundColor: '#f8fafc',
        surfaceLayerItems: [scoped(flowShared)],
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        blocks: [
          { id: 'mixed-flow-heading', type: 'heading', level: 1, text: '证据链' },
          { id: 'mixed-flow-paragraph', type: 'paragraph', text: '先观察图像，再进入空间画布探索节点关系。' },
          {
            id: 'mixed-flow-media',
            type: 'media',
            assetId: figure,
            mediaKind: 'image',
            altText: '混合课件证据图',
            layout: 'content-width',
          },
        ],
      },
      {
        id: 'mixed-spatial-surface',
        title: '空间探索',
        type: 'spatial-2d',
        backgroundColor: '#f1f5f9',
        surfaceLayerItems: [scoped(spatialShared)],
        world: {
          bounds: { mode: 'infinite' },
          layerItems: [
            nativeText('mixed-spatial-node-a', 100, '起点：已知条件', {
              mode: 'absolute', x: -420, y: -140, width: 320, height: 100,
            }),
            nativeText('mixed-spatial-node-b', 110, '终点：推导结论', {
              mode: 'absolute', x: 360, y: 180, width: 320, height: 100,
            }),
            componentLayer(
              'mixed-spatial-component',
              120,
              componentFallback,
              { title: '空间证据卡', body: '组件与世界节点共存。', accent: '#c2410c' },
              { mode: 'absolute', x: -120, y: -20, width: 420, height: 220 },
            ),
            surfaceRuntimeLayer(
              'mixed-spatial-runtime',
              130,
              runtimeFallback,
              figure,
            ),
          ],
          paths: [{
            id: 'mixed-spatial-path',
            name: '探索路径',
            layerItemIds: ['mixed-spatial-node-a', 'mixed-spatial-component', 'mixed-spatial-node-b'],
            style: { color: '#2563eb', width: 4, dash: 'dashed' },
          }],
          relations: [{
            id: 'mixed-spatial-relation',
            sourceLayerItemId: 'mixed-spatial-node-a',
            targetLayerItemId: 'mixed-spatial-node-b',
            label: '条件推导结论',
            kind: 'arrow',
          }],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 0.8 },
          frames: [
            { id: 'mixed-camera-home', name: '总览', x: 0, y: 0, zoom: 0.8 },
            { id: 'mixed-camera-detail', name: '组件与 Runtime', x: 100, y: 80, zoom: 1.5 },
          ],
        },
        semanticZoom: [{
          id: 'mixed-spatial-semantic-zoom',
          layerItemIds: ['mixed-spatial-component', 'mixed-spatial-runtime'],
          minZoom: 1.1,
          maxZoom: 8,
          visible: true,
        }],
      },
    ],
    mixedPrintPlan: {
      pageSize: 'surface-native',
      orientation: 'auto',
      entries: [
        {
          id: 'mixed-print-slide',
          kind: 'slide-scenes',
          surfaceId: 'mixed-slide-surface',
          sceneIds: ['mixed-slide-scene'],
        },
        {
          id: 'mixed-print-flow',
          kind: 'flow-document',
          surfaceId: 'mixed-flow-surface',
        },
        {
          id: 'mixed-print-spatial',
          kind: 'spatial-frames',
          surfaceId: 'mixed-spatial-surface',
          cameraFrameIds: ['mixed-camera-home', 'mixed-camera-detail'],
        },
      ],
    },
  })

  return {
    project,
    assetFiles: {
      [figure]: PNG_BYTES,
      [componentFallback]: PNG_BYTES,
      [runtimeFallback]: PNG_BYTES,
    },
    componentFiles: { [component.componentFilesKey]: component.files },
  }
}

const definitions: ReadonlyArray<
  ArchitectureBaselineFixtureSpec & { build(): CourseProjectArchiveData }
> = [
  {
    id: 'slide-heavy',
    filename: 'slide-heavy.h5lesson',
    projectId: 'arch-0-slide-heavy',
    capabilities: [
      'slide-scenes-and-presentation-states',
      'unified-global-surface-scene-layers',
      'image-audio-component-canvas-runtime',
      'teacher-controller-and-scene-interaction',
      'published-v2-static-export-inputs',
    ],
    build: slideHeavyArchive,
  },
  {
    id: 'flow-heavy',
    filename: 'flow-heavy.h5lesson',
    projectId: 'arch-0-flow-heavy',
    capabilities: [
      'flow-semantic-blocks-and-rich-text',
      'ime-composition-probe-content',
      'formula-table-code-section-media',
      'flow-component-block-with-fallback',
      'flow-print-and-docx-inputs',
    ],
    build: flowHeavyArchive,
  },
  {
    id: 'mixed-spatial',
    filename: 'mixed-spatial.h5lesson',
    projectId: 'arch-0-mixed-spatial',
    capabilities: [
      'slide-flow-spatial-surfaces-and-print-plan',
      'global-surface-shared-and-teacher-controller',
      'spatial-camera-path-relation-semantic-zoom',
      'spatial-component-and-surface-runtime',
      'published-v2-mixed-navigation-inputs',
    ],
    build: mixedSpatialArchive,
  },
]

export const ARCHITECTURE_BASELINE_FIXTURE_SPECS:
ReadonlyArray<ArchitectureBaselineFixtureSpec> = definitions.map(({ build: _build, ...spec }) => spec)

export function buildArchitectureBaselineFixtureOutputs(): ArchitectureBaselineFixtureBuild {
  const archives: Record<string, Uint8Array> = {}
  const fixtures: ArchitectureBaselineFixtureManifestEntry[] = definitions.map((definition) => {
    const data = definition.build()
    if (data.project.schemaVersion !== 9 || data.project.id !== definition.projectId) {
      throw new Error(`Fixture ${definition.id} did not build the declared legal V9 project`)
    }
    const bytes = createCourseProjectArchive(data, {
      mtime: ARCHITECTURE_BASELINE_FIXTURE_MTIME,
    })
    archives[definition.filename] = bytes
    return {
      id: definition.id,
      filename: definition.filename,
      projectId: definition.projectId,
      capabilities: [...definition.capabilities],
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    }
  })
  const manifest: ArchitectureBaselineFixtureManifest = {
    schemaVersion: 1,
    courseProjectSchemaVersion: 9,
    deterministicMtime: ARCHITECTURE_BASELINE_FIXTURE_MTIME,
    buildCommand: BUILD_COMMAND,
    checkCommand: CHECK_COMMAND,
    fixtures,
  }
  return {
    manifest,
    outputs: {
      ...archives,
      'manifest.json': encodeJson(manifest),
    },
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

function checkOutputs(build: ArchitectureBaselineFixtureBuild): void {
  if (!existsSync(ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY)) {
    throw new Error(`Missing fixture directory: ${ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY}`)
  }
  const expectedNames = Object.keys(build.outputs).sort()
  const actualNames = readdirSync(ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Fixture output set is stale; expected ${expectedNames.join(', ')}, found ${actualNames.join(', ')}`,
    )
  }
  for (const filename of expectedNames) {
    const expected = build.outputs[filename]
    if (!expected) throw new Error(`Missing expected bytes for ${filename}`)
    const actual = new Uint8Array(readFileSync(
      join(ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY, filename),
    ))
    if (!equalBytes(actual, expected)) {
      throw new Error(`Fixture output is stale: ${filename}`)
    }
    console.log(`OK\t${filename}\t${actual.byteLength} bytes\tsha256:${sha256(actual)}`)
  }
}

function writeOutputs(build: ArchitectureBaselineFixtureBuild): void {
  mkdirSync(ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY, { recursive: true })
  for (const [filename, bytes] of Object.entries(build.outputs)) {
    writeFileSync(join(ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY, filename), bytes)
    console.log(`WROTE\t${filename}\t${bytes.byteLength} bytes\tsha256:${sha256(bytes)}`)
  }
}

function main(argv: readonly string[]): void {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--check')) {
    throw new Error(`Usage: ${BUILD_COMMAND} [--check]`)
  }
  const build = buildArchitectureBaselineFixtureOutputs()
  if (argv[0] === '--check') checkOutputs(build)
  else writeOutputs(build)
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
