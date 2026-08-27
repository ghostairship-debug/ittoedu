import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  capturePublishedSlidePng,
  registerPublishedCaptureResource,
} from '../../src/player/surfaces/publishedCapture'

function fixedRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

function setRect(element: Element, width = 100, height = 100): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(fixedRect(width, height))
}

function installCanvasHarness(): {
  drawnSources: CanvasImageSource[]
  paintedText: string[]
  gradientValues: Array<Array<[number, string]>>
  roundedRects: number[][]
  saveRestoreBalances: Array<{ saves: number; restores: number }>
} {
  const drawnSources: CanvasImageSource[] = []
  const paintedText: string[] = []
  const gradientValues: Array<Array<[number, string]>> = []
  const roundedRects: number[][] = []
  const saveRestoreBalances: Array<{ saves: number; restores: number }> = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement,
  ) {
    const balance = { saves: 0, restores: 0 }
    saveRestoreBalances.push(balance)
    const context = {
      canvas: this,
      globalAlpha: 1,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      direction: 'ltr',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      save: vi.fn(() => { balance.saves += 1 }),
      restore: vi.fn(() => { balance.restores += 1 }),
      scale: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn((...values: number[]) => roundedRects.push(values)),
      clip: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillText: vi.fn((value: string) => paintedText.push(value)),
      createLinearGradient: vi.fn(() => {
        const values: Array<[number, string]> = []
        gradientValues.push(values)
        return { addColorStop: (offset: number, color: string) => values.push([offset, color]) }
      }),
      drawImage: vi.fn((source: CanvasImageSource) => {
        drawnSources.push(source)
        if (!(source instanceof HTMLCanvasElement)) return
        const frame = source.dataset.captureFrame ?? source.dataset.frozenCaptureFrame
        if (frame) this.dataset.frozenCaptureFrame = frame
      }),
    }
    return context as unknown as CanvasRenderingContext2D
  } as unknown as HTMLCanvasElement['getContext'])
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function toDataUrl(
    this: HTMLCanvasElement,
  ) {
    return `data:image/png;base64,${btoa(this.dataset.frozenCaptureFrame ?? 'empty')}`
  })
  return {
    drawnSources,
    paintedText,
    gradientValues,
    roundedRects,
    saveRestoreBalances,
  }
}

function createLayer(root: HTMLElement): {
  layer: HTMLElement
  canvas: HTMLCanvasElement
} {
  const layer = document.createElement('div')
  Object.assign(layer.style, {
    position: 'absolute',
    width: '100px',
    height: '100px',
  })
  const canvas = document.createElement('canvas')
  canvas.width = 100
  canvas.height = 100
  Object.assign(canvas.style, {
    display: 'block',
    width: '100px',
    height: '100px',
  })
  layer.appendChild(canvas)
  root.appendChild(layer)
  setRect(layer)
  setRect(canvas)
  return { layer, canvas }
}

function createImageLayer(root: HTMLElement, sources: readonly string[]): {
  layer: HTMLElement
  images: HTMLImageElement[]
} {
  const layer = document.createElement('div')
  Object.assign(layer.style, {
    position: 'absolute',
    width: '100px',
    height: '100px',
  })
  const images = sources.map((source) => {
    const image = document.createElement('img')
    image.src = source
    layer.appendChild(image)
    setRect(image)
    return image
  })
  root.appendChild(layer)
  setRect(layer)
  return { layer, images }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Published Slide static capture', () => {
  it('shares one absolute deadline across sequential capture resources and restores the root', async () => {
    vi.useFakeTimers()
    installCanvasHarness()
    const root = document.createElement('section')
    root.hidden = true
    root.style.left = '7px'
    document.body.appendChild(root)
    setRect(root, 200, 100)
    const first = createLayer(root)
    const second = createLayer(root)
    const firstRestored = vi.fn()
    const secondRestored = vi.fn()
    let secondStarted = false
    const unregisterFirst = registerPublishedCaptureResource(first.layer, {
      waitForCaptureReady: () => new Promise<void>((resolve) => {
        window.setTimeout(resolve, 30)
      }),
      restoreAfterCapture: firstRestored,
    })
    const unregisterSecond = registerPublishedCaptureResource(second.layer, {
      waitForCaptureReady: () => {
        secondStarted = true
        return new Promise<void>(() => undefined)
      },
      restoreAfterCapture: secondRestored,
    })

    try {
      const capture = capturePublishedSlidePng({
        root,
        width: 200,
        height: 100,
        layers: [
          {
            element: first.layer,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
          },
          {
            element: second.layer,
            x: 100,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
          },
        ],
        timeoutMs: 50,
      })
      const outcome = capture.then(
        () => null,
        (cause: unknown) => cause,
      )

      await vi.advanceTimersByTimeAsync(30)
      expect(secondStarted).toBe(true)
      await vi.advanceTimersByTimeAsync(19)
      expect(firstRestored).not.toHaveBeenCalled()
      expect(secondRestored).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(await outcome).toMatchObject({ message: expect.stringContaining('等待动态内容就绪超时') })

      expect(firstRestored).toHaveBeenCalledTimes(1)
      expect(secondRestored).toHaveBeenCalledTimes(1)
      expect(root.hidden).toBe(true)
      expect(root.style.left).toBe('7px')
    } finally {
      unregisterSecond()
      unregisterFirst()
    }
  })

  it('aborts a pending remote image fetch at the capture deadline and restores resources', async () => {
    vi.useFakeTimers()
    installCanvasHarness()
    const root = document.createElement('section')
    root.hidden = true
    document.body.appendChild(root)
    setRect(root)
    const { layer } = createImageLayer(root, ['https://assets.example.test/hanging.png'])
    const restored = vi.fn()
    const unregister = registerPublishedCaptureResource(layer, {
      async waitForCaptureReady() {},
      restoreAfterCapture: restored,
    })
    let fetchSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        fetchSignal?.addEventListener('abort', () => reject(fetchSignal?.reason), { once: true })
      })
    }))

    try {
      const capture = capturePublishedSlidePng({
        root,
        width: 100,
        height: 100,
        layers: [{
          element: layer,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
        }],
        timeoutMs: 40,
      })
      const rejection = expect(capture).rejects.toThrow('等待图片素材读取超时')
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchSignal?.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(40)
      await rejection

      expect(fetchSignal?.aborted).toBe(true)
      expect(restored).toHaveBeenCalledTimes(1)
      expect(root.hidden).toBe(true)
    } finally {
      unregister()
    }
  })

  it('cleans pending image decode handlers and the temporary source at the deadline', async () => {
    vi.useFakeTimers()
    installCanvasHarness()
    const root = document.createElement('section')
    document.body.appendChild(root)
    setRect(root)
    const { layer } = createImageLayer(root, ['data:image/png;base64,AA=='])
    const created: PendingImage[] = []
    class PendingImage {
      onload: ((event: Event) => unknown) | null = null
      onerror: ((event: Event | string) => unknown) | null = null
      src = ''
      naturalWidth = 1
      naturalHeight = 1
      width = 1
      height = 1
      readonly removeAttribute = vi.fn((name: string) => {
        if (name === 'src') this.src = ''
      })

      constructor() {
        created.push(this)
      }
    }
    vi.stubGlobal('Image', PendingImage)

    const capture = capturePublishedSlidePng({
      root,
      width: 100,
      height: 100,
      layers: [{
        element: layer,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
      }],
      timeoutMs: 25,
    })
    const rejection = expect(capture).rejects.toThrow('等待图片解码超时')
    await vi.advanceTimersByTimeAsync(0)
    expect(created).toHaveLength(1)
    expect(created[0]?.src).toBe('data:image/png;base64,AA==')

    await vi.advanceTimersByTimeAsync(25)
    await rejection

    expect(created[0]?.onload).toBeNull()
    expect(created[0]?.onerror).toBeNull()
    expect(created[0]?.removeAttribute).toHaveBeenCalledWith('src')
    expect(created[0]?.src).toBe('')
  })

  it('keeps successful data, blob, and remote images within the shared deadline', async () => {
    installCanvasHarness()
    const root = document.createElement('section')
    document.body.appendChild(root)
    setRect(root)
    const { layer } = createImageLayer(root, [
      'data:image/png;base64,AA==',
      'blob:capture-proof',
      'https://assets.example.test/ready.png',
    ])
    const created: ReadyImage[] = []
    class ReadyImage {
      onload: ((event: Event) => unknown) | null = null
      onerror: ((event: Event | string) => unknown) | null = null
      #src = ''
      naturalWidth = 1
      naturalHeight = 1
      width = 1
      height = 1

      get src(): string {
        return this.#src
      }

      set src(value: string) {
        this.#src = value
        queueMicrotask(() => this.onload?.(new Event('load')))
      }

      removeAttribute(name: string): void {
        if (name === 'src') this.#src = ''
      }

      constructor() {
        created.push(this)
      }
    }
    vi.stubGlobal('Image', ReadyImage)
    let fetchSignal: AbortSignal | undefined
    const remoteBlob = {
      type: 'image/png',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Blob
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined
      return {
        ok: true,
        status: 200,
        blob: async () => remoteBlob,
      } as Response
    }))

    const result = await capturePublishedSlidePng({
      root,
      width: 100,
      height: 100,
      layers: [{
        element: layer,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
      }],
      timeoutMs: 1_000,
    })

    expect(result).toMatch(/^data:image\/png;base64,/)
    expect(created.map((image) => image.src)).toEqual([
      'data:image/png;base64,AA==',
      'blob:capture-proof',
      'data:image/png;base64,AQID',
    ])
    expect(fetchSignal?.aborted).toBe(false)
  })

  it('freezes each prepared Canvas before a later slow resource can clear it', async () => {
    const { drawnSources } = installCanvasHarness()
    const root = document.createElement('section')
    Object.assign(root.style, { width: '200px', height: '100px' })
    document.body.appendChild(root)
    setRect(root, 200, 100)
    const first = createLayer(root)
    const second = createLayer(root)
    second.layer.style.left = '100px'

    const unregisterFirst = registerPublishedCaptureResource(first.layer, {
      async waitForCaptureReady() {
        first.canvas.dataset.captureFrame = 'first-prepared'
      },
    })
    const unregisterSecond = registerPublishedCaptureResource(second.layer, {
      async waitForCaptureReady() {
        // This models a later WebGL instance taking long enough for an earlier
        // preserveDrawingBuffer=false surface to become unreadable.
        first.canvas.dataset.captureFrame = 'first-cleared'
        await Promise.resolve()
        second.canvas.dataset.captureFrame = 'second-prepared'
      },
    })

    try {
      await capturePublishedSlidePng({
        root,
        width: 200,
        height: 100,
        layers: [
          {
            element: first.layer,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
          },
          {
            element: second.layer,
            x: 100,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
          },
        ],
      })
    } finally {
      unregisterSecond()
      unregisterFirst()
    }

    expect(first.canvas.dataset.captureFrame).toBe('first-cleared')
    expect(drawnSources.some((source) => (
      source instanceof HTMLCanvasElement
      && source !== first.canvas
      && source.dataset.frozenCaptureFrame === 'first-prepared'
    ))).toBe(true)
  })

  it('waits for fonts triggered after a later page materialization before painting its PNG', async () => {
    installCanvasHarness()
    const root = document.createElement('section')
    Object.assign(root.style, { width: '100px', height: '100px' })
    document.body.appendChild(root)
    setRect(root)
    const { layer } = createLayer(root)

    let resourcePrepared = false
    let resolveFonts!: () => void
    const fontsReady = new Promise<void>((resolve) => {
      resolveFonts = resolve
    })
    const fontReadyObservations: boolean[] = []
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
    const unregister = registerPublishedCaptureResource(layer, {
      async waitForCaptureReady() {
        resourcePrepared = true
      },
    })

    try {
      await capturePublishedSlidePng({
        root,
        width: 100,
        height: 100,
        layers: [{
          element: layer,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
        }],
      })
      resourcePrepared = false
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: {
          get ready() {
            fontReadyObservations.push(resourcePrepared)
            return fontsReady
          },
        },
      })
      let settled = false
      const capture = capturePublishedSlidePng({
        root,
        width: 100,
        height: 100,
        layers: [{
          element: layer,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
        }],
      }).finally(() => {
        settled = true
      })

      await vi.waitFor(() => expect(fontReadyObservations).toEqual([true]))
      expect(settled).toBe(false)
      resolveFonts()
      await capture
      expect(settled).toBe(true)
    } finally {
      unregister()
      if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('paints linear gradients and clips rounded backgrounds and replaced elements', async () => {
    const { gradientValues, roundedRects } = installCanvasHarness()
    const root = document.createElement('section')
    document.body.appendChild(root)
    setRect(root)
    const { layer, canvas } = createLayer(root)
    layer.style.backgroundImage = 'linear-gradient(to right, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)'
    layer.style.borderRadius = '18px'
    canvas.style.borderRadius = '12px'

    await capturePublishedSlidePng({
      root,
      width: 100,
      height: 100,
      layers: [{
        element: layer,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
      }],
    })

    expect(gradientValues[0]).toEqual([
      [0, 'rgb(255, 0, 0)'],
      [1, 'rgb(0, 0, 255)'],
    ])
    expect(roundedRects.some((values) => values.at(-1) === 18)).toBe(true)
    expect(roundedRects.some((values) => values.at(-1) === 12)).toBe(true)
  })

  it('paints current input, textarea, and select values', async () => {
    const { paintedText } = installCanvasHarness()
    const root = document.createElement('section')
    document.body.appendChild(root)
    setRect(root, 300, 100)
    const layer = document.createElement('div')
    root.appendChild(layer)
    setRect(layer, 300, 100)
    const input = document.createElement('input')
    input.value = '当前输入'
    const textarea = document.createElement('textarea')
    textarea.value = '当前多行值'
    const select = document.createElement('select')
    select.append(new Option('第一项', 'first'), new Option('已选择项', 'selected'))
    select.value = 'selected'
    layer.append(input, textarea, select)
    ;[input, textarea, select].forEach((control) => setRect(control, 100, 36))

    await capturePublishedSlidePng({
      root,
      width: 300,
      height: 100,
      layers: [{
        element: layer,
        x: 0,
        y: 0,
        width: 300,
        height: 100,
        rotation: 0,
        opacity: 1,
      }],
    })

    expect(paintedText).toEqual(expect.arrayContaining(['当前输入', '当前多行值', '已选择项']))
  })

  it('paints assigned slot nodes and falls back to slot children when unassigned', async () => {
    const { drawnSources, saveRestoreBalances } = installCanvasHarness()
    const root = document.createElement('section')
    document.body.appendChild(root)
    setRect(root, 200, 100)
    const layer = document.createElement('div')
    root.appendChild(layer)
    setRect(layer, 200, 100)

    const assignedHost = document.createElement('div')
    const assignedShadow = assignedHost.attachShadow({ mode: 'open' })
    const assignedSlot = document.createElement('slot')
    assignedSlot.style.overflow = 'hidden'
    assignedShadow.appendChild(assignedSlot)
    const assignedCanvas = document.createElement('canvas')
    assignedCanvas.width = 50
    assignedCanvas.height = 50
    assignedHost.appendChild(assignedCanvas)
    const assignedSiblingCanvas = document.createElement('canvas')
    assignedSiblingCanvas.width = 50
    assignedSiblingCanvas.height = 50
    assignedShadow.appendChild(assignedSiblingCanvas)
    layer.appendChild(assignedHost)

    const fallbackHost = document.createElement('div')
    const fallbackShadow = fallbackHost.attachShadow({ mode: 'open' })
    const fallbackSlot = document.createElement('slot')
    const fallbackCanvas = document.createElement('canvas')
    fallbackCanvas.width = 50
    fallbackCanvas.height = 50
    fallbackSlot.appendChild(fallbackCanvas)
    fallbackShadow.appendChild(fallbackSlot)
    layer.appendChild(fallbackHost)
    ;[
      assignedHost,
      assignedSlot,
      assignedCanvas,
      assignedSiblingCanvas,
      fallbackHost,
      fallbackSlot,
      fallbackCanvas,
    ].forEach((element) => setRect(element, 50, 50))

    await capturePublishedSlidePng({
      root,
      width: 200,
      height: 100,
      layers: [{
        element: layer,
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        opacity: 1,
      }],
    })

    expect(drawnSources).toContain(assignedCanvas)
    expect(drawnSources).toContain(assignedSiblingCanvas)
    expect(drawnSources).toContain(fallbackCanvas)
    expect(saveRestoreBalances.every(({ saves, restores }) => saves === restores)).toBe(true)
  })
})
