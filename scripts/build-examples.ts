import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'
import type {
  ComponentCreateContextV4Phaser,
  ComponentManifest,
} from '../src/shared/componentTypes'
import type { ProjectDocument } from '../src/shared/projectTypes'
import { componentManifestSchema } from '../src/shared/componentSchema'
import {
  createExternalComponentNode,
  createProject,
  createShapeNode,
  createScene,
  createTextNode,
} from '../src/renderer/project/createProject'
import {
  createProjectArchive,
  openProjectArchive,
} from '../src/renderer/project/projectArchive'
import { importComponentPackage } from '../src/renderer/components/importComponentPackage'
import { executeComponentRuntime } from '../src/renderer/components/executeComponentRuntime'
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
): ProjectDocument {
  const idFactory = deterministicIdFactory()
  const project = createProject({
    id: 'project_sample_courseware',
    title: '示例互动课件',
    now: reproducibleTimestamp,
    idFactory,
  })

  const firstScene = project.scenes[0]!
  firstScene.id = 'scene_sample_intro'
  firstScene.name = '欢迎'
  firstScene.backgroundColor = '#ffffff'
  firstScene.nodes = [
    createShapeNode('rounded-rectangle', {
      id: 'shape_intro_card',
      name: '蓝色矩形卡片',
      x: 150,
      y: 150,
      width: 980,
      height: 420,
      style: {
        fillColor: '#2563eb',
        borderColor: '#1d4ed8',
        borderWidth: 3,
        cornerRadius: 28,
      },
    }),
    createTextNode({
      id: 'text_intro_title',
      name: '主标题',
      x: 240,
      y: 260,
      width: 800,
      height: 90,
      text: '交互式课件编辑器',
      style: {
        fontSize: 64,
        color: '#ffffff',
        align: 'center',
      },
    }),
    createTextNode({
      id: 'text_intro_subtitle',
      name: '副标题',
      x: 290,
      y: 372,
      width: 700,
      height: 60,
      text: '双击文字即可修改',
      style: {
        fontSize: 34,
        color: '#dbeafe',
        align: 'center',
      },
    }),
  ]

  const secondScene = createScene({
    id: 'scene_sample_component',
    name: '互动组件',
    backgroundColor: '#f3f4f6',
  })
  secondScene.nodes = [
    createTextNode({
      id: 'text_component_hint',
      name: '操作提示',
      x: 240,
      y: 92,
      width: 800,
      height: 64,
      text: '拖动组件，调整课件布局',
      style: {
        fontSize: 42,
        color: '#1f2937',
        align: 'center',
      },
    }),
    createExternalComponentNode({
      id: 'component_sample_counter',
      name: manifest.name,
      x: 400,
      y: 220,
      width: manifest.defaultSize.width,
      height: manifest.defaultSize.height,
      component: {
        packageId: manifest.id,
        version: manifest.version,
      },
      props: structuredClone(manifest.defaultProps),
    }),
  ]
  project.scenes.push(secondScene)
  project.componentPackages[manifest.id] = componentMetadata
  return project
}

function validateGeneratedProject(project: ProjectDocument): void {
  if (project.scenes.length !== 2) {
    throw new Error('示例工程必须包含两个场景')
  }
  const firstTexts = project.scenes[0]!.nodes
    .filter((node) => node.type === 'text')
    .map((node) => node.text)
  if (
    !firstTexts.includes('交互式课件编辑器') ||
    !firstTexts.includes('双击文字即可修改') ||
    !project.scenes[0]!.nodes.some(
      (node) =>
        node.type === 'shape' && node.shapeType === 'rounded-rectangle',
    )
  ) {
    throw new Error('示例工程场景 1 内容不完整')
  }
  if (
    !project.scenes[1]!.nodes.some(
      (node) => node.type === 'text' && node.text === '拖动组件，调整课件布局',
    ) ||
    !project.scenes[1]!.nodes.some(
      (node) =>
        node.type === 'external-component' &&
        node.component.packageId === 'com.example.sample-counter',
    )
  ) {
    throw new Error('示例工程场景 2 内容不完整')
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
  const projectArchive = createProjectArchive({
    project,
    assetFiles: {},
    componentFiles: {
      [importedComponent.key]: importedComponent.files,
    },
  }, {
    mtime: reproducibleTimestamp,
  })

  const reopened = openProjectArchive(projectArchive)
  validateGeneratedProject(reopened.project)
  importComponentPackage(componentArchive, {
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
