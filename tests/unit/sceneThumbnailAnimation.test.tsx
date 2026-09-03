import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentLayerItem } from '../../src/shared/courseProjectTypes'
import { SceneThumbnail } from '../../src/renderer/ui/SceneThumbnail'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { useEditorStore } from '../../src/renderer/store/editorStore'

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  vi.stubGlobal('IntersectionObserver', undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('scene thumbnail playback visibility semantics', () => {
  it('draws a playback-hidden node directly at its authored stable frame', async () => {
    const translate = vi.fn()
    const alphaValues: number[] = []
    let alpha = 1
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate,
      rotate: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'middle',
    }
    Object.defineProperty(context, 'globalAlpha', {
      configurable: true,
      get: () => alpha,
      set: (value: number) => {
        alpha = value
        alphaValues.push(value)
      },
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )

    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    const node: ComponentLayerItem = {
      layerItemId: 'animated-thumbnail-node',
      label: 'animated-thumbnail-node',
      frame: { mode: 'absolute', x: 280, y: 160, width: 400, height: 200 },
      order: 1,
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 0.64,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'hidden',
      kind: 'component',
      component: { packageId: 'com.example.card', version: '1.0.0' },
      props: {},
    }
    surface.scenes[0]!.layerItems = [node]
    project.componentPackages = {
      'com.example.card': {
        packageId: 'com.example.card',
        version: '1.0.0',
        name: 'Card',
        manifestPath: 'components/com.example.card/manifest.json',
        runtimePath: 'components/com.example.card/runtime.js',
        contentSha256: 'a'.repeat(64),
      },
    }
    useEditorStore.getState().loadCourseProject(project, null, {}, {})

    render(<SceneThumbnail locationId={project.startLocationId} />)
    await waitFor(() => expect(translate).toHaveBeenCalled())

    const thumbnailScale = 160 / 1280
    expect(translate).toHaveBeenCalledWith(
      (node.frame.x + node.frame.width / 2) * thumbnailScale,
      (node.frame.y + node.frame.height / 2) * thumbnailScale,
    )
    expect(translate).not.toHaveBeenCalledWith(
      (node.frame.x + node.frame.width / 2 - 48) * thumbnailScale,
      (node.frame.y + node.frame.height / 2) * thumbnailScale,
    )
    expect(alphaValues).toContain(node.opacity)
    expect(alphaValues).not.toContain(0)
  })
})
