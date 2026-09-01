import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { createImageNode, createProject } from '@/renderer/project/createProject'
import { createBlankCourseProject, createCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  detectCourseProjectArchiveFormat,
  inspectCourseProjectArchiveIdentity,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '@/renderer/project/courseProjectArchive'
import {
  shouldMarkCourseProjectDirty,
  shouldOfferCourseProjectRecovery,
} from '@/renderer/project/courseProjectLifecycle'
import { createProjectArchive, openProjectArchive } from '@/renderer/project/projectArchive'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { ComponentManifest } from '@/shared/componentTypes'
import { UserFacingError } from '@/shared/errors'

const NOW = '2026-08-17T12:00:00.000Z'
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/course-project-v9')
const DIAGRAM_BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

function makeComponentFiles(): Record<string, Uint8Array> {
  const manifest: ComponentManifest = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    renderMode: 'phaser',
    supportedScopes: ['scene', 'global'],
    id: 'com.example.archive-chart',
    name: '归档图表',
    version: '1.2.3',
    entry: 'runtime.js',
    thumbnail: 'thumbnail.png',
    defaultSize: { width: 480, height: 280 },
    minSize: { width: 160, height: 100 },
    preserveAspectRatio: true,
    assets: {},
    defaultProps: { value: 1 },
  }
  return {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'runtime.js': strToU8(
      "window.CoursewareComponent.define({id:'com.example.archive-chart',runtimeApiVersion:4,create:function(){return {destroy:function(){}}}})",
    ),
    'thumbnail.png': new Uint8Array([137, 80, 78, 71]),
  }
}

function makeV8ArchiveBytes() {
  const project = createProject({
    id: 'legacy-archive',
    title: '旧版归档',
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  return createProjectArchive({
    project,
    assetFiles: {},
    componentFiles: {},
  }, { mtime: NOW })
}

function attachComponent(data: CourseProjectArchiveData): CourseProjectArchiveData {
  const packageFiles = makeComponentFiles()
  const component = parseComponentPackageFiles(packageFiles)
  const project = structuredClone(data.project)
  project.componentPackages[component.metadata.packageId] = component.metadata
  return {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: data.assetFiles,
    componentFiles: { [component.key]: packageFiles },
  }
}

function loadSlideNativeFixture(): CourseProjectArchiveData {
  const project = courseProjectDocumentSchema.parse(
    JSON.parse(readFileSync(join(FIXTURE_DIR, 'slide-native.json'), 'utf8')),
  ) as CourseProjectDocument
  return attachComponent({
    project,
    assetFiles: { diagram: DIAGRAM_BYTES },
    componentFiles: {},
  })
}

function makeBlankV9ArchiveData(): CourseProjectArchiveData {
  const project = createBlankCourseProject({
    id: 'v9-blank-archive',
    title: '空白 V9 归档',
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected slide surface')
  const scene = surface.scenes[0]!
  scene.layerItems.push(sceneNodeToCourseLayerItem(createImageNode({
    id: 'image_node',
    assetId: 'diagram',
    width: 200,
    height: 200,
  }), 0))
  project.assets.diagram = {
    id: 'diagram',
    filename: 'diagram.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/diagram.bin',
    byteLength: DIAGRAM_BYTES.byteLength,
    width: 2,
    height: 2,
  }
  return attachComponent({
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: { diagram: DIAGRAM_BYTES },
    componentFiles: {},
  })
}

describe('Course Project V9 archive', () => {
  it('round-trips schema, asset bytes and embedded component files from a V9 fixture', () => {
    const data = loadSlideNativeFixture()
    const bytes = createCourseProjectArchive(data, { mtime: NOW })
    const reopened = openCourseProjectArchive(bytes)

    expect(courseProjectDocumentSchema.parse(reopened.project)).toEqual(data.project)
    expect(reopened.project.schemaVersion).toBe(9)
    expect('scenes' in reopened.project).toBe(false)
    expect([...reopened.assetFiles.diagram!]).toEqual([...DIAGRAM_BYTES])
    const componentKey = Object.keys(data.componentFiles)[0]!
    expect(Object.keys(reopened.componentFiles[componentKey]!).sort()).toEqual(
      Object.keys(data.componentFiles[componentKey]!).sort(),
    )
    expect([...reopened.componentFiles[componentKey]!['runtime.js']!]).toEqual(
      [...data.componentFiles[componentKey]!['runtime.js']!],
    )
    expect(createCourseProjectArchive(reopened, { mtime: NOW })).toEqual(bytes)
    expect(inspectCourseProjectArchiveIdentity(bytes)).toMatchObject({
      schemaVersion: 9,
      projectId: 'v9-slide-native',
      title: 'V9 原生幻灯',
    })
  })

  it('round-trips a blank V9 factory document with save/reopen', () => {
    const data = makeBlankV9ArchiveData()
    const bytes = createCourseProjectArchive(data, { mtime: NOW })
    const reopened = openCourseProjectArchive(bytes)
    expect(reopened.project.schemaVersion).toBe(9)
    expect(reopened.project.id).toBe('v9-blank-archive')
    expect([...reopened.assetFiles.diagram!]).toEqual([...DIAGRAM_BYTES])
    expect(createCourseProjectArchive(reopened, { mtime: NOW })).toEqual(bytes)
  })

  it('opens schemaVersion 9, rejects other integer versions, and treats missing versions as corrupted', () => {
    const v8Bytes = makeV8ArchiveBytes()
    const v9Bytes = createCourseProjectArchive(loadSlideNativeFixture(), { mtime: NOW })

    expect(detectCourseProjectArchiveFormat(v8Bytes)).toMatchObject({
      kind: 'unsupported',
      identity: { schemaVersion: 8, projectId: 'legacy-archive' },
    })
    expect(detectCourseProjectArchiveFormat(v9Bytes)).toMatchObject({
      kind: 'v9',
      identity: { schemaVersion: 9, projectId: 'v9-slide-native' },
    })
    expect(detectCourseProjectArchiveFormat(new Uint8Array([1, 2, 3, 4]))).toMatchObject({
      kind: 'corrupted',
    })
    expect(detectCourseProjectArchiveFormat(new Uint8Array())).toMatchObject({
      kind: 'corrupted',
      reason: expect.stringMatching(/空/),
    })

    const unsupported = zipSync({
      'project.json': strToU8(JSON.stringify({
        schemaVersion: 10,
        id: 'future',
        title: '不支持',
      })),
    })
    expect(detectCourseProjectArchiveFormat(unsupported)).toMatchObject({
      kind: 'unsupported',
      identity: { schemaVersion: 10, projectId: 'future' },
    })
    expect(() => openCourseProjectArchive(unsupported)).toThrow(/版本不支持|格式版本为 10/)

    expect(() => openCourseProjectArchive(v8Bytes)).toThrow(/版本不支持|格式版本为 8/)
    expect(() => openCourseProjectArchive(v8Bytes)).toThrow(UserFacingError)
    expect(() => {
      try {
        openCourseProjectArchive(v8Bytes)
      } catch (error) {
        expect(error).toBeInstanceOf(UserFacingError)
        expect(String(error)).not.toMatch(/导入旧版工程|显式迁移/)
        throw error
      }
    }).toThrow(UserFacingError)

    expect(() => openProjectArchive(v9Bytes)).toThrow(/V9/)
    expect(() => openCourseProjectArchive(v9Bytes)).not.toThrow()

    const missingAsset = unzipSync(v9Bytes)
    delete missingAsset['assets/diagram.bin']
    expect(() => openCourseProjectArchive(zipSync(missingAsset))).toThrow(/缺少素材/)

    const unversionedV9Shape = zipSync({
      'project.json': strToU8(JSON.stringify({
        id: 'unversioned-v9',
        title: '缺版本',
        locations: [],
        surfaces: [],
      })),
    })
    expect(detectCourseProjectArchiveFormat(unversionedV9Shape)).toMatchObject({
      kind: 'corrupted',
      identity: { schemaVersion: null },
    })
    expect(() => openCourseProjectArchive(unversionedV9Shape)).toThrow(/损坏|schemaVersion/)

    const unversionedV8Shape = zipSync({
      'project.json': strToU8(JSON.stringify({
        id: 'unversioned-v8',
        title: '缺版本',
        scenes: [],
      })),
    })
    expect(detectCourseProjectArchiveFormat(unversionedV8Shape)).toMatchObject({
      kind: 'corrupted',
      identity: { schemaVersion: null },
    })

    expect(shouldMarkCourseProjectDirty('document')).toBe(true)
    expect(shouldMarkCourseProjectDirty('selection')).toBe(false)
    expect(shouldOfferCourseProjectRecovery({
      recovery: {
        schemaVersion: 8,
        projectId: 'legacy-archive',
        revision: 0,
        updatedAt: null,
        title: null,
      },
      official: null,
    })).toBe('ignore-legacy-default')
    expect(shouldOfferCourseProjectRecovery({
      recovery: inspectCourseProjectArchiveIdentity(v9Bytes),
      official: null,
    })).toBe('offer')
  })
})

describe('createBlankCourseProject', () => {
  it('constructs Course Project V9 directly without V8 document fields', () => {
    const project = createBlankCourseProject({
      id: 'blank-direct',
      title: '直接空白',
      now: NOW,
    })
    const aliased = createCourseProject({
      id: 'blank-alias',
      title: '别名空白',
      now: NOW,
    })
    expect(project.schemaVersion).toBe(9)
    expect(aliased.schemaVersion).toBe(9)
    expect('scenes' in project).toBe(false)
    expect('globalLayer' in project).toBe(false)
    expect('canvas' in project).toBe(false)
    expect(project.revision).toBe(0)
    expect(project.surfaces[0]).toMatchObject({ type: 'slide', title: '直接空白' })
    expect(project.locations[0]).toMatchObject({
      kind: 'slide-scene',
      sceneId: project.startLocationId,
    })
    expect(project.globalLayerItems.some((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))).toBe(true)
    const controller = project.globalLayerItems.find((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))
    if (!controller || controller.item.kind !== 'native' ||
      controller.item.content.nativeType !== 'teacher-controller') {
      throw new Error('expected teacher controller')
    }
    expect(controller.plane).toBe('overlay')
    expect(controller.item.content.data.defaultCollapsed).toBe(true)
    expect(courseProjectDocumentSchema.parse(structuredClone(project))).toEqual(project)
    expect(courseProjectDocumentSchema.parse(structuredClone(aliased))).toEqual(aliased)
  })

  it.each([true, false])(
    'preserves an explicit defaultCollapsed=%s through save and reopen',
    (defaultCollapsed) => {
      const project = createBlankCourseProject({
        id: `blank-explicit-${defaultCollapsed}`,
        title: '显式折叠设置',
        now: NOW,
      })
      const controller = project.globalLayerItems.find((entry) => (
        entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
      ))
      if (!controller || controller.item.kind !== 'native' ||
        controller.item.content.nativeType !== 'teacher-controller') {
        throw new Error('expected teacher controller')
      }
      controller.item.content.data.defaultCollapsed = defaultCollapsed
      const revisionBeforeSave = project.revision

      const bytes = createCourseProjectArchive({
        project: courseProjectDocumentSchema.parse(project),
        assetFiles: {},
        componentFiles: {},
      }, { mtime: NOW })
      const reopened = openCourseProjectArchive(bytes)
      const reopenedController = reopened.project.globalLayerItems.find((entry) => (
        entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
      ))
      if (!reopenedController || reopenedController.item.kind !== 'native' ||
        reopenedController.item.content.nativeType !== 'teacher-controller') {
        throw new Error('expected reopened teacher controller')
      }

      expect(reopenedController.plane).toBe('overlay')
      expect(reopenedController.item.content.data.defaultCollapsed).toBe(defaultCollapsed)
      expect(reopened.project.revision).toBe(revisionBeforeSave)
      expect(reopened.project).toEqual(project)
    },
  )
})
