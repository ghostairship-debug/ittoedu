import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type {
  PublishedCourseV2Payload,
  PublishedFlowSurface,
  PublishedFlowSurfaceLayerEntry,
  PublishedGlobalLayerEntry,
  PublishedNativeLayerItem,
} from '@/shared/contracts/published-course-v2/types'
import type { FlowBlock } from '@/shared/contracts/course-project-v9/types'
import {
  buildFlowDocxProjection,
  resolveFlowDocxPageBox,
  clampLayerFrameToPageBox,
  rotationToDrawingMlDegree,
} from '@/renderer/export/course/flowDocxProjection'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'

const ASSET_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG magic bytes

function mockFlowPayload(options: {
  blocks?: FlowBlock[]
  surfaceLayers?: PublishedFlowSurfaceLayerEntry[]
  globalLayers?: PublishedGlobalLayerEntry[]
  backgroundMode?: 'inherit' | 'own'
  backgroundColor?: string
  backgroundAssetId?: string | null
  courseBackgroundColor?: string
  courseBackgroundAssetId?: string | null
  locations?: Array<{ id: string; blockId: string }>
}): { payload: PublishedCourseV2Payload; surfaceId: string } {
  const surfaceId = 'flow-test-surface-1'
  const blocks: FlowBlock[] = options.blocks ?? [
    {
      id: 'block-p-1',
      type: 'paragraph',
      text: '正文段落 1 内容',
      runs: [],
    },
    {
      id: 'block-p-2',
      type: 'paragraph',
      text: '正文段落 2 内容',
      runs: [],
    },
    {
      id: 'block-p-3',
      type: 'paragraph',
      text: '正文段落 3 内容',
      runs: [],
    },
  ]

  const flowLocations = (options.locations ?? blocks.map((b) => ({ id: `loc-${b.id}`, blockId: b.id }))).map((loc) => ({
    id: loc.id,
    label: loc.blockId,
    kind: 'flow-block' as const,
    surfaceId,
    blockId: loc.blockId,
  }))

  const flowSurface: PublishedFlowSurface = {
    id: surfaceId,
    type: 'flow',
    title: '流式讲义测试',
    layout: { readingWidth: 760, wideContentWidth: 960 },
    blocks,
    surfaceLayerItems: options.surfaceLayers ?? [],
    ...(options.backgroundMode ? { backgroundMode: options.backgroundMode } : {}),
    ...(options.backgroundColor ? { backgroundColor: options.backgroundColor } : {}),
    ...(options.backgroundAssetId !== undefined ? { backgroundAssetId: options.backgroundAssetId } : {}),
  }

  const payload: PublishedCourseV2Payload = {
    format: 'h5course-published',
    formatVersion: 2,
    sourceSchemaVersion: 9,
    courseId: 'course-test-1',
    title: '测试课程',
    ...(options.courseBackgroundColor ? { backgroundColor: options.courseBackgroundColor } : {}),
    ...(options.courseBackgroundAssetId !== undefined ? { backgroundAssetId: options.courseBackgroundAssetId } : {}),
    assets: {
      'asset-img-1': { mimeType: 'image/png', url: 'data:image/png;base64,AA==' },
      'asset-poster-1': { mimeType: 'image/jpeg', url: 'data:image/jpeg;base64,BB==' },
      'asset-comp-fallback': { mimeType: 'image/png', url: 'data:image/png;base64,CC==' },
      'asset-runtime-fallback': { mimeType: 'image/png', url: 'data:image/png;base64,DD==' },
    },
    components: {},
    designTokens: { colors: [], fonts: [{ id: 'f1', label: '微软雅黑', fontFamily: 'Microsoft YaHei' }] },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: false, musicVolume: 0.2, fadeMs: 300 },
      },
    },
    playback: {
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: {
        enabled: false,
        strategy: 'scene-navigation',
        additionalBindings: [],
      },
    },
    courseState: [],
    navigationGuards: [],
    locations: flowLocations,
    startLocationId: flowLocations[0]?.id ?? '',
    globalLayerItems: options.globalLayers ?? [],
    globalInteractions: [],
    surfaces: [flowSurface],
  }

  return { payload, surfaceId }
}

describe('flowDocxProjection', () => {
  it('resolves page box dimensions and frame clamping correctly', () => {
    const box = resolveFlowDocxPageBox('A4', 'portrait')
    expect(box.widthTwips).toBe(11_906)
    expect(box.heightTwips).toBe(16_838)
    expect(box.maxContentWidthPx).toBe(Math.floor((11_906 - 2268) / 15)) // 642
    expect(box.maxContentHeightPx).toBe(Math.floor((16_838 - 2268) / 15)) // 971

    // Frame that fits without clamping
    const normal = clampLayerFrameToPageBox({ mode: 'absolute', x: 50, y: 100, width: 200, height: 80 }, box)
    expect(normal.changed).toBe(false)
    expect(normal.outputFrame.x).toBe(50)
    expect(normal.outputFrame.y).toBe(100)
    expect(normal.outputFrame.width).toBe(200)
    expect(normal.outputFrame.height).toBe(80)

    // Frame that exceeds content box: scaled down and clamped
    const oversized = clampLayerFrameToPageBox({ mode: 'absolute', x: -50, y: 2000, width: 1200, height: 1600 }, box)
    expect(oversized.changed).toBe(true)
    expect(oversized.outputFrame.x).toBe(0) // clamped from negative
    expect(oversized.outputFrame.width).toBeLessThanOrEqual(box.maxContentWidthPx)
    expect(oversized.outputFrame.height).toBeLessThanOrEqual(box.maxContentHeightPx)
    expect(oversized.outputFrame.y).toBeLessThanOrEqual(box.maxContentHeightPx - oversized.outputFrame.height)
  })

  it('converts rotation to 1/60000 degree correctly', () => {
    expect(rotationToDrawingMlDegree(0)).toBe(0)
    expect(rotationToDrawingMlDegree(90)).toBe(5_400_000)
    expect(rotationToDrawingMlDegree(180)).toBe(10_800_000)
    expect(rotationToDrawingMlDegree(-90)).toBe(16_200_000)
  })

  it('projects Native text floating layer to editable-shape with complete report item', () => {
    const surfaceLayers: PublishedFlowSurfaceLayerEntry[] = [
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'text-layer-1',
          kind: 'native',
          visible: true,
          order: 10,
          rotation: 15,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 40, y: 50, width: 240, height: 70 },
          content: {
            nativeType: 'text',
            data: {
              text: '重点讲解',
              runs: [
                {
                  start: 0,
                  end: 2,
                  style: { bold: true, color: '#DC2626', fontFamily: 'SimSun', fontSize: 20 },
                },
              ],
              style: {
                fontFamily: 'Microsoft YaHei',
                fontSize: 16,
                color: '#1E293B',
                bold: false,
                italic: false,
                underline: false,
                strike: false,
                emphasis: false,
                highlightColor: null,
                align: 'center',
                verticalAlign: 'middle',
                writingMode: 'horizontal',
                lineSpacing: 1.5,
                letterSpacing: 0,
                padding: 8,
                overflow: 'auto-height',
                backgroundColor: '#EFF6FF',
                backgroundOpacity: 1,
                cornerRadius: 4,
              },
            },
          },
        },
      },
    ]

    const { payload, surfaceId } = mockFlowPayload({ surfaceLayers })
    const projection = buildFlowDocxProjection(payload, surfaceId)

    expect(projection.documentStartItems).toHaveLength(1)
    const projected = projection.documentStartItems[0]!
    expect(projected.layerItemId).toBe('text-layer-1')
    expect(projected.disposition).toBe('editable-shape')
    expect(projected.carrierKind).toBe('textbox')
    expect(projected.behindDoc).toBe(false)
    expect(projected.relativeHeight).toBe(1)

    expect(projection.layerReport).toHaveLength(1)
    const reportItem = projection.layerReport[0]!
    expect(reportItem).toEqual({
      surfaceId,
      layerItemId: 'text-layer-1',
      scope: 'surface',
      locationId: 'loc-block-p-1',
      fieldPath: 'surfaces[0].surfaceLayerItems[0].item',
      disposition: 'editable-shape',
      reasonCode: 'viewport-to-document-start',
      message: '视口定位浮层已转换为文档首段锚点。',
      sourceFrame: { mode: 'absolute', x: 40, y: 50, width: 240, height: 70 },
      outputFrame: { mode: 'absolute', x: 40, y: 50, width: 240, height: 70 },
    })
  })

  it('handles all shapes from the conversion matrix (presets vs static-fallback)', () => {
    const shapePresets = [
      'rectangle',
      'rounded-rectangle',
      'ellipse',
      'triangle',
      'diamond',
      'line',
      'elbow-arrow',
      'arrow-left',
      'arrow-right',
    ] as const

    const surfaceLayers: PublishedFlowSurfaceLayerEntry[] = shapePresets.map((shapeType, idx) => ({
      bodyPlane: 'overlay',
      visibility: { mode: 'all', locationIds: [] },
      item: {
        layerItemId: `shape-${shapeType}`,
        kind: 'native',
        visible: true,
        order: idx,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 10 * idx, y: 20 * idx, width: 80, height: 50 },
        content: {
          nativeType: 'shape',
          data: {
            shapeType,
            style: {
              fillColor: '#3B82F6',
              fillOpacity: 1,
              borderColor: '#1D4ED8',
              borderOpacity: 1,
              borderWidth: 2,
              lineStyle: 'solid',
              cornerRadius: 8,
              startArrow: 'none',
              endArrow: shapeType === 'elbow-arrow' ? 'triangle' : 'none',
            },
          },
        },
      },
    }))

    // Add a shape without preset (e.g. brace-left)
    surfaceLayers.push({
      bodyPlane: 'overlay',
      visibility: { mode: 'all', locationIds: [] },
      item: {
        layerItemId: 'shape-brace-left',
        kind: 'native',
        visible: true,
        order: 99,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 0, y: 0, width: 50, height: 100 },
        content: {
          nativeType: 'shape',
          data: {
            shapeType: 'brace-left',
            style: {
              fillColor: '#000000',
              fillOpacity: 0,
              borderColor: '#000000',
              borderOpacity: 1,
              borderWidth: 2,
              lineStyle: 'solid',
              cornerRadius: 0,
              startArrow: 'none',
              endArrow: 'none',
            },
          },
        },
      },
    })

    const { payload, surfaceId } = mockFlowPayload({ surfaceLayers })
    const projection = buildFlowDocxProjection(payload, surfaceId)

    for (const shapeType of shapePresets) {
      const item = projection.layerReport.find((r) => r.layerItemId === `shape-${shapeType}`)
      expect(item).toBeDefined()
      expect(item?.disposition).toBe('editable-shape')
      if (shapeType === 'line' || shapeType === 'elbow-arrow') {
        expect(item?.reasonCode).toBe('anchored-drawingml-connector')
      } else {
        expect(item?.reasonCode).toBe('anchored-drawingml-shape')
      }
    }

    const fallbackShape = projection.layerReport.find((r) => r.layerItemId === 'shape-brace-left')
    expect(fallbackShape?.disposition).toBe('static-fallback')
    expect(fallbackShape?.reasonCode).toBe('shape-static-fallback')
  })

  it('rejects illegal Native input, table, and chart in Flow with explicit diagnostics', () => {
    const surfaceLayers: PublishedFlowSurfaceLayerEntry[] = [
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'illegal-input',
          kind: 'native',
          visible: true,
          order: 1,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 10, width: 100, height: 40 },
          content: {
            nativeType: 'input',
            data: {
              answerType: 'text',
              stateKey: 'test.val',
              validityKey: 'test.valid',
              ruleFamilyRuleIds: [],
              style: {
                fontFamily: 'SimSun',
                fontSize: 14,
                textColor: '#000',
                fillColor: '#FFF',
                fillOpacity: 1,
                borderColor: '#000',
                borderOpacity: 1,
                borderWidth: 1,
                cornerRadius: 2,
                horizontalAlign: 'left',
                padding: 4,
              },
            },
          } as unknown as PublishedNativeLayerItem['content'],
        },
      },
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'illegal-table',
          kind: 'native',
          visible: true,
          order: 2,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 60, width: 200, height: 100 },
          content: {
            nativeType: 'table',
            data: {},
          } as unknown as PublishedNativeLayerItem['content'],
        },
      },
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'illegal-chart',
          kind: 'native',
          visible: true,
          order: 3,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 170, width: 200, height: 100 },
          content: {
            nativeType: 'chart',
            data: {},
          } as unknown as PublishedNativeLayerItem['content'],
        },
      },
    ]

    const { payload, surfaceId } = mockFlowPayload({ surfaceLayers })
    const projection = buildFlowDocxProjection(payload, surfaceId)

    // Illegal items must not enter documentStartItems or anchoredGroups
    expect(projection.documentStartItems).toHaveLength(0)
    expect(projection.anchoredGroups).toHaveLength(0)

    // Layer report must report all three as rejected
    expect(projection.layerReport).toHaveLength(3)
    for (const item of projection.layerReport) {
      expect(item.disposition).toBe('rejected')
      expect(item.reasonCode).toBe('illegal-flow-native-kind')
      expect(item.message).toContain('非法')
    }
  })

  it('supports image, formula, video fallback/placeholder, component, and runtime items', () => {
    const surfaceLayers: PublishedFlowSurfaceLayerEntry[] = [
      // 1. Native image
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'image-layer',
          kind: 'native',
          visible: true,
          order: 1,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 10, width: 120, height: 80 },
          content: {
            nativeType: 'image',
            data: {
              assetId: 'asset-img-1',
              preserveAspectRatio: true,
              fit: 'contain',
              crop: { left: 0, top: 0, right: 0, bottom: 0 },
              cropX: 0,
              cropY: 0,
              flipX: false,
              flipY: false,
              cornerRadius: 0,
              feather: { amount: 0, mode: 'rectangle' },
              safeAreas: [],
            },
          },
        },
      },
      // 2. Native formula
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'formula-layer',
          kind: 'native',
          visible: true,
          order: 2,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 100, width: 150, height: 40 },
          content: {
            nativeType: 'formula',
            data: {
              formulaId: 'formula-1',
              ast: { type: 'token', value: 'E=mc^2' },
              accessibleText: '质能方程',
              style: { fontSize: 18, color: '#1E293B', align: 'center' },
            },
          },
        },
      },
      // 3. Video with poster
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'video-with-poster',
          kind: 'native',
          visible: true,
          order: 3,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 150, width: 200, height: 120 },
          content: {
            nativeType: 'video',
            data: {
              assetId: 'video-asset',
              fit: 'cover',
              autoplay: false,
              loop: false,
              muted: true,
              volume: 1,
              playbackRate: 1,
              showControls: true,
              clickToToggle: true,
              startTime: 0,
              endTime: null,
              poster: { mode: 'image', time: 0, assetId: 'asset-poster-1' },
              backgroundAudioMode: 'none',
            },
          },
        },
      },
      // 4. Video without poster
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'video-no-poster',
          kind: 'native',
          visible: true,
          order: 4,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 280, width: 200, height: 120 },
          content: {
            nativeType: 'video',
            data: {
              assetId: 'video-asset-2',
              fit: 'cover',
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
              backgroundAudioMode: 'none',
            },
          },
        },
      },
      // 5. Component with fallback
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'comp-with-fallback',
          kind: 'component',
          visible: true,
          order: 5,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 410, width: 160, height: 100 },
          component: { packageId: 'test-pkg', version: '1.0.0' },
          props: {},
          staticFallbackAssetId: 'asset-comp-fallback',
        },
      },
      // 6. Component without fallback
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'comp-no-fallback',
          kind: 'component',
          visible: true,
          order: 6,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 520, width: 160, height: 100 },
          component: { packageId: 'quiz-pkg', version: '2.1.0' },
          props: {},
        },
      },
      // 7. Runtime with fallback
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'runtime-with-fallback',
          kind: 'runtime',
          visible: true,
          order: 7,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 630, width: 160, height: 100 },
          runtime: {
            protocol: 'surface-runtime',
            runtimeApiVersion: 3,
            enabled: true,
            renderMode: 'dom',
            code: { encoding: 'base64-utf16le', data: '' },
            content: { values: {} },
            assets: {},
            staticFallback: { assetId: 'asset-runtime-fallback', coverage: 'surface' },
          },
        },
      },
      // 8. Runtime without fallback
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'runtime-no-fallback',
          kind: 'runtime',
          visible: true,
          order: 8,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 740, width: 160, height: 100 },
          runtime: {
            protocol: 'surface-runtime',
            runtimeApiVersion: 3,
            enabled: true,
            renderMode: 'dom',
            code: { encoding: 'base64-utf16le', data: '' },
            content: { values: {} },
            assets: {},
          },
        },
      },
    ]

    const { payload, surfaceId } = mockFlowPayload({ surfaceLayers })
    const projection = buildFlowDocxProjection(payload, surfaceId)

    const findReport = (id: string) => projection.layerReport.find((r) => r.layerItemId === id)

    // Image
    expect(findReport('image-layer')?.disposition).toBe('image')
    expect(findReport('image-layer')?.reasonCode).toBe('anchored-drawingml-picture')

    // Formula
    expect(findReport('formula-layer')?.disposition).toBe('preserved')
    expect(findReport('formula-layer')?.reasonCode).toBe('preserved-native-formula')

    // Video with poster
    expect(findReport('video-with-poster')?.disposition).toBe('static-fallback')
    expect(findReport('video-with-poster')?.reasonCode).toBe('video-poster-fallback')

    // Video without poster -> placeholder
    expect(findReport('video-no-poster')?.disposition).toBe('placeholder')
    expect(findReport('video-no-poster')?.reasonCode).toBe('video-placeholder')

    // Component with fallback
    expect(findReport('comp-with-fallback')?.disposition).toBe('static-fallback')
    expect(findReport('comp-with-fallback')?.reasonCode).toBe('dynamic-static-fallback')

    // Component without fallback -> placeholder
    expect(findReport('comp-no-fallback')?.disposition).toBe('placeholder')
    expect(findReport('comp-no-fallback')?.reasonCode).toBe('dynamic-placeholder')

    // Runtime with fallback
    expect(findReport('runtime-with-fallback')?.disposition).toBe('static-fallback')

    // Runtime without fallback -> placeholder
    expect(findReport('runtime-no-fallback')?.disposition).toBe('placeholder')
  })

  it('places global teacher-controller only into footer when visibility=all and includeInStaticExports=true', () => {
    // Controller with static exports disabled: excluded
    const disabledGlobalController: PublishedGlobalLayerEntry = {
      plane: 'overlay',
      visibility: { mode: 'all', locationIds: [] },
      item: {
        layerItemId: 'ctrl-disabled',
        kind: 'native',
        visible: true,
        order: 1,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 0, y: 0, width: 400, height: 48 },
        content: {
          nativeType: 'teacher-controller',
          data: {
            title: '教师控制栏',
            showSceneProgress: true,
            compact: false,
            collapsible: true,
            defaultCollapsed: false,
            buttons: [
              { id: 'btn-prev', action: { type: 'scene.previous' }, label: '上一页', visible: true },
              { id: 'btn-next', action: { type: 'scene.next' }, label: '下一页', visible: true },
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
      },
    }

    const { payload: p1, surfaceId: s1 } = mockFlowPayload({
      globalLayers: [disabledGlobalController],
    })
    const proj1 = buildFlowDocxProjection(p1, s1)
    expect(proj1.footerItems).toHaveLength(0)
    expect(proj1.layerReport.find((r) => r.layerItemId === 'ctrl-disabled')?.disposition).toBe('excluded')

    // Controller with static exports enabled and mode all: placed in footer
    const enabledGlobalController: PublishedGlobalLayerEntry = {
      plane: 'overlay',
      visibility: { mode: 'all', locationIds: [] },
      item: {
        layerItemId: 'ctrl-enabled',
        kind: 'native',
        visible: true,
        order: 1,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 0, y: 0, width: 400, height: 48 },
        content: {
          nativeType: 'teacher-controller',
          data: {
            title: '教师控制栏',
            showSceneProgress: true,
            compact: false,
            collapsible: true,
            defaultCollapsed: false,
            buttons: [
              { id: 'btn-prev', action: { type: 'scene.previous' }, label: '上一页', visible: true },
              { id: 'btn-next', action: { type: 'scene.next' }, label: '下一页', visible: true },
            ],
            style: {
              backgroundColor: '#172033',
              backgroundOpacity: 0.94,
              accentColor: '#e7b85c',
              textColor: '#f8fafc',
              cornerRadius: 16,
            },
            includeInStaticExports: true,
          },
        },
      },
    }

    const { payload: p2, surfaceId: s2 } = mockFlowPayload({
      globalLayers: [enabledGlobalController],
    })
    const proj2 = buildFlowDocxProjection(p2, s2)
    expect(proj2.footerItems).toHaveLength(1)
    expect(proj2.footerItems[0]!.layerItemId).toBe('ctrl-enabled')
    expect(proj2.layerReport.find((r) => r.layerItemId === 'ctrl-enabled')?.disposition).toBe('editable-shape')
    expect(proj2.layerReport.find((r) => r.layerItemId === 'ctrl-enabled')?.reasonCode).toBe('global-teacher-controller-footer')

    // Build DOCX and assert footer XML presence
    const docxResult = buildFlowDocx(p2, s2)
    const unzipped = unzipSync(docxResult.bytes)
    expect(unzipped['word/footer1.xml']).toBeDefined()
    const footerXml = strFromU8(unzipped['word/footer1.xml']!)
    expect(footerXml).toContain('教师控制栏')

    const docXml = strFromU8(unzipped['word/document.xml']!)
    expect(docXml).toContain('<w:footerReference w:type="default"')

    const relsXml = strFromU8(unzipped['word/_rels/document.xml.rels']!)
    expect(relsXml).toContain('footer1.xml')

    const contentTypesXml = strFromU8(unzipped['[Content_Types].xml']!)
    expect(contentTypesXml).toContain('footer1.xml')
  })

  it('anchors ordinary global items exactly once to document start and never to header/footer', () => {
    const globalText: PublishedGlobalLayerEntry = {
      plane: 'overlay',
      visibility: { mode: 'all', locationIds: [] },
      item: {
        layerItemId: 'global-banner',
        kind: 'native',
        visible: true,
        order: 50,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 20, y: 15, width: 300, height: 40 },
        content: {
          nativeType: 'text',
          data: {
            text: '全局横幅标识',
            runs: [],
            style: {
              fontFamily: 'SimHei',
              fontSize: 14,
              color: '#000000',
              bold: true,
              italic: false,
              underline: false,
              strike: false,
              emphasis: false,
              highlightColor: null,
              align: 'left',
              verticalAlign: 'top',
              writingMode: 'horizontal',
              lineSpacing: 1,
              letterSpacing: 0,
              padding: 4,
              overflow: 'auto-height',
              backgroundColor: '#FFFFFF',
              backgroundOpacity: 1,
              cornerRadius: 0,
            },
          },
        },
      },
    }

    const { payload, surfaceId } = mockFlowPayload({ globalLayers: [globalText] })
    const projection = buildFlowDocxProjection(payload, surfaceId)

    expect(projection.footerItems).toHaveLength(0)
    expect(projection.documentStartItems.some((i) => i.layerItemId === 'global-banner')).toBe(true)

    const docx = buildFlowDocx(payload, surfaceId)
    const unzipped = unzipSync(docx.bytes)
    expect(unzipped['word/footer1.xml']).toBeUndefined()

    const docXml = strFromU8(unzipped['word/document.xml']!)
    // Must appear exactly once in document XML
    const matches = docXml.match(/全局横幅标识/g)
    expect(matches).toHaveLength(1)
  })

  it('anchors paperSpace: paper item to nearest preceding block top or falls back with warning', () => {
    const paperLayer: PublishedFlowSurfaceLayerEntry = {
      bodyPlane: 'overlay',
      visibility: { mode: 'all', locationIds: [] },
      item: {
        layerItemId: 'paper-layer-1',
        kind: 'native',
        visible: true,
        order: 1,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        paperSpace: 'paper',
        frame: { mode: 'absolute', x: 10, y: 450, width: 100, height: 50 },
        content: {
          nativeType: 'text',
          data: {
            text: '批注内容',
            runs: [],
            style: {
              fontFamily: 'Microsoft YaHei',
              fontSize: 12,
              color: '#000',
              bold: false,
              italic: false,
              underline: false,
              strike: false,
              emphasis: false,
              highlightColor: null,
              align: 'left',
              verticalAlign: 'top',
              writingMode: 'horizontal',
              lineSpacing: 1,
              letterSpacing: 0,
              padding: 2,
              overflow: 'auto-height',
              backgroundColor: '#FFF',
              backgroundOpacity: 1,
              cornerRadius: 0,
            },
          },
        },
      },
    }

    const { payload, surfaceId } = mockFlowPayload({ surfaceLayers: [paperLayer] })

    // When blockTops is provided: block-p-1 is at 0, block-p-2 is at 300, block-p-3 is at 600
    // y = 450 should choose block-p-2 (top 300 is the closest not exceeding 450)
    const blockTops = {
      'block-p-1': 0,
      'block-p-2': 300,
      'block-p-3': 600,
    }
    const projWithLayout = buildFlowDocxProjection(payload, surfaceId, { blockTops })
    const group = projWithLayout.anchoredGroups.find((g) => g.blockId === 'block-p-2')
    expect(group).toBeDefined()
    expect(group?.items.some((i) => i.layerItemId === 'paper-layer-1')).toBe(true)

    // When blockTops is omitted: falls back to document start and issues warning
    const projNoLayout = buildFlowDocxProjection(payload, surfaceId)
    expect(projNoLayout.documentStartItems.some((i) => i.layerItemId === 'paper-layer-1')).toBe(true)
    expect(projNoLayout.warnings.some((w) => w.includes('paperSpace'))).toBe(true)
  })

  it('correctly handles underlay vs overlay relativeHeight and behindDoc order', () => {
    const surfaceLayers: PublishedFlowSurfaceLayerEntry[] = [
      {
        bodyPlane: 'underlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'surf-underlay',
          kind: 'native',
          visible: true,
          order: 2,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 100 },
          content: {
            nativeType: 'text',
            data: { text: '底层水印', runs: [], style: {} as never },
          },
        },
      },
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'surf-overlay',
          kind: 'native',
          visible: true,
          order: 1,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 10, y: 10, width: 100, height: 50 },
          content: {
            nativeType: 'text',
            data: { text: '表面浮层', runs: [], style: {} as never },
          },
        },
      },
    ]

    const globalLayers: PublishedGlobalLayerEntry[] = [
      {
        plane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'global-overlay-1',
          kind: 'native',
          visible: true,
          order: 1,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 20, y: 20, width: 100, height: 50 },
          content: {
            nativeType: 'text',
            data: { text: '全局顶层', runs: [], style: {} as never },
          },
        },
      },
    ]

    const { payload, surfaceId } = mockFlowPayload({ surfaceLayers, globalLayers })
    const projection = buildFlowDocxProjection(payload, surfaceId)

    const underlayItem = projection.documentStartItems.find((i) => i.layerItemId === 'surf-underlay')
    expect(underlayItem?.behindDoc).toBe(true)
    expect(underlayItem?.relativeHeight).toBe(1)

    const surfOverlayItem = projection.documentStartItems.find((i) => i.layerItemId === 'surf-overlay')
    expect(surfOverlayItem?.behindDoc).toBe(false)
    expect(surfOverlayItem?.relativeHeight).toBe(1)

    const globalOverlayItem = projection.documentStartItems.find((i) => i.layerItemId === 'global-overlay-1')
    expect(globalOverlayItem?.behindDoc).toBe(false)
    expect(globalOverlayItem?.relativeHeight).toBe(100_001)

    const docx = buildFlowDocx(payload, surfaceId)
    const docXml = strFromU8(unzipSync(docx.bytes)['word/document.xml']!)
    expect(docXml).toContain('behindDoc="1"')
    expect(docXml).toContain('behindDoc="0"')
    expect(docXml).toContain('relativeHeight="100001"')
  })

  it('handles empty Flow surface and document background color in DOCX', () => {
    const { payload, surfaceId } = mockFlowPayload({
      blocks: [],
      backgroundColor: '#FEF3C7',
    })
    const projection = buildFlowDocxProjection(payload, surfaceId)
    expect(projection.backgroundColor).toBe('#FEF3C7')

    const docx = buildFlowDocx(payload, surfaceId)
    const unzipped = unzipSync(docx.bytes)
    const docXml = strFromU8(unzipped['word/document.xml']!)

    expect(docXml).toContain('<w:background w:color="FEF3C7"/>')
    expect(docXml).toContain('<w:body>')
  })

  it('handles Flow surface background image in DOCX when asset is resolved', () => {
    const { payload, surfaceId } = mockFlowPayload({
      backgroundMode: 'own',
      backgroundAssetId: 'flow-bg-asset',
      backgroundColor: '#E0F2FE',
    })
    const projection = buildFlowDocxProjection(payload, surfaceId)
    expect(projection.backgroundAssetId).toBe('flow-bg-asset')
    expect(projection.backgroundColor).toBe('#E0F2FE')

    const docx = buildFlowDocx(payload, surfaceId, {
      resolveAsset: (id) => (id === 'flow-bg-asset' ? { bytes: ASSET_BYTES, mimeType: 'image/png' } : undefined),
    })

    expect(docx.layerReport.some((r) => r.reasonCode === 'surface-background-image' && r.disposition === 'preserved')).toBe(true)

    const unzipped = unzipSync(docx.bytes)

    // header1.xml exists with full-page anchored drawing
    expect(unzipped['word/header1.xml']).toBeDefined()
    const headerXml = strFromU8(unzipped['word/header1.xml']!)
    expect(headerXml).toContain('behindDoc="1"')
    expect(headerXml).toContain('relativeHeight="0"')
    expect(headerXml).toContain('relativeFrom="page"')
    expect(headerXml).toContain('<a:blip r:embed="rId1"')

    // header1.xml.rels links to bg image
    expect(unzipped['word/_rels/header1.xml.rels']).toBeDefined()
    const headerRelsXml = strFromU8(unzipped['word/_rels/header1.xml.rels']!)
    expect(headerRelsXml).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"')
    expect(headerRelsXml).toContain('Target="media/bgimage.png"')

    // image file in package
    expect(unzipped['word/media/bgimage.png']).toBeDefined()

    // document.xml references header1
    const docXml = strFromU8(unzipped['word/document.xml']!)
    expect(docXml).toContain('<w:headerReference w:type="default"')
    expect(docXml).toContain('<w:background w:color="E0F2FE"/>')

    // document.xml.rels references header1.xml
    const docRels = strFromU8(unzipped['word/_rels/document.xml.rels']!)
    expect(docRels).toContain('Target="header1.xml"')

    // Content types registers header1.xml
    const contentTypesXml = strFromU8(unzipped['[Content_Types].xml']!)
    expect(contentTypesXml).toContain('PartName="/word/header1.xml"')
  })

  it('handles Flow background inheritance from Course and missing asset fallback gracefully', () => {
    const { payload, surfaceId } = mockFlowPayload({
      backgroundMode: 'inherit',
      courseBackgroundColor: '#FEF3C7',
      courseBackgroundAssetId: 'missing-course-bg-asset',
    })
    const projection = buildFlowDocxProjection(payload, surfaceId)
    expect(projection.backgroundColor).toBe('#FEF3C7')
    expect(projection.backgroundAssetId).toBe('missing-course-bg-asset')

    const docx = buildFlowDocx(payload, surfaceId, {
      resolveAsset: () => undefined, // Asset missing
    })

    expect(docx.warnings.some((w) => w.includes('missing-course-bg-asset'))).toBe(true)
    expect(docx.layerReport.some((r) => r.reasonCode === 'surface-background-asset-missing' && r.disposition === 'static-fallback')).toBe(true)

    const unzipped = unzipSync(docx.bytes)
    // header1.xml should not be generated when asset is missing
    expect(unzipped['word/header1.xml']).toBeUndefined()

    // Background color is still preserved
    const docXml = strFromU8(unzipped['word/document.xml']!)
    expect(docXml).toContain('<w:background w:color="FEF3C7"/>')
  })

  it('unzips DOCX and thoroughly asserts DrawingML XML tags, relationships, and content types', () => {
    const surfaceLayers: PublishedFlowSurfaceLayerEntry[] = [
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'native-textbox-sample',
          kind: 'native',
          visible: true,
          order: 1,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 30, y: 40, width: 180, height: 60 },
          content: {
            nativeType: 'text',
            data: {
              text: '绘图标记文本',
              runs: [],
              style: {
                fontFamily: 'SimSun',
                fontSize: 14,
                color: '#2563EB',
                bold: true,
                italic: false,
                underline: false,
                strike: false,
                emphasis: false,
                highlightColor: null,
                align: 'center',
                verticalAlign: 'middle',
                writingMode: 'horizontal',
                lineSpacing: 1,
                letterSpacing: 0,
                padding: 4,
                overflow: 'auto-height',
                backgroundColor: '#EFF6FF',
                backgroundOpacity: 1,
                cornerRadius: 4,
              },
            },
          },
        },
      },
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'native-shape-sample',
          kind: 'native',
          visible: true,
          order: 2,
          rotation: 45,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 220, y: 40, width: 80, height: 80 },
          content: {
            nativeType: 'shape',
            data: {
              shapeType: 'ellipse',
              style: {
                fillColor: '#10B981',
                fillOpacity: 1,
                borderColor: '#047857',
                borderOpacity: 1,
                borderWidth: 2,
                lineStyle: 'solid',
                cornerRadius: 0,
                startArrow: 'none',
                endArrow: 'none',
              },
            },
          },
        },
      },
      {
        bodyPlane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
        item: {
          layerItemId: 'native-image-sample',
          kind: 'native',
          visible: true,
          order: 3,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
          frame: { mode: 'absolute', x: 320, y: 40, width: 100, height: 75 },
          content: {
            nativeType: 'image',
            data: {
              assetId: 'asset-img-1',
              preserveAspectRatio: true,
              fit: 'contain',
              crop: { left: 0, top: 0, right: 0, bottom: 0 },
              cropX: 0,
              cropY: 0,
              flipX: false,
              flipY: false,
              cornerRadius: 0,
              feather: { amount: 0, mode: 'rectangle' },
              safeAreas: [],
            },
          },
        },
      },
    ]

    const { payload, surfaceId } = mockFlowPayload({ surfaceLayers })
    const docxResult = buildFlowDocx(payload, surfaceId, {
      resolveAsset: (assetId) => (assetId === 'asset-img-1' ? { bytes: ASSET_BYTES, mimeType: 'image/png' } : undefined),
    })

    const unzipped = unzipSync(docxResult.bytes)

    // 1. Content_Types.xml
    expect(unzipped['[Content_Types].xml']).toBeDefined()
    const contentTypesXml = strFromU8(unzipped['[Content_Types].xml']!)
    expect(contentTypesXml).toContain('Extension="png" ContentType="image/png"')
    expect(contentTypesXml).toContain('PartName="/word/document.xml"')

    // 2. word/_rels/document.xml.rels
    expect(unzipped['word/_rels/document.xml.rels']).toBeDefined()
    const relsXml = strFromU8(unzipped['word/_rels/document.xml.rels']!)
    expect(relsXml).toContain('Target="styles.xml"')
    expect(relsXml).toContain('Target="numbering.xml"')
    expect(relsXml).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"')

    // 3. word/media/image1.png
    expect(unzipped['word/media/image1.png']).toBeDefined()

    // 4. word/document.xml
    expect(unzipped['word/document.xml']).toBeDefined()
    const docXml = strFromU8(unzipped['word/document.xml']!)

    // DrawingML namespaces
    expect(docXml).toContain('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"')
    expect(docXml).toContain('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"')
    expect(docXml).toContain('xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
    expect(docXml).toContain('xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"')

    // Anchored DrawingML structure
    expect(docXml).toContain('<wp:anchor')
    expect(docXml).toContain('relativeHeight=')
    expect(docXml).toContain('behindDoc="0"')
    expect(docXml).toContain('<wp:positionH relativeFrom="margin"><wp:posOffset>')
    expect(docXml).toContain('<wp:positionV relativeFrom="margin"><wp:posOffset>')
    expect(docXml).toContain('<wp:extent cx=')
    expect(docXml).toContain('<wp:wrapNone/>')

    // Text box shape
    expect(docXml).toContain('<wps:wsp')
    expect(docXml).toContain('<wps:cNvSpPr txBox="1"/>')
    expect(docXml).toContain('<wps:txbx><w:txbxContent>')
    expect(docXml).toContain('绘图标记文本')

    // Preset geometry for ellipse
    expect(docXml).toContain('<a:prstGeom prst="ellipse">')
    expect(docXml).toContain('rot="2700000"') // 45 * 60000 = 2700000

    // Picture DrawingML
    expect(docXml).toContain('<pic:pic')
    expect(docXml).toContain('<a:blip r:embed="rId')

    // Document structure: Section properties
    expect(docXml).toContain('<w:sectPr>')
    expect(docXml).toContain('<w:pgSz')
    expect(docXml).toContain('<w:pgMar')
  })

  it('throws informative error when target surface is not a flow surface', () => {
    const { payload } = mockFlowPayload({})
    expect(() => buildFlowDocxProjection(payload, 'non-existent-id')).toThrow(/not a Flow surface/)
  })
})

