import { describe, expect, it, vi } from 'vitest'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import {
  buildPublishedCourseTryRunPayload,
  fitPublishedCourseStage,
  waitForHostLayout,
} from '@/renderer/ui/coursePlayerTryRun'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

function mockClientSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
}

describe('fitPublishedCourseStage', () => {
  it('letterboxes Slide, Flow and Spatial stages into a larger host', () => {
    const host = document.createElement('div')
    const slide = document.createElement('section')
    slide.className = 'slide-published-adapter'
    const flow = document.createElement('section')
    flow.className = 'flow-surface-host'
    const spatial = document.createElement('section')
    spatial.className = 'spatial-surface'
    host.append(slide, flow, spatial)
    mockClientSize(host, 1560, 992)

    fitPublishedCourseStage(host)

    const scale = Math.min(1560 / CANVAS_WIDTH, 992 / CANVAS_HEIGHT)
    for (const stage of [slide, flow, spatial]) {
      expect(stage.style.position).toBe('absolute')
      expect(stage.style.transformOrigin).toBe('0 0')
      expect(stage.style.transform).toBe(`scale(${scale})`)
      expect(stage.style.width).toBe(`${CANVAS_WIDTH}px`)
      expect(stage.style.height).toBe(`${CANVAS_HEIGHT}px`)
      expect(stage.style.left).toBe(`${(1560 - CANVAS_WIDTH * scale) / 2}px`)
      expect(stage.style.top).toBe(`${(992 - CANVAS_HEIGHT * scale) / 2}px`)
      expect(stage.dataset.stageFitScale).toBe(String(scale))
      expect(CANVAS_WIDTH / CANVAS_HEIGHT).toBeCloseTo(16 / 9)
    }
  })

  it('falls back to the design canvas when the host has no layout yet', () => {
    const host = document.createElement('div')
    const adapter = document.createElement('section')
    adapter.className = 'slide-published-adapter'
    host.append(adapter)
    mockClientSize(host, 0, 0)

    fitPublishedCourseStage(host)

    expect(adapter.style.transform).toBe('scale(1)')
    expect(adapter.style.left).toBe('0px')
    expect(adapter.style.top).toBe('0px')
  })
})

describe('waitForHostLayout', () => {
  it('waits until the host has a usable size', async () => {
    const host = document.createElement('div')
    mockClientSize(host, 0, 0)
    let frames = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames += 1
      if (frames === 3) mockClientSize(host, 1280, 720)
      callback(frames)
      return frames
    })
    try {
      await waitForHostLayout(host)
      expect(host.clientWidth).toBe(1280)
      expect(frames).toBe(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('buildPublishedCourseTryRunPayload', () => {
  it('projects only referenced remote project assets while keeping local assets in memory', () => {
    const fixture = listCourseProjectV9Fixtures().find(({ id }) => id === 'multi-asset')!
    const project = structuredClone(fixture.data.project)
    project.assets.photo.remote = { url: 'https://cdn.example.com/photo.png?rev=2' }
    project.assets.unused = {
      ...structuredClone(project.assets.photo),
      id: 'unused',
      filename: 'unused.png',
      path: 'assets/unused.png',
      remote: { url: 'https://unused.example.com/image.png' },
    }
    const assetFiles = {
      ...fixture.data.assetFiles,
      unused: fixture.data.assetFiles.photo!,
    }

    const published = buildPublishedCourseTryRunPayload({
      project,
      assetFiles,
      components: {},
    })

    expect(published.assets.photo?.url).toBe('https://cdn.example.com/photo.png?rev=2')
    expect(published.assets.diagram?.url).toMatch(/^data:image\/png;base64,/)
    expect(published.assets.clip?.url).toMatch(/^data:video\/mp4;base64,/)
    expect(published.assets.voice?.url).toMatch(/^data:audio\/mpeg;base64,/)
    expect(published.assets.unused).toBeUndefined()
  })
})
