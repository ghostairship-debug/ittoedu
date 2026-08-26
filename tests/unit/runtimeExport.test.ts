import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ComponentManifestV4,
  ComponentPackageData,
  ExportPayload,
} from '../../src/shared/componentTypes'
import type { ProjectDocument } from '../../src/shared/projectTypes'
import type { PublishedLessonPayload } from '../../src/shared/publishedLessonTypes'
import { buildExportPayload } from '../../src/renderer/export/buildExportPayload'
import {
  buildPdfPrintHtml,
  buildPptx,
} from '../../src/renderer/export/buildPptx'
import { buildStandaloneHtml } from '../../src/renderer/export/buildStandaloneHtml'
import { buildWebPackageFiles } from '../../src/renderer/export/buildWebPackage'
import { pptxGlobalComponentSnapshotKey } from '../../src/renderer/export/pptxShared'
import { runtimeSnapshotKey } from '../../src/renderer/export/exportPayloadSupport'
import {
  decodePublishedCode,
  publishedLessonToExportPayload,
} from '../../src/player/publishedLesson'
import {
  createImageNode,
  createShapeNode,
  createTextNode,
} from '../../src/renderer/project/createProject'
import { createProjectV8Fields } from '../helpers/projectV8'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nOQAAAAASUVORK5CYII='

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(PNG_BASE64), (character) =>
    character.charCodeAt(0))
}

function pngDataUrl(): string {
  return `data:image/png;base64,${PNG_BASE64}`
}

const componentManifest: ComponentManifestV4 = {
  schemaVersion: 4,
  runtimeApiVersion: 4,
  supportedScopes: ['global'],
  renderMode: 'phaser',
  id: 'com.example.global-controls',
  name: '全局控制条',
  version: '4.0.0',
  entry: 'runtime.js',
  defaultSize: { width: 260, height: 80 },
  minSize: { width: 160, height: 60 },
  preserveAspectRatio: false,
  assets: { icon: 'assets/icon.png' },
  defaultProps: {
    content: { replay: '重播' },
  },
}

const componentRuntime =
  "window.CoursewareComponent.define({id:'com.example.global-controls',runtimeApiVersion:4,create(){return{destroy(){}}}})"

const componentPackage: ComponentPackageData = {
  manifest: componentManifest,
  runtimeSource: componentRuntime,
  files: { 'assets/icon.png': pngBytes() },
}

function assetMeta(id: string) {
  return {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image' as const,
    path: `assets/${id}.png`,
    byteLength: pngBytes().byteLength,
    width: 1,
    height: 1,
  }
}

function makeProject(): ProjectDocument {
  return {
    schemaVersion: 8,
    id: 'runtime-export-project',
    title: 'Project V8 / Runtime API 2 四格式导出',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    canvas: { width: 1280, height: 720 },
    globalRuntime: {
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'hybrid',
      source:
        "CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){ctx.dom.overlay.textContent=ctx.content.get('title');return{destroy(){}}}})",
      content: { values: { title: '全局提示' } },
      assets: { hero: { assetId: 'runtime-binding' } },
      nodeBindings: { controls: 'global-controls' },
      staticFallback: {
        assetId: 'global-fallback',
        coverage: 'runtime-layer',
        layer: 'underlay',
      },
    },
    scenes: [
      {
        id: 'scene-1',
        name: '场景一',
        backgroundColor: '#ffffff',
        backgroundAssetId: null,
        runtime: {
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'dom',
          source:
            "CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){ctx.dom.overlay.textContent=ctx.content.get('hint');return{destroy(){}}}})",
          content: { values: { hint: '场景提示' } },
          assets: { data: { assetId: 'runtime-binding' } },
          nodeBindings: { title: 'editable-title' },
          staticFallback: {
            assetId: 'scene-fallback',
            coverage: 'runtime-layer',
            layer: 'overlay',
          },
        },
        interactions: [],
        nodes: [
          createTextNode({
            id: 'editable-title',
            name: '可编辑标题',
            text: 'PPTX 中仍可编辑',
          }),
        ],
      },
      {
        id: 'scene-2',
        name: '场景二',
        backgroundColor: '#eef2ff',
        backgroundAssetId: null,
        nodes: [],
        interactions: [],
      },
    ],
    assets: {
      'runtime-binding': assetMeta('runtime-binding'),
      'global-fallback': assetMeta('global-fallback'),
      'scene-fallback': assetMeta('scene-fallback'),
    },
    componentPackages: {
      'com.example.global-controls@4.0.0': {
        packageId: componentManifest.id,
        version: componentManifest.version,
        name: componentManifest.name,
        manifestPath:
          'components/com.example.global-controls@4.0.0/manifest.json',
        runtimePath:
          'components/com.example.global-controls@4.0.0/runtime.js',
        contentSha256: '0'.repeat(64),
      },
    },
    globalLayer: [
      {
        layer: 'overlay',
        visibility: { mode: 'include', sceneIds: ['scene-1'] },
        node: {
          id: 'global-controls',
          name: '全局控制条',
          type: 'external-component',
          x: 980,
          y: 620,
          width: 260,
          height: 80,
          rotation: 0,
          opacity: 1,
          visible: true,
          playbackInitialVisibility: 'inherit',
          locked: false,
          component: {
            packageId: componentManifest.id,
            version: componentManifest.version,
          },
          props: { content: { replay: '重播' } },
        },
      },
    ],
    ...createProjectV8Fields(),
  }
}

function makePayload(): ExportPayload {
  const project = makeProject()
  const bytes = pngBytes()
  return buildExportPayload({
    project,
    assetFiles: Object.fromEntries(
      Object.keys(project.assets).map((assetId) => [assetId, bytes]),
    ),
    componentPackages: {
      'com.example.global-controls@4.0.0': componentPackage,
    },
  })
}

function decodeStandalonePayload(html: string): PublishedLessonPayload {
  const encoded = html.match(
    /window\.__H5_LESSON_PAYLOAD__=("[A-Za-z0-9+/=]+");/,
  )?.[1]
  if (!encoded) throw new Error('测试未找到单 HTML Payload')
  const binary = atob(JSON.parse(encoded) as string)
  return JSON.parse(new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  )) as PublishedLessonPayload
}

function decodeCourseData(bytes: Uint8Array): PublishedLessonPayload {
  const source = strFromU8(bytes)
  const match = source.match(/^window\.__H5_LESSON_PAYLOAD__=(.*);\s*$/s)
  if (!match?.[1]) throw new Error('测试未找到网页包 Payload')
  return JSON.parse(match[1]) as PublishedLessonPayload
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Project V8 / Runtime API 2 网页导出', () => {
  it('单 HTML 原样保留全局/场景运行时、全局组件及全部依赖', () => {
    const payload = makePayload()
    const decoded = decodeStandalonePayload(
      buildStandaloneHtml(payload, 'window.__PLAYER__=true;'),
    )

    const loaded = publishedLessonToExportPayload(decoded)
    expect(loaded.project.globalRuntime).toEqual(payload.project.globalRuntime)
    expect(loaded.project.scenes[0]?.runtime).toEqual(
      payload.project.scenes[0]?.runtime,
    )
    expect(decoded.globalRuntime?.nodeBindings).toEqual({
      controls: 'global-controls',
    })
    expect(decoded.scenes[0]?.runtime?.nodeBindings).toEqual({
      title: 'editable-title',
    })
    expect(Object.keys(decoded.assets).sort()).toEqual([
      'global-fallback',
      'runtime-binding',
      'scene-fallback',
    ])
    expect(
      decodePublishedCode(
        decoded.components['com.example.global-controls@4.0.0']!.code,
      ),
    ).toBe(componentRuntime)
  })

  it('网页包保留同一运行语义，并把素材依赖改写为包内 URL', () => {
    const payload = makePayload()
    const files = buildWebPackageFiles(payload, 'window.__PLAYER__=true;')
    const packaged = decodeCourseData(files['course-data.js']!)
    const loaded = publishedLessonToExportPayload(packaged)

    expect(loaded.project.globalRuntime).toEqual(payload.project.globalRuntime)
    expect(loaded.project.scenes[0]?.runtime).toEqual(
      payload.project.scenes[0]?.runtime,
    )
    expect(packaged.globalRuntime?.nodeBindings).toEqual({
      controls: 'global-controls',
    })
    expect(packaged.scenes[0]?.runtime?.nodeBindings).toEqual({
      title: 'editable-title',
    })
    for (const asset of Object.values(packaged.assets)) {
      expect(asset.url).toMatch(/^\.\/assets\//)
      expect(asset.url).not.toContain('data:')
    }
    const component = packaged.components[
      'com.example.global-controls@4.0.0'
    ]!
    expect(decodePublishedCode(component.code)).toBe(componentRuntime)
    expect(component.assets.icon?.url).toMatch(
      /^\.\/component-assets\/[^/]+\//,
    )
  })

  it('运行时依赖缺失时拒绝生成看似成功但内容不完整的导出', () => {
    const payload = makePayload()
    delete payload.assets['runtime-binding']
    delete payload.project.assets['runtime-binding']
    expect(() =>
      buildStandaloneHtml(payload, 'window.__PLAYER__=true;'),
    ).toThrow('运行时素材绑定')
  })

  it('拒绝跨作用域的 nodeBindings，但允许场景与全局运行时各自绑定合法节点', () => {
    const scenePayload = makePayload()
    scenePayload.project.scenes[0]!.runtime!.nodeBindings = {
      illegalGlobalTarget: 'global-controls',
    }
    expect(() =>
      buildStandaloneHtml(scenePayload, 'window.__PLAYER__=true;'),
    ).toThrow('非本场景节点')

    const globalPayload = makePayload()
    globalPayload.project.globalRuntime!.nodeBindings = {
      illegalSceneTarget: 'editable-title',
    }
    expect(() =>
      buildWebPackageFiles(globalPayload, 'window.__PLAYER__=true;'),
    ).toThrow('非全局层节点')
  })

  it('允许全局运行时绑定全局层中的原生节点', () => {
    const payload = makePayload()
    const title = createTextNode({
      id: 'global-native-title',
      name: '全局原生标题',
      text: '运行时可控制',
    })
    payload.project.globalLayer.push({
      node: title,
      layer: 'overlay',
      visibility: { mode: 'all', sceneIds: [] },
    })
    payload.project.globalRuntime!.nodeBindings = {
      nativeTitle: title.id,
      controls: 'global-controls',
    }

    const decoded = decodeStandalonePayload(
      buildStandaloneHtml(payload, 'window.__PLAYER__=true;'),
    )
    expect(decoded.globalRuntime?.nodeBindings).toEqual({
      nativeTitle: title.id,
      controls: 'global-controls',
    })
  })
})

describe('Runtime API 2 PPTX 静态化', () => {
  it('将全局原生文字、图片和图形按可见范围保留为可编辑对象', async () => {
    const payload = makePayload()
    payload.project.globalRuntime = undefined
    payload.project.scenes[0]!.runtime = undefined
    payload.project.assets['global-logo'] = assetMeta('global-logo')
    payload.assets['global-logo'] = {
      mimeType: 'image/png',
      dataUrl: pngDataUrl(),
    }
    const title = createTextNode({
      id: 'global-master-title',
      name: '全局母版标题',
      text: '跨场景统一标题',
      x: 80,
      y: 40,
    })
    const band = createShapeNode('rounded-rectangle', {
      id: 'global-master-band',
      name: '全局母版底栏',
      x: 40,
      y: 630,
      width: 1200,
      height: 60,
    })
    const logo = createImageNode({
      id: 'global-master-logo',
      name: '全局母版标志',
      assetId: 'global-logo',
      x: 1160,
      y: 24,
      width: 72,
      height: 72,
    })
    payload.project.globalLayer.unshift(
      {
        node: title,
        layer: 'underlay',
        visibility: { mode: 'include', sceneIds: ['scene-1'] },
      },
      {
        node: band,
        layer: 'overlay',
        visibility: { mode: 'include', sceneIds: ['scene-1'] },
      },
      {
        node: logo,
        layer: 'overlay',
        visibility: { mode: 'include', sceneIds: ['scene-1'] },
      },
    )

    const bytes = await buildPptx(payload, {}, {
      skipSnapshotRendering: true,
      componentSnapshots: new Map(),
      runtimeSnapshots: new Map(),
    })
    const archive = unzipSync(bytes)
    const first = strFromU8(archive['ppt/slides/slide1.xml']!)
    const second = strFromU8(archive['ppt/slides/slide2.xml']!)

    expect(first).toContain('跨场景统一标题')
    expect(first).toContain('全局母版底栏 · global-master-band')
    expect(first).toContain('全局母版标志 · global-master-logo')
    expect(second).not.toContain('跨场景统一标题')
    expect(second).not.toContain('global-master-band')
    expect(second).not.toContain('global-master-logo')
  })

  it('按层使用 fallback、按 visibility 导出全局组件，并保留普通文字对象', async () => {
    const payload = makePayload()
    const bytes = await buildPptx(payload, {}, {
      skipSnapshotRendering: true,
      componentSnapshots: new Map([
        [
          pptxGlobalComponentSnapshotKey('scene-1', 'global-controls'),
          pngDataUrl(),
        ],
      ]),
      runtimeSnapshots: new Map(),
    })
    const archive = unzipSync(bytes)
    const first = strFromU8(archive['ppt/slides/slide1.xml']!)
    const second = strFromU8(archive['ppt/slides/slide2.xml']!)

    expect(first).toContain('PPTX 中仍可编辑')
    expect(first).toContain('全局自由运行时 · 静态后备')
    expect(first).toContain('场景自由运行时“场景一” · 静态后备')
    expect(first).toContain('全局控制条 · global-controls')
    expect(first.indexOf('全局自由运行时 · 静态后备')).toBeLessThan(
      first.indexOf('PPTX 中仍可编辑'),
    )
    expect(first.indexOf('场景自由运行时“场景一” · 静态后备')).toBeLessThan(
      first.indexOf('全局控制条 · global-controls'),
    )
    expect(second).not.toContain('全局控制条 · global-controls')
    expect(second).toContain('全局自由运行时 · 静态后备')
  })

  it('缺少实际快照和 fallback 时写入可见警告，不删除可编辑对象', async () => {
    const payload = makePayload()
    delete payload.project.scenes[0]!.runtime!.staticFallback
    const bytes = await buildPptx(payload, {}, {
      skipSnapshotRendering: true,
      componentSnapshots: new Map(),
      runtimeSnapshots: new Map(),
    })
    const archive = unzipSync(bytes)
    const first = strFromU8(archive['ppt/slides/slide1.xml']!)

    expect(first).toContain('PPTX 中仍可编辑')
    expect(first).toContain('没有可用的实际快照或 staticFallback')
    expect(first).toContain('静态导出警告')
  })

  it('混合批次只让失败条目回退，保留其他运行时与组件实际快照', async () => {
    const payload = makePayload()
    payload.project.scenes[0]!.runtime = undefined
    payload.project.globalLayer[0]!.visibility = {
      mode: 'all',
      sceneIds: [],
    }
    const sceneOneComponentKey = pptxGlobalComponentSnapshotKey(
      'scene-1',
      'global-controls',
    )
    const sceneTwoComponentKey = pptxGlobalComponentSnapshotKey(
      'scene-2',
      'global-controls',
    )
    const bytes = await buildPptx(payload, {}, {
      skipSnapshotRendering: true,
      componentSnapshots: new Map([[sceneOneComponentKey, pngDataUrl()]]),
      componentSnapshotFailures: new Map([[
        sceneTwoComponentKey,
        '第二页组件准备失败',
      ]]),
      runtimeSnapshots: new Map([[
        runtimeSnapshotKey('global', 'scene-1', 'underlay'),
        pngDataUrl(),
      ]]),
      runtimeSnapshotFailures: new Map([[
        runtimeSnapshotKey('global', 'scene-2'),
        '第二页全局运行时准备失败',
      ]]),
    })
    const archive = unzipSync(bytes)
    const first = strFromU8(archive['ppt/slides/slide1.xml']!)
    const second = strFromU8(archive['ppt/slides/slide2.xml']!)

    expect(first).toContain('全局自由运行时 · 底层实际播放器快照')
    expect(first).not.toContain('全局自由运行时 · 静态后备')
    expect(first).toContain('全局控制条 · global-controls')
    expect(first).not.toContain('互动组件“全局控制条”实际快照失败')

    expect(second).toContain('全局自由运行时 · 静态后备')
    expect(second).toContain('全局自由运行时实际快照失败，已使用作者提供的静态后备')
    expect(second).toContain('互动组件：全局控制条')
    expect(second).toContain('互动组件“全局控制条”实际快照失败')
  })
})

describe('Runtime API 2 PDF 静态化', () => {
  it('播放器快照失败时按 underlay/overlay 合成 fallback，并仅显示可见全局组件占位', async () => {
    const payload = makePayload()
    payload.assets['global-fallback']!.dataUrl =
      'data:image/png;base64,R0xPQkFM'
    payload.assets['scene-fallback']!.dataUrl =
      'data:image/png;base64,U0NFTkU='
    const drawOrder: string[] = []
    const labels: string[] = []
    const context = {
      scale: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn((image: HTMLImageElement) => drawOrder.push(image.src)),
      fillText: vi.fn((value: string) => labels.push(value)),
      measureText: vi.fn((value: string) => ({ width: value.length * 9 })),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    const { renderSceneCanvas } = await import(
      '../../src/renderer/export/renderSceneImages'
    )

    const project = {
      ...payload.project,
      scenes: payload.project.scenes.map((scene) => ({ ...scene, nodes: [] })),
    }
    await renderSceneCanvas(
      project,
      project.scenes[0]!,
      {},
      1,
      { payload: { ...payload, project }, captureFailure: 'DOM 捕获失败' },
    )

    expect(drawOrder).toEqual([
      'data:image/png;base64,R0xPQkFM',
      'data:image/png;base64,U0NFTkU=',
    ])
    expect(labels.some((label) => label.includes('全局组件静态占位'))).toBe(true)
    expect(labels.join('')).toContain('实际播放器合成快照失败')

    drawOrder.length = 0
    labels.length = 0
    await renderSceneCanvas(
      project,
      project.scenes[1]!,
      {},
      1,
      { payload: { ...payload, project }, captureFailure: 'DOM 捕获失败' },
    )
    expect(labels.some((label) => label.includes('全局组件静态占位'))).toBe(false)

    const html = buildPdfPrintHtml('Runtime API 2 PDF', [pngDataUrl(), pngDataUrl()])
    expect(html.match(/<section class="page">/g)).toHaveLength(2)
    expect(html).toContain('第 2 页')
  })
})
