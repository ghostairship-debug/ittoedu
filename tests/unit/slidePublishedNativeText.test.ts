// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { paintPublishedNativeText } from '../../src/player/surfaces/publishedNativeText'
import {
  nativeMediaAssetIds,
  paintPublishedNativeRenderInput,
  readonlyNativeRenderInputFromV9Item,
} from '../../src/player/surfaces/slide/publishedNativeRendering'
import { SlidePublishedAdapter } from '../../src/player/surfaces/slide/SlidePublishedAdapter'
import type {
  CourseProjectDocument,
  NativeElementContent,
  NativeLayerItem,
} from '../../src/shared/courseProjectTypes'
import type { PublishedCourseV2Payload } from '../../src/shared/publishedCourseTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

type TextNodeData = Extract<NativeElementContent, { nativeType: 'text' }>['data']

function defaultTextStyle(): TextNodeData['style'] {
  return {
    fontFamily: 'Arial',
    fontSize: 20,
    color: '#333333',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    emphasis: false,
    highlightColor: null,
    align: 'left',
    verticalAlign: 'top',
    writingMode: 'horizontal',
    lineSpacing: 4,
    letterSpacing: 1,
    padding: 8,
    overflow: 'fixed',
    backgroundColor: '#ffffff',
    backgroundOpacity: 0,
    cornerRadius: 0,
  }
}

function createTextData(
  overrides: Partial<Omit<TextNodeData, 'style'>> & { style?: Partial<TextNodeData['style']> } = {},
): TextNodeData {
  const { style, ...rest } = overrides
  return {
    text: 'Hello World',
    runs: [],
    ...rest,
    style: { ...defaultTextStyle(), ...style },
  }
}

function nativeItemsIn(project: CourseProjectDocument): NativeLayerItem[] {
  const items = project.globalLayerItems.map((entry) => entry.item)
  for (const surface of project.surfaces) {
    items.push(...surface.surfaceLayerItems.map((entry) => entry.item))
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) items.push(...scene.layerItems)
    } else if (surface.type === 'spatial-2d') {
      items.push(...surface.world.layerItems)
    }
  }
  return items.filter((item): item is NativeLayerItem => item.kind === 'native')
}

function expectFrozenTree(value: unknown): void {
  if (!value || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectFrozenTree(child)
}

describe('paintPublishedNativeText', () => {
  it('(a) node.style.bold true, runs [] => weight 700 on span and wrap', () => {
    const wrap = document.createElement('div')
    const data = createTextData({
      text: 'Sample Text',
      runs: [],
      style: {
        fontFamily: 'sans-serif',
        fontSize: 16,
        color: '#111111',
        bold: true,
        italic: false,
        underline: false,
        strike: false,
        emphasis: false,
        highlightColor: null,
        align: 'center',
        verticalAlign: 'top',
        writingMode: 'horizontal',
        lineSpacing: 2,
        letterSpacing: 0,
        padding: 4,
      },
    })

    paintPublishedNativeText(wrap, data)

    expect(wrap.style.fontWeight).toBe('700')
    const spans = wrap.querySelectorAll('span')
    expect(spans.length).toBe(1)
    expect(spans[0]?.textContent).toBe('Sample Text')
    expect(spans[0]?.style.fontWeight).toBe('700')
  })

  it('(b) runs bold on a substring only', () => {
    const wrap = document.createElement('div')
    const data = createTextData({
      text: 'Hello World',
      runs: [
        { start: 6, end: 11, style: { bold: true } },
      ],
      style: {
        fontFamily: 'sans-serif',
        fontSize: 16,
        color: '#111111',
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        emphasis: false,
        highlightColor: null,
        align: 'left',
        verticalAlign: 'top',
        writingMode: 'horizontal',
        lineSpacing: 2,
        letterSpacing: 0,
        padding: 4,
      },
    })

    paintPublishedNativeText(wrap, data)

    const spans = Array.from(wrap.querySelectorAll('span'))
    expect(spans.length).toBe(2)
    expect(spans[0]?.textContent).toBe('Hello ')
    expect(spans[0]?.style.fontWeight).toBe('400')
    expect(spans[1]?.textContent).toBe('World')
    expect(spans[1]?.style.fontWeight).toBe('700')
  })

  it('(c) run color overrides node color on that span', () => {
    const wrap = document.createElement('div')
    const data = createTextData({
      text: 'Prefix Highlighted Suffix',
      runs: [
        { start: 7, end: 18, style: { color: '#ff0000', highlightColor: '#ffff00' } },
      ],
      style: {
        fontFamily: 'sans-serif',
        fontSize: 18,
        color: '#333333',
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        emphasis: false,
        highlightColor: null,
        align: 'left',
        verticalAlign: 'top',
        writingMode: 'horizontal',
        lineSpacing: 0,
        letterSpacing: 0,
        padding: 0,
      },
    })

    paintPublishedNativeText(wrap, data)

    const spans = Array.from(wrap.querySelectorAll('span'))
    expect(spans.length).toBe(3)
    expect(spans[0]?.textContent).toBe('Prefix ')
    expect(spans[0]?.style.color).toBe('rgb(51, 51, 51)')

    expect(spans[1]?.textContent).toBe('Highlighted')
    expect(spans[1]?.style.color).toBe('rgb(255, 0, 0)')
    expect(spans[1]?.style.backgroundColor).toBe('rgb(255, 255, 0)')

    expect(spans[2]?.textContent).toBe(' Suffix')
    expect(spans[2]?.style.color).toBe('rgb(51, 51, 51)')
  })

  it('(d) concatenated span text equals data.text', () => {
    const rawText = 'The quick brown fox jumps over the lazy dog'
    const wrap = document.createElement('div')
    const data = createTextData({
      text: rawText,
      runs: [
        { start: 4, end: 9, style: { bold: true, italic: true } },
        { start: 10, end: 15, style: { underline: true } },
        { start: 20, end: 25, style: { strike: true, color: '#00ff00' } },
        { start: 35, end: 43, style: { emphasis: true } },
      ],
    })

    paintPublishedNativeText(wrap, data)

    const spans = Array.from(wrap.querySelectorAll('span'))
    const concatenated = spans.map((span) => span.textContent).join('')
    expect(concatenated).toBe(rawText)
  })

  it('applies block-level styles to wrap container', () => {
    const wrap = document.createElement('div')
    const data = createTextData({
      text: 'Block test',
      runs: [],
      style: {
        fontFamily: '"Helvetica Neue", Arial, sans-serif',
        fontSize: 24,
        color: '#222222',
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        emphasis: false,
        highlightColor: null,
        align: 'right',
        verticalAlign: 'middle',
        writingMode: 'vertical-rl',
        lineSpacing: 6,
        letterSpacing: 2,
        padding: 12,
      },
    })

    paintPublishedNativeText(wrap, data)

    expect(wrap.style.boxSizing).toBe('border-box')
    expect(wrap.style.overflow).toBe('hidden')
    expect(wrap.style.whiteSpace).toBe('pre-wrap')
    expect(wrap.style.fontFamily).toBe('"Helvetica Neue", Arial, sans-serif')
    expect(wrap.style.fontSize).toBe('24px')
    expect(wrap.style.textAlign).toBe('right')
    expect(wrap.style.lineHeight).toBe('30px') // 24 + 6
    expect(wrap.style.letterSpacing).toBe('2px')
    expect(wrap.style.padding).toBe('12px')
    expect(wrap.style.writingMode).toBe('vertical-rl')
  })

  it('uses the shared text layout analysis to shrink within the published frame', () => {
    const wrap = document.createElement('div')
    const data = createTextData({
      text: 'A long line of published text that cannot fit at the authored size',
      style: {
        fontSize: 32,
        lineSpacing: 0,
        letterSpacing: 0,
        padding: 0,
        overflow: 'shrink',
      },
    })

    paintPublishedNativeText(wrap, data, { width: 120, height: 24 })

    expect(wrap.style.fontSize).toBe('8px')
    expect(wrap.style.lineHeight).toBe('9.76px')
  })

  it('renders published text runs through SlidePublishedAdapter mount', async () => {
    const payload: PublishedCourseV2Payload = {
      format: 'h5course-published',
      formatVersion: 2,
      sourceSchemaVersion: 9,
      courseId: 'test-course',
      title: 'Test Course',
      assets: {},
      components: {},
      designTokens: {
        fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }],
        colors: [{ id: 'text', label: '正文', color: '#000000' }],
      },
      media: {
        audio: {
          defaultMuted: false,
          masterVolume: 1,
          channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
          sounds: {},
          narrationDucking: { enabled: false, musicVolume: 0.3, fadeMs: 0 },
        },
      },
      playback: {
        controls: 'none',
        keyboardNavigation: true,
        presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
      },
      courseState: [],
      navigationGuards: [],
      locations: [
        {
          id: 'scene-1',
          label: 'Scene 1',
          kind: 'slide-scene',
          surfaceId: 'surface-slide',
          sceneId: 'scene-1',
        },
      ],
      startLocationId: 'scene-1',
      globalLayerItems: [],
      globalInteractions: [],
      surfaces: [
        {
          id: 'surface-slide',
          type: 'slide',
          title: 'Slide Surface',
          canvas: { width: 1280, height: 720 },
          surfaceLayerItems: [],
          scenes: [
            {
              id: 'scene-1',
              name: 'Scene 1',
              backgroundColor: '#ffffff',
              layerItems: [
                {
                  layerItemId: 'text-1',
                  frame: { mode: 'absolute', x: 100, y: 100, width: 400, height: 200 },
                  visible: true,
                  rotation: 0,
                  opacity: 1,
                  hitPolicy: 'auto',
                  playbackInitialVisibility: 'inherit',
                  order: 1,
                  kind: 'native',
                  content: {
                    nativeType: 'text',
                    data: createTextData({
                      text: 'Hello Rich World',
                      runs: [
                        { start: 6, end: 10, style: { bold: true, color: '#ff0000' } },
                      ],
                      style: {
                        fontFamily: 'sans-serif',
                        fontSize: 16,
                        color: '#000000',
                        padding: 0,
                        lineSpacing: 2,
                        letterSpacing: 0,
                      },
                    }),
                  },
                },
              ],
              interactions: [],
            },
          ],
        },
      ],
    }

    const container = document.createElement('div')
    const adapter = new SlidePublishedAdapter(payload, 'surface-slide')
    await adapter.mount({
      surfaceId: 'surface-slide',
      container,
      signal: new AbortController().signal,
      services: {
        navigate: async () => undefined,
        getCourseState: () => undefined,
        setCourseState: () => undefined,
        resolveAsset: () => undefined,
      },
    })
    await adapter.activate()

    const textLayer = container.querySelector('[data-slide-layer-item="text-1"]') as HTMLElement
    expect(textLayer).not.toBeNull()
    const spans = textLayer.querySelectorAll('span')
    expect(spans.length).toBe(3)
    expect(spans[0]?.textContent).toBe('Hello ')
    expect(spans[0]?.style.fontWeight).toBe('400')
    expect(spans[1]?.textContent).toBe('Rich')
    expect(spans[1]?.style.fontWeight).toBe('700')
    expect(spans[1]?.style.color).toBe('rgb(255, 0, 0)')
    expect(spans[2]?.textContent).toBe(' World')
    expect(spans[2]?.style.fontWeight).toBe('400')

    await adapter.destroy()
  })

  it('paints published text through the Native render-input owner', () => {
    const wrap = document.createElement('div')
    const data = createTextData({
      text: 'Owner Text',
      runs: [{ start: 0, end: 5, style: { bold: true } }],
    })
    paintPublishedNativeRenderInput(
      wrap,
      {
        id: 'text-owner',
        name: 'text-owner',
        type: 'text',
        x: 0,
        y: 0,
        width: 400,
        height: 80,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        playbackInitialVisibility: 'inherit',
        text: data.text,
        runs: data.runs,
        style: data.style,
      },
      { resolveAsset: () => undefined },
    )
    expect(wrap.dataset.nativeType).toBe('text')
    const spans = Array.from(wrap.querySelectorAll('span'))
    expect(spans.map((span) => span.textContent).join('')).toBe('Owner Text')
    expect(spans[0]?.style.fontWeight).toBe('700')
    expect(spans[1]?.style.fontWeight).toBe('400')
  })

  it('materializes all six Native variants as detached frozen snapshots', () => {
    const items = listCourseProjectV9Fixtures().flatMap((fixture) => (
      nativeItemsIn(fixture.data.project)
    ))
    const nativeTypes = [
      'text',
      'formula',
      'image',
      'video',
      'shape',
      'teacher-controller',
    ] as const

    for (const nativeType of nativeTypes) {
      const source = items.find((item) => item.content.nativeType === nativeType)
      if (!source) throw new Error(`missing ${nativeType} fixture`)
      const before = structuredClone(source)
      const input = readonlyNativeRenderInputFromV9Item(source)
      expect(input).toMatchObject({
        id: source.layerItemId,
        name: source.label,
        type: nativeType,
        x: source.frame.x,
        y: source.frame.y,
        width: source.frame.width,
        height: source.frame.height,
        rotation: source.rotation,
        opacity: source.opacity,
        visible: source.visible,
        locked: source.locked,
        playbackInitialVisibility: source.playbackInitialVisibility,
      })
      expectFrozenTree(input)
      expect(() => {
        ;(input as { name: string }).name = 'mutated snapshot'
      }).toThrow()
      expect(source).toEqual(before)

      const data = source.content.data as Record<string, unknown>
      const snapshot = input as unknown as Record<string, unknown>
      for (const [key, nested] of Object.entries(data)) {
        if (nested && typeof nested === 'object') expect(snapshot[key]).not.toBe(nested)
      }
    }

    const controllerSource = items.find((item) => (
      item.content.nativeType === 'teacher-controller'
    ))
    if (!controllerSource || controllerSource.content.nativeType !== 'teacher-controller') {
      throw new Error('missing controller fixture')
    }
    const controller = readonlyNativeRenderInputFromV9Item(controllerSource)
    if (controller.type !== 'teacher-controller') throw new Error('expected controller input')
    expect(controller.buttons.map((button) => button.action))
      .toEqual(controllerSource.content.data.buttons.map((button) => button.action))

    const imageSource = items.find((item) => item.content.nativeType === 'image')
    if (!imageSource || imageSource.content.nativeType !== 'image') {
      throw new Error('missing image fixture')
    }
    const image = readonlyNativeRenderInputFromV9Item(imageSource)
    expect(nativeMediaAssetIds(image)).toEqual([imageSource.content.data.assetId])

    const videoSource = items.find((item) => item.content.nativeType === 'video')
    if (!videoSource || videoSource.content.nativeType !== 'video') {
      throw new Error('missing video fixture')
    }
    const videoWithPoster = structuredClone(videoSource)
    if (videoWithPoster.content.nativeType !== 'video') {
      throw new Error('expected cloned video fixture')
    }
    videoWithPoster.content.data.poster = {
      mode: 'image',
      time: 0,
      assetId: 'poster-detached',
    }
    const video = readonlyNativeRenderInputFromV9Item(videoWithPoster)
    expect(nativeMediaAssetIds(video)).toEqual([
      videoSource.content.data.assetId,
      'poster-detached',
    ])
  })
})
