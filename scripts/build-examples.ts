import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'
import type {
  ComponentCreateContextV4Phaser,
  ComponentManifest,
} from '../src/shared/componentTypes'
import { componentManifestSchema } from '../src/shared/componentSchema'
import { courseProjectDocumentSchema } from '../src/shared/courseProjectSchema'
import type { CourseProjectDocument } from '../src/shared/courseProjectTypes'
import {
  addCourseScene,
  type CourseLocationCommandResult,
} from '../src/renderer/course/courseLocationCommands'
import {
  openSlideAuthoringSession,
  type SlideAuthoringSession,
} from '../src/renderer/course/slideAuthoringBackend'
import type { SlideCommandResult } from '../src/renderer/course/slideEditorCommands'
import {
  addSlideComponentLayer,
  addSlideTextLayer,
  readSlideComponentLayer,
} from '../src/renderer/course/v9SlideContentCommands'
import {
  importComponentPackage,
  parseComponentPackageFiles,
} from '../src/renderer/components/importComponentPackage'
import { executeComponentRuntime } from '../src/renderer/components/executeComponentRuntime'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../src/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '../src/renderer/project/createCourseProject'
import {
  checkTrackedExampleOutputs,
  normalizeLineEndings,
  type GeneratedExampleOutputs,
} from './exampleGenerationBoundary'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const examplesDirectory = path.join(projectRoot, 'examples')
const componentSourceDirectory = path.join(
  examplesDirectory,
  'sample-counter-component',
)
export const SAMPLE_EXAMPLE_OUTPUT_PATHS = {
  thumbnail: 'sample-counter-component/thumbnail.png',
  component: 'sample-counter.h5component',
  project: 'sample-project.h5lesson',
} as const
const reproducibleTimestamp = new Date('2026-07-20T00:00:00.000Z')

const thumbnailSvg = String.raw`
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280" viewBox="0 0 480 280">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="480" y2="280">
      <stop stop-color="#f8fafc"/>
      <stop offset="1" stop-color="#dbeafe"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#0f172a" flood-opacity=".18"/>
    </filter>
  </defs>
  <rect width="480" height="280" rx="28" fill="#e2e8f0"/>
  <g filter="url(#shadow)">
    <rect x="18" y="14" width="444" height="246" rx="22" fill="url(#background)" stroke="#bfdbfe" stroke-width="2"/>
    <rect x="18" y="14" width="10" height="246" rx="5" fill="#2563eb"/>
  </g>
  <text x="48" y="58" fill="#0f172a" font-family="Microsoft YaHei, sans-serif" font-size="25" font-weight="700">课堂计数器</text>
  <text x="48" y="87" fill="#64748b" font-family="Microsoft YaHei, sans-serif" font-size="15">点击按钮改变数值</text>
  <text x="240" y="170" text-anchor="middle" fill="#1d4ed8" font-family="Arial, sans-serif" font-size="72" font-weight="700">0</text>
  <rect x="80" y="201" width="88" height="40" rx="12" fill="#ef4444"/>
  <rect x="196" y="201" width="88" height="40" rx="12" fill="#475569"/>
  <rect x="312" y="201" width="88" height="40" rx="12" fill="#2563eb"/>
  <text x="124" y="230" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="28" font-weight="700">−</text>
  <text x="240" y="228" text-anchor="middle" fill="white" font-family="Microsoft YaHei, sans-serif" font-size="16" font-weight="700">归零</text>
  <text x="356" y="231" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="29" font-weight="700">+</text>
</svg>
`

function deterministicIdFactory(): () => string {
  let sequence = 0
  return () => String(++sequence).padStart(3, '0')
}

function requireCourseProject(result: CourseLocationCommandResult): {
  project: CourseProjectDocument
  activatedLocationId: string
} {
  if (!result.ok) throw new Error(result.reason)
  return result
}

function requireSlideSession(result: SlideCommandResult): SlideAuthoringSession {
  if (!result.ok || !result.nextSession) {
    throw new Error(result.reason ?? '示例 Slide 命令执行失败')
  }
  return result.nextSession
}

async function readComponentSources(): Promise<{
  manifest: ComponentManifest
  manifestBytes: Uint8Array
  runtimeBytes: Uint8Array
  thumbnailBytes: Uint8Array
}> {
  const manifestPath = path.join(componentSourceDirectory, 'manifest.json')
  const runtimePath = path.join(componentSourceDirectory, 'runtime.js')

  const [manifestText, runtimeText] = await Promise.all([
    fs.readFile(manifestPath, 'utf8'),
    fs.readFile(runtimePath, 'utf8').then(normalizeLineEndings),
  ])
  const manifestResult = componentManifestSchema.safeParse(
    JSON.parse(manifestText) as unknown,
  )
  if (!manifestResult.success) {
    throw new Error(`示例组件 manifest 无效：${manifestResult.error.message}`)
  }

  const thumbnail = await sharp(Buffer.from(thumbnailSvg))
    .png({ compressionLevel: 9 })
    .toBuffer()

  return {
    manifest: manifestResult.data,
    manifestBytes: strToU8(`${JSON.stringify(manifestResult.data, null, 2)}\n`),
    runtimeBytes: strToU8(runtimeText),
    thumbnailBytes: Uint8Array.from(thumbnail),
  }
}

function buildSampleProject(
  manifest: ComponentManifest,
  componentMetadata: ReturnType<typeof importComponentPackage>['metadata'],
): CourseProjectDocument {
  let project = createBlankCourseProject({
    id: 'project_sample_courseware',
    title: '示例互动课件',
    now: reproducibleTimestamp,
    idFactory: deterministicIdFactory(),
  })

  const slide = project.surfaces[0]
  if (!slide || slide.type !== 'slide') {
    throw new Error('V9 工厂未创建默认 Slide surface')
  }
  const firstLocation = project.locations.find(
    (location) => location.kind === 'slide-scene' && location.surfaceId === slide.id,
  )
  if (!firstLocation) throw new Error('V9 工厂未创建默认 Slide location')

  const added = requireCourseProject(addCourseScene(project, {
    surfaceId: slide.id,
    title: '互动组件',
    now: reproducibleTimestamp.toISOString(),
    expectedRevision: project.revision,
  }))
  project = structuredClone(added.project)

  // addCourseScene intentionally owns ID allocation. Normalize only the fixture's
  // newly authored location so repeated builds remain byte-for-byte reproducible.
  const secondLocation = project.locations.find(
    (location) => location.id === added.activatedLocationId,
  )
  if (!secondLocation || secondLocation.kind !== 'slide-scene') {
    throw new Error('新建 Slide location 不可用')
  }
  const secondSlide = project.surfaces.find((surface) => surface.id === slide.id)
  if (!secondSlide || secondSlide.type !== 'slide') {
    throw new Error('新建 Slide surface 不可用')
  }
  const secondScene = secondSlide.scenes.find(
    (scene) => scene.id === secondLocation.sceneId,
  )
  if (!secondScene) throw new Error('新建 Slide scene 不可用')
  secondLocation.id = 'scene_sample_component'
  secondLocation.sceneId = 'scene_sample_component'
  secondLocation.label = '示例互动课件 · 互动组件'
  secondScene.id = 'scene_sample_component'

  project.componentPackages[manifest.id] = structuredClone(componentMetadata)
  project = courseProjectDocumentSchema.parse(project)

  let introSession = openSlideAuthoringSession(project, {
    locationId: firstLocation.id,
  })
  introSession = requireSlideSession(addSlideTextLayer(introSession, {
    id: 'text_intro_title',
    label: '主标题',
    text: '交互式课件编辑器',
    x: 240,
    y: 260,
  }, { now: reproducibleTimestamp.toISOString() }))
  introSession = requireSlideSession(addSlideTextLayer(introSession, {
    id: 'text_intro_subtitle',
    label: '副标题',
    text: '双击文字即可修改',
    x: 290,
    y: 372,
  }, { now: reproducibleTimestamp.toISOString() }))
  project = introSession.history.present

  let componentSession = openSlideAuthoringSession(project, {
    locationId: secondLocation.id,
  })
  componentSession = requireSlideSession(addSlideTextLayer(componentSession, {
    id: 'text_component_hint',
    label: '操作提示',
    text: '拖动组件，调整课件布局',
    x: 240,
    y: 92,
  }, { now: reproducibleTimestamp.toISOString() }))
  componentSession = requireSlideSession(addSlideComponentLayer(componentSession, {
    packageId: manifest.id,
    manifest,
    id: 'component_sample_counter',
    label: manifest.name,
    x: 400,
    y: 220,
    width: manifest.defaultSize.width,
    height: manifest.defaultSize.height,
    props: structuredClone(manifest.defaultProps),
  }, { now: reproducibleTimestamp.toISOString() }))
  const authored = readSlideComponentLayer(componentSession, 'component_sample_counter')
  if (
    authored.component.packageId !== manifest.id ||
    authored.component.version !== manifest.version ||
    authored.frame.x !== 400 ||
    authored.frame.y !== 220
  ) {
    throw new Error('Slide component authoring command 产物不匹配')
  }
  return courseProjectDocumentSchema.parse(componentSession.history.present)
}

function validateGeneratedProject(project: CourseProjectDocument): void {
  const slide = project.surfaces[0]
  if (
    project.schemaVersion !== 9 ||
    project.surfaces.length !== 1 ||
    !slide ||
    slide.type !== 'slide' ||
    slide.scenes.length !== 2 ||
    project.locations.length !== 2
  ) {
    throw new Error('示例工程必须是两页 Slide 的 Course Project V9')
  }
  const controller = project.globalLayerItems.find(
    (entry) => entry.item.kind === 'native' &&
      entry.item.content.nativeType === 'teacher-controller',
  )
  if (!controller || controller.visibility.mode !== 'all' || project.playback.controls !== 'canvas') {
    throw new Error('示例工程未保留 V9 工厂的默认全局教师控制器')
  }
  const firstTexts = slide.scenes[0]!.layerItems.flatMap((item) =>
    item.kind === 'native' && item.content.nativeType === 'text'
      ? [item.content.data.text]
      : [])
  if (
    !firstTexts.includes('交互式课件编辑器') ||
    !firstTexts.includes('双击文字即可修改')
  ) {
    throw new Error('示例工程第 1 页内容不完整')
  }
  if (
    !slide.scenes[1]!.layerItems.some(
      (item) => item.kind === 'native' &&
        item.content.nativeType === 'text' &&
        item.content.data.text === '拖动组件，调整课件布局',
    ) ||
    !slide.scenes[1]!.layerItems.some(
      (item) => item.kind === 'component' &&
        item.component.packageId === 'com.example.sample-counter',
    )
  ) {
    throw new Error('示例工程第 2 页内容不完整')
  }
  if (!project.componentPackages['com.example.sample-counter']) {
    throw new Error('示例工程未登记计数器组件包')
  }
}

class MockGameObject {
  text: string | undefined
  interactive = false
  private readonly handlers = new Map<string, Set<() => void>>()

  constructor(text?: string) {
    this.text = text
  }

  setOrigin(): this {
    return this
  }

  setStrokeStyle(): this {
    return this
  }

  setRounded(): this {
    return this
  }

  setInteractive(): this {
    this.interactive = true
    return this
  }

  setPosition(): this {
    return this
  }

  setSize(): this {
    return this
  }

  setFontSize(): this {
    return this
  }

  setVisible(): this {
    return this
  }

  setText(value: string): this {
    this.text = value
    return this
  }

  on(eventName: string, handler: () => void): this {
    const handlers = this.handlers.get(eventName) ?? new Set<() => void>()
    handlers.add(handler)
    this.handlers.set(eventName, handlers)
    return this
  }

  off(eventName: string, handler: () => void): this {
    this.handlers.get(eventName)?.delete(handler)
    return this
  }

  emit(eventName: string): void {
    for (const handler of this.handlers.get(eventName) ?? []) handler()
  }
}

function validateCounterRuntime(runtimeSource: string, manifest: ComponentManifest): void {
  const definition = executeComponentRuntime(runtimeSource, manifest.id)
  const objects: MockGameObject[] = []
  const emittedValues: number[] = []
  const scene = {
    add: {
      rectangle() {
        const object = new MockGameObject()
        objects.push(object)
        return object
      },
      text(_x: number, _y: number, text: string) {
        const object = new MockGameObject(text)
        objects.push(object)
        return object
      },
    },
  }
  const root = {
    add() {
      return root
    },
  }
  const lifecycle = definition.create({
    runtimeApiVersion: 4,
    renderMode: 'phaser',
    phaser: { Phaser: {}, scene, root },
    instanceId: 'validation-counter',
    width: manifest.defaultSize.width,
    height: manifest.defaultSize.height,
    mode: 'preview',
    props: manifest.defaultProps,
    editorState: {},
    actions: {
      goToScene: () => false,
      nextScene: () => false,
      previousScene: () => false,
      replayScene: () => false,
      restartCourse: () => false,
    },
    scope: 'scene',
    capture: { waitUntil: () => undefined },
    assetUrl() {
      throw new Error('示例计数器不应请求素材')
    },
    projectAssetUrl() {
      throw new Error('示例计数器不应请求工程素材')
    },
    emit(eventName: string, payload?: unknown) {
      if (
        eventName === 'change' &&
        typeof payload === 'object' &&
        payload !== null &&
        typeof Reflect.get(payload, 'value') === 'number'
      ) {
        emittedValues.push(Reflect.get(payload, 'value') as number)
      }
    },
  } as unknown as ComponentCreateContextV4Phaser)

  const valueText = objects.find((object) => object.text === '0')
  const buttons = objects.filter((object) => object.interactive)
  if (valueText === undefined || buttons.length !== 3) {
    throw new Error('示例计数器没有创建完整的数值显示和三个按钮')
  }
  buttons[2]!.emit('pointerdown')
  if (valueText.text !== '1' || emittedValues.at(-1) !== 1) {
    throw new Error('示例计数器的加号按钮未产生真实计数交互')
  }
  lifecycle.setMode?.('edit')
  buttons[2]!.emit('pointerdown')
  if (valueText.text !== '1') {
    throw new Error('示例计数器在编辑模式下仍响应内部点击')
  }
  lifecycle.destroy()
}

export async function buildSampleExampleOutputs(): Promise<GeneratedExampleOutputs> {
  const source = await readComponentSources()
  const componentFiles = {
    'manifest.json': source.manifestBytes,
    'runtime.js': source.runtimeBytes,
    'thumbnail.png': source.thumbnailBytes,
  }
  const componentArchive = zipSync(componentFiles, {
    level: 6,
    mtime: reproducibleTimestamp,
  })
  const importedComponent = importComponentPackage(componentArchive)
  validateCounterRuntime(importedComponent.runtimeSource, importedComponent.manifest)

  const project = buildSampleProject(
    importedComponent.manifest,
    importedComponent.metadata,
  )
  const projectArchive = createCourseProjectArchive({
    project,
    assetFiles: {},
    componentFiles: {
      [importedComponent.key]: importedComponent.files,
    },
  }, {
    mtime: reproducibleTimestamp,
  })

  const reopened = openCourseProjectArchive(projectArchive)
  validateGeneratedProject(reopened.project)
  const reopenedComponentFiles = reopened.componentFiles[importedComponent.key]
  if (!reopenedComponentFiles) throw new Error('重开的 V9 工程缺少内嵌组件字节')
  parseComponentPackageFiles(reopenedComponentFiles, {
    expectedId: importedComponent.manifest.id,
    expectedVersion: importedComponent.manifest.version,
  })

  return {
    [SAMPLE_EXAMPLE_OUTPUT_PATHS.thumbnail]: source.thumbnailBytes,
    [SAMPLE_EXAMPLE_OUTPUT_PATHS.component]: componentArchive,
    [SAMPLE_EXAMPLE_OUTPUT_PATHS.project]: projectArchive,
  }
}

export async function checkSampleExampleOutputs(): Promise<void> {
  await checkTrackedExampleOutputs(
    examplesDirectory,
    await buildSampleExampleOutputs(),
    '计数器示例',
  )
}

async function refreshSampleExampleOutputs(): Promise<void> {
  const outputs = await buildSampleExampleOutputs()
  await Promise.all(Object.entries(outputs).map(([relativePath, bytes]) =>
    fs.writeFile(path.join(examplesDirectory, relativePath), bytes)))
  console.log('已刷新计数器示例组件、工程和缩略图')
}

export type SampleExampleGenerationMode = 'refresh' | 'check'

export function parseSampleExampleGenerationMode(
  argv: readonly string[],
): SampleExampleGenerationMode {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--refresh')) {
    return 'refresh'
  }
  if (argv.length === 1 && argv[0] === '--check') return 'check'
  throw new Error('Usage: tsx scripts/build-examples.ts [--refresh|--check]')
}

async function main(argv: readonly string[]): Promise<void> {
  if (parseSampleExampleGenerationMode(argv) === 'check') {
    await checkSampleExampleOutputs()
    return
  }
  await refreshSampleExampleOutputs()
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error('生成示例文件失败', error)
    process.exitCode = 1
  })
}
