import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'
import { componentManifestSchema } from '../src/shared/componentSchema'
import type { ComponentManifest } from '../src/shared/componentTypes'
import type { ProjectDocument, SceneDocument } from '../src/shared/projectTypes'
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
import { buildExportPayload } from '../src/renderer/export/buildExportPayload'
import { buildStandaloneHtml } from '../src/renderer/export/buildStandaloneHtml'
import {
  checkTrackedExampleOutputs,
  type GeneratedExampleOutputs,
} from './exampleGenerationBoundary'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDirectory, '..')
const examplesDirectory = path.join(root, 'examples')
const sourceDirectory = path.join(examplesDirectory, 'photosynthesis-lab-component')
export const INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS = {
  thumbnail: 'photosynthesis-lab-component/thumbnail.png',
  component: 'photosynthesis-lab.h5component',
  lesson: 'photosynthesis-interactive-lesson.h5lesson',
} as const
const artifactDirectory = path.join(root, 'artifacts', 'photosynthesis-lesson')
const htmlPath = path.join(artifactDirectory, 'photosynthesis-interactive-lesson.html')
const timestamp = new Date('2026-07-21T00:00:00.000Z')

const thumbnailSvg = String.raw`
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#06152b"/><stop offset="1" stop-color="#0b3a3b"/>
    </linearGradient>
    <radialGradient id="halo"><stop stop-color="#34d399" stop-opacity=".4"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/></radialGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-opacity=".35"/></filter>
  </defs>
  <rect width="600" height="340" rx="30" fill="url(#bg)"/>
  <circle cx="344" cy="180" r="130" fill="url(#halo)"/>
  <g filter="url(#shadow)">
    <rect x="24" y="24" width="552" height="292" rx="24" fill="#081d31" fill-opacity=".76" stroke="#34d399" stroke-opacity=".35"/>
  </g>
  <text x="52" y="69" fill="#7dd3fc" font-family="Microsoft YaHei,sans-serif" font-size="13" font-weight="700">INTERACTIVE SCIENCE · 互动科学</text>
  <text x="52" y="111" fill="#f2fbff" font-family="Microsoft YaHei,sans-serif" font-size="30" font-weight="700">光合作用实验室</text>
  <text x="52" y="140" fill="#87a9bd" font-family="Microsoft YaHei,sans-serif" font-size="14">探索 · 实验 · 挑战</text>
  <circle cx="124" cy="214" r="24" fill="#fbbf24" opacity=".95"/>
  <path d="M150 214 C205 214 220 200 260 184" fill="none" stroke="#fbbf24" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 10"/>
  <ellipse cx="310" cy="177" rx="72" ry="38" transform="rotate(-24 310 177)" fill="#22c973" stroke="#86efac" stroke-width="2"/>
  <ellipse cx="398" cy="167" rx="78" ry="42" transform="rotate(22 398 167)" fill="#16a765" stroke="#6ee7b7" stroke-width="2"/>
  <path d="M348 183 L350 267" stroke="#34d399" stroke-width="10" stroke-linecap="round"/>
  <g fill="#7dd3fc">
    <circle cx="459" cy="196" r="7" opacity=".8"/><circle cx="486" cy="168" r="5" opacity=".6"/><circle cx="510" cy="211" r="9" opacity=".75"/>
  </g>
  <rect x="49" y="272" width="136" height="25" rx="12" fill="#123a47" stroke="#38bdf8" stroke-opacity=".45"/>
  <rect x="196" y="272" width="136" height="25" rx="12" fill="#164335" stroke="#34d399" stroke-opacity=".45"/>
  <rect x="343" y="272" width="136" height="25" rx="12" fill="#3b3218" stroke="#fbbf24" stroke-opacity=".45"/>
  <text x="117" y="289" text-anchor="middle" fill="#a7e7ff" font-family="Microsoft YaHei,sans-serif" font-size="11">能量路径</text>
  <text x="264" y="289" text-anchor="middle" fill="#a7f3d0" font-family="Microsoft YaHei,sans-serif" font-size="11">实时实验</text>
  <text x="411" y="289" text-anchor="middle" fill="#fde68a" font-family="Microsoft YaHei,sans-serif" font-size="11">拖拽挑战</text>
</svg>`

function buildProject(
  manifest: ComponentManifest,
  metadata: ReturnType<typeof importComponentPackage>['metadata'],
): ProjectDocument {
  const project = createProject({
    id: 'project_photosynthesis_interactive_lab',
    title: '光合作用互动实验室',
    now: timestamp,
    idFactory: (() => { let i = 0; return () => String(++i).padStart(3, '0') })(),
  })

  const sceneDefinitions = [
    {
      id: 'scene_energy_path',
      name: '01 · 发现能量路径',
      background: '#06152b',
      page: 1,
      kicker: 'INTERACTIVE SCIENCE  /  互动科学',
      title: '一片叶子，如何把阳光变成生命能量？',
      subtitle: '点击三种输入，亲手启动光合作用。',
      accent: '#34d399',
    },
    {
      id: 'scene_live_experiment',
      name: '02 · 光合实验室',
      background: '#061b29',
      page: 2,
      kicker: 'LIVE EXPERIMENT  /  实时实验',
      title: '环境改变，光合效率会怎样变化？',
      subtitle: '调节光照、二氧化碳与温度，寻找最佳区间。',
      accent: '#38bdf8',
    },
    {
      id: 'scene_classification',
      name: '03 · 光合挑战',
      background: '#11102b',
      page: 3,
      kicker: 'MISSION CHECK  /  知识闯关',
      title: '把光合作用“组装”起来',
      subtitle: '拖动 6 张卡片完成分类，验证你的理解。',
      accent: '#a78bfa',
    },
  ] as const

  project.scenes = sceneDefinitions.map((definition): SceneDocument => {
    const scene = createScene({
      id: definition.id,
      name: definition.name,
      backgroundColor: definition.background,
    })
    scene.nodes = [
      createShapeNode('rounded-rectangle', {
        id: `${definition.id}_accent`,
        name: '页面色标',
        x: 64,
        y: 58,
        width: 16,
        height: 92,
        style: {
          fillColor: definition.accent,
          borderColor: definition.accent,
          borderWidth: 0,
          cornerRadius: 4,
        },
      }),
      createTextNode({
        id: `${definition.id}_kicker`,
        name: '栏目标签',
        x: 92,
        y: 50,
        width: 800,
        height: 30,
        text: definition.kicker,
        style: { fontSize: 15, color: definition.accent, align: 'left', lineSpacing: 4 },
      }),
      createTextNode({
        id: `${definition.id}_title`,
        name: '页面标题',
        x: 92,
        y: 82,
        width: 1040,
        height: 56,
        text: definition.title,
        style: { fontSize: 35, color: '#f3fbff', align: 'left', lineSpacing: 5 },
      }),
      createTextNode({
        id: `${definition.id}_subtitle`,
        name: '学习提示',
        x: 94,
        y: 139,
        width: 940,
        height: 36,
        text: definition.subtitle,
        style: { fontSize: 17, color: '#87a6bb', align: 'left', lineSpacing: 4 },
      }),
      createTextNode({
        id: `${definition.id}_number`,
        name: '页码装饰',
        x: 1116,
        y: 64,
        width: 100,
        height: 70,
        text: `0${definition.page}`,
        style: { fontSize: 48, color: definition.accent, align: 'right', lineSpacing: 4 },
      }),
      createExternalComponentNode({
        id: `${definition.id}_lab`,
        name: `互动实验 · 第 ${definition.page} 页`,
        x: 100,
        y: 194,
        width: manifest.defaultSize.width,
        height: manifest.defaultSize.height,
        component: { packageId: manifest.id, version: manifest.version },
        props: { page: definition.page },
      }),
      createTextNode({
        id: `${definition.id}_footer`,
        name: '底部说明',
        x: 100,
        y: 671,
        width: 1080,
        height: 26,
        text: definition.page === 3
          ? '提示：分类完成后，可使用画布内教师控制器的“上一场景”回顾实验。'
          : '完成本页互动后，点击画布内教师控制器的“下一场景”继续。',
        style: { fontSize: 12, color: '#55758a', align: 'center', lineSpacing: 3 },
      }),
    ]
    return scene
  })
  project.componentPackages[manifest.id] = metadata
  return project
}

export interface InteractiveLessonOutputs {
  tracked: GeneratedExampleOutputs
  html: string
}

export async function buildInteractiveLessonOutputs(): Promise<InteractiveLessonOutputs> {
  const [manifestText, runtimeText] = await Promise.all([
    fs.readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8'),
    fs.readFile(path.join(sourceDirectory, 'runtime.js'), 'utf8'),
  ])
  const parsedManifest = componentManifestSchema.parse(JSON.parse(manifestText) as unknown)
  const thumbnail = await sharp(Buffer.from(thumbnailSvg)).png({ compressionLevel: 9 }).toBuffer()

  const componentFiles = {
    'manifest.json': strToU8(`${JSON.stringify(parsedManifest, null, 2)}\n`),
    'runtime.js': strToU8(runtimeText),
    'thumbnail.png': Uint8Array.from(thumbnail),
  }
  const componentArchive = zipSync(componentFiles, { level: 7, mtime: timestamp })
  const component = importComponentPackage(componentArchive, {
    expectedId: parsedManifest.id,
    expectedVersion: parsedManifest.version,
  })

  const project = buildProject(component.manifest, component.metadata)
  const lessonArchive = createProjectArchive({
    project,
    assetFiles: {},
    componentFiles: { [component.key]: component.files },
  }, { mtime: timestamp })

  const reopened = openProjectArchive(lessonArchive)
  if (reopened.project.scenes.length !== 3) throw new Error('课例工程场景数量不是 3')
  if (reopened.project.scenes.some((scene) => scene.nodes.filter((node) => node.type === 'external-component').length !== 1)) {
    throw new Error('每个场景必须包含且仅包含一个互动实验组件')
  }

  const playerBundle = await fs.readFile(path.join(root, 'dist-player', 'player.iife.js'), 'utf8')
  const payload = buildExportPayload({
    project: reopened.project,
    components: { [component.manifest.id]: component },
  })
  const html = buildStandaloneHtml(payload, { playerBundle, lang: 'zh-CN' })
  if (/https?:\/\//i.test(html)) throw new Error('离线 HTML 中出现远程 URL')

  return {
    tracked: {
      [INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS.thumbnail]: Uint8Array.from(thumbnail),
      [INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS.component]: componentArchive,
      [INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS.lesson]: lessonArchive,
    },
    html,
  }
}

export async function checkInteractiveLessonOutputs(): Promise<void> {
  const outputs = await buildInteractiveLessonOutputs()
  await checkTrackedExampleOutputs(
    examplesDirectory,
    outputs.tracked,
    '光合作用课例',
  )
}

async function writeInteractiveLessonHtml(html: string): Promise<void> {
  await fs.mkdir(artifactDirectory, { recursive: true })
  await fs.writeFile(htmlPath, html, 'utf8')
}

async function refreshInteractiveLessonOutputs(): Promise<void> {
  const outputs = await buildInteractiveLessonOutputs()
  await Promise.all([
    ...Object.entries(outputs.tracked).map(([relativePath, bytes]) =>
      fs.writeFile(path.join(examplesDirectory, relativePath), bytes)),
    writeInteractiveLessonHtml(outputs.html),
  ])
  console.log('已刷新光合作用组件、工程和离线预览')
}

async function prepareInteractiveLessonHtml(): Promise<void> {
  const outputs = await buildInteractiveLessonOutputs()
  await writeInteractiveLessonHtml(outputs.html)
  console.log(`已准备 E2E 所需离线预览：${htmlPath}`)
}

export type InteractiveLessonGenerationMode = 'refresh' | 'check' | 'prepare'

export function parseInteractiveLessonGenerationMode(
  argv: readonly string[],
): InteractiveLessonGenerationMode {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--refresh')) {
    return 'refresh'
  }
  if (argv.length === 1 && argv[0] === '--check') return 'check'
  if (argv.length === 1 && argv[0] === '--prepare') return 'prepare'
  throw new Error(
    'Usage: tsx scripts/build-interactive-lesson.ts [--refresh|--check|--prepare]',
  )
}

async function main(argv: readonly string[]): Promise<void> {
  switch (parseInteractiveLessonGenerationMode(argv)) {
    case 'check':
      await checkInteractiveLessonOutputs()
      return
    case 'prepare':
      await prepareInteractiveLessonHtml()
      return
    case 'refresh':
      await refreshInteractiveLessonOutputs()
  }
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error('生成互动教学课例失败', error)
    process.exitCode = 1
  })
}
