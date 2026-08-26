import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ComponentEditorProperty, ComponentPackageData } from '../src/shared/componentTypes'
import { courseProjectDocumentSchema } from '../src/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '../src/shared/courseProjectModel'
import type {
  ComponentLayerItem,
  CourseProjectDocument,
  SlideSceneDocument,
} from '../src/shared/courseProjectTypes'
import { scanComponentCatalogDirectory, readCatalogComponentPackage } from '../src/main/componentCatalogScanner'
import { componentPackagesToArchiveFiles } from '../src/renderer/components/componentPackageStore'
// Teaches the export builders where this host's font bytes are. Without it the
// generated artifacts silently ship without the bundled families they ask for.
import '../src/renderer/export/bundledFontEmbedSourceNode'
import {
  importComponentPackage,
  type ImportedComponentPackage,
} from '../src/renderer/components/importComponentPackage'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackage,
} from '../src/renderer/export/course/buildCoursePackages'
import { createBlankCourseProject } from '../src/renderer/project/createCourseProject'
import {
  createExternalComponentNode,
  createTextNode,
} from '../src/renderer/project/createProject'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../src/renderer/project/courseProjectArchive'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const componentCatalogRoot = process.env.COURSEWARE_COMPONENTS_DIR
  ? path.resolve(process.env.COURSEWARE_COMPONENTS_DIR)
  : path.resolve(projectRoot, '..', 'courseware-components')
const outputRoot = path.join(projectRoot, 'artifacts', 'component-catalog-matrix')
const playerBundlePath = path.join(projectRoot, 'dist-player', 'player.iife.js')
const basename = 'component-catalog-v9-matrix'
const projectJsonPath = path.join(outputRoot, `${basename}.project.json`)
const lessonPath = path.join(outputRoot, `${basename}.h5lesson`)
const htmlPath = path.join(outputRoot, `${basename}.html`)
const webPackagePath = path.join(outputRoot, `${basename}-web.zip`)
const evidencePath = path.join(outputRoot, 'matrix-build-evidence.json')
const staleV8Basenames = [
  'component-catalog-v8-matrix.project.json',
  'component-catalog-v8-matrix.h5lesson',
  'component-catalog-v8-matrix.html',
  'component-catalog-v8-matrix-web.zip',
]
const buildTimestamp = '2026-08-11T00:00:00.000Z'
const archiveTimestamp = new Date(buildTimestamp)
const expectedPackageCount = 4

function setPath(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const parts = dottedPath.split('.')
  let current = target
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value
      return
    }
    const next = current[part]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  })
}

function preferredTextProperty(
  properties: readonly ComponentEditorProperty[],
): Extract<ComponentEditorProperty, { type: 'text' | 'textarea' }> | undefined {
  const text = properties.filter((property): property is Extract<
    ComponentEditorProperty,
    { type: 'text' | 'textarea' }
  > => property.type === 'text' || property.type === 'textarea')
  return text.find((property) => /(?:title|caption|body|markup|pairs)$/i.test(property.key))
    ?? text.find((property) => property.key.startsWith('content.'))
    ?? text[0]
}

function matrixProps(
  component: ComponentPackageData,
  index: number,
): { props: Record<string, unknown>; textPath?: string; baseText?: string; stateText?: string } {
  const props = structuredClone(component.manifest.defaultProps)
  const property = preferredTextProperty(component.manifest.editor?.properties ?? [])
  if (!property) return { props }
  const baseText = `矩阵 ${String(index + 1).padStart(2, '0')} · ${component.manifest.name}`
  const stateText = `状态覆盖 ${String(index + 1).padStart(2, '0')} · ${component.manifest.name}`
  setPath(props, property.key, baseText)
  if (Object.prototype.hasOwnProperty.call(props, 'showCaption')) props.showCaption = true
  if (Object.prototype.hasOwnProperty.call(props, 'showTitle')) props.showTitle = true
  if (Object.prototype.hasOwnProperty.call(props, 'showEyebrow')) props.showEyebrow = true
  if (Object.prototype.hasOwnProperty.call(props, 'showSteps')) props.showSteps = true
  if (Object.prototype.hasOwnProperty.call(props, 'showLegend')) props.showLegend = true
  if (Object.prototype.hasOwnProperty.call(props, 'showGlobalControls')) props.showGlobalControls = true
  return { props, textPath: property.key, baseText, stateText }
}

function componentLayer(
  component: ComponentPackageData,
  index: number,
): {
  item: ComponentLayerItem
  textPath?: string
  baseText?: string
  stateText?: string
} {
  const authored = matrixProps(component, index)
  const node = createExternalComponentNode({
    id: `matrix_component_${String(index + 1).padStart(2, '0')}`,
    name: `矩阵组件 ${String(index + 1).padStart(2, '0')} · ${component.manifest.name}`,
    component: {
      packageId: component.manifest.id,
      version: component.manifest.version,
    },
    x: 80,
    y: 145,
    width: 1120,
    height: 500,
    props: authored.props,
  })
  const item = sceneNodeToCourseLayerItem(node, 1)
  if (item.kind !== 'component') {
    throw new Error(`${component.manifest.id} 未能写成 component 图层`)
  }
  return { item, ...authored }
}

function presentationForComponent(
  item: ComponentLayerItem,
  textPath: string | undefined,
  stateText: string | undefined,
): SlideSceneDocument['presentation'] {
  const overrideProps = structuredClone(item.props)
  if (textPath && stateText) setPath(overrideProps, textPath, stateText)
  return {
    initialStateId: 'state_initial',
    thumbnailStateId: 'state_matrix_override',
    states: [
      { id: 'state_initial', name: '基础', layerItemOverrides: {} },
      {
        id: 'state_matrix_override',
        name: '矩阵状态覆盖',
        layerItemOverrides: textPath && stateText
          ? { [item.layerItemId]: { componentProps: overrideProps } }
          : {},
      },
    ],
  }
}

function requireSlideSurface(project: CourseProjectDocument) {
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') {
    throw new Error('空白 Course Project 必须包含 Slide 表面')
  }
  return surface
}

async function removeStaleV8Outputs(): Promise<void> {
  await Promise.all(staleV8Basenames.map(async (name) => {
    const stalePath = path.join(outputRoot, name)
    if (existsSync(stalePath)) await fs.unlink(stalePath)
  }))
}

async function main(): Promise<void> {
  const catalogPath = path.join(componentCatalogRoot, 'catalog.json')
  if (!existsSync(catalogPath)) {
    console.warn(`跳过四组件矩阵生成：未找到 ${catalogPath}`)
    return
  }

  const [catalog, playerBundle] = await Promise.all([
    scanComponentCatalogDirectory(componentCatalogRoot, 'prompt'),
    fs.readFile(playerBundlePath, 'utf8'),
  ])
  if (catalog.packages.length !== expectedPackageCount || catalog.issues.length !== 0) {
    throw new Error(
      `矩阵要求 ${expectedPackageCount} 个无完整性错误的目录组件；发现 ${catalog.packages.length} 个，问题 ${catalog.issues.length} 项。`,
    )
  }

  const components: Record<string, ImportedComponentPackage> = Object.create(null) as Record<
    string,
    ImportedComponentPackage
  >
  for (const entry of catalog.packages) {
    const file = await readCatalogComponentPackage(catalog, entry.packageId, entry.version)
    const imported = importComponentPackage(file.bytes, {
      expectedId: entry.packageId,
      expectedVersion: entry.version,
      provenance: {
        sha256: file.sha256,
        importedAt: buildTimestamp,
        sourceLabel: entry.sourceLabel,
      },
    })
    components[entry.packageId] = imported
  }

  const project = createBlankCourseProject({
    id: 'project_component_catalog_v9_matrix',
    title: 'Component Catalog V9 四组件矩阵',
    now: buildTimestamp,
    includeDefaultController: false,
    controls: 'none',
  })
  const surface = requireSlideSurface(project)
  const scenes: SlideSceneDocument[] = catalog.packages.map((entry, index) => {
    const component = components[entry.packageId]!
    const title = sceneNodeToCourseLayerItem(createTextNode({
      id: `matrix_title_${String(index + 1).padStart(2, '0')}`,
      name: '矩阵场景标题',
      text: `${entry.name} · ${entry.packageId}@${entry.version}`,
      x: 56,
      y: 28,
      width: 1168,
      height: 78,
      style: {
        fontSize: 30,
        bold: true,
        color: '#172033',
        backgroundColor: '#ffffff',
        backgroundOpacity: 0.86,
        cornerRadius: 14,
      },
    }), 0)
    const authored = componentLayer(component, index)
    return {
      id: `scene_component_${String(index + 1).padStart(2, '0')}`,
      name: `${String(index + 1).padStart(2, '0')} · ${entry.name}`,
      backgroundColor: index % 2 === 0 ? '#f8fafc' : '#eef2ff',
      backgroundAssetId: null,
      layerItems: [title, authored.item],
      presentation: presentationForComponent(
        authored.item,
        authored.textPath,
        authored.stateText,
      ),
      interactions: [],
    }
  })
  surface.title = project.title
  surface.scenes = scenes
  project.locations = scenes.map((scene) => ({
    id: scene.id,
    label: `${surface.title} · ${scene.name}`,
    kind: 'slide-scene' as const,
    surfaceId: surface.id,
    sceneId: scene.id,
  }))
  project.startLocationId = scenes[0]!.id
  project.componentPackages = Object.fromEntries(
    catalog.packages.map((entry) => [
      entry.packageId,
      { ...components[entry.packageId]!.metadata },
    ]),
  )
  project.updatedAt = buildTimestamp

  const parsedProject = courseProjectDocumentSchema.parse(project)
  const componentFiles = componentPackagesToArchiveFiles(components)
  const archive = createCourseProjectArchive(
    { project: parsedProject, assetFiles: {}, componentFiles },
    { mtime: archiveTimestamp },
  )
  const reopened = openCourseProjectArchive(archive)
  const reopenedSlide = reopened.project.surfaces.find((candidate) => candidate.type === 'slide')
  if (
    reopened.project.schemaVersion !== 9 ||
    (reopenedSlide?.type === 'slide' ? reopenedSlide.scenes.length : 0) !== expectedPackageCount ||
    Object.keys(reopened.project.componentPackages).length !== expectedPackageCount ||
    Object.keys(reopened.componentFiles).length !== expectedPackageCount
  ) {
    throw new Error('四组件矩阵工程保存重开后结构不完整。')
  }
  for (const entry of catalog.packages) {
    const contentSha256 = components[entry.packageId]!.contentSha256
    if (reopened.project.componentPackages[entry.packageId]?.contentSha256 !== contentSha256) {
      throw new Error(`${entry.packageId}@${entry.version} 保存重开后内容哈希不一致。`)
    }
  }

  const sources = { project: parsedProject, assetFiles: {}, components }
  const standaloneHtml = buildPublishedCourseStandaloneHtml(sources, { playerBundle, lang: 'zh-CN' })
  const webPackage = buildPublishedCourseWebPackage(sources, { playerBundle, lang: 'zh-CN' })
  const evidence = {
    generatedAt: buildTimestamp,
    quality: 'experimental',
    catalogRoot: componentCatalogRoot,
    projectSchemaVersion: parsedProject.schemaVersion,
    publishedCourseFormat: 'published-course-v2',
    componentSchemaVersion: 4,
    runtimeApiVersion: 4,
    sceneCount: reopenedSlide && reopenedSlide.type === 'slide' ? reopenedSlide.scenes.length : 0,
    packageCount: catalog.packages.length,
    packages: catalog.packages.map((entry) => ({
      packageId: entry.packageId,
      version: entry.version,
      sha256: entry.sha256,
      contentSha256: components[entry.packageId]!.contentSha256,
      quality: entry.quality,
      releaseBlockers: entry.releaseBlockers ?? [],
    })),
    outputs: {
      projectJson: path.basename(projectJsonPath),
      lesson: path.basename(lessonPath),
      standaloneHtml: path.basename(htmlPath),
      webPackage: path.basename(webPackagePath),
    },
  }

  await fs.mkdir(outputRoot, { recursive: true })
  await Promise.all([
    fs.writeFile(projectJsonPath, `${JSON.stringify(parsedProject, null, 2)}\n`, 'utf8'),
    fs.writeFile(lessonPath, archive),
    fs.writeFile(htmlPath, standaloneHtml, 'utf8'),
    fs.writeFile(webPackagePath, webPackage),
    fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'),
  ])
  await removeStaleV8Outputs()

  console.log(`已生成四组件 Course Project V9 矩阵：${lessonPath}`)
  console.log(`已生成离线单 HTML：${htmlPath}`)
  console.log(`已生成离线网页包：${webPackagePath}`)
  console.log(`已生成矩阵证据：${evidencePath}`)
}

main().catch((error: unknown) => {
  console.error('四组件 V9 矩阵生成失败', error)
  process.exitCode = 1
})
