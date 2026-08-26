import type * as Phaser from 'phaser'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({
  Geom: { Rectangle: class Rectangle {} },
  Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
  Scenes: { Events: { POST_UPDATE: 'postupdate' } },
  GameObjects: { Events: {} },
  Input: { Events: {} },
}))

import { renderNode, type RenderNodeContext } from '../../src/player/renderNode'
import { addPptxFormulaNode } from '../../src/renderer/export/pptxTextAndShape'
import { renderSceneCanvas } from '../../src/renderer/export/renderSceneImages'
import { createFormulaNode, createProject } from '../../src/renderer/project/createProject'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { SceneThumbnail } from '../../src/renderer/ui/SceneThumbnail'
import {
  analyzeFormulaNodeLayout,
  renderFormulaNodeCanvas,
} from '../../src/shared/formulaRenderer'

function canvasContext() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn((value: string) => ({
      width: Math.max(8, Array.from(value).length * 14),
    })),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D & {
    drawImage: ReturnType<typeof vi.fn>
    fillText: ReturnType<typeof vi.fn>
    lineTo: ReturnType<typeof vi.fn>
    stroke: ReturnType<typeof vi.fn>
  }
}

class FakeGameObject {
  active = true
  visible = true
  alpha = 1
  x = 0
  y = 0
  width = 0
  height = 0
  parentContainer: FakeContainer | null = null

  setName(): this { return this }
  setDepth(): this { return this }
  setAngle(): this { return this }
  setAlpha(value: number): this { this.alpha = value; return this }
  setVisible(value: boolean): this { this.visible = value; return this }
  setOrigin(): this { return this }
  setTexture(): this { return this }
  setDisplaySize(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this }
  setSize(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }
  destroy(): void { this.active = false }
}

class FakeContainer extends FakeGameObject {
  readonly list: FakeGameObject[] = []

  add(children: FakeGameObject | FakeGameObject[]): this {
    for (const child of Array.isArray(children) ? children : [children]) {
      if (!this.list.includes(child)) this.list.push(child)
      child.parentContainer = this
    }
    return this
  }

  override destroy(): void {
    super.destroy()
    this.list.forEach((child) => child.destroy())
  }
}

function playerSceneHarness() {
  const textures = new Set<string>()
  const addCanvas = vi.fn((key: string) => { textures.add(key) })
  const remove = vi.fn((key: string) => { textures.delete(key) })
  return {
    scene: {
      add: {
        container: (x = 0, y = 0) => new FakeContainer().setPosition(x, y),
        image: (x = 0, y = 0) => new FakeGameObject().setPosition(x, y),
      },
      textures: {
        addCanvas,
        exists: (key: string) => textures.has(key),
        remove,
      },
      tweens: {
        killTweensOf: vi.fn(),
        add: vi.fn(),
      },
    } as unknown as Phaser.Scene,
    addCanvas,
    remove,
  }
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FormulaNode shared renderer surfaces', () => {
  it('draws recursive layout deterministically and exposes exact overflow metrics', () => {
    const context = canvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const formula = createFormulaNode({
      width: 520,
      height: 210,
      ast: {
        type: 'row',
        children: [
          {
            type: 'fraction',
            numerator: { type: 'token', value: '1' },
            denominator: {
              type: 'root',
              radicand: { type: 'token', value: 'x' },
            },
          },
          { type: 'operator', value: '+' },
          {
            type: 'script',
            base: { type: 'token', value: 'y' },
            superscript: { type: 'token', value: '2' },
          },
        ],
      },
    })

    const rendered = renderFormulaNodeCanvas(formula, formula.width, formula.height, 2)
    const analysis = analyzeFormulaNodeLayout(formula)

    expect(rendered.canvas.width).toBe(formula.width * 2)
    expect(rendered.canvas.height).toBe(formula.height * 2)
    expect(rendered.contentWidth).toBeGreaterThan(0)
    expect(rendered.contentHeight).toBeGreaterThan(formula.style.fontSize)
    expect(analysis).toMatchObject({
      overflowsWidth: false,
      overflowsHeight: false,
    })
    expect(context.fillText).toHaveBeenCalled()
    expect(context.stroke).toHaveBeenCalled()
    expect(context.lineTo).toHaveBeenCalled()
  })

  it('uses the same canvas in Player and refreshes it on state updates', () => {
    const context2d = canvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d)
    const formula = createFormulaNode({ id: 'formula-player' })
    const harness = playerSceneHarness()
    const project = createProject({ includeDefaultController: false, controls: 'none' })
    const renderContext = {
      payload: { project, assets: {}, components: {} },
      registry: {},
      actions: {},
      scope: 'scene',
      sceneId: project.scenes[0]!.id,
      textureKey: (assetId: string) => assetId,
    } as unknown as RenderNodeContext

    const handle = renderNode(harness.scene, formula, 1, renderContext)
    expect(harness.addCanvas).toHaveBeenCalledTimes(1)
    expect(handle.root.width).toBe(formula.width)
    expect(handle.root.height).toBe(formula.height)

    handle.update({
      ...formula,
      ast: { type: 'token', value: 'updated' },
      accessibleText: '更新后的公式',
    })
    expect(harness.addCanvas).toHaveBeenCalledTimes(2)
    expect(harness.remove).toHaveBeenCalledTimes(1)
    handle.destroy()
    expect(harness.remove).toHaveBeenCalledTimes(2)
  })

  it('renders FormulaNode in static HTML/PDF capture and scene thumbnails', async () => {
    const context2d = canvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d)
    const project = createProject({ includeDefaultController: false, controls: 'none' })
    const formula = createFormulaNode({ id: 'formula-static' })
    project.scenes[0]!.nodes.push(formula)
    useEditorStore.getState().loadProject(project, null, {}, {})

    await renderSceneCanvas(project, project.scenes[0]!, {}, 1)
    expect(context2d.drawImage).toHaveBeenCalled()

    const callsBeforeThumbnail = context2d.drawImage.mock.calls.length
    render(<SceneThumbnail scene={project.scenes[0]!} />)
    await waitFor(() => {
      expect(context2d.drawImage.mock.calls.length).toBeGreaterThan(
        callsBeforeThumbnail,
      )
    })
  })

  it('staticizes PPTX as a transparent image with traceable metadata', () => {
    const context2d = canvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,Zm9ybXVsYQ==',
    )
    const formula = createFormulaNode({
      id: 'formula-pptx',
      formulaId: 'math.pptx.1',
      accessibleText: '二分之一',
      ast: {
        type: 'fraction',
        numerator: { type: 'token', value: '1' },
        denominator: { type: 'token', value: '2' },
      },
    })
    const slide = { addImage: vi.fn() }

    addPptxFormulaNode(
      slide as never,
      formula,
      { x: 13.333 / 1280, y: 7.5 / 720 },
    )

    expect(slide.addImage).toHaveBeenCalledWith(expect.objectContaining({
      data: 'data:image/png;base64,Zm9ybXVsYQ==',
      objectName: expect.stringContaining('静态公式'),
      altText: expect.stringContaining('math.pptx.1'),
    }))
  })
})
