import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { build as viteBuild } from 'vite'
import { componentManifestSchema } from '../src/shared/componentSchema'
import type { ComponentManifest } from '../src/shared/componentTypes'
import type { RuntimeDocument } from '../src/shared/runtimeTypes'
import { courseProjectDocumentSchema } from '../src/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseRuntimeDefinition,
} from '../src/shared/courseProjectTypes'
import { importComponentPackage } from '../src/renderer/components/importComponentPackage'
// Teaches the export builders where this host's font bytes are. Without it the
// generated artifacts silently ship without the bundled families they ask for.
import '../src/renderer/export/bundledFontEmbedSourceNode'
import { addCourseScene } from '../src/renderer/course/courseLocationCommands'
import {
  openSlideAuthoringSession,
  type SlideAuthoringSession,
} from '../src/renderer/course/slideAuthoringBackend'
import type { SlideCommandResult } from '../src/renderer/course/slideEditorCommands'
import {
  addSlideComponentLayer,
  addSlideRuntimeLayer,
  addSlideShapeLayer,
  addSlideTextLayer,
  upsertSlideInteractionRule,
} from '../src/renderer/course/v9SlideContentCommands'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseV2Payload,
} from '../src/renderer/export/course'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../src/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '../src/renderer/project/createCourseProject'
import {
  checkTrackedExampleOutputs,
  createTimezoneStableZipMtime,
  normalizeLineEndings,
  type GeneratedExampleOutputs,
} from './exampleGenerationBoundary'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const rootPackageJsonPath = path.join(projectRoot, 'package.json')
const installedThreePackageJsonPath = path.join(projectRoot, 'node_modules', 'three', 'package.json')
const installedThreeLicensePath = path.join(projectRoot, 'node_modules', 'three', 'LICENSE')
const exampleDirectory = path.join(projectRoot, 'examples', 'render-host-benchmark')
const runtimeDirectory = path.join(exampleDirectory, 'runtimes')
const componentRoot = path.join(exampleDirectory, 'components')
const playerBundlePath = path.join(projectRoot, 'dist-player', 'player.iife.js')
const threeEntryPath = path.join(runtimeDirectory, 'three-runtime.entry.ts')
export const RENDER_HOST_BENCHMARK_OUTPUT_PATHS = {
  threeRuntime: 'runtimes/three-runtime.js',
  phaserFallback: 'assets/phaser-runtime-fallback.svg',
  threeFallback: 'assets/three-runtime-fallback.svg',
  projectV9: 'project-v9.json',
  publishedV2: 'published-v2.json',
  lessonV9: 'render-host-benchmark-v9.h5lesson',
  htmlV2: 'render-host-benchmark-v2.html',
  noticesV9: 'THIRD_PARTY_NOTICES_V9.md',
} as const
/** 写进工程数据的业务时刻（`createdAt`/`updatedAt`）。 */
const reproducibleTimestamp = new Date('2026-07-23T00:00:00.000Z')
const timestamp = reproducibleTimestamp.toISOString()
/** 只用于 ZIP 封装的时间戳，与上面的业务时刻分开。 */
const archiveZipMtime = createTimezoneStableZipMtime(timestamp)
const MAX_RUNTIME_BYTES = 2 * 1024 * 1024
export const RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION = '4.0.0-v9-probe.1'

interface ThreePackageMetadata {
  version: string
  licenseText: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadThreePackageMetadata(): Promise<ThreePackageMetadata> {
  const [rootPackageText, installedPackageText, licenseText] = await Promise.all([
    fs.readFile(rootPackageJsonPath, 'utf8'),
    fs.readFile(installedThreePackageJsonPath, 'utf8'),
    fs.readFile(installedThreeLicensePath, 'utf8').then(normalizeLineEndings),
  ])
  const rootPackage = JSON.parse(rootPackageText) as unknown
  const installedPackage = JSON.parse(installedPackageText) as unknown
  const declaredVersion = isRecord(rootPackage) && isRecord(rootPackage.devDependencies)
    ? rootPackage.devDependencies.three
    : undefined
  const installedVersion = isRecord(installedPackage) ? installedPackage.version : undefined
  const installedLicense = isRecord(installedPackage) ? installedPackage.license : undefined

  if (typeof declaredVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(declaredVersion)) {
    throw new Error('package.json 必须用精确版本固定 devDependencies.three')
  }
  if (installedVersion !== declaredVersion) {
    throw new Error(`Three.js 安装版本 ${String(installedVersion)} 与 package.json ${declaredVersion} 不一致`)
  }
  if (installedLicense !== 'MIT') {
    throw new Error(`Three.js 许可证应为 MIT，实际为 ${String(installedLicense)}`)
  }

  return { version: declaredVersion, licenseText }
}

const phaserContent: RuntimeDocument['content'] = {
  values: {
    panelTitle: 'Runtime API 2 · Phaser 一次性互动',
    instruction: '点击右侧轨道改变相位。这类粒子、拖拽与程序动画不需要为了接入编辑器而组件化。',
    readyStatus: '轨道系统已就绪，等待点击',
    activatedStatus: '已从{direction}侧施加脉冲',
    leftLabel: '左',
    rightLabel: '右',
    accentColor: '#38bdf8',
  },
  metadata: {
    panelTitle: { label: 'Phaser 面板标题', maxLength: 80 },
    instruction: { label: 'Phaser 交互说明', multiline: true, maxLength: 220 },
    readyStatus: { label: 'Phaser 初始状态', maxLength: 80 },
    activatedStatus: { label: 'Phaser 交互状态模板', maxLength: 80 },
  },
}

const threeContent: RuntimeDocument['content'] = {
  values: {
    ariaLabel: 'Three.js 真三维地球和月球演示',
    canvasLabel: '可拖动旋转、可滚轮缩放的三维地球',
    panelTitle: 'Runtime API 2 · Three.js 真 3D 增强',
    instruction: '拖动地球改变观察角度，滚轮缩放。Three.js 已被预打包到本运行时，Player 核心不导入它。',
    resetLabel: '恢复视角',
    readyStatus: '地球自转中 · 可拖动或缩放',
    draggingStatus: '正在旋转观察视角',
    rotatedStatus: '视角已更新',
    zoomedStatus: '观察距离已更新',
    resetStatus: '已恢复默认观察视角',
    suspendedStatus: '三维更新已暂停',
    contextLostStatus: 'WebGL 上下文已丢失，等待恢复',
    contextRestoredStatus: 'WebGL 上下文已恢复',
  },
  metadata: {
    ariaLabel: { label: '3D 区域无障碍名称', maxLength: 100 },
    canvasLabel: { label: '3D Canvas 无障碍名称', maxLength: 120 },
    panelTitle: { label: 'Three.js 面板标题', maxLength: 80 },
    instruction: { label: 'Three.js 交互说明', multiline: true, maxLength: 260 },
    resetLabel: { label: '恢复按钮', maxLength: 30 },
  },
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function phaserFallbackSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect x="62" y="122" width="1156" height="432" rx="30" fill="#082f49" stroke="#38bdf8" stroke-width="2"/>
  <text x="92" y="176" fill="#e0f2fe" font-family="Microsoft YaHei,sans-serif" font-size="24" font-weight="700">${xml(phaserContent.values.panelTitle ?? '')}</text>
  <ellipse cx="874" cy="338" rx="245" ry="118" fill="none" stroke="#7dd3fc" stroke-width="3" opacity=".65"/>
  <circle cx="874" cy="338" r="38" fill="#fef08a"/>
  <circle cx="1080" cy="402" r="25" fill="#38bdf8"/>
</svg>\n`
}

function threeFallbackSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><radialGradient id="earth" cx="34%" cy="28%"><stop stop-color="#93c5fd"/><stop offset=".48" stop-color="#2563eb"/><stop offset="1" stop-color="#082f49"/></radialGradient></defs>
  <rect x="62" y="122" width="1156" height="432" rx="30" fill="#0f172a" stroke="#818cf8" stroke-width="2"/>
  <text x="88" y="174" fill="#e0e7ff" font-family="Microsoft YaHei,sans-serif" font-size="24" font-weight="700">${xml(threeContent.values.panelTitle ?? '')}</text>
  <circle cx="870" cy="344" r="148" fill="url(#earth)" stroke="#bfdbfe" stroke-opacity=".5"/>
  <ellipse cx="870" cy="344" rx="260" ry="98" fill="none" stroke="#a5b4fc" stroke-width="3" opacity=".55" transform="rotate(-18 870 344)"/>
  <circle cx="1088" cy="272" r="31" fill="#dbeafe"/>
</svg>\n`
}

function validateRuntimeDefinition(source: string, label: string): void {
  let definition: unknown
  const api = {
    define(candidate: unknown) {
      if (definition !== undefined) throw new Error(`${label} 重复注册`)
      definition = candidate
    },
  }
  const runtimeWindow = { CoursewareRuntime: api }
  const runtimeGlobal = { CoursewareRuntime: api }
  const execute = new Function(
    'window',
    'globalThis',
    'CoursewareRuntime',
    `"use strict";\n${source}`,
  ) as (windowValue: typeof runtimeWindow, globalValue: typeof runtimeGlobal, apiValue: typeof api) => void
  execute(runtimeWindow, runtimeGlobal, api)
  if (
    typeof definition !== 'object' ||
    definition === null ||
    Reflect.get(definition, 'runtimeApiVersion') !== 2 ||
    typeof Reflect.get(definition, 'create') !== 'function'
  ) {
    throw new Error(`${label} 未注册有效的 Runtime API 2 定义`)
  }
}

function validateComponentDefinition(source: string, manifest: ComponentManifest): void {
  let definition: unknown
  const runtimeWindow = {
    CoursewareComponent: {
      define(candidate: unknown) {
        if (definition !== undefined) throw new Error('组件 runtime 重复注册')
        definition = candidate
      },
    },
  }
  const execute = new Function('window', `"use strict";\n${source}`) as (
    value: typeof runtimeWindow,
  ) => void
  execute(runtimeWindow)
  if (
    typeof definition !== 'object' ||
    definition === null ||
    Reflect.get(definition, 'id') !== manifest.id ||
    Reflect.get(definition, 'runtimeApiVersion') !== manifest.runtimeApiVersion ||
    typeof Reflect.get(definition, 'create') !== 'function'
  ) {
    throw new Error(`组件“${manifest.id}”runtime 注册与 manifest 不一致`)
  }
}

function assertOfflineBundle(source: string, label: string): void {
  const bytes = new TextEncoder().encode(source).byteLength
  if (bytes >= MAX_RUNTIME_BYTES) {
    throw new Error(`${label} 超过 2 MiB Runtime 上限：${bytes} bytes`)
  }
  if (/(^|[;\n\r])\s*import\s*(?:[(\s{*]|["'])/m.test(source)) {
    throw new Error(`${label} 仍包含 import`)
  }
  if (/(^|[;\n\r])\s*export\s+(?:default|const|let|var|function|class|\{|\*)/m.test(source)) {
    throw new Error(`${label} 仍包含 export`)
  }
  if (/\brequire\s*\(/.test(source)) {
    throw new Error(`${label} 仍包含 require`)
  }
}

async function bundleThreeRuntime(): Promise<string> {
  const result = await viteBuild({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: runtimeDirectory,
      emptyOutDir: false,
      write: false,
      copyPublicDir: false,
      sourcemap: false,
      minify: 'esbuild',
      lib: {
        entry: threeEntryPath,
        name: 'RenderHostThreeRuntime',
        formats: ['iife'],
        fileName: () => 'three-runtime.js',
      },
    },
  })
  const candidates = (Array.isArray(result) ? result : [result]).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || !('output' in entry)) return []
    const output = Reflect.get(entry, 'output')
    return Array.isArray(output) ? output : []
  })
  const chunk = candidates.find((entry) => (
    typeof entry === 'object'
    && entry !== null
    && Reflect.get(entry, 'type') === 'chunk'
    && Reflect.get(entry, 'fileName') === 'three-runtime.js'
    && typeof Reflect.get(entry, 'code') === 'string'
  ))
  if (!chunk || typeof chunk !== 'object') {
    throw new Error('Three.js 场景运行时打包后缺少 three-runtime.js')
  }
  const source = Reflect.get(chunk, 'code') as string
  assertOfflineBundle(source, 'Three.js 场景运行时')
  validateRuntimeDefinition(source, 'Three.js 场景运行时')
  return source
}

interface LoadedComponent {
  data: ReturnType<typeof importComponentPackage>
}

function withPhaserMeterGenerationProbe(source: string): string {
  const createMarker = '      var scene = ctx.phaser.scene'
  const destroyMarker = `        destroy: function () {
          hit.off('pointerdown', onActivate)`
  if (!source.includes(createMarker) || !source.includes(destroyMarker)) {
    throw new Error('V9 Phaser 仪表 generation probe 注入点缺失')
  }
  return source
    .replace(createMarker, `      var generationProbe = window.__renderHostPhaserMeterGenerationProbe
      if (!generationProbe) {
        generationProbe = { creates: 0, destroys: 0 }
        window.__renderHostPhaserMeterGenerationProbe = generationProbe
      }
      generationProbe.creates += 1
${createMarker}`)
    .replace(destroyMarker, `        destroy: function () {
          generationProbe.destroys += 1
          hit.off('pointerdown', onActivate)`)
}

async function loadComponent(
  directoryName: string,
  options: {
    version?: string
    transformRuntimeSource?: (source: string) => string
  } = {},
): Promise<LoadedComponent> {
  const directory = path.join(componentRoot, directoryName)
  const manifestText = await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')
  const sourceManifest = componentManifestSchema.parse(JSON.parse(manifestText) as unknown)
  const manifest = componentManifestSchema.parse({
    ...sourceManifest,
    version: options.version ?? sourceManifest.version,
  })
  const runtimeSource = (options.transformRuntimeSource ?? ((source) => source))(await fs.readFile(
    path.join(directory, manifest.entry),
    'utf8',
  ).then(normalizeLineEndings))
  validateComponentDefinition(runtimeSource, manifest)
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    [manifest.entry]: strToU8(runtimeSource),
  }
  if (manifest.thumbnail !== undefined) {
    files[manifest.thumbnail] = await fs.readFile(path.join(directory, manifest.thumbnail))
  }
  const archive = zipSync(files, { level: 6, mtime: archiveZipMtime })
  return {
    data: importComponentPackage(archive, {
      expectedId: manifest.id,
      expectedVersion: manifest.version,
    }),
  }
}

const v9SceneIds = [
  'scene_native_nodes_v9',
  'scene_runtime_phaser_v9',
  'scene_runtime_three_v9',
  'scene_component_v4_dom_v9',
  'scene_component_v4_phaser_v9',
] as const

function requireCourseLocationResult(
  result: ReturnType<typeof addCourseScene>,
  label: string,
): CourseProjectDocument {
  if (!result.ok) throw new Error(`${label}失败：${result.reason}`)
  return result.project
}

function requireSlideCommand(
  result: SlideCommandResult,
  label: string,
): SlideAuthoringSession {
  if (!result.ok || !result.nextSession) {
    throw new Error(`${label}失败：${result.reason ?? '命令未返回下一会话'}`)
  }
  return result.nextSession
}

function canonicalizeBenchmarkSceneIds(
  input: CourseProjectDocument,
): CourseProjectDocument {
  const project = structuredClone(input)
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide' || surface.scenes.length !== v9SceneIds.length) {
    throw new Error('V9 基准必须恰好包含一个五页 Slide 表面')
  }
  const replacements = new Map<string, string>()
  surface.scenes.forEach((scene, index) => {
    const nextId = v9SceneIds[index]
    if (!nextId) throw new Error('V9 基准场景 ID 缺失')
    replacements.set(scene.id, nextId)
    scene.id = nextId
    scene.name = [
      '01 纯原生节点',
      '02 API2 Phaser 运行时',
      '03 API2 Three.js 运行时',
      '04 V4 DOM 表格组件',
      '05 V4 Phaser 仪表组件',
    ][index]!
    scene.backgroundColor = ['#071a2b', '#020617', '#0f172a', '#052e2b', '#1e1b4b'][index]!
  })
  project.locations.forEach((location) => {
    if (location.kind !== 'slide-scene') return
    const nextId = replacements.get(location.sceneId)
    if (!nextId) return
    const priorId = location.id
    location.sceneId = nextId
    if (location.stateId === undefined && priorId === [...replacements.entries()]
      .find(([, replacement]) => replacement === nextId)?.[0]) {
      location.id = nextId
    }
  })
  project.startLocationId = replacements.get(project.startLocationId) ?? project.startLocationId
  return courseProjectDocumentSchema.parse(project)
}

function courseRuntimeDefinition(
  source: string,
  renderMode: CourseRuntimeDefinition['renderMode'],
  content: RuntimeDocument['content'],
  fallbackAssetId: string,
): CourseRuntimeDefinition {
  return {
    protocol: 'canvas-runtime',
    runtimeApiVersion: 2,
    enabled: true,
    renderMode,
    source,
    content: structuredClone(content),
    assets: {},
    staticFallback: { assetId: fallbackAssetId, coverage: 'scene' },
  }
}

function exitOnEventRule(input: {
  id: string
  trigger: { type: 'node.click'; nodeId: string }
  targetId: string
}) {
  return {
    id: input.id,
    name: '基准交互确认',
    enabled: true,
    trigger: input.trigger,
    conditions: [],
    actions: [{
      id: `${input.id}_exit`,
      start: 'after-previous' as const,
      delayMs: 0,
      action: {
        type: 'node.exit' as const,
        nodeId: input.targetId,
        durationMs: 0,
        easing: 'linear' as const,
        effect: 'none' as const,
      },
    }],
  }
}

function buildV9ThirdPartyNotice({ version, licenseText }: ThreePackageMetadata): string {
  return `# Third-party notices for the V9 / Published V2 benchmark

The generated source \`runtimes/three-runtime.js\` and the files
\`project-v9.json\`, \`published-v2.json\`,
\`render-host-benchmark-v9.h5lesson\`, and \`render-host-benchmark-v2.html\`
contain a bundled copy of Three.js through the scene-local API 2 DOM Runtime.

## Three.js ${version}

- Project: https://threejs.org/
- Source repository: https://github.com/mrdoob/three.js
- License: MIT

${licenseText.trim()}\n`
}

function authorSlidePage(
  project: CourseProjectDocument,
  locationId: string,
  author: (session: SlideAuthoringSession) => SlideAuthoringSession,
): CourseProjectDocument {
  const session = openSlideAuthoringSession(project, {
    locationId,
    sessionId: `render-host-benchmark-${locationId}`,
  })
  return author(session).history.present
}

function buildV9BenchmarkProject(input: {
  phaserRuntimeSource: string
  threeRuntimeSource: string
  projectAssets: CourseProjectDocument['assets']
  tableComponent: LoadedComponent
  phaserMeterComponent: LoadedComponent
}): CourseProjectDocument {
  let id = 0
  let project = createBlankCourseProject({
    id: 'project_render_host_benchmark_v9',
    title: 'Course Project V9 渲染宿主完整基准',
    now: timestamp,
    idFactory: () => `benchmark_${String(++id).padStart(2, '0')}`,
  })
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('V9 factory 未创建 Slide 表面')
  for (const title of [
    '02 API2 Phaser 运行时',
    '03 API2 Three.js 运行时',
    '04 V4 DOM 表格组件',
    '05 V4 Phaser 仪表组件',
  ]) {
    project = requireCourseLocationResult(addCourseScene(project, {
      surfaceId: surface.id,
      title,
      now: timestamp,
    }), `创建“${title}”`)
  }
  project = canonicalizeBenchmarkSceneIds(project)
  project = courseProjectDocumentSchema.parse({
    ...project,
    assets: structuredClone(input.projectAssets),
    componentPackages: {
      [input.tableComponent.data.manifest.id]: input.tableComponent.data.metadata,
      [input.phaserMeterComponent.data.manifest.id]: input.phaserMeterComponent.data.metadata,
    },
  })

  project = authorSlidePage(project, v9SceneIds[0], (initial) => {
    let session = requireSlideCommand(addSlideShapeLayer(initial, {
      shapeType: 'rounded-rectangle',
      id: 'native_click_target_v9',
      x: 250,
      y: 180,
      label: '点击隐藏确认文字',
    }, { now: timestamp }), '添加 Native 点击图形')
    session = requireSlideCommand(addSlideTextLayer(session, {
      id: 'native_click_probe_v9',
      text: 'Native click ready',
      x: 540,
      y: 250,
      label: 'Native 点击确认文字',
    }, { now: timestamp }), '添加 Native 确认文字')
    return requireSlideCommand(upsertSlideInteractionRule(session, exitOnEventRule({
      id: 'native_click_rule_v9',
      trigger: { type: 'node.click', nodeId: 'native_click_target_v9' },
      targetId: 'native_click_probe_v9',
    }), { now: timestamp }), '添加 Native 点击交互')
  })

  project = authorSlidePage(project, v9SceneIds[1], (initial) =>
    requireSlideCommand(addSlideRuntimeLayer(initial, {
      id: 'phaser_runtime_instance_v9',
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      label: 'API2 Phaser 场景运行时',
      runtime: courseRuntimeDefinition(
        input.phaserRuntimeSource,
        'phaser',
        phaserContent,
        'asset_phaser_runtime_fallback',
      ),
    }, { now: timestamp }), '添加 API2 Phaser Runtime'))

  project = authorSlidePage(project, v9SceneIds[2], (initial) =>
    requireSlideCommand(addSlideRuntimeLayer(initial, {
      id: 'three_runtime_instance_v9',
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      label: 'API2 DOM Three.js 场景运行时',
      runtime: courseRuntimeDefinition(
        input.threeRuntimeSource,
        'dom',
        threeContent,
        'asset_three_runtime_fallback',
      ),
    }, { now: timestamp }), '添加 API2 DOM Three.js Runtime'))

  project = authorSlidePage(project, v9SceneIds[3], (initial) =>
    requireSlideCommand(addSlideComponentLayer(initial, {
      packageId: input.tableComponent.data.manifest.id,
      manifest: input.tableComponent.data.manifest,
      id: 'table_component_instance',
      x: 70,
      y: 148,
      width: 1140,
      height: 420,
      label: 'V4 DOM 可编辑对比表',
      props: {
        content: {
          title: '课件渲染路径选型表',
          caption: '实例文案已覆盖默认值；教师可继续在属性面板修改。',
        },
      },
    }, { now: timestamp }), '添加 API4 DOM Component'))

  project = authorSlidePage(project, v9SceneIds[4], (initial) =>
    requireSlideCommand(addSlideComponentLayer(initial, {
      packageId: input.phaserMeterComponent.data.manifest.id,
      manifest: input.phaserMeterComponent.data.manifest,
      id: 'phaser_meter_component_instance',
      x: 280,
      y: 156,
      width: 720,
      height: 390,
      label: 'V4 Phaser 交互仪表',
      props: { content: { centerLabel: 'V4 OK' } },
    }, { now: timestamp }), '添加 API4 Phaser Component'))

  return courseProjectDocumentSchema.parse(project)
}

export async function buildRenderHostBenchmarkOutputs(): Promise<GeneratedExampleOutputs> {
  const [
    threePackageMetadata,
    threeRuntimeSource,
    phaserRuntimeSource,
    playerBundle,
    tableComponent,
    phaserMeterComponent,
  ] = await Promise.all([
    loadThreePackageMetadata(),
    bundleThreeRuntime(),
    fs.readFile(path.join(runtimeDirectory, 'phaser-runtime.js'), 'utf8').then(normalizeLineEndings),
    fs.readFile(playerBundlePath, 'utf8').catch((error: unknown) => {
      throw new Error('缺少 dist-player/player.iife.js；请先运行 npm run build:player', { cause: error })
    }),
    loadComponent('editable-table'),
    loadComponent('phaser-meter', {
      version: RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION,
      transformRuntimeSource: withPhaserMeterGenerationProbe,
    }),
  ])

  assertOfflineBundle(phaserRuntimeSource, 'Phaser 场景运行时')
  validateRuntimeDefinition(phaserRuntimeSource, 'Phaser 场景运行时')
  if (tableComponent.data.manifest.schemaVersion !== 4 || tableComponent.data.manifest.renderMode !== 'dom') {
    throw new Error('可编辑表格必须是 V4 DOM 组件')
  }
  if (
    phaserMeterComponent.data.manifest.schemaVersion !== 4 ||
    phaserMeterComponent.data.manifest.version !==
      RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION ||
    phaserMeterComponent.data.manifest.renderMode !== 'phaser'
  ) {
    throw new Error('V9 generation probe 必须保持 Phaser 仪表组件合同身份')
  }

  const generatedAssets = {
    asset_phaser_runtime_fallback: {
      filename: 'phaser-runtime-fallback.svg',
      source: phaserFallbackSvg(),
    },
    asset_three_runtime_fallback: {
      filename: 'three-runtime-fallback.svg',
      source: threeFallbackSvg(),
    },
  } satisfies Record<string, { filename: string; source: string }>

  const assetFiles: Record<string, Uint8Array> = {}
  const projectAssets: CourseProjectDocument['assets'] = {}
  for (const [assetId, asset] of Object.entries(generatedAssets)) {
    const bytes = strToU8(asset.source)
    assetFiles[assetId] = bytes
    projectAssets[assetId] = {
      id: assetId,
      filename: asset.filename,
      mimeType: 'image/svg+xml',
      kind: 'image',
      path: `assets/${asset.filename}`,
      byteLength: bytes.byteLength,
      width: 1280,
      height: 720,
    }
  }

  const projectV9 = buildV9BenchmarkProject({
    phaserRuntimeSource,
    threeRuntimeSource,
    projectAssets,
    tableComponent,
    phaserMeterComponent,
  })
  const courseSources = {
    project: projectV9,
    assetFiles,
    components: {
      [tableComponent.data.key]: tableComponent.data,
      [phaserMeterComponent.data.key]: phaserMeterComponent.data,
    },
  }
  const componentFilesV9 = {
    [tableComponent.data.key]: tableComponent.data.files,
    [phaserMeterComponent.data.key]: phaserMeterComponent.data.files,
  }
  const lessonV9 = createCourseProjectArchive({
    project: projectV9,
    assetFiles,
    componentFiles: componentFilesV9,
  }, { mtime: archiveZipMtime })
  const reopenedV9 = openCourseProjectArchive(lessonV9)
  const reopenedSlide = reopenedV9.project.surfaces[0]
  if (
    reopenedV9.project.schemaVersion !== 9 ||
    reopenedV9.project.locations.length !== 5 ||
    !reopenedSlide ||
    reopenedSlide.type !== 'slide' ||
    reopenedSlide.scenes.length !== 5 ||
    Object.keys(reopenedV9.componentFiles).length !== 2
  ) {
    throw new Error('生成后的 V9 基准 .h5lesson 重新打开校验失败')
  }
  const publishedV2 = buildPublishedCourseV2Payload(courseSources)
  const htmlV2 = buildPublishedCourseStandaloneHtml(courseSources, { playerBundle })
    .replace(/^[\t ]+(?=\r?$)/gm, '')
  return {
    [RENDER_HOST_BENCHMARK_OUTPUT_PATHS.threeRuntime]: strToU8(threeRuntimeSource),
    [RENDER_HOST_BENCHMARK_OUTPUT_PATHS.phaserFallback]: assetFiles.asset_phaser_runtime_fallback!,
    [RENDER_HOST_BENCHMARK_OUTPUT_PATHS.threeFallback]: assetFiles.asset_three_runtime_fallback!,
    [RENDER_HOST_BENCHMARK_OUTPUT_PATHS.projectV9]: strToU8(
      `${JSON.stringify(projectV9, null, 2)}\n`,
    ),
    [RENDER_HOST_BENCHMARK_OUTPUT_PATHS.publishedV2]: strToU8(
      `${JSON.stringify(publishedV2, null, 2)}\n`,
    ),
    [RENDER_HOST_BENCHMARK_OUTPUT_PATHS.lessonV9]: lessonV9,
    [RENDER_HOST_BENCHMARK_OUTPUT_PATHS.htmlV2]: strToU8(htmlV2),
    [RENDER_HOST_BENCHMARK_OUTPUT_PATHS.noticesV9]: strToU8(
      buildV9ThirdPartyNotice(threePackageMetadata),
    ),
  }
}

export async function checkRenderHostBenchmarkOutputs(): Promise<void> {
  await checkTrackedExampleOutputs(
    exampleDirectory,
    await buildRenderHostBenchmarkOutputs(),
    '渲染宿主基准',
  )
}

async function refreshRenderHostBenchmarkOutputs(): Promise<void> {
  const outputs = await buildRenderHostBenchmarkOutputs()
  await Promise.all(Object.entries(outputs).map(([relativePath, bytes]) =>
    fs.writeFile(path.join(exampleDirectory, relativePath), bytes)))
  console.log('已刷新渲染宿主基准 fixtures')
}

export type RenderHostBenchmarkGenerationMode = 'refresh' | 'check'

export function parseRenderHostBenchmarkGenerationMode(
  argv: readonly string[],
): RenderHostBenchmarkGenerationMode {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--refresh')) {
    return 'refresh'
  }
  if (argv.length === 1 && argv[0] === '--check') return 'check'
  throw new Error(
    'Usage: tsx scripts/build-render-host-benchmark.ts [--refresh|--check]',
  )
}

async function main(argv: readonly string[]): Promise<void> {
  if (parseRenderHostBenchmarkGenerationMode(argv) === 'check') {
    await checkRenderHostBenchmarkOutputs()
    return
  }
  await refreshRenderHostBenchmarkOutputs()
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error('生成渲染宿主基准失败', error)
    process.exitCode = 1
  })
}
