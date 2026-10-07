import { afterEach, expect, it, vi } from 'vitest'
import { mountPublishedCourseV3 } from '../../../../src/player/componentPlatform/publishedPlayer'
import { prepareComponentOutputRegion } from '../../../../src/player/componentPlatform/outputCapture'
import type { PublishedCourseV3 } from '../../../../src/shared/contracts/component-platform/published'
import { IMAGE_DEFINITION, createImageData } from '../../../../src/components/image'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'

const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode')
afterEach(() => {
  if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode)
  else delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function turns() { for (let index = 0; index < 80; index++) await Promise.resolve() }
function input(): PublishedCourseV3 {
  return { schemaVersion: 3, id: 'capture-pending', title: '当前资源就绪',
    definitions: { [IMAGE_DEFINITION.id]: IMAGE_DEFINITION, [TEXT_DEFINITION.id]: TEXT_DEFINITION },
    instances: {
      photo: { id: 'photo', definitionId: IMAGE_DEFINITION.id, data: createImageData('current', '当前图片'), frame: { width: 320, height: 200, transform: [1, 0, 0, 1, 0, 0] } },
      text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('后页'), frame: { width: 320, height: 200, transform: [1, 0, 0, 1, 0, 0] } },
    }, assets: { current: { id: 'current', mimeType: 'image/png', url: 'https://current.example/image.png' }, unused: { id: 'unused', mimeType: 'image/png', url: 'https://unused.example/image.png' } },
    surfaces: [{ id: 'current-page', title: '当前', kind: 'slide', childIds: ['photo'] }, { id: 'later-page', title: '后页', kind: 'slide', childIds: ['text'] }], global: { underlay: [], overlay: [] } }
}
function networkControl() {
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWPQrdrxHwAElgJfcgSp1AAAAABJRU5ErkJggg=='), char => char.charCodeAt(0))
  const response = { ok: true, arrayBuffer: async () => bytes.buffer } as Response
  const pending: Array<{ signal: AbortSignal; resolve(value: Response): void }> = []
  let closing = false
  const network = vi.fn((_url: string | URL | Request, options?: RequestInit) => closing ? Promise.resolve(response) : new Promise<Response>(resolve => {
    expect(options?.signal).toBeTruthy()
    pending.push({ signal: options!.signal!, resolve })
  }))
  vi.stubGlobal('fetch', network)
  return { network, pending, resolve: () => pending.forEach(value => value.resolve(response)), close: () => { closing = true; pending.forEach(value => value.resolve(response)) } }
}
function viewport() {
  const root = document.createElement('section'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 640 }, clientHeight: { value: 360 } })
  // jsdom has no layout or decoder. Only these two browser facilities are substituted.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 320, height: 200, left: 0, top: 0, right: 320, bottom: 200, toJSON() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1 })
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:controlled-browser-resource' }; static revokeObjectURL() {} })
  return root
}

it('actual native-image capture waits for the mounted consumer fetch and its decode before returning a rectangle', async () => {
  const remote = networkControl(), root = viewport(), payload = input()
  let releaseDecode!: () => void
  const decoding = new Promise<void>(resolve => { releaseDecode = resolve })
  const decode = vi.fn(async function(this: HTMLImageElement) {
    await decoding
    Object.defineProperties(this, { complete: { value: true, configurable: true }, naturalWidth: { value: 1, configurable: true }, naturalHeight: { value: 1, configurable: true } })
  })
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode })
  let mounted = false
  const mounting = mountPublishedCourseV3(payload, root, { capture: true }).then(player => { mounted = true; return player })
  let player: Awaited<typeof mounting> | undefined
  let captureWork: Promise<unknown> | undefined
  try {
    await turns()
    expect(mounted, 'ordinary mount must not await the current native fetch').toBe(true)
    player = await mounting
    expect(remote.network.mock.calls.map(call => String(call[0]))).toEqual(['https://current.example/image.png'])
    let ready = false
    const capturing = prepareComponentOutputRegion({ payload, root, player, surfaceId: 'current-page', instanceId: 'photo' }).then(value => { ready = true; return value })
    captureWork = capturing
    await turns(); expect(ready).toBe(false)
    remote.resolve(); await turns()
    expect(decode).toHaveBeenCalledOnce()
    expect(root.querySelector('img')?.getAttribute('src')).toBeTruthy()
    expect(ready).toBe(false)
    releaseDecode()
    expect(await capturing).toEqual({ x: 0, y: 0, width: 320, height: 200 })
    expect(remote.network).toHaveBeenCalledOnce()
  } finally { releaseDecode(); remote.close(); player ??= await mounting; await player.dispose(); await captureWork?.catch(() => undefined) }
})

it('disposal cancels a real pending output-region capture and a late response cannot repopulate the Runtime', async () => {
  const remote = networkControl(), root = viewport(), payload = input()
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn(async () => {}) })
  let mounted = false
  const mounting = mountPublishedCourseV3(payload, root, { capture: true }).then(player => { mounted = true; return player })
  let player: Awaited<typeof mounting> | undefined
  try {
    await turns(); expect(mounted).toBe(true)
    player = await mounting
    let settled = false
    const capturing = prepareComponentOutputRegion({ payload, root, player, surfaceId: 'current-page', instanceId: 'photo' }).then(
      value => { settled = true; return { value } }, error => { settled = true; return { error } })
    await turns(); expect(settled).toBe(false)
    await player.dispose()
    expect(remote.pending[0].signal.aborted).toBe(true)
    expect(await capturing).toHaveProperty('error')
    remote.resolve(); await turns()
    expect(root.children).toHaveLength(0)
    expect(player.runtime.contentElement('photo')).toBeNull()
    expect(remote.network).toHaveBeenCalledOnce()
  } finally { remote.close(); player ??= await mounting; await player.dispose() }
})
