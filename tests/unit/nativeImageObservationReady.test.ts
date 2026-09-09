import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageNode } from '../../src/renderer/project/nativeNodeFactories'
import { paintPublishedNativeRenderInput } from '../../src/player/surfaces/native/publishedNativeRendering'
import { waitForPublishedObservationReady } from '../../src/player/surfaces/publishedCapture'
import { renderImageNodeCanvas } from '../../src/shared/imageEffects'

vi.mock('../../src/shared/imageEffects', () => ({ renderImageNodeCanvas: vi.fn(() => {
  const canvas = document.createElement('canvas')
  canvas.dataset.painted = 'true'
  return canvas
}) }))

function fixture() {
  const root = document.createElement('div')
  document.body.append(root)
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const id = ++nextFrame; frames.set(id, callback); return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const frame = () => { const pending = [...frames]; frames.clear(); pending.forEach(([, callback]) => callback(0)) }
  const paint = (assetId: string) => {
    root.replaceChildren()
    paintPublishedNativeRenderInput(root, createImageNode({ id: 'current-image', assetId, x: 0, y: 0, width: 100, height: 80 }),
      { resolveAsset: id => `data:image/png;base64,${id}` })
    const image = root.querySelector('img')!
    return { image, load: () => {
      Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 80 } })
      image.dispatchEvent(new Event('load'))
    } }
  }
  return { root, frame, paint }
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('Native image readiness for live observations', () => {
  it('waits for the hidden decoder, canvas replacement and a rendered frame', async () => {
    const test = fixture(), current = test.paint('current')
    expect(current.image.hidden).toBe(true)
    let observed = false
    const observation = waitForPublishedObservationReady(test.root).then(() => { observed = true })
    await Promise.resolve()
    expect(observed).toBe(false)
    current.load()
    expect(test.root.querySelector('canvas')?.dataset.painted).toBe('true')
    await Promise.resolve()
    expect(observed).toBe(false)
    test.frame()
    await Promise.resolve()
    expect(observed).toBe(false)
    test.frame()
    await observation
    expect(observed).toBe(true)
  })

  it('follows a newer image when the stable wrapper is repainted during a wait', async () => {
    const test = fixture(), old = test.paint('old')
    let observed = false
    const observation = waitForPublishedObservationReady(test.root).then(() => { observed = true })
    const current = test.paint('new')
    old.load()
    await Promise.resolve()
    expect(renderImageNodeCanvas).not.toHaveBeenCalled()
    expect(observed).toBe(false)
    current.load(); test.frame(); test.frame()
    await observation
    expect(renderImageNodeCanvas).toHaveBeenCalledTimes(1)
    expect(observed).toBe(true)
  })

  it('reports decode failure even when it happened before observation, then permits a new valid paint', async () => {
    const test = fixture(), bad = test.paint('bad')
    bad.image.dispatchEvent(new Event('error'))
    await expect(waitForPublishedObservationReady(test.root)).rejects.toThrow('无法解码')
    const current = test.paint('good')
    const observation = waitForPublishedObservationReady(test.root)
    current.load(); test.frame(); test.frame()
    await expect(observation).resolves.toBeUndefined()
  })
})
