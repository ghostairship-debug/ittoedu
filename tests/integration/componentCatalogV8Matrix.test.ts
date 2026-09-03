import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  ComponentCreateContextV4Dom,
  ComponentEditorProperty,
} from '@/shared/componentTypes'
import type { EditorCanvasNode } from '@/renderer/phaser/editorCanvasNode'
import { materializeScene } from '@/shared/presentation'
import { scanComponentCatalogDirectory, readCatalogComponentPackage } from '@/main/componentCatalogScanner'
import { componentPackagesFromArchive, componentPackagesToArchiveFiles } from '@/renderer/components/componentPackageStore'
import { executeComponentRuntime } from '@/renderer/components/executeComponentRuntime'
import {
  importComponentPackage,
  type ImportedComponentPackage,
} from '@/renderer/components/importComponentPackage'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectActivePresentationStateId,
  selectActiveScene,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'

function materialized(
  scene: object,
  stateId?: string | null,
) {
  return materializeScene(scene as Parameters<typeof materializeScene>[0], stateId)
}

const componentCatalogRoot = process.env.COURSEWARE_COMPONENTS_DIR
  ? path.resolve(process.env.COURSEWARE_COMPONENTS_DIR)
  : path.resolve(process.cwd(), '..', 'courseware-components')
const catalogAvailable = existsSync(path.join(componentCatalogRoot, 'catalog.json'))
const catalogDescribe = catalogAvailable ? describe : describe.skip
const importedAt = '2026-08-11T00:00:00.000Z'
const expectedPackageCount = 4

const expectedCanvasTextKeys: Readonly<Record<string, readonly string[]>> = {
  'com.ittoedu.language.reading-annotation': [
    'content.legendEmphasis',
    'content.legendLiaison',
    'content.legendPause',
    'content.markup',
    'content.pauseSymbol',
    'content.title',
  ],
  'com.ittoedu.language.pinyin-annotation': [
    'content.hideAllLabel',
    'content.pairs',
    'content.showAllLabel',
    'content.title',
  ],
  'com.ittoedu.visual.text-container': [
    'content.body',
    'content.eyebrow',
    'content.steps',
    'content.title',
  ],
  'com.ittoedu.visual.image-frame': ['content.caption'],
}

const expectedVisualStyles: Readonly<Record<string, readonly string[]>> = {
  'com.ittoedu.visual.text-container': [
    'transparent-glass',
    'frosted-glass',
    'sticky-note',
    'torn-paper',
    'file-folder',
  ],
  'com.ittoedu.visual.image-frame': ['brush', 'sticker'],
}

function setPath(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const parts = dottedPath.split('.')
  let current = target
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value
      return
    }
    const next = current[part]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) current[part] = {}
    current = current[part] as Record<string, unknown>
  })
}

function getPath(target: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((current, part) => (
    typeof current === 'object' && current !== null
      ? Reflect.get(current, part)
      : undefined
  ), target)
}

function textProperty(component: ImportedComponentPackage): Extract<
  ComponentEditorProperty,
  { type: 'text' | 'textarea' }
> | undefined {
  return component.manifest.editor?.properties.find((property): property is Extract<
    ComponentEditorProperty,
    { type: 'text' | 'textarea' }
  > => (
    (property.type === 'text' || property.type === 'textarea') &&
    property.key.startsWith('content.') &&
    !/(?:ariaLabel|alt)$/i.test(property.key)
  ))
}

type CatalogCanvasComponent = EditorCanvasNode & {
  type: 'external-component'
  component: { packageId: string; version: string }
  props: Record<string, unknown>
}

function isCatalogCanvasComponent(node: EditorCanvasNode): node is CatalogCanvasComponent {
  return node.type === 'external-component' && node.component != null && node.props != null
}

function activeExternalNodes(): CatalogCanvasComponent[] {
  return selectActiveScene(useEditorStore.getState()).nodes.filter(isCatalogCanvasComponent)
}

async function loadCatalogPackages(): Promise<ImportedComponentPackage[]> {
  const catalog = await scanComponentCatalogDirectory(componentCatalogRoot, 'prompt')
  if (catalog.packages.length !== expectedPackageCount || catalog.issues.length !== 0) {
    throw new Error(`四组件目录不完整：${catalog.packages.length} 个包，${catalog.issues.length} 项问题`)
  }
  return Promise.all(catalog.packages.map(async (entry) => {
    const file = await readCatalogComponentPackage(catalog, entry.packageId, entry.version)
    return importComponentPackage(file.bytes, {
      expectedId: entry.packageId,
      expectedVersion: entry.version,
      provenance: {
        sha256: file.sha256,
        importedAt,
        sourceLabel: entry.sourceLabel,
      },
    })
  }))
}

catalogDescribe('四组件 Course Project V9 编辑、归档与生命周期矩阵', () => {
  let packages: ImportedComponentPackage[] = []
  let originalDecode: typeof HTMLImageElement.prototype.decode | undefined

  beforeAll(async () => {
    packages = await loadCatalogPackages()
    originalDecode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = () => Promise.resolve()
  })

  afterAll(() => {
    if (originalDecode) HTMLImageElement.prototype.decode = originalDecode
    else delete (HTMLImageElement.prototype as { decode?: unknown }).decode
  })

  it('逐包按需嵌入，并覆盖属性编辑、插入删除、撤销重做和状态覆盖', () => {
    useEditorStore.getState().createNewProject()
    useEditorStore.setState({ editorMode: 'professional' })

    for (const [index, component] of packages.entries()) {
      useEditorStore.getState().importComponentPackage(component)
      useEditorStore.getState().addExternalComponentNode(
        component.manifest.id,
        40 + index * 8,
        80 + index * 6,
      )
      let node = activeExternalNodes().find(
        (candidate) => candidate.component.packageId === component.manifest.id,
      )
      expect(node, component.manifest.id).toBeDefined()

      const property = textProperty(component)
      if (node && property) {
        const before = getPath(node.props, property.key)
        const nextProps = structuredClone(node.props)
        setPath(nextProps, property.key, `基础属性编辑 ${index + 1} · ${component.manifest.name}`)
        useEditorStore.getState().updateNode(node.id, { props: nextProps })
        node = activeExternalNodes().find((candidate) => candidate.id === node!.id)
        expect(getPath(node!.props, property.key)).toBe(`基础属性编辑 ${index + 1} · ${component.manifest.name}`)
        useEditorStore.getState().undo()
        expect(getPath(
          activeExternalNodes().find((candidate) => candidate.id === node!.id)!.props,
          property.key,
        )).toEqual(before)
        useEditorStore.getState().redo()
        expect(getPath(
          activeExternalNodes().find((candidate) => candidate.id === node!.id)!.props,
          property.key,
        )).toBe(`基础属性编辑 ${index + 1} · ${component.manifest.name}`)
      }

      const nodeId = node!.id
      useEditorStore.getState().deleteNode(nodeId)
      expect(activeExternalNodes().some((candidate) => candidate.id === nodeId)).toBe(false)
      useEditorStore.getState().undo()
      expect(activeExternalNodes().some((candidate) => candidate.id === nodeId)).toBe(true)
      useEditorStore.getState().redo()
      expect(activeExternalNodes().some((candidate) => candidate.id === nodeId)).toBe(false)
      useEditorStore.getState().undo()
    }

    expect(activeExternalNodes()).toHaveLength(expectedPackageCount)
    useEditorStore.getState().addPresentationState('四组件状态覆盖')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())
    expect(stateId).toBeTruthy()
    for (const [index, component] of packages.entries()) {
      const node = activeExternalNodes().find(
        (candidate) => candidate.component.packageId === component.manifest.id,
      )!
      const property = textProperty(component)
      if (!property) continue
      const props = structuredClone(node.props)
      setPath(props, property.key, `状态属性编辑 ${index + 1} · ${component.manifest.name}`)
      useEditorStore.getState().updateNode(node.id, { props })
    }

    const scene = selectActiveScene(useEditorStore.getState())
    const materializedScene = materialized(scene, stateId)
    for (const [index, component] of packages.entries()) {
      const property = textProperty(component)
      if (!property) continue
      const base = scene.nodes.find(
        (node): node is CatalogCanvasComponent =>
          isCatalogCanvasComponent(node) && node.component.packageId === component.manifest.id,
      )!
      const effective = materializedScene.nodes.find(
        (node): node is CatalogCanvasComponent =>
          isCatalogCanvasComponent(node) && node.component.packageId === component.manifest.id,
      )!
      expect(getPath(base.props, property.key)).toBe(`基础属性编辑 ${index + 1} · ${component.manifest.name}`)
      expect(getPath(effective.props, property.key)).toBe(`状态属性编辑 ${index + 1} · ${component.manifest.name}`)
    }
  })

  it('保存重开后保留四个精确包、来源元数据、实例与状态覆盖', () => {
    const state = useEditorStore.getState()
    const project = selectActiveCourseProjectDocument(state)
    expect(project, '当前会话必须是 Course Project V9').toBeTruthy()
    const archive = createCourseProjectArchive({
      project: project!,
      assetFiles: selectMediaAssetFiles(state),
      componentFiles: componentPackagesToArchiveFiles(state.componentPackages),
    }, { mtime: new Date(importedAt) })
    const reopened = openCourseProjectArchive(archive)
    const restoredPackages = componentPackagesFromArchive(
      reopened.project,
      reopened.componentFiles,
    )

    expect(reopened.project.schemaVersion).toBe(9)
    expect(Object.keys(reopened.project.componentPackages)).toHaveLength(expectedPackageCount)
    expect(Object.keys(restoredPackages)).toHaveLength(expectedPackageCount)
    for (const component of packages) {
      const metadata = reopened.project.componentPackages[component.manifest.id]
      expect(metadata).toMatchObject({
        packageId: component.manifest.id,
        version: component.manifest.version,
        contentSha256: component.contentSha256,
        sha256: component.provenance!.sha256,
        importedAt,
        sourceLabel: component.provenance!.sourceLabel,
      })
      expect(restoredPackages[component.manifest.id]?.runtimeSource)
        .toBe(component.runtimeSource)
    }
    const slide = reopened.project.surfaces.find((surface) => surface.type === 'slide')
    expect(slide?.type === 'slide' ? slide.scenes[0]?.presentation?.states : undefined)
      .toHaveLength(2)

    useEditorStore.getState().loadCourseProject(
      reopened.project,
      'component-catalog-v9-matrix.h5lesson',
      reopened.assetFiles,
      restoredPackages,
    )
    expect(activeExternalNodes()).toHaveLength(expectedPackageCount)
  })

  it('四个真实 runtime 完成创建、更新、显隐、暂停、捕获和幂等销毁，所有可见文字目标均已登记', async () => {
    const failures: Array<{ packageId: string; error: unknown }> = []
    for (const [index, component] of packages.entries()) {
      const captureTasks: Promise<unknown>[] = []
      const root = document.createElement('div')
      document.body.append(root)
      try {
        const definition = executeComponentRuntime(
          component.runtimeSource,
          component.manifest.id,
        )
        const context: ComponentCreateContextV4Dom = {
          runtimeApiVersion: 4,
          renderMode: 'dom',
          dom: { root },
          instanceId: `matrix_lifecycle_${index + 1}`,
          width: component.manifest.defaultSize.width,
          height: component.manifest.defaultSize.height,
          mode: 'capture',
          props: structuredClone(component.manifest.defaultProps),
          editorState: {},
          actions: {
            goToScene: () => true,
            nextScene: () => true,
            previousScene: () => true,
            replayScene: () => true,
            restartCourse: () => true,
          },
          scope: 'scene',
          capture: { waitUntil: (promise) => captureTasks.push(Promise.resolve(promise)) },
          assetUrl: () => 'data:image/png;base64,iVBORw0KGgo=',
          projectAssetUrl: () => 'data:image/png;base64,iVBORw0KGgo=',
          emit: vi.fn(),
        }
        const lifecycle = definition.create(context)
        expect(root.childElementCount, component.manifest.id).toBeGreaterThan(0)
        const canvasTextKeys = [...root.querySelectorAll<HTMLElement>(
          '[data-courseware-edit-key]',
        )].map((element) => element.dataset.coursewareEditKey!).sort()
        expect(canvasTextKeys, component.manifest.id).toEqual(
          [...(expectedCanvasTextKeys[component.manifest.id] ?? [])].sort(),
        )
        lifecycle.setMode?.('edit')
        lifecycle.resize?.(
          component.manifest.defaultSize.width + 20,
          component.manifest.defaultSize.height + 10,
        )
        lifecycle.updateProps?.(structuredClone(component.manifest.defaultProps))
        const stage = root.querySelector<HTMLElement>('.stage')
        for (const visualStyle of expectedVisualStyles[component.manifest.id] ?? []) {
          const props = structuredClone(component.manifest.defaultProps)
          Reflect.set(props, 'visualStyle', visualStyle)
          lifecycle.updateProps?.(props)
          expect(stage?.dataset.style, `${component.manifest.id}:${visualStyle}`)
            .toBe(visualStyle)
        }
        lifecycle.setVisible?.(false)
        lifecycle.suspend?.()
        lifecycle.setVisible?.(true)
        lifecycle.resume?.()
        await Promise.all(captureTasks.splice(0))
        await lifecycle.prepareCapture?.()
        await Promise.all(captureTasks.splice(0))
        lifecycle.destroy()
        lifecycle.destroy()
        expect(root.childElementCount, component.manifest.id).toBe(0)
      } catch (error) {
        failures.push({ packageId: component.manifest.id, error })
      } finally {
        root.remove()
      }
    }
    expect(failures).toEqual([])
  })
})
