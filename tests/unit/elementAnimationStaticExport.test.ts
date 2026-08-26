import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  createTeacherControllerNode,
} from '../../src/renderer/project/createProject'

import { renderSceneCanvas } from '../../src/renderer/export/renderSceneImages'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('playback initial visibility static export semantics', () => {
  it('renders PDF fallback geometry and opacity at the authored stable frame', async () => {
    const translate = vi.fn()
    const scale = vi.fn()
    const alphaValues: number[] = []
    let alpha = 1
    const context = {
      scale,
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate,
      rotate: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 0 })),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
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

    const project = createProject({ includeDefaultController: false, controls: 'none' })
    const node = createTeacherControllerNode({
      id: 'animated-static-node',
      x: 300,
      y: 170,
      width: 420,
      height: 90,
      opacity: 0.68,
      includeInStaticExports: false,
      playbackInitialVisibility: 'hidden',
    })
    project.scenes[0]!.nodes = [node]

    await renderSceneCanvas(project, project.scenes[0]!, {}, 1)

    expect(translate).toHaveBeenCalledWith(
      node.x + node.width / 2,
      node.y + node.height / 2,
    )
    expect(translate).not.toHaveBeenCalledWith(
      node.x + node.width / 2 - 48,
      node.y + node.height / 2,
    )
    expect(alphaValues).toContain(node.opacity)
    expect(alphaValues).not.toContain(0)
    // Playback-only initial hiding does not leak into the static export.
    expect(scale).toHaveBeenCalledTimes(1)
    expect(scale).toHaveBeenCalledWith(1, 1)
  })
})
